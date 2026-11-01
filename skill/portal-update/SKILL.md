---
name: portal-update
description: Update a law firm's document upload portal ("Portal" for Google Sheets/Drive) to the newest released version, in the firm's own Google account, keeping the same portal address. Use it whenever the lawyer says the portal should be updated, upgraded, "atualizado", "pôr na versão nova", or forwards an announcement of a new portal version, or when Portal → Atualizar portal (EN: Update portal · ES: Actualizar portal) shows the sheet and the portal on different versions. Also when the menu reads "Atualizar portal (listas novas)" (new document lists): then it walks the lawyer through reviewing the new visa lists, which only they may apply. Not for first-time installation (portal-onboarding) or for clients and cases (portal-clients).
---

# Portal update

You update the firm's portal **in the firm's own Google account**, acting for the lawyer who is talking to you. An update changes two things in the sheet's script, and you do both in Google's script editor with Claude in Chrome:

1. **the library version:** what the sheet's menus and background jobs run;
2. **the web app deployment:** what the portal serves to clients. You edit the existing deployment, never create a new one, so the portal address stays the same.

The sheet upgrades its own structure afterwards (within 5 minutes), so you don't touch any tab. For example, going from 0.3.x to 0.4.0 adds the visa checklist tabs (People, Checklist, Adjustments) and new columns in Cases and Uploads by themselves.

It usually needs no clicks from the lawyer. The exception: if the new version needs new Google permissions, Google asks them to **Allow** (see step 3).

**Labels:** menus and buttons appear in the lawyer's language. `references/labels.md` lists the portal's own menu in Portuguese, English and Spanish, and Google's screens in English, pt-PT, pt-BR and Spanish. When you tell the lawyer what to click, use the words on **their** screen.

## What you need

- **Claude in Chrome**, in a Chrome where the firm's Google account is signed in.
- The portal sheet: see "Find the portal sheet" below.
- The portal address: the `portal_url` key in the sheet's **Settings** tab (Sheets connector), or ask the lawyer.

If Claude in Chrome isn't available, guide the lawyer through **Portal → Atualizar portal** (EN: Update portal · ES: Actualizar portal) in their sheet, which lists the same steps. Then use step 4 to check.

<!-- shared:find-sheet: the same text in every portal skill (test/skill.test.js checks it) -->
## Find the portal sheet

The portal is a Google Sheet in the lawyer's Drive, titled "Portal - <firm>". Find it, in this order:

1. **A link in this conversation.**
2. **The project instructions or Claude's memory.** Onboarding gives the lawyer a line to keep there, starting "O portal do escritório:" (EN: "The firm's portal:"), with the sheet link and the portal address. Use both.
3. **A Drive search** (Drive connector): spreadsheets whose title starts with "Portal - ", leaving out "Portal - Template". Read each one's **Settings** tab: a real portal has `schema_version` and `firm_name`.
   - **One portal:** confirm before using it, e.g. "Encontrei a folha «Portal - Silva & Costa» (Silva & Costa Advogados). É esta?"
   - **Several:** list them with their `firm_name` and ask which.
   - **None:** ask the lawyer for the link. If they never set one up, that's the portal-onboarding skill.

Never use a sheet the lawyer hasn't confirmed, or one that isn't a portal: the wrong sheet means writing into another firm's data.

Without a Drive connector, skip step 3 and ask the lawyer for the link. Never ask them to paste the sheet's contents instead: hand-copied emails are how typos get in.

**Once found through step 3 or by asking**, offer the line to keep, so nobody has to ask again:

> O portal do escritório: folha <sheet link>, endereço <`portal_url` from Settings>.

Tell them where it goes: in the instructions of the Claude project they use for the portal (open the project → its instructions → paste), or say "lembra-te disto" if Claude's memory is on. Then carry on with what they asked.
<!-- /shared:find-sheet -->

## 0. Which update is it?

There are two kinds, and they're handled differently. Read the **Settings** tab (Sheets connector), or ask the lawyer what the menu says.

- **A new portal version** (the release announcement, or the menu reads plain **Atualizar portal**): steps 1–4 below.
- **New document lists** (`catalog_pending` in Settings holds a version such as `2026.12`, and the menu reads **Atualizar portal (listas novas)** · EN: Update portal (new lists) · ES: Actualizar portal (listas nuevas)): this is the visa catalog, not the portal. Don't touch the script editor. Go to "New document lists" at the end.

Both can be true at once. Do the portal version first: a new release may also bring newer lists.

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

## New document lists

The portal's makers keep a catalog of the documents each visa needs. When a newer one is published, the portal **offers** it once a day, but nothing changes until the lawyer applies it. That choice is the lawyer's alone: the catalog is guidance, and the lawyer is responsible for what their firm asks clients for.

1. Ask the lawyer to open **Portal → Atualizar portal (listas novas)** (EN: Update portal (new lists) · ES: Actualizar portal (listas nuevas)) in their sheet. The sidebar has a **Listas de documentos** (EN: Document lists · ES: Listas de documentos) section with the new version and what changes, visa by visa ("PT-D7: novo documento – …"). With Claude in Chrome you can open it yourself and read the list from the screen.
2. Explain the changes in plain words, especially any visa the firm actually uses (the `visa_type` values in Cases). Say clearly:
   - only **new** checklists use the new lists; existing cases keep theirs. To refresh one case, the lawyer clears that case's `checklist_version` cell, and nothing already received is lost;
   - the firm's own changes (the Adjustments tab) stay on top of the new lists.
3. The lawyer decides:
   - **Aplicar** (EN: Apply): use the new lists from now on;
   - **Ignorar esta versão** (EN: Ignore this version): keep the current lists; a later version will be offered again.

   Click a button only when the lawyer has told you which one, in this conversation, after seeing the changes. Never decide for them.
4. Afterwards `catalog_version` in Settings shows the version in use, and `catalog_pending` is empty.

If the lawyer doesn't want these notices at all, they untick **Verificar diariamente se há listas novas** (EN: Check daily for new lists) in the same section. New lists then come only with portal updates, and still need **Aplicar**.

## When a release changes the sheet's own script

Rarely, a release note says the **sheet's script** (`Code.gs`) or its **permissions** (`appsscript.json`) changed, and gives the new text. Only then, before step 3, open that file in the editor, replace its whole content with the text from the release note, and save. Then continue. Step 3 will ask the lawyer for **Allow** if the permissions changed.

Never edit those files otherwise.

Answer in the lawyer's language, and keep to the words they see on screen.
