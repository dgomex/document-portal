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

    const stored = Sanitize.storedName(new Date(now), name);
    const uri = drive.startResumable(opts.token || ctx.script.getOAuthToken(), {
      name: stored, mimeType: mime, size: size, parentId: c.folder_id, origin: origin,
    });
    const uploadId = Ids.generate(Config.ID_PREFIX.UPLOAD, []);
    ctx.cache.put('up:' + uploadId, JSON.stringify({
      c: client.client_id, k: c.case_id, f: c.folder_id, n: name, s: stored, m: mime, z: size, b: input.batchId,
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

    const meta = drive.get(token, fileId, 'id,name,size,mimeType,md5Checksum,parents,webViewLink,trashed');
    const problems = [];
    if ((meta.parents || []).indexOf(p.f) === -1) problems.push('folder');
    if (Number(meta.size) !== p.z) problems.push('size ' + meta.size + '/' + p.z);
    if (meta.mimeType !== p.m) problems.push('type ' + meta.mimeType);
    if (meta.name !== p.s) problems.push('name');
    if (!problems.length && !FileType.matches(p.m, drive.head(token, fileId, 16))) problems.push('content is not ' + p.m);
    ctx.cache.remove(key);  // one finish per upload
    if (problems.length) {
      // Only trash what this upload created: a file in the expected folder.
      if (problems.indexOf('folder') === -1) {
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
    });
    queue_(ctx, p.b, client.client_id, uploadId, opts.now || Date.now());
    return { uploadId: uploadId, name: p.n };
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
    const fallback = Validate.normalizeEmail(settings.notification_email);
    const groups = {};
    rows.forEach(function (r) {
      const c = Cases.byId(ctx.ss, String(r.case_id)) || {};
      const to = Validate.isEmail(c.responsible_email) ? Validate.normalizeEmail(c.responsible_email) : fallback;
      if (!Validate.isEmail(to)) return;
      (groups[to] = groups[to] || { to: to, folderId: c.folder_id, rows: [] }).rows.push(r);
    });
    const day = Utilities.formatDate(new Date(opts.now || Date.now()), Config.TIME_ZONE, 'yyyy-MM-dd');
    const lang = I18n.lang(String(settings.default_language || ''));
    let sent = 0;
    Object.keys(groups).forEach(function (to) {
      if (!RateLimit.takeDaily(ctx.props, 'DIGEST_DAILY', Config.UPLOAD.DIGEST_DAILY_CAP, day)) {
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
      return '- ' + r.original_name + ' (' + size_(r.size_bytes) + ')' + (r.drive_link ? ': ' + r.drive_link : '');
    }), notes.length ? ['', I18n.t(lang, 'mail.digest.note') + ' ' + notes.join(' / ')] : [],
    folder ? ['', I18n.t(lang, 'mail.digest.folder') + ' ' + folder] : []).join('\n');
    const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1d2433">' +
      '<p>' + esc(intro) + '</p><ul>' + rows.map(function (r) {
        const label = esc(r.original_name) + ' <span style="color:#5b6475">(' + esc(size_(r.size_bytes)) + ')</span>';
        return '<li>' + (r.drive_link ? '<a href="' + esc(r.drive_link) + '">' + label + '</a>' : label) + '</li>';
      }).join('') + '</ul>' +
      (notes.length ? '<p><b>' + esc(I18n.t(lang, 'mail.digest.note')) + '</b> ' + esc(notes.join(' / ')) + '</p>' : '') +
      (folder ? '<p><a href="' + esc(folder) + '">' + esc(I18n.t(lang, 'mail.digest.openFolder')) + '</a></p>' : '') +
      '</div>';
    return { subject: I18n.t(lang, 'mail.digest.subject', p), text: text, html: html };
  }

  return { start: start, finish: finish, finishBatch: finishBatch, flush: flush, digestMessage: digestMessage };
})();
