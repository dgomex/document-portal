/** Translation lookup. Falls back to Portuguese, then to the key itself. */
const I18n = (function () {
  function table_(lang) {
    return lang === 'en' ? I18N_EN : I18N_PT;
  }

  function lang(value) {
    return Config.LANGUAGES.indexOf(value) !== -1 ? value : Config.DEFAULT_LANGUAGE;
  }

  /** t('pt', 'seed.done', { added: 4, clients: 4, cases: 7 }) */
  function t(language, key, params) {
    const own = table_(lang(language))[key];
    const text = own !== undefined ? own : (I18N_PT[key] !== undefined ? I18N_PT[key] : key);
    return !params ? text : text.replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] !== undefined ? String(params[name]) : m;
    });
  }

  /** Both tables, for the browser's language toggle. */
  function bundle() {
    return { pt: I18N_PT, en: I18N_EN };
  }

  return { t: t, lang: lang, bundle: bundle };
})();
