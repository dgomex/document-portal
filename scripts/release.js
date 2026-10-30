#!/usr/bin/env node
/**
 * Publishes a library release and points the template sheet at it.
 *
 *   npm run release -- 0.2.0 "What changed, in one line"
 *
 * 1. Refuses unless the git tree is clean, clasp is the owner account and the tests pass.
 * 2. Writes the version into Config.js, pushes the library and creates a library version N.
 * 3. Builds template/ from shell/ with the library pinned to N (never development mode)
 *    and pushes it to the "Portal - Template" sheet.
 * 4. Adds a CHANGELOG entry. You then commit and tag.
 *
 * Existing firms move to N with Portal > Update in their own sheet.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OWNER = process.env.PORTAL_OWNER || 'gddataai@gmail.com';
const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const fail = (msg) => { console.error('release: ' + msg); process.exit(1); };

const [semver, ...rest] = process.argv.slice(2);
const notes = rest.join(' ').trim();
if (!/^\d+\.\d+\.\d+$/.test(semver || '') || !notes) fail('usage: npm run release -- 1.2.3 "notes"');

if (run('git status --porcelain').trim()) fail('commit or stash your changes first');
if (!run('npx clasp show-authorized-user').includes(OWNER)) fail('clasp is not logged in as ' + OWNER);
console.log('Running tests…');
try { run('npx jest --silent'); } catch (e) { fail('tests failed:\n' + e.stdout + e.stderr); }

const configPath = path.join(ROOT, 'library/src/Config.js');
const config = fs.readFileSync(configPath, 'utf8');
if (!/LIBRARY_VERSION: '[^']*'/.test(config)) fail('LIBRARY_VERSION not found in Config.js');
fs.writeFileSync(configPath, config.replace(/LIBRARY_VERSION: '[^']*'/, `LIBRARY_VERSION: '${semver}'`));

console.log('Pushing the library…');
run('npx clasp push --force', path.join(ROOT, 'library'));
const created = run(`npx clasp create-version "${semver}: ${notes.replace(/"/g, "'")}"`, path.join(ROOT, 'library'));
const m = /Created version (\d+)/.exec(created);
if (!m) fail('could not read the new version number from: ' + created);
const version = Number(m[1]);

console.log(`Library version ${version} created. Building the template…`);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'shell/appsscript.json'), 'utf8'));
const lib = manifest.dependencies.libraries.find((l) => l.userSymbol === 'Portal');
lib.version = String(version);
delete lib.developmentMode;  // firms must never follow the library head
const templateDir = path.join(ROOT, 'template');
fs.writeFileSync(path.join(templateDir, 'appsscript.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'shell/Code.js'), path.join(templateDir, 'Code.js'));
run('npx clasp push --force', templateDir);

const changelog = path.join(ROOT, 'CHANGELOG.md');
const old = fs.existsSync(changelog) ? fs.readFileSync(changelog, 'utf8').replace(/^# Changelog\n+/, '') : '';
const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync(changelog, `# Changelog\n\n## ${semver} (library version ${version}, ${day})\n\n${notes}\n\n${old}`);

const sheetId = JSON.parse(fs.readFileSync(path.join(templateDir, '.clasp.json'), 'utf8')).parentId;
console.log(`
Released ${semver} as library version ${version}.
Template now pins version ${version}. Copy link for new firms:
  https://docs.google.com/spreadsheets/d/${sheetId}/copy

Next:
  git commit -am "Release ${semver}" && git tag v${semver} && git push --follow-tags
Existing firms: Portal > Atualizar portal in their sheet.`);
