---
name: portal-clients
description: Manage the clients, cases and requested documents of a law firm's document upload portal (a Google Sheet with Settings, Clients, Cases and Checklist tabs, made from the "Portal" template). Use it whenever the lawyer wants to add a client, open or close a case, say which documents a case needs (typed, pasted or from a checklist file), add, drop or edit a requested document, accept or reject what a client sent, deactivate or reactivate a client, change a client's email, send a portal invitation, list who is registered or what is missing, or check why a client or case shows ERROR or has no folder yet, even if they just say "adiciona a Ana Ferreira, ana@x.pt, processo de compra de casa, preciso do CC, IRS e da caderneta", "fecha o processo de partilhas do Diogo", "convida o Bruno para o portal" or "o portal está a recusar a Carla". Portuguese, English and Spanish requests all apply. Do not use it for reading uploaded documents or Drive files.
---

# Portal clients

The lawyer's portal is a Google Sheet that they own. You edit it through their Google Sheets/Drive connector, so their data goes only between them, you and their own Google account. The portal's script reads these rows every 5 minutes. It creates Drive folders, activates clients and sends invites, so your job is to write **correct rows into the right cells**. Everything else happens on its own.

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese, English and Spanish, and Google's screens in English, pt-PT, pt-BR and Spanish. When you tell the lawyer what to click, use the words on **their** screen.

A bad row is worse than no row: a wrong email lets the wrong person upload into a client's case. So you validate first, show the lawyer exactly what you will write, and write only after they say yes.

<!-- shared:find-sheet: the same text in every portal skill (test/skill.test.js checks it) -->
## Find the portal sheet

The portal is a Google Sheet in the lawyer's Drive, titled "Portal - <firm>". Find it, in this order:

1. **A link in this conversation.**
2. **The project instructions or Claude's memory.** Onboarding gives the lawyer a line to keep there, starting "O portal do escritório:" (EN: "The firm's portal:"), with the sheet link and the portal address. Use both.
3. **A Drive search** (Drive connector): spreadsheets whose title starts with "Portal - ", leaving out "Portal - Template". Read each one's **Settings** tab: a real portal has `schema_version` and `firm_name`.
   - **One portal:** confirm before using it, e.g. "Encontrei a folha «Portal - Silva & Costa» (Silva & Costa Advogados). É esta?"
   - **Several:** list them with their `firm_name` and ask which.
   - **None:** ask the lawyer for the link. If they never set one up, that's the portal-onboarding skill.

Never use a sheet the lawyer hasn't confirmed, or one that isn't a portal: the wrong sheet means writing into another firm's data.

Without a Drive connector, skip step 3 and ask the lawyer for the link. Never ask them to paste the sheet's contents instead: hand-copied emails are how typos get in.

**Once found through step 3 or by asking**, offer the line to keep, so nobody has to ask again:

> O portal do escritório: folha <sheet link>, endereço <`portal_url` from Settings>.

Tell them where it goes: in the instructions of the Claude project they use for the portal (open the project → its instructions → paste), or say "lembra-te disto" if Claude's memory is on. Then carry on with what they asked.
<!-- /shared:find-sheet -->

This skill reads and writes the sheet through the **Google Sheets connector**. If it isn't available, tell the lawyer to connect Google Drive and Sheets in Claude's settings (Connectors), and stop.

## 1. Preflight: every time, before reading or writing anything else

1. Read the **Settings** tab (key/value). Check `schema_version`:
   - **1 to 5:** supported. Requested documents (the Checklist tab with a `section` column) need **5**. With 1 to 4, manage clients and cases only, and tell the lawyer the portal needs updating first for document lists (portal-update skill).
   - **Empty:** the portal isn't set up yet. Tell them to run Portal → Configurar (EN: Set up · ES: Configurar) in the sheet first, and stop.
   - **Anything higher:** stop. The portal is newer than this skill, so writing could break it. Tell them to get an updated skill.
2. Read the **header row** (row 1) of Clients, Cases and Checklist, and build a map from column name to column letter. **Always address columns by header name.** Lawyers add their own columns and reorder things, so position means nothing. If a column you need is missing, stop and say which one. Never create columns: the portal's setup does that.
3. Read the data rows you need: all of Clients (and Cases when the task involves cases). A row counts only if it has something in `client_id`, `name` or `email` (or `case_id`, `client_id`, `case_name` for Cases). The checkbox column holds FALSE in every row down to 1000, and `provision_status` may hold leftover text, so neither makes a row real.

Column details, allowed values and what each `provision_error` means: `references/schema.md`. Read it the first time you write in a session.

## 2. What you may write

Write only these, never anything else:

| Action | Writes |
|---|---|
| New client | A new Clients row: `client_id`, `name`, `email`, `additional_emails` (if given), `language`, `active`=TRUE, `invite_status` (REQUESTED only if asked), `provision_status`=PENDING, `created_at`, `created_by`=claude-skill, `notes` (if given) |
| New case | A new Cases row: `case_id`, `client_id`, `case_name`, `firm_reference` (if given), `status`=open, `responsible_email` (if given), `provision_status`=PENDING, `created_at`, `created_by`=claude-skill; plus its documents (below) |
| Close or reopen a case | That row's `status` (closed / open) |
| Deactivate or reactivate a client | That row's `active` (FALSE / TRUE) |
| Change emails | That row's `email` and/or `additional_emails` |
| Invite | That row's `invite_status` = REQUESTED |
| Retry a row in error | That row's `provision_status` = PENDING, after the cause is fixed |
| Request documents for a case | A new Checklist row per document: `case_id`, `section` (optional), `title`, `instructions` (optional), `level` (required or optional), `due_date` (if given) |
| Change a requested document | That Checklist row's `title`, `instructions`, `section`, `level` or `due_date` |
| Drop a document for this case | That Checklist row's `level` = waived (and `reason` for the record). Never delete the row |
| Accept or reject a document | That Checklist row's `status` (accepted / rejected) and, when rejecting, `reason` in words the client understands |

The portal's script owns `folder_id`, `provision_error` and `invited_at`, and the Uploads and Events tabs. Never write them, and never read Uploads or Events: they hold the clients' documents and a security log, which you don't need for any of these tasks. Never delete rows. To remove someone, deactivate them, which keeps the history the firm may be legally required to keep.

The Checklist tab's `item_id`, `upload_ids` and `updated_at` are the portal's too: it fills them in within 5 minutes (or with Processar novas linhas). Sheets from before portal 0.6.0 have more Checklist columns (`person_id`, `person_name`, `doc_type`, `key`, `source`, `text_json`) and may have hidden tabs (People, Visa types, Document lists): never write or read them.

**Always set `active` and `created_by` explicitly on new client rows.** The portal treats a row with an empty `created_by` as typed by hand and ticks `active` itself. Writing both means the lawyer gets exactly what they asked for, including a deliberately inactive client.

## New cases: the documents to request (schema 5)

The portal knows nothing about the kind of case: each case's list of documents is the one the lawyer gives for that case, and it never changes another case's list. With `schema_version` 5, when you open a case, ask for its documents unless the lawyer already gave them:

> "Que documentos precisa que o cliente envie para este processo?"

The lawyer may type or paste a list, or give a file (a PDF, Word or spreadsheet checklist they already use). Turn it into one Checklist row per document:

- **`title`:** what the client sees, short ("Cartão de cidadão", "Declaração de IRS 2025"). Keep the lawyer's wording; don't translate it, and strip list bullets and numbering ("- ", "1.", "•").
- **`instructions`:** the lawyer's extra words for the client ("todas as páginas", "emitido há menos de 3 meses"), if any.
- **`section`:** optional free text that groups documents on the client's page, when the lawyer's list has groups: a person ("Ana", "Pedro (cônjuge)"), a party ("Empresa") or a topic ("Habitação"). Leave it empty for a single list.
- **`level`:** `required`, unless the lawyer says a document is optional ("se tiver", "opcional"): then `optional`.
- **`due_date`:** only if the lawyer gives one, as YYYY-MM-DD.

**Never invent a document** and never add one the lawyer didn't list, even if it's usual for that kind of case. If something in their list is a note for the firm rather than a document for the client ("o escritório pede a certidão"), leave it out and say so.

"Ainda não sei" is a fine answer: open the case without documents. Until the list is written, the client's page says the firm hasn't asked for documents yet ("O escritório ainda não pediu documentos para este processo.") and they can't upload anything; offer to add the list later.

If the lawyer has already said to go ahead without asking, write straight away with what they gave, and ask for the documents afterwards if they gave none.

With `schema_version` 1 to 4: open cases without documents and tell the lawyer document lists need the portal updated.

## 3. Validate, then confirm

Before showing anything, check:
- **Emails:** trim and lowercase them. They must look like `x@y.zz` with no spaces.
- **Duplicates:** search the new email against **every** client's `email` and `additional_emails`, inactive ones included. If it's taken, don't create a duplicate: say who has it and offer the sensible alternative. An inactive match usually means "reactivate"; an active one, "add the case to that client".
- **Names:** 1–120 characters. `language` is `pt`, `en` or `es`; default to the firm's `default_language` from Settings and mention it.
- **New cases:** the `client_id` must exist and be active. If the client was added a moment ago in this conversation, use its new ID.
- **Documents:** each row needs a `case_id` that is in Cases (a case written a moment ago counts) and a `title`; `level` is `required`, `optional` or `waived`. A row for a case that isn't in Cases yet is ignored by the portal until it is. If you can run Python, `scripts/portal_rows.py check-items` strips bullets, neutralises formulas and checks these the same way.
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

## Each case's documents

Each case has its own list in the Checklist tab: one row per document, shown to the client on the portal, where they send each document into its own slot. Changing one case's list never touches another case.

- **The list is the lawyer's.** It is exactly what they asked for this case, and they are responsible for it. Say so when it matters, for example when a lawyer asks "is this everything?".
- **Adding or changing later:** "pede também o contrato de trabalho à Ana" is a new row for that case; "afinal o IRS é opcional" changes that row's `level`; "já não preciso da caderneta" sets `level` waived. Documents already received stay received.
- **"What's missing for Ana?":** read the case's Checklist rows (not Uploads). Group them by `section`, and show the ones with `status` missing, rejected or empty and `level` required, requested (older rows) or empty. Leave out `waived`, and mention optional ones separately.
- **Reviewing:** "aceita o passaporte da Ana" sets `status` accepted. "rejeita o registo criminal do Pedro, tem mais de 90 dias" sets `status` rejected and `reason`. The client sees the reason at once, and gets reminded about it.
- **Typing rows by hand:** a lawyer typing documents into the Checklist tab needs the case's `case_id`. For a case they typed by hand too, it appears after **Portal → Processar novas linhas** (EN: Process new rows · ES: Procesar filas nuevas); then use it in `case_id`.
- **Reminders:** the portal emails clients about missing required documents every `reminder_days` days (Settings).

## Listing

For "who's registered" or "what's open", show name, email, active, and open cases per client. Show IDs too: the lawyer will need them for later requests. Leave out the folder IDs and anything else the script writes.

## Style

Answer in the language the lawyer writes in. Keep to their words: say "processo" and "cliente", not "row" or "tab", unless you're telling them where to look in the sheet.
