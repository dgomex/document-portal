/**
 * Builds and upgrades the sheet structure. Safe to run any number of times:
 * it creates missing tabs, appends missing columns at the end and never
 * deletes or reorders anything a lawyer may have added.
 */
const Schema = (function () {
  const PROTECTION_TAG = 'portal:';

  /** Wanted headers not present in the current header row. */
  function missingColumns(current, wanted) {
    const have = new Set(current.map(function (h) { return String(h).trim(); }));
    return wanted.filter(function (h) { return !have.has(h); });
  }

  function ensure(ss) {
    const lang = settingsLanguage_(ss);
    const report = { created: [], added: {} };

    ensureTab_(ss, Config.TABS.SETTINGS, Config.SETTINGS_HEADERS, report);
    ensureSettingsRows_(ss, lang);

    Object.keys(Config.SCHEMA).forEach(function (name) {
      const sheet = ensureTab_(ss, name, Config.SCHEMA[name], report);
      applyValidations_(sheet, name, ss);
      protectScriptOwned_(sheet, name);
    });

    const events = ss.getSheetByName(Config.TABS.EVENTS);
    if (events && !events.isSheetHidden()) events.hideSheet();
    removeEmptyDefaultTabs_(ss);

    // schema_version is Migrations' to set, after its steps have run.
    Settings.set(ss, 'library_version', Config.LIBRARY_VERSION);
    return report;
  }

  function ensureTab_(ss, name, wanted, report) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      report.created.push(name);
    }
    const current = Table.readHeaders(sheet);
    const lastUsed = current.reduce(function (last, h, i) { return h ? i + 1 : last; }, 0);
    const missing = missingColumns(current, wanted);
    if (missing.length) {
      sheet.getRange(1, lastUsed + 1, 1, missing.length).setValues([missing]);
      if (current.length) report.added[name] = missing;
    }
    const width = lastUsed + missing.length;
    sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#e8eef7');
    sheet.setFrozenRows(1);
    return sheet;
  }

  function ensureSettingsRows_(ss, lang) {
    const present = Settings.read(ss);
    const t = Table.open(ss, Config.TABS.SETTINGS);
    Config.SETTINGS_DEFAULTS.forEach(function (pair) {
      if (!(pair[0] in present)) {
        t.append({ key: pair[0], value: pair[1], description: I18n.t(lang, 'settings.' + pair[0]) });
      }
    });
  }

  function applyValidations_(sheet, name, ss) {
    const rules = Config.VALIDATIONS[name];
    if (!rules) return;
    const t = Table.wrap(sheet);
    const rows = Math.max(sheet.getMaxRows() - 1, 1);
    Object.keys(rules).forEach(function (column) {
      const col = t.column(column);
      if (!col) return;
      const builder = SpreadsheetApp.newDataValidation();
      if (rules[column] === 'visa_types' || rules[column] === 'firm_visa_types') {
        const firm = FirmLists.enabled(ss) ? FirmLists.get(ss) : null;
        let ids;
        if (rules[column] === 'firm_visa_types') ids = firm ? firm.order : [];
        else ids = firm ? FirmLists.dropdownIds(firm, Cases.list(ss).map(function (c) { return c.visa_type; }))
          : Catalog.visas(Catalog.countriesOf(ss)).map(function (v) { return v.id; });
        if (!ids.length) return;
        // Document lists may name a type instead of its ID (replaced on sync): a warning, not a block.
        sheet.getRange(2, col, rows, 1).setDataValidation(builder.requireValueInList(ids, true)
          .setAllowInvalid(rules[column] === 'firm_visa_types').build());
        return;
      }
      const rule = rules[column] === 'checkbox'
        ? builder.requireCheckbox().build()
        : builder.requireValueInList(rules[column], true).setAllowInvalid(false).build();
      sheet.getRange(2, col, rows, 1).setDataValidation(rule);
    });
  }

  function protectScriptOwned_(sheet, name) {
    const owned = Config.SCRIPT_OWNED[name];
    if (!owned) return;
    const existing = new Set(sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .map(function (p) { return p.getDescription(); }));
    const t = Table.wrap(sheet);
    const columns = owned === '*' ? t.headers.filter(String) : owned;
    columns.forEach(function (column) {
      const tag = PROTECTION_TAG + name + '.' + column;
      const col = t.column(column);
      if (!col || existing.has(tag)) return;
      sheet.getRange(1, col, sheet.getMaxRows(), 1).protect().setDescription(tag).setWarningOnly(true);
    });
  }

  /**
   * The visa_type dropdowns once the firm has its own lists: Cases offers
   * caseIds (active types plus those cases already use), Document lists
   * every type. Called by the sync when the set changes.
   */
  function visaDropdown(ss, caseIds, allIds) {
    if (typeof SpreadsheetApp === 'undefined') return;
    [[Config.TABS.CASES, caseIds, false], [Config.TABS.DOC_LISTS, allIds, true]].forEach(function (spec) {
      const sheet = ss.getSheetByName(spec[0]);
      if (!sheet || !spec[1].length) return;
      const col = Table.wrap(sheet).column('visa_type');
      if (!col) return;
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(spec[1], true).setAllowInvalid(spec[2]).build();
      sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    });
  }

  /** Delete the untouched default tab ("Sheet1", "Página1", ...) once ours exist. */
  function removeEmptyDefaultTabs_(ss) {
    const ours = new Set([Config.TABS.SETTINGS].concat(Object.keys(Config.SCHEMA)));
    ss.getSheets().forEach(function (sheet) {
      if (!ours.has(sheet.getName()) && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 &&
          ss.getSheets().length > 1) {
        ss.deleteSheet(sheet);
      }
    });
  }

  function settingsLanguage_(ss) {
    return ss.getSheetByName(Config.TABS.SETTINGS) ? Settings.language(ss) : Config.DEFAULT_LANGUAGE;
  }

  return { ensure: ensure, missingColumns: missingColumns, visaDropdown: visaDropdown };
})();
