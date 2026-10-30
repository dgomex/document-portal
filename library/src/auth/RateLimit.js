/**
 * Fixed-window counters in the firm's cache. A request passes only if every
 * rule has room, and then counts against all of them. Callers hold the auth
 * lock, so read-then-write is safe.
 */
const RateLimit = (function () {
  /** rules: [{ key, limit, seconds }]. Returns true and counts, or false and counts nothing. */
  function take(cache, rules, nowMs) {
    const slots = rules.map(function (r) {
      const k = 'rl:' + r.key + ':' + r.seconds + ':' + Math.floor(nowMs / 1000 / r.seconds);
      return { k: k, n: Number(cache.get(k)) || 0, rule: r };
    });
    if (slots.some(function (s) { return s.n >= s.rule.limit; })) return false;
    slots.forEach(function (s) { cache.put(s.k, String(s.n + 1), s.rule.seconds); });
    return true;
  }

  /** Daily counter in Properties (the cache keeps values 6 h at most). */
  function takeDaily(props, key, limit, day) {
    let state = {};
    try { state = JSON.parse(props.getProperty(key) || '{}'); } catch (err) { state = {}; }
    const n = state.day === day ? state.n : 0;
    if (n >= limit) return false;
    props.setProperty(key, JSON.stringify({ day: day, n: n + 1 }));
    return true;
  }

  return { take: take, takeDaily: takeDaily };
})();
