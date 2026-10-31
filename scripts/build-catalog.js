#!/usr/bin/env node
/**
 * Builds the visa catalog from catalog/*.yaml.
 *
 *   node scripts/build-catalog.js          validate, then write the outputs
 *   node scripts/build-catalog.js --check  validate and fail if outputs are stale (tests)
 *
 * Outputs:
 *   library/src/catalog/CatalogData.js  bundled in every portal release
 *   dist/catalog.json                   the same data, for "new lists available" notices
 *   catalog/ids.lock                    every ID ever published: IDs may be retired, never removed
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'catalog');
const OUT_JS = path.join(ROOT, 'library/src/catalog/CatalogData.js');
const OUT_JSON = path.join(ROOT, 'dist/catalog.json');

const APPLIES_TO = ['main_applicant', 'spouse', 'each_child', 'each_adult', 'each_person', 'case'];
const LEVELS = ['required', 'optional'];
const RULES = ['max_age_days', 'apostille', 'translation', 'valid_months'];
const ID = /^[A-Z][A-Z0-9_-]*$/;

const LOCK_FILE = path.join(DEFAULT_DIR, 'ids.lock');

function load(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

/** Returns { data, errors, ids }. dir/lock default to the repo's catalog (tests pass others). */
function build(opts) {
  const DIR = (opts && opts.dir) || DEFAULT_DIR;
  const LOCK = (opts && opts.lock) || path.join(DIR, 'ids.lock');
  const errors = [];
  const err = (where, msg) => errors.push(where + ': ' + msg);
  const meta = load(path.join(DIR, 'catalog.yaml'));
  const langs = meta.languages || [];
  const i18n = (where, value, optional) => {
    if (value === undefined && optional) return undefined;
    if (!value || typeof value !== 'object') return err(where, 'missing text');
    langs.forEach((l) => { if (!String(value[l] || '').trim()) err(where, 'missing ' + l); });
    return value;
  };

  if (!/^\d{4}\.\d{1,2}(\.\d+)?$/.test(String(meta.version))) err('catalog.yaml', 'version must look like 2026.11');
  if (!Number.isInteger(meta.format)) err('catalog.yaml', 'format must be an integer');
  i18n('catalog.yaml disclaimer', meta.disclaimer);
  RULES.forEach((r) => i18n('catalog.yaml rule_texts.' + r, (meta.rule_texts || {})[r]));

  const facts = load(path.join(DIR, 'facts.yaml')) || [];
  const factIds = new Set();
  facts.forEach((f) => {
    if (!/^[a-z][a-z_]*$/.test(f.id || '')) err('fact ' + f.id, 'id must be lower_snake_case');
    if (factIds.has(f.id)) err('fact ' + f.id, 'duplicate');
    factIds.add(f.id);
    i18n('fact ' + f.id + ' name', f.name);
    if (f.derived && !['spouse', 'child'].includes(f.derived)) err('fact ' + f.id, 'derived must be spouse or child');
  });

  const documentTypes = {};
  (load(path.join(DIR, 'document-types.yaml')) || []).forEach((d) => {
    const where = 'document ' + d.id;
    if (!ID.test(d.id || '')) err(where, 'bad id');
    if (documentTypes[d.id]) err(where, 'duplicate');
    i18n(where + ' name', d.name);
    i18n(where + ' instructions', d.instructions, true);
    Object.keys(d.rules || {}).forEach((r) => { if (!RULES.includes(r)) err(where, 'unknown rule ' + r); });
    documentTypes[d.id] = { name: d.name, instructions: d.instructions || null, rules: d.rules || {}, active: d.active !== false };
  });

  const countries = {};
  fs.readdirSync(path.join(DIR, 'countries')).filter((f) => f.endsWith('.yaml')).sort().forEach((file) => {
    const c = load(path.join(DIR, 'countries', file));
    const code = c.country && c.country.code;
    if (!/^[A-Z]{2}$/.test(code || '') || file !== code + '.yaml') err(file, 'country code must match the file name');
    i18n(file + ' name', c.country && c.country.name);
    if (!(c.sources || []).length) err(file, 'needs sources');

    const normalise = (r, where) => {
      const out = {
        key: r.doc || r.id,
        doc: r.doc || null,
        any_of: r.any_of || null,
        name: r.any_of ? r.name : null,
        applies_to: r.applies_to,
        level: r.level || 'required',
        only_if: [].concat(r.only_if || []),
        unless: [].concat(r.unless || []),
        min_age: r.applies_to === 'each_adult' ? (r.min_age || 16) : null,
      };
      if (!!r.doc === !!r.any_of) err(where, 'needs exactly one of doc or any_of');
      if (r.doc && !documentTypes[r.doc]) err(where, 'unknown document ' + r.doc);
      if (r.any_of) {
        if (!ID.test(r.id || '')) err(where, 'a group needs an id');
        if (r.any_of.length < 2) err(where, 'a group needs at least two options');
        r.any_of.forEach((d) => { if (!documentTypes[d]) err(where, 'unknown document ' + d); });
        i18n(where + ' name', r.name);
      }
      if (!APPLIES_TO.includes(r.applies_to)) err(where, 'applies_to must be one of ' + APPLIES_TO.join(', '));
      if (!LEVELS.includes(out.level)) err(where, 'level must be required or optional');
      out.only_if.concat(out.unless).forEach((f) => { if (!factIds.has(f)) err(where, 'unknown fact ' + f); });
      return out;
    };

    const visas = (c.visas || []).map((v) => {
      const where = file + ' ' + v.id;
      if (!new RegExp('^' + code + '-[A-Z0-9-]+$').test(v.id || '')) err(where, 'id must start with ' + code + '-');
      i18n(where + ' name', v.name);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.last_reviewed instanceof Date ? v.last_reviewed.toISOString().slice(0, 10) : v.last_reviewed || ''))) {
        err(where, 'needs last_reviewed (YYYY-MM-DD)');
      }
      const reqs = [];
      (v.include || []).forEach((s) => {
        if (!c.sets || !c.sets[s]) return err(where, 'unknown set ' + s);
        c.sets[s].forEach((r, i) => reqs.push(normalise(r, where + ' ' + s + '[' + i + ']')));
      });
      (v.requirements || []).forEach((r, i) => reqs.push(normalise(r, where + ' requirements[' + i + ']')));
      const seen = new Set();
      reqs.forEach((r) => {
        const k = r.key + '|' + r.applies_to;
        if (seen.has(k)) err(where, 'duplicate requirement ' + k);
        seen.add(k);
      });
      return {
        id: v.id, name: v.name, active: v.active !== false,
        last_reviewed: v.last_reviewed instanceof Date ? v.last_reviewed.toISOString().slice(0, 10) : String(v.last_reviewed),
        sources: v.sources || c.sources, requirements: reqs,
      };
    });
    countries[code] = { code: code, name: c.country.name, sources: c.sources, visas: visas };
  });

  // IDs once published may be retired (active: false) but never disappear.
  const ids = new Set([
    ...Object.keys(documentTypes).map((d) => 'doc:' + d),
    ...Object.values(countries).flatMap((c) => c.visas.map((v) => 'visa:' + v.id)),
    ...[...factIds].map((f) => 'fact:' + f),
  ]);
  const locked = fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8').split('\n').filter(Boolean) : [];
  locked.forEach((id) => { if (!ids.has(id)) err('ids.lock', id + ' was published and is gone: set active: false instead'); });

  const data = {
    version: String(meta.version), format: meta.format, languages: langs, disclaimer: meta.disclaimer,
    ruleTexts: meta.rule_texts,
    facts: facts.map((f) => ({ id: f.id, name: f.name, derived: f.derived || null })),
    documentTypes: documentTypes, countries: countries,
  };
  return { data: data, errors: errors, ids: [...ids].sort() };
}

function render(data) {
  const json = JSON.stringify(data, null, 1);
  return {
    js: '/**\n * Generated by scripts/build-catalog.js from catalog/*.yaml. Do not edit by hand.\n' +
      ' * The bundled visa catalog: visas, document types and requirements (no personal data).\n */\n' +
      'const CATALOG_DATA = ' + json + ';\n',
    json: json + '\n',
  };
}

if (require.main === module) {
  const { data, errors, ids } = build();
  if (errors.length) {
    console.error('Catalog errors:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  const out = render(data);
  const lock = ids.join('\n') + '\n';
  if (process.argv.includes('--check')) {
    const stale = [[OUT_JS, out.js], [OUT_JSON, out.json], [LOCK_FILE, lock]]
      .filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c).map(([f]) => path.relative(ROOT, f));
    if (stale.length) {
      console.error('Stale catalog outputs (run: npm run catalog): ' + stale.join(', '));
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JS, out.js);
    fs.writeFileSync(OUT_JSON, out.json);
    fs.writeFileSync(LOCK_FILE, lock);
    const visas = Object.values(data.countries).reduce((n, c) => n + c.visas.length, 0);
    console.log(`Catalog ${data.version}: ${Object.keys(data.countries).length} country, ${visas} visas, ` +
      `${Object.keys(data.documentTypes).length} document types.`);
  }
}

module.exports = { build, render };
