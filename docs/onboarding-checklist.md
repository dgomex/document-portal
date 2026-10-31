# Onboarding checklist (per firm)

About 45 minutes on a screen-share. **The lawyer drives; you never get access to their Google account, sheet or folders.** That's what keeps you out of their client data (GDPR: they're the controller, Google the processor, and you neither).

Copy link for new firms (always the latest release): `https://docs.google.com/spreadsheets/d/1qSIabs0k2ATwRoMc6xNs84aQcUar1IAzUQH4YsYRRzY/copy`

## Before the call (email the lawyer)

- [ ] **Google account for the portal.** Workspace is recommended (data processing terms, 1,500 emails a day, no "created by another user" banner). A free Gmail works, with ~95 emails a day and the banner on the portal. Get their signed acknowledgement if they choose free Gmail.
- [ ] If they have a Workspace admin, check that:
  - Apps Script is allowed;
  - web apps can be shared with "Anyone";
  - internal unverified apps are allowed.
- [ ] Have ready:
  - the logo (PNG or JPEG, up to 1 MB);
  - the email for new-document notices;
  - the privacy contact;
  - a link to the firm's privacy policy.
- [ ] Send them [privacy-notice.pt.md](privacy-notice.pt.md) (or [.en](privacy-notice.en.md)) to adapt into their own policy. Include the Claude paragraph if they'll use the skill.
- [ ] A Claude account with a **Google Sheets connector that can write** (a read-only Drive connector isn't enough for the skill).

## On the call

1. **Copy the template.** Open the copy link above with the firm's Google account and rename the copy to "Portal - <Firm>".
2. **Authorise.** Reload the sheet. Wait for the **Portal** menu, then run **Portal → Configurar**.
   - Google shows "this app isn't verified". Choose **Advanced → Go to …**: it's their own copy, running only in their account.
   - Then accept the permissions.
3. **Fill in the setup sidebar.** Firm name, notice email, language, logo, privacy contact and policy link, then **Guardar**. Check the root folder "Portal - <Firm>" appears in their Drive.
   - **Workspace only:** in Settings, set `daily_email_limit` to e.g. `1000`.
4. **Deploy the web app.** In the sheet: **Extensões → Apps Script**, then the blue **Implementar** button (Brazilian Portuguese: *Implantar*) → **Nova implementação**.
   - Click the ⚙️ next to **Selecionar tipo** and choose **Aplicação web** (*App da Web*).
   - Executar como: **Eu**. Acesso: **Qualquer pessoa** (not "with a Google account").
   - Click **Implementar**, authorise if asked, then **open the URL once**. That records the portal address in Settings automatically.
5. **Check the version.** Run **Portal → Atualizar portal → Verificar**: the sheet and the portal should show the same version.
6. **Add the lawyer as a test client.**
   - With the skill: have them connect their Sheets connector, add `portal-clients.skill` in Claude's settings, paste the sheet URL and say "adiciona-me como cliente de teste com o processo Teste".
   - Or by hand: type a name and email in Clients, then run **Portal → Processar novas linhas**.
7. **On their phone:** open the portal, log in with the emailed code and upload a PDF and a photo. Then check:
   - the files are in the case folder;
   - there's a row in Uploads;
   - one digest email arrived.

   **If the phone shows "Não é possível abrir o ficheiro":** that phone's browser is signed into several Google accounts. Open the link in a private tab or another browser. For clients, the fix is to link the portal from the firm's website.
8. **Try an invite.** Set the test client's `invite_status` to `REQUESTED`, then run **Portal → Enviar convites pendentes**. Read the email together.
9. **Clean up.** Untick the test client's `active` box. Don't delete rows.
10. **Hand over:**
    - put the portal URL on their website and in their email signature;
    - invite clients with REQUESTED, or ask Claude to;
    - close cases with `status = closed`;
    - when you announce a release, update with **Portal → Atualizar portal**, about 3 minutes, following its steps.

## After the call

- [ ] Record in *your* CRM: firm, Google account type, release installed, date. No client data.
- [ ] Book a 2-week check-in. Ask about the phone experience, the digest emails, and whether the Events tab shows anything odd (`otp_daily_cap`, `upload_rejected`).

## Releases for existing firms

[release-process.md](release-process.md). Email each firm when you release. The update is theirs to apply; it keeps their portal address.
