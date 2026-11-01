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

test('the schema reference documents every column of the tabs the skill writes', () => {
  ['Clients', 'Cases', 'People', 'Checklist', 'Adjustments'].forEach((tab) => {
    const missing = Config.SCHEMA[tab].filter((col) => !schema.includes('`' + col + '`'));
    expect([tab, missing]).toEqual([tab, []]);
  });
});

test('the skill supports the portal\'s current schema version', () => {
  const m = /\*\*1 to (\d+):\*\* supported/.exec(skill);
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

describe('portal-onboarding skill', () => {
  const ob = fs.readFileSync(path.join(__dirname, '..', 'skill', 'portal-onboarding', 'SKILL.md'), 'utf8');

  test('copies the current template sheet', () => {
    const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'template', '.clasp.json'), 'utf8')).parentId;
    expect(ob).toContain(template);
  });

  test('only writes Settings keys the portal knows', () => {
    const table = ob.slice(ob.indexOf('| key | value | description |'), ob.indexOf('The header row is exactly'));
    const keys = [...table.matchAll(/^\| (\w+) \|/gm)].map((m) => m[1]).filter((k) => k !== 'key');
    const known = new Set(Config.SETTINGS_DEFAULTS.map(([k]) => k));
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
  });

  test('explains every setup field that can fail', () => {
    ['notification_email', 'default_language', 'privacy_policy_url', 'logo_url', 'max_file_mb']
      .forEach((f) => expect(ob).toContain('`' + f + '`'));
  });
});

describe('portal-update skill', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'skill', 'portal-update', 'SKILL.md'), 'utf8');

  test('edits the existing deployment, never a new one (the URL must not change)', () => {
    expect(up).toContain('Manage deployments');
    expect(up).toContain('New version');
    expect(up).toMatch(/\*\*Not\*\* "New deployment"/);
  });

  test('checks the live portal through the status endpoint the portal serves', () => {
    expect(up).toContain('?portal=status');
    const portal = fs.readFileSync(path.join(__dirname, '..', 'library', 'src', 'Portal.js'), 'utf8');
    expect(portal).toContain("e.parameter.portal === 'status'");
  });

  test('warns against the development-mode library entry', () => {
    expect(up).toMatch(/HEAD/);
  });
});

describe('labels in both languages', () => {
  const { execFileSync } = require('child_process');
  const { I18N_PT, I18N_EN, I18N_ES } = load();
  const SKILLS = ['portal-clients', 'portal-onboarding', 'portal-update'];
  const texts = SKILLS.flatMap((s) => {
    const dir = path.join(__dirname, '..', 'skill', s);
    return [path.join(dir, 'SKILL.md'), ...fs.readdirSync(path.join(dir, 'references')).filter((f) => f !== 'labels.md')
      .map((f) => path.join(dir, 'references', f))].map((p) => ({ p, text: fs.readFileSync(p, 'utf8') }));
  });

  test('each skill\'s labels.md is generated from the current translations', () => {
    expect(() => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'skill-labels.js'), '--check'], { stdio: 'pipe' }))
      .not.toThrow();
  });

  test('each skill points to its labels file', () => {
    SKILLS.forEach((s) => expect(fs.readFileSync(path.join(__dirname, '..', 'skill', s, 'SKILL.md'), 'utf8')).toContain('references/labels.md'));
  });

  test('every Portal menu item a skill names in Portuguese also gives the English and Spanish names next to it', () => {
    const missing = [];
    ['menu.setup', 'menu.provision', 'menu.invite', 'menu.update'].forEach((key) => {
      texts.forEach(({ p, text }) => {
        const re = new RegExp('Portal → ' + I18N_PT[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        let m;
        while ((m = re.exec(text))) {
          const after = text.slice(m.index, m.index + m[0].length + 140);
          if (!after.includes(I18N_EN[key]) || !after.includes(I18N_ES[key])) missing.push(path.basename(path.dirname(p)) + ': ' + after.split('\n')[0]);
        }
      });
    });
    expect(missing).toEqual([]);
  });
});

test('the skill asks about the columns the generated catalog actually has', () => {
  const catalog = fs.readFileSync(path.join(DIR, 'references', 'catalog.md'), 'utf8');
  ['Family documents', 'Facts to ask'].forEach((col) => {
    expect(catalog).toContain('| ' + col + ' |');
    expect(skill).toContain('**' + col + '**');
  });
});

// Every skill must find the firm's sheet the same way, and onboarding hands
// over the very line the others look for in the project instructions.
test('the skills share one way to find the portal sheet', () => {
  const read = (s) => fs.readFileSync(path.join(__dirname, '..', 'skill', s, 'SKILL.md'), 'utf8');
  const block = (text) => {
    const m = /<!-- shared:find-sheet[^>]*-->[\s\S]*?<!-- \/shared:find-sheet -->/.exec(text);
    return m && m[0];
  };
  const clients = block(read('portal-clients'));
  expect(clients).toContain('## Find the portal sheet');
  expect(block(read('portal-update'))).toBe(clients);
  const line = 'O portal do escritório:';
  expect(clients).toContain(line);
  expect(read('portal-onboarding')).toContain('> ' + line);
});
