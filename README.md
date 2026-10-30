# Document Control Portal

A lightweight document upload portal for small law firms, built on Google Apps Script, Sheets, Drive and Gmail. Each firm runs its own copy in its own Google account. The shared library (owned by us) holds the logic and never holds client data.

- Plan and critical review: [docs/PLAN.md](docs/PLAN.md)
- Developer setup: [docs/dev-setup.md](docs/dev-setup.md)
- Phase 0 spike (de-risking tests): [spike/](spike/)

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the library (no Google account needed) |
| `npm run push:lib` | Push `library/src` to the Portal Library project |
| `npm run push:shell` | Push `shell/` to the Portal - DEV sheet's script |

## Layout (target)

| Path | What |
|---|---|
| `library/` | Standalone Apps Script library: all core logic and HTML |
| `shell/` | Thin bound script of the template Sheet (wrappers only) |
| `skill/` | Claude skill that adds clients/cases to a firm's sheet |
| `spike/` | Phase 0 throwaway tests (upload, scopes, Gmail alias) |
| `docs/` | Plan, onboarding, release process, GDPR templates |
