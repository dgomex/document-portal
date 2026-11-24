/**
 * Guided update. A firm's copy can't update itself: the Apps Script API is
 * off in the hidden Cloud project behind every copy, and nobody (not even
 * its owner) can switch it on (verified in Phase 6). So the lawyer makes the
 * two changes in the script editor, following the sidebar:
 *   1. Libraries > Portal > newest version   (what the sheet's menus run)
 *   2. Manage deployments > edit > New version (what the portal serves)
 * status() then checks both: the version this code runs as (the sheet) and
 * the version the live portal reports.
 */
const Update = (function () {
  /**
   * What the live portal answers: { version, reach }. reach is 'ok', 'gone'
   * (404: that deployment no longer exists, usually replaced by a new one
   * with a new address), 'private' (it answers, but not to anyone, e.g. with
   * a sign-in page) or 'error' (no answer, or no portal_url).
   */
  function portalCheck(url) {
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(String(url || ''))) return { version: '', reach: 'error' };
    try {
      const res = UrlFetchApp.fetch(url + '?portal=version', { muteHttpExceptions: true, followRedirects: true });
      const code = res.getResponseCode();
      if (code === 404) return { version: '', reach: 'gone' };
      if (code !== 200) return { version: '', reach: code === 401 || code === 403 ? 'private' : 'error' };
      let v;
      try { v = JSON.parse(res.getContentText()).libraryVersion; } catch (e) { return { version: '', reach: 'private' }; }
      return /^\d+\.\d+\.\d+$/.test(String(v)) ? { version: String(v), reach: 'ok' } : { version: '', reach: 'error' };
    } catch (err) {
      return { version: '', reach: 'error' };
    }
  }

  /** The library version the live portal serves, or '' if it can't be read. */
  function portalVersion(url) {
    return portalCheck(url).version;
  }

  /** A portal address change the portal recorded ({ from, to, at }), or null. */
  function urlChange_(ctx) {
    try { return JSON.parse(ctx.props.getProperty(Setup.URL_CHANGED_KEY) || 'null'); } catch (err) { return null; }
  }

  /**
   * { sheet, portal, match, migrated }. Runs migrations first: when the sheet
   * already runs a newer library, its sheet changes should apply right away.
   */
  function status(ctx) {
    const m = Migrations.run(ctx);
    const check = portalCheck(Settings.get(ctx.ss, 'portal_url'));
    const changed = urlChange_(ctx);
    // Shown once the portal answers at its new address; after that it's no longer news.
    if (changed && check.reach === 'ok') ctx.props.deleteProperty(Setup.URL_CHANGED_KEY);
    return {
      sheet: Config.LIBRARY_VERSION, portal: check.version, reach: check.reach, match: check.version === Config.LIBRARY_VERSION,
      migrated: m.to > m.from, urlChanged: changed ? { from: String(changed.from || ''), to: String(changed.to || '') } : null,
    };
  }

  return { status: status, portalVersion: portalVersion, portalCheck: portalCheck };
})();
