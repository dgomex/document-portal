const { load, FakeSpreadsheet, FakeSheet } = require('./harness');

class FakeProps {
  constructor() { this.m = {}; }
  getProperty(k) { return k in this.m ? this.m[k] : null; }
  setProperty(k, v) { this.m[k] = String(v); }
  deleteProperty(k) { delete this.m[k]; }
}

// The harness FakeSpreadsheet has no insertSheet/clear/hide: add what CatalogUpdates needs.
function sheetWithSettings(pairs) {
  const ss = new FakeSpreadsheet({ Settings: [['key', 'value', 'description'], ...pairs.map(([k, v]) => [k, v, ''])] });
  ss.insertSheet = (name) => { const s = new FakeSheet(name, []); ss.sheets.push(s); return s; };
  FakeSheet.prototype.clear = function () { this.data = []; };
  FakeSheet.prototype.hideSheet = function () { this.hidden = true; };
  FakeSheet.prototype.isSheetHidden = function () { return !!this.hidden; };
  return ss;
}

function setup({ feed, settings = [] } = {}) {
  let fetches = 0;
  const lib = load({ UrlFetchApp: { fetch: () => { fetches++; return feed ? { getResponseCode: () => 200, getContentText: () => JSON.stringify(feed) } : { getResponseCode: () => 404 }; } } });
  const ss = sheetWithSettings([['default_language', 'pt'], ...settings]);
  const ctx = { ss, props: new FakeProps() };
  return { lib, ss, ctx, fetches: () => fetches };
}

/** A newer catalog: the bundled one plus a new required document on PT-D7. */
function newer(lib, version) {
  const data = JSON.parse(JSON.stringify(lib.__get ? lib.CATALOG_DATA : lib.CATALOG_DATA));
  data.version = version;
  const d7 = data.countries.PT.visas.find((v) => v.id === 'PT-D7');
  d7.requirements.push({ key: 'CV', doc: 'CV', any_of: null, name: null, applies_to: 'main_applicant', level: 'required', only_if: [], unless: [], min_age: null });
  return data;
}

test('versions compare numerically', () => {
  const { lib } = setup();
  expect(lib.CatalogUpdates.compare('2026.11', '2026.9')).toBe(1);
  expect(lib.CatalogUpdates.compare('2026.11', '2026.11.1')).toBe(-1);
  expect(lib.CatalogUpdates.compare('2026.11', '2026.11')).toBe(0);
});

test('first use stores the bundled catalog as the firm\'s, hidden', () => {
  const { lib, ss } = setup();
  lib.CatalogUpdates.load(ss);
  expect(ss.getSheetByName('CatalogData').isSheetHidden()).toBe(true);
  expect(lib.Settings.get(ss, 'catalog_version')).toBe(lib.CATALOG_DATA.version);
});

test('a newer published catalog is only offered: nothing changes until Apply', () => {
  const s0 = setup();
  const feed = newer(s0.lib, '2026.12');
  const { lib, ss, ctx } = setup({ feed });
  lib.CatalogUpdates.load(ss);
  expect(lib.CatalogUpdates.check(ctx)).toBe('2026.12');
  expect(lib.Settings.get(ss, 'catalog_pending')).toBe('2026.12');
  expect(lib.CatalogUpdates.status(ctx).pending.changes).toEqual(['D7 – Reformados e rendimentos próprios: novo documento – Curriculum vitae (Obrigatório).']);
  lib.CatalogUpdates.load(ss);
  expect(lib.Catalog.version()).toBe(lib.CATALOG_DATA.version);  // still the old one in use
  expect(lib.CatalogUpdates.apply(ctx, '2026.12')).toEqual({ version: '2026.12' });
  expect(lib.Settings.get(ss, 'catalog_pending')).toBe('');
  lib.CatalogUpdates.load(ss);
  expect(lib.Catalog.version()).toBe('2026.12');
  expect(lib.Catalog.visa('PT-D7').requirements.some((r) => r.key === 'CV')).toBe(true);
});

test('Ignore hides that version for good; a later one is offered again', () => {
  const s0 = setup();
  const { lib, ss, ctx } = setup({ feed: newer(s0.lib, '2026.12') });
  lib.CatalogUpdates.load(ss);
  lib.CatalogUpdates.check(ctx);
  lib.CatalogUpdates.ignore(ctx);
  expect(lib.CatalogUpdates.check(ctx)).toBe('');
  expect(lib.CatalogUpdates.status(ctx).pending).toBeNull();
});

test('catalog_check off: the feed is never fetched', () => {
  const s0 = setup();
  const s = setup({ feed: newer(s0.lib, '2026.12'), settings: [['catalog_check', 'off']] });
  s.lib.CatalogUpdates.load(s.ss);
  expect(s.lib.CatalogUpdates.check(s.ctx)).toBe('');
  expect(s.fetches()).toBe(0);
});

test('an invalid or incompatible feed is ignored', () => {
  const s0 = setup();
  const bad = newer(s0.lib, '2026.12');
  bad.format = 99;
  const s = setup({ feed: bad });
  s.lib.CatalogUpdates.load(s.ss);
  expect(s.lib.CatalogUpdates.check(s.ctx)).toBe('');
  const broken = newer(s0.lib, '2026.12');
  broken.countries.PT.visas[0].requirements.push({ key: 'X', doc: 'NOT_A_DOC', applies_to: 'case' });
  expect(s0.lib.CatalogUpdates.valid(broken)).toBe(false);
});

test('a newer bundled catalog (after a portal update) is offered, not used', () => {
  const s = setup();
  // The firm applied an older catalog earlier.
  const older = JSON.parse(JSON.stringify(s.lib.CATALOG_DATA));
  older.version = '2026.10';
  const sheet = s.ss.insertSheet('CatalogData');
  sheet.data = [[JSON.stringify(older)]];
  s.lib.Settings.set(s.ss, 'catalog_version', '2026.10');
  s.lib.CatalogUpdates.load(s.ss);
  expect(s.lib.Catalog.version()).toBe('2026.10');
  expect(s.lib.CatalogUpdates.check(s.ctx)).toBe(s.lib.CATALOG_DATA.version);
});
