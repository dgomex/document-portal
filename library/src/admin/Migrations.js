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
    // 3: People, Checklist and Adjustments tabs, and new columns in Cases and
    // Uploads (visa checklists). All additive: Schema.ensure adds them.
    3: function () {},
    // 4: the firm's own lists (Visa types and Document lists tabs). The
    // portal ships no catalog any more: a new sheet starts with empty tabs.
    // A sheet that ran 0.4.x gets its own stored lists (its CatalogData tab,
    // changed by its Adjustments) copied in, then every built case moves to
    // checklist_version = list hash | case hash without changing a single
    // Checklist row. Safe to repeat.
    4: function (ctx) {
      const ss = ctx.ss;
      const stored = LegacyLists.read(ss);
      if (!stored) return;
      const adjustments = ss.getSheetByName(Config.TABS.ADJUSTMENTS) ? Table.open(ss, Config.TABS.ADJUSTMENTS).rows() : [];
      const countries = String(Settings.get(ss, 'countries') || 'PT').split(/[\s,;]+/).map(function (c) { return c.trim().toUpperCase(); }).filter(String);
      FirmLists.seed(ss, LegacyLists.seedRows(stored, countries, adjustments, Settings.language(ss)));
      const model = FirmLists.check(ss).model;
      if (ss.getSheetByName(Config.TABS.PEOPLE) && ss.getSheetByName(Config.TABS.CASES)) {
        const people = CaseChecklist.people(ss);
        const cases = Cases.table(ss);
        cases.rows().forEach(function (c) {
          const current = String(c.checklist_version || '').trim();
          const visaId = String(c.visa_type || '').trim();
          if (!current || !visaId || current.split('|').length !== 3) return;  // not built, or already migrated
          const casePeople = people.filter(function (p) { return p.case_id === String(c.case_id || '').trim() && p.person_id; });
          const visa = FirmLists.visa(model, visaId);
          const upToDate = visa && current === LegacyLists.version(stored, visaId, c.facts, casePeople, adjustments);
          // Current cases match the copied list; any other keeps its old case
          // hash, so a stale case shows "older list" and a pending rebuild still runs.
          cases.update(c._row, { checklist_version: upToDate
            ? visa.listHash + '|' + CaseChecklist.caseHash(visaId, c.facts, casePeople) : 'legacy|' + current.split('|')[2] });
        });
      }
      // Kept, hidden (nothing is deleted), but no longer used: Document lists has their rows now.
      [Config.TABS.ADJUSTMENTS, LegacyLists.TAB].forEach(function (name) {
        const sheet = ss.getSheetByName(name);
        if (!sheet || typeof sheet.hideSheet !== 'function') return;
        const a1 = sheet.getRange(1, 1);
        if (a1.setNote) a1.setNote(I18n.t(Settings.language(ss), 'lists.legacyReplaced', {
          date: Utilities.formatDate(new Date(), Config.TIME_ZONE, 'yyyy-MM-dd') }));
        if (!sheet.isSheetHidden()) sheet.hideSheet();
      });
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
