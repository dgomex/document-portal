/**
 * One-time bridge for sheets that ran 0.4.x (schema 3), used only by the
 * schema 4 migration. Those sheets built their cases from a catalog stored
 * in their own hidden CatalogData tab, changed by their Adjustments tab.
 * The portal no longer ships or reads a central catalog: this module reads
 * the firm's own stored copy once, so the migration can turn it into the
 * firm's Visa types and Document lists without changing any existing case.
 *
 * Everything here reproduces 0.4.2 exactly (requirements, text, version),
 * because the migration must recognise which cases are up to date.
 */
const LegacyLists = (function () {
  const TAB = 'CatalogData';
  const FIRM_PREFIX = 'FIRM-';
  const LANGS = ['pt', 'en', 'es'];

  /** The catalog a 0.4.x sheet stored in its CatalogData tab, or null. */
  function read(ss) {
    const sheet = ss.getSheetByName(TAB);
    if (!sheet || sheet.getLastRow() < 1) return null;
    try {
      const text = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); }).join('');
      const data = JSON.parse(text);
      return data && data.countries && data.documentTypes && data.version ? data : null;
    } catch (err) {
      return null;
    }
  }

  function visa_(data, id) {
    const code = String(id || '').split('-')[0];
    return ((data.countries[code] || {}).visas || []).filter(function (v) { return v.id === id; })[0] || null;
  }

  function slug_(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }

  function same_(text) {
    const out = {};
    LANGS.forEach(function (l) { out[l] = text; });
    return out;
  }

  function join_(a, b) {
    const out = {};
    LANGS.forEach(function (l) {
      out[l] = [a && a[l], b && b[l]].map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' ');
    });
    return out;
  }

  function ruleNotes_(data, rules) {
    const out = {};
    LANGS.forEach(function (lang) {
      out[lang] = Object.keys(rules || {}).filter(function (r) { return rules[r] && data.ruleTexts[r]; }).map(function (r) {
        return Text.pick(data.ruleTexts[r], lang).replace('{n}', String(rules[r]));
      }).join(' ');
    });
    return out;
  }

  /** A visa's requirements after the firm's Adjustments, as 0.4.2 built them. */
  function requirements(data, visaId, adjustments) {
    const visa = visa_(data, visaId);
    if (!visa) return [];
    let reqs = visa.requirements.map(function (r) { return Object.assign({ source: 'catalog', titleOverride: '', note: '' }, r); });
    (adjustments || []).filter(function (a) {
      const v = String(a.visa_type || '').trim();
      return v === '' || v === '*' || v === visaId;
    }).forEach(function (a) {
      const action = String(a.action || '').trim().toLowerCase();
      const key = String(a.doc_type || '').trim();
      const appliesTo = String(a.applies_to || '').trim();
      const matches = function (r) { return r.key === key && (!appliesTo || r.applies_to === appliesTo); };
      if (action === 'hide') {
        reqs = reqs.filter(function (r) { return !matches(r); });
      } else if (action === 'change') {
        reqs.forEach(function (r) {
          if (!matches(r)) return;
          if (a.level) r.level = String(a.level).trim();
          if (a.title) r.titleOverride = String(a.title).trim();
          if (a.note) r.note = String(a.note).trim();
          r.source = 'firm';
        });
      } else if (action === 'add') {
        const known = data.documentTypes[key];
        const newKey = known ? key : FIRM_PREFIX + slug_(key || a.title);
        if (newKey === FIRM_PREFIX) return;
        reqs.push({
          key: newKey, doc: known ? key : null, any_of: null, name: null, source: 'firm',
          applies_to: Config.APPLIES_TO.indexOf(appliesTo) !== -1 ? appliesTo : 'main_applicant',
          level: String(a.level || 'required').trim(), only_if: [], unless: [], min_age: appliesTo === 'each_adult' ? 16 : null,
          titleOverride: String(a.title || (known ? '' : key)).trim(), note: String(a.note || '').trim(),
        });
      }
    });
    return reqs.map(function (r) { return Object.assign(r, { text: text_(data, r) }); });
  }

  function text_(data, r) {
    let title;
    let instructions;
    let options = [];
    if (r.any_of) {
      title = r.name;
      options = r.any_of.map(function (d) { return { doc: d, title: data.documentTypes[d].name }; });
      instructions = {};
    } else if (r.doc) {
      const d = data.documentTypes[r.doc];
      title = d.name;
      instructions = join_(d.instructions, ruleNotes_(data, d.rules));
    } else {
      title = same_('');
      instructions = {};
    }
    if (r.titleOverride) title = same_(r.titleOverride);
    if (r.note) instructions = join_(instructions, same_(r.note));
    return { title: title, instructions: instructions, options: options };
  }

  /** checklist_version as 0.4.2 wrote it: catalog version | adjustments hash | case hash. */
  function version(data, visaId, factsText, casePeople, adjustments) {
    const visaAdj = (adjustments || []).filter(function (a) { return [visaId, '*', ''].indexOf(String(a.visa_type || '').trim()) !== -1; });
    const hash = function (v) { return Crypto.sha256Hex(JSON.stringify(v)).slice(0, 10); };
    return [
      data.version,
      hash(visaAdj.map(function (a) { return [a.visa_type, a.applies_to, a.doc_type, a.action, a.level, a.title, a.note]; })),
      CaseChecklist.caseHash(visaId, factsText, casePeople),
    ].join('|');
  }

  /**
   * Rows for the two tabs from the stored catalog, for the firm's countries,
   * with its Adjustments applied: hide → active off, change → new level /
   * title / note (the same text in every language, as 0.4.2 showed it),
   * add → a new row. The text written is what 0.4.2 showed clients.
   */
  function seedRows(data, countries, adjustments, lang) {
    const types = [];
    const docs = [];
    const pick = function (value, l) { return value ? String(value[l] || '') : ''; };
    const codes = (countries && countries.length ? countries : Object.keys(data.countries)).filter(function (c) { return !!data.countries[c]; });
    codes.forEach(function (code) {
      (data.countries[code].visas || []).forEach(function (v) {
        const adj = (adjustments || []).filter(function (a) { return [v.id, '*', ''].indexOf(String(a.visa_type || '').trim()) !== -1; });
        const hides = adj.filter(function (a) { return String(a.action || '').trim().toLowerCase() === 'hide'; });
        const hidden = function (r) {
          return hides.some(function (a) {
            return String(a.doc_type || '').trim() === r.key && (!String(a.applies_to || '').trim() || String(a.applies_to).trim() === r.applies_to);
          });
        };
        const reqs = requirements(data, v.id, adj.filter(function (a) { return hides.indexOf(a) === -1; }));
        const facts = [];
        v.requirements.forEach(function (r) {
          (r.only_if || []).concat(r.unless || []).forEach(function (f) {
            if (['married', 'children'].indexOf(f) === -1 && facts.indexOf(f) === -1) facts.push(f);
          });
        });
        types.push({
          visa_type: v.id, name_pt: pick(v.name, 'pt'), name_en: pick(v.name, 'en'), name_es: pick(v.name, 'es'),
          active: !!v.active, family: v.requirements.some(function (r) { return ['spouse', 'each_child'].indexOf(r.applies_to) !== -1; }),
          facts_to_ask: facts.join(';'), notes: '',
        });
        let n = 0;
        reqs.forEach(function (r) {
          const base = {
            visa_type: v.id, applies_to: r.applies_to, level: r.level, only_if: (r.only_if || []).join(';'),
            unless: (r.unless || []).join(';'), min_age: r.min_age === null || r.min_age === undefined ? '' : r.min_age,
            active: !hidden(r),
          };
          if (r.any_of) {
            r.any_of.forEach(function (d, i) {
              const dt = data.documentTypes[d] || {};
              const row = Object.assign({}, base, {
                order: ++n, doc_key: d, group_key: r.key,
                // The option's guidance is for the lawyer's check: 0.4.2 never showed it for groups.
                check_criteria: Text.pick(join_(dt.instructions, ruleNotes_(data, dt.rules)), lang),
                title_pt: pick(dt.name, 'pt'), title_en: pick(dt.name, 'en'), title_es: pick(dt.name, 'es'),
                group_pt: pick(r.text.title, 'pt'), group_en: pick(r.text.title, 'en'), group_es: pick(r.text.title, 'es'),
                instructions_pt: '', instructions_en: '', instructions_es: '',
              });
              // A firm note on a whole group (an Adjustment change) stays visible: on the first option.
              if (i === 0 && r.note) LANGS.forEach(function (l) { row['instructions_' + l] = r.note; });
              docs.push(row);
            });
          } else {
            docs.push(Object.assign({}, base, {
              order: ++n, doc_key: r.key, group_key: '', check_criteria: '',
              title_pt: pick(r.text.title, 'pt'), title_en: pick(r.text.title, 'en'), title_es: pick(r.text.title, 'es'),
              instructions_pt: pick(r.text.instructions, 'pt'), instructions_en: pick(r.text.instructions, 'en'),
              instructions_es: pick(r.text.instructions, 'es'),
              group_pt: '', group_en: '', group_es: '',
            }));
          }
        });
      });
    });
    return { types: types, docs: docs };
  }

  return { read: read, requirements: requirements, version: version, seedRows: seedRows, TAB: TAB };
})();
