/**
 * The firm decides when its document lists change (docs/VISA-CHECKLISTS.md):
 *
 *   - The catalog in use is stored in the firm's own sheet (hidden tab
 *     CatalogData) and Settings catalog_version. A portal update brings a
 *     newer bundled catalog, but it isn't used until the lawyer applies it.
 *   - Once a day, check() looks for a newer catalog: the bundled one, and
 *     (unless catalog_check is off) the published feed. A newer one becomes
 *     "pending": Settings catalog_pending, plus a summary of the changes.
 *   - The lawyer reviews it in Portal > Document lists and applies or ignores it.
 *
 * Only the lists for new (or refreshed) checklists change; existing case
 * checklists are snapshots and stay as they are.
 */
const CatalogUpdates = (function () {
  const TAB = 'CatalogData';
  const CHUNK = 45000;          // Sheets allows 50,000 characters per cell
  const PENDING_KEY = 'CATALOG_PENDING';
  const IGNORED_KEY = 'CATALOG_IGNORED';

  /** -1, 0, 1 for catalog versions like 2026.11 or 2026.11.2. */
  function compare(a, b) {
    const pa = String(a || '0').split('.').map(Number);
    const pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  /** Enough to trust a catalog from outside: same format, references resolve. */
  function valid(data) {
    try {
      if (!data || data.format !== CATALOG_DATA.format || !/^\d{4}\.\d{1,2}(\.\d+)?$/.test(String(data.version))) return false;
      if (!data.documentTypes || !data.countries || !data.languages || !data.ruleTexts) return false;
      return Object.keys(data.countries).every(function (code) {
        return (data.countries[code].visas || []).every(function (v) {
          return /^[A-Z]{2}-[A-Z0-9-]+$/.test(v.id) && (v.requirements || []).every(function (r) {
            return [].concat(r.doc || [], r.any_of || []).every(function (d) { return !!data.documentTypes[d]; });
          });
        });
      });
    } catch (err) {
      return false;
    }
  }

  function readStored_(ss) {
    const sheet = ss.getSheetByName(TAB);
    if (!sheet || sheet.getLastRow() < 1) return null;
    const text = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); }).join('');
    try {
      const data = JSON.parse(text);
      return valid(data) ? data : null;
    } catch (err) {
      return null;
    }
  }

  function store_(ss, data) {
    let sheet = ss.getSheetByName(TAB);
    if (!sheet) sheet = ss.insertSheet(TAB);
    const text = JSON.stringify(data);
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK) chunks.push([text.slice(i, i + CHUNK)]);
    sheet.clear();
    if (chunks.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), chunks.length - sheet.getMaxRows());
    sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
    if (!sheet.isSheetHidden()) sheet.hideSheet();
    Settings.set(ss, 'catalog_version', data.version);
  }

  /**
   * Use the firm's catalog for this execution. The first time (no stored
   * catalog yet) the bundled one becomes the firm's.
   */
  function load(ss) {
    if (!ss.getSheetByName(Config.TABS.SETTINGS)) return Catalog.use(null);
    const stored = readStored_(ss);
    if (stored) {
      // Repair a version that Sheets turned into a date or number before it was written as text.
      if (String(Settings.get(ss, 'catalog_version')) !== stored.version) Settings.set(ss, 'catalog_version', stored.version);
      // A notice for a version that isn't newer than the one in use is stale.
      const pending = Settings.get(ss, 'catalog_pending');
      if (pending !== '' && !(compare(String(pending), stored.version) > 0)) Settings.set(ss, 'catalog_pending', '');
      return Catalog.use(stored.version === CATALOG_DATA.version ? null : stored);
    }
    store_(ss, CATALOG_DATA);
    Catalog.use(null);
  }

  function fetchFeed_(opts) {
    try {
      const res = (opts.fetch || UrlFetchApp.fetch)(Config.CATALOG_FEED_URL, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) return null;
      const data = JSON.parse(res.getContentText());
      return valid(data) ? data : null;
    } catch (err) {
      return null;
    }
  }

  /** What changed between two catalogs, in the firm's language (a few lines per visa). */
  function changes(from, to, lang) {
    const t = function (key, p) { return I18n.t(lang, key, p); };
    const name = function (data, id) { return Catalog.text(data.documentTypes[id] ? data.documentTypes[id].name : null, lang) || id; };
    const visas = function (data) {
      const out = {};
      Object.keys(data.countries).forEach(function (c) { data.countries[c].visas.forEach(function (v) { out[v.id] = v; }); });
      return out;
    };
    const a = visas(from);
    const b = visas(to);
    const lines = [];
    Object.keys(b).forEach(function (id) {
      const vb = b[id];
      const va = a[id];
      const label = Catalog.text(vb.name, lang);
      if (!va) return lines.push(t('catalog.visaAdded', { visa: label }));
      if (va.active && !vb.active) return lines.push(t('catalog.visaRetired', { visa: label }));
      const key = function (r) { return r.key + '|' + r.applies_to; };
      const ra = {};
      va.requirements.forEach(function (r) { ra[key(r)] = r; });
      const rb = {};
      vb.requirements.forEach(function (r) { rb[key(r)] = r; });
      const docLabel = function (data, r) { return r.any_of ? Catalog.text(r.name, lang) : name(data, r.doc); };
      Object.keys(rb).forEach(function (k) {
        if (!ra[k]) lines.push(t('catalog.docAdded', { visa: label, doc: docLabel(to, rb[k]), level: t('checklist.' + (rb[k].level === 'optional' ? 'optional' : 'required')) }));
        else if (ra[k].level !== rb[k].level) lines.push(t('catalog.docLevel', { visa: label, doc: docLabel(to, rb[k]), level: t('checklist.' + (rb[k].level === 'optional' ? 'optional' : 'required')) }));
      });
      Object.keys(ra).forEach(function (k) {
        if (!rb[k]) lines.push(t('catalog.docRemoved', { visa: label, doc: docLabel(from, ra[k]) }));
      });
    });
    return lines;
  }

  /** Daily: mark a newer catalog as pending. Returns the pending version or ''. */
  function check(ctx, opts) {
    opts = opts || {};
    const ss = ctx.ss;
    const stored = readStored_(ss);
    const current = stored ? stored.version : String(Settings.get(ss, 'catalog_version') || CATALOG_DATA.version);
    const ignored = String(ctx.props.getProperty(IGNORED_KEY) || '');
    const candidates = [{ data: CATALOG_DATA, source: 'bundled' }];
    if (String(Settings.get(ss, 'catalog_check') || 'on').trim().toLowerCase() !== 'off') {
      const feed = fetchFeed_(opts);
      if (feed) candidates.push({ data: feed, source: 'feed' });
    }
    const best = candidates.filter(function (c) {
      return compare(c.data.version, current) > 0 && compare(c.data.version, ignored) > 0;
    }).sort(function (x, y) { return compare(y.data.version, x.data.version); })[0];
    if (!best) {
      ctx.props.deleteProperty(PENDING_KEY);
      if (String(Settings.get(ss, 'catalog_pending') || '')) Settings.set(ss, 'catalog_pending', '');
      return '';
    }
    const lang = Settings.language(ss);
    const from = stored || CATALOG_DATA;
    const summary = changes(from, best.data, lang).slice(0, 60);
    ctx.props.setProperty(PENDING_KEY, JSON.stringify({ version: best.data.version, source: best.source, changes: summary }));
    Settings.set(ss, 'catalog_pending', best.data.version);
    return best.data.version;
  }

  /** For the sidebar: { current, pending: { version, changes } | null, check }. */
  function status(ctx) {
    let pending = null;
    try { pending = JSON.parse(ctx.props.getProperty(PENDING_KEY) || 'null'); } catch (err) { pending = null; }
    return {
      current: String(Settings.get(ctx.ss, 'catalog_version') || CATALOG_DATA.version),
      pending: pending ? { version: pending.version, changes: pending.changes } : null,
      check: String(Settings.get(ctx.ss, 'catalog_check') || 'on').trim().toLowerCase() !== 'off',
    };
  }

  /** The lawyer's Apply. Returns { version }. */
  function apply(ctx, version, opts) {
    opts = opts || {};
    let pending = null;
    try { pending = JSON.parse(ctx.props.getProperty(PENDING_KEY) || 'null'); } catch (err) { pending = null; }
    if (!pending || pending.version !== String(version)) throw Errors.make('invalid', 'Nothing pending for ' + version);
    const data = pending.source === 'bundled' ? CATALOG_DATA : fetchFeed_(opts);
    if (!data || data.version !== pending.version) throw Errors.make('catalogUnavailable', 'Pending catalog ' + version + ' not available now');
    store_(ctx.ss, data);
    ctx.props.deleteProperty(PENDING_KEY);
    Settings.set(ctx.ss, 'catalog_pending', '');
    Catalog.use(data.version === CATALOG_DATA.version ? null : data);
    return { version: data.version };
  }

  /** The lawyer's Ignore: this version is never offered again (a newer one will be). */
  function ignore(ctx) {
    let pending = null;
    try { pending = JSON.parse(ctx.props.getProperty(PENDING_KEY) || 'null'); } catch (err) { pending = null; }
    if (pending) ctx.props.setProperty(IGNORED_KEY, pending.version);
    ctx.props.deleteProperty(PENDING_KEY);
    Settings.set(ctx.ss, 'catalog_pending', '');
    return {};
  }

  function setCheck(ctx, on) {
    Settings.set(ctx.ss, 'catalog_check', on ? 'on' : 'off');
    return status(ctx);
  }

  return { compare: compare, valid: valid, load: load, check: check, status: status, apply: apply, ignore: ignore,
    setCheck: setCheck, changes: changes, TAB: TAB };
})();
