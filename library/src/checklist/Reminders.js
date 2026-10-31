/**
 * Reminds clients of what's still missing: one email per case, at most every
 * Settings reminder_days days (0 = never), listing required and requested
 * items that are missing or were rejected (with the reason). A case's clock
 * starts the first time it is seen, so nobody is reminded right after their
 * list is built. Runs once a day from the 10-minute job.
 */
const Reminders = (function () {
  const KEY = 'REMINDERS';  // { caseId: last reminder (ms) }

  function due_(ctx, caseId, now, days, state) {
    if (!state[caseId]) { state[caseId] = now; return false; }
    return now - state[caseId] >= days * 86400000;
  }

  /** What a case's client still has to send, in their language. */
  function pending(ss, caseId, lang) {
    const out = [];
    CaseChecklist.view(ss, caseId, lang).forEach(function (g) {
      g.items.forEach(function (i) {
        if (i.level === Config.ITEM_LEVEL.OPTIONAL) return;
        if (i.status !== Config.ITEM_STATUS.MISSING && i.status !== Config.ITEM_STATUS.REJECTED) return;
        out.push({ title: i.title, person: g.name, reason: i.reason, due: i.due });
      });
    });
    return out;
  }

  /** Returns { sent, skipped }. opts (tests): { now, mail, token }. */
  function run(ctx, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const report = { sent: 0, skipped: 0 };
    const ss = ctx.ss;
    if (!ss.getSheetByName(Config.TABS.CHECKLIST)) return report;
    const settings = Settings.read(ss);
    const days = Number(settings.reminder_days);
    if (!(days > 0)) return report;
    const url = String(settings.portal_url || '');
    let state = {};
    try { state = JSON.parse(ctx.props.getProperty(KEY) || '{}'); } catch (err) { state = {}; }
    const clients = {};
    Clients.list(ss).forEach(function (c) { clients[c.client_id] = c; });

    // Only open, provisioned cases with a visa (so with a checklist) are reminded.
    Cases.list(ss).filter(function (c) {
      return String(c.visa_type || '').trim() && c.status === Config.CASE_STATUS.OPEN && c.provision_status === Config.PROVISION.ACTIVE;
    }).forEach(function (c) {
      const client = clients[c.client_id];
      if (!client || !client.active || !Validate.isEmail(client.email)) return;
      if (!due_(ctx, c.case_id, now, days, state)) return;
      const lang = I18n.lang(String(client.language || settings.default_language || ''));
      const items = pending(ss, c.case_id, lang);
      if (!items.length) { state[c.case_id] = now; return; }
      if (!MailBudget.take(ctx, 'digest', now)) { report.skipped++; return; }
      const msg = message(lang, { name: String(client.name || ''), firm: String(settings.firm_name || ''), caseName: String(c.case_name || ''), url: url, items: items });
      try {
        (opts.mail || GmailRest).send(opts.token || ctx.script.getOAuthToken(), {
          to: Validate.normalizeEmail(client.email), from: Validate.normalizeEmail(settings.send_as_alias) || '',
          fromName: String(settings.firm_name || ''), subject: msg.subject, text: msg.text, html: msg.html,
        });
        state[c.case_id] = now;
        report.sent++;
      } catch (err) {
        Events.log(ss, 'reminder_failed', '', c.case_id + ' | ' + String(err && err.message || err).slice(0, 200));
      }
    });
    ctx.props.setProperty(KEY, JSON.stringify(state));
    return report;
  }

  /** Pure: the reminder in the client's language. */
  function message(lang, p) {
    const esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
    const line = function (i) {
      return i.title + (i.person ? ' (' + i.person + ')' : '') +
        (i.reason ? ' – ' + I18n.t(lang, 'checklist.reason', { reason: i.reason }) : '') +
        (i.due ? ' – ' + I18n.t(lang, 'checklist.due', { date: i.due }) : '');
    };
    const params = { name: p.name, firm: p.firm || I18n.t(lang, 'app.title'), caseName: p.caseName, count: p.items.length };
    const intro = I18n.t(lang, 'mail.reminder.intro', params);
    const outro = I18n.t(lang, 'mail.reminder.outro', params);
    const text = [intro, ''].concat(p.items.map(function (i) { return '- ' + line(i); }), ['', outro], p.url ? [p.url] : []).join('\n');
    const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1d2433"><p>' + esc(intro) + '</p><ul>' +
      p.items.map(function (i) { return '<li>' + esc(line(i)) + '</li>'; }).join('') + '</ul><p>' + esc(outro) + '</p>' +
      (p.url ? '<p><a href="' + esc(p.url) + '" style="display:inline-block;padding:10px 18px;background:#1f4e8c;color:#fff;' +
        'border-radius:8px;text-decoration:none">' + esc(I18n.t(lang, 'mail.invite.button')) + '</a></p>' : '') + '</div>';
    return { subject: I18n.t(lang, 'mail.reminder.subject', params), text: text, html: html };
  }

  return { run: run, pending: pending, message: message };
})();
