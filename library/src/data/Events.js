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

  return { log: log };
})();
