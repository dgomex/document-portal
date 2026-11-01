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
const OUT_SKILL = path.join(ROOT, 'skill/portal-clients/references/catalog.md');

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
    // A rule's note is added automatically: the instructions mustn't say it again.
    const en = String((d.instructions || {}).en || '').toLowerCase();
    if ((d.rules || {}).apostille && /apostil/.test(en)) err(where, 'instructions repeat the apostille rule');
    if ((d.rules || {}).max_age_days && /issued within/.test(en)) err(where, 'instructions repeat the max_age_days rule');
    if ((d.rules || {}).valid_months && /valid at least|valid for at least/.test(en)) err(where, 'instructions repeat the valid_months rule');
    if ((d.rules || {}).translation && /translat/.test(en)) err(where, 'instructions repeat the translation rule');
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

/** The skill's reference: what it may write into visa_type, facts, applies_to and doc_type. */
function skillReference(data) {
  const rows = (cells) => '| ' + cells.join(' | ') + ' |';
  const lines = [
    '# Visa catalog ' + data.version,
    '',
    '<!-- Generated by scripts/build-catalog.js from catalog/*.yaml. Do not edit by hand. -->',
    '',
    '> ' + data.disclaimer.en,
    '',
    '## Visas (`Cases.visa_type`, `Adjustments.visa_type`)',
    '',
  ];
  Object.values(data.countries).forEach((c) => {
    // What the skill asks the lawyer when opening a case: whether family members
    // have documents of their own, and which of the lawyer's facts change the list.
    const lawyerFacts = new Set(data.facts.filter((f) => !f.derived).map((f) => f.id));
    const family = (v) => (v.requirements.some((r) => r.applies_to !== 'main_applicant' && r.applies_to !== 'case') ? 'yes' : 'no');
    const facts = (v) => [...new Set(v.requirements.flatMap((r) => r.only_if.concat(r.unless)).filter((f) => lawyerFacts.has(f)))]
      .map((f) => '`' + f + '`').join(', ') || '–';
    lines.push('### ' + c.name.en + ' (`' + c.code + '`)', '',
      rows(['visa_type', 'Português', 'English', 'Family documents', 'Facts to ask', 'Reviewed']), rows(['---', '---', '---', '---', '---', '---']));
    c.visas.filter((v) => v.active).forEach((v) => lines.push(rows(['`' + v.id + '`', v.name.pt, v.name.en, family(v), facts(v), v.last_reviewed])));
    lines.push('');
  });
  lines.push('## Facts (`Cases.facts`, `;`-separated)', '', rows(['fact', 'Meaning', 'Set by']), rows(['---', '---', '---']));
  data.facts.forEach((f) => lines.push(rows(['`' + f.id + '`', f.name.en, f.derived ? 'automatic (from People: ' + f.derived + ')' : 'the lawyer'])));
  lines.push('', '## Document types (`Adjustments.doc_type`)', '',
    'Groups ("any one of") are keyed by their group name, e.g. `MEANS`, `ACCOMMODATION`; see each visa\'s requirements in the portal.', '',
    rows(['doc_type', 'Português', 'English']), rows(['---', '---', '---']));
  Object.keys(data.documentTypes).sort().forEach((id) => {
    const d = data.documentTypes[id];
    if (d.active) lines.push(rows(['`' + id + '`', d.name.pt, d.name.en]));
  });
  return lines.join('\n') + '\n';
}

function render(data) {
  const json = JSON.stringify(data, null, 1);
  return {
    skill: skillReference(data),
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
    const stale = [[OUT_JS, out.js], [OUT_JSON, out.json], [OUT_SKILL, out.skill], [LOCK_FILE, lock]]
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
    fs.writeFileSync(OUT_SKILL, out.skill);
    fs.writeFileSync(LOCK_FILE, lock);
    const visas = Object.values(data.countries).reduce((n, c) => n + c.visas.length, 0);
    console.log(`Catalog ${data.version}: ${Object.keys(data.countries).length} country, ${visas} visas, ` +
      `${Object.keys(data.documentTypes).length} document types.`);
  }
}

module.exports = { build, render };
