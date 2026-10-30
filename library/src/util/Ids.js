/** Stable record IDs: PREFIX-XXXXXX in Crockford base32 (no I, L, O, U). */
const Ids = (function () {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const PATTERN = /^(CL|CS|UP)-[0-9A-HJKMNP-TV-Z]{6}$/;

  /** existing: array or Set of IDs already in use. */
  function generate(prefix, existing) {
    const taken = existing instanceof Set ? existing : new Set(existing || []);
    for (let attempt = 0; attempt < 20; attempt++) {
      // 256 is a multiple of 32, so masking each byte keeps the draw uniform.
      const id = prefix + '-' + Crypto.randomBytes(6).map(function (b) { return ALPHABET[b & 31]; }).join('');
      if (!taken.has(id)) return id;
    }
    throw new Error('Could not generate a unique ' + prefix + ' id');
  }

  function isValid(id, prefix) {
    const s = String(id || '');
    return PATTERN.test(s) && (!prefix || s.indexOf(prefix + '-') === 0);
  }

  return { generate: generate, isValid: isValid };
})();
