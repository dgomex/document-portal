/**
 * Read access to the visa catalog: the bundled CATALOG_DATA, or a newer one
 * the firm chose to apply (kept in the hidden CatalogData tab, see
 * CatalogUpdates). Text helpers fall back to Portuguese, then English.
 */
const Catalog = (function () {
  let override_ = null;  // set per execution by CatalogUpdates.load

  function data() {
    return override_ || CATALOG_DATA;
  }

  function use(catalog) {
    override_ = catalog || null;
  }

  /** Country codes enabled in Settings (default PT), limited to the ones the catalog has. */
  function countriesOf(ss) {
    const raw = ss && ss.getSheetByName(Config.TABS.SETTINGS) ? String(Settings.get(ss, 'countries') || '') : '';
    const wanted = (raw || 'PT').split(/[\s,;]+/).map(function (c) { return c.trim().toUpperCase(); }).filter(String);
    return wanted.filter(function (c) { return !!data().countries[c]; });
  }

  /** Active visas for these countries, in catalog order. */
  function visas(countries) {
    return [].concat.apply([], (countries || []).map(function (c) {
      return ((data().countries[c] || {}).visas || []).filter(function (v) { return v.active; });
    }));
  }

  /** A visa by ID, retired ones included (old cases keep working). */
  function visa(id) {
    const code = String(id || '').split('-')[0];
    return ((data().countries[code] || {}).visas || []).filter(function (v) { return v.id === id; })[0] || null;
  }

  function docType(id) {
    return data().documentTypes[id] || null;
  }

  function version() {
    return data().version;
  }

  function facts() {
    return data().facts;
  }

  /** text: { pt, en, es }. */
  function text(value, lang) {
    if (!value) return '';
    return value[lang] || value.pt || value.en || '';
  }

  /** The standard notes for a document's rules, in every catalog language. */
  function ruleNotes(rules) {
    const out = {};
    data().languages.forEach(function (lang) {
      out[lang] = Object.keys(rules || {}).filter(function (r) { return rules[r] && data().ruleTexts[r]; }).map(function (r) {
        return text(data().ruleTexts[r], lang).replace('{n}', String(rules[r]));
      }).join(' ');
    });
    return out;
  }

  return { data: data, use: use, countriesOf: countriesOf, visas: visas, visa: visa, docType: docType, version: version,
    facts: facts, text: text, ruleNotes: ruleNotes };
})();
