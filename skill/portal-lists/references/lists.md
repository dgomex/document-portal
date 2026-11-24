# The firm's lists: columns, values, check messages

Schema version 4 (Settings `schema_version`, portal 0.5.0). Columns are only ever appended, never renamed; lawyers may add their own. Always find a column by its header text in row 1.

`<lang>` below is `pt`, `en` or `es`. Only the firm's `default_language` is required; an empty language falls back to it on the portal.

## Visa types: one row per process type

| Column | Who writes | Values |
|---|---|---|
| `visa_type` | skill, or blank | The ID. Blank: the portal generates one from the name (`F-` + the name in capitals, e.g. `F-AR-92-MENOR-RENOVACAO`). A typed ID in capitals, digits and dashes stays as typed (`PT-D7`, kept from earlier versions); other typed text is normalised like a name (`ar 92` → `F-AR-92`). Once cases use an ID, don't change it: those cases would lose their type |
| `name_pt`, `name_en`, `name_es` | skill | What the lawyer and the client see. The firm's language is required |
| `active` | skill | TRUE / FALSE. Only active types are offered for new cases; inactive ones keep working in existing cases |
| `family` | skill | TRUE when the list has spouse or child documents (portal-clients then asks about the family) |
| `facts_to_ask` | skill | `;`-separated conditions asked when a case is opened: the firm's own one-word IDs, no spaces, accents allowed (`cplp`, `meios_a`, `união_estável`…) |
| `notes` | skill (if asked) | The lawyer's notes. Never shown to clients |
| `check` | portal only | `ok`, or what's wrong (below) |

## Document lists: one row per document of a process type

| Column | Who writes | Values |
|---|---|---|
| `visa_type` | skill | The type's ID, or its name in the firm's language (the portal replaces the name with the ID) |
| `order` | skill | A number: the order on the client's list. Blank: after the numbered rows, in sheet order |
| `applies_to` | skill | `main_applicant` (default), `spouse`, `each_child`, `each_adult` (people from `min_age`), `each_person`, `case` (once per case) |
| `level` | skill | `required` (default) or `optional` |
| `title_<lang>` | skill | What the client must send. The firm's language is required |
| `instructions_<lang>` | skill | What exactly to send, shown to the client |
| `group_<lang>` | skill | Text of an either/or item ("send one of these"). Rows with the same text (in the firm's language) in one type form one group; each row is one option |
| `group_key` | portal only | The group's identity. Renaming the group text keeps it, so received documents stay attached |
| `only_if`, `unless` | skill | `;`-separated conditions, each one word with no spaces (accents allowed): the document is asked only if all `only_if` hold and none of `unless`. `married` and `children` follow from the case's people |
| `min_age` | skill | A number: the row is asked only of people that age or older (from their birth date; without one, of anyone but a child). Works with every per-person `applies_to`, e.g. a minor applicant's criminal record from 16 (`main_applicant`, `min_age` 16). `each_adult` defaults to 16. Not for `case` |
| `check_criteria` | skill | The firm's validation criteria for the lawyer's review ("≤ 90 dias antes do agendamento AIMA"). **Never shown to clients**, in no email and no page |
| `active` | skill | TRUE / FALSE. Unticked rows are ignored; never delete rows |
| `doc_key` | portal only | The document's identity. Ties each client's received document to this row across edits |
| `check` | portal only | `ok`, or what's wrong (below) |

A group takes `group_<lang>`, `applies_to`, `level`, `only_if`, `unless` and `min_age` from its first active row (by `order`); keep them the same on every row of the group.

## check messages

The portal writes them in the firm's language. **Errors** skip the row (or the type) until fixed; **warnings** are information and the row is used.

| Key | Kind | Meaning, and what to do |
|---|---|---|
| `lists.check.noName` | error | A Visa types row without a name in the firm's language: add it |
| `lists.check.dupType` | error | Two Visa types rows have the same ID: the second is ignored. Rename or remove one ID (leave it blank to get a new one) |
| `lists.check.noType` | error | The row's `visa_type` matches no ID or name in Visa types: fix the spelling |
| `lists.check.appliesTo` | error | `applies_to` isn't one of the six values |
| `lists.check.level` | error | `level` isn't `required` or `optional` |
| `lists.check.noTitle` | error | No title in the firm's language |
| `lists.check.minAge` | error | `min_age` isn't a number |
| `lists.check.minAgeCase` | warning | `min_age` on a `case` row does nothing (the document is asked once per case, always): move the age rule to a per-person row or clear it |
| `lists.check.condition` | error (Document lists), warning (Visa types) | A condition in `only_if`/`unless` or `facts_to_ask` has a space (`meios a` → `meios_a`), so it can never match a case's facts: fix it in both places |
| `lists.check.noTranslation` | warning | No title in another language: those clients see the firm's language |
| `lists.check.unasked` | warning | A condition used in `only_if`/`unless` isn't in the type's `facts_to_ask`, so nobody is asked about it: add it there |
| `lists.check.groupOfOne` | warning | A group with only one active row: shown as a plain document |
| `lists.check.groupDiffers` | warning | A group row differs from the group's first row in level, people, conditions, age or group text: the first row's value is used. Make them the same |
| `lists.check.groupName` | warning | A row's group text differs from its group's first row, but it has the same `group_key`: still the same group |
| `lists.check.leftGroup` | warning | The group text was cleared: the row left its group and is now a plain document |
| `lists.check.keyCopied` | warning | The row was copied with its key: the portal gave it a new key. Nothing to do |

The sidebar (**Portal → Listas de documentos**, EN: Document lists · ES: Listas de documentos) also reports cases whose `visa_type` is no longer in Visa types ("N processos usam X, que não está em Visa types"): put that ID back on its type.
