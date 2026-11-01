/**
 * Fictional test firm for end-to-end testing. Only reachable when the
 * Settings tab has dev_mode = TRUE (a row added by hand, never by setup).
 * Emails are plus-addresses of one inbox: you+ana@..., you+bruno@...
 */
const Seed = (function () {
  const FIRM = 'Silva & Costa Advogados';
  // Real immigration cases, each with its catalog visa or AIMA permit, so the
  // test firm shows checklists. [case name, status, visa_type]
  const CLIENTS = [
    { tag: 'ana', name: 'Ana Ferreira', language: 'pt', active: true,
      cases: [['Visto D7 – família', 'open', 'PT-D7'],
        ['Autorização de residência – trabalho subordinado', 'open', 'PT-AR-88-1']] },  // two open: case dropdown
    { tag: 'bruno', name: 'Bruno Mendes', language: 'pt', active: true,
      cases: [['Autorização de residência – Tech Visa', 'open', 'PT-AR-90-TECH'],
        ['Visto D8 – nómada digital', 'closed', 'PT-D8']] },  // one open: no dropdown
    { tag: 'carla', name: 'Carla Duarte', language: 'en', active: true,
      cases: [['Intra-company transfer (ICT) residence permit', 'closed', 'PT-AR-124B']] },  // none open: "contact your lawyer"
    { tag: 'diogo', name: 'Diogo Santos', language: 'pt', active: false,
      cases: [['Visto para procura de trabalho', 'open', 'PT-JOB-SEEKER']] },  // inactive: behaves like an unknown email
  ];

  function enabled(ss) {
    return !!ss.getSheetByName(Config.TABS.SETTINGS) && Validate.toBool(Settings.get(ss, 'dev_mode'));
  }

  /** inbox: "you@gmail.com". Returns how many clients were added (existing ones are skipped). */
  function run(ss, inbox) {
    const at = String(inbox).indexOf('@');
    if (!Validate.isEmail(inbox) || at < 1) throw Errors.make('invalid', 'Not an email: ' + inbox);
    const local = inbox.slice(0, at).split('+')[0];
    const domain = inbox.slice(at + 1);

    if (!Settings.get(ss, 'firm_name')) Settings.set(ss, 'firm_name', FIRM);
    const clientsTable = Clients.table(ss);
    const casesTable = Cases.table(ss);
    const existing = Clients.list(ss);
    const usedEmails = new Set([].concat.apply([], existing.map(function (c) { return c.emails; })));
    const clientIds = new Set(existing.map(function (c) { return c.client_id; }));
    const caseIds = new Set(Cases.list(ss).map(function (c) { return c.case_id; }));
    const now = new Date();
    let added = 0;

    CLIENTS.forEach(function (c) {
      const email = (local + '+' + c.tag + '@' + domain).toLowerCase();
      if (usedEmails.has(email)) return;
      const clientId = Ids.generate(Config.ID_PREFIX.CLIENT, clientIds);
      clientIds.add(clientId);
      clientsTable.append({
        client_id: clientId, name: c.name, email: email, language: c.language, active: c.active,
        provision_status: Config.PROVISION.PENDING, created_at: now, created_by: 'seed',
      });
      c.cases.forEach(function (k) {
        const caseId = Ids.generate(Config.ID_PREFIX.CASE, caseIds);
        caseIds.add(caseId);
        casesTable.append({
          case_id: caseId, client_id: clientId, case_name: k[0], status: k[1], visa_type: k[2] || '',
          provision_status: Config.PROVISION.PENDING, created_at: now, created_by: 'seed',
        });
      });
      added++;
    });
    return added;
  }

  return { enabled: enabled, run: run };
})();
