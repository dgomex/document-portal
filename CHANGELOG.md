# Changelog

## 0.6.0 (library version 13, 2026-11-25)

Each case has its own list of documents, written by the firm (Checklist tab, optional section): no visa types, people or list rules; old tabs retired, existing cases unchanged; portal-lists skill retired (schema 5)

## 0.5.2 (library version 12, 2026-11-24)

Portal address changes are caught: Verificar explains a replaced or archived deployment (404) and warns once when the portal moved to a new address; the portal-update skill checks the deployment ID before and after deploying.

## 0.5.1 (library version 11, 2026-11-24)

Fix: min_age now limits any per-person row, not only each_adult (e.g. a minor applicant's criminal record from 16); a min_age on a case row gets a check warning.

## 0.5.0 (library version 10, 2026-11-24)

Firm-owned lists: each firm keeps its own process types and document lists in two tabs of its sheet (Visa types, Document lists), with no central catalog. 0.4.x sheets get the lists they were using copied in once (schema 4); new portal-lists skill imports a firm's existing lists.

## 0.4.2 (library version 9, 2026-11-01)

Security fixes: an upload can no longer register or trash a file created before it started; uploads started but never finished are trashed by a daily sweep (only files the portal created, never the lawyer's own).

## 0.4.1 (library version 8, 2026-11-01)

Checklist items show their own upload in progress (spinner, percentage, retry on failure); Drive folders follow client and case renames in the sheet; bundles visa catalog 2026.11.1 with the 57 AIMA residence permits (applied only when the lawyer clicks Apply).

## 0.4.0 (library version 7, 2026-10-31)

Visa checklists: per-person document lists from a central catalog (Portugal, 12 visas), firm adjustments, reminders, catalog update notices, Spanish

## 0.3.1 (library version 6, 2026-10-31)

Maintenance release: target for the first skill-driven update

## 0.3.0 (library version 5, 2026-10-31)

Automatic setup from a pre-filled Settings tab (onboarding skill), logo_url, ?portal=status

## 0.2.2 (library version 4, 2026-10-31)

Security: throttle crons, cap wrong codes per email per 6 hours

## 0.2.1 (library version 3, 2026-10-30)

Fix: clients typed by hand in the sheet are activated on first processing

## 0.2.0 (library version 2, 2026-10-30)

First release: OTP login, uploads with content checks, digests, invites, privacy notice, guided update

