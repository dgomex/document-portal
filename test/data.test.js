const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;

function firm() {
  return new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['firm_name', 'Silva & Costa', ''], ['default_language', 'en', '']],
    // Columns deliberately out of schema order: access is by header name.
    Clients: [
      ['name', 'client_id', ...Config.SCHEMA.Clients.filter((h) => h !== 'name' && h !== 'client_id')],
      ...[
        { client_id: 'CL-AAAAAA', name: 'Ana', email: 'Ana@x.pt', additional_emails: 'marido@x.pt', active: true },
        { client_id: 'CL-BBBBBB', name: 'Bruno', email: 'bruno@x.pt', active: 'TRUE' },
        { client_id: 'CL-DDDDDD', name: 'Diogo', email: 'diogo@x.pt', active: false },
        { client_id: 'bad-id', name: 'Eva', email: 'eva@x.pt', active: true },
      ].map((r) => ['name', 'client_id', ...Config.SCHEMA.Clients.filter((h) => h !== 'name' && h !== 'client_id')]
        .map((h) => (r[h] === undefined ? '' : r[h]))),
      [], // blank row in the middle of the data is skipped
    ],
    Cases: [
      Config.SCHEMA.Cases,
      ...[
        { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Divórcio', status: 'open' },
        { case_id: 'CS-222222', client_id: 'CL-AAAAAA', case_name: 'Herança', status: 'Open' },
        { case_id: 'CS-333333', client_id: 'CL-AAAAAA', case_name: 'Antigo', status: 'closed' },
        { case_id: 'CS-444444', client_id: 'CL-AAAAAA', case_name: 'Falhou', status: 'open', provision_status: 'ERROR' },
        { case_id: 'CS-555555', client_id: 'CL-BBBBBB', case_name: 'Arrendamento', status: 'open' },
      ].map((r) => Config.SCHEMA.Cases.map((h) => (r[h] === undefined ? '' : r[h]))),
    ],
  });
}

describe('Table', () => {
  test('rows are keyed by header and carry their row number', () => {
    const ss = firm();
    const rows = lib.Table.open(ss, 'Clients').rows();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ _row: 2, client_id: 'CL-AAAAAA', name: 'Ana' });
  });

  test('append writes by header and neutralises formulas', () => {
    const ss = firm();
    const t = lib.Table.open(ss, 'Cases');
    t.append({ case_id: 'CS-666666', case_name: '=IMPORTXML("x")' });
    const last = ss.getSheetByName('Cases').data.at(-1);
    expect(last[t.column('case_id') - 1]).toBe('CS-666666');
    expect(last[t.column('case_name') - 1]).toBe('\'=IMPORTXML("x")');
    expect(last).toHaveLength(Config.SCHEMA.Cases.length);
  });

  test('append fills the first free row even when unticked checkboxes run to row 1000', () => {
    const headers = Config.SCHEMA.Clients;
    const activeCol = headers.indexOf('active');
    // An earlier bug also left ERROR text on these empty rows.
    const blank = () => headers.map((h, i) => (i === activeCol ? false
      : h === 'provision_status' ? 'ERROR' : h === 'provision_error' ? 'invalid email' : ''));
    const ss = new FakeSpreadsheet({ Clients: [headers.slice(), ...Array.from({ length: 999 }, blank)] });
    const t = lib.Table.open(ss, 'Clients');
    expect(t.rows()).toEqual([]);
    expect(t.append({ client_id: 'CL-AAAAAA', name: 'Ana' })).toBe(2);
    expect(t.append({ client_id: 'CL-BBBBBB', name: 'Bruno' })).toBe(3);
    expect(t.rows().map((r) => [r._row, r.name])).toEqual([[2, 'Ana'], [3, 'Bruno']]);
  });

  test('append and update refuse unknown columns', () => {
    const t = lib.Table.open(firm(), 'Cases');
    expect(() => t.append({ nope: 1 })).toThrow('unknown column nope');
    expect(() => t.update(2, { nope: 1 })).toThrow('unknown column nope');
  });

  test('update changes only the named cells', () => {
    const ss = firm();
    const t = lib.Table.open(ss, 'Cases');
    t.update(2, { status: 'closed' });
    expect(lib.Cases.byId(ss, 'CS-111111').status).toBe('closed');
    expect(lib.Cases.byId(ss, 'CS-111111').case_name).toBe('Divórcio');
  });

  test('require names the missing columns', () => {
    const ss = new FakeSpreadsheet({ Clients: [['client_id', 'name']] });
    expect(() => lib.Clients.list(ss)).toThrow(/Clients: missing columns email, additional_emails/);
  });

  test('missing tab is a clear error', () => {
    expect(() => lib.Table.open(new FakeSpreadsheet({}), 'Clients')).toThrow('Missing tab: Clients');
  });
});

describe('Settings', () => {
  test('version-like values are written as text, so Sheets keeps them as typed', () => {
    const ss = firm();
    lib.Settings.set(ss, 'library_version', '0.3.1');
    lib.Settings.set(ss, 'catalog_version', '2026.10');
    lib.Settings.set(ss, 'max_file_mb', '100');
    const raw = (k) => ss.getSheetByName('Settings').data.find((r) => r[0] === k)[1];
    expect(raw('library_version')).toBe("'0.3.1");
    expect(raw('catalog_version')).toBe("'2026.10");
    expect(raw('max_file_mb')).toBe('100');
    expect(lib.Settings.get(ss, 'library_version')).toBe('0.3.1');
    expect(lib.Settings.get(ss, 'catalog_version')).toBe('2026.10');
  });

  test('read, get, set and language', () => {
    const ss = firm();
    expect(lib.Settings.get(ss, 'firm_name')).toBe('Silva & Costa');
    expect(lib.Settings.get(ss, 'unknown')).toBe('');
    expect(lib.Settings.language(ss)).toBe('en');
    lib.Settings.set(ss, 'firm_name', 'Silva, Costa & Filhos');
    lib.Settings.set(ss, 'portal_url', 'https://example');
    expect(lib.Settings.read(ss)).toMatchObject({ firm_name: 'Silva, Costa & Filhos', portal_url: 'https://example' });
  });
});

describe('Clients', () => {
  test('findActiveByEmail matches primary and additional emails, case-insensitively', () => {
    const ss = firm();
    expect(lib.Clients.findActiveByEmail(ss, ' ANA@x.pt').client_id).toBe('CL-AAAAAA');
    expect(lib.Clients.findActiveByEmail(ss, 'marido@x.pt').client_id).toBe('CL-AAAAAA');
    expect(lib.Clients.findActiveByEmail(ss, 'bruno@x.pt').client_id).toBe('CL-BBBBBB');
  });

  test('inactive, malformed-ID and unknown clients all look the same: null', () => {
    const ss = firm();
    expect(lib.Clients.findActiveByEmail(ss, 'diogo@x.pt')).toBeNull();
    expect(lib.Clients.findActiveByEmail(ss, 'eva@x.pt')).toBeNull();
    expect(lib.Clients.findActiveByEmail(ss, 'nobody@x.pt')).toBeNull();
    expect(lib.Clients.findActiveByEmail(ss, 'not an email')).toBeNull();
  });
});

describe('Cases', () => {
  test('openForClient: open (any case), valid, not in error, own cases only', () => {
    const ids = lib.Cases.openForClient(firm(), 'CL-AAAAAA').map((c) => c.case_id);
    expect(ids).toEqual(['CS-111111', 'CS-222222']);
  });
});

describe('Schema', () => {
  test('missingColumns ignores order and whitespace', () => {
    expect(lib.Schema.missingColumns([' b', 'a'], ['a', 'b', 'c'])).toEqual(['c']);
  });
});
