/**
 * Phase 0 spike. Throwaway code that answers the open technical questions
 * before the real library is written:
 *   (a) Server-initiated Drive resumable upload, browser PUTs chunks to the
 *       session URI (no OAuth token in the browser). Does CORS allow it?
 *   (c) drive.file scope + REST folder creation (no DriveApp).
 *   (d) Gmail REST send with a send-as alias in From.
 *   (e) openById of the container under spreadsheets.currentonly from a
 *       web-app execution.
 * (b) library-served HTML is tested in the Phase 1 skeleton (needs 2 projects).
 */

const PROP_FOLDER = 'SPIKE_FOLDER_ID';
const PROP_SS = 'SPIKE_SS_ID';
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_BYTES = 100 * 1024 * 1024;

// ---------- Sheet menu (run as the lawyer, in the editor/sheet) ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Spike')
    .addItem('1. Create test folder (drive.file REST)', 'spikeCreateFolder')
    .addItem('2. Send test email (alias)', 'spikeSendMail')
    .addItem('3. Save spreadsheet ID', 'spikeSaveSsId')
    .addToUi();
}

function spikeCreateFolder() {
  const folder = driveJson_('post', 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    name: 'Portal spike uploads',
    mimeType: 'application/vnd.google-apps.folder',
  });
  PropertiesService.getScriptProperties().setProperty(PROP_FOLDER, folder.id);
  SpreadsheetApp.getUi().alert('Folder created:\n' + folder.webViewLink);
}

function spikeSaveSsId() {
  const id = SpreadsheetApp.getActive().getId();
  PropertiesService.getScriptProperties().setProperty(PROP_SS, id);
  SpreadsheetApp.getUi().alert('Saved spreadsheet ID ' + id);
}

function spikeSendMail() {
  const ui = SpreadsheetApp.getUi();
  const to = ui.prompt('Send test email to:').getResponseText().trim();
  if (!to) return;
  const alias = ui.prompt('From alias (leave blank for your primary address):').getResponseText().trim();
  const from = alias ? '"' + 'Silva & Costa Advogados' + '" <' + alias + '>' : null;
  const res = gmailSend_({
    to: to,
    from: from,
    subject: 'Código de acesso: 123456',
    body: 'Olá,\n\nEste é um teste do portal (acentuação: ç ã é õ).\n\nCódigo: 123456',
  });
  ui.alert('Gmail API response:\n' + JSON.stringify(res));
}

// ---------- Web app (run as the lawyer, called anonymously) ----------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Page')
    .setTitle('Portal spike')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** (e) Can the web app reach its own container spreadsheet? */
function spikeCheckSheet() {
  const out = {};
  try {
    out.active = SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getName() : null;
  } catch (err) {
    out.activeError = String(err);
  }
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SS);
  try {
    out.openById = id ? SpreadsheetApp.openById(id).getName() : 'run menu 3 first';
  } catch (err) {
    out.openByIdError = String(err);
  }
  return out;
}

/**
 * (a) Start a resumable session on the server and hand only the session URI
 * to the browser. Optionally set Origin so Drive returns CORS headers for it.
 */
function spikeInitUpload(meta) {
  if (ALLOWED_MIME.indexOf(meta.mimeType) === -1) throw new Error('type not allowed: ' + meta.mimeType);
  if (!(meta.size > 0 && meta.size <= MAX_BYTES)) throw new Error('size not allowed: ' + meta.size);
  const folderId = PropertiesService.getScriptProperties().getProperty(PROP_FOLDER);
  if (!folderId) throw new Error('run menu 1 first');

  const headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Upload-Content-Type': meta.mimeType,
    'X-Upload-Content-Length': String(meta.size),
  };
  if (meta.sendOrigin && meta.origin) headers.Origin = meta.origin;

  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,md5Checksum,parents',
    {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: headers,
      payload: JSON.stringify({ name: stamp_() + '_' + meta.name, parents: [folderId] }),
      muteHttpExceptions: true,
    }
  );
  const h = res.getHeaders();
  const uri = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !uri) {
    throw new Error('init failed ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return { uri: uri, originSent: headers.Origin || null };
}

/** (a) Server-side verification after the browser reports completion. */
function spikeFinalize(fileId) {
  const folderId = PropertiesService.getScriptProperties().getProperty(PROP_FOLDER);
  const meta = driveJson_(
    'get',
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,size,mimeType,md5Checksum,parents,webViewLink'
  );
  const head = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=0-15' },
    muteHttpExceptions: true,
  });
  const bytes = head.getContent();
  const hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return {
    meta: meta,
    inSpikeFolder: (meta.parents || []).indexOf(folderId) !== -1,
    rangeStatus: head.getResponseCode(),
    rangeBytes: bytes.length,
    headHex: hex,
    magicOk: magicOk_(meta.mimeType, hex),
  };
}

// ---------- helpers ----------

function magicOk_(mime, hex) {
  if (mime === 'application/pdf') return hex.indexOf('25504446') === 0; // %PDF
  if (mime === 'image/jpeg') return hex.indexOf('ffd8ff') === 0;
  if (mime === 'image/png') return hex.indexOf('89504e47') === 0;
  if (mime === 'image/heic' || mime === 'image/heif') {
    // bytes 4..7 = "ftyp", then brand heic/heix/mif1/msf1
    const brand = hex.slice(16, 24);
    return hex.slice(8, 16) === '66747970' && ['68656963', '68656978', '6d696631', '6d736631'].indexOf(brand) !== -1;
  }
  return false;
}

function driveJson_(method, url, body) {
  const opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (body) {
    opts.contentType = 'application/json; charset=UTF-8';
    opts.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() >= 300) throw new Error('Drive ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function gmailSend_(m) {
  const enc = function (s) { return '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?='; };
  const lines = [];
  if (m.from) {
    const match = m.from.match(/^"(.*)" <(.*)>$/);
    lines.push('From: ' + (match ? enc(match[1]) + ' <' + match[2] + '>' : m.from));
  }
  lines.push(
    'To: ' + m.to,
    'Subject: ' + enc(m.subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Utilities.base64Encode(m.body, Utilities.Charset.UTF_8)
  );
  const raw = Utilities.base64EncodeWebSafe(lines.join('\r\n'), Utilities.Charset.UTF_8);
  const res = UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ raw: raw }),
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: JSON.parse(res.getContentText()) };
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Europe/Lisbon', 'yyyy-MM-dd_HHmm');
}
