const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));

class FakeCache {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  put(k, v) { this.m.set(k, String(v)); }
  remove(k) { this.m.delete(k); }
  removeAll(ks) { ks.forEach((k) => this.m.delete(k)); }
}
class FakeProps {
  constructor() { this.m = {}; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
}
const lock = () => ({ tryLock: () => true, releaseLock() {} });

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0, 0, 0, 0, 0];
const EXE = [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0];
const HEIC = [0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0];
const ORIGIN = 'https://n-abc123-0lu-script.googleusercontent.com';

function setup({ settings = {} } = {}) {
  const ss = new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['firm_name', 'Silva & Costa', ''], ['default_language', 'pt', ''],
      ['notification_email', 'geral@firma.pt', ''], ['max_file_mb', settings.max_file_mb || '100', '']],
    Clients: [Config.SCHEMA.Clients,
      row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', active: true }),
      row(Config.SCHEMA.Clients, { client_id: 'CL-BBBBBB', name: 'Bruno', email: 'bruno@x.pt', active: true }),
    ],
    Cases: [Config.SCHEMA.Cases,
      row(Config.SCHEMA.Cases, { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Divórcio', status: 'open', folder_id: 'F-DIV' }),
      row(Config.SCHEMA.Cases, { case_id: 'CS-222222', client_id: 'CL-AAAAAA', case_name: 'Herança', status: 'open', folder_id: 'F-HER',
        responsible_email: 'joana@firma.pt' }),
      row(Config.SCHEMA.Cases, { case_id: 'CS-333333', client_id: 'CL-AAAAAA', case_name: 'Antigo', status: 'closed', folder_id: 'F-OLD' }),
      row(Config.SCHEMA.Cases, { case_id: 'CS-444444', client_id: 'CL-AAAAAA', case_name: 'Novo', status: 'open' }),  // no folder yet
      row(Config.SCHEMA.Cases, { case_id: 'CS-555555', client_id: 'CL-BBBBBB', case_name: 'Arrendamento', status: 'open', folder_id: 'F-ARR' }),
    ],
    Uploads: [Config.SCHEMA.Uploads],
    Events: [Config.SCHEMA.Events],
  });
  const ctx = { ss, cache: new FakeCache(), props: new FakeProps(), lock: lock(), authLock: lock(), script: { getOAuthToken: () => 'T' } };
  const files = {};    // fileId -> { meta, head }
  const trashed = [];
  const started = [];
  const drive = {
    startResumable: (token, f) => { started.push(f); return 'https://upload.example/session/' + started.length; },
    get: (token, id) => files[id].meta,
    head: (token, id) => files[id].head,
    trash: (token, id) => trashed.push(id),
  };
  const sent = [];
  const mail = { send: (token, m) => sent.push(m) };
  let now = Date.UTC(2026, 9, 30, 14, 5);
  const ana = () => ({ ...lib.Clients.byId(ss, 'CL-AAAAAA'), sessionEmail: 'ana@x.pt' });
  const opts = (extra) => ({ now, drive, mail, token: 'T', ...extra });

  /** Starts an upload, then pretends the browser put this file into Drive. */
  function upload(input, fileOverride = {}, head = PDF) {
    const s = lib.Upload.start(ctx, ana(), { caseId: 'CS-111111', name: 'contrato.pdf', mimeType: 'application/pdf', size: 1000,
      origin: ORIGIN, batchId: 'batch0001', ...input }, opts());
    const f = started.at(-1);
    const id = 'file' + started.length + 'xxxxxxxx';
    files[id] = { meta: { id, name: f.name, size: String(f.size), mimeType: f.mimeType, parents: [f.parentId],
      md5Checksum: 'md5', webViewLink: 'https://drive.google.com/file/d/' + id, ...fileOverride }, head };
    return { start: s, fileId: id };
  }
  const uploads = () => lib.Table.open(ss, 'Uploads').rows();
  const events = () => ss.getSheetByName('Events').data.slice(1).map((r) => r[1]);
  return { ss, ctx, drive, mail, sent, started, trashed, ana, opts, upload, uploads, events, tick: (min) => { now += min * 60000; } };
}

describe('Upload.start', () => {
  test('opens a Drive session in the case folder with a dated, clean name', () => {
    const s = setup();
    const { start } = s.upload({ name: '../fatura:março.pdf' });
    expect(start).toMatchObject({ uri: 'https://upload.example/session/1', chunkBytes: Config.CHUNK_BYTES });
    expect(start.uploadId).toMatch(/^UP-/);
    expect(s.started[0]).toMatchObject({ parentId: 'F-DIV', mimeType: 'application/pdf', size: 1000, origin: ORIGIN,
      name: '2026-10-30_1405__fatura_março.pdf' });
  });

  test.each([
    ['another client\'s case', { caseId: 'CS-555555' }, 'caseClosed'],
    ['a closed case', { caseId: 'CS-333333' }, 'caseClosed'],
    ['a case without a folder yet', { caseId: 'CS-444444' }, 'caseClosed'],
    ['an unknown case', { caseId: 'CS-ZZZZZZ' }, 'caseClosed'],
    ['a Word file', { name: 'a.docx', mimeType: 'application/msword' }, 'fileType'],
    ['an empty file', { size: 0 }, 'invalid'],
    ['a file over 100 MB', { size: 100 * 1048576 + 1 }, 'fileSize'],
    ['a foreign origin', { origin: 'https://evil.example' }, 'invalid'],
    ['a bad batch id', { batchId: 'x' }, 'invalid'],
  ])('refuses %s', (_, input, code) => {
    const s = setup();
    expect(() => s.upload(input)).toThrow(expect.objectContaining({ code }));
    expect(s.started).toEqual([]);
  });

  test('respects a lower max_file_mb setting', () => {
    const s = setup({ settings: { max_file_mb: '10' } });
    expect(() => s.upload({ size: 10 * 1048576 + 1 })).toThrow(expect.objectContaining({ code: 'fileSize' }));
  });

  test('a .heic with no type from the browser is accepted as HEIC', () => {
    const s = setup();
    s.upload({ name: 'IMG_0001.HEIC', mimeType: '' });
    expect(s.started[0].mimeType).toBe('image/heic');
  });
});

describe('Upload.finish', () => {
  test('a good file is logged once with who sent it', () => {
    const s = setup();
    const { start, fileId } = s.upload({}, {});
    const out = lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId, note: ' fatura  de março ' }, s.opts());
    expect(out).toEqual({ uploadId: start.uploadId, name: 'contrato.pdf' });
    expect(s.uploads()).toHaveLength(1);
    expect(s.uploads()[0]).toMatchObject({ upload_id: start.uploadId, client_id: 'CL-AAAAAA', client_name: 'Ana', case_id: 'CS-111111',
      case_name: 'Divórcio', original_name: 'contrato.pdf', mime_type: 'application/pdf', size_bytes: 1000, md5: 'md5',
      uploader_email: 'ana@x.pt', note: 'fatura de março', status: 'OK' });
    expect(() => lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts()))
      .toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('an .exe renamed to .pdf is trashed and logged', () => {
    const s = setup();
    const { start, fileId } = s.upload({}, {}, EXE);
    expect(() => lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts()))
      .toThrow(expect.objectContaining({ code: 'badFile' }));
    expect(s.trashed).toEqual([fileId]);
    expect(s.uploads()).toEqual([]);
    expect(s.events()).toEqual(['upload_rejected']);
  });

  test('a real HEIC passes the content check', () => {
    const s = setup();
    const { start, fileId } = s.upload({ name: 'foto.heic', mimeType: 'image/heic' }, {}, HEIC);
    expect(lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts()).name).toBe('foto.heic');
  });

  test('a size different from what was announced is refused', () => {
    const s = setup();
    const { start, fileId } = s.upload({}, { size: '999' });
    expect(() => lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts()))
      .toThrow(expect.objectContaining({ code: 'badFile' }));
    expect(s.trashed).toEqual([fileId]);
  });

  test('a file outside the case folder is refused but never trashed (it is not ours)', () => {
    const s = setup();
    const { start, fileId } = s.upload({}, { parents: ['SOMEONE-ELSES'] });
    expect(() => lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts()))
      .toThrow(expect.objectContaining({ code: 'badFile' }));
    expect(s.trashed).toEqual([]);
  });

  test('another client cannot finish Ana\'s upload', () => {
    const s = setup();
    const { start, fileId } = s.upload({});
    const bruno = lib.Clients.byId(s.ss, 'CL-BBBBBB');
    expect(() => lib.Upload.finish(s.ctx, bruno, { uploadId: start.uploadId, fileId }, s.opts()))
      .toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(s.uploads()).toEqual([]);
  });

  test('formula-like file names are neutralised in the log', () => {
    const s = setup();
    const { start, fileId } = s.upload({ name: '=HYPERLINK("x").pdf' });
    lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId }, s.opts());
    expect(s.uploads()[0].original_name).toBe('\'=HYPERLINK(_x_).pdf');
  });
});

describe('digest', () => {
  function finishAll(s, inputs) {
    inputs.forEach((input) => {
      const { start, fileId } = s.upload(input);
      lib.Upload.finish(s.ctx, s.ana(), { uploadId: start.uploadId, fileId, note: input.note }, s.opts());
    });
  }

  test('one email per batch, to the firm address, listing every file', () => {
    const s = setup();
    finishAll(s, [{ name: 'a.pdf', note: 'Faturas' }, { name: 'b.pdf' }, { name: 'c.pdf' }]);
    expect(s.sent).toEqual([]);
    expect(lib.Upload.finishBatch(s.ctx, s.ana(), 'batch0001', s.opts())).toEqual({ notified: 1 });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ to: 'geral@firma.pt', fromName: 'Silva & Costa', subject: 'Novos documentos: Ana – Divórcio (3)' });
    ['a.pdf', 'b.pdf', 'c.pdf', 'Faturas', 'drive.google.com/drive/folders/F-DIV'].forEach((x) => expect(s.sent[0].text).toContain(x));
    expect(lib.Upload.finishBatch(s.ctx, s.ana(), 'batch0001', s.opts())).toEqual({ notified: 0 });
  });

  test('the case\'s responsible lawyer gets it instead of the firm address', () => {
    const s = setup();
    finishAll(s, [{ caseId: 'CS-222222' }]);
    lib.Upload.finishBatch(s.ctx, s.ana(), 'batch0001', s.opts());
    expect(s.sent.map((m) => m.to)).toEqual(['joana@firma.pt']);
  });

  test('another client cannot flush Ana\'s batch', () => {
    const s = setup();
    finishAll(s, [{}]);
    expect(lib.Upload.finishBatch(s.ctx, lib.Clients.byId(s.ss, 'CL-BBBBBB'), 'batch0001', s.opts())).toEqual({ notified: 0 });
    expect(s.sent).toEqual([]);
  });

  test('the trigger mails batches idle for 10 minutes, not fresh ones', () => {
    const s = setup();
    finishAll(s, [{}]);
    expect(lib.Upload.flush(s.ctx, s.opts())).toEqual({ batches: 0, emails: 0 });
    s.tick(Config.UPLOAD.DIGEST_IDLE_MINUTES);
    expect(lib.Upload.flush(s.ctx, s.opts())).toEqual({ batches: 1, emails: 1 });
    expect(lib.Upload.flush(s.ctx, s.opts())).toEqual({ batches: 0, emails: 0 });
  });

  test('a failed digest email does not fail the client; it is retried', () => {
    const s = setup();
    finishAll(s, [{}]);
    const broken = s.opts({ mail: { send: () => { throw new Error('quota'); } } });
    expect(lib.Upload.finishBatch(s.ctx, s.ana(), 'batch0001', broken)).toEqual({ notified: 0 });
    s.tick(Config.UPLOAD.DIGEST_IDLE_MINUTES);
    expect(lib.Upload.flush(s.ctx, s.opts()).emails).toBe(1);
  });

  test('the client name in the email is escaped in HTML', () => {
    const html = lib.Upload.digestMessage('pt', { folderId: 'F', rows: [{ client_name: '<b>x</b>', case_name: 'c', original_name: '<i>.pdf', size_bytes: 10 }] }).html;
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>.pdf');
  });
});

describe('FileType', () => {
  test.each([
    ['application/pdf', PDF, true],
    ['application/pdf', EXE, false],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0], true],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], true],
    ['image/png', [0x89, 0x50, 0x4e, 0x47], false],
    ['image/heic', HEIC, true],
    ['image/heif', [0, 0, 0, 0x18, ...Buffer.from('ftypmif1')], true],
    ['image/heic', [0, 0, 0, 0x18, ...Buffer.from('ftypisom')], false],  // an MP4
    ['text/html', PDF, false],
  ])('%s matches: %s', (mime, bytes, ok) => {
    const signed = bytes.map((b) => (b > 127 ? b - 256 : b));
    expect(lib.FileType.matches(mime, signed)).toBe(ok);
  });
});
