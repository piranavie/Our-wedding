# Publish the invitation and send guest links

Guests enter only **Family name**, **Accept / Decline**, and **Number attending** (when accepting). Your Guest List keeps exactly nine columns. The spreadsheet stays private; guests receive their own invitation URL, never the spreadsheet or the whole guest list.

## 1. Publish the website

- Prepare and push a review branch using [GIT-WORKFLOW.md](GIT-WORKFLOW.md), then merge approved changes into **main** after checks pass. Exclude `private-guests`, `.vs`, `.tools`, `bin`, `obj` and any generated private links. Do not upload a ZIP as a single file.
- In GitHub **Settings → Pages**, select **GitHub Actions**.
- In **Actions**, run **Build and deploy wedding invitation** (a push to main also runs it).
- Wait for success, then copy the website URL from the deployment. Open it and confirm the envelope loads.
- For this first deployment, `apiEndpoint` may stay blank. RSVP will not save until step 4.

## 2. Check what already exists — do not reset anything

Open the Google Apps Script project whose **Executions** contains the failed run. Privately compare its Script ID in **Project Settings** with any other candidate projects, and its **Deploy → Manage deployments** URL with the published website's `apiEndpoint`. A spreadsheet-bound script and a standalone project have separate Script Properties, even when they access the same spreadsheet. Do not create another project yet.

Check **Project Settings → Script properties** for `SITE_URL`, `APP_SETTINGS_JSON`, `SPREADSHEET_ID`, `SOURCE_SPREADSHEET_ID`, `SOURCE_SHEET_ID` and `TRACKER_CONVERSION`. Retain all values privately. With the current v2 **Code.gs** saved in the confirmed v2 project, run `diagnoseWeddingConfiguration()` for a redacted inventory. It reads only these properties; it does not fetch configuration, open/edit sheets or create anything. It cannot discover other projects or prove workbook state.

- **TRACKER_CONVERSION is `backup-created`, `converting`, malformed or unrecognized:** stop, even if `SPREADSHEET_ID` exists. ssss`checkWeddingSetup()` failed before opening the workbook. Once the project and published `SITE_URL` are confirmed, run `syncConfigurationFromWebsite()` to restore settings only, then `checkWeddingSetup()` only if the existing workbook is configured and conversion state is safe. Sync fetches and validates the public config and writes only `APP_SETTINGS_JSON`; it does not create/convert sheets or set `SPREADSHEET_ID`. Invalid JSON/deadline errors require the same configuration review, not setup.
- **Properties are absent:** this may be the wrong/new project or lost properties. Check other candidate projects, their execution history, and the actual original workbook for backups/system tabs before deciding conversion never ran. Do not point `SPREADSHEET_ID` at an unconverted tracker to bypass the error.
- **Only the original unconverted tracker exists, with no configured backend or previous conversion after those checks:** continue with step 3.
- **Still unsure:** do not run setup/conversion. Share only the redacted diagnostic, standard tab presence and header row (not guest rows, property values, IDs or private links). For backups, report presence only.

`SITE_URL` must be the actual published HTTPS invitation folder ending in `/`, serving the current `config.json`; `localhost:5080` is not usable by Google's runtime. Sync changes server settings, so verify the published dates and limits first. `checkWeddingSetup()` is a configured-workbook validator, not an initial discovery tool; its output includes a private workbook URL and should not be posted publicly. Retain the existing deployment URL and deploy a **New version** when updating production code.

## 3. Convert the original tracker once, if needed

Use [the private conversion instructions](../private-guests/CONVERT-EXISTING-TAB.md) locally; they contain your source spreadsheet/tab IDs. In a fresh Apps Script project:

1. Add the latest **Code.gs**, **ImportGuestTracker.gs**, and **ConvertGuestTracker.gs** from `google-apps-script/v2`, plus its `appsscript.json` manifest.
2. Set **SITE_URL** to the published website folder URL from step 1, ending in `/`. Set the two source properties from the private guide.
3. Run **previewGuestTrackerConversion** and review its log. Then run **convertExistingGuestTracker** and authorize Google access.

This backs up the selected tab and converts it in the same spreadsheet. It adds the dashboard, RSVP history and hidden technical storage. Do **not** run either new-spreadsheet function for this path. If any guard/error appears, stop rather than clearing it.

Your Guest List headers, in order, are:

| A | B | C | D | E | F | G | H | I |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Family side | Relationship type | Family Name | Invite ID | Invitation Status | Invitation URL | RSVP Response | Epected attendance | RSVP No of People |

Keep **Epected attendance** spelled exactly this way. Hidden technical storage is still required for reliable saves; hiding is not security. Keep the workbook and backups **Restricted**, not published to the web.

## 4. Connect RSVP

- In Apps Script choose **Deploy → New deployment → Web app**: **Execute as Me**, access **Anyone**. For an existing deployment, use **Manage deployments → Edit → New version → Deploy** instead.
- Copy the production URL ending **`/exec`** (not `/dev`, not the spreadsheet URL).
- Paste it into **apiEndpoint** in `src/WeddingInvitation/wwwroot/config.json`.
- Commit/upload that change and wait for GitHub Actions to publish again.

If your Google organization blocks anonymous web apps, its policy must be resolved before guests can RSVP.

## 5. Prepare and test one household

- Fill blank **Epected attendance** values with each household's expected size (1–30). Leave guest response fields alone.
- Run **checkWeddingSetup**, then **prepareInvitationLinks**. This creates links but sends nothing.
- Use a clearly labeled test household. Open its **Invitation URL** from column **F** in a signed-out/incognito browser.
- Test accepting, changing the family name/count, and declining. Verify G (response), I (attending count), the dashboard and RSVP history update. The test writes real data—do not test on a guest's record accidentally.
- Test on a phone before sending real invitations. A failed save must not be treated as confirmed.

## 6. Send invitations

- Copy each household's **Invitation URL** (F) into WhatsApp, email or your chosen messenger. Send only that household's link.
- After actually sending it, manually set **Invitation Status** (E) to **Sent**. Otherwise leave **Not sent**.
- **RSVP Response** (G) starts **Pending** and changes to **Accepted / Declined** when the guest saves.
- Add future households as new rows with side, relationship, family name and expected attendance. Leave Invite ID blank only for new manual rows; run **prepareInvitationLinks** again. Do not change existing IDs or edit hidden records.

No automatic messages are sent. The RSVP deadline remains **8 August 2027, end of day UK time**.

For detailed troubleshooting, see [SETUP.md](SETUP.md). For column ownership and recovery behavior, see [SPREADSHEET.md](SPREADSHEET.md).
