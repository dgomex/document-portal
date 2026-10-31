---
name: portal-onboarding
description: Set up a law firm's own document upload portal ("Portal" for Google Sheets/Drive) from scratch in the firm's Google account. Copy the template, fill in the firm's settings, publish the web app, check it works and add a first test client. Use it whenever a lawyer or firm says they want to install, set up, configure, onboard or "começar a usar" the document portal, the client upload portal or the "Portal" sheet, including "instala o portal de documentos", "set up my client portal" or "configurar o portal para o meu escritório". Not for adding clients to a portal that already exists: that's portal-clients.
---

# Portal onboarding

You set up the firm's document portal **in the firm's own Google account**, acting for the lawyer who is talking to you. The portal is a Google Sheet with a script. Clients log in with a code sent by email and upload documents straight into the firm's Google Drive. Nobody else, including the people who make the portal, gets access to the firm's account or data. Keep it that way: everything you create belongs to the lawyer's account.

It takes about 10–15 minutes. The lawyer has to do three things themselves, and you should tell them so up front:
1. be signed in to Google in Chrome with the firm's account;
2. click **Allow** on Google's permission screen once;
3. test the portal on their phone at the end.

## What you need

- **Google Drive connector** (to copy the template) and **Google Sheets connector with write access** (to fill in the settings), both connected to the **firm's** Google account.
- **Claude in Chrome**, in a Chrome where the same Google account is signed in. One step has no API: publishing the web app is only possible in Google's script editor.

If a connector is missing, tell the lawyer how to add it in Claude's settings (Connectors) and wait. If Claude in Chrome is missing, you can still do everything else and talk them through the publishing clicks (step 4, "if the browser isn't available").

The template to copy, always the latest release: Google Sheets file `1qSIabs0k2ATwRoMc6xNs84aQcUar1IAzUQH4YsYRRzY` ("Portal - Template").

## 1. Ask for the firm's details, in one message

- Firm name, as clients should see it.
- Email for new-document notices (usually the firm's general address).
- Portal language for clients: `pt` (default) or `en`.
- Privacy contact (an email) and, if they have one, the link to the firm's privacy policy (https).
- Optional: an https link to their logo (PNG or JPEG, up to 1 MB). Their website's logo often works: right-click it → copy image address.
- Is the Google account a paid **Google Workspace** account or a free Gmail? Workspace can send many more emails a day.
- An email of their own to use as the first test client (e.g. their personal address).

Check the emails look valid and the links start with `https://` before going on.

## 2. Copy the template (Drive connector)

Copy the template file, titled `Portal - <firm name>`. Check that the copy's **owner** is the firm's account. If it isn't, the connector is signed into a different account: stop and sort that out first.

The copy brings its script along: that's the whole portal.

## 3. Fill in Settings (Sheets connector)

The copy has a single empty tab. Rename it to `Settings` and write, from A1:

| key | value | description |
|---|---|---|
| firm_name | the firm name | |
| notification_email | notice email | |
| default_language | pt or en | |
| privacy_contact | privacy email | |
| privacy_policy_url | https link, or leave empty | |
| logo_url | https link to the logo, or leave empty | |
| max_file_mb | 100 | |
| daily_email_limit | 95 for free Gmail; 1000 for Workspace | |

The header row is exactly `key`, `value`, `description`. Leave the descriptions empty: the portal fills them in. Don't create other tabs or columns: the portal builds Clients, Cases, Uploads and the rest itself.

Values starting with `=`, `+`, `-` or `@` get a leading `'`.

## 4. Publish the web app (Claude in Chrome)

1. Open the copy (`https://docs.google.com/spreadsheets/d/<copy id>/edit`). Wait until a **Portal** menu appears in the menu bar: that confirms the script came along.
2. Open **Extensions → Apps Script** (pt: *Extensões → Apps Script*). The script editor opens in a new tab. Going through the sheet's menu matters: it opens the editor with the right Google account.
3. Click the blue **Deploy** button at the top right (pt-PT *Implementar*, pt-BR *Implantar*), then **New deployment** (*Nova implementação* / *Nova implantação*).
4. The dialog normally opens already filled in: type **Web app**, **Execute as: Me (<firm account>)**, **Who has access: Anyone**. Check all three.
   - The account shown must be the firm's account.
   - Access must be plain **Anyone**, not "Anyone with a Google account": clients have no Google login.
   - If the type isn't set, click the ⚙️ next to "Select type" and choose **Web app**.

   Type `Portal` as the description and click **Deploy**.
5. Google answers "The Web App requires you to authorize access to your data", with an **Authorize access** button. **Hand over to the lawyer here.** Granting access to their account is theirs to do.

   Tell them, in their language:
   - click **Authorize access**;
   - choose the firm's account;
   - Google warns "Google hasn't verified this app". That's expected: it's their own copy, running only in their account. Click **Advanced → Go to Portal - Template (unsafe)**;
   - then click **Allow**.

   Wait until they say it's done.
6. The dialog then shows **Web app URL**, ending in `/exec`. Read it from the page, keep it, and click **Done**.

**If the browser isn't available, or the editor looks different:** give the lawyer these same clicks one at a time and ask them to paste the `/exec` URL back to you.

## 5. Finish setup and check it

Open `<portal URL>?portal=status` in the browser (or fetch it). The first visit completes the setup from Settings: Drive folder, logo, the 5-minute and 10-minute background jobs, the security key. It can take 10–20 seconds. The answer is JSON:

- `"ready": true`: done. Go on.
- `"ready": false` with `"setupError": {"fields": [...]}`: those Settings values were rejected:
  - `firm_name`: empty or over 120 characters;
  - `privacy_contact`: over 200 characters;
  - `notification_email`: not a valid email;
  - `default_language`: must be pt or en;
  - `privacy_policy_url`: must be https;
  - `logo_url`: not reachable, not https, not a PNG/JPEG, or over 1 MB;
  - `max_file_mb`: must be 1–100.

  Fix the value with the lawyer, write it to Settings, wait a minute, and open the status address again.
- Anything else, or still not ready after two tries: ask the lawyer to run **Portal → Configurar** in the sheet once. It runs the same setup and shows what's wrong.

Then read the Settings tab back: `root_folder_id`, `portal_url` and `schema_version` should now be filled in.

## 6. First test client

If the portal-clients skill is available, use it to add the lawyer's test email as a client with a case called `Teste`. Otherwise write the row as that skill describes:
- **Clients:** a new row with `client_id` CL- plus 6 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, `name`, `email`, `language`, `active` TRUE, `provision_status` PENDING, `created_by` claude-skill.
- **Cases:** a matching row with `status` open.

The folders appear within 5 minutes.

Then ask the lawyer to open the portal URL **on their phone**, log in with the code that arrives by email, and upload a PDF and a photo. Check together:
- the files are in Drive under "Portal - <firm>" → the client → Teste;
- there's a row in Uploads;
- one "Novos documentos" email arrived.

If the phone shows "Não é possível abrir o ficheiro", that phone's browser is signed into several Google accounts. A private tab works. For clients, the lasting fix is linking the portal from the firm's website.

Afterwards, untick the test client's `active` box. Don't delete rows.

## 7. Hand over

Tell the lawyer, briefly:
- **Portal address:** the `/exec` URL. Put it on the website and in the email signature.
- **Adding clients and cases:** ask Claude (portal-clients skill), or type rows in the sheet and use **Portal → Processar novas linhas**.
- **Inviting a client:** set `invite_status` to REQUESTED. The email goes out within 5 minutes.
- **Updates:** when a new version is announced, **Portal → Atualizar portal** walks them through it (about 3 minutes; the address stays the same).
- **Privacy:** their privacy policy should mention the portal. There are templates in Portuguese and English. If they use Claude to manage clients, it should also say client names and emails are processed by Anthropic.

Answer in the lawyer's language throughout, and keep technical words to the ones they'll see on screen.
