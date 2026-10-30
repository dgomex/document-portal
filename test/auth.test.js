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
  constructor(init = {}) { this.m = { ...init }; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
}
const lock = () => ({ calls: 0, tryLock() { this.calls++; return true; }, releaseLock() {} });

function firm() {
  return new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['firm_name', 'Silva & Costa', ''], ['default_language', 'pt', ''], ['send_as_alias', '', '']],
    Clients: [Config.SCHEMA.Clients,
      row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', additional_emails: 'ana2@x.pt', language: 'pt', active: true }),
      row(Config.SCHEMA.Clients, { client_id: 'CL-CCCCCC', name: 'Carla', email: 'carla@x.pt', language: 'en', active: true }),
      row(Config.SCHEMA.Clients, { client_id: 'CL-DDDDDD', name: 'Diogo', email: 'diogo@x.pt', active: false }),
    ],
    Cases: [Config.SCHEMA.Cases,
      row(Config.SCHEMA.Cases, { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Divórcio', status: 'open', folder_id: 'F-DIV' }),
      row(Config.SCHEMA.Cases, { case_id: 'CS-222222', client_id: 'CL-AAAAAA', case_name: 'Antigo', status: 'closed' }),
    ],
    Events: [Config.SCHEMA.Events],
  });
}

function setup() {
  const ss = firm();
  const ctx = { ss, cache: new FakeCache(), props: new FakeProps({ OTP_SALT: 'salt' }), lock: lock(), authLock: lock(),
    script: { getOAuthToken: () => 'TOKEN' } };
  const sent = [];
  const mail = { send: (token, m) => sent.push({ token, ...m }) };
  let now = Date.UTC(2026, 9, 30, 10, 0, 0);
  const opts = (extra) => ({ now, mail, sleep: () => {}, ...extra });
  const events = () => ss.getSheetByName('Events').data.slice(1).map((r) => r[1]);
  const codeOf = (i = -1) => sent.at(i).subject.match(/^(\d{6})/)[1];
  return { ss, ctx, sent, opts, events, codeOf, tick: (s) => { now += s * 1000; } };
}

describe('Otp.request', () => {
  test('sends a 6-digit code to an active client, in their language, and stores only a hash', () => {
    const s = setup();
    lib.Otp.request(s.ctx, { email: ' ANA@x.pt ' }, s.opts());
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ token: 'TOKEN', to: 'ana@x.pt', fromName: 'Silva & Costa' });
    const code = s.codeOf();
    expect(s.sent[0].text).toContain(code);
    expect(s.sent[0].text).toContain('10 minutos');
    expect([...s.ctx.cache.m.values()].join(' ')).not.toContain(code);
    expect(s.events()).toEqual(['otp_sent']);
  });

  test('additional emails can log in; English clients get English mail', () => {
    const s = setup();
    lib.Otp.request(s.ctx, { email: 'ana2@x.pt' }, s.opts());
    lib.Otp.request(s.ctx, { email: 'carla@x.pt' }, s.opts());
    expect(s.sent.map((m) => m.to)).toEqual(['ana2@x.pt', 'carla@x.pt']);
    expect(s.sent[1].subject).toContain('is your access code');
  });

  test('unknown and inactive emails: no mail, same answer, same padded time', () => {
    const s = setup();
    const waits = [];
    [ 'nobody@x.pt', 'diogo@x.pt', 'ana@x.pt' ].forEach((email) => {
      expect(lib.Otp.request(s.ctx, { email }, s.opts({ sleep: (ms) => waits.push(ms) }))).toBeUndefined();
    });
    expect(s.sent.map((m) => m.to)).toEqual(['ana@x.pt']);
    expect(waits).toHaveLength(3);
    waits.forEach((ms) => expect(ms).toBeGreaterThan(Config.OTP.RESPONSE_MS - 500));
    expect(s.events()).toEqual(['otp_unknown', 'otp_unknown', 'otp_sent']);
  });

  test('pads the response time even when something throws', () => {
    const s = setup();
    const waits = [];
    expect(() => lib.Otp.request(s.ctx, { email: 'not-an-email' }, s.opts({ sleep: (ms) => waits.push(ms) }))).toThrow();
    expect(waits).toHaveLength(1);
  });

  test('one code a minute and five an hour per email', () => {
    const s = setup();
    lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts());
    lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts());
    expect(s.sent).toHaveLength(1);
    for (let i = 0; i < 6; i++) { s.tick(61); lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts()); }
    expect(s.sent.length).toBe(Config.OTP.PER_EMAIL_PER_HOUR);
    expect(s.events()).toContain('otp_rate_limited');
  });

  test('daily cap stops code emails', () => {
    const s = setup();
    s.ctx.props.setProperty('MAIL_DAILY', JSON.stringify({ day: '2026-10-30', n: Config.MAIL.DEFAULT_LIMIT }));
    lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts());
    expect(s.sent).toHaveLength(0);
    expect(s.events()).toEqual(['otp_daily_cap']);
  });

  test('honeypot filled: nothing sent', () => {
    const s = setup();
    lib.Otp.request(s.ctx, { email: 'ana@x.pt', website: 'http://spam' }, s.opts());
    expect(s.sent).toHaveLength(0);
    expect(s.events()).toEqual(['otp_honeypot']);
  });

  test('a failed send is logged, not shown', () => {
    const s = setup();
    const opts = s.opts({ mail: { send: () => { throw new Error('quota'); } } });
    expect(() => lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, opts)).not.toThrow();
    expect(s.events()).toEqual(['otp_send_failed']);
  });

  test('refuses to run before setup made the salt', () => {
    const s = setup();
    s.ctx.props = new FakeProps();
    expect(() => lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts())).toThrow(expect.objectContaining({ code: 'notSetUp' }));
  });
});

describe('Otp.verify', () => {
  const sendTo = (s, email = 'ana@x.pt') => { lib.Otp.request(s.ctx, { email }, s.opts()); return s.codeOf(); };

  test('right code gives a session, once', () => {
    const s = setup();
    const code = sendTo(s);
    const out = lib.Otp.verify(s.ctx, { email: 'Ana@X.pt', code: code.slice(0, 3) + ' ' + code.slice(3) }, s.opts());
    expect(out.token).toMatch(/^[0-9a-f]{64}$/);
    expect(out.clientId).toBe('CL-AAAAAA');
    expect(() => lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts())).toThrow(expect.objectContaining({ code: 'badCode' }));
  });

  test('expired code is refused', () => {
    const s = setup();
    const code = sendTo(s);
    s.tick(Config.OTP.TTL_SECONDS + 1);
    expect(() => lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts())).toThrow(expect.objectContaining({ code: 'badCode' }));
  });

  test('five wrong tries kill the code, and the right one no longer works', () => {
    const s = setup();
    const code = sendTo(s);
    const wrong = code === '000000' ? '111111' : '000000';
    const codes = [];
    for (let i = 0; i < 5; i++) {
      try { lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code: wrong }, s.opts()); } catch (e) { codes.push(e.code); }
    }
    expect(codes).toEqual(['badCode', 'badCode', 'badCode', 'badCode', 'tooMany']);
    expect(() => lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts())).toThrow(expect.objectContaining({ code: 'tooMany' }));
  });

  test('unknown emails lock out after five tries too, so lockout reveals nothing', () => {
    const s = setup();
    const codes = [];
    for (let i = 0; i < 6; i++) {
      try { lib.Otp.verify(s.ctx, { email: 'nobody@x.pt', code: '123456' }, s.opts()); } catch (e) { codes.push(e.code); }
    }
    expect(codes).toEqual(['badCode', 'badCode', 'badCode', 'badCode', 'tooMany', 'tooMany']);
  });

  test('a new code request gives five fresh tries', () => {
    const s = setup();
    sendTo(s);
    for (let i = 0; i < 5; i++) { try { lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code: '000000' }, s.opts()); } catch (e) { /* counted */ } }
    s.tick(61);
    const code = sendTo(s);
    expect(lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts()).clientId).toBe('CL-AAAAAA');
  });

  test('a code for one email does not work for another', () => {
    const s = setup();
    const code = sendTo(s);
    expect(() => lib.Otp.verify(s.ctx, { email: 'carla@x.pt', code }, s.opts())).toThrow(expect.objectContaining({ code: 'badCode' }));
  });

  test('client deactivated after the code was sent: refused', () => {
    const s = setup();
    const code = sendTo(s);
    const t = lib.Clients.table(s.ss);
    t.update(2, { active: false });
    expect(() => lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts())).toThrow(expect.objectContaining({ code: 'badCode' }));
    expect(s.events()).toContain('verify_revoked');
  });

  test('malformed codes never touch the counter', () => {
    const s = setup();
    for (let i = 0; i < 10; i++) {
      expect(() => lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code: 'abc' }, s.opts())).toThrow(expect.objectContaining({ code: 'badCode' }));
    }
    const code = sendTo(s);
    expect(lib.Otp.verify(s.ctx, { email: 'ana@x.pt', code }, s.opts()).clientId).toBe('CL-AAAAAA');
  });
});

describe('Sessions', () => {
  test('resolves to the client, slides, ends on logout', () => {
    const s = setup();
    const token = lib.Sessions.create(s.ctx, 'CL-AAAAAA');
    expect(lib.Sessions.resolve(s.ctx, token).name).toBe('Ana');
    lib.Sessions.end(s.ctx, token);
    expect(() => lib.Sessions.resolve(s.ctx, token)).toThrow(expect.objectContaining({ code: 'session' }));
  });

  test('the cache holds a hash, not the token', () => {
    const s = setup();
    const token = lib.Sessions.create(s.ctx, 'CL-AAAAAA');
    expect([...s.ctx.cache.m.keys(), ...s.ctx.cache.m.values()].join(' ')).not.toContain(token);
  });

  test('bad, unknown and too-old tokens are refused', () => {
    const s = setup();
    expect(() => lib.Sessions.resolve(s.ctx, 'nope')).toThrow(expect.objectContaining({ code: 'session' }));
    expect(() => lib.Sessions.resolve(s.ctx, 'a'.repeat(64))).toThrow(expect.objectContaining({ code: 'session' }));
    const start = Date.now();
    const token = lib.Sessions.create(s.ctx, 'CL-AAAAAA', start);
    expect(() => lib.Sessions.resolve(s.ctx, token, start + Config.SESSION_MAX_SECONDS * 1000 + 1))
      .toThrow(expect.objectContaining({ code: 'session' }));
  });

  test('deactivating the client ends the session', () => {
    const s = setup();
    const token = lib.Sessions.create(s.ctx, 'CL-AAAAAA');
    lib.Clients.table(s.ss).update(2, { active: false });
    expect(() => lib.Sessions.resolve(s.ctx, token)).toThrow(expect.objectContaining({ code: 'session' }));
  });
});

describe('Portal api', () => {
  test('verifyCode returns only the client name and their open cases', () => {
    const s = setup();
    lib.Otp.request(s.ctx, { email: 'ana@x.pt' }, s.opts({ now: Date.now() }));  // api() uses the real clock
    const res = lib.api('verifyCode', { email: 'ana@x.pt', code: s.codeOf() }, s.ctx);
    expect(res.ok).toBe(true);
    expect(res.data.me).toEqual({ name: 'Ana', language: 'pt', cases: [{ id: 'CS-111111', name: 'Divórcio', reference: '' }] });
    expect(lib.api('me', { token: res.data.token }, s.ctx).data.name).toBe('Ana');
    expect(lib.api('me', { token: 'x' }, s.ctx)).toEqual({ ok: false, error: 'session' });
  });
});

describe('GmailRest.build', () => {
  const m = { to: 'ana@x.pt', from: 'geral@firma.pt', fromName: 'Silva & Costa', subject: '123456 é o seu código', text: 'olá', html: '<p>olá</p>' };

  test('encodes non-ASCII subject and keeps a quoted display name', () => {
    const mime = lib.GmailRest.build(m);
    expect(mime).toContain('From: "Silva & Costa" <geral@firma.pt>');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(mime).toContain('multipart/alternative');
  });

  test('no header injection through name or subject', () => {
    const mime = lib.GmailRest.build({ ...m, fromName: 'X\r\nBcc: evil@x.pt', subject: 'hi\r\nBcc: evil@x.pt' });
    expect(mime.split('\r\n').filter((l) => l.startsWith('Bcc:'))).toEqual([]);
  });

  test('refuses bad addresses', () => {
    expect(() => lib.GmailRest.build({ ...m, to: 'a@b.pt\r\nBcc: x@y.pt' })).toThrow();
  });
});
