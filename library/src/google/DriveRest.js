/**
 * Drive v3 over REST with the shell's token. DriveApp is avoided on purpose:
 * it forces the full-Drive scope, and we only hold drive.file (files this
 * app created).
 */
const DriveRest = (function () {
  const FILES = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  function request_(token, method, url, options) {
    const params = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
    if (options && options.json) {
      params.contentType = 'application/json; charset=UTF-8';
      params.payload = JSON.stringify(options.json);
    } else if (options && options.payload) {
      params.contentType = options.contentType;
      params.payload = options.payload;
    }
    const res = UrlFetchApp.fetch(url, params);
    const status = res.getResponseCode();
    if (status >= 300) {
      throw Errors.make('drive', 'Drive ' + status + ': ' + res.getContentText().slice(0, 500), { status: status });
    }
    const text = res.getContentText();
    return text ? JSON.parse(text) : {};
  }

  function createFolder(token, name, parentId) {
    const body = { name: name, mimeType: FOLDER_MIME };
    if (parentId) body.parents = [parentId];
    return request_(token, 'post', FILES + '?supportsAllDrives=true&fields=id,name,webViewLink', { json: body });
  }

  function get(token, fileId, fields) {
    return request_(token, 'get', FILES + '/' + encodeURIComponent(fileId) +
      '?supportsAllDrives=true&fields=' + encodeURIComponent(fields || 'id,name,mimeType,trashed,parents'));
  }

  /** True if the file exists, is not trashed, and this app can see it. */
  function exists(token, fileId) {
    if (!fileId) return false;
    try {
      return !get(token, fileId, 'id,trashed').trashed;
    } catch (err) {
      if (err.code === 'drive' && (err.details.status === 404 || err.details.status === 403)) return false;
      throw err;
    }
  }

  /** One-request upload for small files (logo). bytes: Apps Script byte array. */
  function uploadSmall(token, name, mimeType, bytes, parentId) {
    const boundary = 'portal' + Crypto.randomToken(8);
    const meta = { name: name, mimeType: mimeType };
    if (parentId) meta.parents = [parentId];
    const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n';
    const tail = '\r\n--' + boundary + '--';
    const payload = Utilities.newBlob(head).getBytes().concat(bytes, Utilities.newBlob(tail).getBytes());
    return request_(token, 'post', UPLOAD + '?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
      payload: payload, contentType: 'multipart/related; boundary=' + boundary,
    });
  }

  /**
   * Starts a resumable upload and returns its session URI. The URI lets the
   * browser upload exactly one file, of exactly this size, into this folder,
   * and nothing else; the OAuth token never leaves the server. origin makes
   * Drive answer the browser's chunk requests with CORS headers.
   */
  function startResumable(token, file) {
    const headers = {
      Authorization: 'Bearer ' + token,
      'X-Upload-Content-Type': file.mimeType,
      'X-Upload-Content-Length': String(file.size),
    };
    if (file.origin) headers.Origin = file.origin;
    const res = UrlFetchApp.fetch(UPLOAD + '?uploadType=resumable&supportsAllDrives=true&fields=id', {
      method: 'post', contentType: 'application/json; charset=UTF-8', headers: headers, muteHttpExceptions: true,
      payload: JSON.stringify({ name: file.name, mimeType: file.mimeType, parents: [file.parentId] }),
    });
    const h = res.getHeaders();
    const uri = h.Location || h.location;
    if (res.getResponseCode() !== 200 || !uri) {
      throw Errors.make('drive', 'Resumable start ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300),
        { status: res.getResponseCode() });
    }
    return uri;
  }

  /** The first n bytes of a file's content. */
  function head(token, fileId, n) {
    const res = UrlFetchApp.fetch(FILES + '/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + token, Range: 'bytes=0-' + (n - 1) }, muteHttpExceptions: true,
    });
    const status = res.getResponseCode();
    if (status !== 200 && status !== 206) throw Errors.make('drive', 'Range read ' + status, { status: status });
    return res.getContent().slice(0, n);
  }

  /** Whole file content: { bytes, mimeType }. Small files only (the logo). */
  function download(token, fileId) {
    const res = UrlFetchApp.fetch(FILES + '/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw Errors.make('drive', 'Download ' + res.getResponseCode(), { status: res.getResponseCode() });
    const blob = res.getBlob();
    return { bytes: blob.getBytes(), mimeType: String(blob.getContentType() || '').split(';')[0] };
  }

  /** Files (not folders) directly in a folder that this app can see: { id, name, createdTime }. */
  function listFiles(token, folderId) {
    const q = "'" + String(folderId).replace(/['\\]/g, '') + "' in parents and trashed = false and mimeType != '" + FOLDER_MIME + "'";
    const out = [];
    let page = '';
    do {
      const res = request_(token, 'get', FILES + '?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000' +
        '&fields=' + encodeURIComponent('nextPageToken,files(id,name,createdTime)') + '&q=' + encodeURIComponent(q) +
        (page ? '&pageToken=' + encodeURIComponent(page) : ''));
      (res.files || []).forEach(function (f) { out.push(f); });
      page = res.nextPageToken || '';
    } while (page);
    return out;
  }

  function rename(token, fileId, name) {
    return request_(token, 'patch', FILES + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name',
      { json: { name: name } });
  }

    function trash(token, fileId) {
    return request_(token, 'patch', FILES + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,trashed',
      { json: { trashed: true } });
  }

  return { createFolder: createFolder, get: get, exists: exists, uploadSmall: uploadSmall,
    startResumable: startResumable, head: head, download: download, listFiles: listFiles, rename: rename, trash: trash };
})();
