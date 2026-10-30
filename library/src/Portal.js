/**
 * Public surface of the library. The bound shell script calls these, and
 * only these. Everything else is internal: module objects, and functions
 * ending in _ (which Apps Script hides from library users).
 *
 * Menu items, google.script.run and triggers can only reach top-level
 * functions of the shell, so each entry point here has a same-named wrapper
 * in shell/Code.js. Any shell function can also be called from the public
 * page, so everything except doGet, api and the crons requires the owner.
 */

function onOpen(e) {
  const ss = e && e.source;
  const lang = ss ? languageOf_(ss) : Config.DEFAULT_LANGUAGE;
  const t = function (key) { return I18n.t(lang, key); };
  const menu = SpreadsheetApp.getUi()
    .createMenu(t('menu.root'))
    .addItem(t('menu.setup'), 'menuSetup')
    .addItem(t('menu.provision'), 'menuProvision')
    .addItem(t('menu.invite'), 'menuInvite')
    .addSeparator()
    .addItem(t('menu.update'), 'menuUpdate');
  if (ss && safe_(function () { return Seed.enabled(ss); })) {
    menu.addSeparator().addItem(t('menu.devSeed'), 'menuDevSeed');
  }
  menu.addToUi();
}

/** Builds the sheet structure, then opens the setup sidebar. */
function menuSetup(ctx) {
  sheetAction_(ctx, function (lang) {
    Schema.ensure(ctx.ss);
    const template = HtmlService.createTemplateFromFile('html/setup');
    template.boot = bootJson_({ state: Setup.state(ctx), strings: I18n.bundle()[lang] });
    SpreadsheetApp.getUi().showSidebar(template.evaluate().setTitle(I18n.t(lang, 'setup.title')));
  });
}

function menuProvision(ctx) {
  sheetAction_(ctx, function (lang) {
    const r = Provision.run(ctx, { retryErrors: true });
    SpreadsheetApp.getUi().alert(I18n.t(lang, r.skipped ? 'provision.busy' : 'provision.done', {
      clients: r.clients.active, clientErrors: r.clients.error,
      cases: r.cases.active, caseErrors: r.cases.error, waiting: r.cases.waiting,
    }) + (r.timedOut ? '\n' + I18n.t(lang, 'provision.more') : ''));
  });
}

function menuInvite(ctx) { sheetAction_(ctx, function (lang) { SpreadsheetApp.getUi().alert(I18n.t(lang, 'notYet')); }); }
function menuUpdate(ctx) { sheetAction_(ctx, function (lang) { SpreadsheetApp.getUi().alert(I18n.t(lang, 'notYet')); }); }

function menuDevSeed(ctx) {
  sheetAction_(ctx, function (lang) {
    if (!Seed.enabled(ctx.ss)) throw Errors.make('forbidden', 'dev_mode is off');
    const ui = SpreadsheetApp.getUi();
    const answer = ui.prompt(I18n.t(lang, 'seed.prompt'), ui.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== ui.Button.OK) return;
    const added = Seed.run(ctx.ss, answer.getResponseText().trim());
    const r = Provision.run(ctx, {});
    ui.alert(I18n.t(lang, 'seed.done', { added: added, clients: r.clients.active, cases: r.cases.active }));
  });
}

/** Time-driven, every 5 minutes. Exits without the lock when nothing is pending. */
function cronProvision(ctx) {
  Context.check(ctx);
  if (!String(Settings.get(ctx.ss, 'root_folder_id') || '') || !Provision.hasWork(ctx.ss)) return;
  Provision.run(ctx, {});
}

/** Time-driven, every 10 minutes: mails batches the client never finished. */
function cronDigest(ctx) {
  Context.check(ctx);
  pruneDaily_(ctx);
  if (!ctx.props.getProperty('DIGEST_QUEUE') || ctx.props.getProperty('DIGEST_QUEUE') === '{}') return;
  Upload.flush(ctx);
}

/** Once a day: drop security-log rows past their retention. */
function pruneDaily_(ctx) {
  const day = Utilities.formatDate(new Date(), Config.TIME_ZONE, 'yyyy-MM-dd');
  if (ctx.props.getProperty('EVENTS_PRUNED') === day) return;
  safe_(function () { Events.prune(ctx.ss); });
  ctx.props.setProperty('EVENTS_PRUNED', day);
}

function doGet(e, ctx) {
  Context.check(ctx);
  const ready = !!ctx.ss.getSheetByName(Config.TABS.SETTINGS);
  const settings = ready ? Settings.read(ctx.ss) : {};
  if (ready) Setup.recordPortalUrl(ctx, settings);
  const template = HtmlService.createTemplateFromFile('html/index');
  template.boot = bootJson_({
    ready: ready && !!settings.root_folder_id,
    firmName: String(settings.firm_name || ''),
    maxFileMb: Math.min(Number(settings.max_file_mb) || 100, Config.MAX_FILE_BYTES / 1048576),
    allowedTypes: Config.ALLOWED_MIME,
    lang: I18n.lang(String(settings.default_language || '')),
    logo: ready ? Branding.logoDataUri(ctx, settings.logo_file_id) : '',
    privacy: {
      contact: String(settings.privacy_contact || ''),
      // Only https links reach the page (setup validates this too).
      url: /^https:\/\/[^\s"'<>]+$/.test(String(settings.privacy_policy_url || '')) ? String(settings.privacy_policy_url) : '',
    },
    strings: I18n.publicBundle(),
  });
  return template.evaluate()
    .setTitle(String(settings.firm_name || '') || I18n.t('pt', 'app.title'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Entry point for the public page's google.script.run. Always returns
 * { ok: true, data } or { ok: false, error: <code> }; internal errors are
 * logged, never sent to the browser.
 */
function api(action, data, ctx) {
  Context.check(ctx);
  return dispatch_(API_, action, data, ctx);
}

/** Entry point for the setup sidebar. Owner only. */
function admin(action, data, ctx) {
  Context.check(ctx);
  try {
    Context.requireOwner();
  } catch (err) {
    return { ok: false, error: 'forbidden' };
  }
  return dispatch_(ADMIN_, action, data, ctx, true);
}

const API_ = {
  requestCode: function (data, ctx) {
    Otp.request(ctx, { email: data.email, website: data.website });
    return { sent: true };
  },
  verifyCode: function (data, ctx) {
    const s = Otp.verify(ctx, { email: data.email, code: data.code });
    return { token: s.token, me: me_(ctx, Clients.byId(ctx.ss, s.clientId)) };
  },
  me: function (data, ctx) { return me_(ctx, Sessions.resolve(ctx, data.token)); },
  logout: function (data, ctx) { Sessions.end(ctx, data.token); return {}; },
  startUpload: function (data, ctx) { return Upload.start(ctx, Sessions.resolve(ctx, data.token), data); },
  finishUpload: function (data, ctx) { return Upload.finish(ctx, Sessions.resolve(ctx, data.token), data); },
  finishBatch: function (data, ctx) { return Upload.finishBatch(ctx, Sessions.resolve(ctx, data.token), data.batchId); },
  ping: function (data, ctx) {
    return {
      libraryVersion: Config.LIBRARY_VERSION,
      schemaVersion: ctx.ss.getSheetByName(Config.TABS.SETTINGS) ? Settings.get(ctx.ss, 'schema_version') : null,
    };
  },
};

/** What the page may know about the logged-in client: never IDs of other clients or folder IDs. */
function me_(ctx, client) {
  return {
    name: String(client.name || ''),
    language: I18n.lang(String(client.language || '')),
    cases: Cases.uploadableForClient(ctx.ss, client.client_id).map(function (c) {
      return { id: c.case_id, name: String(c.case_name || ''), reference: String(c.firm_reference || '') };
    }),
  };
}

const ADMIN_ = {
  saveSetup: function (data, ctx) { return Setup.save(ctx, data); },
};

/** detailed: owner-only callers also get the internal message, to report problems. */
function dispatch_(handlers, action, data, ctx, detailed) {
  const handler = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
  if (!handler) return { ok: false, error: 'unknownAction' };
  try {
    return { ok: true, data: handler(data || {}, ctx) };
  } catch (err) {
    console.error(action + ': ' + (err && err.stack || err));
    const out = { ok: false, error: (err && err.code) || 'generic' };
    if (err && err.code === 'invalid' && err.details) out.details = err.details;
    if (detailed) out.message = String(err && err.message || err).slice(0, 500);
    return out;
  }
}

/** Menu actions: owner check, then any failure becomes an alert instead of a red toast. */
function sheetAction_(ctx, fn) {
  Context.check(ctx);
  const lang = languageOf_(ctx.ss);
  try {
    Context.requireOwner();
    fn(lang);
  } catch (err) {
    console.error(err && err.stack || err);
    // Only the owner gets here, so the technical detail is shown to help report it.
    const key = 'error.' + ((err && err.code) || 'generic');
    const text = I18n.t(lang, key);
    SpreadsheetApp.getUi().alert((text === key ? I18n.t(lang, 'error.generic') : text) + '\n\n' + String(err && err.message || err).slice(0, 500));
  }
}

/** Printed raw inside <script>: escape "<" so no value can close the tag. */
function bootJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** For <?!= include_('html/styles') ?> in templates. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function languageOf_(ss) {
  return safe_(function () {
    return ss.getSheetByName(Config.TABS.SETTINGS) ? Settings.language(ss) : Config.DEFAULT_LANGUAGE;
  }) || Config.DEFAULT_LANGUAGE;
}

function safe_(fn) {
  try {
    return fn();
  } catch (err) {
    return null;
  }
}
