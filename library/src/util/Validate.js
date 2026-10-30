/** Field validation shared by provisioning, login and the Claude skill rules. */
const Validate = (function () {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function normalizeEmail(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  function isEmail(s) {
    const e = normalizeEmail(s);
    return e.length <= 254 && EMAIL.test(e);
  }

  /** "a@x.pt; b@y.pt" -> { valid: [...], invalid: [...] } */
  function parseEmailList(s) {
    const result = { valid: [], invalid: [] };
    String(s == null ? '' : s).split(/[;,\s]+/).forEach(function (part) {
      const e = normalizeEmail(part);
      if (!e) return;
      (isEmail(e) ? result.valid : result.invalid).push(e);
    });
    return result;
  }

  function isName(s) {
    const n = String(s == null ? '' : s).trim();
    return n.length >= 1 && n.length <= 120;
  }

  function isLanguage(s) {
    return Config.LANGUAGES.indexOf(String(s)) !== -1;
  }

  /** Checkbox cells read as booleans; Sheets API writes may arrive as strings. */
  function toBool(v) {
    if (v === true) return true;
    if (v === false || v == null) return false;
    return ['true', 'yes', 'sim', '1'].indexOf(String(v).trim().toLowerCase()) !== -1;
  }

  /** Errors that block provisioning a Clients row. */
  function clientRow(row, others) {
    const errors = [];
    if (!Ids.isValid(row.client_id, Config.ID_PREFIX.CLIENT)) errors.push('invalid client_id');
    if (!isName(row.name)) errors.push('invalid name');
    if (!isEmail(row.email)) errors.push('invalid email');
    const extra = parseEmailList(row.additional_emails);
    if (extra.invalid.length) errors.push('invalid additional_emails: ' + extra.invalid.join(', '));
    if (row.language && !isLanguage(row.language)) errors.push('invalid language');
    if (others) {
      if (others.duplicateIds && others.duplicateIds.has(row.client_id)) errors.push('duplicate client_id');
      if (others.emailOwner) {
        [normalizeEmail(row.email)].concat(extra.valid).forEach(function (e) {
          const owner = others.emailOwner[e];
          if (owner && owner !== row.client_id) errors.push('email ' + e + ' already used by ' + owner);
        });
      }
    }
    return errors;
  }

  /** Errors that block provisioning a Cases row. clientsById: id -> client. */
  function caseRow(row, clientsById, duplicateIds) {
    const errors = [];
    if (!Ids.isValid(row.case_id, Config.ID_PREFIX.CASE)) errors.push('invalid case_id');
    if (duplicateIds && duplicateIds.has(row.case_id)) errors.push('duplicate case_id');
    if (!isName(row.case_name)) errors.push('invalid case_name');
    const status = String(row.status || '').trim().toLowerCase();
    if (status !== Config.CASE_STATUS.OPEN && status !== Config.CASE_STATUS.CLOSED) errors.push('invalid status');
    if (row.responsible_email && !isEmail(row.responsible_email)) errors.push('invalid responsible_email');
    if (!clientsById[row.client_id]) errors.push('unknown client_id');
    return errors;
  }

  return { normalizeEmail: normalizeEmail, isEmail: isEmail, parseEmailList: parseEmailList, isName: isName,
    isLanguage: isLanguage, toBool: toBool, clientRow: clientRow, caseRow: caseRow };
})();
