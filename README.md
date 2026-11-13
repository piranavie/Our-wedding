# Wedding Invitation

**`src/WeddingInvitation`** is a .NET 10 Blazor WebAssembly app hosted on GitHub Pages, with a private Google Sheets + Apps Script RSVP backend.

## Start here

1. Follow **[the simple hosting-to-sharing checklist](docs/START-HERE.md)**. Check existing Google setup before running conversion again.
2. Edit **[`src/WeddingInvitation/wwwroot/config.json`](src/WeddingInvitation/wwwroot/config.json)** — the application's configuration file.
3. Run locally with `dotnet run --project src/WeddingInvitation --urls http://localhost:5080`, then open `http://localhost:5080`.
4. Follow **[the Git branch checklist](docs/GIT-WORKFLOW.md)**. Branches run automated checks; only `main` deploys the website.
5. Inspect existing Apps Script properties and workbook state before choosing configuration sync, recovery or conversion. For an unconverted tracker, use the guarded **in-place conversion** to retain the existing workbook/tab and a verified backup. Do not run new-workbook setup for that path.
6. Connect the verified backend's `/exec` URL through `apiEndpoint`, then prepare and privately share household links.

**Guest List uses exactly nine columns:** Family side, Relationship type, Family Name, Invite ID, Invitation Status, Invitation URL, RSVP Response, Epected attendance, RSVP No of People. Set Invitation Status to **Not sent / Sent** manually; guests set RSVP Response to **Accepted / Declined**, with **Pending** before replying. Technical records are stored separately in the hidden **RSVP Technical** tab. Use the current setup/conversion scripts; the old 17-column schema is not compatible with this backend.

New-workbook setup leaves the old spreadsheet untouched; in-place conversion deliberately changes the selected existing tab after backup verification. Local source changes do not deploy or authorize Google services. Never clear `SPREADSHEET_ID` or `TRACKER_CONVERSION` to retry.

## Delivered features

- Envelope, scratch reveal, artwork zoom, programme, directions, local times, calendar download and optional music.
- Household-scoped RSVP: family name, accept/decline and count, with a server-enforced deadline.
- Nine-column Guest List, hidden technical records, RSVP audit and dashboard; invitations are shared manually.
- Validation, formula-injection protection, concurrency checks, retry handling, keyboard access and reduced-motion support.

## Architecture

| Area | Responsibility |
| --- | --- |
| `Models/` | Typed configuration, household DTOs and validated RSVP form |
| `Services/` | Dependency-injected configuration, API, browser and calendar services |
| `Components/` | Reusable invitation, music, local time, countdown, calendar and RSVP UI |
| `wwwroot/config.json` | Public configuration example used by both app and backend setup |
| `wwwroot/css/`, `wwwroot/js/` | Responsive theme and minimal browser-specific interop |
| `google-apps-script/v2/` | Sheet repository, RSVP application service and owner setup functions |
| `tests/` | Offline backend/browser tests and package-free C# checks |

See **[spreadsheet schema and dashboard formulas](docs/SPREADSHEET.md)** and **[the release checklist](docs/SETUP.md#release-checklist)**.

## Files to maintain

- **Invitation text/settings:** `src/WeddingInvitation/wwwroot/config.json`. `apiEndpoint` is the Apps Script `/exec` URL, not `SITE_URL`.
- **Artwork:** the two WebP files in `wwwroot/assets/`. Text inside images is independent of config.
- **Appearance:** `wwwroot/css/`. All three stylesheets are active; `original` in a filename does not mean unused.
- **Backend:** `google-apps-script/v2/Code.gs` and `appsscript.json`. Install both optional tracker scripts for in-place conversion; retain their backup/recovery guards.
- **Private material:** keep guest data, workbook IDs, backups and generated invitation links outside Git. `private-guests/` is ignored and its local guide is not included in a clone. Public conversion instructions are in [SETUP.md](docs/SETUP.md#back-up-and-convert-the-existing-tab-in-place).

## Tests

- `node --test tests/*.test.cjs` (Node 22+, no npm install)
- `dotnet run --project tests/WeddingInvitation.Checks -c Release`
- `dotnet build src/WeddingInvitation/WeddingInvitation.csproj -c Release`

Tests do not access live spreadsheets or send messages. No sample phone numbers are sent anything automatically.
