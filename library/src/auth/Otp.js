/**
 * Email one-time codes. A code is 6 digits, lives 10 minutes, works once,
 * and allows 5 wrong tries. Only sha256(salt|email|code) is stored, in the
 * firm's own cache.
 *
 * No account enumeration: request() answers the same way, in the same time,
 * whether or not the email belongs to a client, and the wrong-try counter
 * runs for every email, so "too many tries" can't reveal one either.
 */
const Otp = (function () {
  const CODE = /^\d{6}$/;

  function salt_(ctx) {
    const salt = ctx.props.getProperty(Setup.SALT_KEY);
    if (!salt) throw Errors.make('notSetUp', 'No OTP salt: run Portal > Set up');
    return salt;
  }

  /** Short salted hash for cache keys and the Events log. */
  function emailHash(salt, email) {
    return Crypto.sha256Hex(salt + '|' + email).slice(0, 32);
  }

  function codeHash_(salt, email, code) {
    return Crypto.sha256Hex(salt + '|' + email + '|' + code);
  }

  /**
   * input: { email, website }  (website is a hidden honeypot field)
   * opts (tests): { now, sleep, mail, token }
   * Returns nothing the caller may show except "if registered, a code was sent".
   */
  function request(ctx, input, opts) {
    opts = opts || {};
    const started = Date.now();
    const sleep = opts.sleep || function (ms) { Utilities.sleep(ms); };
    try {
      request_(ctx, input || {}, opts);
    } finally {
      const wait = Config.OTP.RESPONSE_MS - (Date.now() - started);
      if (wait > 0) sleep(wait);
    }
  }

  function request_(ctx, input, opts) {
    const now = opts.now || Date.now();
    const salt = salt_(ctx);
    const email = Validate.normalizeEmail(input.email);
    if (!Validate.isEmail(email)) throw Errors.make('invalid', 'Bad email', { fields: { email: 'login.err.email' } });
    const h = emailHash(salt, email);
    if (String(input.website || '')) return Events.log(ctx.ss, 'otp_honeypot', h);

    let send = null;
    if (!ctx.authLock.tryLock(10000)) return Events.log(ctx.ss, 'otp_busy', h);
    try {
      const L = Config.OTP;
      if (!RateLimit.take(ctx.cache, [{ key: 'all', limit: L.GLOBAL_PER_HOUR, seconds: 3600 }], now)) return;  // flood: stay silent, log nothing
      if (!RateLimit.take(ctx.cache, [
        { key: 'm:' + h, limit: 1, seconds: L.MIN_GAP_SECONDS },
        { key: 'h:' + h, limit: L.PER_EMAIL_PER_HOUR, seconds: 3600 },
      ], now)) return Events.log(ctx.ss, 'otp_rate_limited', h);

      ctx.cache.remove('otpa:' + h);  // a fresh request gives 5 new tries, known email or not
      const client = Clients.findActiveByEmail(ctx.ss, email);
      if (!client) return Events.log(ctx.ss, 'otp_unknown', h);
      if (!MailBudget.take(ctx, 'code', now)) return Events.log(ctx.ss, 'otp_daily_cap', h, client.client_id);

      const code = Crypto.randomDigits(L.LENGTH);
      ctx.cache.put('otp:' + h, JSON.stringify({
        hash: codeHash_(salt, email, code), exp: now + L.TTL_SECONDS * 1000, c: client.client_id,
      }), L.TTL_SECONDS);
      send = { client: client, code: code };
    } finally {
      ctx.authLock.releaseLock();
    }

    // Outside the lock: sending takes about a second.
    const settings = Settings.read(ctx.ss);
    const lang = I18n.lang(String(send.client.language || settings.default_language || ''));
    const msg = message(lang, String(settings.firm_name || ''), send.code);
    try {
      (opts.mail || GmailRest).send(opts.token || ctx.script.getOAuthToken(), {
        to: email, from: Validate.normalizeEmail(settings.send_as_alias) || '', fromName: String(settings.firm_name || ''),
        subject: msg.subject, text: msg.text, html: msg.html,
      });
      Events.log(ctx.ss, 'otp_sent', h, send.client.client_id);
    } catch (err) {
      console.error('OTP mail: ' + err);
      Events.log(ctx.ss, 'otp_send_failed', h, String(err && err.message || err).slice(0, 200));
    }
  }

  /**
   * input: { email, code }. Returns { token, clientId } or throws
   * 'badCode' (wrong, expired or never sent) or 'tooMany'.
   */
  function verify(ctx, input, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const salt = salt_(ctx);
    const email = Validate.normalizeEmail(input && input.email);
    const code = String(input && input.code || '').replace(/\s+/g, '');
    if (!Validate.isEmail(email) || !CODE.test(code)) throw Errors.make('badCode');
    const h = emailHash(salt, email);
    const aKey = 'otpa:' + h;
    const oKey = 'otp:' + h;

    if (!ctx.authLock.tryLock(10000)) throw Errors.make('generic', 'auth lock busy');
    let entry = null;
    try {
      const tries = Number(ctx.cache.get(aKey)) || 0;
      if (tries >= Config.OTP.MAX_ATTEMPTS) throw Errors.make('tooMany');
      // Fresh codes reset the per-code tries; this 6-hour count does not, so
      // requesting code after code can't turn into unlimited guessing.
      const windowKey = 'rl:wrong:' + h + ':' + Math.floor(now / 21600000);
      const wrongInWindow = Number(ctx.cache.get(windowKey)) || 0;
      if (wrongInWindow >= Config.OTP.WRONG_PER_6H) throw Errors.make('tooMany');
      try { entry = JSON.parse(ctx.cache.get(oKey) || 'null'); } catch (err) { entry = null; }
      const ok = !!entry && entry.exp > now && Crypto.constantTimeEqual(entry.hash, codeHash_(salt, email, code));
      if (!ok) {
        ctx.cache.put(aKey, String(tries + 1), Config.OTP.TTL_SECONDS);
        ctx.cache.put(windowKey, String(wrongInWindow + 1), 21600);
        if (tries + 1 >= Config.OTP.MAX_ATTEMPTS) {
          ctx.cache.remove(oKey);
          Events.log(ctx.ss, 'verify_locked', h);
          throw Errors.make('tooMany');
        }
        Events.log(ctx.ss, 'verify_fail', h);
        throw Errors.make('badCode');
      }
      ctx.cache.removeAll([oKey, aKey]);  // single use
    } finally {
      ctx.authLock.releaseLock();
    }

    const client = Clients.byId(ctx.ss, entry.c);
    if (!client || !client.active || client.emails.indexOf(email) === -1) {
      Events.log(ctx.ss, 'verify_revoked', h, entry.c);  // deactivated or email changed after the code was sent
      throw Errors.make('badCode');
    }
    Events.log(ctx.ss, 'verify_ok', h, client.client_id);
    return { token: Sessions.create(ctx, client.client_id, now, email), clientId: client.client_id };
  }

  /** Pure: the code email in the client's language. */
  function message(lang, firmName, code) {
    const p = { code: code, firm: firmName || I18n.t(lang, 'app.title'), minutes: Config.OTP.TTL_SECONDS / 60 };
    const esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
    };
    const lines = I18n.t(lang, 'mail.code.body', p).split('\n');
    return {
      subject: I18n.t(lang, 'mail.code.subject', p),
      text: lines.join('\n'),
      html: '<div style="font:16px/1.5 Arial,sans-serif;color:#1d2433">' +
        '<p style="font-size:14px;color:#5b6475;margin:0 0 8px">' + esc(p.firm) + '</p>' +
        '<p style="margin:0">' + esc(I18n.t(lang, 'mail.code.lead')) + '</p>' +
        '<p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:8px 0 16px">' + esc(code) + '</p>' +
        lines.slice(1).filter(String).map(function (l) { return '<p style="margin:0 0 8px">' + esc(l) + '</p>'; }).join('') +
        '</div>',
    };
  }

  return { request: request, verify: verify, message: message, emailHash: emailHash };
})();
