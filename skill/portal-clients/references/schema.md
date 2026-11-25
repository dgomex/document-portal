# Portal sheet: columns, values, errors

Schema versions 1 to 5 (Settings `schema_version`). Version 2 added `Clients.invited_at` and the Settings key `daily_email_limit`. Version 5 (portal 0.6.0) made each case's document list its own: the **Checklist** tab, one row per document the firm requests in a case, with a free-text `section`. The portal has no process types, people or shared lists. Sheets from before 0.6.0 may keep hidden tabs (People, Visa types, Document lists, Adjustments, CatalogData), Cases columns `visa_type`, `facts`, `checklist_version` and extra Checklist columns (`person_id`, `person_name`, `doc_type`, `key`, `source`, `text_json`): all no longer used. Never read or write them. Columns are only ever appended, never renamed. Always find a column by its header text in row 1.

## Settings (key | value | description)

Read-only for this skill. Useful keys:
- `firm_name`
- `default_language` (`pt`, `en` or `es`): use it for new clients when the lawyer doesn't say.
- `portal_url`: the address to give clients.
- `schema_version`

## Clients

| Column | Who writes | Values |
|---|---|---|
| `client_id` | skill (new rows) | `CL-` + 6 Crockford base32 characters, unique, never changed |
| `name` | skill | 1–120 characters |
| `email` | skill | main login address, lowercase |
| `additional_emails` | skill | more login addresses, separated by `;` |
| `language` | skill | `pt`, `en` or `es` (the client's emails and portal) |
| `active` | skill | TRUE / FALSE (checkbox). FALSE = cannot log in |
| `invite_status` | skill (REQUESTED only), portal | empty, `REQUESTED`, `SENT`, `ERROR` |
| `provision_status` | skill (PENDING only), portal | `PENDING`, `ACTIVE`, `ERROR` |
| `provision_error` | portal only | reason for ERROR |
| `folder_id` | portal only | Drive folder |
| `created_at` | skill (new rows) | date and time |
| `created_by` | skill (new rows) | `claude-skill` |
| `notes` | skill (if asked) | free text for the lawyer |
| `invited_at` | portal only | when the invite went out (schema 2) |

## Cases

| Column | Who writes | Values |
|---|---|---|
| `case_id` | skill (new rows) | `CS-` + 6 Crockford base32 characters |
| `client_id` | skill | an existing, active client's ID |
| `case_name` | skill | 1–120 characters, what the client sees ("Compra de casa – Rua Augusta") |
| `firm_reference` | skill (if given) | the firm's own file number, shown next to the name |
| `status` | skill | `open` / `closed`. Only open cases appear in the portal |
| `responsible_email` | skill (if given) | the lawyer who gets this case's upload emails; empty = the firm address |
| `provision_status` | skill (PENDING only), portal | `PENDING`, `ACTIVE`, `ERROR` |
| `provision_error`, `folder_id` | portal only | |
| `created_at`, `created_by` | skill (new rows) | as for Clients |

## Checklist (schema 5): the documents requested in each case

| Column | Who writes | Values |
|---|---|---|
| `item_id` | portal only | `IT-` + 6 characters, given within 5 minutes once `case_id` is a case in Cases |
| `case_id` | skill | the case the document is for |
| `section` | skill | optional free text grouping documents on the client's page ("Ana", "Empresa", "Habitação"); empty = the general list, shown last |
| `title` | skill | what the client sees, short |
| `instructions` | skill | optional, shown under the title |
| `level` | skill | `required` (empty = required), `optional`, `waived` (not needed any more; hidden from the client). Older rows may say `requested`: treat it as required |
| `status` | skill, portal | `missing` (empty = missing), `received` (the portal sets this on upload), `accepted`, `rejected` |
| `reason` | skill | why a document was rejected; the client sees it |
| `due_date` | skill | YYYY-MM-DD, optional |
| `upload_ids`, `updated_at` | portal only | |

## Tabs the skill never opens

- `Uploads`: the log of documents clients sent.
- `Events`: the security log.

## provision_error, in plain words

| Text | Meaning | Fix |
|---|---|---|
| `invalid email` | the email isn't a valid address | correct `email`, then set `provision_status` to PENDING |
| `invalid additional_emails: …` | one of the extra addresses is wrong | correct it, then PENDING |
| `email x already used by CL-…` | another client has that address | decide which client it belongs to; remove it from the other one |
| `invalid name` / `invalid case_name` | empty, or longer than 120 characters | shorten or fill in, then PENDING |
| `invalid language` | not pt, en or es | fix, then PENDING |
| `duplicate client_id` / `duplicate case_id` | two rows share an ID | almost always a copied row: ask the lawyer which row is real |
| `unknown client_id` | the case points to a client that doesn't exist | correct the case's `client_id`, then PENDING |
| `client CL-… has an error` | the case waits on a client in ERROR | fix the client first; then set both back to PENDING |
| `invalid status` | case status isn't open or closed | fix, then PENDING |
| `folder: …` | Google Drive refused to create the folder | usually temporary: set PENDING again; if it repeats, the lawyer should run Portal → Configurar (EN: Set up · ES: Configurar) |

A `provision_status` of PENDING for more than about 10 minutes means the portal's 5-minute trigger isn't running. Suggest **Portal → Processar novas linhas** (EN: Process new rows · ES: Procesar filas nuevas), and if that fails, **Portal → Configurar → Guardar** (EN: Set up → Save · ES: Configurar → Guardar), which reinstalls the triggers.
