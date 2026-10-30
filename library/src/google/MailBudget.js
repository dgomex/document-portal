/**
 * One daily email budget for everything the portal sends. Free Gmail allows
 * about 100 recipients a day (Workspace 1,500), and the firm sets its own
 * figure in Settings (daily_email_limit). Code emails may use the whole
 * budget; digests and invites stop short of it, so clients can always log in.
 * Approximate under heavy concurrency, which is fine for a safety margin.
 */
const MailBudget = (function () {
  const KEY = 'MAIL_DAILY';

  function limit(ss) {
    const n = Number(Settings.get(ss, 'daily_email_limit'));
    return Number.isInteger(n) && n > 0 ? Math.min(n, Config.MAIL.MAX_LIMIT) : Config.MAIL.DEFAULT_LIMIT;
  }

  /** kind: 'code', 'digest' or 'invite'. True and counted, or false. */
  function take(ctx, kind, nowMs) {
    const day = Utilities.formatDate(new Date(nowMs || Date.now()), Config.TIME_ZONE, 'yyyy-MM-dd');
    const all = limit(ctx.ss);
    const reserve = Math.min(Config.MAIL.RESERVED_FOR_CODES, Math.floor(all / 3));
    return RateLimit.takeDaily(ctx.props, KEY, kind === 'code' ? all : all - reserve, day);
  }

  return { take: take, limit: limit };
})();
