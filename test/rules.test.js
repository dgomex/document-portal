/**
 * Structural rules for the library source that a code review could miss.
 */
const fs = require('fs');
const path = require('path');
const { libraryFiles, SRC } = require('./harness');

const files = libraryFiles().map((f) => ({ name: path.relative(SRC, f), code: fs.readFileSync(f, 'utf8') }));
// Comments may name the forbidden services (Context.js explains the rule).
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test.each([
  ['CacheService', /\bCacheService\b/],
  ['PropertiesService', /\bPropertiesService\b/],
  ['LockService', /\bLockService\b/],
  ['SpreadsheetApp.getActive*/openById', /SpreadsheetApp\.(getActive\w*|openBy\w+)\s*\(/],
])('library never calls %s itself (the shell injects it)', (_, pattern) => {
  const offenders = files.filter((f) => pattern.test(stripComments(f.code))).map((f) => f.name);
  expect(offenders).toEqual([]);
});

// Apps Script runs project files in an order we don't control (it put
// admin/Provision before Config), so no file may use another file's names
// while loading; only inside functions.
test.each(files.map((f) => [f.name, f.code]))('%s loads on its own', (name, code) => {
  const vm = require('vm');
  expect(() => vm.runInNewContext(code, { console })).not.toThrow();
});

// A module named like an Apps Script service replaces it for the whole
// project (a "Session" module once broke Session.getActiveUser).
test('no library module shadows an Apps Script global', () => {
  const GLOBALS = ['Session', 'Utilities', 'SpreadsheetApp', 'DriveApp', 'GmailApp', 'MailApp', 'HtmlService', 'ScriptApp',
    'UrlFetchApp', 'CacheService', 'PropertiesService', 'LockService', 'ContentService', 'Logger', 'Browser', 'Drive', 'Gmail',
    'XmlService', 'Charts', 'Maps', 'CalendarApp', 'DocumentApp', 'FormApp', 'SlidesApp', 'LanguageApp', 'Jdbc', 'console'];
  const declared = files.flatMap((f) => [...stripComments(f.code).matchAll(/^(?:const|let|var|function)\s+(\w+)/gm)]
    .map((m) => m[1]));
  expect(declared.filter((n) => GLOBALS.includes(n))).toEqual([]);
});

describe('i18n coverage', () => {
  const { I18N_PT } = require('./harness').load();
  const sources = [...files, ...fs.readdirSync(path.join(SRC, 'html')).map((n) => ({
    name: 'html/' + n, code: fs.readFileSync(path.join(SRC, 'html', n), 'utf8'),
  }))];
  const KEY = /['"`]((?:app|lang|menu|setup|provision|seed|error|ping|notYet|settings|login|home|mail|upload|privacy|invite|update|checklist)(?:\.[\w]+)+|notYet)['"`]/g;
  const DATA_T = /data-t="([\w.]+)"/g;

  test('every literal text key in the code exists (EN parity is checked separately)', () => {
    const used = new Set(sources.flatMap((f) => [...f.code.matchAll(KEY), ...f.code.matchAll(DATA_T)].map((m) => m[1])));
    expect([...used].filter((k) => !(k in I18N_PT))).toEqual([]);
  });

  test('every error code thrown has an error.<code> text', () => {
    const codes = new Set(files.flatMap((f) => [...f.code.matchAll(/Errors\.make\('(\w+)'/g)].map((m) => m[1])));
    expect([...codes].filter((c) => !('error.' + c in I18N_PT))).toEqual([]);
  });
});

test('every shell entry point exists as a library function', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'shell', 'Code.js'), 'utf8');
  const called = [...shell.matchAll(/Portal\.(\w+)\(/g)].map((m) => m[1]);
  const defined = new Set(files.flatMap((f) => [...f.code.matchAll(/^function (\w+)\(/gm)].map((m) => m[1])));
  expect(called.length).toBeGreaterThan(0);
  expect(called.filter((name) => !defined.has(name))).toEqual([]);
});

test('the stylesheet never lets a display rule override the hidden attribute', () => {
  const css = fs.readFileSync(path.join(SRC, 'html', 'styles.html'), 'utf8');
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});
