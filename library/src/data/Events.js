/**
 * Hidden Events tab: a security log for the lawyer (logins, refusals,
 * rejected files). Emails are stored as a salted hash, never in clear.
 * Logging never breaks the request that triggered it.
 */
const Events = (function () {
  function log(ss, type, emailHash, detail) {
    try {
      Table.open(ss, Config.TABS.EVENTS).append({
        timestamp: new Date(), type: type, email_hash: emailHash || '', detail: detail || '',
      });
    } catch (err) {
      console.warn('Events.log ' + type + ': ' + err);
    }
  }

  /**
   * Deletes rows older than Config.EVENTS_RETENTION_DAYS. Rows are appended
   * in time order, so the old ones are a block at the top.
   */
  function prune(ss, nowMs) {
    const sheet = ss.getSheetByName(Config.TABS.EVENTS);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const t = Table.wrap(sheet);
    const col = t.column('timestamp');
    if (!col) return 0;
    const cutoff = (nowMs || Date.now()) - Config.EVENTS_RETENTION_DAYS * 86400000;
    const stamps = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
    let n = 0;
    const time = function (v) { return v && typeof v.getTime === 'function' ? v.getTime() : NaN; };
    while (n < stamps.length && time(stamps[n][0]) < cutoff) n++;
    if (n) sheet.deleteRows(2, n);
    return n;
  }

  return { log: log, prune: prune };
})();
