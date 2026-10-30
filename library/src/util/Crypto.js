/** Hashing and randomness on top of Apps Script's Utilities. */
const Crypto = (function () {
  function toHex_(bytes) {
    return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }

  function sha256Hex(text) {
    return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
  }

  /**
   * Apps Script has no getRandomValues. Utilities.getUuid() returns a v4 UUID
   * from a secure generator; dropping the fixed version and variant nibbles
   * leaves 30 random hex digits (15 bytes) per call.
   */
  function randomBytes(n) {
    const out = [];
    while (out.length < n) {
      const hex = Utilities.getUuid().replace(/-/g, '');
      const clean = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
      for (let i = 0; i + 1 < clean.length && out.length < n; i += 2) {
        out.push(parseInt(clean.substr(i, 2), 16));
      }
    }
    return out;
  }

  function randomToken(byteLength) {
    return toHex_(randomBytes(byteLength || 32));
  }

  /** Uniform decimal digits: rejection sampling avoids modulo bias. */
  function randomDigits(n) {
    let out = '';
    while (out.length < n) {
      randomBytes(n).forEach(function (b) {
        if (b < 250 && out.length < n) out += String(b % 10);
      });
    }
    return out;
  }

  function constantTimeEqual(a, b) {
    a = String(a);
    b = String(b);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  return { sha256Hex: sha256Hex, randomBytes: randomBytes, randomToken: randomToken,
    randomDigits: randomDigits, constantTimeEqual: constantTimeEqual };
})();
