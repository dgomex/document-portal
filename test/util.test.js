const { load } = require('./harness');

const lib = load();

describe('Crypto', () => {
  const { Crypto } = lib;

  test('sha256Hex matches the standard test vector', () => {
    expect(Crypto.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('sha256Hex hashes UTF-8, not UTF-16', () => {
    expect(Crypto.sha256Hex('ção')).toBe(require('crypto').createHash('sha256').update('ção', 'utf8').digest('hex'));
  });

  test('randomBytes returns n bytes in 0..255', () => {
    const bytes = Crypto.randomBytes(100);
    expect(bytes).toHaveLength(100);
    expect(bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true);
  });

  test('randomToken is 64 hex chars by default and does not repeat', () => {
    const a = Crypto.randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(Crypto.randomToken()).not.toBe(a);
  });

  test('randomDigits gives exactly n decimal digits, all digits appear', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const code = Crypto.randomDigits(6);
      expect(code).toMatch(/^\d{6}$/);
      code.split('').forEach((d) => seen.add(d));
    }
    expect(seen.size).toBe(10);
  });

  test('constantTimeEqual', () => {
    expect(Crypto.constantTimeEqual('abc', 'abc')).toBe(true);
    expect(Crypto.constantTimeEqual('abc', 'abd')).toBe(false);
    expect(Crypto.constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('Ids', () => {
  const { Ids } = lib;

  test('generate produces PREFIX-XXXXXX in Crockford base32', () => {
    for (let i = 0; i < 200; i++) {
      const id = Ids.generate('CL');
      expect(id).toMatch(/^CL-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(Ids.isValid(id, 'CL')).toBe(true);
    }
  });

  test('generate avoids IDs already taken', () => {
    const scripted = load({
      Utilities: {
        // First UUID always maps to CL-000000; the second one differs.
        getUuid: (() => { let n = 0; return () => (n++ === 0 ? '00000000-0000-4000-8000-000000000000' : require('crypto').randomUUID()); })(),
      },
    });
    const id = scripted.Ids.generate('CL', ['CL-000000']);
    expect(id).not.toBe('CL-000000');
    expect(scripted.Ids.isValid(id, 'CL')).toBe(true);
  });

  test('isValid rejects wrong prefix, ambiguous letters and bad length', () => {
    expect(Ids.isValid('CS-7K3Q9X', 'CL')).toBe(false);
    expect(Ids.isValid('CL-7K3Q9I')).toBe(false); // I is not Crockford
    expect(Ids.isValid('CL-7K3Q9')).toBe(false);
    expect(Ids.isValid('cl-7k3q9x')).toBe(false);
    expect(Ids.isValid('')).toBe(false);
  });
});

describe('Sanitize', () => {
  const { Sanitize } = lib;

  test.each([
    ['=HYPERLINK("http://x")', '\'=HYPERLINK("http://x")'],
    ['+351 912', "'+351 912"],
    ['-5', "'-5"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['normal.pdf', 'normal.pdf'],
  ])('cell(%j)', (input, out) => expect(Sanitize.cell(input)).toBe(out));

  test('cell leaves non-strings alone', () => {
    expect(Sanitize.cell(42)).toBe(42);
    expect(Sanitize.cell(true)).toBe(true);
  });

  test.each([
    ['../../etc/passwd', '_.._etc_passwd'],
    ['fatura:março?.pdf', 'fatura_março_.pdf'],
    ['  spaced\t name .pdf ', 'spaced name .pdf'],
    ['\u0000\u0007', 'ficheiro'],
    ['...', 'ficheiro'],
    ['', 'ficheiro'],
    [null, 'ficheiro'],
  ])('fileName(%j)', (input, out) => expect(Sanitize.fileName(input)).toBe(out));

  test('fileName truncates long names but keeps the extension', () => {
    const out = Sanitize.fileName('a'.repeat(300) + '.heic');
    expect(out.length).toBe(120);
    expect(out.endsWith('.heic')).toBe(true);
  });

  test('storedName prefixes the Lisbon local time', () => {
    const date = new Date('2026-07-01T13:05:00Z'); // 14:05 in Lisbon (summer time)
    expect(Sanitize.storedName(date, 'contrato.pdf')).toBe('2026-07-01_1405_contrato.pdf');
  });

  test('folderName appends the ID', () => {
    expect(Sanitize.folderName('Ana Ferreira', 'CL-7K3Q9X')).toBe('Ana Ferreira [CL-7K3Q9X]');
  });
});

describe('Validate', () => {
  const { Validate } = lib;

  test('emails', () => {
    expect(Validate.isEmail(' Ana@Exemplo.PT ')).toBe(true);
    expect(Validate.normalizeEmail(' Ana@Exemplo.PT ')).toBe('ana@exemplo.pt');
    expect(Validate.isEmail('ana@exemplo')).toBe(false);
    expect(Validate.isEmail('ana exemplo.pt')).toBe(false);
    expect(Validate.isEmail('a@b.c')).toBe(false);
  });

  test('parseEmailList splits on ; , and spaces', () => {
    expect(Validate.parseEmailList('a@x.pt; B@y.pt,bad , c@z.com')).toEqual({
      valid: ['a@x.pt', 'b@y.pt', 'c@z.com'], invalid: ['bad'],
    });
    expect(Validate.parseEmailList('')).toEqual({ valid: [], invalid: [] });
  });

  test.each([[true, true], ['TRUE', true], ['sim', true], [1, true], [false, false], ['', false], [null, false], ['no', false]])(
    'toBool(%j) = %j', (v, out) => expect(Validate.toBool(v)).toBe(out));

  test('clientRow accepts a good row and reports each problem', () => {
    const good = { client_id: 'CL-7K3Q9X', name: 'Ana', email: 'ana@x.pt', additional_emails: '', language: 'pt' };
    expect(Validate.clientRow(good)).toEqual([]);
    expect(Validate.clientRow({ ...good, client_id: 'X', email: 'bad', language: 'fr', additional_emails: 'nope' }))
      .toEqual(['invalid client_id', 'invalid email', 'invalid additional_emails: nope', 'invalid language']);
  });

  test('clientRow detects an email already used by another client', () => {
    const row = { client_id: 'CL-7K3Q9X', name: 'Ana', email: 'ana@x.pt' };
    expect(Validate.clientRow(row, { emailOwner: { 'ana@x.pt': 'CL-AAAAAA' } }))
      .toEqual(['email ana@x.pt already used by CL-AAAAAA']);
    expect(Validate.clientRow(row, { emailOwner: { 'ana@x.pt': 'CL-7K3Q9X' } })).toEqual([]);
  });

  test('caseRow', () => {
    const clients = { 'CL-7K3Q9X': {} };
    const good = { case_id: 'CS-1A2B3C', client_id: 'CL-7K3Q9X', case_name: 'Divórcio', status: 'Open' };
    expect(Validate.caseRow(good, clients)).toEqual([]);
    expect(Validate.caseRow({ ...good, client_id: 'CL-ZZZZZZ', status: 'pending' }, clients))
      .toEqual(['invalid status', 'unknown client_id']);
  });
});

describe('I18n', () => {
  const { I18n, I18N_PT, I18N_EN } = lib;

  test('PT and EN have exactly the same keys', () => {
    expect(Object.keys(I18N_EN).sort()).toEqual(Object.keys(I18N_PT).sort());
  });

  test('PT and EN use the same placeholders for every key', () => {
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort();
    Object.keys(I18N_PT).forEach((k) => expect([k, holes(I18N_EN[k])]).toEqual([k, holes(I18N_PT[k])]));
  });

  test('every Settings default has a description in both languages', () => {
    lib.Config.SETTINGS_DEFAULTS.forEach(([key]) => {
      expect(I18N_PT['settings.' + key]).toBeTruthy();
      expect(I18N_EN['settings.' + key]).toBeTruthy();
    });
  });

  test('t fills placeholders and falls back', () => {
    expect(I18n.t('en', 'seed.done', { added: 4, clients: 3, cases: 6 })).toContain('4 clients added');
    expect(I18n.t('fr', 'menu.setup')).toBe('Configurar');
    expect(I18n.t('en', 'no.such.key')).toBe('no.such.key');
  });
});
