/**
 * Checks a file's first bytes against its declared type. Drive trusts the
 * type the uploader declares, so an .exe renamed to .pdf would otherwise
 * be stored as a "PDF".
 */
const FileType = (function () {
  const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
  const EXTENSIONS = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif' };

  function hex_(bytes) {
    return (bytes || []).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }

  function ascii_(bytes, from, to) {
    return (bytes || []).slice(from, to).map(function (b) { return String.fromCharCode(b & 0xff); }).join('');
  }

  /** bytes: at least the first 16 bytes of the file (signed or unsigned). */
  function matches(mimeType, bytes) {
    const hex = hex_(bytes);
    switch (mimeType) {
      case 'application/pdf': return hex.indexOf('25504446') === 0;  // %PDF
      case 'image/jpeg': return hex.indexOf('ffd8ff') === 0;
      case 'image/png': return hex.indexOf('89504e470d0a1a0a') === 0;
      case 'image/heic':
      case 'image/heif':
        return ascii_(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.indexOf(ascii_(bytes, 8, 12)) !== -1;
      default: return false;
    }
  }

  /** Browsers often send no type for .heic; fall back to the extension. */
  function fromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? EXTENSIONS[m[1].toLowerCase()] || '' : '';
  }

  return { matches: matches, fromName: fromName };
})();
