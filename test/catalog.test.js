/**
 * The visa catalog (catalog/*.yaml): valid, complete in every language,
 * built outputs current, and IDs never silently removed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('../scripts/build-catalog');

const SRC = path.join(__dirname, '..', 'catalog');

/** A temporary copy of the catalog with one file changed by `edit`. */
function variant(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  fs.cpSync(SRC, dir, { recursive: true });
  edit(dir);
  return build({ dir });
}
const replaceIn = (dir, file, from, to) => {
  const p = path.join(dir, file);
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error('fixture text not found: ' + from);
  fs.writeFileSync(p, s.replace(from, to));
};

test('the real catalog builds without errors', () => {
  expect(build().errors).toEqual([]);
});

test('the built files are current (run npm run catalog after editing the YAML)', () => {
  expect(() => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'build-catalog.js'), '--check'], { stdio: 'pipe' }))
    .not.toThrow();
});

test('every visa says when it was last reviewed and where it comes from', () => {
  Object.values(build().data.countries).forEach((c) => c.visas.forEach((v) => {
    expect(v.last_reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.sources.length).toBeGreaterThan(0);
  }));
});

test('Portugal: every residence visa has the general block and the family block', () => {
  build().data.countries.PT.visas.forEach((v) => {
    const keys = v.requirements.map((r) => r.key);
    ['PASSPORT', 'CRIMINAL_RECORD', 'ACCOMMODATION', 'MEANS', 'BIRTH_CERTIFICATE'].forEach((k) => expect([v.id, keys.includes(k)]).toEqual([v.id, true]));
  });
});

test.each([
  ['a missing Spanish name', 'document-types.yaml', 'es: "Pasaporte" }', '}', /PASSPORT name: missing es/],
  ['an unknown document in a visa', 'countries/PT.yaml', '{ doc: CV, applies_to: main_applicant }', '{ doc: NOPE, applies_to: main_applicant }', /unknown document NOPE/],
  ['an unknown fact', 'countries/PT.yaml', 'only_if: [other_residence]', 'only_if: [martian]', /unknown fact martian/],
  ['a bad applies_to', 'countries/PT.yaml', '{ doc: CV, applies_to: main_applicant }', '{ doc: CV, applies_to: cousin }', /applies_to must be one of/],
  ['a visa without a review date', 'countries/PT.yaml', '    last_reviewed: 2026-10-31\n    include: [PT-GENERAL, PT-FAMILY]\n    requirements:\n      - { doc: EMPLOYMENT_CONTRACT', '    include: [PT-GENERAL, PT-FAMILY]\n    requirements:\n      - { doc: EMPLOYMENT_CONTRACT', /PT-D1: needs last_reviewed/],
  ['a group with one option', 'countries/PT.yaml', 'any_of: [INVESTMENT_PROOF, FUNDS_IN_PORTUGAL]', 'any_of: [INVESTMENT_PROOF]', /at least two options/],
])('rejects %s', (_, file, from, to, message) => {
  const { errors } = variant((dir) => replaceIn(dir, file, from, to));
  expect(errors.join('\n')).toMatch(message);
});

test('a published visa cannot disappear; it must be retired', () => {
  const { errors } = variant((dir) => {
    const p = path.join(dir, 'countries/PT.yaml');
    const s = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, s.replace(/\n  - id: PT-JOB-SEEKER[\s\S]*$/, '\n'));
  });
  expect(errors.join('\n')).toMatch(/visa:PT-JOB-SEEKER was published and is gone/);
});
