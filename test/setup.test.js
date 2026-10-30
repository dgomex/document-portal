const { load } = require('./harness');

const lib = load({
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64'), (b) => (b > 127 ? b - 256 : b)) },
});

const good = {
  firm_name: '  Silva & Costa Advogados ', notification_email: 'Geral@SilvaCosta.pt', default_language: 'pt',
  privacy_contact: 'privacidade@silvacosta.pt', privacy_policy_url: 'https://silvacosta.pt/privacidade', max_file_mb: '100',
};

describe('Setup.validate', () => {
  test('accepts and normalises a good form', () => {
    const { values, errors } = lib.Setup.validate(good);
    expect(errors).toEqual({});
    expect(values).toMatchObject({ firm_name: 'Silva & Costa Advogados', notification_email: 'geral@silvacosta.pt', send_as_alias: '' });
  });

  test('flags each bad field with its message key', () => {
    const { errors } = lib.Setup.validate({
      firm_name: '', notification_email: 'nope', send_as_alias: 'bad', default_language: 'fr',
      privacy_contact: 'x'.repeat(201), privacy_policy_url: 'http://insecure.pt', max_file_mb: '150',
    });
    expect(errors).toEqual({
      firm_name: 'setup.err.firmName', notification_email: 'setup.err.email', send_as_alias: 'setup.err.email',
      default_language: 'setup.err.language', privacy_contact: 'setup.err.tooLong',
      privacy_policy_url: 'setup.err.url', max_file_mb: 'setup.err.maxMb',
    });
  });

  test.each([
    ['https://script.google.com/macros/s/AKfycbx-_9/exec', true],
    ['https://script.google.com/a/macros/silvacosta.pt/s/AKfycbx/exec', true],
    ['https://script.google.com/macros/s/AKfycbx/dev', false],
    ['https://evil.example/macros/s/AKfycbx/exec', false],
    ['http://script.google.com/macros/s/AKfycbx/exec', false],
  ])('portal_url %s accepted: %s', (url, ok) => {
    const { errors } = lib.Setup.validate({ ...good, portal_url: url });
    expect(errors.portal_url).toBe(ok ? undefined : 'setup.err.portalUrl');
  });

  test('defaults language and max size', () => {
    const { values, errors } = lib.Setup.validate({ firm_name: 'X', notification_email: 'a@b.pt' });
    expect(errors).toEqual({});
    expect(values).toMatchObject({ default_language: 'pt', max_file_mb: '100' });
  });
});

describe('Setup.recordPortalUrl', () => {
  const written = [];
  const real = 'https://script.google.com/macros/s/AKfycbx/exec';
  const run = (url, stored) => {
    written.length = 0;
    const ctx = { ss: {}, script: { getService: () => ({ getUrl: () => url }) } };
    const set = lib.Settings.set;
    lib.Settings.set = (ss, k, v) => written.push([k, v]);
    try { lib.Setup.recordPortalUrl(ctx, { portal_url: stored }); } finally { lib.Settings.set = set; }
    return written.slice();
  };
  test('records a new address', () => expect(run(real, '')).toEqual([['portal_url', real]]));
  test('no write when unchanged', () => expect(run(real, real)).toEqual([]));
  test('ignores a /dev or empty answer', () => {
    expect(run('https://script.google.com/macros/s/AKfycbx/dev', '')).toEqual([]);
    expect(run(null, '')).toEqual([]);
  });
});

describe('Setup.checkLogo', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');

  test('no logo is fine', () => expect(lib.Setup.checkLogo(null)).toEqual({}));
  test('real PNG and JPEG pass', () => {
    expect(lib.Setup.checkLogo({ mimeType: 'image/png', base64: png }).bytes).toHaveLength(11);
    expect(lib.Setup.checkLogo({ mimeType: 'image/jpeg', base64: jpeg }).bytes).toHaveLength(6);
  });
  test('declared type must match the bytes', () => {
    expect(lib.Setup.checkLogo({ mimeType: 'image/png', base64: jpeg })).toEqual({ error: 'setup.err.logoType' });
    expect(lib.Setup.checkLogo({ mimeType: 'image/svg+xml', base64: png })).toEqual({ error: 'setup.err.logoType' });
  });
  test('over 1 MB is refused', () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1024 * 1024)]).toString('base64');
    expect(lib.Setup.checkLogo({ mimeType: 'image/png', base64: big })).toEqual({ error: 'setup.err.logoSize' });
  });
});
