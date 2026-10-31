const { load } = require('./harness');

const lib = load();
const { Checklist } = lib;
const NOW = Date.UTC(2026, 9, 31);

const ana = { person_id: 'PE-AAAAAA', name: 'Ana', role: 'main_applicant', birth_date: '1980-05-01' };
const pedro = { person_id: 'PE-BBBBBB', name: 'Pedro', role: 'spouse', birth_date: '1979-02-10' };
const maria = { person_id: 'PE-CCCCCC', name: 'Maria', role: 'child', birth_date: '2014-06-01' };   // 12
const joao = { person_id: 'PE-DDDDDD', name: 'João', role: 'child', birth_date: '2009-09-01' };     // 17

const build = (extra) => Checklist.build({ visaId: 'PT-D7', facts: '', people: [ana], adjustments: [], now: NOW, ...extra });
const keys = (items) => items.map((i) => i.key).sort();
const has = (items, key) => items.some((i) => i.key === key);

describe('facts', () => {
  test('ticked facts plus the ones people imply', () => {
    expect([...Checklist.facts('CPLP; other_residence', [ana, pedro, maria])].sort())
      .toEqual(['children', 'cplp', 'married', 'other_residence']);
  });
  test('age in whole years, unknown birth date is null', () => {
    expect(Checklist.age('2009-09-01', NOW)).toBe(17);
    expect(Checklist.age('2009-11-15', NOW)).toBe(16);
    expect(Checklist.age('', NOW)).toBeNull();
  });
});

describe('build', () => {
  test('a single D7 applicant: the general block, the D7 documents, nothing for family', () => {
    const items = build();
    expect(keys(items)).toEqual([
      'ACCOMMODATION|case', 'APPLICATION_FORM|PE-AAAAAA', 'CRIMINAL_RECORD|PE-AAAAAA', 'D7_INCOME|PE-AAAAAA', 'MEANS|case',
      'PASSPORT|PE-AAAAAA', 'PHOTOS|PE-AAAAAA', 'PT_BANK_ACCOUNT|PE-AAAAAA', 'TRAVEL_INSURANCE|PE-AAAAAA',
    ]);
    expect(items.find((i) => i.key === 'D7_INCOME|PE-AAAAAA').options).toBe('PENSION_PROOF;PASSIVE_INCOME_PROOF;RELIGIOUS_STATUS');
  });

  test('a family: per-person items, criminal records only from 16, family documents once', () => {
    const items = build({ people: [ana, pedro, maria, joao] });
    ['PE-AAAAAA', 'PE-BBBBBB', 'PE-CCCCCC', 'PE-DDDDDD'].forEach((id) => expect(has(items, 'PASSPORT|' + id)).toBe(true));
    expect(items.filter((i) => i.doc_type === 'CRIMINAL_RECORD').map((i) => i.person_name).sort()).toEqual(['Ana', 'João', 'Pedro']);
    expect(items.filter((i) => i.doc_type === 'BIRTH_CERTIFICATE').map((i) => i.person_name).sort()).toEqual(['João', 'Maria']);
    expect(has(items, 'RELATIONSHIP_PROOF|case')).toBe(true);
    expect(has(items, 'PARENTS_IDS|case')).toBe(true);
    expect(has(items, 'SOLE_CUSTODY_PROOF|case')).toBe(false);
    expect(has(items, 'PT_BANK_ACCOUNT|PE-BBBBBB')).toBe(false);  // main applicant only
  });

  test('a child without a birth date gets no criminal record; an adult without one does', () => {
    const items = build({ people: [{ ...ana, birth_date: '' }, { ...maria, birth_date: '' }] });
    expect(items.filter((i) => i.doc_type === 'CRIMINAL_RECORD').map((i) => i.person_name)).toEqual(['Ana']);
  });

  test('facts switch documents on and off', () => {
    const cplp = build({ facts: 'cplp' });
    expect(has(cplp, 'TRAVEL_INSURANCE|PE-AAAAAA')).toBe(false);
    expect(has(cplp, 'D7_INCOME|PE-AAAAAA')).toBe(false);
    expect(has(build({ facts: 'other_residence' }), 'LEGAL_RESIDENCE_ELSEWHERE|PE-AAAAAA')).toBe(true);
    expect(has(build({ people: [ana, maria], facts: 'sole_custody' }), 'SOLE_CUSTODY_PROOF|case')).toBe(true);
  });

  test('instructions carry the rule notes in the firm language, and all languages in text', () => {
    const cr = build().find((i) => i.doc_type === 'CRIMINAL_RECORD');
    expect(cr.title).toBe('Registo criminal');
    expect(cr.instructions).toContain('Emitido há menos de 90 dias.');
    expect(cr.text.title.es).toBe('Certificado de antecedentes penales');
    expect(cr.text.instructions.en).toContain('Issued within the last 90 days.');
    expect(build({ lang: 'en' }).find((i) => i.doc_type === 'CRIMINAL_RECORD').title).toBe('Criminal record certificate');
  });

  test('an unknown visa gives an empty list', () => {
    expect(build({ visaId: 'PT-NOPE' })).toEqual([]);
  });
});

describe('firm adjustments', () => {
  const adj = [
    { visa_type: 'PT-D7', doc_type: 'TRAVEL_INSURANCE', action: 'hide' },
    { visa_type: '*', doc_type: 'CRIMINAL_RECORD', action: 'change', level: 'optional', note: 'Pedimos sempre o original.' },
    { visa_type: 'PT-D7', doc_type: 'CV', applies_to: 'spouse', action: 'add', level: 'optional' },
    { visa_type: 'PT-D7', doc_type: 'Carta de motivação', action: 'add', note: 'Uma página.' },
    { visa_type: 'PT-D1', doc_type: 'PHOTOS', action: 'hide' },  // other visa: ignored
  ];
  const items = build({ people: [ana, pedro], adjustments: adj });

  test('hide removes a catalog item', () => expect(items.some((i) => i.doc_type === 'TRAVEL_INSURANCE')).toBe(false));
  test('change adjusts level and adds the firm note', () => {
    const cr = items.find((i) => i.key === 'CRIMINAL_RECORD|PE-AAAAAA');
    expect(cr).toMatchObject({ level: 'optional', source: 'firm' });
    expect(cr.instructions).toMatch(/Pedimos sempre o original\.$/);
  });
  test('add a catalog document for a role', () => {
    expect(items.filter((i) => i.doc_type === 'CV').map((i) => i.person_name)).toEqual(['Pedro']);
  });
  test('add a document of the firm\'s own, in its own words for every language', () => {
    const own = items.find((i) => i.key === 'FIRM-CARTA_DE_MOTIVACAO|PE-AAAAAA');
    expect(own).toMatchObject({ title: 'Carta de motivação', instructions: 'Uma página.', level: 'required', source: 'firm' });
    expect(own.text.title.es).toBe('Carta de motivação');
  });
  test('adjustments for another visa change nothing', () => expect(items.some((i) => i.doc_type === 'PHOTOS')).toBe(true));
});

describe('merge', () => {
  const row = (item, extra) => ({ ...item, text_json: '', status: 'missing', ...extra });

  test('keeps status, reason and uploads; updates wording; creates new items', () => {
    const first = build();
    const existing = first.map((i) => row(i, i.doc_type === 'PASSPORT' ? { status: 'accepted', upload_ids: 'UP-AAAAAA' } : {}));
    const plan = Checklist.merge(existing, build({ people: [ana, maria] }), 'pt');
    expect(plan.create.map((i) => i.person_name || 'case').sort()).toEqual(expect.arrayContaining(['Maria', 'case']));
    expect(plan.create.some((i) => i.key === 'BIRTH_CERTIFICATE|PE-CCCCCC')).toBe(true);
    const passport = plan.update.find((u) => u.row.key === 'PASSPORT|PE-AAAAAA');
    expect(Object.keys(passport.partial)).not.toContain('status');
    expect(Object.keys(passport.partial)).not.toContain('upload_ids');
  });

  test('items that no longer apply are waived with a reason, never deleted', () => {
    const existing = build().map((i) => row(i));
    const plan = Checklist.merge(existing, build({ facts: 'cplp' }), 'pt');
    const waived = plan.update.filter((u) => u.partial.level === 'waived').map((u) => u.row.key).sort();
    expect(waived).toEqual(['D7_INCOME|PE-AAAAAA', 'TRAVEL_INSURANCE|PE-AAAAAA']);
    expect(plan.update.find((u) => u.row.key === 'TRAVEL_INSURANCE|PE-AAAAAA').partial.reason).toMatch(/Deixou de se aplicar/);
  });

  test('a waived item stays waived, and the lawyer\'s own requests are left alone', () => {
    const existing = build().map((i) => row(i, i.doc_type === 'PHOTOS' ? { level: 'waived' } : {}))
      .concat([{ key: 'REQ-1', source: 'case', level: 'requested', status: 'missing' }]);
    const plan = Checklist.merge(existing, build(), 'pt');
    expect(plan.update.find((u) => u.row.key === 'PHOTOS|PE-AAAAAA').partial.level).toBeUndefined();
    expect(plan.update.some((u) => u.row.key === 'REQ-1')).toBe(false);
  });
});

test('items the portal waived come back when they apply again; the lawyer\'s waivers stay', () => {
  const row = (item, extra) => ({ ...item, text_json: '', status: 'missing', ...extra });
  const auto = Checklist.build({ visaId: 'PT-D7', facts: '', people: [ana], now: NOW }).map((i) => row(i,
    i.doc_type === 'TRAVEL_INSURANCE' ? { level: 'waived', reason: 'Deixou de se aplicar a este processo (lista atualizada).' }
      : i.doc_type === 'PHOTOS' ? { level: 'waived', reason: 'Já entregou no consulado' } : {}));
  const plan = Checklist.merge(auto, Checklist.build({ visaId: 'PT-D7', facts: '', people: [ana], now: NOW }), 'pt');
  expect(plan.update.find((u) => u.row.doc_type === 'TRAVEL_INSURANCE').partial).toMatchObject({ level: 'required', reason: '' });
  expect(plan.update.find((u) => u.row.doc_type === 'PHOTOS').partial.level).toBeUndefined();
});

test('a birth date that is a Date from another realm (as Sheets hands it to a library) still counts', () => {
  const vm = require('vm');
  const foreign = vm.runInNewContext('new Date(Date.UTC(2009, 8, 1))');
  expect(foreign instanceof Date).toBe(false);
  expect(Checklist.age(foreign, NOW)).toBe(17);
  const items = Checklist.build({ visaId: 'PT-D7', people: [ana, { ...joao, birth_date: foreign }], now: NOW });
  expect(items.some((i) => i.key === 'CRIMINAL_RECORD|PE-DDDDDD')).toBe(true);
});
