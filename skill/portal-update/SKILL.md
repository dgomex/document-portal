---
name: portal-update
description: Update a law firm's document upload portal ("Portal" for Google Sheets/Drive) to the newest released version, in the firm's own Google account, keeping the same portal address. Use it whenever the lawyer says the portal should be updated, upgraded, "atualizado", "pôr na versão nova", or forwards an announcement of a new portal version, or when Portal → Atualizar portal (EN: Update portal · ES: Actualizar portal) shows the sheet and the portal on different versions. Not for first-time installation (portal-onboarding) or for clients and cases (portal-clients).
---

# Portal update

You update the firm's portal **in the firm's own Google account**, acting for the lawyer who is talking to you. An update changes two things in the sheet's script, and you do both in Google's script editor with Claude in Chrome:

1. **the library version:** what the sheet's menus and background jobs run;
2. **the web app deployment:** what the portal serves to clients. You edit the existing deployment, never create a new one, so the portal address stays the same.

The sheet upgrades its own structure afterwards (within 5 minutes), so you don't touch any tab.

It usually needs no clicks from the lawyer. The exception: if the new version needs new Google permissions, Google asks them to **Allow** (see step 3).

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese, English and Spanish, and Google's screens in English, pt-PT, pt-BR and Spanish. When you tell the lawyer what to click, use the words on **their** screen.

## What you need

- **Claude in Chrome**, in a Chrome where the firm's Google account is signed in.
- The portal sheet. Ask for its link, or find it with the Drive connector: a spreadsheet titled "Portal - <firm>" owned by the lawyer.
- The portal address: the `portal_url` key in the sheet's **Settings** tab (Sheets connector), or ask the lawyer.

If Claude in Chrome isn't available, guide the lawyer through **Portal → Atualizar portal** (EN: Update portal · ES: Actualizar portal) in their sheet, which lists the same steps. Then use step 4 to check.

## 1. Note where it stands

Open `<portal_url>?portal=status`. It returns JSON with `libraryVersion` (e.g. `0.3.0`) and `ready`. Note the version. If `ready` is false, the portal was never fully set up: that's a job for portal-onboarding, not an update.

## 2. Library version

1. Open the sheet, wait for its **Portal** menu, then **Extensions → Apps Script** (pt: *Extensões → Apps Script*). Going through the sheet opens the editor with the right account. The script editor opens in a new tab.
2. In the left panel, under **Libraries** (*Bibliotecas*), click **Portal**. The "Portal library settings" dialog shows the current **Version**, a number.
3. Open the Version list and choose the **highest number**, at the top of the list.
   - Never choose an entry labelled **HEAD** or **development mode**: it only works for the portal's makers and would break the firm's portal.
   - If the highest number is already selected, the library is up to date: click **Cancel** and go to step 3 anyway, in case the deployment lags behind.
4. **Look at the dialog** to confirm the new number is shown. The page's accessibility labels can lag behind the screen, so trust what's visible. Then click **Save**. The editor shows "Saved to Drive".

## 3. Deployment

1. Click the blue **Deploy** button (pt-PT *Implementar*, pt-BR *Implantar*), then **Manage deployments** (*Gerir implementações* / *Gerenciar implantações*). **Not** "New deployment": that would give the portal a new address and break every link the firm has shared.
2. Select the active deployment whose **URL** matches the portal address (usually the only one, named "Portal"). Click the **pencil** (Edit).
3. In **Version**, choose **New version**. Leave the description, Execute as and Who has access as they are. Click **Deploy**.
4. Normally the dialog then says "Deployment successfully updated", with the **same** URL. Click **Done**.

   If instead Google says the web app needs authorisation, the new version needs new permissions. **Hand over to the lawyer:**
   - click **Authorize access** and choose the firm's account;
   - **Advanced → Go to … (unsafe)**: it's their own copy;
   - **Allow**.

   Then finish with **Done**.

## 4. Check

Open `<portal_url>?portal=status` again.
- `libraryVersion` should be **newer** than in step 1, and `ready` should be `true`. Tell the lawyer the old and new versions.
- **Still the old version:** the deployment step didn't take. Repeat step 3 and make sure you picked **New version**.
- **An error page, or `ready: false`:** ask the lawyer to open the sheet and run **Portal → Atualizar portal → Verificar (EN: Portal → Update portal → Check · ES: Portal → Actualizar portal → Comprobar)**. It shows the version the sheet and the portal each run, and points to the missing step.

The sheet's own `library_version` cell catches up within 5 minutes, so don't rely on it right after updating.

## When a release changes the sheet's own script

Rarely, a release note says the **sheet's script** (`Code.gs`) or its **permissions** (`appsscript.json`) changed, and gives the new text. Only then, before step 3, open that file in the editor, replace its whole content with the text from the release note, and save. Then continue. Step 3 will ask the lawyer for **Allow** if the permissions changed.

Never edit those files otherwise.

Answer in the lawyer's language, and keep to the words they see on screen.
