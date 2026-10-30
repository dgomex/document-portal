/**
 * The firm's logo for the public page. The Drive file is never made
 * public: the server reads it and inlines it as a data: URI. The cache
 * keeps 100 KB per value, so the base64 is stored in parts, keyed by file
 * ID (a new logo has a new ID, so it never shows a stale one).
 */
const Branding = (function () {
  const PART = 90000;
  const TTL = 6 * 3600;

  /** data:image/...;base64,... or '' (no logo, or anything went wrong). */
  function logoDataUri(ctx, fileId, opts) {
    opts = opts || {};
    const id = String(fileId || '').trim();
    if (!/^[\w-]{10,200}$/.test(id)) return '';
    try {
      const cached = read_(ctx.cache, id);
      if (cached) return cached;
      const file = (opts.drive || DriveRest).download(opts.token || ctx.script.getOAuthToken(), id);
      if (['image/png', 'image/jpeg'].indexOf(file.mimeType) === -1) return '';
      const uri = 'data:' + file.mimeType + ';base64,' + Utilities.base64Encode(file.bytes);
      write_(ctx.cache, id, uri);
      return uri;
    } catch (err) {
      console.warn('logo: ' + err);
      return '';
    }
  }

  function read_(cache, id) {
    const n = Number(cache.get('logo:' + id));
    if (!n) return '';
    const parts = [];
    for (let i = 0; i < n; i++) {
      const p = cache.get('logo:' + id + ':' + i);
      if (p === null) return '';
      parts.push(p);
    }
    return parts.join('');
  }

  function write_(cache, id, uri) {
    const n = Math.ceil(uri.length / PART);
    for (let i = 0; i < n; i++) cache.put('logo:' + id + ':' + i, uri.slice(i * PART, (i + 1) * PART), TTL);
    cache.put('logo:' + id, String(n), TTL);  // written last: a reader never sees a half-written logo
  }

  return { logoDataUri: logoDataUri };
})();
