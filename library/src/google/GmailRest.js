/**
 * Sends mail through the Gmail REST API (gmail.send scope only; GmailApp
 * would need full mailbox access). From may be a send-as alias; Gmail
 * quietly uses the account address when the alias isn't verified.
 */
const GmailRest = (function () {
  const URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

  /** RFC 2047 for non-ASCII; line breaks removed so no header can be injected. */
  function header_(value) {
    const s = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
    return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
  }

  function address_(name, email) {
    const display = String(name || '').replace(/[\r\n"\\<>]+/g, ' ').trim();
    if (!display) return email;
    return (/^[\x20-\x7e]*$/.test(display) ? '"' + display + '"' : header_(display)) + ' <' + email + '>';
  }

  /** Pure: m = { to, from, fromName, subject, text, html } -> MIME string. */
  function build(m) {
    if (!Validate.isEmail(m.to) || (m.from && !Validate.isEmail(m.from))) throw Errors.make('mail', 'Bad address');
    const boundary = 'portal-' + Crypto.randomToken(12);
    const part = function (type, body) {
      return ['--' + boundary, 'Content-Type: ' + type + '; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        Utilities.base64Encode(body, Utilities.Charset.UTF_8)].join('\r\n');
    };
    const lines = [];
    if (m.from) lines.push('From: ' + address_(m.fromName, m.from));
    lines.push('To: ' + m.to, 'Subject: ' + header_(m.subject), 'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="' + boundary + '"', '',
      part('text/plain', m.text), part('text/html', m.html || ''), '--' + boundary + '--', '');
    return lines.join('\r\n');
  }

  function send(token, m) {
    const raw = Utilities.base64EncodeWebSafe(build(m), Utilities.Charset.UTF_8);
    const res = UrlFetchApp.fetch(URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ raw: raw }),
    });
    if (res.getResponseCode() !== 200) {
      throw Errors.make('mail', 'Gmail ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    return JSON.parse(res.getContentText());
  }

  return { build: build, send: send };
})();
