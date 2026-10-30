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
  /** The library version the live portal serves, or '' if it can't be read. */
  function portalVersion(url) {
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(String(url || ''))) return '';
    try {
      const res = UrlFetchApp.fetch(url + '?portal=version', { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) return '';
      const v = JSON.parse(res.getContentText()).libraryVersion;
      return /^\d+\.\d+\.\d+$/.test(String(v)) ? String(v) : '';
    } catch (err) {
      return '';
    }
  }

  /**
   * { sheet, portal, match, migrated }. Runs migrations first: when the sheet
   * already runs a newer library, its sheet changes should apply right away.
   */
  function status(ctx) {
    const m = Migrations.run(ctx);
    const portal = portalVersion(Settings.get(ctx.ss, 'portal_url'));
    return { sheet: Config.LIBRARY_VERSION, portal: portal, match: portal === Config.LIBRARY_VERSION, migrated: m.to > m.from };
  }

  return { status: status, portalVersion: portalVersion };
})();
