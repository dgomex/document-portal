/**
 * Keeps the Claude skill (skill/portal-clients) in step with the portal:
 * it writes the sheet through Google's API, so a renamed column or a new
 * schema version must be reflected there too.
 */
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');

const { Config } = load();
const DIR = path.join(__dirname, '..', 'skill', 'portal-clients');
const skill = fs.readFileSync(path.join(DIR, 'SKILL.md'), 'utf8');
const schema = fs.readFileSync(path.join(DIR, 'references', 'schema.md'), 'utf8');

test('the schema reference documents every Clients and Cases column', () => {
  ['Clients', 'Cases'].forEach((tab) => {
    const missing = Config.SCHEMA[tab].filter((col) => !schema.includes('`' + col + '`'));
    expect([tab, missing]).toEqual([tab, []]);
  });
});

test('the skill supports the portal\'s current schema version', () => {
  const m = /\*\*1 or (\d+):\*\* supported/.exec(skill);
  expect(m).not.toBeNull();
  expect(Number(m[1])).toBe(Config.SCHEMA_VERSION);
});

test('the skill never writes script-owned columns', () => {
  const table = skill.slice(skill.indexOf('| Action | Writes |'), skill.indexOf('The portal\'s script owns'));
  ['Clients', 'Cases'].forEach((tab) => {
    Config.SCRIPT_OWNED[tab].forEach((col) => expect([tab, col, table.includes('`' + col + '`')]).toEqual([tab, col, false]));
  });
});

test('the skill\'s ID alphabet is the portal\'s', () => {
  expect(skill).toContain('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  const py = fs.readFileSync(path.join(DIR, 'scripts', 'portal_rows.py'), 'utf8');
  expect(py).toContain('CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"');
});
