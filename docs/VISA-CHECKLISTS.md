# Visa checklists: design

The portal is for **immigration lawyers**. Each case is a visa application, and each visa needs a specific set of documents, per person. This document records the decisions (2026-10-31) and the model built on the `feature/visa-checklists` branch.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Catalog ownership | **We own one central catalog per country:** visas, document types, requirements, with sources and a last-reviewed date. It holds no personal data. |
| 2 | People in a case | **Per-applicant from day one.** A case has people (main applicant, spouse/partner, children, other dependants). A document belongs to a person or to the case. |
| 3 | Conditions | **A few yes/no facts per case.** Some are derived from the people (`married`, `children`); the rest the lawyer ticks (`self_employed`, `resident`, …). |
| 4 | Responsibility | The catalog is **guidance**. The lawyer owns the final list, and the product says so in the sheet, in the skills and on the portal. |
| 5 | Languages | PT, EN, then **ES**: portal, emails, catalog texts, skill labels. |
| 6 | Catalog updates | Bundled in each release. A daily check may **announce** a newer catalog, but nothing changes until the lawyer clicks **Apply**, and the check can be switched off (`catalog_check`). |

## Since 0.5.0 (schema 4): the firm owns its lists, and there is no central catalog

Decided 2026-11-16: each firm keeps **its own** checklists per process type (initial vs renewal, adult vs minor, its own wording, numbering and validation criteria). The same day the central catalog was removed: **the portal ships no lists**. Decisions 1 and 6 below no longer hold; decision 4 is now simply "the lawyer owns the list, in the sheet". Issue #1.

```
the firm's lists (Visa types + Document lists tabs)  →  case checklist (a snapshot per case)
```

- **New firms start with empty tabs** and import their own checklists with the `portal-lists` skill (in the firm's own Claude, with the firm's own connector) or type them. A case only gets a checklist when its process type has a list.
- **Firms that ran 0.4.x:** the schema 4 migration copies the lists they were using (their own `CatalogData` tab, changed by their `Adjustments`) into the two tabs, once, so no existing case changes. Both old tabs are then hidden and never read again (`admin/LegacyLists.js` is migration-only).
- **Tabs:** `Visa types` (`visa_type`, `name_*`, `active`, `family`, `facts_to_ask`, `notes`, `check`) and `Document lists` (`visa_type`, `order`, `applies_to`, `level`, `title_*`, `instructions_*`, `group_*`, `group_key`, `only_if`, `unless`, `min_age`, `check_criteria`, `active`, `doc_key`, `check`). `check_criteria` is for the lawyer's review and never reaches clients.
- **Stable keys:** `doc_key` and `group_key` (script-owned) tie a case's items to a row across renames. An item identity is unique per visa type and overlapping `applies_to`; copied keys are re-keyed with a warning.
- **IDs:** a blank `visa_type` is generated from the name (`F-` prefix); a typed ID in capitals, digits and dashes stays as typed; Document lists may name a type instead of giving its ID.
- **Conditions** (`only_if`, `unless`, `facts_to_ask`) are the firm's own `snake_case` IDs; `married` and `children` still follow from the case's people.
- **Validation** on every sync and from the sidebar (Verificar): errors skip a row, warnings don't; the `check` column says why.
- **`checklist_version` = list hash | case hash**, the list hash covering that type's client-facing columns only. Editing a list marks only that type's open cases as older; the sidebar's **Atualizar estes processos** refreshes them with the same merge (nothing received is lost).
- **Code:** `lists/FirmLists.js` (pure `process()` + I/O), `CaseChecklist.refresh/status`, migration step 4 with `admin/LegacyLists.js`.

## History: 0.4.x, built on a central catalog (removed in 0.5.0)

The rest of this document describes the 0.4.x design, kept for the record.

## Three layers

```
catalog (ours)  →  firm adjustments (the firm's sheet)  →  case checklist (a snapshot per case)
```

1. **Catalog:** `catalog/` YAML in this repo, built into `library/src/catalog/CatalogData.js` (bundled) and `dist/catalog.json` (for the notice). IDs (`PT-D7`, `PASSPORT`) never change, and nothing is deleted: entries are marked `active: false` instead.
2. **Firm adjustments** (sheet tab `Adjustments`): **differences**, not a copy: add, change level, hide, or retitle, per visa and per role. A catalog update flows through, and the firm's tweaks stay on top.
3. **Case checklist** (sheet tab `Checklist`): built when the lawyer sets the case's visa (and facts and people), one row per item per person. It's frozen, so later catalog or firm changes don't touch it until the lawyer refreshes it. A refresh keeps statuses and uploads.

## Requirement shape

- `applies_to`: `main_applicant`, `spouse`, `each_child`, `each_adult`, `each_person`, `case`. `each_adult` uses `min_age` (default 16) and the person's birth date.
- `level`: `required`, `optional`. At case level the lawyer can also add `requested` (ad-hoc) items, or set any item to `waived`.
- `only_if` / `unless`: fact IDs.
- **Either/or groups:** `any_of: [doc ids]`. The group is complete when any option is accepted.
- `rules` (shown to the client as instructions): `max_age_days`, `apostille`, `translation`, `valid_months`.

## Sheet (schema 3)

- **Cases**, new columns: `visa_type`, `facts` (ticked facts, `;`-separated), `checklist_version`.
- **People** (new): `person_id`, `case_id`, `name`, `role`, `birth_date`, `notes`, `created_at`, `created_by`. The main applicant is added automatically from the client.
- **Checklist** (new, script-owned): one row per item. It holds the status (`missing`, `received`, `accepted`, `rejected`), the reason, upload IDs, the due date, and the item's text frozen in all languages.
- **Adjustments** (new, the firm's): `visa_type`, `applies_to`, `doc_type`, `action`, `level`, `title`, `note`.
- **Uploads**, new columns: `item_id`, `person_id`.
- **Settings**, new keys: `countries`, `catalog_version`, `catalog_check`.

## Client and lawyer

- **Client:** a checklist per person, an upload slot per item, an "other document" slot, rejection reasons, and progress per person and in total.
- **Lawyer:**
  - set the visa, the facts and the people;
  - accept or reject items, with a reason;
  - add ad-hoc requests and waivers;
  - edit the firm's adjustments;
  - automatic reminders for missing items;
  - all of it through the portal-clients skill too.

## Status on the branch (2026-10-31)

All six build steps are done on `feature/visa-checklists`, with unit tests (274 Jest plus 7 Python). Not released, and not yet tried in a real sheet.

1. **Catalog:** `catalog/*.yaml`, built by `npm run catalog`. Portugal has 12 residence visas and 42 document types, in PT/EN/ES, researched from the consular checklists.
2. **Engine:** schema 3 (People, Checklist, Adjustments), `Checklist` (pure) and `CaseChecklist` (the sheet sync).
3. **Portal:** the per-person checklist, uploads per item into each person's folder, and digests that name the item.
4. **Lawyer:** review in the sheet; `Reminders`; the portal-clients skill covers visas, people, facts, review, requests and adjustments.
5. **Catalog updates:** the firm's catalog is kept in its sheet; a newer one is offered daily and applied only by the lawyer.
6. **Spanish:** the portal, emails, setup, menus and skills; a language picker on the page.

**Tried on the DEV sheet (2026-10-31):**
- the schema 3 migration;
- a family case (PT-D7, spouse and two children) builds its list, per person, ages included;
- an upload into an item lands in the person's folder and marks the item received;
- a rejection shows its reason on the portal;
- a fact (`cplp`) waives the items it should, and clearing it brings them back;
- an ad-hoc request and a firm adjustment (the adjustment waits for the case to change);
- Spanish on the portal and in the login email; switching language reloads the checklist.

**Still to verify:**
- reminders after `reminder_days`;
- once on main, a catalog notice from the feed.
