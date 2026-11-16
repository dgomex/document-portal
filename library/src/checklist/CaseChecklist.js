/**
 * Keeps each case's checklist in the sheet in step with its visa, people and
 * facts. Run by the 5-minute job and by Portal > Process new rows.
 *
 *   - People rows typed by the lawyer (or the skill) get a person_id; every
 *     case with a visa gets its main applicant, taken from the client.
 *   - Rows the lawyer adds to Checklist by hand (case_id + title) become
 *     ad-hoc requests: an item_id, level "requested", status "missing".
 *   - A case whose visa is set and checklist_version is empty gets its list
 *     built. Since schema 4 (the firm's own lists, FirmLists)
 *     checklist_version = list hash | case hash, the list hash covering that
 *     visa type's client-facing columns only; before, catalog version |
 *     adjustments hash | case hash.
 *   - When the people or facts change (the case hash), the list is rebuilt
 *     and merged: nothing received is lost, nothing is deleted.
 *   - When only the list changes, the case keeps its snapshot and shows as
 *     using an older list; refresh() (the sidebar's "Update these cases")
 *     brings a visa type's open cases up to date with the same merge.
 */
const CaseChecklist = (function () {
  function hash_(value) {
    return Crypto.sha256Hex(JSON.stringify(value)).slice(0, 10);
  }

  function lang_(ss) {
    return Settings.language(ss);
  }

  function people(ss) {
    return Table.open(ss, Config.TABS.PEOPLE).rows().map(function (r) {
      r.person_id = String(r.person_id || '').trim();
      r.case_id = String(r.case_id || '').trim();
      r.role = String(r.role || '').trim().toLowerCase() || 'dependant';
      r.birth_date = Validate.ymd(r.birth_date) || String(r.birth_date || '').trim();
      return r;
    });
  }

  function items(ss) {
    return Table.open(ss, Config.TABS.CHECKLIST).rows().map(function (r) {
      r.item_id = String(r.item_id || '').trim();
      r.case_id = String(r.case_id || '').trim();
      r.level = String(r.level || '').trim().toLowerCase();
      r.status = String(r.status || '').trim().toLowerCase() || Config.ITEM_STATUS.MISSING;
      return r;
    });
  }

  function adjustments(ss) {
    return Table.open(ss, Config.TABS.ADJUSTMENTS).rows();
  }

  /** The part of checklist_version that changes with the case: visa, facts, people. */
  function caseHash(visaId, factsText, casePeople) {
    return hash_([visaId, String(factsText || ''), casePeople.map(function (p) { return [p.person_id, p.role, p.birth_date, p.name]; })]);
  }

  /** checklist_version as 0.4.2 wrote it (catalog | adjustments | case), for the schema 4 migration. */
  function legacyVersion(visaId, factsText, casePeople, adj) {
    const visaAdj = adj.filter(function (a) { return [visaId, '*', ''].indexOf(String(a.visa_type || '').trim()) !== -1; });
    return [
      Catalog.version(),
      hash_(visaAdj.map(function (a) { return [a.visa_type, a.applies_to, a.doc_type, a.action, a.level, a.title, a.note]; })),
      caseHash(visaId, factsText, casePeople),
    ].join('|');
  }

  /** Rebuild one case's list and merge it into its rows (never loses a received document). */
  function apply_(checklist, rows, c, fresh, lang, stamp, itemIds, creates) {
    const plan = Checklist.merge(rows.filter(function (r) { return r.case_id === c.case_id; }), fresh, lang);
    plan.update.forEach(function (u) {
      checklist.update(u.row._row, Object.assign({}, u.partial, { updated_at: stamp }));
    });
    plan.create.forEach(function (item) {
      const id = Ids.generate(Config.ID_PREFIX.ITEM, itemIds);
      itemIds.add(id);
      creates.push({
        item_id: id, case_id: c.case_id, person_id: item.person_id, person_name: item.person_name,
        title: item.title, instructions: item.instructions, level: item.level, status: Config.ITEM_STATUS.MISSING,
        doc_type: item.doc_type, key: item.key, source: item.source, updated_at: stamp, text_json: JSON.stringify(item.text),
      });
    });
    return plan;
  }

  /**
   * Returns { people, requests, built, rebuilt, stale } (plus unknown: cases
   * whose visa type isn't in the firm's Visa types, once it has its own lists).
   */
  function sync(ctx, opts) {
    opts = opts || {};
    const ss = ctx.ss;
    const now = opts.now || Date.now();
    const report = { people: 0, requests: 0, built: 0, rebuilt: 0, stale: 0 };
    if (!ss.getSheetByName(Config.TABS.CHECKLIST)) return report;  // before the schema 3 migration
    if (!ctx.lock.tryLock(30000)) return report;
    try {
      const lang = lang_(ss);
      const stamp = new Date(now);
      const cases = Cases.list(ss).filter(function (c) {
        return c.provision_status === Config.PROVISION.ACTIVE && Ids.isValid(c.case_id, Config.ID_PREFIX.CASE);
      });
      const clients = {};
      Clients.list(ss).forEach(function (c) { clients[c.client_id] = c; });

      // 1. People: IDs for new rows, and a main applicant for every case with a visa.
      const peopleTable = Table.open(ss, Config.TABS.PEOPLE);
      const peopleRows = people(ss);
      const personIds = new Set(peopleRows.map(function (p) { return p.person_id; }).filter(String));
      peopleRows.forEach(function (p) {
        if (p.person_id || !p.case_id || !String(p.name || '').trim()) return;
        p.person_id = Ids.generate(Config.ID_PREFIX.PERSON, personIds);
        personIds.add(p.person_id);
        peopleTable.update(p._row, { person_id: p.person_id, role: p.role, created_at: p.created_at || stamp, created_by: p.created_by || 'sheet' });
        report.people++;
      });
      const newMain = [];
      cases.forEach(function (c) {
        if (!String(c.visa_type || '').trim()) return;
        if (peopleRows.some(function (p) { return p.case_id === c.case_id && p.role === 'main_applicant'; })) return;
        const client = clients[c.client_id];
        if (!client) return;
        const p = {
          person_id: Ids.generate(Config.ID_PREFIX.PERSON, personIds), case_id: c.case_id, name: String(client.name || ''),
          role: 'main_applicant', created_at: stamp, created_by: 'portal',
        };
        personIds.add(p.person_id);
        newMain.push(p);
        peopleRows.push(Object.assign({ birth_date: '' }, p));
      });
      peopleTable.appendMany(newMain);
      report.people += newMain.length;

      // 2. Ad-hoc requests typed into Checklist.
      const checklist = Table.open(ss, Config.TABS.CHECKLIST);
      const rows = items(ss);
      const itemIds = new Set(rows.map(function (r) { return r.item_id; }).filter(String));
      rows.forEach(function (r) {
        if (r.item_id || !r.case_id || !String(r.title || '').trim()) return;
        const person = peopleRows.filter(function (p) {
          return p.case_id === r.case_id && String(p.name).trim().toLowerCase() === String(r.person_name || '').trim().toLowerCase();
        })[0];
        r.item_id = Ids.generate(Config.ID_PREFIX.ITEM, itemIds);
        itemIds.add(r.item_id);
        const partial = {
          item_id: r.item_id, key: 'REQ-' + r.item_id, source: 'case', person_id: person ? person.person_id : '',
          level: r.level || Config.ITEM_LEVEL.REQUESTED, status: r.status || Config.ITEM_STATUS.MISSING, updated_at: stamp,
        };
        checklist.update(r._row, partial);
        Object.assign(r, partial);
        report.requests++;
      });

      // 3. Build or rebuild each case's list.
      const firm = FirmLists.enabled(ss);
      const model = firm ? FirmLists.check(ss).model : null;
      const adj = firm ? [] : adjustments(ss);
      const creates = [];
      if (firm) {
        report.unknown = 0;
        safe_(function () { refreshDropdown_(ctx, model, Cases.list(ss)); });
      }
      cases.forEach(function (c) {
        const visaId = String(c.visa_type || '').trim();
        if (!visaId) return;
        const casePeople = peopleRows.filter(function (p) { return p.case_id === c.case_id && p.person_id; });
        const current = String(c.checklist_version || '');
        let version;
        let build;
        if (firm) {
          const visa = FirmLists.visa(model, visaId);
          if (!visa) { report.unknown++; return; }   // ID changed or deleted: the case keeps its list
          if (!visa.offer) return;                    // no valid rows: never waive a whole list
          version = [visa.listHash, caseHash(visaId, c.facts, casePeople)].join('|');
          build = function () { return Checklist.build({ requirements: visa.requirements, facts: c.facts, people: casePeople, lang: lang, now: now }); };
        } else {
          if (!Catalog.visa(visaId)) return;
          version = legacyVersion(visaId, c.facts, casePeople, adj);
          const visaAdj = adj.filter(function (a) { return [visaId, '*', ''].indexOf(String(a.visa_type || '').trim()) !== -1; });
          build = function () { return Checklist.build({ visaId: visaId, facts: c.facts, people: casePeople, adjustments: visaAdj, lang: lang, now: now }); };
        }
        if (current === version) return;
        const parts = version.split('|');
        const caseChanged = !current || current.split('|')[parts.length - 1] !== parts[parts.length - 1];
        if (!caseChanged) {
          report.stale++;  // the list changed: keep the snapshot until the lawyer refreshes
          return;
        }
        apply_(checklist, rows, c, build(), lang, stamp, itemIds, creates);
        Cases.table(ss).update(c._row, { checklist_version: version });
        if (current) report.rebuilt++; else report.built++;
      });
      checklist.appendMany(creates);
      return report;
    } finally {
      ctx.lock.releaseLock();
    }
  }

  /**
   * "Update these cases": bring the open cases of one visa type up to date
   * with its current list. Returns { updated, created, waived }.
   */
  function refresh(ctx, visaId, opts) {
    opts = opts || {};
    const ss = ctx.ss;
    const now = opts.now || Date.now();
    if (!FirmLists.enabled(ss)) throw Errors.make('invalid', 'This sheet has no firm lists yet');
    if (!ctx.lock.tryLock(30000)) throw Errors.make('busy', 'Another portal task is running');
    try {
      const lang = lang_(ss);
      const stamp = new Date(now);
      const model = FirmLists.check(ss).model;
      const visa = FirmLists.visa(model, visaId);
      if (!visa || !visa.offer) throw Errors.make('invalid', 'Unknown or empty process type ' + visaId);
      const peopleRows = people(ss);
      const checklist = Table.open(ss, Config.TABS.CHECKLIST);
      const rows = items(ss);
      const itemIds = new Set(rows.map(function (r) { return r.item_id; }).filter(String));
      const creates = [];
      const out = { updated: 0, created: 0, waived: 0 };
      older_(ss, model).filter(function (c) { return c.visa_type === visa.id; }).forEach(function (c) {
        const casePeople = peopleRows.filter(function (p) { return p.case_id === c.case_id && p.person_id; });
        const fresh = Checklist.build({ requirements: visa.requirements, facts: c.facts, people: casePeople, lang: lang, now: now });
        const plan = apply_(checklist, rows, c, fresh, lang, stamp, itemIds, creates);
        out.created += plan.create.length;
        out.waived += plan.update.filter(function (u) { return u.partial.reason && u.partial.level === Config.ITEM_LEVEL.WAIVED; }).length;
        Cases.table(ss).update(c._row, { checklist_version: [visa.listHash, caseHash(visa.id, c.facts, casePeople)].join('|') });
        out.updated++;
      });
      checklist.appendMany(creates);
      return out;
    } finally {
      ctx.lock.releaseLock();
    }
  }

  /** Open, built cases whose list is older than their visa type's current one. */
  function older_(ss, model) {
    return Cases.list(ss).filter(function (c) {
      const visa = FirmLists.visa(model, c.visa_type);
      const current = String(c.checklist_version || '');
      return visa && current && c.status === Config.CASE_STATUS.OPEN && current.split('|')[0] !== visa.listHash;
    }).map(function (c) { c.visa_type = String(c.visa_type).trim(); return c; });
  }

  /**
   * For the "Document lists" sidebar: per process type, how many open cases
   * use an older version of its list; and IDs cases use that aren't in Visa types.
   */
  function status(ctx) {
    const ss = ctx.ss;
    if (!FirmLists.enabled(ss)) return { enabled: false, visas: [], unknown: [], summary: null };
    const lang = lang_(ss);
    const checked = FirmLists.check(ss);
    const model = checked.model;
    const older = older_(ss, model);
    const visas = model.order.map(function (id) {
      const v = model.visas[id];
      return { id: id, name: Catalog.text(v.name, lang), active: v.active, offer: v.offer,
        older: older.filter(function (c) { return c.visa_type === id; }).length };
    }).filter(function (v) { return v.older > 0; });
    const counts = {};
    Cases.list(ss).forEach(function (c) {
      const id = String(c.visa_type || '').trim();
      if (id && !FirmLists.visa(model, id)) counts[id] = (counts[id] || 0) + 1;
    });
    const unknown = Object.keys(counts).map(function (id) { return { id: id, cases: counts[id] }; });
    return { enabled: true, visas: visas, unknown: unknown, summary: checked.summary,
      problems: checked.problems.slice(0, 20).map(function (p) {
        return { tab: p.tab, row: p.row, level: p.level, text: I18n.t(lang, p.key, p.params) };
      }) };
  }

  /** Cases visa_type dropdown: refreshed when the set of IDs changes. */
  function refreshDropdown_(ctx, model, allCases) {
    const ids = FirmLists.dropdownIds(model, allCases.map(function (c) { return c.visa_type; }));
    const key = hash_(ids);
    if (ctx.props && ctx.props.getProperty('LISTS_DROPDOWN') === key) return;
    Schema.visaDropdown(ctx.ss, ids, model.order);
    if (ctx.props) ctx.props.setProperty('LISTS_DROPDOWN', key);
  }

  function safe_(fn) {
    try { return fn(); } catch (err) { console.warn('lists: ' + (err && err.message || err)); return null; }
  }

  /**
   * The client-facing view of a case: people in order, each with their items,
   * then the case-level items. Waived items are left out.
   */
  function view(ss, caseId, lang) {
    const order = { main_applicant: 0, spouse: 1, child: 2, dependant: 3 };
    const casePeople = people(ss).filter(function (p) { return p.case_id === caseId && p.person_id; })
      .sort(function (a, b) { return (order[a.role] - order[b.role]) || String(a.name).localeCompare(String(b.name)); });
    const caseItems = items(ss).filter(function (r) {
      return r.case_id === caseId && r.item_id && r.level !== Config.ITEM_LEVEL.WAIVED;
    }).map(function (r) {
      let text = null;
      try { text = JSON.parse(r.text_json || 'null'); } catch (err) { text = null; }
      const options = text && text.options ? text.options.map(function (o) { return Catalog.text(o.title, lang); }) : [];
      return {
        id: r.item_id, personId: String(r.person_id || ''), level: r.level || Config.ITEM_LEVEL.REQUIRED, status: r.status,
        title: text ? Catalog.text(text.title, lang) || String(r.title || '') : String(r.title || ''),
        instructions: text ? Catalog.text(text.instructions, lang) || String(r.instructions || '') : String(r.instructions || ''),
        options: options, reason: r.status === Config.ITEM_STATUS.REJECTED ? String(r.reason || '') : '',
        due: Validate.ymd(r.due_date) || String(r.due_date || ''),
      };
    });
    const groups = casePeople.map(function (p) {
      return { personId: p.person_id, name: String(p.name || ''), role: p.role,
        items: caseItems.filter(function (i) { return i.personId === p.person_id; }) };
    });
    const shared = caseItems.filter(function (i) { return !i.personId || !casePeople.some(function (p) { return p.person_id === i.personId; }); });
    if (shared.length) groups.push({ personId: '', name: '', role: 'case', items: shared });
    return groups.filter(function (g) { return g.items.length; });
  }

  return { sync: sync, refresh: refresh, status: status, view: view, people: people, items: items,
    caseHash: caseHash, legacyVersion: legacyVersion };
})();
