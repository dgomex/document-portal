# Developer setup

One-time steps before Phase 0. Items marked **(you)** need your browser, your Google accounts or your password, so they can't be automated.

## 1. Google accounts (you)

| Account | Purpose | Notes |
|---|---|---|
| **Dev/owner account** | Owns the library, the template sheet and the spike | Use a dedicated business account (ideally Workspace), not your personal one. Turn on 2FA, preferably a hardware key. |
| **Test "lawyer" account** | Simulates a firm: makes a copy, authorises, deploys | Ideally a Workspace trial user. Optionally a free Gmail too, to see the degraded mode (banner, quotas). |
| **Test client inbox** | Receives OTP codes for fictional clients | Any inbox with plus-addressing: `you+ana@…`, `you+bruno@…`, `you+carla@…`, `you+diogo@…`. |

For **both** Google accounts, turn on the Apps Script API at <https://script.google.com/home/usersettings>. clasp needs it, and so will the Phase 6 self-update.

For the alias test (spike d2), add a send-as address in the dev account's Gmail: Settings → Accounts → "Send mail as".

## 2. Local toolchain

Node isn't installed on this machine yet. Homebrew is.

```bash
brew install node
```

```bash
cd /Users/danielgomes/personal/repositories/document_control && npm install
```

clasp is a local dev dependency, so run it as `npx clasp …`.

## 3. Log clasp into the dev account (you)

This opens a browser for Google sign-in. Pick the **dev/owner** account.

```bash
cd /Users/danielgomes/personal/repositories/document_control && npx clasp login
```

The token is saved in `~/.clasprc.json`. Never commit it.

## 4. Version control

```bash
cd /Users/danielgomes/personal/repositories/document_control && git init
```

The repo also needs `git` for the release process (tags per library version). Use a private remote.

## 5. Next

Run the spike: [spike/README.md](../spike/README.md).

## DEV portal deployment

The shell (Portal - DEV sheet) has two web app deployments:

- `AKfycbxmOz…` @HEAD: the editor's test deployment. Its `/dev` URL only opens for an editor, and its `/exec` form never opens.
- `AKfycbxtwguC3ujajVLqzURp8h_yk0mE7WO-7uue62aGWQIRp9cgNvYY1MF6K8qi_ZedCUa_NA` @1 "DEV portal": the real one, open to anyone. Its URL is `https://script.google.com/macros/s/<that id>/exec`.

The shell uses the library in development mode, so library pushes reach the DEV portal at once. A **shell** change needs a new version on the same deployment, so the URL stays the same:

```bash
cd shell && npx clasp push --force && npx clasp create-version "notes" && npx clasp update-deployment AKfycbxtwguC3ujajVLqzURp8h_yk0mE7WO-7uue62aGWQIRp9cgNvYY1MF6K8qi_ZedCUa_NA -V <n>
```
