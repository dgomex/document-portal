# Phase 0 spike

> **Archived (2026-10-31):** the spike sheet, its script and the upload folder were moved to the trash in danielddg96's Drive. This folder keeps the code and findings for reference (the `spike:push` command was removed).


Throwaway Apps Script project, bound to a test Google Sheet, that answers the open questions in [docs/PLAN.md](../docs/PLAN.md) §3 before any real code is written. Delete it after the decision gate.

## Run it

1. The bound project already exists ([sheet](https://drive.google.com/open?id=1o8LHntH5lYMkE8Qy1YzWpnEhmzrl-hG3xudahPEr0Ig), [script](https://script.google.com/d/1fV80d31edR5hL0khwGvHCFWsnupj_rbB9WE8WU_iMB30kaaIS_5_VEun/edit)), linked through `spike/.clasp.json`. If you ever recreate it, `clasp create-script` overwrites `appsscript.json` with Google's default. Restore this repo's version before pushing, because the explicit `oauthScopes` are part of what is being tested.
2. Push: `npm run spike:push`
3. Open the new sheet and reload it. In the **Spike** menu, run items 1 and 3, approving the consent screen (expect "Google hasn't verified this app": Advanced → Go to …).
4. In the Apps Script editor: **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**. Open the `/exec` URL in a private window (no Google login) on desktop and on a phone.

## Test matrix (fill in results)

| # | Test | How | Result |
|---|---|---|---|
| a1 | Upload 5 MB PDF, Origin **on** | Page → Upload | **Pass** (174 KB PNG, single chunk, 5.0 s; final response body readable from the browser) |
| a2 | Same, Origin **off** | Untick checkbox | **Fail on last chunk only**: all 308s readable, the final 200 blocked by CORS (status 0). Origin is required. |
| a3 | 50 MB file, 8 MiB chunks | | **Pass** (ran with 256 KiB chunks: 201 chunks, 128.3 s; md5 matches the local file). Re-time with 8 MiB chunks. |
| a4 | 100 MB file, 8 MiB chunks | | **Pass**: 99 MiB (103.8 MB) in 13 chunks of 8 MiB, 15.1 s, md5 matches the local file. 100 MB cap is feasible. |
| a4b | File just over 100 MiB is refused before any upload starts | `test-over-limit.pdf` | **Pass**: server refused it when creating the session (`size not allowed: 104858294`), nothing reached Drive |
| a5 | iPhone Safari: HEIC photo from camera roll | Phone | **Pass**: phone upload worked (file format to confirm). The page first failed with "Não é possível abrir o ficheiro" (see findings). |
| a6 | Android Chrome: JPEG from camera | | |
| a7 | Finalize: `inSpikeFolder`, `magicOk` true; size/md5 present | Log output | **Pass**: Range read returned 206 + 16 bytes, PNG magic matched, md5 and size present |
| a8 | Rename a `.txt` to `.pdf` and upload: `magicOk` false | `fake.pdf` | **Pass**: `magicOk: false` (first bytes `This is plain te…`). Drive still labelled it `application/pdf`, so it trusts the declared type and the signature check is essential. |
| a9 | Is the 308 `Range` header readable? (`unreadable`/`null` vs value) | Log output | **Pass**: 2 MB in 9 chunks of 256 KiB, every 308 carried a readable `Range`, 7.9 s, md5 matches the local file |
| c1 | Consent screen lists only the 5 declared scopes | Step 3 | **Pass** |
| c2 | Folder created through REST under `drive.file` | Menu 1 | **Pass**, after declaring Drive/Gmail advanced services (see findings) |
| d1 | Email from primary address arrives, accents correct | Menu 2, blank alias | **Pass** |
| d2 | Email from a configured send-as alias shows alias + firm name | Menu 2 with alias | **Deferred**: no alias was set up, so Gmail sent from the primary address. Alias support is optional in v1; retest on Workspace. |
| e1 | `spikeCheckSheet`: `openById` works from the anonymous web app | Page → Check | **Fail**: needs full `spreadsheets` scope |
| e2 | Note whether `getActiveSpreadsheet()` is null in web-app context | Page → Check | **Pass**: returns the bound sheet under `currentonly` |
| x1 | "Created by another user" banner shown? (free Gmail vs Workspace) | Visual | **Shown** on a free Gmail owner. Retest with a Workspace owner. |

## Findings

- **Advanced services must be declared in the manifest.** REST calls through `UrlFetchApp` with the script's token failed with `403 accessNotConfigured` because the Drive API was off in the script's hidden default Cloud project. Adding Drive v3 and Gmail v1 under `dependencies.enabledAdvancedServices` switched them on automatically, with no Cloud console and no change to the permission list. The shell manifest must declare both.
- **Still to verify:** whether a sheet copied with "make a copy" by another account gets the APIs switched on in its own new hidden project. Test this in the copy test with the test lawyer account.
- **The browser Origin must be sent when the server creates the upload session.** Without it, Drive answers the intermediate chunks with CORS headers but not the final response, so the browser can't see the new file ID. The real `initUpload` takes the origin from the page and checks it matches `https://*-script.googleusercontent.com` before using it.
- **Planned fallback for the final response:** if the browser loses the last reply (dropped connection, CORS), the server can ask Drive for the session's status itself (`PUT` with `Content-Range: bytes */<size>`) and get the file metadata. Then a lost reply never leaves an unlogged file.
- **Phones signed into Google can fail to open the portal** with "Não é possível abrir o ficheiro" ("Sorry, unable to open the file at this time"). This is a known Apps Script problem when the browser is signed into one or more Google accounts. A clean browser session works. Real clients will hit this, so Phase 1 must test embedding the portal in a page outside Google and give clear in-page help.
- **Reach the sheet with `getActiveSpreadsheet()`, not `openById`.** It works from the anonymous web app under `spreadsheets.currentonly`; `openById` needs the full `spreadsheets` scope.

## Decision gate

- **a1 or a2 pass on desktop and phones:** resumable direct upload is the upload path. Set the cap at 100 MB if a4 passes, else 50 MB.
- **Both fail with a CORS error:** fall back to base64 via `google.script.run`. Re-test to find the largest size that works reliably and set that as the cap (expect ~20–25 MB).
- **e1 fails:** keep the spreadsheet ID in Script Properties and add the full `spreadsheets` scope, or find another way for the web app to reach its own sheet.
- **d2 fails:** drop alias support from v1 and send from the primary address with the firm name as display name.

## Outcome (2026-10-30)

| Question | Decision |
|---|---|
| Upload path | Browser-direct resumable upload to Drive, session created on the server; no OAuth token in the browser |
| Size cap | **100 MB**; 8 MiB chunks (99 MB took 15.1 s on desktop) |
| CORS | Always send the page's Origin when creating the session, after checking it matches `https://*-script.googleusercontent.com` |
| Lost final reply | Server can query the session status itself and recover the file details |
| File checks | Server-side size limit when creating the session, plus a magic-byte check at finalize (Drive trusts the declared type) |
| Scopes | `drive.file`, `spreadsheets.currentonly`, `gmail.send`, `script.external_request`, `script.container.ui`, and Drive v3 + Gmail v1 declared as advanced services |
| Sheet access | `SpreadsheetApp.getActiveSpreadsheet()`; never `openById` |
| Sender | Lawyer's primary address with the firm name as display name; alias optional, retest on Workspace |

**Copy test (passed):**
- A second free Gmail account made a copy with "make a copy", ran `onOpen` from the editor, approved, and created a folder through Drive REST with no Cloud console.
- So copies inherit the advanced-service declaration and get the APIs switched on in their own hidden project.
- **Onboarding note:** in the copy the Spike menu did not appear on its own, and `onOpen` never ran when the sheet opened (likely the multi-account browser problem). Running `onOpen` once from the editor fixed it and also triggered the approval.
- Onboarding should use a browser signed into only the firm account, and keep "Extensions → Apps Script → Run `onOpen`" as the fallback.

**Still open:**
- **Workspace:** check the banner and alias behaviour with a Workspace owner.
- **Signed-in phones:** the "unable to open the file" error, and whether embedding the portal outside Google avoids it.
- **HEIC:** confirm an iPhone HEIC photo specifically.
