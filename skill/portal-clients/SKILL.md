---
name: portal-clients
description: Manage the clients and cases of a law firm's document upload portal (a Google Sheet with Settings, Clients and Cases tabs, made from the "Portal" template). Use it whenever the lawyer wants to add a client, open or close a case, deactivate or reactivate a client, change a client's email, send a portal invitation, list who is registered, or check why a client or case shows ERROR or has no folder yet, even if they just say "add Ana Ferreira, ana@x.pt, divórcio", "fecha o processo da herança", "convida o Bruno para o portal" or "o portal está a recusar a Carla". Portuguese and English requests both apply. Do not use it for reading uploaded documents or Drive files.
---

# Portal clients

The lawyer's portal is a Google Sheet that they own. You edit it through their Google Sheets/Drive connector, so their data goes only between them, you and their own Google account. The portal's script reads these rows every 5 minutes. It creates Drive folders, activates clients and sends invites, so your job is to write **correct rows into the right cells**. Everything else happens on its own.

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese and English and Google's screens in English, pt-PT and pt-BR. When you tell the lawyer what to click, use the words on **their** screen.

A bad row is worse than no row: a wrong email lets the wrong person upload into a client's case. So you validate first, show the lawyer exactly what you will write, and write only after they say yes.

## 0. Find the sheet

The sheet is usually named "Portal - <firm>". Get its URL or ID from, in order:
1. the conversation;
2. the project instructions or memory;
3. asking the lawyer.

Once found, suggest they save it in their project instructions so you don't have to ask again.

If no Google Sheets tool is available, tell the lawyer to connect Google Drive/Sheets in Claude's settings (Connectors), and stop. Don't ask them to paste data instead: hand-copied emails are how typos get in.

## 1. Preflight: every time, before reading or writing anything else

1. Read the **Settings** tab (key/value). Check `schema_version`:
   - **1 to 3:** supported. (3 adds visa types, people and document checklists.)
   - **Empty:** the portal isn't set up yet. Tell them to run Portal → Configurar (EN: Set up) in the sheet first, and stop.
   - **Anything higher:** stop. The portal is newer than this skill, so writing could break it. Tell them to get an updated skill.
2. Read the **header row** (row 1) of Clients and Cases, and build a map from column name to column letter. **Always address columns by header name.** Lawyers add their own columns and reorder things, so position means nothing. If a column you need is missing, stop and say which one. Never create columns: the portal's setup does that.
3. Read the data rows you need: all of Clients (and Cases when the task involves cases). A row counts only if it has something in `client_id`, `name` or `email` (or `case_id`, `client_id`, `case_name` for Cases). The checkbox column holds FALSE in every row down to 1000, and `provision_status` may hold leftover text, so neither makes a row real.

Column details, allowed values and what each `provision_error` means: `references/schema.md`. Read it the first time you write in a session.

## 2. What you may write

Write only these, never anything else:

| Action | Writes |
|---|---|
| New client | A new Clients row: `client_id`, `name`, `email`, `additional_emails` (if given), `language`, `active`=TRUE, `invite_status` (REQUESTED only if asked), `provision_status`=PENDING, `created_at`, `created_by`=claude-skill, `notes` (if given) |
| New case | A new Cases row: `case_id`, `client_id`, `case_name`, `firm_reference` (if given), `status`=open, `responsible_email` (if given), `provision_status`=PENDING, `created_at`, `created_by`=claude-skill |
| Close or reopen a case | That row's `status` (closed / open) |
| Deactivate or reactivate a client | That row's `active` (FALSE / TRUE) |
| Change emails | That row's `email` and/or `additional_emails` |
| Invite | That row's `invite_status` = REQUESTED |
| Retry a row in error | That row's `provision_status` = PENDING, after the cause is fixed |

The portal's script owns `folder_id`, `provision_error` and `invited_at`, and the Uploads and Events tabs. Never write them, and never read Uploads or Events: they hold the clients' documents and a security log, which you don't need for any of these tasks. Never delete rows. To remove someone, deactivate them, which keeps the history the firm may be legally required to keep.

**Always set `active` and `created_by` explicitly on new client rows.** The portal treats a row with an empty `created_by` as typed by hand and ticks `active` itself. Writing both means the lawyer gets exactly what they asked for, including a deliberately inactive client.

## 3. Validate, then confirm

Before showing anything, check:
- **Emails:** trim and lowercase them. They must look like `x@y.zz` with no spaces.
- **Duplicates:** search the new email against **every** client's `email` and `additional_emails`, inactive ones included. If it's taken, don't create a duplicate: say who has it and offer the sensible alternative. An inactive match usually means "reactivate"; an active one, "add the case to that client".
- **Names:** 1–120 characters. `language` is `pt` or `en`; default to the firm's `default_language` from Settings and mention it.
- **New cases:** the `client_id` must exist and be active. If the client was added a moment ago in this conversation, use its new ID.
- **Formula injection:** any value starting with `=`, `+`, `-` or `@` gets a leading `'`. Sheets would otherwise run it as a formula.
- **New IDs:** `CL-` or `CS-` plus 6 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U). Make sure the ID isn't already used in that tab. If you can run Python, `scripts/portal_rows.py` does IDs and checks the same way the portal does.

Then show the lawyer a short table of exactly what will be written: tab, row, column and value, and for updates the old and new values. Ask for a yes. A plain instruction ("adiciona a Ana e fecha o processo X") still gets the table and the question, because the table is how they catch a typo in an email.

If the lawyer has already said to go ahead without asking ("podes escrever", "confirmo", "don't ask, just do it"), write straight away. Show the same table afterwards as "what I wrote", so they can still spot a mistake. Pre-approval never covers a problem found in validation: a duplicate email, an unknown client or an invalid value always stops that item and goes back to the lawyer, while the valid items go ahead.

## 4. Write

- **New rows:** don't use "append". The checkbox column makes the sheet look full down to row 1000, so an append lands below it, out of sight. Find the last real row yourself (step 1.3) and write the new row(s) into the rows straight after it, at an explicit range (for example `Clients!A7:N7`), placing each value under its header.
- **Values:**
  - `active` as the boolean TRUE or FALSE, not text;
  - `created_at` as a date and time, e.g. `2026-10-31 14:05`;
  - everything else as plain text.
  - Write with "user entered" input so booleans and dates are recognised, which is also why the `'` prefix matters.
- **Updates:** write only the one cell that changes, located by column header and by finding the row whose `client_id` or `case_id` matches. Never by row number from memory.
- After writing, **read the rows back** and check they say what you meant.

## 5. Tell the lawyer what happens next

- **New clients and cases:** the folders appear within about 5 minutes, or straight away with **Portal → Processar novas linhas** (EN: Process new rows) in the sheet. A case waits for its client's folder.
- **Invites:** they go out once the client's folder exists. `invite_status` changes to SENT.
- **A closed case** disappears from the client's portal at once, and a deactivated client can no longer log in.

If the lawyer asks later ("já está?", "did it work?"), read the rows back: `provision_status`, `provision_error`, `invite_status`. Explain any error in plain words using the table in `references/schema.md`. Fix the cause with the lawyer (for example, correct the email), then set `provision_status` back to PENDING so the portal retries.

## Listing

For "who's registered" or "what's open", show name, email, active, and open cases per client. Show IDs too: the lawyer will need them for later requests. Leave out the folder IDs and anything else the script writes.

## Style

Answer in the language the lawyer writes in. Keep to their words: say "processo" and "cliente", not "row" or "tab", unless you're telling them where to look in the sheet.
