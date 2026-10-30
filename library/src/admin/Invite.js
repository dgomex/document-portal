/**
 * Client invitations. The lawyer (or the Claude skill) sets invite_status to
 * REQUESTED; the menu or the 5-minute trigger sends each one an email with
 * the portal address, in the client's language, then marks it SENT.
 * A client is invited only once their folder exists and they are active.
 */
const Invite = (function () {
  function pending_(ss) {
    return Clients.list(ss).filter(function (c) {
      return String(c.invite_status || '').trim().toUpperCase() === Config.INVITE.REQUESTED;
    });
  }

  function hasWork(ss) {
    return pending_(ss).length > 0;
  }

  /** Returns { sent, failed, waiting, budget } where budget means "stopped: daily email limit". */
  function run(ctx, opts) {
    opts = opts || {};
    const report = { sent: 0, failed: 0, waiting: 0, budget: false };
    const settings = Settings.read(ctx.ss);
    const url = String(settings.portal_url || '');
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) throw Errors.make('noPortalUrl', 'portal_url not set');
    const table = Clients.table(ctx.ss);
    const firm = String(settings.firm_name || '');

    pending_(ctx.ss).some(function (c) {
      if (!c.active || c.provision_status !== Config.PROVISION.ACTIVE || !Ids.isValid(c.client_id, Config.ID_PREFIX.CLIENT)) {
        report.waiting++;  // not ready yet (or inactive): stays REQUESTED
        return false;
      }
      if (!MailBudget.take(ctx, 'invite', opts.now)) {
        report.budget = true;
        return true;  // stop; the rest go tomorrow
      }
      const to = Validate.normalizeEmail(c.email);
      const lang = I18n.lang(String(c.language || settings.default_language || ''));
      const msg = message(lang, { name: String(c.name || ''), firm: firm, url: url, email: to });
      try {
        (opts.mail || GmailRest).send(opts.token || ctx.script.getOAuthToken(), {
          to: to, from: Validate.normalizeEmail(settings.send_as_alias) || '', fromName: firm,
          subject: msg.subject, text: msg.text, html: msg.html,
        });
        table.update(c._row, { invite_status: Config.INVITE.SENT, invited_at: new Date(opts.now || Date.now()) });
        report.sent++;
      } catch (err) {
        table.update(c._row, { invite_status: Config.INVITE.ERROR });
        Events.log(ctx.ss, 'invite_failed', '', c.client_id + ' | ' + String(err && err.message || err).slice(0, 200));
        report.failed++;
      }
      return false;
    });
    return report;
  }

  /** Pure: the invitation in the client's language. */
  function message(lang, p) {
    const params = { name: p.name, firm: p.firm || I18n.t(lang, 'app.title'), url: p.url, email: p.email };
    const esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
    const lines = I18n.t(lang, 'mail.invite.body', params).split('\n');
    const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1d2433">' + lines.map(function (l) {
      if (l === params.url) {
        return '<p><a href="' + esc(l) + '" style="display:inline-block;padding:10px 18px;background:#1f4e8c;color:#fff;' +
          'border-radius:8px;text-decoration:none">' + esc(I18n.t(lang, 'mail.invite.button')) + '</a></p>';
      }
      return l ? '<p style="margin:0 0 10px">' + esc(l) + '</p>' : '';
    }).join('') + '</div>';
    return { subject: I18n.t(lang, 'mail.invite.subject', params), text: lines.join('\n'), html: html };
  }

  return { run: run, hasWork: hasWork, message: message };
})();
