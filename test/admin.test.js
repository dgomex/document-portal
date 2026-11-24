const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));

class FakeProps {
  constructor(init = {}) { this.m = { ...init }; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
  deleteProperty(k) { delete this.m[k]; }
}
const lock = () => ({ tryLock: () => true, releaseLock() {} });
const URL = 'https://script.google.com/macros/s/AKfycbxDEPLOY123/exec';

function firm({ clients = [], settings = [] } = {}) {
  return new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['firm_name', 'Silva & Costa', ''], ['default_language', 'pt', ''],
      ['portal_url', URL, ''], ...settings],
    Clients: [Config.SCHEMA.Clients, ...clients.map((c) => row(Config.SCHEMA.Clients, c))],
    Events: [Config.SCHEMA.Events],
  });
}
const client = (id, extra) => ({ client_id: id, name: 'Cliente ' + id, email: id.toLowerCase().replace('-', '') + '@x.pt',
  active: true, provision_status: 'ACTIVE', invite_status: 'REQUESTED', language: 'pt', ...extra });

describe('MailBudget', () => {
  test('digests and invites stop short of the limit; codes may use all of it', () => {
    const ctx = { ss: firm(), props: new FakeProps() };
    let digests = 0;
    while (lib.MailBudget.take(ctx, 'digest')) digests++;
    expect(digests).toBe(Config.MAIL.DEFAULT_LIMIT - Config.MAIL.RESERVED_FOR_CODES);
    let codes = 0;
    while (lib.MailBudget.take(ctx, 'code')) codes++;
    expect(codes).toBe(Config.MAIL.RESERVED_FOR_CODES);
  });

  test('the firm can raise the limit (Workspace), capped at 1500', () => {
    expect(lib.MailBudget.limit(firm({ settings: [['daily_email_limit', '1000', '']] }))).toBe(1000);
    expect(lib.MailBudget.limit(firm({ settings: [['daily_email_limit', '99999', '']] }))).toBe(1500);
    expect(lib.MailBudget.limit(firm({ settings: [['daily_email_limit', 'lots', '']] }))).toBe(Config.MAIL.DEFAULT_LIMIT);
  });
});

describe('Invite', () => {
  const setup = (clients) => {
    const ss = firm({ clients });
    const sent = [];
    const ctx = { ss, props: new FakeProps(), script: { getOAuthToken: () => 'T' } };
    const run = (extra) => lib.Invite.run(ctx, { mail: { send: (t, m) => sent.push(m) }, token: 'T', ...extra });
    const status = () => lib.Clients.list(ss).map((c) => c.invite_status);
    return { ss, ctx, sent, run, status };
  };

  test('sends REQUESTED invites with the portal link in the client\'s language, then marks SENT', () => {
    const s = setup([client('CL-AAAAAA'), client('CL-BBBBBB', { language: 'en' }), client('CL-CCCCCC', { invite_status: 'SENT' })]);
    expect(s.run()).toEqual({ sent: 2, failed: 0, waiting: 0, budget: false });
    expect(s.sent.map((m) => m.to)).toEqual(['claaaaaa@x.pt', 'clbbbbbb@x.pt']);
    expect(s.sent[0].text).toContain(URL);
    expect(s.sent[0].subject).toContain('envio seguro');
    expect(s.sent[1].subject).toContain('send your documents');
    expect(s.status()).toEqual(['SENT', 'SENT', 'SENT']);
    expect(lib.Clients.list(s.ss)[0].invited_at).toBeTruthy();
    expect(s.run().sent).toBe(0);  // nothing twice
  });

  test('inactive or not-yet-provisioned clients wait', () => {
    const s = setup([client('CL-AAAAAA', { active: false }), client('CL-BBBBBB', { provision_status: 'PENDING' })]);
    expect(s.run()).toMatchObject({ sent: 0, waiting: 2 });
    expect(s.status()).toEqual(['REQUESTED', 'REQUESTED']);
  });

  test('a send failure marks ERROR and logs; the rest still go', () => {
    const s = setup([client('CL-AAAAAA'), client('CL-BBBBBB')]);
    let n = 0;
    const r = s.run({ mail: { send: (t, m) => { if (n++ === 0) throw new Error('bounce'); s.sent.push(m); } } });
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(s.status()).toEqual(['ERROR', 'SENT']);
  });

  test('stops at the daily budget and leaves the rest REQUESTED', () => {
    const s = setup([client('CL-AAAAAA'), client('CL-BBBBBB')]);
    const day = new Date().toISOString().slice(0, 10);
    s.ctx.props.setProperty('MAIL_DAILY', JSON.stringify({ day, n: Config.MAIL.DEFAULT_LIMIT - Config.MAIL.RESERVED_FOR_CODES - 1 }));
    expect(s.run({ now: Date.parse(day + 'T12:00:00Z') })).toMatchObject({ sent: 1, budget: true });
    expect(s.status()).toEqual(['SENT', 'REQUESTED']);
  });

  test('needs the portal address', () => {
    const ss = firm({ clients: [client('CL-AAAAAA')] });
    lib.Settings.set(ss, 'portal_url', '');
    expect(() => lib.Invite.run({ ss, props: new FakeProps() }, {})).toThrow(expect.objectContaining({ code: 'noPortalUrl' }));
  });

  test('names are escaped in the HTML email', () => {
    const html = lib.Invite.message('pt', { name: '<script>', firm: 'F', url: URL, email: 'a@x.pt' }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="' + URL + '"');
  });
});

describe('Migrations', () => {
  test('a v1 sheet gets the new columns, the new settings and every step, up to the current schema', () => {
    const ss = firm({ settings: [['schema_version', '1', '']] });
    const ctx = { ss, props: new FakeProps({ OTP_DAILY: '{}', DIGEST_DAILY: '{}', OTP_SALT: 's' }), lock: lock() };
    lib.Schema.ensure = ((orig) => (s) => { /* the fake sheet lacks formatting APIs: add columns only */
      Object.keys(Config.SCHEMA).forEach((name) => {
        const sh = s.getSheetByName(name) || (s.sheets.push(new (require('./harness').FakeSheet)(name, [[]])), s.getSheetByName(name));
        const have = sh.data[0] || [];
        const missing = lib.Schema.missingColumns(have, Config.SCHEMA[name]);
        sh.data[0] = have.filter(String).concat(missing);
      });
      Config.SETTINGS_DEFAULTS.forEach(([k, v]) => { if (!(k in lib.Settings.read(s))) lib.Settings.set(s, k, v); });
    })(lib.Schema.ensure);
    expect(lib.Migrations.needed(ss)).toBe(true);
    expect(lib.Migrations.run(ctx)).toEqual({ from: 1, to: Config.SCHEMA_VERSION });
    expect(lib.Table.readHeaders(ss.getSheetByName('Clients'))).toContain('invited_at');
    expect(lib.Settings.get(ss, 'daily_email_limit')).toBe('95');
    expect(Object.keys(ctx.props.m)).toEqual(['OTP_SALT']);
    expect(String(lib.Settings.get(ss, 'schema_version'))).toBe(String(Config.SCHEMA_VERSION));
    expect(lib.Migrations.needed(ss)).toBe(false);
  });

  test('every schema version above 1 has a step or is purely additive (documented)', () => {
    for (let v = 2; v <= Config.SCHEMA_VERSION; v++) expect(typeof lib.Migrations.STEPS[v]).toBe('function');
  });
});

describe('Update (guided)', () => {
  const lib2 = (respond) => load({ UrlFetchApp: { fetch: (url) => respond(url) } });
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });

  test('reads the version the live portal serves', () => {
    let asked = '';
    const l = lib2((url) => { asked = url; return res(200, JSON.stringify({ libraryVersion: '0.3.1' })); });
    expect(l.Update.portalVersion(URL)).toBe('0.3.1');
    expect(asked).toBe(URL + '?portal=version');
  });

  test('anything odd reads as unknown, never throws', () => {
    expect(lib2(() => res(404, '')).Update.portalVersion(URL)).toBe('');
    expect(lib2(() => res(200, '<html>')).Update.portalVersion(URL)).toBe('');
    expect(lib2(() => res(200, '{"libraryVersion":"<b>"}')).Update.portalVersion(URL)).toBe('');
    expect(lib2(() => { throw new Error('dns'); }).Update.portalVersion(URL)).toBe('');
    expect(lib2(() => res(200, '{}')).Update.portalVersion('https://evil.example/x')).toBe('');
  });

  test('the shell asks for no Apps Script API scopes (they cannot work for copies)', () => {
    const manifest = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'shell', 'appsscript.json'), 'utf8'));
    expect(manifest.oauthScopes.filter((s) => /script\.(projects|deployments)/.test(s))).toEqual([]);
  });
});

describe('portal address changes (0.5.2)', () => {
  const NEW = 'https://script.google.com/macros/s/AKfycbxNEWDEPLOY456/exec';
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
  const withFetch = (respond) => {
    const l = load({ UrlFetchApp: { fetch: (url) => respond(url) } });
    l.Migrations.run = () => ({ from: 4, to: 4 });
    return l;
  };
  const version = (v) => res(200, JSON.stringify({ libraryVersion: v }));

  test('Verificar tells a replaced deployment (404) from one that is not open to anyone', () => {
    const at = (r) => withFetch(() => r).Update.portalCheck(URL).reach;
    expect(at(res(404, '<html>Página não encontrada</html>'))).toBe('gone');
    expect(at(res(200, '<html>Sign in</html>'))).toBe('private');
    expect(at(res(403, ''))).toBe('private');
    expect(at(res(500, ''))).toBe('error');
    expect(at(version('0.5.2'))).toBe('ok');
    const l = withFetch(() => res(404, ''));
    const s = l.Update.status({ ss: firm(), props: new FakeProps() });
    expect([s.reach, s.portal, s.match, s.urlChanged]).toEqual(['gone', '', false, null]);
  });

  test('the portal opened at a new address records it, and Verificar warns once that old links broke', () => {
    const l = withFetch((url) => (url.startsWith(NEW) ? version(l.Config.LIBRARY_VERSION) : res(404, '')));
    const ss = firm();
    const ctx = { ss, props: new FakeProps(), script: { getService: () => ({ getUrl: () => NEW }) } };
    l.Setup.recordPortalUrl(ctx, l.Settings.read(ss));
    expect(l.Settings.get(ss, 'portal_url')).toBe(NEW);
    expect(lib.Table.open(ss, 'Events').rows().map((e) => [e.type, e.detail])).toEqual([['portal_url_changed', URL + ' -> ' + NEW]]);
    const s = l.Update.status(ctx);
    expect([s.reach, s.match]).toEqual(['ok', true]);
    expect(s.urlChanged).toEqual({ from: URL, to: NEW });
    expect(l.Update.status(ctx).urlChanged).toBeNull();  // shown once
  });

  test('the first address, the same address, or a non-/exec URL is no change', () => {
    const l = withFetch(() => version('0.5.2'));
    const record = (before, now) => {
      const ss = firm({ settings: [] });
      l.Settings.set(ss, 'portal_url', before);
      const ctx = { ss, props: new FakeProps(), script: { getService: () => ({ getUrl: () => now }) } };
      l.Setup.recordPortalUrl(ctx, l.Settings.read(ss));
      return [l.Settings.get(ss, 'portal_url'), ctx.props.getProperty(l.Setup.URL_CHANGED_KEY)];
    };
    expect(record('', NEW)).toEqual([NEW, null]);
    expect(record(NEW, NEW)).toEqual([NEW, null]);
    expect(record(NEW, 'https://script.google.com/macros/s/AKfycbxNEWDEPLOY456/dev')).toEqual([NEW, null]);
  });
});
