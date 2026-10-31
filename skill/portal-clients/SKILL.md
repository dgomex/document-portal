---
name: portal-clients
description: Manage the clients and cases of a law firm's document upload portal (a Google Sheet with Settings, Clients and Cases tabs, made from the "Portal" template). Use it whenever the lawyer wants to add a client, open or close a case, deactivate or reactivate a client, change a client's email, send a portal invitation, list who is registered, or check why a client or case shows ERROR or has no folder yet, even if they just say "add Ana Ferreira, ana@x.pt, divórcio", "fecha o processo da herança", "convida o Bruno para o portal" or "o portal está a recusar a Carla". Portuguese, English and Spanish requests all apply. Do not use it for reading uploaded documents or Drive files.
---

# Portal clients

The lawyer's portal is a Google Sheet that they own. You edit it through their Google Sheets/Drive connector, so their data goes only between them, you and their own Google account. The portal's script reads these rows every 5 minutes. It creates Drive folders, activates clients and sends invites, so your job is to write **correct rows into the right cells**. Everything else happens on its own.

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese, English and Spanish, and Google's screens in English, pt-PT, pt-BR and Spanish. When you tell the lawyer what to click, use the words on **their** screen.

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
   - **Empty:** the portal isn't set up yet. Tell them to run Portal → Configurar (EN: Set up · ES: Configurar) in the sheet first, and stop.
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
| Set or change a case's visa | That Cases row's `visa_type`: an ID from `references/catalog.md`, e.g. `PT-D7` |
| Set the case's facts | That Cases row's `facts`: `;`-separated IDs from `references/catalog.md` (`married` and `children` are automatic) |
| Add a person to a case | A new People row: `case_id`, `name`, `role` (spouse, child or dependant), `birth_date` (YYYY-MM-DD), `notes`, `created_by`=claude-skill |
| Accept or reject a document | That Checklist row's `status` (accepted / rejected) and, when rejecting, `reason` in words the client understands |
| Waive a document for this case | That Checklist row's `level` = waived (and `reason` for the record) |
| Ask for something not on the list | A new Checklist row: `case_id`, `person_name` (empty = the case), `title`, `instructions`, `level` = requested, `due_date` if given |
| Change how the firm works for a visa | A new Adjustments row: `visa_type` (or `*` for all), `applies_to`, `doc_type` (from `references/catalog.md`, or the firm's own name for a new document), `action` (add / change / hide), `level`, `title`, `note` |

The portal's script owns `folder_id`, `provision_error` and `invited_at`, and the Uploads and Events tabs. Never write them, and never read Uploads or Events: they hold the clients' documents and a security log, which you don't need for any of these tasks. Never delete rows. To remove someone, deactivate them, which keeps the history the firm may be legally required to keep.

The People tab's `person_id` and the Checklist tab's `item_id`, `person_id`, `upload_ids`, `doc_type`, `key`, `source`, `updated_at` and `text_json` are the portal's too: it fills them in within 5 minutes (or with Processar novas linhas). The main applicant is added to People automatically when the case gets a visa. Don't add them yourself.

**Always set `active` and `created_by` explicitly on new client rows.** The portal treats a row with an empty `created_by` as typed by hand and ticks `active` itself. Writing both means the lawyer gets exactly what they asked for, including a deliberately inactive client.

## 3. Validate, then confirm

Before showing anything, check:
- **Emails:** trim and lowercase them. They must look like `x@y.zz` with no spaces.
- **Duplicates:** search the new email against **every** client's `email` and `additional_emails`, inactive ones included. If it's taken, don't create a duplicate: say who has it and offer the sensible alternative. An inactive match usually means "reactivate"; an active one, "add the case to that client".
- **Names:** 1–120 characters. `language` is `pt`, `en` or `es`; default to the firm's `default_language` from Settings and mention it.
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

- **New clients and cases:** the folders appear within about 5 minutes, or straight away with **Portal → Processar novas linhas** (EN: Process new rows · ES: Procesar filas nuevas) in the sheet. A case waits for its client's folder.
- **Invites:** they go out once the client's folder exists. `invite_status` changes to SENT.
- **A closed case** disappears from the client's portal at once, and a deactivated client can no longer log in.

If the lawyer asks later ("já está?", "did it work?"), read the rows back: `provision_status`, `provision_error`, `invite_status`. Explain any error in plain words using the table in `references/schema.md`. Fix the cause with the lawyer (for example, correct the email), then set `provision_status` back to PENDING so the portal retries.

## Visas and document checklists

Each case is a visa application. When a case gets a `visa_type`, the portal builds its **checklist**: one row per document per person, from the catalog, changed by the firm's Adjustments, filtered by the case's facts and people. The client sees it on the portal, and sends each document into its own slot.

- **Choosing the visa is the lawyer's decision.** If they ask what fits, you may lay out the candidates from `references/catalog.md` with the reasons, but say clearly that the choice is theirs, and write `visa_type` only once they confirm.
- **The catalog is guidance.** Every list in it comes from official sources on a review date, and the lawyer is responsible for each case's final list. Say so when it matters, for example when a lawyer asks "is this everything?".
- **Family:** add each family member to People with their role and date of birth. Criminal records are asked from 16, so birth dates matter. Adding or removing a person, or changing the facts, rebuilds the list within 5 minutes. Documents already received stay received.
- **"What's missing for Ana?":** read the case's Checklist rows (not Uploads). Group them by `person_name`, and show the ones with `status` missing or rejected and `level` required or requested. Mention optional ones separately.
- **Reviewing:** "aceita o passaporte da Ana" sets `status` accepted. "rejeita o registo criminal do Pedro, tem mais de 90 dias" sets `status` rejected and `reason`. The client sees the reason at once, and gets reminded about it.
- **The firm's way of working:** "no D7 pedimos sempre o CV do cônjuge" becomes an Adjustments row (`visa_type` PT-D7, `applies_to` spouse, `doc_type` CV, `action` add). This affects **new** lists. Existing cases keep theirs until the lawyer asks to refresh one: then clear that case's `checklist_version`. Nothing already received is lost.
- **Reminders:** the portal emails clients about missing documents every `reminder_days` days (Settings).

## Listing

For "who's registered" or "what's open", show name, email, active, and open cases per client. Show IDs too: the lawyer will need them for later requests. Leave out the folder IDs and anything else the script writes.

## Style

Answer in the language the lawyer writes in. Keep to their words: say "processo" and "cliente", not "row" or "tab", unless you're telling them where to look in the sheet.
