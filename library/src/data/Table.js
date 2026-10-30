/**
 * Header-mapped access to a tab: rows come back as objects keyed by header
 * name, so column order in the sheet never matters. Row objects carry their
 * sheet row number in _row.
 */
const Table = (function () {
  function open(ss, name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Missing tab: ' + name);
    return wrap(sheet);
  }

  function readHeaders(sheet) {
    const lastCol = sheet.getLastColumn();
    if (!lastCol) return [];
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  }

  function wrap(sheet) {
    const headers = readHeaders(sheet);
    const index = {};
    headers.forEach(function (h, i) { if (h && !(h in index)) index[h] = i; });
    // Columns the script writes. A value only there (an ERROR left on an
    // empty row, say) must not make the row count as a client or case.
    const owned = Config.SCRIPT_OWNED[sheet.getName()];
    const ignored = new Set(Array.isArray(owned) ? owned.concat('provision_status') : []);
    const isBlankRow = function (values) {
      return isBlank_(values.filter(function (v, i) { return !ignored.has(headers[i]); }));
    };

    function require(columns) {
      const missing = columns.filter(function (c) { return !(c in index); });
      if (missing.length) throw new Error(sheet.getName() + ': missing columns ' + missing.join(', '));
    }

    function rows() {
      const n = sheet.getLastRow() - 1;
      if (n < 1 || !headers.length) return [];
      return sheet.getRange(2, 1, n, headers.length).getValues()
        .map(function (values, i) {
          const obj = { _row: i + 2 };
          headers.forEach(function (h, c) { if (h) obj[h] = values[c]; });
          return obj;
        })
        .filter(function (obj) { return !isBlankRow(headers.map(function (h) { return h ? obj[h] : ''; })); });
    }

    /**
     * Writes into the first row after the last real one. Not appendRow: the
     * checkbox column holds FALSE in every row, which makes appendRow treat
     * the whole sheet as full and write below row 1000, out of sight.
     */
    function append(obj) {
      Object.keys(obj).forEach(function (k) {
        if (!(k in index)) throw new Error(sheet.getName() + ': unknown column ' + k);
      });
      // Log tabs (Uploads, Events) have no checkboxes, and appendRow is atomic
      // when several clients write at once.
      if (owned === '*') return sheet.appendRow(headers.map(function (h) { return h in obj ? Sanitize.cell(obj[h]) : ''; }));
      const target = lastDataRow_() + 1;
      if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), target - sheet.getMaxRows());
      sheet.getRange(target, 1, 1, headers.length)
        .setValues([headers.map(function (h) { return h in obj ? Sanitize.cell(obj[h]) : ''; })]);
      return target;
    }

    function lastDataRow_() {
      const n = sheet.getLastRow();
      if (n < 2 || !headers.length) return 1;
      const values = sheet.getRange(2, 1, n - 1, headers.length).getValues();
      for (let i = values.length - 1; i >= 0; i--) if (!isBlankRow(values[i])) return i + 2;
      return 1;
    }

    function update(rowNumber, partial) {
      Object.keys(partial).forEach(function (k) {
        if (!(k in index)) throw new Error(sheet.getName() + ': unknown column ' + k);
        sheet.getRange(rowNumber, index[k] + 1).setValue(Sanitize.cell(partial[k]));
      });
    }

    return { sheet: sheet, headers: headers, column: function (h) { return h in index ? index[h] + 1 : 0; },
      require: require, rows: rows, append: append, update: update };
  }

  /** An untouched checkbox (FALSE) doesn't make a row real. */
  function isBlank_(values) {
    return values.every(function (v) { return v === '' || v === null || v === undefined || v === false; });
  }

  return { open: open, wrap: wrap, readHeaders: readHeaders };
})();
