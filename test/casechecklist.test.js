const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));
const lock = () => ({ tryLock: () => true, releaseLock() {} });
// A Checklist tab from before 0.6.0: the legacy columns as well as section.
const LEGACY_CHECKLIST = ['item_id', 'case_id', 'person_id', 'person_name', 'title', 'instructions', 'level', 'status', 'reason',
  'due_date', 'upload_ids', 'doc_type', 'key', 'source', 'updated_at', 'text_json', 'section'];

function firm(checklistHeaders = Config.SCHEMA.Checklist, checklistRows = []) {
  const ss = new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['default_language', 'pt', ''], ['schema_version', '5', '']],
    Clients: [Config.SCHEMA.Clients, row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana Ferreira', email: 'ana@x.pt', active: true, provision_status: 'ACTIVE' })],
    Cases: [Config.SCHEMA.Cases,
      row(Config.SCHEMA.Cases, { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Compra de casa', status: 'open', provision_status: 'ACTIVE', folder_id: 'F' }),
      row(Config.SCHEMA.Cases, { case_id: 'CS-222222', client_id: 'CL-AAAAAA', case_name: 'Herança', status: 'closed', provision_status: 'PENDING' })],
    Checklist: [checklistHeaders].concat(checklistRows.map((r) => row(checklistHeaders, r))),
  });
  const ctx = { ss, lock: lock() };
  const sync = () => lib.CaseChecklist.sync(ctx, { now: Date.UTC(2026, 10, 25) });
  const items = () => lib.CaseChecklist.items(ss);
  const add = (r) => lib.Table.open(ss, 'Checklist').append(r);
  return { ss, ctx, sync, items, add };
}

describe('sync', () => {
  test('a row the firm writes gets an ID, status missing and level required', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', title: 'Passaporte' });
    f.add({ case_id: 'CS-111111', section: 'Banco', title: 'Extrato', level: 'optional', status: 'accepted' });
    expect(f.sync()).toEqual({ requests: 2 });
    // The cells themselves, not items(), which fills in the same defaults when reading.
    expect(lib.Table.open(f.ss, 'Checklist').rows()[0]).toMatchObject({ status: 'missing', level: 'required' });
    const [a, b] = f.items();
    expect(a).toMatchObject({ status: 'missing', level: 'required' });
    expect(a.item_id).toMatch(/^IT-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(a.updated_at.getTime()).toBe(Date.UTC(2026, 10, 25));
    expect(b).toMatchObject({ status: 'accepted', level: 'optional', section: 'Banco' });
    expect(b.item_id).not.toBe(a.item_id);
    expect(f.sync()).toEqual({ requests: 0 });
  });

  test('a row for an unknown case or without a title is left untouched', () => {
    const f = firm();
    f.add({ case_id: 'CS-999999', title: 'Passaporte' });
    f.add({ case_id: 'CS-111111', title: '' , instructions: 'sem título' });
    expect(f.sync()).toEqual({ requests: 0 });
    expect(f.items().every((i) => !i.item_id)).toBe(true);
  });

  test('a closed or not yet provisioned case still gets its rows', () => {
    const f = firm();
    f.add({ case_id: 'CS-222222', title: 'Testamento' });
    expect(f.sync()).toEqual({ requests: 1 });
  });

  test('writes nothing but item_id, level, status and updated_at (no legacy columns needed)', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', title: 'Passaporte' });
    f.sync();
    expect(Config.SCHEMA.Checklist).not.toContain('person_id');
    expect(Config.SCHEMA.Checklist).not.toContain('text_json');
    expect(f.items()[0]).toMatchObject({ case_id: 'CS-111111', title: 'Passaporte', section: '' });
  });

  test('skips when the lock is busy, and before the Checklist tab exists', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', title: 'Passaporte' });
    expect(lib.CaseChecklist.sync({ ss: f.ss, lock: { tryLock: () => false } })).toEqual({ requests: 0 });
    const bare = new FakeSpreadsheet({ Settings: [['key', 'value', 'description']] });
    expect(lib.CaseChecklist.sync({ ss: bare, lock: lock() })).toEqual({ requests: 0 });
  });
});

describe('view', () => {
  test('a section may be called anything, even a name objects have', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', section: 'constructor', title: 'A' });
    f.add({ case_id: 'CS-111111', section: 'toString', title: 'B' });
    f.sync();
    expect(lib.CaseChecklist.view(f.ss, 'CS-111111', 'pt').map((g) => g.name)).toEqual(['constructor', 'toString']);
  });

  test('sections in order of their first row, the general section last, waived left out', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', title: 'Contrato-promessa' });
    f.add({ case_id: 'CS-111111', section: 'Ana', title: 'Cartão de cidadão' });
    f.add({ case_id: 'CS-111111', section: 'Banco', title: 'Aprovação do crédito', instructions: 'Carta do banco.', due_date: '2026-12-01' });
    f.add({ case_id: 'CS-111111', section: 'Ana', title: 'IRS', level: 'optional' });
    f.add({ case_id: 'CS-111111', title: 'Caderneta predial', level: 'waived' });
    f.add({ case_id: 'CS-222222', title: 'Outro processo' });
    f.sync();
    const view = lib.CaseChecklist.view(f.ss, 'CS-111111', 'pt');
    expect(view.map((g) => g.name)).toEqual(['Ana', 'Banco', '']);
    expect(view[0].items.map((i) => i.title)).toEqual(['Cartão de cidadão', 'IRS']);
    expect(view[0].items[1].level).toBe('optional');
    expect(view[1].items[0]).toMatchObject({ instructions: 'Carta do banco.', due: '2026-12-01', status: 'missing', reason: '', options: [] });
    expect(view[2].items.map((i) => i.title)).toEqual(['Contrato-promessa']);
  });

  test('a reason shows only on a rejected document', () => {
    const f = firm();
    f.add({ case_id: 'CS-111111', title: 'A', status: 'rejected', reason: 'Ilegível' });
    f.add({ case_id: 'CS-111111', title: 'B', status: 'accepted', reason: 'nota interna' });
    f.sync();
    const items = lib.CaseChecklist.view(f.ss, 'CS-111111', 'pt')[0].items;
    expect(items.map((i) => i.reason)).toEqual(['Ilegível', '']);
  });

  test('rows from before 0.6.0: person_name as the section, text_json texts, requested as required', () => {
    const text = JSON.stringify({ title: { pt: 'Alojamento', en: 'Housing' }, instructions: { pt: 'Um dos seguintes', en: 'One of' },
      options: [{ doc: 'LEASE', title: { pt: 'Arrendamento', en: 'Lease' } }, { doc: 'DEED', title: { pt: 'Escritura', en: 'Deed' } }] });
    const f = firm(LEGACY_CHECKLIST, [
      { item_id: 'IT-AAAAAA', case_id: 'CS-111111', person_id: 'PE-AAAAAA', person_name: 'Ana', title: 'Passaporte', level: 'required', status: 'received', key: 'PASSPORT|PE-AAAAAA', source: 'firm' },
      { item_id: 'IT-BBBBBB', case_id: 'CS-111111', title: 'Alojamento', level: 'required', status: 'missing', text_json: text, source: 'firm' },
      { item_id: 'IT-CCCCCC', case_id: 'CS-111111', person_name: 'Ana', title: 'Carta', level: 'requested', status: 'missing', source: 'case' },
    ]);
    expect(f.sync()).toEqual({ requests: 0 });
    const view = lib.CaseChecklist.view(f.ss, 'CS-111111', 'en');
    expect(view.map((g) => g.name)).toEqual(['Ana', '']);
    expect(view[0].items.map((i) => [i.title, i.level])).toEqual([['Passaporte', 'required'], ['Carta', 'required']]);
    expect(view[1].items[0]).toMatchObject({ title: 'Housing', instructions: 'One of', options: ['Lease', 'Deed'] });
  });

  test('a new row in a legacy sheet gets an ID without touching the legacy columns', () => {
    const f = firm(LEGACY_CHECKLIST);
    f.add({ case_id: 'CS-111111', section: 'Ana', title: 'NIF' });
    f.sync();
    expect(f.items()[0]).toMatchObject({ section: 'Ana', person_id: '', key: '', source: '', text_json: '' });
  });
});

describe('schema 5 migration', () => {
  function legacySheet() {
    const ss = new FakeSpreadsheet({
      Settings: [['key', 'value', 'description'], ['default_language', 'pt', ''], ['schema_version', '4', '']],
      Clients: [Config.SCHEMA.Clients],
      Cases: [Config.SCHEMA.Cases.concat(['visa_type', 'facts', 'checklist_version'])],
      Checklist: [LEGACY_CHECKLIST.slice(0, -1),
        row(LEGACY_CHECKLIST, { item_id: 'IT-AAAAAA', case_id: 'CS-111111', person_name: 'Ana', title: 'Passaporte' }),
        row(LEGACY_CHECKLIST, { item_id: 'IT-BBBBBB', case_id: 'CS-111111', title: 'Alojamento' })],
      Uploads: [Config.SCHEMA.Uploads],
      Events: [Config.SCHEMA.Events],
      People: [['person_id', 'case_id', 'name', 'role', 'birth_date', 'notes', 'folder_id', 'created_at', 'created_by'],
        ['PE-AAAAAA', 'CS-111111', 'Ana', 'main_applicant', '', '', 'FOLDER', '', 'portal']],
      // A checkbox column holds FALSE on every row of an empty tab: still no data.
      'Visa types': [['visa_type', 'name_pt', 'active', 'family'], ['', '', false, false], ['', '', false, false]],
      'Document lists': [['visa_type', 'title_pt', 'active'], ['F-X', 'Passaporte', true]],
    });
    const props = new Map([['LISTS_DROPDOWN', 'x']]);
    const ctx = { ss, lock: lock(), props: { deleteProperty: (k) => props.delete(k), getProperty: (k) => props.get(k) } };
    return { ss, ctx, props };
  }
  // Schema.ensure needs SpreadsheetApp; the step itself is what's under test.
  const step = (ctx) => lib.Migrations.STEPS[5](ctx);

  test('fills section from person_name, once, and keeps a section or formula already there', () => {
    const { ss, ctx } = legacySheet();
    ss.getSheetByName('Checklist').data[0].push('section');
    const t = lib.Table.open(ss, 'Checklist');
    t.append({ item_id: 'IT-CCCCCC', case_id: 'CS-111111', person_name: 'Pedro', section: 'Casa', title: 'NIF' });
    ss.getSheetByName('Checklist').data.push(row(LEGACY_CHECKLIST, { item_id: 'IT-DDDDDD', case_id: 'CS-111111', person_name: 'Rui', section: '=B5', title: 'X' }));
    step(ctx);
    step(ctx);
    // The cells themselves: items() would fall back to person_name anyway.
    expect(lib.Table.open(ss, 'Checklist').rows().map((r) => [r.person_name, r.section])).toEqual(
      [['Ana', 'Ana'], ['', ''], ['Pedro', 'Casa'], ['Rui', '=B5']]);
  });

  test('a 0.4.x CatalogData tab (JSON from A1, no header) is hidden, never deleted', () => {
    const { ss, ctx } = legacySheet();
    ss.sheets.push(new (require('./harness').FakeSheet)('CatalogData', [['{"visas":{}}']]));
    ss.sheets.push(new (require('./harness').FakeSheet)('Adjustments', [['visa_type', 'applies_to', 'doc_type', 'action']]));
    step(ctx);
    expect(ss.getSheetByName('CatalogData').isSheetHidden()).toBe(true);
    expect(ss.getSheetByName('Adjustments')).toBeNull();
  });

  test('retired tabs: deleted when empty, hidden with a note when they hold data', () => {
    const { ss, ctx, props } = legacySheet();
    step(ctx);
    expect(ss.getSheetByName('Visa types')).toBeNull();
    for (const name of ['People', 'Document lists']) {
      const sh = ss.getSheetByName(name);
      expect(sh.isSheetHidden()).toBe(true);
      expect(sh.note).toMatch(/0\.6\.0/);
    }
    expect(props.has('LISTS_DROPDOWN')).toBe(false);
    expect(ss.getSheetByName('Cases').validationsCleared).toBe(1);
    expect(() => step(ctx)).not.toThrow();
  });

  test('a sheet without any of the old tabs is fine', () => {
    const ss = new FakeSpreadsheet({
      Settings: [['key', 'value', 'description'], ['default_language', 'pt', '']],
      Cases: [Config.SCHEMA.Cases], Checklist: [Config.SCHEMA.Checklist],
    });
    expect(() => step({ ss, lock: lock(), props: { deleteProperty() {} } })).not.toThrow();
  });
});
