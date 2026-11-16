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
    // 4: the firm's own lists. Seed Visa types and Document lists from the
    // catalog the firm uses with its Adjustments applied, then move every
    // built case to checklist_version = list hash | case hash without
    // changing a single Checklist row. Safe to repeat.
    4: function (ctx) {
      const ss = ctx.ss;
      CatalogUpdates.load(ss);  // the firm's stored catalog, not just the bundled one
      const adjustments = ss.getSheetByName(Config.TABS.ADJUSTMENTS) ? Table.open(ss, Config.TABS.ADJUSTMENTS).rows() : [];
      FirmLists.seed(ss, adjustments);
      const model = FirmLists.check(ss).model;
      if (!ss.getSheetByName(Config.TABS.PEOPLE) || !ss.getSheetByName(Config.TABS.CASES)) return;
      const people = CaseChecklist.people(ss);
      const cases = Cases.table(ss);
      cases.rows().forEach(function (c) {
        const current = String(c.checklist_version || '').trim();
        const visaId = String(c.visa_type || '').trim();
        if (!current || !visaId || current.split('|').length !== 3) return;  // not built, or already migrated
        const casePeople = people.filter(function (p) { return p.case_id === String(c.case_id || '').trim() && p.person_id; });
        const caseHash = CaseChecklist.caseHash(visaId, c.facts, casePeople);
        const visa = FirmLists.visa(model, visaId);
        const upToDate = visa && current === CaseChecklist.legacyVersion(visaId, c.facts, casePeople, adjustments);
        // Current cases match the new list as seeded; any other keeps its old
        // case hash, so a stale case shows "older list" and a pending rebuild still runs.
        cases.update(c._row, { checklist_version: upToDate ? visa.listHash + '|' + caseHash : 'legacy|' + current.split('|')[2] });
      });
      const adjSheet = ss.getSheetByName(Config.TABS.ADJUSTMENTS);
      if (adjSheet && typeof adjSheet.hideSheet === 'function') {
        // Kept (nothing is deleted), but no longer applied: Document lists has its rows now.
        const a1 = adjSheet.getRange(1, 1);
        if (a1.setNote) a1.setNote(I18n.t(Settings.language(ss), 'lists.adjustmentsReplaced', {
          date: Utilities.formatDate(new Date(), Config.TIME_ZONE, 'yyyy-MM-dd') }));
        if (!adjSheet.isSheetHidden()) adjSheet.hideSheet();
      }
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
