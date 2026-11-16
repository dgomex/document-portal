/**
 * Fictional test firm for end-to-end testing. Only reachable when the
 * Settings tab has dev_mode = TRUE (a row added by hand, never by setup).
 * Emails are plus-addresses of one inbox: you+ana@..., you+bruno@...
 */
const Seed = (function () {
  const FIRM = 'Silva & Costa Advogados';
  // Cases with the demo process types below, so the test firm shows
  // checklists. [case name, status, visa_type]
  const CLIENTS = [
    { tag: 'ana', name: 'Ana Ferreira', language: 'pt', active: true,
      cases: [['Visto D7 – família', 'open', 'F-DEMO-D7'],
        ['Autorização de residência – trabalho', 'open', 'F-DEMO-AR']] },  // two open: case dropdown
    { tag: 'bruno', name: 'Bruno Mendes', language: 'pt', active: true,
      cases: [['Autorização de residência – trabalho', 'open', 'F-DEMO-AR'],
        ['Visto D7', 'closed', 'F-DEMO-D7']] },  // one open: no dropdown
    { tag: 'carla', name: 'Carla Duarte', language: 'en', active: true,
      cases: [['Residence permit – work', 'closed', 'F-DEMO-AR']] },  // none open: "contact your lawyer"
    { tag: 'diogo', name: 'Diogo Santos', language: 'pt', active: false,
      cases: [['Visto D7', 'open', 'F-DEMO-D7']] },  // inactive: behaves like an unknown email
  ];

  // A small fictitious list of the firm's own (the portal ships none), written
  // only when the firm has no lists yet.
  const TYPES = [
    { visa_type: 'F-DEMO-D7', name_pt: 'Demo – Visto D7', name_en: 'Demo – D7 visa', name_es: 'Demo – Visado D7', active: true, family: true, facts_to_ask: 'cplp' },
    { visa_type: 'F-DEMO-AR', name_pt: 'Demo – Autorização de residência (trabalho)', name_en: 'Demo – Residence permit (work)', name_es: 'Demo – Autorización de residencia (trabajo)', active: true, family: false, facts_to_ask: '' },
  ];
  const DOCS = [
    ['F-DEMO-D7', 'each_person', 'required', 'Passaporte válido', 'Valid passport', 'Pasaporte válido', '', '', ''],
    ['F-DEMO-D7', 'each_person', 'required', 'Fotografia tipo passe', 'Passport photo', 'Fotografía de pasaporte', '', '', ''],
    ['F-DEMO-D7', 'each_adult', 'required', 'Registo criminal', 'Criminal record certificate', 'Certificado de antecedentes penales', '', '', 'Emitido há menos de 90 dias; apostilado.'],
    ['F-DEMO-D7', 'main_applicant', 'required', 'Comprovativo de rendimentos', 'Proof of income', 'Justificante de ingresos', '', '', ''],
    ['F-DEMO-D7', 'main_applicant', 'required', 'Seguro de viagem', 'Travel insurance', 'Seguro de viaje', '', 'cplp', ''],
    ['F-DEMO-D7', 'case', 'required', 'Contrato de arrendamento', 'Lease', 'Contrato de alquiler', 'Alojamento (um dos seguintes)', '', ''],
    ['F-DEMO-D7', 'case', 'required', 'Escritura do imóvel', 'Property deed', 'Escritura del inmueble', 'Alojamento (um dos seguintes)', '', ''],
    ['F-DEMO-AR', 'main_applicant', 'required', 'Passaporte válido', 'Valid passport', 'Pasaporte válido', '', '', ''],
    ['F-DEMO-AR', 'main_applicant', 'required', 'Contrato de trabalho', 'Employment contract', 'Contrato de trabajo', '', '', ''],
    ['F-DEMO-AR', 'case', 'optional', 'Comprovativo de alojamento', 'Proof of accommodation', 'Justificante de alojamiento', '', '', ''],
  ].map(function (d, i) {
    return { visa_type: d[0], order: i + 1, applies_to: d[1], level: d[2], title_pt: d[3], title_en: d[4], title_es: d[5],
      group_pt: d[6], unless: d[7], check_criteria: d[8], active: true };
  });

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
    if (ss.getSheetByName(Config.TABS.VISA_TYPES) && ss.getSheetByName(Config.TABS.DOC_LISTS)) {
      FirmLists.seed(ss, { types: TYPES.map(function (t) { return Object.assign({}, t); }), docs: DOCS.map(function (d) { return Object.assign({}, d); }) });
    }
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
