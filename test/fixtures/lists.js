/**
 * Test lists. The portal ships no catalog, so tests use a firm's own lists.
 * catalog-0.4.json is two visas (PT-D7, PT-AR-98-2) in the format a 0.4.x
 * sheet stored in its CatalogData tab: the migration's input, and through the
 * migration's own seeding, a realistic set of Visa types / Document lists rows.
 */
const fs = require('fs');
const path = require('path');

const CATALOG_04 = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-0.4.json'), 'utf8'));

/** Visa types and Document lists rows, as the migration would write them. */
function rows(lib, adjustments = [], lang = 'pt') {
  return lib.LegacyLists.seedRows(CATALOG_04, ['PT'], adjustments, lang);
}

/** The processed lists (FirmLists model) for those rows. */
function model(lib, adjustments = [], lang = 'pt') {
  const r = rows(lib, adjustments, lang);
  r.types.forEach((t, i) => { t._row = i + 2; });
  r.docs.forEach((d, i) => { d._row = i + 2; });
  return lib.FirmLists.process(r.types, r.docs, lang).model;
}

/** Writes the lists into a FakeSpreadsheet's two tabs (they must exist and be empty). */
function install(lib, ss, adjustments = []) {
  lib.FirmLists.reset_();
  lib.FirmLists.seed(ss, rows(lib, adjustments));
  lib.FirmLists.reset_();
}

/** A 0.4.x sheet's CatalogData tab: the stored catalog, in cells of up to 45,000 characters. */
function catalogDataTab(data = CATALOG_04) {
  const text = JSON.stringify(data);
  const out = [];
  for (let i = 0; i < text.length; i += 45000) out.push([text.slice(i, i + 45000)]);
  return out;
}

module.exports = { CATALOG_04, rows, model, install, catalogDataTab };
