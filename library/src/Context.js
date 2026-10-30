/**
 * The shell passes its own Spreadsheet, Properties, Cache, Lock and ScriptApp
 * in a ctx object. The library never calls CacheService, PropertiesService or
 * LockService itself: inside a library those can resolve to the library's
 * own store, which would mix firms' data into storage we own. ScriptApp comes
 * from the shell too, so triggers, the OAuth token and the web-app URL belong
 * to the firm's project.
 */
const Context = (function () {
  // lock: the script lock (provisioning, which can hold it for minutes).
  // authLock: a separate lock for the short login critical sections.
  const REQUIRED = ['ss', 'props', 'cache', 'lock', 'authLock', 'script'];

  function check(ctx) {
    const missing = REQUIRED.filter(function (k) { return !ctx || !ctx[k]; });
    if (missing.length) throw new Error('Portal: the sheet script must pass ' + missing.join(', '));
    return ctx;
  }

  /**
   * Menu, sidebar and dev actions only. Every shell function can be called
   * from the public page via google.script.run; there the web app runs as the
   * owner but the visitor is anonymous, so the active user's email is empty.
   */
  function requireOwner() {
    const active = Session.getActiveUser().getEmail();
    if (!active || active !== Session.getEffectiveUser().getEmail()) {
      throw Errors.make('forbidden', 'This action is only available from the sheet');
    }
  }

  return { check: check, requireOwner: requireOwner };
})();
