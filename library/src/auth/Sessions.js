/**
 * Login sessions. The browser keeps a random 256-bit token in memory only;
 * the cache keeps the token's hash, so a cache read never yields a usable
 * token. Every call re-reads the client row: deactivating a client in the
 * sheet ends their session on the next request.
 */
const Sessions = (function () {
  const TOKEN = /^[0-9a-f]{64}$/;

  function key_(token) { return 'sess:' + Crypto.sha256Hex(token); }

  /** email: the address used to log in (a client can have several), kept for the Uploads log. */
  function create(ctx, clientId, nowMs, email) {
    const token = Crypto.randomToken(32);
    ctx.cache.put(key_(token), JSON.stringify({ c: clientId, e: email || '', start: nowMs || Date.now() }), Config.SESSION_TTL_SECONDS);
    return token;
  }

  /** The logged-in client, or throws 'session'. Slides the expiry forward. */
  function resolve(ctx, token, nowMs) {
    const now = nowMs || Date.now();
    if (!TOKEN.test(String(token || ''))) throw Errors.make('session');
    const key = key_(token);
    let s = null;
    try { s = JSON.parse(ctx.cache.get(key) || 'null'); } catch (err) { s = null; }
    if (!s) throw Errors.make('session');
    const client = now - s.start > Config.SESSION_MAX_SECONDS * 1000 ? null : Clients.byId(ctx.ss, s.c);
    if (!client || !client.active || !Ids.isValid(client.client_id, Config.ID_PREFIX.CLIENT)) {
      ctx.cache.remove(key);
      throw Errors.make('session');
    }
    ctx.cache.put(key, JSON.stringify(s), Config.SESSION_TTL_SECONDS);
    client.sessionEmail = String(s.e || '');
    return client;
  }

  function end(ctx, token) {
    if (TOKEN.test(String(token || ''))) ctx.cache.remove(key_(token));
  }

  return { create: create, resolve: resolve, end: end };
})();
