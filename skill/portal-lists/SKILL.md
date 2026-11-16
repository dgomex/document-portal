---
name: portal-lists
description: Keep a law firm's own process types and document checklists in its document portal (the "Visa types" and "Document lists" tabs of the firm's "Portal - <firm>" Google Sheet). Use it whenever the lawyer wants to import the firm's existing checklists (PDF, Word, Google Doc or Sheet, Markdown or a photo), add or change a process type (visa, residence permit, renewal, adult or minor), add, change, remove or translate a document on a list, set validation criteria for the review, deactivate a process type, or bring open cases up to date after a list changed, even if they just say "importa as nossas checklists", "no D7 pedimos também o CV do cônjuge", "cria a renovação do art. 92 para menores" or "traduz a lista do D7 para inglês". Portuguese, English and Spanish requests all apply. Do not use it for clients, cases or reviewing a client's uploaded documents (that is portal-clients).
---

# Portal lists

Since portal 0.5.0 each firm keeps **its own** process types and document lists in two tabs of its portal sheet. The portal has no lists of its own: a new firm starts with empty tabs and imports or types its lists; a firm that used an earlier version had the lists it was using copied in. The lawyer owns the lists, and the portal builds every new case's checklist from them.

You run in **the firm's own Claude account, with the firm's own Google Sheets connector**. The data goes only between the lawyer, you and their Google account. Nobody else ever opens or writes the firm's sheet.

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese, English and Spanish, and Google's screens in English, pt-PT, pt-BR and Spanish. When you tell the lawyer what to click, use the words on **their** screen.

A wrong list is worse than a short one: clients send what the list says. So you **never invent a document**, show the lawyer exactly what you will write, and write only after they say yes.

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

## 1. Preflight: every time

1. Read the **Settings** tab. `schema_version` must be **4**. Lower: the portal is older than 0.5.0 and has no lists of its own; tell the lawyer to update the portal first (portal-update skill), and stop. Higher: the portal is newer than this skill; tell them to get an updated skill, and stop. Note `default_language` (`pt`, `en` or `es`): it is the firm's language and the only one each list needs.
2. Read the header rows of **Visa types** and **Document lists** and map column names to letters. **Always address columns by header name**; lawyers add and reorder columns. If a column you need is missing, stop and say which one.
3. Read all rows of both tabs. A Visa types row counts if it has a `visa_type` or a name; a Document lists row if it has a `visa_type` and a title.

Columns, allowed values and every `check` message: `references/lists.md`. Read it the first time you write in a session.

## 2. What you may write

| Tab | You write | Never write |
|---|---|---|
| Visa types | `visa_type` (or leave it blank: the portal makes the ID from the name), `name_pt`, `name_en`, `name_es`, `active`, `family`, `facts_to_ask`, `notes` | `check` |
| Document lists | `visa_type` (the ID, or the type's name: the portal replaces a name with the ID), `order`, `applies_to`, `level`, `title_*`, `instructions_*`, `group_*`, `only_if`, `unless`, `min_age`, `check_criteria`, `active` | `doc_key`, `group_key`, `check` |

The portal owns `doc_key`, `group_key` and `check`: it fills them within 5 minutes (or with **Portal → Processar novas linhas**, EN: Process new rows · ES: Procesar filas nuevas). The keys tie each client's received documents to a row, so **when you change a row, change it in place; never delete it and add a new one**, or the client's received document loses its slot. To remove a document, untick `active`. Never delete rows.

Never write the Clients, Cases, People, Checklist, Uploads or Events tabs here (that is portal-clients, or the portal itself). The hidden Adjustments and CatalogData tabs of sheets from before 0.5.0 are no longer used: never read or write them.

## 3. Import the firm's own list

The lawyer gives you a file or a link: the firm's checklist for one process type (PDF, Word, Google Doc or Sheet, Markdown, a photo of a printed list).

1. **Which process type.** Match it to an existing Visa types row (by name or ID) or propose a new one. Show the match and let the lawyer confirm. Firms often split what the catalog calls one type: initial vs **renewal**, **adult vs minor**. Each is its own process type with its own list.
2. **Turn each document into a row**, in the firm's own order and wording (keep their numbering in the title if clients know it, e.g. "9.2 Contrato de arrendamento"):
   - `title_<lang>`: what the client must send, short. `instructions_<lang>`: what exactly, in words for the client.
   - `applies_to`: `main_applicant` (default), `spouse`, `each_child`, `each_adult` (from `min_age`, 16 by default), `each_person`, or `case` (one per case, e.g. the lease).
   - `level`: `required` or `optional` ("se aplicável", "facultativo").
   - **"One of these"** (send A or B or C): one row per option, the same group text in `group_<lang>` on each (e.g. "Alojamento (um dos seguintes)").
   - **Alternative sets** (modality A: employment, B: self-employed, C: sponsor, each with several documents): a **condition** per set, the firm's own `snake_case` ID (e.g. `meios_a`, `meios_b`, `meios_c`), in `only_if` of every document of that set, and listed in the type's `facts_to_ask` so whoever opens a case asks it.
   - **Age rules** ("registo criminal, se maior de 16 anos"): `each_adult` with `min_age` 16, or `min_age` on the row.
   - **Validation criteria** for the lawyer's review ("emitido há menos de 90 dias", "sem apostila para o Brasil, mas com o número do passaporte") go in `check_criteria`. Clients never see that column; never put them in `instructions`.
3. **Leave out what the client doesn't upload:** documents the office prepares or fills (power of attorney drafted by the firm, the firm's own declarations, forms the firm completes). List them separately for the lawyer, so they can tell you if one should be on the client's list after all.
4. **Never invent a document** that isn't in the source, and never "complete" the list from another firm's list or from what you know. If an item is unclear (a missing word, "outros documentos", an illegible line), don't guess: ask about it as a question after the table.
5. **Personal data:** if the source is a real client's checklist (names, numbers, filled-in fields), use only the list's structure and say so. Never copy a client's personal data into the sheet.
6. **Show a table** against the current list of that type: each row marked **new**, **changed** (old → new) or **unticked** (on the current list, not in the source). For an existing type, the source replaces the list's content: rows that match keep their place and key (change them in place); rows not in the source get `active` unticked, never deleted. Ask for a yes.

   If the lawyer has already said to go ahead without asking ("podes escrever", "don't ask, just do it"), write straight away and show the same table afterwards as "what I wrote". Pre-approval never covers what you're unsure about: unclear items and the office's own documents still go back to the lawyer as questions, and are not written.
7. **Write** after the yes: new rows straight after the last real row, at an explicit range (not "append": checkbox columns make the sheet look full); changed cells in place, by header. `active` as the boolean TRUE. Any value starting with `=`, `+`, `-` or `@` gets a leading `'`.
8. **Verify:** ask the lawyer to open **Portal → Listas de documentos** (EN: Document lists · ES: Listas de documentos) and click **Verificar** (EN: Check · ES: Verificar), or wait 5 minutes, then read the `check` column of the rows you wrote and report: "ok", or what to fix. A row with an error is skipped by the portal until it's fixed.

## 4. Other requests

- **Edit** ("no D7 pedimos também o CV do cônjuge"): a new row, or the changed cells of an existing one, after the confirmation table.
- **New process type:** a Visa types row with the name in the firm's language (leave `visa_type` blank), `active` TRUE, `family` TRUE if the list has spouse or child documents, `facts_to_ask` with every condition its rows use; then its Document lists rows (`visa_type` = the type's name is fine).
- **Deactivate a type:** untick its `active`. It stops being offered for new cases; existing cases keep working.
- **Translate:** fill the empty `title_*`, `instructions_*` and `group_*` of the other languages. Empty languages fall back to the firm's, so this is optional. Say clearly that the translations are drafts **for the lawyer to check** before clients see them.
- **What's on a list:** read the type's active rows, in `order`, grouped as the client sees them.

## 5. Existing cases when a list changes

A case's checklist is a snapshot: editing a list never changes open cases by itself. After a change, the lawyer brings them up to date in **Portal → Listas de documentos** (EN: Document lists · ES: Listas de documentos), which shows, per process type, how many open cases use an older version, with a button **Atualizar estes processos** (EN: Update these cases · ES: Actualizar estos expedientes).

Before they click, tell them what will happen, from the change you made: new documents appear as missing; unticked ones disappear ("no longer applies"); renamed ones keep what was already received; nothing received is lost. Count the open cases of that type (Cases tab, `status` open) so they know how many clients will see the change. Editing `check_criteria` or `notes` never marks cases as older.

## 6. The lawyer owns the lists

Requirements change and consulates differ: the lawyer is responsible for what each list asks for, and nobody else changes it. When a lawyer asks "is this everything?", say what the list is based on (their own source) and that the final word is theirs.

## Style

Answer in the language the lawyer writes in. Say "processo", "tipo de processo", "documento" and "lista", not "row" or "tab", unless you are telling them where to look in the sheet.
