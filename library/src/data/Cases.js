/** Cases tab. */
const Cases = (function () {
  function table(ss) {
    const t = Table.open(ss, Config.TABS.CASES);
    t.require(Config.SCHEMA.Cases);
    return t;
  }

  function list(ss) {
    return table(ss).rows().map(function (r) {
      r.case_id = String(r.case_id).trim();
      r.client_id = String(r.client_id).trim();
      r.status = String(r.status || '').trim().toLowerCase();
      return r;
    });
  }

  /** Cases a client may upload into: open, valid ID, not in provisioning error. */
  function openForClient(ss, clientId) {
    return list(ss).filter(function (c) {
      return c.client_id === clientId &&
        c.status === Config.CASE_STATUS.OPEN &&
        Ids.isValid(c.case_id, Config.ID_PREFIX.CASE) &&
        c.provision_status !== Config.PROVISION.ERROR;
    });
  }

  /** Open cases whose Drive folder exists: the ones the portal offers for upload. */
  function uploadableForClient(ss, clientId) {
    return openForClient(ss, clientId).filter(function (c) { return !!String(c.folder_id || '').trim(); });
  }

  function byId(ss, caseId) {
    return list(ss).filter(function (c) { return c.case_id === caseId; })[0] || null;
  }

  return { table: table, list: list, openForClient: openForClient, uploadableForClient: uploadableForClient, byId: byId };
})();
