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
      if (key) out[key] = r.value === null || r.value === undefined ? '' : r.value;
    });
    return out;
  }

  function get(ss, key) {
    const v = read(ss)[key];
    return v === undefined ? '' : v;
  }

  function set(ss, key, value) {
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
