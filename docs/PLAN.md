# Lawyer Document Upload Portal — Reviewed Plan

## Context
Small law firms (≤10 people, no IT) get client documents scattered across email and WhatsApp. The product is a per-firm upload portal: the end client logs in with an emailed one-time code, picks one of their open cases, and uploads PDFs/images straight into the right Drive folder, which is logged in a Sheet. The lawyer gets notified. Hard rule: zero infrastructure on your side, and you never hold client data. Every firm runs its own copy in its own Google account. A shared Apps Script library holds the logic.

The working directory `document_control/` is empty, and Node/clasp aren't installed yet. This is greenfield.

**Assumptions (correct me when you approve):** Portuguese means **PT-PT** (EU/GDPR market). The **lawyer** runs the Claude skill from their own Claude account, not you. v1 accepts **PDF + JPEG/PNG/HEIC** only.

---

## Phase 0 outcome (2026-10-30)
The spike settled these decisions; full results are in [spike/README.md](../spike/README.md).
- **Uploads:** browser-direct resumable upload to Drive with a **100 MB cap** and 8 MiB chunks. The page's Origin is always sent when the session is created.
- **Manifest:** must declare Drive v3 and Gmail v1 as advanced services. That switches the APIs on in the script's hidden Cloud project; without it, REST calls fail with 403.
- **Sheet access:** the shell passes `SpreadsheetApp.getActiveSpreadsheet()` in `ctx`. `openById` would need the full `spreadsheets` scope.
- **Sender:** the lawyer's primary address with the firm name as display name; alias support is optional.
- **Copy test passed:** a copy made by a second account gets Drive switched on automatically, with no Cloud console. In the copy, the menu only appeared after running `onOpen` once from the editor. Onboarding: use a browser signed into only the firm account, with that as the fallback.
- **New risk:** phones signed into Google can fail to open the portal ("unable to open the file"). Phase 1 must test embedding the portal outside Google, and the page needs clear help text.

## Phase 1 status (2026-10-30): done
- **Owner account:** gddataai@gmail.com (dedicated free Gmail).
- **Library:** "Portal Library" `1Hv5PQG8x1vThEmbJA8SsFuoL2t2ai9rl02HecZkXDwAtpha32L0N0Wuh`, version 1 = 0.1.0.
- **Dev sheet:** "Portal - DEV" `1bQw24pOq_HLqfEWTrfFCapPBb4hSq2fTHOts97LBcwM`. Its shell uses the library in development mode (latest pushed code).
- **Verified in the dev sheet:**
  - The `onOpen` menu and the 6-scope consent screen.
  - `Configurar` builds the tabs, validations and protections, and a second run changes nothing.
  - The library-served page and the `google.script.run` → shell `api` → library round trip work, with the PT/EN toggle.
- **Tests:** 58 unit tests (`npm test`), including the rule that the library never calls Cache/Properties/Lock itself.
- **Still to do:** the lawyer-facing template sheet with a pinned version is created at the first release (Phase 6 release tooling).

## Phase 2 status (2026-10-30): done
- **Verified in the dev sheet:**
  - The setup sidebar: field errors, saving, the root folder, the logo upload, and the 5-minute `cronProvision` trigger.
  - The seed: 4 clients and 6 cases, all `ACTIVE`, with folders in Drive.
  - Hand-typed rows: a valid one gets an ID, a ticked box, `ACTIVE` and a folder; a bad email becomes `ERROR` with the reason and keeps its ID for the retry.
- **Portal address:** from the sheet, `getUrl()` returns the test deployment's `/exec` form, which never opens. Inside the real deployment it's correct, so the portal records `portal_url` itself on the first visit. The Setup field is a fallback, and Setup checks that an address opens before saving it.
- **DEV portal deployment:** `AKfycbxtwguC3ujajVLqzURp8h_yk0mE7WO-7uue62aGWQIRp9cgNvYY1MF6K8qi_ZedCUa_NA` (see dev-setup.md).
- **Bugs found and fixed:**
  - Apps Script loads files in its own order: no file may use another file's names at load time (now a test).
  - The `active` checkbox column puts FALSE in every row, so `appendRow` wrote below row 1000. Rows now go to the first free row, and unticked boxes or script-written columns never make a row count as real.
- **Tests:** 105.

## Phase 8 status (2026-10-31): in progress
- **Security review:** [security-review.md](security-review.md). Two fixes:
  - crons throttled to once a minute (the page can call any shell function);
  - at most 20 wrong codes per email per 6 hours (slow guessing across fresh codes).
- **Onboarding:** [onboarding-checklist.md](onboarding-checklist.md), rewritten from what Phases 2–7 taught us.
- **Tests:** 202.
- **Done since:**
  - release 0.2.2;
  - the onboarding is automated by the portal-onboarding skill (release 0.3.0), and its dry run passed;
  - spike cleanup in danielddg96's Drive: both "Portal spike" sheets (with the spike script and its deployment), the "Portal spike uploads" folder and the unconfigured "Portal - Onboarding Test" copy were moved to the trash.
- **Still to do:**
  - the website embed test for multi-account phones;
  - the Workspace alias check (needs a Workspace account);
  - spike cleanup in gddataai's Drive ("Copy of Portal spike" and its folder; danielddg96 was cleaned on 2026-10-31);
  - the pilot firm.

## Onboarding skill (2026-10-31): done (release 0.3.0; dry run as the test lawyer: the skill set up a fresh copy end to end, and the lawyer only signed in, clicked Allow and tested on the phone)
- **Portal changes (for 0.3.0):**
  - `Setup.fromSettings` runs setup from a Settings tab filled in through the connector.
  - The `logo_url` setting: the portal fetches the logo itself. It must be https, its bytes must be PNG or JPEG, up to 1 MB.
  - The first portal visit runs that setup once, under the auth lock, with failures kept as field names.
  - `?portal=status` returns `{libraryVersion, ready, setupError}`.
  - Configurar retries it too.
- **Skill:** `skill/portal-onboarding/SKILL.md`:
  1. ask for the firm's details;
  2. copy the template (Drive connector);
  3. write Settings (Sheets connector);
  4. deploy (Claude in Chrome), with the Allow handoff;
  5. `?portal=status`;
  6. test client and phone test;
  7. handover.
  Drift tests check the template ID and the Settings keys.
- **Tests:** 212.

## Onboarding automation feasibility (2026-10-31)
- **Goal:** a "portal-onboarding" skill the firm runs in its own Claude (Google connectors plus Claude in Chrome), acting in its own account. We never touch it.
- **Test A, passed:** copying the template with the Drive connector (as the test lawyer) keeps the bound script: the Portal menu, the shell, the library and the advanced services all come with it. No browser needed.
- **Test B, passed:**
  - In the copy's editor, Deploy → New deployment opens **already filled in** (Web app, Execute as Me, Anyone), because the manifest's `webapp` section sets them. The automation only types a description and clicks Deploy.
  - Google then asks for authorisation, and the lawyer clicks Allow (the handoff).
  - The deployment URL can be read from the dialog, and `?portal=version` answered 0.2.2.
- **Consequence:** the single permission click can happen at deploy time. One authorisation covers the menus and the portal.
- **Remaining manual steps by design:** Google sign-in, Allow, and the phone test.
- **Test copy:** "Portal - Onboarding Test" in danielddg96's Drive, deployed but not configured.

## Phase 7 status (2026-10-31): done (live test: the skill wrote client and case rows into a portal sheet through a Google Sheets connector)
- **Skill:** `skill/portal-clients/`: `SKILL.md`, `references/schema.md` (columns, allowed values, what each `provision_error` means), and `scripts/portal_rows.py` (IDs and checks matching the portal's rules; 7 Python tests).
- **Rules beyond §6:**
  - Never "append": find the last real row and write at an explicit range. A checkbox column makes appends land below row 1000.
  - Always set `active` and `created_by`.
  - A lawyer's explicit pre-approval lets the skill write first and show what it wrote, but never overrides a validation stop.
- **Drift guard:** `test/skill.test.js` fails if the skill's reference misses a sheet column, if the skill doesn't support the portal's schema version, or if its ID alphabet differs.
- **Test cases:** `skill/portal-clients/evals/` holds 3 cases with CSV copies of a sheet: add a client with two cases, refuse a duplicate email, close a case and neutralise a formula. 11 of 11 checks pass. They were run inline (no independent agent), so this is a sanity check only.
- **Connector:** the live test used a Google Sheets connector with write tools. Onboarding must check that the lawyer's connector can write (a read-only Drive connector isn't enough).

## Phase 6 status (2026-10-30): done
- **Part A, on DEV:** schema 2 migration, the update sidebar and its check, the invite email.
- **Part B:**
  - Release 0.2.0 (library v2). The library and template were shared by link.
  - A test lawyer (danielddg96) copied the template, set it up, deployed, logged in and uploaded.
  - Release 0.2.1 (library v3), then the guided update in that copy: Verificar shows 0.2.1 on both sides, with the same portal URL.
- **Bug found in part B:** an untouched checkbox reads FALSE, so hand-typed clients were never activated. Rows without `created_by` are now activated on first processing (fixed in 0.2.1). **The Claude skill must set `created_by` and `active` explicitly.**
- **Email budget:** one daily budget (`google/MailBudget.js`, Settings `daily_email_limit`, default 95, at most 1500). Digests and invites stop 30 short of it, so code emails always have room.
- **Invites:** `admin/Invite.js` sends rows marked `REQUESTED` when the client is active and their folder exists. It's triggered by the menu or the 5-minute trigger, and marks the row `SENT` with `invited_at`, or `ERROR`.
- **Migrations:** `admin/Migrations.js` runs `schema_version` steps. Schema 2 adds `Clients.invited_at`, the `daily_email_limit` setting, and step 2 (removes the old counters). Migrations run on Configurar, on Guardar and from the 5-minute trigger.
- **Update: guided, not automatic.**
  - Automatic self-update is impossible: a copy's hidden Cloud project has the Apps Script API off, and not even the owner can enable it (`resourcemanager.projects.get` missing).
  - Instead, **Atualizar portal** opens a sidebar with the editor steps (library version, then edit the deployment to a new version, so the URL is kept). **Verificar** compares the sheet's version with the live portal's (`?portal=version`) and runs migrations.
  - The API scopes were removed again.
- **Release:** `npm run release` and `docs/release-process.md`. Template sheet "Portal - Template" `1qSIabs0k2ATwRoMc6xNs84aQcUar1IAzUQH4YsYRRzY`, script `1VGlwgBL3au0P3Xy5SzoCitqeQyCj1iOONMzKg5_Apy5Gz9be0g1QvfQb`.
- **Tests:** 198.

## Phase 5 status (2026-10-30): done (verified on the live DEV portal: logo, privacy notice with contact and link, language remembered)
- **Logo:** `ui/Branding.js` reads the logo from Drive on the server and inlines it as a `data:` URI. The Drive file is never public. It's cached in parts of 90 KB or less, keyed by file ID; any failure means no logo, never a broken page.
- **Privacy:** a short line plus an expandable notice in the footer, built from the firm name, `privacy_contact` and `privacy_policy_url` (https only).
  - Templates for the firm's full policy: `docs/privacy-notice.pt.md` / `.en.md`. These cover Google as processor and the optional Claude/Anthropic disclosure for the skill.
  - The Events log is now pruned after 90 days, once a day, from `cronDigest`.
- **Language:** a visitor's choice is remembered in localStorage (wrapped in try/catch). Without a choice, the client's language from the sheet applies after login.
- **Public strings only:** the page gets only the `app`, `lang`, `login`, `home`, `upload`, `error` and `privacy` strings; there's a test that every key the page uses is in that set.
- **Accessibility:**
  - `aria-invalid` and focus on wrong fields; the status region is described-by.
  - Progress bars are labelled; focus moves to the success message.
  - The language button has its own `lang` and an aria-label.
  - Tap targets are 32 px or more; reduced motion is respected.
- **Mobile:** tighter padding at 420 px or less. Checked in a 375 px preview in light and dark mode.
- **Tests:** 179.

## Phase 4 status (2026-10-30): done
- **Verified:** Ana with several files and a note (one digest email); Bruno with a single case; the fake PDF trashed; the oversized file refused before sending; a phone photo.
- **Bugs found during verification:**
  - A `Session` module shadowed Apps Script's `Session` and broke every owner check. It's now `Sessions`, and a test forbids shadowing Apps Script globals.
  - `select { display: block }` beat the `hidden` attribute, so a previous client's case list showed after logout. Now `[hidden]` is `!important` (with a test), and logout clears all client state.
- **Modules:**
  - `upload/Upload.js`: start, finish, the digest queue and the digest email.
  - `util/FileType.js`: the content check (PDF, JPEG, PNG, and HEIC/HEIF by brand).
  - `DriveRest`: `startResumable`, `head` and `trash`.
- **Flow:**
  1. The server checks that the case belongs to the client, is open and has a folder; checks the type (with a fallback to the extension, for .heic with no type) and the size (the `max_file_mb` setting, at most 100 MB) and the iframe origin; and applies a rate limit of 200 files an hour.
  2. It starts a resumable upload with the Origin header and gives the browser only the session URI. The browser PUTs 8 MiB chunks, resuming from Drive's Range header and retrying network drops with backoff.
  3. Finishing re-reads the file metadata from Drive (parent folder, size, type, name) and checks the first 16 bytes.
  4. A mismatch is trashed, unless the file sits outside the case folder (so it isn't ours), and logged as `upload_rejected`.
  5. A good file gets an Uploads row with the email the client logged in with.
- **Digest:**
  - One email per batch, per recipient: the case's `responsible_email`, else `notification_email`, in the firm's language.
  - It's sent when the client finishes the batch; the 10-minute `cronDigest` sends abandoned batches.
  - At most 15 a day, and failures are retried up to 5 times.
- **Deviation from the plan:** cases without a folder yet aren't offered for upload; they appear once provisioning runs (within 5 minutes). There's no lazy folder creation.
- **Tests:** 171.

## Phase 3 status (2026-10-30): done (verified: Ana, Carla in EN, inactive and unknown get the same answer with no email, lockout after 5 tries, Events log)
- **Modules:**
  - `auth/Otp.js`: request and verify.
  - `auth/Session.js`: sessions.
  - `auth/RateLimit.js`: rate limits.
  - `google/GmailRest.js`: sends the code email (text plus HTML).
  - `data/Events.js`: the security log.
- **Rules:**
  - The code: 6 digits, 10 minutes, single use, 5 tries. Only the salted hash of the code is stored.
  - Requests: at most 1 a minute and 5 an hour per email; 300 an hour across all emails (beyond that, requests are dropped silently); 80 code emails a day (fits the free Gmail limit).
  - No enumeration: every request gets the same answer and is padded to 2.5 s, and the try counter runs for unknown emails too.
  - Sessions: a 256-bit token kept in the browser's memory only; the cache stores its hash. The session lasts 45 minutes, renewed on each request, and 8 hours at most. Each request re-reads the client row.
- **Shell change:** `ctx.authLock` (the document lock), because provisioning can hold the script lock for minutes. DEV portal redeployed at shell version 2.
- **Tests:** 135.

## 1. Critical review: risks, gaps and recommended changes

### 1.1 Blockers / must-change
| # | Issue | Why it matters | Recommendation |
|---|---|---|---|
| A | **Free Gmail for law firms** | Consumer Gmail has no Google data-processing agreement (no GDPR Art. 28 DPA). Quotas are low (100 email recipients/day, 30 concurrent executions). A banner saying *"This application was created by another user, not by Google"* shows on the web app. | **Require Google Workspace** (Business Starter is enough). Treat free Gmail as "pilot only, at the lawyer's own risk". |
| B | **`google.script.run` + base64 for 50–100 MB** | Base64 inflates files by 33%, the whole file sits in Apps Script memory, and DriveApp blobs cap at 50 MB. In practice this breaks well below 50 MB, especially on mobile. | **Use a Drive resumable upload, started on the server.** Apps Script (as the lawyer) creates a resumable session with fixed name, parent case folder, MIME type and `X-Upload-Content-Length`. It returns only the **session URI**, and the browser PUTs the file in chunks straight to Google. No OAuth token reaches the browser. The URI allows one upload of that exact size into that folder and nothing else. **100 MB is feasible** this way. A Phase-0 spike must confirm that browser CORS works from the HtmlService iframe. Fallback if it doesn't: base64 path, capped at whatever the spike proves reliable (likely ~20–25 MB). |
| C | **"Folder creation triggered on new rows"** | `onEdit`/`onChange` triggers **do not fire on Sheets API writes**, and the Claude skill writes through the API. | Write rows as `provision_status = PENDING`. A **time-driven trigger every 5 min** plus a menu item "Process new rows" provisions them. Folders are also created **lazily** at first upload if still missing. |
| D | **`google.script.run` cannot call library functions** | It only reaches top-level functions of the deployed (shell) project. Menu items and triggers also need shell globals. | The shell exposes a fixed set of tiny wrappers (`doGet`, `api(action,payload)`, `onOpen`, menu handlers, `cronProvision`). All of them delegate to the library. |
| E | **Library resource scoping** | Cache/Properties/Lock calls made inside library code can resolve to the *library's* store. That could mix tenants' OTPs and sessions into storage you own, which breaks "never hold client data". | The **library never calls `CacheService`/`PropertiesService`/`LockService` itself.** The shell injects its own instances via a `ctx` object on every call. Pin this with a unit test or lint rule. |
| F | **Gmail quota exhausted by notifications** | One email per upload: a client sending 20 photos uses 20 sends, and that pool is shared with OTP emails. | Send **one digest per upload session** (on "Finish", or a trigger flushes after 10 min idle). Track a daily email budget in Properties. When near the limit, OTP emails get priority over notifications. |

### 1.2 Security
- **Scope minimisation**, because a bug in an "execute as lawyer, anyone can access" web app runs with the lawyer's authority. Declare `oauthScopes` explicitly in the shell manifest:
  - `drive.file`, not full `drive`. The app can only see files and folders it created, so a bug can't leak the lawyer's whole Drive. Consequence: avoid `DriveApp` (it forces full drive scope) and use small REST wrappers through `UrlFetchApp` + `ScriptApp.getOAuthToken()`. The logo is uploaded through the setup dialog so the app owns it. Folders the lawyer creates by hand are invisible to the app, which is by design.
  - `spreadsheets.currentonly`, `gmail.send` (REST, raw MIME, which supports a configured **send-as alias** in `From`), `script.external_request`, `script.scriptapp` (triggers), `script.container.ui` (menu/dialogs).
  - Avoid `GmailApp` (needs full mail scope) and `MailApp` (no alias support).
- **OTP:**
  - Store `sha256(salt + email + code)`, never the plain code. The salt is generated per deployment at setup.
  - 10-min TTL, single use, 5 attempts, then the code is invalidated.
  - Use `LockService` around attempt counters to avoid races.
  - CacheService can evict entries early. That's acceptable: the user just requests a new code.
- **No IP addresses are available in Apps Script**, so rate-limit per email and globally instead:
  - At most 1 code per 60 s and 5 per hour per email.
  - A global daily OTP cap.
  - A hidden honeypot field.
  - This stops attackers using the portal to spam registered clients or burn the firm's quota.
- **Enumeration via timing:** sending mail takes about 1 s, so a fast "not registered" reply would leak which emails exist. Pad every "request code" response to a constant ~2.5 s, and keep the response text identical.
- **Session token:**
  - 256-bit random value stored in the injected cache with clientId, 45-min sliding TTL.
  - Kept in JS memory only (not localStorage); a page reload means a new login.
  - **Every** `api` call re-derives the client from the token and checks on the server that the case belongs to that client and is still open. Never trust a clientId or caseId sent by the browser.
- **Upload validation (server-side, at finalize):**
  - Re-read Drive metadata and check parent folder, size and MIME type.
  - Fetch the first 16 bytes (HTTP `Range`) to check magic numbers: `%PDF`, `FFD8FF`, `89504E47`, `ftypheic/heix/mif1`.
  - On mismatch, trash the file and log a security event.
  - Check type and size on the client too, for UX only.
- **Spreadsheet formula injection:** file names and notes come from clients. Prefix any value starting with `= + - @` with `'` before writing to the Sheet.
- **File names:** sanitise them and store as `YYYY-MM-DD_HHMM_<original>`. Never build Drive `q` queries from user strings.
- **Library supply chain:**
  - Lawyers pin a library **version number**. Never use "HEAD/development mode" in their copies.
  - A compromised or buggy release reaches a firm only when that firm's copy is updated.
  - Library code is readable by anyone with the link, so **put no secrets in it**.
  - Use a dedicated business Google account with 2FA (hardware key) to own the library.
- **Workspace admin policies** can block the "Anyone" web-app access, unverified apps, or Apps Script entirely. Add these as pre-onboarding checks.
- **"Unverified app" consent screen:** the lawyer authorises *their own* copy, so the warning is expected and harmless, and the 100-user cap doesn't apply (one user). Clients never see a consent screen. Script the explanation for the onboarding call.

### 1.3 Product / UX gaps
- **HEIC** (iPhone default photo format) must be accepted, or most phone uploads fail.
- **Multiple contacts per client** (companies, couples). Add an `additional_emails` column (`;`-separated).
- **Client invitation:** nothing currently tells clients the portal exists. Add an `invite` action that emails the portal link and instructions in the client's language.
- **Optional note per upload** ("Fatura março"), shown in the log and the digest.
- **Responsible lawyer per case:** in a 10-person firm the notification should go to the case owner. Add `Cases.responsible_email`, falling back to the Settings default.
- **Ownership continuity:** if the deploying lawyer leaves, everything is in their account. Recommend a firm-level account (e.g. `portal@firm.pt`) or a Shared Drive root (needs `supportsAllDrives=true` in REST calls).
- **Trust/phishing perception:** a `script.google.com` URL looks odd. Link it from the firm's website or email signature, and send the branded invite email. Optionally embed it in the firm site (iframe allowed via `setXFrameOptionsMode(ALLOWALL)`).
- **Upload progress, retries and resume** on flaky mobile connections. Chunked resumable upload gives this almost for free.
- **Logo:** never make a Drive file public. Serve it as a base64 data-URI fetched on the server and cached.

### 1.4 GDPR
- The lawyer is the controller and Google (Workspace) is the processor. **You are not a processor only if you never access data.** So never take editor access to a firm's sheet or folders, including during onboarding. Do screen-share instead.
- The **Claude skill sends client names/emails to Anthropic**, so the firm's privacy notice must list it as a processor or recipient. Provide template text.
- Privacy notice on the page: controller identity and contact, purpose (receiving documents for legal services), legal basis (contract / Art. 6(1)(b), legal obligation), retention (as per the firm's policy), rights, and a link to the full policy. Ship PT-PT/EN templates the lawyer must fill in.
- Retention for tool data: OTP and session data expire automatically. A hidden `Events` (security log) tab is pruned after 90 days by trigger.

### 1.5 Apps Script limits to design around
| Limit | Value (consumer / Workspace) | Impact |
|---|---|---|
| Execution time | 6 min | Fine. Uploads go direct to Drive, not through Apps Script. |
| Simultaneous executions per user | ~30 | All clients run as the lawyer. Fine for small firms; keep calls short. |
| Email recipients/day | 100 / 1,500 | Digest notifications and a budget counter (see 1.1-F). |
| URL Fetch calls/day | 20k / 100k | About 4 calls per upload. Fine. |
| Trigger runtime/day | 90 min / 6 h | Provision trigger exits early when nothing is pending. |
| Cache | 100 KB per value, max 6 h TTL | Fine for OTP and session data. |
| Libraries | Add load latency to every call | Acceptable. Keep the library lean and avoid heavy top-level work. |

### 1.6 Alternatives considered
- **Google Forms file upload:** needs a Google login for respondents. Rejected.
- **OneDrive "Request files" / Dropbox File Requests:** zero dev and no login, but no per-client authentication, no case routing, no log. Useful as the "do nothing" baseline in sales.
- **Workspace Marketplace add-on (private):** central updates, but needs OAuth verification per scope set, and a web app can't run per-tenant. Revisit only if the copy+library update overhead becomes painful.
- **Verdict:** keep library + template copy, with the changes above, and add a **self-update** action (Phase 6) so you never need access to a lawyer's project.

---

## 2. Project / file structure

```
document_control/
├── package.json            # @google/clasp, eslint, prettier, jest (dev only)
├── README.md
├── library/                # standalone Apps Script project (owned by you)
│   ├── .clasp.json         # scriptId of the library; rootDir: src
│   └── src/
│       ├── appsscript.json         # V8, no webapp section
│       ├── Portal.js               # PUBLIC surface: doGet, api, onOpen, menu*, cron*
│       ├── Config.js               # limits, MIME allowlist, magic bytes, SCHEMA_VERSION
│       ├── Context.js              # validates injected ctx {ss, props, cache, lock}
│       ├── data/Table.js           # header-mapped sheet access (never positional)
│       ├── data/Settings.js        # key/value Settings tab
│       ├── data/Clients.js  data/Cases.js  data/Uploads.js  data/Events.js
│       ├── auth/Otp.js  auth/Session.js  auth/RateLimit.js
│       ├── google/DriveRest.js     # folders, resumable init, metadata, range read
│       ├── google/GmailRest.js     # raw MIME send, alias support
│       ├── upload/Upload.js        # initUpload, finalizeUpload, validate, digest queue
│       ├── admin/Setup.js  admin/Provision.js  admin/Migrations.js  admin/Invite.js
│       ├── i18n/I18n.js  i18n/pt.js  i18n/en.js   # UI + email strings
│       ├── util/Crypto.js  util/Sanitize.js  util/Ids.js  util/Validate.js
│       ├── dev/Seed.js             # seedTestData(); refuses to run unless DEV flag set
│       └── html/
│           ├── index.html          # shell layout, includes partials
│           ├── styles.html         # shared palette (CSS vars), mobile-first
│           ├── app.js.html         # state machine: email → code → case → upload → done
│           ├── uploader.js.html    # chunked resumable PUT, progress, retry
│           ├── privacy.html        # notice rendered from Settings + i18n
│           └── setup_dialog.html   # sheet sidebar for Setup
├── shell/                  # bound script of the TEMPLATE sheet
│   ├── .clasp.json         # scriptId of the template's bound script
│   ├── appsscript.json     # library dep (pinned version), explicit oauthScopes, webapp: USER_DEPLOYING / ANYONE_ANONYMOUS
│   └── Code.js             # ~30 lines of wrappers, builds ctx, delegates to library
├── test/                   # jest unit tests for pure modules (+ tiny GAS globals mock)
├── skill/portal-clients/
│   ├── SKILL.md
│   └── references/schema.md
├── fixtures/
│   ├── test-firm.json      # sample firm, clients, cases
│   └── logo-placeholder.png
└── docs/
    ├── PLAN.md             # this plan, copied in after approval
    ├── onboarding-checklist.md
    ├── release-process.md
    ├── privacy-notice.pt.md  privacy-notice.en.md
    ├── gdpr-notes.md
    └── test-plan.md
```

`shell/Code.js` shape (the full contract between template and library):
```js
function ctx_() { return { ss: SpreadsheetApp.getActiveSpreadsheet(),
  props: PropertiesService.getScriptProperties(), cache: CacheService.getScriptCache(),
  lock: LockService.getScriptLock() }; }
function doGet(e)            { return Portal.doGet(e, ctx_()); }
function api(action, data)   { return Portal.api(action, data, ctx_()); }
function onOpen(e)           { Portal.onOpen(e); }
function menuSetup()         { Portal.menuSetup(ctx_()); }
function menuProvision()     { Portal.menuProvision(ctx_()); }
function menuInvite()        { Portal.menuInvite(ctx_()); }
function cronProvision()     { Portal.cronProvision(ctx_()); }
function cronDigest()        { Portal.cronDigest(ctx_()); }
```
The shell stays frozen. All change ships in the library. A shell change is a rare "major" release.

### Sheet schema (header row frozen and protected; header names are the contract)
- **Settings** (key | value): `firm_name, logo_file_id, notification_email, send_as_alias, root_folder_id, default_language, portal_url, privacy_contact, privacy_policy_url, max_file_mb, schema_version, library_version`
- **Clients:** `client_id | name | email | additional_emails | language | active | invite_status | provision_status | provision_error | folder_id | created_at | created_by | notes`
- **Cases:** `case_id | client_id | case_name | firm_reference | status(open/closed) | responsible_email | provision_status | provision_error | folder_id | created_at | created_by`
- **Uploads:** `upload_id | timestamp | client_id | client_name | case_id | case_name | stored_name | original_name | mime_type | size_bytes | md5 | drive_link | uploader_email | note | status`
- **Events** (hidden): `timestamp | type | email_hash | detail`, pruned after 90 days.

IDs: `CL-` / `CS-` + 6 chars Crockford base32 (e.g. `CL-7K3Q9X`), immutable. Status columns use data-validation dropdowns. `folder_id` and `provision_*` are protected (script-owned). Drive folder names are `"<name> [CL-7K3Q9X]"`. Lookups always go through the stored folder ID, so renames are safe.

---

## 3. Implementation phases

**Phase 0: Setup and spikes (de-risk first, about 1 day)**
1. Dev environment (§4).
2. Spikes, each a throwaway script:
   - (a) A resumable upload session created on the server, with the browser PUTting a 100 MB file from the HtmlService iframe (CORS, chunking, mobile Safari).
   - (b) Library-served HTML through the shell `doGet`, plus `google.script.run` → shell `api`.
   - (c) The consent screen with explicit `drive.file` scopes, and folder creation through REST.
   - (d) Gmail REST send with a send-as alias.
   - (e) Whether `openById` of the container works under `spreadsheets.currentonly` from a web-app execution.
3. Decision gate: the upload size cap and the upload path.

**Phase 1: Skeleton and data layer**
- Create the library and shell projects and the template sheet.
- Build `Table.js` (header mapping), the Settings/Clients/Cases repos, validation, ID generation and `Context` injection.
- Write unit tests for the pure modules.

**Phase 2: Setup and provisioning**
- Setup sidebar: firm name, notification email, alias, language, logo upload, privacy contact.
- It creates the root folder, writes Settings, generates the salt, installs triggers and records `portal_url` after deployment.
- `Provision.js`: PENDING → validate → create folders → ACTIVE/ERROR with message. Idempotent and run under a lock.
- Seed script for test data.

**Phase 3: Authentication**
- OTP request with constant-time response, rate limits and a bilingual email.
- Verify, then issue the session token.
- Write security events to the Events tab.

**Phase 4: Upload**
- Case list for the session (dropdown skipped when there's one case; message when there are none).
- `initUpload` (server-side resumable session) → browser chunked PUT with progress and retry → `finalizeUpload` (verify, magic bytes, log row, queue digest).
- Digest email per session.

**Phase 5: UI polish**
- PT-PT/EN toggle, remembered per browser.
- Shared palette and per-firm logo.
- Privacy notice.
- Mobile layout, accessibility (labels, focus, contrast) and empty/error states.

**Phase 6: Admin and release tooling**
- Client invite action.
- Migrations framework (driven by `schema_version`).
- **"Portal → Update" menu (self-update):** the lawyer's own script uses the Apps Script API with the lawyer's token. It bumps the library version in its manifest, creates a script version and updates the existing deployment, so the URL stays the same. This needs the lawyer to enable the Apps Script API in their user settings plus the `script.projects`/`script.deployments` scopes. Until it exists, updates are a 3-minute guided step on a check-in call.

**Phase 7: Claude skill** (spec in §6)

**Phase 8: Hardening and pilot**
- Security pass (§1.2 checklist), quota and abuse tests, full end-to-end run on the test firm.
- Pilot with one friendly firm, then the onboarding docs.

---

## 4. Local dev workflow, versioning and updates

**One-time setup:**
1. Install Node LTS (`brew install node`, or nvm).
2. `npm i -g @google/clasp` (v3).
3. Create a **dedicated developer Google account** (Workspace, 2FA), the owner of the library and the template.
4. Enable the Apps Script API at script.google.com/home/usersettings for that account.
5. `clasp login`.
6. Create a **second test account** acting as "lawyer" (ideally a Workspace trial user, plus one free Gmail to test the degraded mode) with the Apps Script API enabled.
7. Create a test inbox using plus-addressing (`you+ana@…`, `you+bruno@…`) for the fictional clients.

**Day-to-day:**
- `library/`: `clasp push --watch`.
- Your **dev copy** of the template references the library in **development mode (HEAD)**. You are an editor, so HEAD works for you; it never works for others.
- The dev web app uses the "Test deployment" (`/dev` URL), which always runs HEAD code.
- `npm test` for unit tests. `npm run lint` checks for no direct `CacheService`/`PropertiesService` calls in the library.

**Release (library):**
1. Tag in git.
2. `clasp create-version "vX: notes"` (clasp v2 equivalent: `clasp version`), which gives you library version number N.
3. Update `CHANGELOG.md` with the "minimum schema_version" and any migration.
4. Update the **template's** shell manifest to pin N, so new copies get N.

**Sharing:** the library project is shared "Anyone with the link: Viewer". That's the only way lawyer accounts can resolve it. Implication: your source is readable by anyone with the link, so keep no secrets in it. Lawyers can't modify it, and pinned versions are immutable.

**Updating existing firms:** "Portal → Update" (Phase 6) moves a firm's copy to the latest *compatible* version and runs migrations. Before that exists: a guided screen-share. Never take editor access yourself.

---

## 5. Onboarding checklist (per firm)

**Before the call (email the lawyer):**
- [ ] Google Workspace account confirmed (or a signed acknowledgement of the free-Gmail limits).
- [ ] Admin check (if they have a Workspace admin): Apps Script allowed, "Anyone" sharing of web apps allowed, unverified internal apps allowed.
- [ ] Logo file (PNG/SVG), notification email, optional send-as alias already set up in Gmail settings.
- [ ] Privacy contact plus link to the firm's privacy policy.
- [ ] Claude account with the Google Drive/Sheets connector (for the skill).

**On the call (lawyer drives, you screen-share; ~30 min):**
1. Open the "make a copy" link and rename the copy to "Portal – <Firm>".
2. Reload, open the **Portal → Setup** menu and authorise. Walk them through the unverified-app screen ("Advanced → Go to …"): it's their own script.
3. Fill in the Setup sidebar, upload the logo and confirm the root folder appears in Drive.
4. Extensions → Apps Script → **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**. Copy the URL.
5. Portal → Setup → "Save portal URL" (auto-detected; confirm).
6. Fill in the privacy notice fields and preview the portal on desktop and phone.
7. Add the lawyer themself as a test client with one case, using the skill (connect the Sheets connector, give it the sheet ID).
8. On their phone: log in with OTP, upload a PDF and a photo. Check the Drive folder, the Uploads row and the digest email.
9. Deactivate the test client.
10. Hand over: portal URL for the website/signature, the invite flow, and how to close cases.

**After:**
- [ ] Record firm name, library version and date in *your* CRM (no client data).
- [ ] Schedule a 2-week check-in.

---

## 6. Claude skill spec: `portal-clients`

**Access decision:** the skill runs in the **lawyer's own Claude account** and reaches the sheet through the **Google Sheets/Drive connector the lawyer authorised with their own Google account**. Data flows lawyer ↔ Anthropic ↔ lawyer's Google. You hold no credentials and need no OAuth client of your own.

Rejected options:
- Your own Sheets-API OAuth app: you'd hold tokens to every firm's data, and it needs Google verification.
- A secret-key `doPost` admin endpoint: a credential lives in the skill, and the endpoint is exposed to the internet.

**Configuration:** the sheet ID or URL is saved once in the lawyer's Claude project instructions or memory. The skill asks for it if missing.

**Operations:** `add_client`, `add_case`, `close_case`, `reopen_case`, `deactivate_client`, `update_client_email`, `request_invite`, `status` (read back provisioning results), `list`.

**Rules the skill must follow:**
1. **Preflight:**
   - Read `Settings` and refuse if `schema_version` is outside the supported range.
   - Read the header rows of Clients/Cases and map columns **by header name**.
2. **Dedupe:**
   - Normalise the email (trim, lowercase) and search `email` + `additional_emails`.
   - If a match exists, confirm with the lawyer instead of creating a duplicate.
3. **IDs:**
   - Generate `CL-`/`CS-` + 6 random Crockford-base32 chars and check them against the existing IDs.
   - The ID is returned to the lawyer and used immediately for `add_case` in the same conversation.
4. **Writes:**
   - Only **append** rows, or update the specific allowed cells (`status`, `active`, `email`, `additional_emails`, `invite_status=REQUESTED`).
   - Never write `folder_id`, `provision_*` or `Uploads`/`Events`.
   - Never delete rows.
   - New rows get `provision_status=PENDING`, `created_at` (ISO) and `created_by=claude-skill`.
5. **Validation before write:**
   - Email format.
   - Name non-empty and ≤120 chars.
   - `language` ∈ {pt, en}.
   - `client_id` exists and is active for a case.
   - `status` ∈ {open, closed}.
   - Values starting with `= + - @` are prefixed with `'`.
6. **Confirm before writing:** show the lawyer a summary table and get a yes.
7. **After writing:** tell the lawyer folders will appear within ~5 min (or immediately via Portal → Process new rows). On request, `status` reads `provision_status`/`provision_error` back and explains errors.
8. **Privacy:** the skill never reads `Uploads` content or Drive files. It only handles client name, email and case metadata.

**Acceptance tests:**
- Add a client and two cases.
- Duplicate email detected.
- Case for an unknown client rejected.
- Close a case, and the portal no longer lists it.
- Schema-version mismatch refused.
- Formula-like name neutralised.

---

## Test data (fixtures/test-firm.json + dev/Seed.js)
- **Firm:** "Silva & Costa Advogados" (fictional), PT default, placeholder logo (generated simple monogram PNG).
- **Clients:**
  - Ana Ferreira: 2 open cases ("Divórcio", "Herança"), so the dropdown shows.
  - Bruno Mendes: 1 open ("Contrato arrendamento") and 1 closed, so the dropdown is skipped.
  - Carla Duarte Lda: 1 closed case only, so the "contact your lawyer" message shows.
  - Diogo Santos: inactive, so login behaves exactly like an unknown email.
- All emails are plus-addresses of your test inbox.

## Verification (end-to-end)
1. `npm test` passes (validation, sanitise, IDs, OTP hashing, rate-limit logic, i18n key parity PT/EN).
2. Seed the test firm in the dev copy and run "Process new rows". Folders exist and statuses are ACTIVE.
3. Portal (desktop + iPhone Safari + Android Chrome) for each test client:
   - Correct case behaviour per client.
   - Unknown and inactive emails give an identical response with similar timing.
   - A wrong code 5× invalidates the code.
   - Code reuse is rejected.
   - An expired session forces a new login.
4. Uploads:
   - PDF, JPEG, PNG and HEIC succeed.
   - A `.exe` renamed to `.pdf` is rejected and trashed.
   - 100 MB succeeds (or the agreed cap per the spike).
   - Over-cap files are rejected on client and server.
   - A tampered caseId belonging to another client is rejected.
5. The Uploads log is correct, a formula-like file name is neutralised, one digest email arrives per session, and the alias sender works.
6. Run the skill against the dev sheet: all acceptance tests in §6.
7. Fresh "make a copy" from the **test lawyer account**: the onboarding checklist works end to end on the pinned library version. The update flow moves it to a newer version with the URL unchanged.

## Decisions to confirm at approval
1. Require Workspace (recommended), or allow free Gmail as "pilot".
2. PT-PT (assumed) or PT-BR.
3. The lawyer operates the skill (assumed; keeps you out of the data path).
4. Accept HEIC (recommended), and keep Word/other formats out of v1.
