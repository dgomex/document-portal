/** Text in several languages: { pt, en, es }. Falls back to Portuguese, then English. */
const Text = (function () {
  function pick(value, lang) {
    if (!value) return '';
    return value[lang] || value.pt || value.en || '';
  }

  return { pick: pick };
})();
