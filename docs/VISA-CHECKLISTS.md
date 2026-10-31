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
