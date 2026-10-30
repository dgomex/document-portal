/** Cleaning of untrusted strings before they reach the sheet or Drive. */
const Sanitize = (function () {
  const MAX_FILE_NAME = 120;
  const MAX_FOLDER_NAME = 80;

  /** Neutralise spreadsheet formula injection: =, +, -, @, tab, CR. */
  function cell(value) {
    if (typeof value !== 'string') return value;
    return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  }

  function fileName(name) {
    let s = String(name == null ? '' : name).normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');
    if (!s) s = 'ficheiro';
    if (s.length > MAX_FILE_NAME) {
      const dot = s.lastIndexOf('.');
      const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
      s = s.slice(0, MAX_FILE_NAME - ext.length).trim() + ext;
    }
    return s;
  }

  /** e.g. 2026-10-30_1401_contrato.pdf */
  function storedName(date, originalName, timeZone) {
    return Utilities.formatDate(date, timeZone || Config.TIME_ZONE, 'yyyy-MM-dd_HHmm') + '_' + fileName(originalName);
  }

  /** e.g. "Ana Ferreira [CL-7K3Q9X]". Lookups use folder IDs, so renames are safe. */
  function folderName(name, id) {
    return fileName(name).slice(0, MAX_FOLDER_NAME).trim() + ' [' + id + ']';
  }

  return { cell: cell, fileName: fileName, storedName: storedName, folderName: folderName };
})();
