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
