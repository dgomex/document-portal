/**
 * Loads every library .js file into one vm context, the way Apps Script
 * shares one global scope across a project's files, with small fakes for
 * the Apps Script services the pure modules use.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'library', 'src');

function libraryFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return libraryFiles(p);
    return d.name.endsWith('.js') ? [p] : [];
  }).sort();
}

/** Java-style signed bytes, as Utilities returns them. */
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

function formatDate(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

function load(overrides = {}) {
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, text) => signed(crypto.createHash(alg).update(String(text), 'utf8').digest()),
    getUuid: () => crypto.randomUUID(),
    formatDate,
    base64Encode: (s) => (Array.isArray(s) ? Buffer.from(s.map((b) => b & 0xff)) : Buffer.from(String(s), 'utf8')).toString('base64'),
    base64EncodeWebSafe: (s) => Buffer.from(String(s), 'utf8').toString('base64url'),
    sleep: () => {},
  };
  const context = vm.createContext({
    console, ...overrides, Utilities: { ...Utilities, ...(overrides.Utilities || {}) },
  });
  const source = libraryFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
  // Top-level const bindings are not properties of the global object; expose a getter.
  vm.runInContext(source + '\n;globalThis.__get = (name) => eval(name);', context, { filename: 'library.js' });
  return new Proxy({}, { get: (_, name) => context.__get(name) });
}

/** Minimal Sheet fake: a 2-D array with the Range calls Table uses. */
class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.data = rows.map((r) => r.slice());
  }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.data.push(row.slice()); }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  getMaxRows() { return Math.max(this.maxRows || 0, this.data.length); }
  insertRowsAfter(after, n) { this.maxRows = this.getMaxRows() + n; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        return Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols },
          (_, c) => { const v = (sheet.data[row - 1 + r] || [])[col - 1 + c]; return v === undefined ? '' : v; }));
      },
      setValues(values) {
        values.forEach((r, i) => r.forEach((v, j) => {
          while (sheet.data.length < row + i) sheet.data.push([]);
          sheet.data[row - 1 + i][col - 1 + j] = v;
        }));
        return this;
      },
      setValue(v) {
        while (sheet.data.length < row) sheet.data.push([]);
        sheet.data[row - 1][col - 1] = v;
        return this;
      },
    };
  }
}

class FakeSpreadsheet {
  constructor(tabs = {}) {
    this.sheets = Object.entries(tabs).map(([name, rows]) => new FakeSheet(name, rows));
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
}

module.exports = { load, libraryFiles, FakeSheet, FakeSpreadsheet, SRC };
