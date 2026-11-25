# Per-case document lists (0.6.0, schema 5): refactor plan

Status: **implemented on `claude/per-case-document-lists`** (plan approved in review round 2) (2026-11-25). Replaces the model in [VISA-CHECKLISTS.md](VISA-CHECKLISTS.md).

## Why

Since 0.4 the portal has known about immigration: process types (`Visa types`), per-type document lists (`Document lists`) with rules (`applies_to`, roles, `min_age`, `only_if`/`unless` facts, either/or groups, stable keys, list hashes), the people in a case (`People`), and a sync that builds, rebuilds, merges and "refreshes" every case's checklist when any of those change. That is a lot of machinery whose only output is a list of documents per case, and every change to a shared list ripples into older cases.

The new model: **the portal knows cases and the documents requested for each case, nothing else.** The firm (by hand or with its Claude skill) writes the list of documents for a case when it opens it. Each case's list is its own, isolated: no shared list, no rules, no rebuilds, so changing how the firm works never touches an older case. The portal becomes generic: any firm, any kind of process.

Unchanged: clients, OTP login, cases, Drive folders, uploads with content checks, the lawyer's digest emails, invites, reminders, review in the sheet (accept / reject with a reason / waive), the client page's look and flow.

## The model

```
Clients ─< Cases ─< Documents requested (Checklist tab, one row per document)
```

One **Checklist** row = one document requested in one case. The tab keeps its name (tab names and headers are a contract with the skills and with existing sheets; Config says "add columns, never rename").

| Column | Who writes | Meaning |
|---|---|---|
| `item_id` | portal | `IT-` + 6 chars, given on the next sync |
| `case_id` | firm / skill | the case |
| `section` **(new)** | firm / skill | optional free text that groups documents on the page ("Ana", "Spouse", "Company", "Housing"). Empty = the general section. The portal attaches no meaning to it |
| `title` | firm / skill | what the client sees |
| `instructions` | firm / skill | optional, what the client sees under the title |
| `level` | firm / skill | `required` (default when blank), `optional`, `waived` (hidden from the client). Legacy `requested` stays valid, is never rewritten, and is shown and counted as required |
| `status` | portal / firm | `missing` (default), `received` (set by an upload), `accepted`, `rejected` |
| `reason` | firm | why rejected; the client sees it |
| `due_date` | firm | optional YYYY-MM-DD |
| `upload_ids` | portal | uploads into this item |
| `updated_at` | portal | |

Display order: sheet row order within a section; named sections in the order of their first row; the general (empty) section **last**, as the case group is today, so old cases keep their layout.

Columns that stay in existing sheets but are **no longer read for new rows**: `person_id`, `person_name`, `doc_type`, `key`, `source`, `text_json`. New sheets (fresh `Schema.ensure`) don't get them. For rows written before 0.6.0 the view falls back: `section || person_name`; `text_json` present → its texts in the client's language (as today), so an old case looks as it did. **New code never writes** `person_id`, `person_name`, `key`, `source`, `doc_type` or `text_json` (`Table.append` throws on a column a new sheet doesn't have).

### The sync (replaces `CaseChecklist.sync`)

Every 5 minutes / Process new rows: a Checklist row with `case_id` + `title` and no `item_id`, whose `case_id` matches a row in Cases (any status, provisioned or not), gets an `item_id`, `status` missing (if blank), `level` required (if blank), `updated_at`. A row whose `case_id` matches no case is left untouched (no ID), so a typo stays visible. That is the whole sync.

### Client page

- `me_()` returns per case `checklist: [{ name, items: [...] }]` (`name` = the section text: the same key the page already reads, so a page left open across the upgrade still renders). The `visa` field goes away; the `#visaName` line and the immigration comment are removed.
- Section heading: the section text, or `checklist.section.general` ("Documents") for the empty section. The `checklist.role.*` keys and their dynamic lookup go in the same commit. The sub-line shows only the section's progress.
- The "Requested by the firm" tag and `checklist.requested` go away (every document is requested by the firm now).
- Everything else as today: per-item Send / Send again, statuses, reason, instructions, due date, progress bar. (0.6.1 removed the "Other documents" free upload and the "I'm done: notify the firm" button: every file is for a requested document, and the firm's email goes out once the client stops sending.) `checklist.oneOf` stays for legacy grouped rows (`text_json.options`).

### Drive

- An upload into an item goes to the **case folder**, named `<date> <title> - <original name>` as today. New uploads no longer go into per-person subfolders (there are no people). Existing person folders and their files are untouched. `personFolder_` is removed.
- In-flight uploads started on 0.5.2 (cache entry carrying the person folder `f` and `pp`, up to 6 h) still finish: the parents check uses the stored `f`, `Uploads.person_id` stays in SCHEMA, and `finish()` keeps writing `p.pp || ''`.
- The daily abandoned-upload sweep keeps scanning legacy `People.folder_id`s when that tab exists (a guarded read inlined in Upload), otherwise only case folders.
- Digest: each file is labelled `title` (+ ` (section)` when set).

### Reminders

Every open, provisioned case **with at least one non-waived item** (instead of "with a visa_type"). The filter matters: a case's reminder clock starts the first time `due_` sees it, so a case without items must not be seen, or the client would be reminded right after the list is written (tested). Same email and items (required/requested, missing or rejected); the person becomes the section. Behaviour change to announce: an existing case with no visa but with ad-hoc rows now gets reminders.

### Removed

- `lists/FirmLists.js`, `admin/LegacyLists.js`, `checklist/Checklist.js` (build/merge/facts/age), `CaseChecklist.refresh/status/caseHash/people`, the "Document lists" block and its CSS in `html/update.html`, the `menu.lists` menu item, the `listsStatus`/`listsRefresh` admin actions (an old open sidebar just gets `unknownAction`).
- Portal.js: `FirmLists` in `me_`, the `CaseChecklist.status` boot in `menuUpdate`, the `built/rebuilt/stale` condition in `menuProvision`'s alert.
- Schema.js: the visa branch of `applyValidations_`, `visaDropdown`.
- Config: `TABS.PEOPLE/VISA_TYPES/DOC_LISTS/ADJUSTMENTS`, `ROLES`, `APPLIES_TO`, `ID_PREFIX.PERSON`; `SCHEMA` loses `People`, `Visa types`, `Document lists`, and `Cases.visa_type/facts/checklist_version` and the legacy Checklist columns (for new sheets only: existing columns are never deleted). `Uploads.person_id` stays.
- i18n (pt/en/es): `lists.*`, `checklist.role.*`, `checklist.requested`, `checklist.noLongerApplies`; new `checklist.section.general`, `update.retiredTab`; `provision.checklists` reworded to "{requests} new document request(s)".
- Seed: demo cases get a few Checklist rows directly (with sections).
- Skill `portal-lists` (and its evals, its entry in `npm run skills` and `scripts/skill-labels.js`).
- Tests: `firmlists.test.js`, `checklist.test.js`, fixtures `lists.js` and `catalog-0.4.json`. Rewritten: `casechecklist.test.js` (sync, view, ordering, legacy fallback); `skill.test.js` (schema-columns test on Clients/Cases/Checklist only, no Visa types / portal-lists tests, `SCHEMA_VERSION` 5, "never writes script-owned columns" extended to Checklist); `upload.test.js` and `reminders.test.js` fixtures without `SCHEMA.People`. New: sync/upload/finish on a fresh-schema Checklist and Uploads (no legacy columns); migration 5 tests.

### Migration: schema 5

`Migrations.STEPS[5]`, safe to repeat:
1. Checklist: rows with an empty `section` and a non-empty `person_name` get `section = person_name` (rows that already have a `section` are skipped).
2. Retired tabs, named inline (their constants are gone): `Visa types`, `Document lists`, `People`, `Adjustments`, `CatalogData`. A tab with no data rows (`Table.wrap(sheet).rows().length === 0`, not `getLastRow()`, because checkbox columns hold FALSE down the sheet; e.g. a new firm's copy of the template) is **deleted**; a tab with data is **hidden** with a note in A1 (`update.retiredTab`: "no longer used since 0.6.0, kept for reference"). `CatalogData` has no header row (0.4.x stored its catalog as JSON from A1), so it counts as empty only when the tab has no rows at all. Nothing with data is lost.
3. Delete the `LISTS_DROPDOWN` script property.
4. Clear the data validation (the visa dropdown) on `Cases.visa_type`, if the column exists. The Checklist `level` validation is re-applied by `Schema.ensure` as `required, optional, waived, requested`.

`STEPS[3]` and `STEPS[4]` become no-ops (`STEPS[5]` does the hiding step 4 used to do). A 0.4.x sheet upgrading straight to 0.6.0 keeps every existing Checklist row; cases that had a visa set but were never built have no list until the firm writes one. Existing `checklist_version`/`visa_type`/`facts` values are left in place and ignored.

### Skills

- **portal-clients** (rewritten sections): new case → ask "Which documents do you need from the client for this case?" (a list typed, pasted, or a file such as a PDF/Word/Sheet checklist the lawyer gives), turn it into Checklist rows (`case_id`, `section`, `title`, `instructions`, `level`, `due_date`), confirm the table, write. Adding / removing (waive) / editing a document of one case. Review (accept/reject/waive) as today. "What's missing" reads Checklist by section. No visas, people, facts. Preflight wording kept parseable: `**1 to 5:** supported`; documents need 5 (on 1–4, tell the lawyer to update the portal).
- `scripts/portal_rows.py`: new `check-items` command (+ `test_portal_rows.py`): strips list bullets, neutralises formulas with `cell()` ("- Passport", "+ NIF"), checks `case_id` exists, `title` non-empty, `level` valid.
- `references/schema.md`: People/Visa types gone, Checklist table above, Cases loses visa columns.
- Evals: drop `asks-which-work-permit` and `new-client-with-visa-and-family`; add `new-case-with-document-list` (lawyer pastes a bulleted list with two sections → exact rows, no bullets/formulas, no script-owned columns, confirmation table).
- **portal-onboarding**: line 63 tab list (no People), step 6 becomes "write the test case's documents" (two rows), no lists import; wrap-up text updated.
- **portal-update**: drop the lists paragraphs; mention 0.6.0 retires the old tabs.
- `scripts/skill-labels.js`: drop `menu.lists`, `lists.check`, `lists.update`; regenerate labels.

### Docs and release

- This file becomes the design doc; `VISA-CHECKLISTS.md` gets a header "superseded by PER-CASE-DOCUMENTS.md".
- README (skills list), `docs/onboarding-checklist.md` step 8, `docs/release-process.md` (firmlists/lists mention), CHANGELOG 0.6.0, `docs/announcements/0.6.0.md`: old tabs retired, existing cases unchanged, new cases get their list from the firm/skill, reminders now also for cases with ad-hoc rows, and **install the new skills** (the old portal-clients/portal-lists stop at schema 5 by design; portal-lists is retired).
- `Config.LIBRARY_VERSION` 0.6.0, `SCHEMA_VERSION` 5. The release itself (`npm run release`) is not part of this change.
- Generic wording: drop "immigration"/"visa" from code comments, page, and skills.

## Work order

1. Config/Schema/Migrations (schema 5) + tests.
2. CaseChecklist rewritten (sync, view, items) + tests; delete Checklist.js, FirmLists.js, LegacyLists.js and their tests/fixtures.
3. Portal.js (`me_`, menu, admin actions), update.html, index.html, i18n (pt/en/es).
4. Upload (case folder, labels, sweep), Reminders, Seed + tests.
5. Skills, portal_rows.py, evals, skill-labels, package.json script, skill.test.js.
6. Docs, CHANGELOG, announcement.
7. `npm test` green; independent code review loop.

## Decisions from plan review (round 1)

1. Rows with an unknown `case_id`: no ID until the case exists; any case status counts.
2. `requested`: stays valid, never rewritten, treated as required; its tag is dropped.
3. `section` is filled from `person_name` once in step 5; the read fallback stays.
4. Retired tabs with no data rows are deleted, tabs with data hidden (covers new firms copying an old template); the announcement says empty retired tabs are removed.
5. A page left open across the upgrade may show a raw `checklist.role.undefined` sub-label until reloaded: accepted (cosmetic).
6. portal-clients tells a lawyer typing rows by hand to run Process new rows first, then use the case's ID.
