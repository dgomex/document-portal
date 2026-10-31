/**
 * First-run and re-run setup from the sheet sidebar: builds the sheet
 * structure, saves Settings, creates the root Drive folder, uploads the logo,
 * generates the per-firm secret and installs the provisioning trigger.
 * Every step is safe to repeat.
 */
const Setup = (function () {
  const LOGO_MAX_BYTES = 1024 * 1024;
  const LOGO_MIME = { 'image/png': '89504e47', 'image/jpeg': 'ffd8ff' };
  const SALT_KEY = 'OTP_SALT';
  const TRIGGERS = [{ handler: 'cronProvision', minutes: 5 }, { handler: 'cronDigest', minutes: 10 }];
  // Consumer and Workspace forms of a deployed web app address.
  const PORTAL_URL = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[\w.-]+)\/s\/[\w-]+\/exec$/;

  /** Pure: returns { values, errors } where errors maps field -> i18n key. */
  function validate(form) {
    const f = form || {};
    const str = function (k) { return String(f[k] == null ? '' : f[k]).trim(); };
    const values = {
      firm_name: str('firm_name'),
      notification_email: Validate.normalizeEmail(f.notification_email),
      send_as_alias: Validate.normalizeEmail(f.send_as_alias),
      default_language: str('default_language') || Config.DEFAULT_LANGUAGE,
      privacy_contact: str('privacy_contact'),
      privacy_policy_url: str('privacy_policy_url'),
      max_file_mb: str('max_file_mb') || '100',
      portal_url: str('portal_url'),
    };
    const errors = {};
    if (!Validate.isName(values.firm_name)) errors.firm_name = 'setup.err.firmName';
    if (!Validate.isEmail(values.notification_email)) errors.notification_email = 'setup.err.email';
    if (values.send_as_alias && !Validate.isEmail(values.send_as_alias)) errors.send_as_alias = 'setup.err.email';
    if (!Validate.isLanguage(values.default_language)) errors.default_language = 'setup.err.language';
    if (values.privacy_contact.length > 200) errors.privacy_contact = 'setup.err.tooLong';
    if (values.privacy_policy_url && !/^https:\/\/[^\s]+$/.test(values.privacy_policy_url)) errors.privacy_policy_url = 'setup.err.url';
    const mb = Number(values.max_file_mb);
    if (values.portal_url && !PORTAL_URL.test(values.portal_url)) errors.portal_url = 'setup.err.portalUrl';
    if (!(Number.isInteger(mb) && mb >= 1 && mb <= Config.MAX_FILE_BYTES / 1048576)) errors.max_file_mb = 'setup.err.maxMb';
    return { values: values, errors: errors };
  }

  /** Pure: logo { name, mimeType, base64 } -> { bytes } or { error }. */
  function checkLogo(logo) {
    if (!logo || !logo.base64) return {};
    if (!LOGO_MIME[logo.mimeType]) return { error: 'setup.err.logoType' };
    const bytes = Utilities.base64Decode(logo.base64);
    if (bytes.length > LOGO_MAX_BYTES) return { error: 'setup.err.logoSize' };
    const hex = bytes.slice(0, 4).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    if (hex.indexOf(LOGO_MIME[logo.mimeType]) !== 0) return { error: 'setup.err.logoType' };
    return { bytes: bytes };
  }

  /** Values for the sidebar form. */
  function state(ctx) {
    const s = Settings.read(ctx.ss);
    return {
      firm_name: String(s.firm_name || ''),
      notification_email: String(s.notification_email || Session.getEffectiveUser().getEmail() || ''),
      send_as_alias: String(s.send_as_alias || ''),
      default_language: I18n.lang(String(s.default_language || '')),
      privacy_contact: String(s.privacy_contact || ''),
      privacy_policy_url: String(s.privacy_policy_url || ''),
      max_file_mb: String(s.max_file_mb || '100'),
      hasLogo: !!s.logo_file_id,
      rootFolderId: String(s.root_folder_id || ''),
      portal_url: String(s.portal_url || ''),
    };
  }

  function save(ctx, form) {
    const checked = validate(form);
    const logo = checkLogo(form && form.logo);
    if (logo.error) checked.errors.logo = logo.error;
    if (Object.keys(checked.errors).length) {
      throw Errors.make('invalid', 'Invalid setup form', { fields: checked.errors });
    }

    const v = checked.values;
    if (v.portal_url && !opens_(v.portal_url)) {
      throw Errors.make('invalid', 'Portal address does not open', { fields: { portal_url: 'setup.err.portalDead' } });
    }

    Migrations.run(ctx);
    Object.keys(v).forEach(function (k) { if (k !== 'portal_url') Settings.set(ctx.ss, k, v[k]); });

    const token = ctx.script.getOAuthToken();
    const rootId = ensureRootFolder_(ctx, token, v.firm_name);
    if (logo.bytes) {
      const ext = form.logo.mimeType === 'image/png' ? '.png' : '.jpg';
      const file = DriveRest.uploadSmall(token, 'logo' + ext, form.logo.mimeType, logo.bytes, rootId);
      Settings.set(ctx.ss, 'logo_file_id', file.id);
    }
    if (!ctx.props.getProperty(SALT_KEY)) ctx.props.setProperty(SALT_KEY, Crypto.randomToken(32));
    installTriggers_(ctx);

    let url = v.portal_url || webAppUrl_(ctx);
    if (!url) {
      // Keep an earlier address only while it still opens (a deleted deployment leaves a dead link).
      const stored = String(Settings.get(ctx.ss, 'portal_url') || '');
      url = stored && opens_(stored) ? stored : '';
    }
    Settings.set(ctx.ss, 'portal_url', url);
    return { rootFolderId: rootId, portalUrl: url };
  }

  /**
   * True when Settings was filled in from outside (the onboarding skill writes
   * it through the lawyer's Sheets connector) but setup hasn't run yet.
   */
  function pendingFromSettings(settings) {
    const s = settings || {};
    return !String(s.root_folder_id || '').trim() &&
      !!String(s.firm_name || '').trim() && !!String(s.notification_email || '').trim();
  }

  /** Runs setup with the values already in Settings, fetching the logo from logo_url if given. */
  function fromSettings(ctx, opts) {
    const s = Settings.read(ctx.ss);
    const pick = function (k) { return s[k] === undefined || s[k] === null ? '' : String(s[k]); };
    const form = {
      firm_name: pick('firm_name'), notification_email: pick('notification_email'), send_as_alias: pick('send_as_alias'),
      default_language: pick('default_language'), privacy_contact: pick('privacy_contact'),
      privacy_policy_url: pick('privacy_policy_url'), max_file_mb: pick('max_file_mb'),
    };
    const logoUrl = pick('logo_url').trim();
    if (logoUrl) form.logo = fetchLogo_(logoUrl, opts || {});
    return save(ctx, form);
  }

  /** The logo at an https address, as the sidebar would send it: { mimeType, base64 }. */
  function fetchLogo_(url, opts) {
    const bad = function (why) {
      return Errors.make('invalid', 'logo_url: ' + why, { fields: { logo_url: 'setup.err.logoUrl' } });
    };
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw bad('not https');
    let res;
    try {
      res = (opts.fetch || UrlFetchApp.fetch)(url, { muteHttpExceptions: true, followRedirects: true });
    } catch (err) {
      throw bad(String(err));
    }
    if (res.getResponseCode() !== 200) throw bad('HTTP ' + res.getResponseCode());
    const blob = res.getBlob();
    const bytes = blob.getBytes();
    if (bytes.length > LOGO_MAX_BYTES) throw bad('too big');
    // The type is taken from the bytes, not the server's header: checkLogo checks them again.
    const hex = bytes.slice(0, 4).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    const mimeType = hex.indexOf(LOGO_MIME['image/png']) === 0 ? 'image/png' : hex.indexOf(LOGO_MIME['image/jpeg']) === 0 ? 'image/jpeg' : '';
    if (!mimeType) throw bad('not a PNG or JPEG');
    return { name: 'logo', mimeType: mimeType, base64: Utilities.base64Encode(bytes) };
  }

  function ensureRootFolder_(ctx, token, firmName) {
    const existing = String(Settings.get(ctx.ss, 'root_folder_id') || '').trim();
    if (DriveRest.exists(token, existing)) return existing;
    const folder = DriveRest.createFolder(token, 'Portal - ' + Sanitize.fileName(firmName), null);
    Settings.set(ctx.ss, 'root_folder_id', folder.id);
    return folder.id;
  }

  function installTriggers_(ctx) {
    const have = new Set(ctx.script.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }));
    TRIGGERS.forEach(function (t) {
      if (!have.has(t.handler)) ctx.script.newTrigger(t.handler).timeBased().everyMinutes(t.minutes).create();
    });
  }

  /**
   * Best-effort guess when the lawyer leaves the address blank. getUrl() run
   * from the sheet tends to answer the test deployment's /exec form, which
   * never opens, so the guess is kept only if it really opens.
   */
  function webAppUrl_(ctx) {
    try {
      const url = ctx.script.getService().getUrl();
      return url && /\/exec$/.test(url) && opens_(url) ? url : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Called on every portal visit. Inside the real deployment getUrl() is
   * right (unlike from the sheet), so the first visit after deploying fills
   * portal_url and the lawyer never has to copy it. Writes only on change.
   */
  function recordPortalUrl(ctx, settings) {
    try {
      const url = String(ctx.script.getService().getUrl() || '');
      if (PORTAL_URL.test(url) && url !== String(settings.portal_url || '')) Settings.set(ctx.ss, 'portal_url', url);
    } catch (err) {
      console.warn('recordPortalUrl: ' + err);
    }
  }

  function opens_(url) {
    try {
      return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getResponseCode() === 200;
    } catch (err) {
      return false;
    }
  }

  return { validate: validate, checkLogo: checkLogo, state: state, save: save, recordPortalUrl: recordPortalUrl,
    pendingFromSettings: pendingFromSettings, fromSettings: fromSettings, SALT_KEY: SALT_KEY };
})();
