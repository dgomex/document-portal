/**
 * Each case's own list of documents: the Checklist tab, one row per document
 * the firm requests in a case (docs/PER-CASE-DOCUMENTS.md). The firm (or its
 * Claude skill) writes the rows; the portal knows nothing about the kind of
 * process, and one case's list never changes another's.
 *
 *   - sync(): rows with a case_id that is in Cases and a title, but no
 *     item_id yet, get an item_id, status "missing" and level "required"
 *     when blank. A row for an unknown case is left as it is, so a typo
 *     stays visible. Run by the 5-minute job and by Portal > Process new rows.
 *   - view(): what the client sees: the case's documents by section.
 *
 * Rows written before 0.6.0 carry more columns (person_name, text_json):
 * they are read as a fallback, never written.
 */
const CaseChecklist = (function () {
  function str_(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function items(ss) {
    return Table.open(ss, Config.TABS.CHECKLIST).rows().map(function (r) {
      r.item_id = str_(r.item_id);
      r.case_id = str_(r.case_id);
      r.level = str_(r.level).toLowerCase();
      r.status = str_(r.status).toLowerCase() || Config.ITEM_STATUS.MISSING;
      // Before 0.6.0 the person a document was for; the schema 5 migration copies it into section.
      r.section = str_(r.section) || str_(r.person_name);
      return r;
    });
  }

  /** Returns { requests }: how many new rows got an ID. */
  function sync(ctx, opts) {
    opts = opts || {};
    const ss = ctx.ss;
    const report = { requests: 0 };
    if (!ss.getSheetByName(Config.TABS.CHECKLIST)) return report;
    if (!ctx.lock.tryLock(30000)) return report;
    try {
      const stamp = new Date(opts.now || Date.now());
      const caseIds = new Set(Cases.list(ss).map(function (c) { return c.case_id; }).filter(String));
      const checklist = Table.open(ss, Config.TABS.CHECKLIST);
      const rows = checklist.rows();  // the cells as they are: items() fills in defaults
      const itemIds = new Set(rows.map(function (r) { return str_(r.item_id); }).filter(String));
      rows.forEach(function (r) {
        if (str_(r.item_id) || !caseIds.has(str_(r.case_id)) || !str_(r.title)) return;
        const id = Ids.generate(Config.ID_PREFIX.ITEM, itemIds);
        itemIds.add(id);
        const partial = { item_id: id, updated_at: stamp };
        if (!str_(r.level)) partial.level = Config.ITEM_LEVEL.REQUIRED;
        if (!str_(r.status)) partial.status = Config.ITEM_STATUS.MISSING;
        checklist.update(r._row, partial);
        report.requests++;
      });
      return report;
    } finally {
      ctx.lock.releaseLock();
    }
  }

  /** A row's text in the client's language: rows from before 0.6.0 kept theirs in text_json. */
  function texts_(r, lang) {
    let text = null;
    try { text = JSON.parse(r.text_json || 'null'); } catch (err) { text = null; }
    return {
      title: (text && Text.pick(text.title, lang)) || str_(r.title),
      instructions: (text && Text.pick(text.instructions, lang)) || str_(r.instructions),
      options: text && text.options ? text.options.map(function (o) { return Text.pick(o.title, lang); }) : [],
    };
  }

  /**
   * The client-facing view of a case: [{ name, items }], one group per
   * section in the order of its first row, the general section (no name)
   * last. Rows keep their sheet order. Waived documents are left out, and
   * "requested" (before 0.6.0) is shown as required. rows: items(ss), when
   * the caller already read them (Reminders goes through every case).
   */
  function view(ss, caseId, lang, rows) {
    const groups = [];
    const byName = Object.create(null);  // a section may be called anything, "constructor" included
    (rows || items(ss)).forEach(function (r) {
      if (r.case_id !== caseId || !r.item_id || r.level === Config.ITEM_LEVEL.WAIVED) return;
      const t = texts_(r, lang);
      const level = r.level === Config.ITEM_LEVEL.OPTIONAL ? r.level : Config.ITEM_LEVEL.REQUIRED;
      if (!(r.section in byName)) groups.push(byName[r.section] = { name: r.section, items: [] });
      byName[r.section].items.push({
        id: r.item_id, level: level, status: r.status, title: t.title, instructions: t.instructions, options: t.options,
        reason: r.status === Config.ITEM_STATUS.REJECTED ? str_(r.reason) : '',
        due: Validate.ymd(r.due_date) || str_(r.due_date),
      });
    });
    return groups.filter(function (g) { return g.name; }).concat(groups.filter(function (g) { return !g.name; }));
  }

  return { sync: sync, view: view, items: items };
})();
