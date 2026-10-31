const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;
const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));
const DAY = 86400000;

class FakeProps {
  constructor() { this.m = {}; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
}

function firm({ reminderDays = '7', items } = {}) {
  const ss = new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['firm_name', 'Silva & Costa', ''], ['default_language', 'pt', ''],
      ['reminder_days', reminderDays, ''], ['portal_url', 'https://script.google.com/macros/s/X/exec', '']],
    Clients: [Config.SCHEMA.Clients, row(Config.SCHEMA.Clients, { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', language: 'en', active: true, provision_status: 'ACTIVE' })],
    Cases: [Config.SCHEMA.Cases, row(Config.SCHEMA.Cases, { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'D7', status: 'open', provision_status: 'ACTIVE', folder_id: 'F', visa_type: 'PT-D7' })],
    People: [Config.SCHEMA.People, row(Config.SCHEMA.People, { person_id: 'PE-AAAAAA', case_id: 'CS-111111', name: 'Ana', role: 'main_applicant' })],
    Checklist: [Config.SCHEMA.Checklist, ...(items || [
      { item_id: 'IT-AAAAAA', case_id: 'CS-111111', person_id: 'PE-AAAAAA', title: 'Passaporte', level: 'required', status: 'missing' },
      { item_id: 'IT-BBBBBB', case_id: 'CS-111111', person_id: 'PE-AAAAAA', title: 'Registo criminal', level: 'required', status: 'rejected', reason: 'Too old' },
      { item_id: 'IT-CCCCCC', case_id: 'CS-111111', person_id: 'PE-AAAAAA', title: 'Fotos', level: 'required', status: 'accepted' },
      { item_id: 'IT-DDDDDD', case_id: 'CS-111111', person_id: 'PE-AAAAAA', title: 'CV', level: 'optional', status: 'missing' },
      { item_id: 'IT-EEEEEE', case_id: 'CS-111111', person_id: '', title: 'Carta do senhorio', level: 'requested', status: 'missing', due_date: '2026-11-15' },
    ]).map((r) => row(Config.SCHEMA.Checklist, r))],
    Events: [Config.SCHEMA.Events],
  });
  const sent = [];
  const ctx = { ss, props: new FakeProps(), script: { getOAuthToken: () => 'T' } };
  let now = Date.UTC(2026, 9, 31, 9);
  const run = () => lib.Reminders.run(ctx, { now, mail: { send: (t, m) => sent.push(m) }, token: 'T' });
  return { ctx, sent, run, tick: (days) => { now += days * DAY; } };
}

test('the first run only starts the clock; the reminder comes after reminder_days', () => {
  const f = firm();
  expect(f.run()).toEqual({ sent: 0, skipped: 0 });
  f.tick(6);
  expect(f.run().sent).toBe(0);
  f.tick(1);
  expect(f.run().sent).toBe(1);
  expect(f.run().sent).toBe(0);  // not twice in a row
});

test('lists missing and rejected required or requested items, in the client\'s language', () => {
  const f = firm();
  f.run();
  f.tick(7);
  f.run();
  const m = f.sent[0];
  expect(m).toMatchObject({ to: 'ana@x.pt', subject: 'Silva & Costa: 3 document(s) still needed for D7' });
  expect(m.text).toContain('- Passaporte (Ana)');
  expect(m.text).toContain('- Registo criminal (Ana) – Reason: Too old');
  expect(m.text).toContain('- Carta do senhorio – By 2026-11-15');
  expect(m.text).not.toContain('Fotos');
  expect(m.text).not.toContain('CV');
  expect(m.text).toContain('https://script.google.com/macros/s/X/exec');
});

test('nothing missing: no email', () => {
  const f = firm({ items: [{ item_id: 'IT-AAAAAA', case_id: 'CS-111111', person_id: 'PE-AAAAAA', title: 'P', level: 'required', status: 'received' }] });
  f.run();
  f.tick(8);
  expect(f.run().sent).toBe(0);
});

test('reminder_days 0 switches reminders off', () => {
  const f = firm({ reminderDays: '0' });
  f.run();
  f.tick(30);
  expect(f.run().sent).toBe(0);
});

test('item titles are escaped in the HTML email', () => {
  const html = lib.Reminders.message('pt', { name: 'A', firm: 'F', caseName: 'C', url: '', items: [{ title: '<b>x</b>', person: '', reason: '', due: '' }] }).html;
  expect(html).not.toContain('<b>x</b>');
});
