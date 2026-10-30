/**
 * Thin shell bound to each firm's sheet. All logic lives in the Portal
 * library; this file only passes in this sheet's own services, because menu
 * items, google.script.run and triggers can only call functions defined here.
 * Keep it frozen: changing it means touching every firm's copy.
 */
function ctx_() {
  return {
    ss: SpreadsheetApp.getActiveSpreadsheet(),
    props: PropertiesService.getScriptProperties(),
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    authLock: LockService.getDocumentLock() || LockService.getUserLock(),
    script: ScriptApp,
  };
}

function doGet(e)            { return Portal.doGet(e, ctx_()); }
function api(action, data)   { return Portal.api(action, data, ctx_()); }
function admin(action, data) { return Portal.admin(action, data, ctx_()); }
function onOpen(e)           { Portal.onOpen(e); }
function menuSetup()         { Portal.menuSetup(ctx_()); }
function menuProvision()     { Portal.menuProvision(ctx_()); }
function menuInvite()        { Portal.menuInvite(ctx_()); }
function menuUpdate()        { Portal.menuUpdate(ctx_()); }
function menuDevSeed()       { Portal.menuDevSeed(ctx_()); }
function cronProvision()     { Portal.cronProvision(ctx_()); }
function cronDigest()        { Portal.cronDigest(ctx_()); }
