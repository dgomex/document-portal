/** Clients tab. */
const Clients = (function () {
  function table(ss) {
    const t = Table.open(ss, Config.TABS.CLIENTS);
    t.require(Config.SCHEMA.Clients);
    return t;
  }

  /** Rows plus derived fields: active (boolean), activeBlank, emails (normalised list). */
  function list(ss) {
    return table(ss).rows().map(function (r) {
      r.client_id = String(r.client_id).trim();
      r.activeBlank = r.active === '' || r.active === null || r.active === undefined;
      r.active = Validate.toBool(r.active);
      r.emails = [Validate.normalizeEmail(r.email)]
        .concat(Validate.parseEmailList(r.additional_emails).valid)
        .filter(function (e, i, all) { return e && all.indexOf(e) === i; });
      return r;
    });
  }

  /**
   * The client who may log in with this email, or null. Inactive clients and
   * malformed IDs behave exactly like unknown emails.
   */
  function findActiveByEmail(ss, email) {
    const target = Validate.normalizeEmail(email);
    if (!Validate.isEmail(target)) return null;
    return list(ss).filter(function (c) {
      return c.active && Ids.isValid(c.client_id, Config.ID_PREFIX.CLIENT) && c.emails.indexOf(target) !== -1;
    })[0] || null;
  }

  function byId(ss, clientId) {
    return list(ss).filter(function (c) { return c.client_id === clientId; })[0] || null;
  }

  return { table: table, list: list, findActiveByEmail: findActiveByEmail, byId: byId };
})();
