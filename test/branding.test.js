const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;

class FakeCache {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  put(k, v) { this.m.set(k, String(v)); }
}

describe('Branding.logoDataUri', () => {
  const big = Array.from({ length: 200000 }, (_, i) => i % 256);  // base64 > 100 KB: needs several cache parts
  const make = (file) => {
    let calls = 0;
    const drive = { download: () => { calls++; if (file instanceof Error) throw file; return file; } };
    return { drive, calls: () => calls };
  };

  test('reads the logo once, then serves it from the cache in parts', () => {
    const ctx = { cache: new FakeCache() };
    const d = make({ bytes: big, mimeType: 'image/png' });
    const a = lib.Branding.logoDataUri(ctx, 'LOGO1234567', { drive: d.drive, token: 'T' });
    expect(a.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(a.split(',')[1], 'base64')).toHaveLength(big.length);
    expect([...ctx.cache.m.values()].every((v) => v.length <= 100 * 1024)).toBe(true);
    expect(lib.Branding.logoDataUri(ctx, 'LOGO1234567', { drive: d.drive, token: 'T' })).toBe(a);
    expect(d.calls()).toBe(1);
  });

  test('no logo, a bad ID, a non-image or a Drive error: no logo, never an exception', () => {
    const ctx = { cache: new FakeCache() };
    expect(lib.Branding.logoDataUri(ctx, '', {})).toBe('');
    expect(lib.Branding.logoDataUri(ctx, '../x', {})).toBe('');
    expect(lib.Branding.logoDataUri(ctx, 'LOGO1234567', { drive: make({ bytes: [1], mimeType: 'text/html' }).drive, token: 'T' })).toBe('');
    expect(lib.Branding.logoDataUri(ctx, 'LOGO1234567', { drive: make(new Error('403')).drive, token: 'T' })).toBe('');
  });
});

describe('I18n.publicBundle', () => {
  test('gives the page client-facing text only, in both languages', () => {
    const b = lib.I18n.publicBundle();
    ['pt', 'en'].forEach((l) => {
      const keys = Object.keys(b[l]);
      expect(keys).toContain('login.intro');
      expect(keys).toContain('privacy.body');
      expect(keys.filter((k) => /^(setup|menu|settings|seed|provision|mail)\./.test(k))).toEqual([]);
    });
  });

  test('every key the page uses is in the public bundle', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'library', 'src', 'html', 'index.html'), 'utf8');
    const used = [...html.matchAll(/(?:\bt\(|data-t=)['"]([\w.]+)['"]/g)].map((m) => m[1])
      .filter((k) => !k.endsWith('.'));  // 'error.' + code is built at run time
    const pub = lib.I18n.publicBundle().pt;
    expect(used.filter((k) => !(k in pub))).toEqual([]);
  });
});

describe('Events.prune', () => {
  test('drops rows older than 90 days, keeps the rest', () => {
    const day = 86400000;
    const now = Date.UTC(2026, 9, 30);
    const ss = new FakeSpreadsheet({ Events: [Config.SCHEMA.Events,
      [new Date(now - 200 * day), 'otp_sent', 'h', ''],
      [new Date(now - 91 * day), 'otp_sent', 'h', ''],
      [new Date(now - 89 * day), 'verify_ok', 'h', ''],
      [new Date(now - 1 * day), 'otp_unknown', 'h', ''],
    ] });
    expect(lib.Events.prune(ss, now)).toBe(2);
    expect(ss.getSheetByName('Events').data.slice(1).map((r) => r[1])).toEqual(['verify_ok', 'otp_unknown']);
    expect(lib.Events.prune(ss, now)).toBe(0);
  });
});
