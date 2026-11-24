---
name: portal-update
description: Update a law firm's document upload portal ("Portal" for Google Sheets/Drive) to the newest released version, in the firm's own Google account, keeping the same portal address. Use it whenever the lawyer says the portal should be updated, upgraded, "atualizado", "pôr na versão nova", or forwards an announcement of a new portal version, or when Portal → Atualizar portal (EN: Update portal · ES: Actualizar portal) shows the sheet and the portal on different versions. Not for first-time installation (portal-onboarding) or for clients and cases (portal-clients).
---

# Portal update

You update the firm's portal **in the firm's own Google account**, acting for the lawyer who is talking to you. An update changes two things in the sheet's script, and you do both in Google's script editor with Claude in Chrome:

1. **the library version:** what the sheet's menus and background jobs run;
2. **the web app deployment:** what the portal serves to clients. You edit the existing deployment, never create a new one, so the portal address stays the same.

The sheet upgrades its own structure afterwards (within 5 minutes), so you don't touch any tab. For example, going from 0.4.x to 0.5.0 adds the Visa types and Document lists tabs, copies into them the lists the firm was using, and hides the old Adjustments and CatalogData tabs, all by itself.

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

A portal update is a new portal version (the release announcement, or the lawyer asks for it): steps 1–4 below. Read the **Settings** tab (Sheets connector) first.

The firm's document lists are not part of an update: they are the firm's own (the Visa types and Document lists tabs), and an update never changes them. Changing a list is the portal-lists skill.

## 1. Note where it stands

Open `<portal_url>?portal=status`. It returns JSON with `libraryVersion` (e.g. `0.3.0`) and `ready`. Note the version. If `ready` is false, the portal was never fully set up: that's a job for portal-onboarding, not an update.

If it returns Google's **"Page not found"** (pt: *Página não encontrada*) instead, the portal address has **already** changed before this update: its deployment was replaced or archived. Don't update yet. Tell the lawyer, then follow "If the portal address changed" below.

## The portal address must not change

Clients reach the portal through `portal_url`: in their invitation emails, and often on the firm's website. That address belongs to one **deployment**. Editing that deployment with a new version keeps it; **New deployment** creates a new address, and **archiving** the old deployment kills the old one for good (Google can't bring it back). Either way, every link the firm already shared stops working.

So, in step 3:
- Before clicking Deploy, write down the **Deployment ID** and the **web app URL** of the deployment you edit, and check that the URL is exactly `portal_url`.
- After Deploy, the dialog must show the **same** Deployment ID and URL. Check it before clicking Done.
- Never click **New deployment** (pt-PT *Nova implementação*, pt-BR *Nova implantação*, es *Nueva implementación*), and never click the **archive** icon (the box with an arrow, next to the pencil).

If anything doesn't match, stop and tell the lawyer what you saw. Don't try to fix it by creating or archiving deployments.

## 2. Library version

1. Open the sheet, wait for its **Portal** menu, then **Extensions → Apps Script** (pt: *Extensões → Apps Script*). Going through the sheet opens the editor with the right account. The script editor opens in a new tab.
2. In the left panel, under **Libraries** (*Bibliotecas*), click **Portal**. The "Portal library settings" dialog shows the current **Version**, a number.
3. Open the Version list and choose the **highest number**, at the top of the list.
   - Never choose an entry labelled **HEAD** or **development mode**: it only works for the portal's makers and would break the firm's portal.
   - If the highest number is already selected, the library is up to date: click **Cancel** and go to step 3 anyway, in case the deployment lags behind.
4. **Look at the dialog** to confirm the new number is shown. The page's accessibility labels can lag behind the screen, so trust what's visible. Then click **Save**. The editor shows "Saved to Drive".

## 3. Deployment

1. Click the blue **Deploy** button (pt-PT *Implementar*, pt-BR *Implantar*), then **Manage deployments** (*Gerir implementações* / *Gerenciar implantações*). **Not** "New deployment": that would give the portal a new address and break every link the firm has shared.
2. Select the active deployment whose **URL** matches the portal address (usually the only one, named "Portal"). Write down its **Deployment ID** and URL. If **no** active deployment has that URL, stop: the address already changed (see "If the portal address changed"). Click the **pencil** (Edit).
3. In **Version**, choose **New version**. Leave the description, Execute as and Who has access as they are. Click **Deploy**.
4. Normally the dialog then says "Deployment successfully updated", with the **same** Deployment ID and URL you wrote down. **Compare them** before clicking **Done**. If either differs, stop and follow "If the portal address changed".

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

## If the portal address changed

You'll see it as Google's "Page not found" at `portal_url`, as no active deployment with that URL, or as a different URL after Deploy. The old address can't be restored. What you can do:

1. Tell the lawyer plainly: the portal now has a new address, and the links already sent to clients (invitation emails, the firm's website) no longer work.
2. In **Manage deployments**, copy the **web app URL** of the active deployment. Open it once in the browser. The portal then saves it in `portal_url` by itself, and every new email uses it. Don't paste it into Configurar or the Settings tab instead: the portal then can't tell the address changed, and Verificar won't warn about the old links.
   If the old address still answers (an older deployment is still active), Verificar says so: old links then still open the portal, in the old version. Don't archive anything; tell the lawyer and leave the choice of address to us.
3. Ask the lawyer to run **Portal → Atualizar portal → Verificar (EN: Portal → Update portal → Check · ES: Portal → Actualizar portal → Comprobar)**. It confirms the version and repeats the warning about old links.
4. Tell them what to fix: the link on the firm's website, and a new invitation for any client who needs one (the portal-clients skill can resend it).

Never create another deployment to "get the old address back": it only adds a third address.

## When a release changes the sheet's own script

Rarely, a release note says the **sheet's script** (`Code.gs`) or its **permissions** (`appsscript.json`) changed, and gives the new text. Only then, before step 3, open that file in the editor, replace its whole content with the text from the release note, and save. Then continue. Step 3 will ask the lawyer for **Allow** if the permissions changed.

Never edit those files otherwise.

Answer in the lawyer's language, and keep to the words they see on screen.
