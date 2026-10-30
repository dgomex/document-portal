/**
 * Upgrades a firm's sheet and stored state when a newer library arrives.
 * Settings.schema_version says where the sheet is; each step below takes it
 * one version further. Steps must be safe to repeat (a step may run again if
 * a later one fails). Additive changes (new tabs, columns, Settings keys)
 * need no step: Schema.ensure adds them on every run.
 */
const Migrations = (function () {
  const STEPS = {
    // 2: one shared daily email budget replaced the separate counters.
    2: function (ctx) {
      ctx.props.deleteProperty('OTP_DAILY');
      ctx.props.deleteProperty('DIGEST_DAILY');
    },
  };

  function current_(ss) {
    if (!ss.getSheetByName(Config.TABS.SETTINGS)) return 0;
    return Number(Settings.get(ss, 'schema_version')) || 0;
  }

  function needed(ss) {
    return current_(ss) < Config.SCHEMA_VERSION;
  }

  /** Brings the sheet to Config.SCHEMA_VERSION. Returns { from, to }. */
  function run(ctx) {
    if (!ctx.lock.tryLock(30000)) throw Errors.make('busy', 'Another portal task is running');
    try {
      const from = current_(ctx.ss);
      Schema.ensure(ctx.ss);
      for (let v = from + 1; v <= Config.SCHEMA_VERSION; v++) {
        if (STEPS[v]) STEPS[v](ctx);
        Settings.set(ctx.ss, 'schema_version', v);
      }
      if (from > Config.SCHEMA_VERSION) console.warn('Sheet schema ' + from + ' is newer than this library (' + Config.SCHEMA_VERSION + ')');
      return { from: from, to: Math.max(from, Config.SCHEMA_VERSION) };
    } finally {
      ctx.lock.releaseLock();
    }
  }

  return { run: run, needed: needed, STEPS: STEPS };
})();
