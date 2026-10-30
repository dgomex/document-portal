/**
 * Turns new Clients/Cases rows into folders. Rows are written by the Claude
 * skill (Sheets API, so no onEdit trigger fires) or by hand, with
 * provision_status PENDING or blank. Each run:
 *   - assigns an ID to rows that have data but no ID,
 *   - validates the row,
 *   - creates the Drive folder (client under root, case under client),
 *   - marks the row ACTIVE, or ERROR with the reason in provision_error.
 * Safe to re-run: rows with a folder_id never get a second folder.
 */
const Provision = (function () {
  const BUDGET_MS = 4.5 * 60 * 1000;

  function targets_(retryErrors) {
    const P = Config.PROVISION;
    return retryErrors ? ['', P.PENDING, P.ERROR] : ['', P.PENDING];
  }

  function wants_(row, retryErrors) {
    return targets_(retryErrors).indexOf(String(row.provision_status || '').trim()) !== -1;
  }

  /** Cheap check so the 5-minute trigger exits without taking the lock. */
  function hasWork(ss, retryErrors) {
    return Clients.list(ss).some(function (r) { return wants_(r, retryErrors); }) ||
      Cases.list(ss).some(function (r) { return wants_(r, retryErrors); });
  }

  /**
   * options.drive: DriveRest-compatible object (tests pass a fake).
   * options.retryErrors: also reprocess ERROR rows (menu action).
   */
  function run(ctx, options) {
    options = options || {};
    const report = { clients: { active: 0, error: 0 }, cases: { active: 0, error: 0, waiting: 0 }, skipped: false, timedOut: false };
    if (!ctx.lock.tryLock(30000)) {
      report.skipped = true;
      return report;
    }
    try {
      const ss = ctx.ss;
      const rootId = String(Settings.get(ss, 'root_folder_id') || '').trim();
      if (!rootId) throw Errors.make('notSetUp', 'Run Portal > Set up first');
      const job = {
        ss: ss, rootId: rootId, drive: options.drive || DriveRest, token: ctx.script.getOAuthToken(),
        retryErrors: !!options.retryErrors, deadline: Date.now() + BUDGET_MS, now: new Date(), report: report,
      };
      const clientsById = provisionClients_(job);
      provisionCases_(job, clientsById);
      return report;
    } finally {
      ctx.lock.releaseLock();
    }
  }

  function provisionClients_(job) {
    const table = Clients.table(job.ss);
    const rows = Clients.list(job.ss);
    assignIds_(table, rows, 'client_id', Config.ID_PREFIX.CLIENT, function (r) { return r.name || r.email; }, job.retryErrors);

    const duplicateIds = duplicates_(rows.map(function (r) { return r.client_id; }));
    const emailOwner = {};
    rows.forEach(function (r) {
      if (!Ids.isValid(r.client_id)) return;
      r.emails.forEach(function (e) { if (!emailOwner[e]) emailOwner[e] = r.client_id; });
    });

    const byId = {};
    rows.forEach(function (r) {
      if (Ids.isValid(r.client_id, Config.ID_PREFIX.CLIENT) && !duplicateIds.has(r.client_id)) byId[r.client_id] = r;
      if (!wants_(r, job.retryErrors) || Date.now() > job.deadline) {
        if (wants_(r, job.retryErrors)) job.report.timedOut = true;
        return;
      }
      const errors = Validate.clientRow(r, { duplicateIds: duplicateIds, emailOwner: emailOwner });
      if (errors.length) return markError_(table, r, errors.join('; '), job.report.clients);
      try {
        ensureFolder_(job, table, r, Sanitize.folderName(r.name, r.client_id), job.rootId);
        const done = { provision_status: Config.PROVISION.ACTIVE, provision_error: '' };
        if (r.activeBlank) {
          done.active = true;  // a new row with the checkbox left empty; an explicit FALSE stays
          r.active = true;
        }
        fillAudit_(job, r, done);
        table.update(r._row, done);
        r.provision_status = Config.PROVISION.ACTIVE;
        job.report.clients.active++;
      } catch (err) {
        markError_(table, r, folderError_(err), job.report.clients);
      }
    });
    return byId;
  }

  function provisionCases_(job, clientsById) {
    const table = Cases.table(job.ss);
    const rows = Cases.list(job.ss);
    assignIds_(table, rows, 'case_id', Config.ID_PREFIX.CASE, function (r) { return r.case_name || r.client_id; }, job.retryErrors);
    const duplicateIds = duplicates_(rows.map(function (r) { return r.case_id; }));

    rows.forEach(function (r) {
      if (!wants_(r, job.retryErrors)) return;
      if (Date.now() > job.deadline) { job.report.timedOut = true; return; }
      if (!r.status) {
        r.status = Config.CASE_STATUS.OPEN;
        table.update(r._row, { status: r.status });
      }
      const errors = Validate.caseRow(r, clientsById, duplicateIds);
      if (errors.length) return markError_(table, r, errors.join('; '), job.report.cases);

      const client = clientsById[r.client_id];
      if (client.provision_status === Config.PROVISION.ERROR) {
        return markError_(table, r, 'client ' + r.client_id + ' has an error', job.report.cases);
      }
      if (client.provision_status !== Config.PROVISION.ACTIVE || !client.folder_id) {
        job.report.cases.waiting++;  // client not provisioned yet: stays PENDING for the next run
        return;
      }
      try {
        ensureFolder_(job, table, r, Sanitize.folderName(r.case_name, r.case_id), client.folder_id);
        const done = { provision_status: Config.PROVISION.ACTIVE, provision_error: '' };
        fillAudit_(job, r, done);
        table.update(r._row, done);
        job.report.cases.active++;
      } catch (err) {
        markError_(table, r, folderError_(err), job.report.cases);
      }
    });
  }

  /** Writes folder_id straight after creating, so a crash can't create a second folder. */
  function ensureFolder_(job, table, row, name, parentId) {
    if (String(row.folder_id || '').trim()) return;
    const folder = job.drive.createFolder(job.token, name, parentId);
    table.update(row._row, { folder_id: folder.id });
    row.folder_id = folder.id;
  }

  function assignIds_(table, rows, column, prefix, hasData, retryErrors) {
    const taken = new Set(rows.map(function (r) { return String(r[column]).trim(); }).filter(String));
    rows.forEach(function (r) {
      if (String(r[column]).trim() || !hasData(r) || !wants_(r, retryErrors)) return;
      const id = Ids.generate(prefix, taken);
      taken.add(id);
      r[column] = id;
      table.update(r._row, { [column]: id });
    });
  }

  function fillAudit_(job, row, update) {
    if (!row.created_at) update.created_at = job.now;
    if (!row.created_by) update.created_by = 'sheet';
  }

  function markError_(table, row, message, counter) {
    table.update(row._row, { provision_status: Config.PROVISION.ERROR, provision_error: message });
    row.provision_status = Config.PROVISION.ERROR;
    counter.error++;
  }

  function folderError_(err) {
    return 'folder: ' + String(err && err.message || err).slice(0, 200);
  }

  function duplicates_(ids) {
    const seen = new Set();
    const dup = new Set();
    ids.forEach(function (id) {
      if (!id) return;
      if (seen.has(id)) dup.add(id);
      seen.add(id);
    });
    return dup;
  }

  return { run: run, hasWork: hasWork };
})();
