/**
 * Upgrades a firm's sheet and stored state when a newer library arrives.
 * Settings.schema_version says where the sheet is; each step below takes it
 * one version further. Steps must be safe to repeat (a step may run again if
 * a later one fails). Additive changes (new tabs, columns, Settings keys)
 * need no step: Schema.ensure adds them on every run.
 */
const Migrations = (function () {
  // Tabs of the visa-checklist model (0.4 and 0.5), retired in 0.6.0.
  const RETIRED_TABS = ['Visa types', 'Document lists', 'People', 'Adjustments', 'CatalogData'];

  const STEPS = {
    // 2: one shared daily email budget replaced the separate counters.
    2: function (ctx) {
      ctx.props.deleteProperty('OTP_DAILY');
      ctx.props.deleteProperty('DIGEST_DAILY');
    },
    // 3 and 4 built the visa checklists (0.4) and the firm's own lists (0.5).
    // Both models are gone since 0.6.0, and step 5 retires their tabs.
    3: function () {},
    4: function () {},
    // 5: each case has its own list of documents, written by the firm
    // (docs/PER-CASE-DOCUMENTS.md). Existing Checklist rows are each case's
    // list already: they only get a section. Nothing with data is deleted.
    5: function (ctx) {
      const ss = ctx.ss;
      const lang = Settings.language(ss);
      // 1. The person a row was for becomes its section (rows with a section are left alone).
      const checklist = ss.getSheetByName(Config.TABS.CHECKLIST);
      if (checklist) {
        const t = Table.wrap(checklist);
        const n = checklist.getLastRow() - 1;
        if (t.column('person_name') && t.column('section') && n > 0) {
          // One read and one write per column: a firm may have thousands of rows.
          const people = checklist.getRange(2, t.column('person_name'), n, 1).getValues();
          const range = checklist.getRange(2, t.column('section'), n, 1);
          const sections = range.getValues();
          let changed = false;
          sections.forEach(function (s, i) {
            const person = String(people[i][0] || '').trim();
            if (person && !String(s[0] || '').trim()) { s[0] = Sanitize.cell(person); changed = true; }
          });
          if (changed) range.setValues(sections);
        }
      }
      // 2. Retired tabs: deleted when they hold no rows (e.g. a new copy of an
      // older template), otherwise hidden with a note.
      RETIRED_TABS.forEach(function (name) {
        const sheet = ss.getSheetByName(name);
        if (!sheet) return;
        if (!Table.wrap(sheet).rows().length && ss.getSheets().length > 1) {
          ss.deleteSheet(sheet);
          return;
        }
        const a1 = sheet.getRange(1, 1);
        if (a1.setNote) a1.setNote(I18n.t(lang, 'update.retiredTab', {
          date: Utilities.formatDate(new Date(), Config.TIME_ZONE, 'yyyy-MM-dd') }));
        if (typeof sheet.hideSheet === 'function' && !sheet.isSheetHidden()) sheet.hideSheet();
      });
      // 3. The visa dropdown's cache key, and the dropdown itself on Cases.
      ctx.props.deleteProperty('LISTS_DROPDOWN');
      const cases = ss.getSheetByName(Config.TABS.CASES);
      const col = cases ? Table.wrap(cases).column('visa_type') : 0;
      if (col) cases.getRange(2, col, Math.max(cases.getMaxRows() - 1, 1), 1).clearDataValidations();
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

  return { run: run, needed: needed, STEPS: STEPS, RETIRED_TABS: RETIRED_TABS };
})();
