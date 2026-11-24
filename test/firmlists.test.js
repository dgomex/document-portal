/**
 * Firm-owned visa types and document lists (0.5.0, schema 4). The numbers in
 * the test names are the acceptance criteria of issue #1.
 */
const fs = require('fs');
const path = require('path');
const { load, FakeSpreadsheet, SRC } = require('./harness');
const fixtures = require('./fixtures/lists');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));
const lock = () => ({ tryLock: () => true, releaseLock() {} });
const NOW = Date.UTC(2026, 10, 16);
const VT = 'Visa types';
const DL = 'Document lists';

class FakeProps {
  constructor() { this.m = {}; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
  deleteProperty(k) { delete this.m[k]; }
}
class FakeCache {
  constructor() { this.m = {}; this.puts = 0; }
  get(k) { return k in this.m ? this.m[k] : null; }
  put(k, v) { if (String(v).length > 100000) throw new Error('value over 100 KB'); this.m[k] = v; this.puts++; }
}

const ADJ_HEADERS = ['visa_type', 'applies_to', 'doc_type', 'action', 'level', 'title', 'note'];

/**
 * A firm at schema 3 (0.4.x): one client, cases as given, people, and, unless
 * fresh, the 0.4.x tabs: CatalogData (its stored lists, the fixture's two
 * visas) and Adjustments. Every SCHEMA tab exists, as Schema.ensure leaves it.
 */
function firm({ cases = [], people = [], adjustments = [], lang = 'pt', fresh = false } = {}) {
  const tabs = {};
  Object.keys(Config.SCHEMA).forEach((name) => { tabs[name] = [Config.SCHEMA[name]]; });
  tabs.Settings = [['key', 'value', 'description'], ['default_language', lang, ''], ['countries', 'PT', ''], ['schema_version', '3', '']];
  if (!fresh) {
    tabs.CatalogData = fixtures.catalogDataTab();
    tabs.Adjustments = [ADJ_HEADERS];
  }
  tabs.Clients.push(row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana Ferreira', email: 'ana@x.pt', language: 'en', active: true, provision_status: 'ACTIVE' }));
  cases.forEach((c) => tabs.Cases.push(row(Config.SCHEMA.Cases, Object.assign({ client_id: 'CL-AAAAAA', status: 'open', provision_status: 'ACTIVE', folder_id: 'F' }, c))));
  people.forEach((p) => tabs.People.push(row(Config.SCHEMA.People, p)));
  adjustments.forEach((a) => tabs.Adjustments.push(row(ADJ_HEADERS, a)));
  const ss = new FakeSpreadsheet(tabs);
  const ctx = { ss, lock: lock(), props: new FakeProps(), cache: new FakeCache() };
  const f = {
    ss, ctx,
    sync: () => lib.CaseChecklist.sync(ctx, { now: NOW }),
    // What 0.4.2 did for every case with a visa: build from the stored catalog + Adjustments.
    build042: () => {
      lib.CaseChecklist.sync(ctx, { now: NOW });  // schema 3: main applicants only
      const adj = ss.getSheetByName('Adjustments') ? lib.Table.open(ss, 'Adjustments').rows() : [];
      const peopleRows = lib.CaseChecklist.people(ss);
      const ids = new Set();
      const out = [];
      lib.Cases.list(ss).forEach((c) => {
        const visa = String(c.visa_type || '').trim();
        if (!visa) return;
        const casePeople = peopleRows.filter((p) => p.case_id === c.case_id && p.person_id);
        const visaAdj = adj.filter((a) => [visa, '*', ''].includes(String(a.visa_type || '').trim()));
        lib.Checklist.build({ requirements: lib.LegacyLists.requirements(fixtures.CATALOG_04, visa, visaAdj), facts: c.facts, people: casePeople, lang: 'pt', now: NOW })
          .forEach((item) => {
            const id = lib.Ids.generate('IT', ids);
            ids.add(id);
            out.push({ item_id: id, case_id: c.case_id, person_id: item.person_id, person_name: item.person_name, title: item.title,
              instructions: item.instructions, level: item.level, status: 'missing', doc_type: item.doc_type, key: item.key,
              source: item.source, text_json: JSON.stringify(item.text) });
          });
        lib.Cases.table(ss).update(c._row, { checklist_version: lib.LegacyLists.version(fixtures.CATALOG_04, visa, c.facts, casePeople, adj) });
      });
      lib.Table.open(ss, 'Checklist').appendMany(out);
    },
    migrate: () => { lib.Migrations.STEPS[4](ctx); lib.Settings.set(ss, 'schema_version', 4); lib.FirmLists.reset_(); },
    items: (caseId) => lib.CaseChecklist.items(ss).filter((i) => !caseId || i.case_id === caseId),
    caseRow: (id) => lib.Cases.list(ss).find((c) => c.case_id === id),
    types: () => lib.Table.open(ss, VT).rows(),
    docs: (visa) => lib.Table.open(ss, DL).rows().filter((r) => !visa || r.visa_type === visa),
    updateDoc: (r, partial) => { lib.Table.open(ss, DL).update(r._row, partial); lib.FirmLists.reset_(); },
    addType: (r) => { lib.Table.open(ss, VT).append(r); lib.FirmLists.reset_(); },
    addDoc: (r) => { lib.Table.open(ss, DL).append(r); lib.FirmLists.reset_(); },
    model: () => lib.FirmLists.check(ss).model,
    status: () => lib.CaseChecklist.status(ctx),
    receive: (item) => lib.Table.open(ss, 'Checklist').update(item._row, { status: 'received', upload_ids: 'UP-AAAAAA' }),
  };
  return f;
}

const family = [
  { person_id: 'PE-AAAAAA', case_id: 'CS-111111', name: 'Ana Ferreira', role: 'main_applicant', birth_date: '1980-05-01' },
  { person_id: 'PE-BBBBBB', case_id: 'CS-111111', name: 'Pedro', role: 'spouse', birth_date: '1979-02-10' },
  { person_id: 'PE-CCCCCC', case_id: 'CS-111111', name: 'Rita', role: 'child', birth_date: '2016-03-03' },
  { person_id: 'PE-DDDDDD', case_id: 'CS-111111', name: 'Rui', role: 'child', birth_date: '2008-01-01' },
];
const d7 = { case_id: 'CS-111111', case_name: 'D7', visa_type: 'PT-D7' };

/** What a client sees of an item: everything but where the requirement came from. */
const shape = (items) => items.map((i) => ({
  key: i.key, person_id: i.person_id, doc_type: i.doc_type, options: i.options, level: i.level,
  title: i.title, instructions: i.instructions, text: JSON.parse(JSON.stringify(i.text)),
}));
const allLangs = (text) => ['pt', 'en', 'es'].map((l) => [l, lib.Text.pick(text.title, l), lib.Text.pick(text.instructions, l),
  (text.options || []).map((o) => lib.Text.pick(o.title, l))]);

describe('1. no central catalog: a firm\'s lists are its own', () => {
  test('a new sheet starts with empty lists, and builds nothing until the firm has some', () => {
    const f = firm({ fresh: true, cases: [{ case_id: 'CS-111111', case_name: 'X', visa_type: 'PT-D7' }] });
    f.migrate();
    expect(f.types()).toEqual([]);
    expect(f.docs()).toEqual([]);
    expect(f.sync()).toMatchObject({ built: 0, unknown: 1 });
    expect(f.items()).toEqual([]);
    expect(f.status()).toMatchObject({ enabled: true, summary: { types: 0, documents: 0 }, unknown: [{ id: 'PT-D7', cases: 1 }] });
  });

  test('the library ships no catalog and fetches none', () => {
    const files = require('./harness').libraryFiles();
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/CATALOG_DATA|CatalogUpdates|raw\.githubusercontent|catalog\.json/);
    expect(files.some((file) => /catalog/i.test(path.relative(SRC, file)))).toBe(false);
    // The stored 0.4.x lists are read only by the schema 4 migration.
    const users = files.filter((file) => !/LegacyLists\.js$/.test(file) && /LegacyLists\.\w+\(/.test(fs.readFileSync(file, 'utf8')));
    expect(users.map((file) => path.relative(SRC, file).split(path.sep).join('/'))).toEqual(['admin/Migrations.js']);
  });

  test('a 0.4.x sheet gets the lists it stored, one row per type and per document', () => {
    const f = firm();
    f.migrate();
    expect(f.types().map((t) => t.visa_type)).toEqual(['PT-D7', 'PT-AR-98-2']);
    expect(f.docs().length).toBe(fixtures.rows(lib).docs.length);
    expect(f.docs().every((d) => d.check === 'ok')).toBe(true);
  });

  test('every stored visa, with a family and with and without facts, builds the same items as 0.4.2, in every language', () => {
    const f = firm();
    f.migrate();
    const model = f.model();
    const people = family.map((p) => Object.assign({}, p));
    const factSets = ['', fixtures.CATALOG_04.facts.map((x) => x.id).join(';')];
    let compared = 0;
    fixtures.CATALOG_04.countries.PT.visas.forEach((v) => {
      factSets.forEach((facts) => {
        ['pt', 'en'].forEach((lang) => {
          const before = lib.Checklist.build({ requirements: lib.LegacyLists.requirements(fixtures.CATALOG_04, v.id, []), facts, people, lang, now: NOW });
          const after = lib.Checklist.build({ requirements: model.visas[v.id].requirements, facts, people, lang, now: NOW });
          expect([v.id, shape(after).map((i) => [i.key, i.person_id, i.doc_type, i.options, i.level, i.title])])
            .toEqual([v.id, shape(before).map((i) => [i.key, i.person_id, i.doc_type, i.options, i.level, i.title])]);
          expect([v.id, after.map((i) => allLangs(i.text))]).toEqual([v.id, before.map((i) => allLangs(i.text))]);
          compared += after.length;
        });
      });
    });
    expect(compared).toBeGreaterThan(100);
  });

  test('a D7 case with spouse and children builds the same rows through the sync as 0.4.2 did', () => {
    const before = firm({ cases: [d7], people: family });
    before.build042();
    const after = firm({ cases: [d7], people: family });
    after.migrate();
    after.sync();
    const rowsOf = (f) => f.items().map((i) => [i.key, i.person_id, i.title, i.instructions, i.level, i.doc_type, i.text_json])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(rowsOf(after)).toEqual(rowsOf(before));
  });
});

describe('2. migration of a schema 3 sheet', () => {
  const adjustments = [
    { visa_type: 'PT-D7', doc_type: 'PHOTOS', action: 'hide' },
    { visa_type: 'PT-D7', doc_type: 'CRIMINAL_RECORD', action: 'change', level: 'optional', title: 'Registo criminal apostilado', note: 'Com apostila.' },
    { visa_type: 'PT-D7', doc_type: 'Carta do senhorio', action: 'add', level: 'required' },
  ];
  const cases = [
    { case_id: 'CS-111111', case_name: 'Current', visa_type: 'PT-D7' },
    { case_id: 'CS-222222', case_name: 'Not built', visa_type: '' },
    { case_id: 'CS-333333', case_name: 'Stale', visa_type: 'PT-D7' },
    { case_id: 'CS-444444', case_name: 'People changed', visa_type: 'PT-D7' },
  ];
  const people = [
    { person_id: 'PE-AAAAAA', case_id: 'CS-111111', name: 'Ana Ferreira', role: 'main_applicant' },
    { person_id: 'PE-BBBBBB', case_id: 'CS-111111', name: 'Pedro', role: 'spouse' },
    { person_id: 'PE-CCCCCC', case_id: 'CS-333333', name: 'Ana Ferreira', role: 'main_applicant' },
    { person_id: 'PE-DDDDDD', case_id: 'CS-444444', name: 'Ana Ferreira', role: 'main_applicant' },
  ];

  function migrated() {
    const f = firm({ cases, people, adjustments });
    f.build042();  // 0.4.2 built every case with a visa
    // Case 2 gets its visa after the build; case 3 goes stale (an older catalog version); case 4 gains a spouse.
    lib.Cases.table(f.ss).update(f.caseRow('CS-222222')._row, { visa_type: 'PT-D7' });
    const stale = f.caseRow('CS-333333').checklist_version.split('|');
    lib.Cases.table(f.ss).update(f.caseRow('CS-333333')._row, { checklist_version: ['2026.10.1', stale[1], stale[2]].join('|') });
    lib.Table.open(f.ss, 'People').append({ person_id: 'PE-EEEEEE', case_id: 'CS-444444', name: 'Rui', role: 'spouse' });
    const before = JSON.stringify(f.ss.getSheetByName('Checklist').data);
    const versions = Object.fromEntries(lib.Cases.list(f.ss).map((c) => [c.case_id, c.checklist_version]));
    f.migrate();
    return { f, before, versions };
  }

  test('tabs are seeded with the Adjustments applied, in all three languages', () => {
    const { f } = migrated();
    const d7docs = f.docs('PT-D7');
    expect(d7docs.find((d) => d.doc_key === 'PHOTOS').active).toBe(false);
    const crim = d7docs.find((d) => d.doc_key === 'CRIMINAL_RECORD');
    expect(crim).toMatchObject({ level: 'optional', title_pt: 'Registo criminal apostilado', title_en: 'Registo criminal apostilado', title_es: 'Registo criminal apostilado' });
    ['pt', 'en', 'es'].forEach((l) => expect(crim['instructions_' + l]).toContain('Com apostila.'));
    expect(d7docs.find((d) => d.doc_key === 'FIRM-CARTA_DO_SENHORIO')).toMatchObject({ title_pt: 'Carta do senhorio', active: true });
    expect(f.ss.getSheetByName('Adjustments').isSheetHidden()).toBe(true);
    expect(f.ss.getSheetByName('CatalogData').isSheetHidden()).toBe(true);
  });

  test('no Checklist row changes; each case state migrates as it should', () => {
    const { f, before, versions } = migrated();
    expect(JSON.stringify(f.ss.getSheetByName('Checklist').data)).toBe(before);
    const model = f.model();
    const d7hash = model.visas['PT-D7'].listHash;
    expect(f.caseRow('CS-111111').checklist_version).toBe(d7hash + '|' + versions['CS-111111'].split('|')[2]);
    expect(f.caseRow('CS-222222').checklist_version).toBe('');
    expect(f.caseRow('CS-333333').checklist_version).toBe('legacy|' + versions['CS-333333'].split('|')[2]);
    expect(f.caseRow('CS-444444').checklist_version).toBe('legacy|' + versions['CS-444444'].split('|')[2]);
    // The next sync builds the unbuilt case and rebuilds the changed one; the current one is untouched.
    expect(f.sync()).toMatchObject({ built: 1, rebuilt: 1, stale: 1 });
    expect(f.items('CS-444444').some((i) => i.person_name === 'Rui')).toBe(true);
    // Then only the stale case shows as using an older list.
    expect(f.status().visas).toEqual([expect.objectContaining({ id: 'PT-D7', older: 1 })]);
  });

  test('running it twice changes nothing', () => {
    const { f } = migrated();
    const snapshot = () => JSON.stringify([VT, DL, 'Cases', 'Checklist'].map((t) => f.ss.getSheetByName(t).data));
    const once = snapshot();
    f.migrate();
    expect(snapshot()).toBe(once);
  });

  test('a refresh of the current case gives zero creates and zero waives', () => {
    const { f } = migrated();
    const model = f.model();
    const c = f.caseRow('CS-111111');
    const casePeople = lib.CaseChecklist.people(f.ss).filter((p) => p.case_id === c.case_id);
    const fresh = lib.Checklist.build({ requirements: model.visas['PT-D7'].requirements, facts: c.facts, people: casePeople, lang: 'pt', now: NOW });
    const plan = lib.Checklist.merge(f.items('CS-111111'), fresh, 'pt');
    expect(plan.create).toEqual([]);
    expect(plan.update.filter((u) => u.partial.level === 'waived')).toEqual([]);
  });
});

describe('3. keys', () => {
  test('groups keep the catalog key, Adjustment additions their FIRM- key', () => {
    const f = firm({ adjustments: [{ visa_type: 'PT-D7', doc_type: 'Carta do senhorio', action: 'add' }] });
    f.migrate();
    const acc = f.docs('PT-D7').filter((d) => d.group_key === 'ACCOMMODATION');
    expect(acc.map((d) => d.doc_key)).toEqual(['PROPERTY_DEED', 'RENTAL_AGREEMENT', 'HOST_TERM']);
    expect(acc[0]).toMatchObject({ group_pt: 'Alojamento em Portugal (1 ano)', group_en: 'Accommodation in Portugal (1 year)' });
    expect(acc.every((d) => d.instructions_pt === '' && d.check_criteria !== undefined)).toBe(true);
    expect(f.docs('PT-D7').some((d) => d.doc_key === 'FIRM-CARTA_DO_SENHORIO')).toBe(true);
  });

  test('PT-AR-98-2 keeps the same key for spouse and each child, with no warning', () => {
    const f = firm();
    f.migrate();
    f.model();
    const rows = f.docs('PT-AR-98-2').filter((d) => ['PASSPORT_VALID', 'LEGAL_ENTRY_PROOF'].includes(d.doc_key));
    expect(rows.map((d) => d.applies_to).sort()).toEqual(['each_child', 'each_child', 'spouse', 'spouse']);
    expect(rows.every((d) => d.check === 'ok')).toBe(true);
  });

  test('a copied row gets a new key and a warning; overlapping applies_to counts as one scope', () => {
    const f = firm();
    f.migrate();
    const passport = f.docs('PT-D7').find((d) => d.doc_key === 'PASSPORT');
    const copy = (extra) => { const c = Object.assign({}, passport, { check: '' }, extra); delete c._row; return c; };
    f.addDoc(copy({}));
    f.addDoc(copy({ applies_to: 'each_person' }));
    f.model();
    const copies = f.docs('PT-D7').filter((d) => d.title_pt === passport.title_pt);
    expect(copies[0].doc_key).toBe('PASSPORT');
    expect(copies.slice(1).map((d) => d.doc_key)).toEqual(['PASSPORT_2', 'PASSPORT_3']);
    expect(copies.slice(1).every((d) => d.check.includes('Chave copiada da linha ' + passport._row))).toBe(true);
  });

  test('a group whose rows disagree uses its first row, and the others warn', () => {
    const f = firm();
    f.migrate();
    const second = f.docs('PT-D7').filter((d) => d.group_key === 'ACCOMMODATION')[1];
    f.updateDoc(second, { level: 'optional', group_en: 'Housing' });
    const req = f.model().visas['PT-D7'].requirements.find((r) => r.key === 'ACCOMMODATION');
    expect(req.level).toBe('required');
    expect(req.text.title.en).toBe('Accommodation in Portugal (1 year)');
    expect(f.docs('PT-D7').filter((d) => d.group_key === 'ACCOMMODATION')[1].check).toContain('Difere da primeira linha do grupo');
  });
});

describe('4. a new process type typed by name only', () => {
  test('ID generated, offered in the dropdown, built in PT with EN/ES falling back to PT', () => {
    const f = firm({ cases: [{ case_id: 'CS-555555', case_name: 'Renovação' }] });
    f.migrate();
    f.addType({ name_pt: 'Art. 92 menor renovação', active: true, facts_to_ask: 'meios_a' });
    ['Passaporte do menor', 'Autorização dos pais'].forEach((t) => f.addDoc({ visa_type: 'Art. 92 menor renovação', title_pt: t, active: true }));
    f.addDoc({ visa_type: 'art. 92 MENOR renovação', title_pt: 'Contrato de arrendamento', group_pt: 'Alojamento', active: true });
    f.addDoc({ visa_type: 'Art. 92 menor renovação', title_pt: 'Atestado da junta', group_pt: 'Alojamento', active: true, only_if: 'meios_a' });
    const model = f.model();
    const id = 'F-ART-92-MENOR-RENOVACAO';
    expect(f.types().find((t) => t.name_pt === 'Art. 92 menor renovação').visa_type).toBe(id);
    expect(f.docs(id)).toHaveLength(4);
    expect(f.docs(id).map((d) => d.doc_key)).toEqual(['FIRM-PASSAPORTE_DO_MENOR', 'FIRM-AUTORIZACAO_DOS_PAIS', 'FIRM-CONTRATO_DE_ARRENDAMENTO', 'FIRM-ATESTADO_DA_JUNTA']);
    expect(new Set(f.docs(id).slice(2).map((d) => d.group_key))).toEqual(new Set(['FIRM-G-ALOJAMENTO']));
    expect(lib.FirmLists.dropdownIds(model, [])).toContain(id);
    expect(f.docs(id)[3].check).toContain('Difere da primeira linha do grupo');  // only_if differs from the group's first row
    lib.Cases.table(f.ss).update(f.caseRow('CS-555555')._row, { visa_type: id });
    expect(f.sync()).toMatchObject({ built: 1 });
    const view = lib.CaseChecklist.view(f.ss, 'CS-555555', 'en');
    const titles = view.flatMap((g) => g.items.map((i) => i.title));
    expect(titles).toEqual(['Passaporte do menor', 'Autorização dos pais', 'Alojamento']);
    expect(view.flatMap((g) => g.items).find((i) => i.title === 'Alojamento').options).toEqual(['Contrato de arrendamento', 'Atestado da junta']);
  });

  test('a typed ID of the firm\'s own type is normalised with the F- prefix', () => {
    expect(lib.FirmLists.ownId('ar 92 menor')).toBe('F-AR-92-MENOR');
    expect(lib.FirmLists.ownId('F-AR-92')).toBe('F-AR-92');
    // A typed ID that is already valid stays as typed (0.4.x cases use PT-D7).
    const m = lib.FirmLists.process([{ _row: 2, visa_type: 'PT-D7', name_pt: 'D7', active: true }], [], 'pt');
    expect(m.writes.types.filter((w) => 'visa_type' in w.partial)).toEqual([]);
    expect(lib.FirmLists.ownId('Renovação à pressa!')).toBe('F-RENOVACAO-A-PRESSA');
  });
});

describe('5–6. editing a list, and Update these cases', () => {
  function withReceived() {
    const f = firm({ cases: [d7, { case_id: 'CS-666666', case_name: 'Other', visa_type: 'PT-AR-98-2' }], people: family.slice(0, 1) });
    f.migrate();
    f.sync();
    return f;
  }

  test('renaming a group or a title keeps a received document received', () => {
    const f = withReceived();
    const acc = f.items('CS-111111').find((i) => i.key === 'ACCOMMODATION|case');
    const passport = f.items('CS-111111').find((i) => i.key.startsWith('PASSPORT|'));
    f.receive(acc);
    f.receive(passport);
    f.docs('PT-D7').filter((d) => d.group_key === 'ACCOMMODATION').forEach((d) => f.updateDoc(d, { group_pt: 'Onde vai morar' }));
    f.updateDoc(f.docs('PT-D7').find((d) => d.doc_key === 'PASSPORT'), { title_pt: 'Passaporte (todas as páginas)' });
    expect(lib.CaseChecklist.refresh(f.ctx, 'PT-D7', { now: NOW })).toMatchObject({ updated: 1, created: 0, waived: 0 });
    const after = f.items('CS-111111');
    expect(after.find((i) => i.key === 'ACCOMMODATION|case')).toMatchObject({ status: 'received', title: 'Onde vai morar' });
    expect(after.find((i) => i.key === passport.key)).toMatchObject({ status: 'received', title: 'Passaporte (todas as páginas)' });
  });

  test('a client-facing edit marks only that type\'s cases as older; check_criteria and notes mark none', () => {
    const f = withReceived();
    f.updateDoc(f.docs('PT-D7').find((d) => d.doc_key === 'PASSPORT'), { check_criteria: 'Válido 6 meses' });
    lib.Table.open(f.ss, VT).update(f.types().find((t) => t.visa_type === 'PT-D7')._row, { notes: 'só Lisboa' });
    lib.FirmLists.reset_();
    expect(f.status().visas).toEqual([]);
    expect(f.sync()).toMatchObject({ stale: 0 });
    f.updateDoc(f.docs('PT-D7').find((d) => d.doc_key === 'PASSPORT'), { instructions_pt: 'Todas as páginas.' });
    expect(f.status().visas).toEqual([expect.objectContaining({ id: 'PT-D7', older: 1 })]);
    expect(f.sync()).toMatchObject({ stale: 1, rebuilt: 0 });
  });

  test('Update these cases: new items appear, removed ones are waived, received ones stay, other types untouched', () => {
    const f = withReceived();
    const passport = f.items('CS-111111').find((i) => i.key.startsWith('PASSPORT|'));
    const photos = f.items('CS-111111').find((i) => i.key.startsWith('PHOTOS|'));
    f.receive(passport);
    const otherBefore = JSON.stringify(f.items('CS-666666'));
    f.updateDoc(f.docs('PT-D7').find((d) => d.doc_key === 'PHOTOS'), { active: false });
    f.addDoc({ visa_type: 'PT-D7', title_pt: 'Curriculum vitae', active: true });
    expect(lib.CaseChecklist.refresh(f.ctx, 'PT-D7', { now: NOW })).toEqual({ updated: 1, created: 1, waived: 1 });
    const after = f.items('CS-111111');
    expect(after.find((i) => i.item_id === photos.item_id)).toMatchObject({ level: 'waived', reason: lib.I18n.t('pt', 'checklist.noLongerApplies') });
    expect(after.find((i) => i.item_id === passport.item_id)).toMatchObject({ status: 'received' });
    expect(after.some((i) => i.title === 'Curriculum vitae' && i.status === 'missing')).toBe(true);
    expect(JSON.stringify(f.items('CS-666666'))).toBe(otherBefore);
    expect(f.status().visas).toEqual([]);
  });
});

describe('7. check_criteria stays with the lawyer', () => {
  test('never in the Checklist columns, the client view or reminders', () => {
    const f = firm({ cases: [d7], people: family.slice(0, 1) });
    f.migrate();
    f.docs('PT-D7').forEach((d) => f.updateDoc(d, { check_criteria: 'SEGREDO-INTERNO' }));
    f.sync();
    const sheet = JSON.stringify(f.ss.getSheetByName('Checklist').data);
    expect(sheet).not.toContain('SEGREDO-INTERNO');
    ['pt', 'en', 'es'].forEach((l) => expect(JSON.stringify(lib.CaseChecklist.view(f.ss, 'CS-111111', l))).not.toContain('SEGREDO-INTERNO'));
    const pending = lib.Reminders.pending(f.ss, 'CS-111111', 'pt');
    expect(JSON.stringify(lib.Reminders.message('pt', { name: 'Ana', firm: 'F', items: pending, url: '' }))).not.toContain('SEGREDO-INTERNO');
    // Seeded option guidance (the catalog's) is check_criteria too, so it stays off the page.
    const deed = f.docs('PT-D7').find((d) => d.doc_key === 'PROPERTY_DEED');
    expect(deed.instructions_pt).toBe('');
  });
});

describe('8. validation', () => {
  function checked(docs, types) {
    const f = firm({ cases: [{ case_id: 'CS-777777', case_name: 'Gone', visa_type: 'F-GONE' }] });
    f.migrate();
    (types || []).forEach((t) => f.addType(t));
    docs.forEach((d) => f.addDoc(d));
    const out = lib.FirmLists.check(f.ss);
    return { f, out, check: (title) => f.docs().find((d) => d.title_pt === title).check };
  }

  test.each([
    [{ visa_type: 'Não existe', title_pt: 'A', active: true }, 'Tipo de processo desconhecido'],
    [{ visa_type: 'PT-D7', title_pt: 'B', applies_to: 'everyone', active: true }, 'applies_to inválido'],
    [{ visa_type: 'PT-D7', title_pt: 'C', level: 'maybe', active: true }, 'level inválido'],
    [{ visa_type: 'PT-D7', title_en: 'Only English', title_pt: '', active: true }, 'Falta o título em pt'],
    [{ visa_type: 'PT-D7', title_pt: 'D', min_age: 'dezoito', active: true }, 'min_age tem de ser um número'],
  ])('error: %j', (doc, message) => {
    const { f } = checked([doc]);
    const r = f.docs().find((d) => d.title_pt === doc.title_pt && (doc.title_pt || d.title_en === doc.title_en));
    expect(r.check).toContain(message);
  });

  test.each([
    [{ visa_type: 'PT-D7', title_pt: 'E', active: true }, 'Sem texto em EN, ES'],
    [{ visa_type: 'PT-D7', title_pt: 'F', title_en: 'F', title_es: 'F', only_if: 'meios_z', active: true }, 'facts_to_ask'],
    [{ visa_type: 'PT-D7', title_pt: 'G', title_en: 'G', title_es: 'G', group_pt: 'Sozinho', active: true }, 'Grupo com um só documento'],
  ])('warning: %j', (doc, message) => {
    const { f, check } = checked([doc]);
    expect(check(doc.title_pt)).toContain(message);
    expect(f.model().visas['PT-D7'].requirements.some((r) => r.text.title.pt === doc.title_pt)).toBe(true);  // still used
  });

  test('two types with the same ID: the second is skipped; a broken row never stops the others', () => {
    const { f, out } = checked([{ visa_type: 'PT-D7', title_pt: 'H', level: 'nope', active: true }],
      [{ visa_type: 'F-DUP', name_pt: 'Um', active: true }, { visa_type: 'f dup', name_pt: 'Dois', active: true },
        { visa_type: 'PT-D7', name_pt: 'Outro D7', active: true }, { visa_type: 'meu d7', name_pt: 'Meu D7', active: true }]);
    expect(f.types().find((t) => t.name_pt === 'Dois').check).toContain('já existe noutra linha');
    expect(f.types().find((t) => t.name_pt === 'Outro D7').check).toContain('já existe noutra linha');
    expect(f.types().find((t) => t.name_pt === 'Meu D7').visa_type).toBe('F-MEU-D7');  // typed free text is normalised
    expect(out.model.visas['PT-D7'].requirements.length).toBeGreaterThan(5);
    expect(out.summary.errors).toBeGreaterThan(0);
  });

  test('a case whose type is not in Visa types is reported and keeps its list', () => {
    const { f } = checked([]);
    expect(f.status().unknown).toEqual([{ id: 'F-GONE', cases: 1 }]);
    expect(f.sync()).toMatchObject({ unknown: 1, built: 0 });
  });

  test('a deactivated type stays in the dropdown while a case uses it', () => {
    const f = firm();
    f.migrate();
    lib.Table.open(f.ss, VT).update(f.types().find((t) => t.visa_type === 'PT-D7')._row, { active: false });
    lib.FirmLists.reset_();
    const model = f.model();
    expect(lib.FirmLists.dropdownIds(model, [])).not.toContain('PT-D7');
    expect(lib.FirmLists.dropdownIds(model, ['PT-D7'])).toContain('PT-D7');
  });

  test('a type with no valid rows is not offered, and its cases are not waived', () => {
    const f = firm({ cases: [d7], people: family.slice(0, 1) });
    f.migrate();
    f.sync();
    f.docs('PT-D7').forEach((d) => f.updateDoc(d, { active: false }));
    const model = f.model();
    expect(model.visas['PT-D7'].offer).toBe(false);
    expect(lib.FirmLists.dropdownIds(model, [])).not.toContain('PT-D7');
    const before = JSON.stringify(f.items());
    f.sync();
    expect(JSON.stringify(f.items())).toBe(before);
  });
});

describe('9. cache', () => {
  test('the library never calls CacheService itself', () => {
    const files = require('./harness').libraryFiles();
    const calls = files.filter((file) => /\bCacheService\s*\./.test(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(calls.map((file) => path.relative(SRC, file).split(path.sep).join('/'))).toEqual([]);
  });

  test('lists over 100 KB round-trip through parts; a missing part means a rebuild', () => {
    const f = firm();
    f.migrate();
    const long = 'Instruções detalhadas para o cliente. '.repeat(60);
    lib.Table.open(f.ss, DL).appendMany(Array.from({ length: 80 }, (_, i) => ({ visa_type: 'PT-D7', title_pt: 'Documento ' + i, instructions_pt: long, active: true })));
    lib.FirmLists.check(f.ss);
    lib.FirmLists.reset_();
    const fresh = lib.FirmLists.get(f.ss, f.ctx.cache);
    const keys = Object.keys(f.ctx.cache.m);
    const index = keys.find((k) => /^lists:[0-9a-f]+$/.test(k));
    expect(Number(f.ctx.cache.m[index])).toBeGreaterThan(1);  // more than 100 KB, in parts
    lib.FirmLists.reset_();
    const puts = f.ctx.cache.puts;
    expect(lib.FirmLists.get(f.ss, f.ctx.cache)).toEqual(fresh);
    expect(f.ctx.cache.puts).toBe(puts);  // served from the cache
    delete f.ctx.cache.m[index + ':1'];
    lib.FirmLists.reset_();
    expect(lib.FirmLists.get(f.ss, f.ctx.cache)).toEqual(fresh);
    expect(f.ctx.cache.puts).toBeGreaterThan(puts);  // rebuilt from the tabs
  });
});

describe('10. the firm\'s lists change only when the firm changes them', () => {
  test('nothing in the portal rewrites the lists: a sync and a refresh leave the rows as they are', () => {
    const f = firm({ cases: [d7], people: family.slice(0, 1) });
    f.migrate();
    f.model();
    const before = JSON.stringify([f.ss.getSheetByName(VT).data, f.ss.getSheetByName(DL).data]);
    f.sync();
    lib.CaseChecklist.refresh(f.ctx, 'PT-D7', { now: NOW });
    expect(JSON.stringify([f.ss.getSheetByName(VT).data, f.ss.getSheetByName(DL).data])).toBe(before);
  });
});

describe('formula safety of what the portal writes', () => {
  test.each([
    ['=SUM(1)', "'=SUM(1)"],
    ['+351 912 000 000', "'+351 912 000 000"],
    ['- Passaporte', "'- Passaporte"],
    ['@x', "'@x"],  // a formula in Excel, where lawyers export to
    ['Passaporte - cópia', 'Passaporte - cópia'],
  ])('Sanitize.cell(%j)', (input, out) => expect(lib.Sanitize.cell(input)).toBe(out));
});

describe('the sheet sidebar', () => {
  test('its script parses and declares each function once', () => {
    const html = fs.readFileSync(path.join(SRC, 'html', 'update.html'), 'utf8');
    const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>')).replace('<?!= boot ?>', '{}');
    expect(() => new Function(js)).not.toThrow();
    const names = [...js.matchAll(/function (\w+)\s*\(/g)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    expect(html).not.toMatch(/catalog/i);
  });
});

describe('the dev seed', () => {
  test('gives the test firm its own demo lists, and its cases build from them', () => {
    const f = firm({ fresh: true });
    f.migrate();
    lib.Settings.set(f.ss, 'dev_mode', 'TRUE');
    expect(lib.Seed.run(f.ss, 'dev@example.com')).toBe(4);
    expect(f.types().map((t) => t.visa_type)).toEqual(['F-DEMO-D7', 'F-DEMO-AR']);
    expect(f.docs().every((d) => d.check === 'ok')).toBe(true);
    lib.Cases.list(f.ss).forEach((c) => lib.Cases.table(f.ss).update(c._row, { provision_status: 'ACTIVE' }));
    expect(f.sync().built).toBeGreaterThan(0);
    const view = lib.CaseChecklist.view(f.ss, lib.Cases.list(f.ss)[0].case_id, 'en');
    expect(view.flatMap((g) => g.items.map((i) => i.title))).toContain('Valid passport');
    expect(JSON.stringify(view)).not.toContain('apostilado');  // check_criteria stays with the lawyer
  });
});

describe('review fixes (PR #2)', () => {
  test('#1 a case whose process type breaks still shows its list on the client page', () => {
    const f = firm({ cases: [d7], people: family.slice(0, 1) });
    f.migrate();
    f.sync();
    // The lawyer clears the type's name in the firm's language: the type drops out of the model.
    lib.Table.open(f.ss, VT).update(f.types().find((t) => t.visa_type === 'PT-D7')._row, { name_pt: '' });
    lib.FirmLists.reset_();
    expect(lib.FirmLists.visa(f.model(), 'PT-D7')).toBeNull();
    const client = lib.Clients.list(f.ss)[0];
    const me = lib.me_(Object.assign({}, f.ctx, { ss: f.ss }), client, 'pt');
    expect(me.cases[0].visa).toBe('');
    expect(me.cases[0].checklist.flatMap((g) => g.items).length).toBe(f.items('CS-111111').length);
  });

  test('#2 a group copied for people who never overlap is its own group; copied with other text, a new group', () => {
    const f = firm({ cases: [d7], people: family });
    f.migrate();
    const add = (r) => f.addDoc(Object.assign({ visa_type: 'PT-D7', active: true }, r));
    add({ applies_to: 'spouse', title_pt: 'Extrato bancário', group_pt: 'Meios', doc_key: 'FIRM-EXTRATO', group_key: 'FIRM-G-MEIOS' });
    add({ applies_to: 'spouse', title_pt: 'IRS', group_pt: 'Meios', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
    // Copied for each child (keys copied too): a separate group, same key; items differ by person.
    add({ applies_to: 'each_child', title_pt: 'Extrato bancário', group_pt: 'Meios', doc_key: 'FIRM-EXTRATO', group_key: 'FIRM-G-MEIOS' });
    add({ applies_to: 'each_child', title_pt: 'IRS', group_pt: 'Meios', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
    // Copied for the spouse again and renamed: a new group with a new key.
    add({ applies_to: 'spouse', title_pt: 'Extrato bancário', group_pt: 'Rendimentos', doc_key: 'FIRM-EXTRATO', group_key: 'FIRM-G-MEIOS' });
    add({ applies_to: 'spouse', title_pt: 'IRS', group_pt: 'Rendimentos', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
    const reqs = f.model().visas['PT-D7'].requirements.filter((r) => /^FIRM-G-MEIOS/.test(r.key));
    expect(reqs.map((r) => [r.key, r.applies_to, r.any_of])).toEqual([
      ['FIRM-G-MEIOS', 'spouse', ['FIRM-EXTRATO', 'FIRM-IRS']],
      ['FIRM-G-MEIOS', 'each_child', ['FIRM-EXTRATO', 'FIRM-IRS']],
      ['FIRM-G-MEIOS_2', 'spouse', ['FIRM-EXTRATO', 'FIRM-IRS']],
    ]);
    expect(f.docs('PT-D7').filter((d) => d.group_pt === 'Rendimentos').every((d) => d.group_key === 'FIRM-G-MEIOS_2' && /Chave copiada/.test(d.check))).toBe(true);
    // An option copied inside its own group (same text) is an extra option, not a new group.
    add({ applies_to: 'spouse', title_pt: 'Declaração da entidade patronal', group_pt: 'Meios', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
    expect(f.model().visas['PT-D7'].requirements.find((r) => r.key === 'FIRM-G-MEIOS' && r.applies_to === 'spouse').any_of).toEqual(['FIRM-EXTRATO', 'FIRM-IRS', 'FIRM-IRS_2']);
    f.sync();
    const items = f.items('CS-111111').filter((i) => /^FIRM-G-MEIOS/.test(i.key)).map((i) => i.key).sort();
    expect(items).toEqual(['FIRM-G-MEIOS_2|PE-BBBBBB', 'FIRM-G-MEIOS|PE-BBBBBB', 'FIRM-G-MEIOS|PE-CCCCCC', 'FIRM-G-MEIOS|PE-DDDDDD']);
  });

  test('#3 opening the sidebar writes nothing; Verificar writes under the script lock', () => {
    const f = firm();
    f.migrate();
    f.addDoc({ visa_type: 'PT-D7', title_pt: 'Novo documento', active: true });
    const before = JSON.stringify(f.ss.getSheetByName(DL).data);
    lib.CaseChecklist.status(f.ctx);
    expect(JSON.stringify(f.ss.getSheetByName(DL).data)).toBe(before);
    let locked = false;
    const ctx = Object.assign({}, f.ctx, { lock: { tryLock: () => { locked = true; return true; }, releaseLock() { locked = false; } } });
    lib.CaseChecklist.status(ctx, { write: true });
    expect(f.docs('PT-D7').find((d) => d.title_pt === 'Novo documento').doc_key).toBe('FIRM-NOVO_DOCUMENTO');
    expect(locked).toBe(false);
    const busy = Object.assign({}, f.ctx, { lock: { tryLock: () => false, releaseLock() {} } });
    expect(() => lib.CaseChecklist.status(busy, { write: true })).toThrow(expect.objectContaining({ code: 'busy' }));
  });

  test('#5 a 0.4.x sheet with built cases but no stored lists is logged, and its cases keep their rows', () => {
    const f = firm({ fresh: true, cases: [d7], people: family.slice(0, 1) });
    lib.Cases.table(f.ss).update(f.caseRow('CS-111111')._row, { checklist_version: '2026.11.1|abc|def' });
    f.migrate();
    expect(lib.Table.open(f.ss, 'Events').rows().map((e) => e.type)).toContain('lists_migration_no_stored_lists');
    expect(f.caseRow('CS-111111').checklist_version).toBe('2026.11.1|abc|def');
  });

  test('#7 a condition with a space is an error, so the document is never silently lost', () => {
    const f = firm();
    f.migrate();
    f.addDoc({ visa_type: 'PT-D7', title_pt: 'Contrato', only_if: 'meios a', active: true });
    f.model();
    expect(f.docs('PT-D7').find((d) => d.title_pt === 'Contrato').check).toContain('Condição inválida: "meios a"');
  });

  test('#7b an accented condition is fine; a fact asked with a space gets a warning on its type', () => {
    const f = firm({ cases: [Object.assign({}, d7, { facts: 'união_estável' })], people: family.slice(0, 1) });
    f.migrate();
    lib.Table.open(f.ss, VT).update(f.types().find((t) => t.visa_type === 'PT-D7')._row, { facts_to_ask: 'união_estável; meios a' });
    lib.FirmLists.reset_();
    f.addDoc({ visa_type: 'PT-D7', title_pt: 'Declaração de união estável', only_if: 'união_estável', active: true });
    const req = f.model().visas['PT-D7'].requirements.find((r) => r.text.title.pt === 'Declaração de união estável');
    expect(req.only_if).toEqual(['união_estável']);
    expect(f.docs('PT-D7').find((d) => d.title_pt === 'Declaração de união estável').check).not.toContain('Condição inválida');
    expect(f.types().find((t) => t.visa_type === 'PT-D7').check).toContain('Condição inválida: "meios a"');
    expect(f.model().visas['PT-D7']).toBeTruthy();  // a warning: the type still works
    f.sync();
    expect(f.items('CS-111111').map((i) => i.title)).toContain('Declaração de união estável');
  });

  test('A: a group copied for people that overlap (main_applicant -> each_adult) is a new group, not extra options', () => {
    const f = firm({ cases: [d7], people: family });
    f.migrate();
    const add = (r) => f.addDoc(Object.assign({ visa_type: 'PT-D7', active: true, group_pt: 'Meios', group_key: 'FIRM-G-MEIOS' }, r));
    add({ applies_to: 'main_applicant', title_pt: 'Extrato', doc_key: 'FIRM-EXTRATO' });
    add({ applies_to: 'main_applicant', title_pt: 'IRS', doc_key: 'FIRM-IRS' });
    add({ applies_to: 'each_adult', title_pt: 'Extrato', doc_key: 'FIRM-EXTRATO' });
    add({ applies_to: 'each_adult', title_pt: 'IRS', doc_key: 'FIRM-IRS' });
    const reqs = f.model().visas['PT-D7'].requirements.filter((r) => /^FIRM-G-MEIOS/.test(r.key));
    expect(reqs.map((r) => [r.key, r.applies_to, r.any_of])).toEqual([
      ['FIRM-G-MEIOS', 'main_applicant', ['FIRM-EXTRATO', 'FIRM-IRS']],
      ['FIRM-G-MEIOS_2', 'each_adult', ['FIRM-EXTRATO', 'FIRM-IRS']],
    ]);
    expect(f.docs('PT-D7').filter((d) => d.applies_to === 'each_adult' && d.group_pt === 'Meios').map((d) => [d.group_key, /Chave copiada/.test(d.check)])).toEqual([['FIRM-G-MEIOS_2', true], ['FIRM-G-MEIOS_2', true]]);
    // Running the check again on the fixed rows changes nothing.
    f.model();
    expect(f.docs('PT-D7').filter((d) => d.applies_to === 'each_adult' && d.group_pt === 'Meios').map((d) => d.group_key)).toEqual(['FIRM-G-MEIOS_2', 'FIRM-G-MEIOS_2']);
    f.sync();
    const items = f.items('CS-111111').filter((i) => /^FIRM-G-MEIOS/.test(i.key)).map((i) => i.key).sort();
    // The spouse and the adult child are asked now; nobody sees an option twice.
    expect(items).toEqual(['FIRM-G-MEIOS_2|PE-AAAAAA', 'FIRM-G-MEIOS_2|PE-BBBBBB', 'FIRM-G-MEIOS_2|PE-DDDDDD', 'FIRM-G-MEIOS|PE-AAAAAA']);
  });

  test('A2: a new option for the adults joins the adults\' copied group, wherever it sits in the sheet', () => {
    for (const before of [false, true]) {
      const f = firm({ cases: [d7], people: family });
      f.migrate();
      const add = (r) => f.addDoc(Object.assign({ visa_type: 'PT-D7', active: true, group_pt: 'Meios' }, r));
      add({ applies_to: 'main_applicant', title_pt: 'Extrato', doc_key: 'FIRM-EXTRATO', group_key: 'FIRM-G-MEIOS' });
      add({ applies_to: 'main_applicant', title_pt: 'IRS', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
      if (before) add({ applies_to: 'each_adult', title_pt: 'Pensão', doc_key: 'FIRM-PENSAO', group_key: 'FIRM-G-MEIOS' });
      add({ applies_to: 'each_adult', title_pt: 'Extrato', doc_key: 'FIRM-EXTRATO', group_key: 'FIRM-G-MEIOS' });
      add({ applies_to: 'each_adult', title_pt: 'IRS', doc_key: 'FIRM-IRS', group_key: 'FIRM-G-MEIOS' });
      const expected = [
        ['FIRM-G-MEIOS', 'main_applicant', ['FIRM-EXTRATO', 'FIRM-IRS']],
        ['FIRM-G-MEIOS_2', 'each_adult', before ? ['FIRM-PENSAO', 'FIRM-EXTRATO', 'FIRM-IRS'] : ['FIRM-EXTRATO', 'FIRM-IRS', 'FIRM-PENSAO']],
      ];
      const meios = () => f.model().visas['PT-D7'].requirements.filter((r) => /^FIRM-G-MEIOS/.test(r.key)).map((r) => [r.key, r.applies_to, r.any_of]);
      if (!before) {
        f.model();  // the copies are re-keyed first; then the lawyer types a new option, no keys
        add({ applies_to: 'each_adult', title_pt: 'Pensão' });
        f.model();
        expect(f.docs('PT-D7').find((d) => d.title_pt === 'Pensão').group_key).toBe('FIRM-G-MEIOS_2');
        expected[1][2] = ['FIRM-EXTRATO', 'FIRM-IRS', 'FIRM-PENSAO'];
      }
      expect(meios()).toEqual(expected);
      expect(meios()).toEqual(expected);  // a second check changes nothing
    }
  });

  test('#7c a condition typed with a decomposed accent still matches the case\'s facts', () => {
    const nfd = 'união_estável'.normalize('NFD');
    const f = firm({ cases: [Object.assign({}, d7, { facts: 'união_estável' })], people: family.slice(0, 1) });
    f.migrate();
    f.addDoc({ visa_type: 'PT-D7', title_pt: 'Declaração', only_if: nfd, active: true });
    f.sync();
    expect(f.items('CS-111111').map((i) => i.title)).toContain('Declaração');
  });

  test('#9 a new process type reaches the Document lists dropdown even when Cases IDs don\'t change', () => {
    const calls = [];
    const orig = lib.Schema.visaDropdown;
    const f = firm();
    f.migrate();
    f.ctx.props = new FakeProps();
    const sch = lib.Schema;
    sch.visaDropdown = (ss, caseIds, all) => calls.push(all.slice());
    try {
      f.sync();
      f.addType({ name_pt: 'Tipo novo', active: true });
      f.sync();
      expect(calls.length).toBe(2);
      expect(calls[1]).toContain('F-TIPO-NOVO');
    } finally {
      sch.visaDropdown = orig;
    }
  });

  test('#10 a migrated note on a whole group shows once, as the group\'s instructions, as in 0.4.2', () => {
    const adjustments = [{ visa_type: 'PT-D7', doc_type: 'ACCOMMODATION', action: 'change', note: 'Contrato com pelo menos 12 meses.' }];
    const f = firm({ adjustments });
    f.migrate();
    const before = lib.Checklist.build({ requirements: lib.LegacyLists.requirements(fixtures.CATALOG_04, 'PT-D7', adjustments), people: family.slice(0, 1), lang: 'pt', now: NOW })
      .find((i) => i.key === 'ACCOMMODATION|case');
    const after = lib.Checklist.build({ requirements: f.model().visas['PT-D7'].requirements, people: family.slice(0, 1), lang: 'pt', now: NOW })
      .find((i) => i.key === 'ACCOMMODATION|case');
    expect(after.instructions).toBe('Contrato com pelo menos 12 meses.');
    expect(allLangs(after.text)).toEqual(allLangs(before.text));
  });
});

describe('min_age on any per-person row (0.5.1)', () => {
  const minorType = () => {
    const f = firm();
    f.migrate();
    f.addType({ name_pt: 'Art. 92 – filho menor', active: true });
    const add = (r) => f.addDoc(Object.assign({ visa_type: 'Art. 92 – filho menor', active: true }, r));
    add({ applies_to: 'main_applicant', title_pt: 'Passaporte' });
    add({ applies_to: 'main_applicant', title_pt: 'Registo criminal', min_age: 16 });
    add({ applies_to: 'each_child', title_pt: 'Matrícula escolar', min_age: '6' });
    add({ applies_to: 'case', title_pt: 'Autorização de residência do familiar', min_age: 16 });
    return f;
  };
  const build = (f, people) => {
    f.model();  // the check fills in the type's ID
    const id =f.types().find((t) => t.name_pt === 'Art. 92 – filho menor').visa_type;
    return lib.Checklist.build({ requirements: f.model().visas[id].requirements, people, lang: 'pt', now: NOW })
      .map((i) => i.title + '|' + (i.person_id || 'case'));
  };

  test('a minor applicant is asked for the criminal record only from 16', () => {
    const f = minorType();
    const at = (birth) => build(f, [{ person_id: 'PE-M', role: 'main_applicant', birth_date: birth }]);
    expect(at('2016-03-03')).not.toContain('Registo criminal|PE-M');  // 10
    expect(at('2010-11-17')).not.toContain('Registo criminal|PE-M');  // 15, 16 the day after NOW
    expect(at('2010-11-16')).toContain('Registo criminal|PE-M');      // 16 today
    expect(at('2008-01-01')).toContain('Registo criminal|PE-M');
    expect(at('2016-03-03')).toContain('Passaporte|PE-M');            // rows without min_age: everyone
    expect(at('')).toContain('Registo criminal|PE-M');                // no birth date: asked, as for each_adult
  });

  test('min_age works on each_child too; on a case row it does nothing and the row warns', () => {
    const f = minorType();
    const items = build(f, [
      { person_id: 'PE-A', role: 'main_applicant', birth_date: '1980-01-01' },
      { person_id: 'PE-C1', role: 'child', birth_date: '2023-01-01' },
      { person_id: 'PE-C2', role: 'child', birth_date: '2015-01-01' },
    ]);
    expect(items.filter((i) => i.startsWith('Matrícula'))).toEqual(['Matrícula escolar|PE-C2']);
    expect(items).toContain('Autorização de residência do familiar|case');
    const row = f.docs().find((d) => d.title_pt === 'Autorização de residência do familiar');
    expect(row.check).toContain('min_age não se aplica');
    expect(f.docs().find((d) => d.title_pt === 'Registo criminal').check).not.toContain('min_age');
  });
});
