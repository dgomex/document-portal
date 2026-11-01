/**
 * The upload flow. The browser never holds a Drive token:
 *   start()  checks the case belongs to the client and is open, checks type
 *            and size, and opens a one-file resumable Drive session in the
 *            case folder. Only the session URI goes to the browser.
 *   (browser PUTs the file in chunks straight to Drive)
 *   finish() re-reads the file from Drive: right folder, size, type, and
 *            first bytes. Anything wrong is trashed and logged; a good file
 *            gets an Uploads row and joins the batch's digest.
 *   finishBatch() / flush() send the lawyer one email per batch.
 */
const Upload = (function () {
  const BATCH = /^[A-Za-z0-9]{8,40}$/;
  const ORIGIN = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/;
  const QUEUE_KEY = 'DIGEST_QUEUE';
  const CLOCK_SKEW_MS = 5 * 60 * 1000;  // Drive's clock vs Apps Script's

  function maxBytes_(ss) {
    const mb = Number(Settings.get(ss, 'max_file_mb')) || 0;
    return Math.min(mb > 0 ? mb * 1048576 : Config.MAX_FILE_BYTES, Config.MAX_FILE_BYTES);
  }

  function caseFor_(ss, client, caseId) {
    const c = Cases.uploadableForClient(ss, client.client_id).filter(function (k) { return k.case_id === caseId; })[0];
    if (!c) throw Errors.make('caseClosed', 'Case not open for this client: ' + caseId);
    return c;
  }

  /** input: { caseId, name, mimeType, size, origin, batchId }. Returns { uploadId, uri, chunkBytes }. */
  function start(ctx, client, input, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const drive = opts.drive || DriveRest;
    const name = Sanitize.fileName(input.name);
    const mime = Config.ALLOWED_MIME.indexOf(input.mimeType) !== -1 ? input.mimeType : FileType.fromName(name);
    const size = Number(input.size);
    if (!BATCH.test(String(input.batchId || ''))) throw Errors.make('invalid', 'Bad batch id');
    if (Config.ALLOWED_MIME.indexOf(mime) === -1) throw Errors.make('fileType', 'Type not allowed: ' + input.mimeType);
    if (!(Number.isInteger(size) && size > 0)) throw Errors.make('invalid', 'Bad size');
    if (size > maxBytes_(ctx.ss)) throw Errors.make('fileSize', 'Too big: ' + size);
    const origin = String(input.origin || '');
    if (!ORIGIN.test(origin)) throw Errors.make('invalid', 'Bad origin: ' + origin.slice(0, 100));
    const c = caseFor_(ctx.ss, client, String(input.caseId || ''));
    if (!RateLimit.take(ctx.cache, [{ key: 'up:' + client.client_id, limit: Config.UPLOAD.PER_CLIENT_PER_HOUR, seconds: 3600 }], now)) {
      throw Errors.make('tooMany', 'Upload rate limit');
    }

    // A checklist item: the file goes to that person's folder, named after the item.
    const token = opts.token || ctx.script.getOAuthToken();
    const item = input.itemId ? itemFor_(ctx.ss, c.case_id, String(input.itemId)) : null;
    const parentId = item && item.person_id ? personFolder_(ctx, c, item.person_id, drive, token) : c.folder_id;
    const label = item ? String(item.title || '').trim() : '';
    const stored = Sanitize.storedName(new Date(now), label ? label + ' - ' + name : name);
    const uri = drive.startResumable(token, {
      name: stored, mimeType: mime, size: size, parentId: parentId, origin: origin,
    });
    const uploadId = Ids.generate(Config.ID_PREFIX.UPLOAD, []);
    ctx.cache.put('up:' + uploadId, JSON.stringify({
      c: client.client_id, k: c.case_id, f: parentId, n: name, s: stored, m: mime, z: size, b: input.batchId,
      i: item ? item.item_id : '', pp: item ? String(item.person_id || '') : '', t: now,
    }), Config.UPLOAD.PENDING_TTL_SECONDS);
    return { uploadId: uploadId, uri: uri, chunkBytes: Config.CHUNK_BYTES };
  }

  /** input: { uploadId, fileId, note }. Returns { uploadId, name }. */
  function finish(ctx, client, input, opts) {
    opts = opts || {};
    const drive = opts.drive || DriveRest;
    const token = opts.token || ctx.script.getOAuthToken();
    const uploadId = String(input.uploadId || '');
    const key = 'up:' + uploadId;
    let p = null;
    try { p = Ids.isValid(uploadId, Config.ID_PREFIX.UPLOAD) ? JSON.parse(ctx.cache.get(key) || 'null') : null; } catch (err) { p = null; }
    if (!p || p.c !== client.client_id) throw Errors.make('invalid', 'Unknown upload ' + uploadId);
    const fileId = String(input.fileId || '');
    if (!/^[\w-]{10,200}$/.test(fileId)) throw Errors.make('invalid', 'Bad file id');

    const meta = drive.get(token, fileId, 'id,name,size,mimeType,md5Checksum,parents,webViewLink,trashed,createdTime');
    const problems = [];
    if ((meta.parents || []).indexOf(p.f) === -1) problems.push('folder');
    // A file from before this upload started isn't this upload's: an earlier
    // file of the client's, for one. Refuse it, and never trash it.
    if (!(Date.parse(meta.createdTime || '') >= p.t - CLOCK_SKEW_MS)) problems.push('older');
    if (Number(meta.size) !== p.z) problems.push('size ' + meta.size + '/' + p.z);
    if (meta.mimeType !== p.m) problems.push('type ' + meta.mimeType);
    if (meta.name !== p.s) problems.push('name');
    if (!problems.length && !FileType.matches(p.m, drive.head(token, fileId, 16))) problems.push('content is not ' + p.m);
    ctx.cache.remove(key);  // one finish per upload
    if (problems.length) {
      // Only trash what this upload created: a new file in the expected folder.
      if (problems.indexOf('folder') === -1 && problems.indexOf('older') === -1) {
        try { drive.trash(token, fileId); } catch (err) { console.error('trash ' + fileId + ': ' + err); }
      }
      Events.log(ctx.ss, 'upload_rejected', '', [client.client_id, p.k, p.n, problems.join(', ')].join(' | '));
      throw Errors.make('badFile', problems.join(', '));
    }

    const c = Cases.byId(ctx.ss, p.k) || {};
    const note = String(input.note || '').replace(/\s+/g, ' ').trim().slice(0, Config.UPLOAD.NOTE_MAX);
    Table.open(ctx.ss, Config.TABS.UPLOADS).append({
      upload_id: uploadId, timestamp: new Date(opts.now || Date.now()), client_id: client.client_id,
      client_name: String(client.name || ''), case_id: p.k, case_name: String(c.case_name || ''),
      stored_name: p.s, original_name: p.n, mime_type: p.m, size_bytes: p.z, md5: meta.md5Checksum || '',
      drive_link: meta.webViewLink || '', uploader_email: client.sessionEmail || client.email || '', note: note, status: 'OK',
      item_id: p.i || '', person_id: p.pp || '',
    });
    if (p.i) markReceived_(ctx.ss, p.i, uploadId, opts.now);
    queue_(ctx, p.b, client.client_id, uploadId, opts.now || Date.now());
    return { uploadId: uploadId, name: p.n, itemId: p.i || '' };
  }

  /** The client's own checklist item in this case (not waived), or throws. */
  function itemFor_(ss, caseId, itemId) {
    const item = Ids.isValid(itemId, Config.ID_PREFIX.ITEM) && CaseChecklist.items(ss).filter(function (r) {
      return r.item_id === itemId && r.case_id === caseId && r.level !== Config.ITEM_LEVEL.WAIVED;
    })[0];
    if (!item) throw Errors.make('invalid', 'Unknown checklist item ' + itemId);
    return item;
  }

  /** The person's folder inside the case folder, created on their first upload. */
  function personFolder_(ctx, theCase, personId, drive, token) {
    const find = function () {
      return CaseChecklist.people(ctx.ss).filter(function (p) { return p.person_id === personId && p.case_id === theCase.case_id; })[0];
    };
    let person = find();
    if (!person) return theCase.folder_id;
    if (String(person.folder_id || '').trim()) return String(person.folder_id).trim();
    // Under the auth lock, so two uploads for the same person can't create two folders.
    if (!ctx.authLock.tryLock(10000)) return theCase.folder_id;
    try {
      person = find();
      if (String(person.folder_id || '').trim()) return String(person.folder_id).trim();
      const folder = drive.createFolder(token, Sanitize.folderName(person.name, person.person_id), theCase.folder_id);
      Table.open(ctx.ss, Config.TABS.PEOPLE).update(person._row, { folder_id: folder.id });
      return folder.id;
    } finally {
      ctx.authLock.releaseLock();
    }
  }

  /** A new file for an item means the lawyer has something to check again. */
  function markReceived_(ss, itemId, uploadId, nowMs) {
    const row = CaseChecklist.items(ss).filter(function (r) { return r.item_id === itemId; })[0];
    if (!row) return;
    const ids = String(row.upload_ids || '').split(/[\s;,]+/).filter(String).concat(uploadId);
    Table.open(ss, Config.TABS.CHECKLIST).update(row._row, {
      status: Config.ITEM_STATUS.RECEIVED, reason: '', upload_ids: ids.join(';'), updated_at: new Date(nowMs || Date.now()),
    });
  }

  // ---------- abandoned uploads ----------

  /**
   * Daily: trashes files in open cases' folders that never finished an upload
   * (started, then abandoned, so never checked). The portal only sees files it
   * created itself (drive.file), so the lawyer's own files are never touched.
   * A file stays if Uploads knows it (by Drive ID or stored name) or if it's
   * younger than a started upload may live. Returns { folders, trashed }.
   */
  function sweep(ctx, opts) {
    opts = opts || {};
    const drive = opts.drive || DriveRest;
    const token = opts.token || ctx.script.getOAuthToken();
    const now = opts.now || Date.now();
    const deadline = Date.now() + 2 * 60 * 1000;  // shares the 10-minute job with reminders
    const cutoff = now - Config.UPLOAD.PENDING_TTL_SECONDS * 1000 - CLOCK_SKEW_MS;
    const report = { folders: 0, trashed: 0 };
    const known = new Set();
    Table.open(ctx.ss, Config.TABS.UPLOADS).rows().forEach(function (r) {
      const m = /\/d\/([\w-]+)/.exec(String(r.drive_link || ''));
      if (m) known.add(m[1]);
      if (String(r.stored_name || '')) known.add('name:' + String(r.stored_name));
    });
    const open = Cases.list(ctx.ss).filter(function (c) {
      return c.status === Config.CASE_STATUS.OPEN && String(c.folder_id || '').trim();
    });
    const caseIds = new Set(open.map(function (c) { return c.case_id; }));
    const folders = open.map(function (c) { return { id: String(c.folder_id).trim(), caseId: c.case_id }; });
    if (ctx.ss.getSheetByName(Config.TABS.PEOPLE)) {
      CaseChecklist.people(ctx.ss).forEach(function (p) {
        if (caseIds.has(p.case_id) && String(p.folder_id || '').trim()) folders.push({ id: String(p.folder_id).trim(), caseId: p.case_id });
      });
    }
    folders.forEach(function (f) {
      if (Date.now() > deadline) return;
      let files;
      try { files = drive.listFiles(token, f.id); } catch (err) { return console.error('sweep ' + f.id + ': ' + err); }
      report.folders++;
      files.forEach(function (file) {
        if (known.has(file.id) || known.has('name:' + file.name)) return;
        if (!(Date.parse(file.createdTime || '') < cutoff)) return;
        try {
          drive.trash(token, file.id);
          report.trashed++;
          Events.log(ctx.ss, 'upload_abandoned_trashed', '', f.caseId + ' | ' + String(file.name).slice(0, 120));
        } catch (err) {
          console.error('sweep trash ' + file.id + ': ' + err);
        }
      });
    });
    return report;
  }

  // ---------- digest ----------

  /** Queue in Properties (the cache may drop entries): { batchId: { c, ids, last } }. */
  function readQueue_(ctx) {
    try { return JSON.parse(ctx.props.getProperty(QUEUE_KEY) || '{}'); } catch (err) { return {}; }
  }

  function withQueue_(ctx, fn) {
    if (!ctx.authLock.tryLock(10000)) throw Errors.make('generic', 'queue lock busy');
    try {
      const q = readQueue_(ctx);
      const out = fn(q);
      ctx.props.setProperty(QUEUE_KEY, JSON.stringify(q));
      return out;
    } finally {
      ctx.authLock.releaseLock();
    }
  }

  function queue_(ctx, batchId, clientId, uploadId, now) {
    withQueue_(ctx, function (q) {
      const b = q[batchId] || (q[batchId] = { c: clientId, ids: [], last: now });
      if (b.c !== clientId) throw Errors.make('invalid', 'Batch belongs to another client');
      b.ids.push(uploadId);
      b.last = now;
    });
  }

  /** The client pressed "done": mail this batch now. */
  function finishBatch(ctx, client, batchId, opts) {
    if (!BATCH.test(String(batchId || ''))) throw Errors.make('invalid', 'Bad batch id');
    const batch = withQueue_(ctx, function (q) {
      const b = q[batchId];
      if (!b || b.c !== client.client_id) return null;
      delete q[batchId];
      return b;
    });
    if (!batch) return { notified: 0 };
    try {
      return { notified: send_(ctx, batch, opts || {}) };
    } catch (err) {
      // The files are safe in Drive; the trigger retries the email.
      console.error('digest: ' + err);
      requeue_(ctx, batch);
      return { notified: 0 };
    }
  }

  function requeue_(ctx, batch) {
    batch.tries = (batch.tries || 0) + 1;
    if (batch.tries > 5) return Events.log(ctx.ss, 'digest_failed', '', batch.c + ' | ' + batch.ids.join(','));
    withQueue_(ctx, function (q) { q['retry' + Crypto.randomToken(8)] = batch; });
  }

  /** Trigger: mail batches idle for DIGEST_IDLE_MINUTES (the client closed the page). */
  function flush(ctx, opts) {
    opts = opts || {};
    const cutoff = (opts.now || Date.now()) - Config.UPLOAD.DIGEST_IDLE_MINUTES * 60000;
    const due = withQueue_(ctx, function (q) {
      return Object.keys(q).filter(function (k) { return q[k].last <= cutoff; }).map(function (k) {
        const b = q[k];
        delete q[k];
        return b;
      });
    });
    let sent = 0;
    due.forEach(function (b) {
      try {
        sent += send_(ctx, b, opts);
      } catch (err) {
        console.error('digest: ' + err);
        requeue_(ctx, b);  // try again next run
      }
    });
    return { batches: due.length, emails: sent };
  }

  /** One email per recipient (case responsible, else the firm address). Returns emails sent. */
  function send_(ctx, batch, opts) {
    const settings = Settings.read(ctx.ss);
    const ids = new Set(batch.ids);
    const rows = Table.open(ctx.ss, Config.TABS.UPLOADS).rows().filter(function (r) { return ids.has(String(r.upload_id)); });
    if (!rows.length) return 0;
    // Name each file after its checklist item, so the lawyer sees what it is for.
    if (ctx.ss.getSheetByName(Config.TABS.CHECKLIST)) {
      const itemsById = {};
      CaseChecklist.items(ctx.ss).forEach(function (i) { itemsById[i.item_id] = i; });
      rows.forEach(function (r) {
        const i = itemsById[String(r.item_id || '')];
        if (i) r.label = String(i.title || '') + (i.person_name ? ' (' + i.person_name + ')' : '');
      });
    }
    const fallback = Validate.normalizeEmail(settings.notification_email);
    const groups = {};
    rows.forEach(function (r) {
      const c = Cases.byId(ctx.ss, String(r.case_id)) || {};
      const to = Validate.isEmail(c.responsible_email) ? Validate.normalizeEmail(c.responsible_email) : fallback;
      if (!Validate.isEmail(to)) return;
      (groups[to] = groups[to] || { to: to, folderId: c.folder_id, rows: [] }).rows.push(r);
    });
    const lang = I18n.lang(String(settings.default_language || ''));
    let sent = 0;
    Object.keys(groups).forEach(function (to) {
      if (!MailBudget.take(ctx, 'digest', opts.now)) {
        Events.log(ctx.ss, 'digest_daily_cap', '', batch.c);
        return;
      }
      const msg = digestMessage(lang, groups[to]);
      (opts.mail || GmailRest).send(opts.token || ctx.script.getOAuthToken(), {
        to: to, from: Validate.normalizeEmail(settings.send_as_alias) || '', fromName: String(settings.firm_name || ''),
        subject: msg.subject, text: msg.text, html: msg.html,
      });
      sent++;
    });
    return sent;
  }

  function size_(bytes) {
    const n = Number(bytes) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  /** Pure: the lawyer's email for one group of uploads. */
  function digestMessage(lang, group) {
    const rows = group.rows;
    const first = rows[0];
    const p = { client: String(first.client_name || first.client_id), caseName: String(first.case_name || first.case_id), count: rows.length };
    const esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
    const folder = group.folderId ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(group.folderId) : '';
    const notes = rows.map(function (r) { return String(r.note || ''); }).filter(function (n, i, all) { return n && all.indexOf(n) === i; });
    const intro = I18n.t(lang, 'mail.digest.intro', p);
    const text = [intro, ''].concat(rows.map(function (r) {
      return '- ' + (r.label ? r.label + ': ' : '') + r.original_name + ' (' + size_(r.size_bytes) + ')' + (r.drive_link ? ': ' + r.drive_link : '');
    }), notes.length ? ['', I18n.t(lang, 'mail.digest.note') + ' ' + notes.join(' / ')] : [],
    folder ? ['', I18n.t(lang, 'mail.digest.folder') + ' ' + folder] : []).join('\n');
    const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1d2433">' +
      '<p>' + esc(intro) + '</p><ul>' + rows.map(function (r) {
        const label = (r.label ? '<b>' + esc(r.label) + ':</b> ' : '') + esc(r.original_name) +
          ' <span style="color:#5b6475">(' + esc(size_(r.size_bytes)) + ')</span>';
        return '<li>' + (r.drive_link ? '<a href="' + esc(r.drive_link) + '">' + label + '</a>' : label) + '</li>';
      }).join('') + '</ul>' +
      (notes.length ? '<p><b>' + esc(I18n.t(lang, 'mail.digest.note')) + '</b> ' + esc(notes.join(' / ')) + '</p>' : '') +
      (folder ? '<p><a href="' + esc(folder) + '">' + esc(I18n.t(lang, 'mail.digest.openFolder')) + '</a></p>' : '') +
      '</div>';
    return { subject: I18n.t(lang, 'mail.digest.subject', p), text: text, html: html };
  }

  return { start: start, finish: finish, finishBatch: finishBatch, flush: flush, sweep: sweep, digestMessage: digestMessage };
})();
