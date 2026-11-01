# Security review (Phase 8, 2026-10-31)

Scope: library 0.2.x, the shell, the public page, the setup sidebar and the Claude skill. The checklist is PLAN §1.2.

## Holds

| Area | How |
|---|---|
| Scopes | `drive.file` (only what the app created), `spreadsheets.currentonly`, `gmail.send`, `script.external_request`, `script.container.ui`, `script.scriptapp`, `userinfo.email`. No full Drive, Gmail or Sheets access. |
| Tenant isolation | The library never calls Cache/Properties/Lock/active-spreadsheet itself: the shell injects them (test enforced). The library holds no secrets: its source is link-readable. |
| Owner-only actions | Menus and the setup sidebar call `requireOwner` (active user = effective user). Anonymous visitors have no active user. |
| Login | The code is 6 digits, lives 10 min, works once and allows 5 tries. Only a salted hash is stored. The request answer and timing (2.5 s) are the same for known and unknown emails, and wrong tries count for unknown emails too. Limits: per email 1/min and 5/h, global 300/h, a daily email budget, and **20 wrong codes per email per 6 h** (added here). |
| Sessions | A 256-bit token, kept in page memory only; the cache stores its hash. 45 min sliding, 8 h maximum. Each call re-reads the client row, so deactivating a client ends their session. |
| Authorisation | Every upload and case call resolves the client from the session and checks the case is theirs, open and has a folder. Browser-supplied IDs are never trusted. |
| Uploads | The browser gets only a one-file, fixed-size, fixed-folder Drive session URI. On finish the server re-reads the file: folder, size, type, name and first bytes (magic numbers). A mismatch is trashed (only inside the case folder) and logged. Type and size are re-checked on the server. |
| Injection | Every sheet write passes `Sanitize.cell` (formula injection). File names are sanitised. Email headers can't carry CR/LF, and names are RFC 2047 encoded. Emails escape all HTML. The public page builds no HTML from data (`textContent` only). |
| Information exposure | The page gets client-facing strings only. Errors reach the browser as codes, never messages (messages go to the owner only). `?portal=version` reveals only the library version. |
| Logs | Events stores salted email hashes, not addresses, and is pruned after 90 days. |
| Skill | It writes through the lawyer's own connector, only to allowed cells, validates first, confirms before writing (unless pre-approved, never past a validation stop), and never reads Uploads, Events or Drive files. |

## Fixed in this review

1. **Crons callable from the page.** `google.script.run` can reach every shell function. `cronProvision` and `cronDigest` now run at most once a minute, however they're called.
2. **Slow code guessing.** The per-code tries reset with every new code, so 5 codes an hour gave about 600 guesses a day per email (around 2% over a month). Now there are at most 20 wrong codes per email per 6 hours (around 0.2% over a month).

## Accepted risks

- **Framing:** `ALLOWALL` lets firms embed the portal on their site, which fixes the multi-account phone problem. The page has no one-click destructive action, so the clickjacking value is low.
- **Free Gmail:** there's no Google DPA, and the banner shows. Workspace is recommended at onboarding.
- **Updates are manual:** a firm can lag behind on releases. That's mitigated by announcing releases and the 2-week check-in.
- **Code by email:** the account is only as safe as the client's mailbox. That's normal for passwordless login.
- **Library owner account:** a compromise could ship malicious code in a new library version. But firms only run a version they pick, nothing reaches them on its own. Keep 2FA (ideally a hardware key) on gddataai.

# Security review (2026-11-01, library 0.4.1)

Question: can anyone using the portal get documents out of the firm's Drive? Scope: every function the public page can reach (`doGet`, `api`, the crons, and the owner-only `admin` and menus), uploads, login, sessions, what reaches the browser and emails, secrets, Drive sharing and the catalog feed.

## Holds

- **No read path.** Without login the page reaches `requestCode`, `verifyCode` and `ping`; with a session, `me`, `startUpload`, `finishUpload`, `finishBatch` and `logout`. None returns file contents, Drive links, file IDs or file names. A client gets only their own case names and checklist text.
- **Owner-only functions refuse anonymous visitors:** all 6 `admin` actions and all 5 menus (checked with an anonymous session). Action names like `__proto__` or `constructor` give `unknownAction`.
- **Uploads:** the browser gets a single-use Drive address for one file of a fixed size in one folder, never a token. The server checks folder, size, type, name, first bytes and (new) creation time.
- **Drive:** `drive.file` only; nothing creates sharing permissions; the firm's folders stay private to its account.
- **No secrets** in the library, the scripts or the git history. Test endpoints used during development are removed (they answer with the normal page).

## Fixed in this review

1. **A client could trash an earlier file of their own.** Starting a new upload and reporting the ID of an older file in the same folder failed the size check, and the portal trashed that older file. `finish` now refuses any file created before the upload started, and never trashes it.
2. **Abandoned uploads were never checked.** A file whose upload started but never finished stayed in the case folder unverified. A daily sweep (`Upload.sweep`, in the 10-minute job once a day) trashes files in open cases' folders that Uploads doesn't know (by Drive ID or stored name) and that are older than an upload may live (6 hours). The portal only sees files it created, so the lawyer's own files are never touched. Dry run on DEV: 8 folders checked, nothing to trash.

## Accepted risks (added)

- **Lockouts:** anyone can use up the hourly code budget (300) or lock one client out for a while by guessing codes for their email. This blocks logins temporarily and exposes nothing.
- **Content:** a genuine PDF or image can still carry harmful content. Types and first bytes are checked; lawyers should keep normal caution opening files.
- **Accounts outside the portal:** the lawyer's Google account (2-step verification; share the sheet only with trusted staff), gddataai (hardware key: it publishes library versions) and the GitHub account behind the catalog feed (it can change list text, applied only when the lawyer clicks Apply).
