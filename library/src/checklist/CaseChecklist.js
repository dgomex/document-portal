/**
 * Keeps each case's checklist in the sheet in step with its visa, people and
 * facts. Run by the 5-minute job and by Portal > Process new rows.
 *
 *   - People rows typed by the lawyer (or the skill) get a person_id; every
 *     case with a visa gets its main applicant, taken from the client.
 *   - Rows the lawyer adds to Checklist by hand (case_id + title) become
 *     ad-hoc requests: an item_id, level "requested", status "missing".
 *   - A case whose visa is set and checklist_version is empty gets its list
 *     built. checklist_version = catalog version | adjustments hash | case hash.
 *   - When the people or facts change (the case hash), the list is rebuilt
 *     and merged: nothing received is lost, nothing is deleted.
 *   - When only the catalog or the firm's adjustments change, the list stays
 *     as it is (the snapshot): the lawyer clears checklist_version to rebuild.
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

  /** Returns { people, requests, built, rebuilt, stale }. */
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
      const adj = adjustments(ss);
      const creates = [];
      cases.forEach(function (c) {
        const visaId = String(c.visa_type || '').trim();
        if (!visaId || !Catalog.visa(visaId)) return;
        const casePeople = peopleRows.filter(function (p) { return p.case_id === c.case_id && p.person_id; });
        const visaAdj = adj.filter(function (a) { return [visaId, '*', ''].indexOf(String(a.visa_type || '').trim()) !== -1; });
        const version = [
          Catalog.version(),
          hash_(visaAdj.map(function (a) { return [a.visa_type, a.applies_to, a.doc_type, a.action, a.level, a.title, a.note]; })),
          hash_([visaId, String(c.facts || ''), casePeople.map(function (p) { return [p.person_id, p.role, p.birth_date, p.name]; })]),
        ].join('|');
        const current = String(c.checklist_version || '');
        if (current === version) return;
        const caseChanged = !current || current.split('|')[2] !== version.split('|')[2];
        if (!caseChanged) {
          report.stale++;  // catalog or firm list changed: keep the snapshot
          return;
        }
        const fresh = Checklist.build({ visaId: visaId, facts: c.facts, people: casePeople, adjustments: visaAdj, lang: lang, now: now });
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

  return { sync: sync, view: view, people: people, items: items };
})();
