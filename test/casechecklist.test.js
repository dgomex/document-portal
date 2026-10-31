const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));
const lock = () => ({ tryLock: () => true, releaseLock() {} });

function firm() {
  const ss = new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['default_language', 'pt', ''], ['countries', 'PT', '']],
    Clients: [Config.SCHEMA.Clients, row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana Ferreira', email: 'ana@x.pt', active: true, provision_status: 'ACTIVE' })],
    Cases: [Config.SCHEMA.Cases, row(Config.SCHEMA.Cases, { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Residência', status: 'open', provision_status: 'ACTIVE', folder_id: 'F', visa_type: 'PT-D7' })],
    People: [Config.SCHEMA.People],
    Checklist: [Config.SCHEMA.Checklist],
    Adjustments: [Config.SCHEMA.Adjustments],
  });
  const ctx = { ss, lock: lock() };
  const sync = () => lib.CaseChecklist.sync(ctx, { now: Date.UTC(2026, 9, 31) });
  const items = () => lib.CaseChecklist.items(ss);
  const people = () => lib.CaseChecklist.people(ss);
  const caseRow = () => lib.Cases.list(ss)[0];
  return { ss, sync, items, people, caseRow };
}

test('setting a visa adds the main applicant and builds the list once', () => {
  const f = firm();
  const r = f.sync();
  expect(r).toMatchObject({ people: 1, built: 1, rebuilt: 0 });
  expect(f.people()).toEqual([expect.objectContaining({ name: 'Ana Ferreira', role: 'main_applicant', created_by: 'portal' })]);
  expect(f.items().length).toBe(9);
  expect(f.items().every((i) => /^IT-/.test(i.item_id) && i.status === 'missing')).toBe(true);
  expect(f.caseRow().checklist_version).toMatch(/^2026\.11\|/);
  expect(f.sync()).toEqual({ people: 0, requests: 0, built: 0, rebuilt: 0, stale: 0 });
});

test('adding a spouse rebuilds and keeps what was already received', () => {
  const f = firm();
  f.sync();
  const passport = f.items().find((i) => i.key.startsWith('PASSPORT|'));
  lib.Table.open(f.ss, 'Checklist').update(passport._row, { status: 'accepted', upload_ids: 'UP-AAAAAA' });
  lib.Table.open(f.ss, 'People').append({ case_id: 'CS-111111', name: 'Pedro', role: 'spouse', birth_date: '1979-02-10' });
  expect(f.sync()).toMatchObject({ people: 1, rebuilt: 1 });
  const all = f.items();
  expect(all.find((i) => i.key === passport.key)).toMatchObject({ status: 'accepted', upload_ids: 'UP-AAAAAA' });
  expect(all.some((i) => i.person_name === 'Pedro' && i.doc_type === 'CRIMINAL_RECORD')).toBe(true);
  expect(all.some((i) => i.key === 'RELATIONSHIP_PROOF|case')).toBe(true);
});

test('a change to the firm\'s list leaves existing cases alone until the lawyer clears checklist_version', () => {
  const f = firm();
  f.sync();
  lib.Table.open(f.ss, 'Adjustments').append({ visa_type: 'PT-D7', doc_type: 'CV', action: 'add' });
  expect(f.sync()).toMatchObject({ stale: 1, rebuilt: 0 });
  expect(f.items().some((i) => i.doc_type === 'CV')).toBe(false);
  lib.Cases.table(f.ss).update(f.caseRow()._row, { checklist_version: '' });
  expect(f.sync()).toMatchObject({ built: 1 });
  expect(f.items().some((i) => i.doc_type === 'CV')).toBe(true);
});

test('a row typed into Checklist becomes an ad-hoc request for that person', () => {
  const f = firm();
  lib.Table.open(f.ss, 'People').append({ case_id: 'CS-111111', name: 'Pedro', role: 'spouse' });
  f.sync();
  lib.Table.open(f.ss, 'Checklist').append({ case_id: 'CS-111111', person_name: 'pedro', title: 'Carta do senhorio' });
  expect(f.sync()).toMatchObject({ requests: 1 });
  const req = f.items().find((i) => i.title === 'Carta do senhorio');
  const pedro = f.people().find((p) => p.name === 'Pedro');
  expect(req).toMatchObject({ level: 'requested', status: 'missing', source: 'case', person_id: pedro.person_id });
  expect(req.key).toBe('REQ-' + req.item_id);
});

test('the client view groups items by person, then the case, without waived items', () => {
  const f = firm();
  lib.Table.open(f.ss, 'People').append({ case_id: 'CS-111111', name: 'Pedro', role: 'spouse' });
  f.sync();
  const photos = f.items().find((i) => i.doc_type === 'PHOTOS' && i.person_name === 'Pedro');
  lib.Table.open(f.ss, 'Checklist').update(photos._row, { level: 'waived' });
  const view = lib.CaseChecklist.view(f.ss, 'CS-111111', 'en');
  expect(view.map((g) => g.name || g.role)).toEqual(['Ana Ferreira', 'Pedro', 'case']);
  expect(view[1].items.some((i) => i.title === 'Passport photos (2)')).toBe(false);
  expect(view[0].items.find((i) => i.title === 'Criminal record certificate').instructions).toContain('Issued within the last 90 days.');
  expect(view[2].items.map((i) => i.title)).toEqual(expect.arrayContaining(['Accommodation in Portugal (1 year)', 'Marriage or civil partnership certificate']));
});

test('cases without a visa, or not provisioned yet, are skipped', () => {
  const f = firm();
  lib.Cases.table(f.ss).update(f.caseRow()._row, { visa_type: '' });
  expect(f.sync()).toMatchObject({ people: 0, built: 0 });
});
