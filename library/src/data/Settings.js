/** Key/value Settings tab (key | value | description). */
const Settings = (function () {
  function table_(ss) {
    const t = Table.open(ss, Config.TABS.SETTINGS);
    t.require(['key', 'value']);
    return t;
  }

  function read(ss) {
    const out = {};
    table_(ss).rows().forEach(function (r) {
      const key = String(r.key).trim();
      if (!key) return;
      const v = r.value === null || r.value === undefined ? '' : r.value;
      // Sheets hides the leading apostrophe that marks text; the fakes in tests don't.
      out[key] = typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v;
    });
    return out;
  }

  function get(ss, key) {
    const v = read(ss)[key];
    return v === undefined ? '' : v;
  }

  /**
   * Strings Sheets would turn into a number or a date ("0.3.1" became the date
   * 2000-03-01, "2026.10" the number 2026.1) are written as text, with the
   * leading apostrophe Sheets uses for that.
   */
  function set(ss, key, value) {
    if (typeof value === 'string' && /^[\d][\d.\-\/: ]*$/.test(value) && /[.\-\/:]/.test(value)) value = "'" + value;
    const t = table_(ss);
    const existing = t.rows().filter(function (r) { return String(r.key).trim() === key; })[0];
    if (existing) t.update(existing._row, { value: value });
    else t.append({ key: key, value: value });
  }

  function language(ss) {
    return I18n.lang(String(get(ss, 'default_language')));
  }

  return { read: read, get: get, set: set, language: language };
})();
