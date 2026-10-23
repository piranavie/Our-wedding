# Prakanth & Piranavie — Wedding Invitation

A lightweight static wedding invitation with an animated envelope, two invitation cards, and an RSVP interface. No npm, build step, Netlify, or database is required to **view** the invitation.

## Project structure

- `index.html` — semantic HTML for the invitation and RSVP form
- `styles.css` — responsive styles and animations
- `script.js` — envelope, card navigation, scratch card, programme and RSVP form behavior
- `config.json` — all editable settings: RSVP endpoint, wedding date/venue, Save the Date Drive ID, programme sheet URL and fallback events
- `save_the_date.webp` / `invitation.webp` — invitation artwork
- `.github/workflows/pages.yml` — automatic GitHub Pages deployment

## Run locally

No install or build step is needed. The simplest option is to open `index.html` directly in a browser.

For behaviour closest to GitHub Pages (some browsers restrict `fetch` and image loading on `file://` URLs), serve the folder over HTTP from the project root:

```powershell
# Python 3
python -m http.server 8080

# or Node (no install required)
npx serve .
```

Then open `http://localhost:8080`. 

until `rsvpEndpoint` in `config.json` is set

## Publish on GitHub Pages

1. Upload the **contents** of this folder to the **root** of the `main` branch of `piranavie/Our-wedding` (not inside another folder).
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Under **Actions**, confirm that **Publish wedding invitation** succeeds.
4. Open `https://piranavie.github.io/Our-wedding/`.

If an older GitHub Pages workflow exists, remove it to avoid competing deployments.

## RSVP setup (required before sending to guests)

The RSVP form currently shows a clear configuration error rather than pretending to save a response. GitHub Pages cannot host `/api/rsvp`.

To save responses, deploy an HTTPS endpoint (for example a Google Apps Script web app backed by Google Sheets) that accepts a POST body with:

```json
{"name":"Guest name","attending":true,"guests":3}
```

Then set `rsvpEndpoint` in `config.json` to the endpoint URL.

## Editing

- Wedding names and text: `index.html`
- Colours, fonts, layout, motion: `styles.css`
- Form logic, animations: `script.js`
- Settings (RSVP endpoint, wedding details, programme, Save the Date image): `config.json`
- Replace images using the same filenames to keep references working.


## Updating the Save the Date via Google Drive

The Save the Date image is loaded from Google Drive file ID `1teqbaa0HbVDr3qx8h63YTRe5iYliBw8b` when a guest opens the website. If it fails to load, the included `save_the_date.webp` is used. The envelope preview and full card use the same image.

1. In Google Drive, set the file to **Anyone with the link → Viewer**.
requiring an update to `saveTheDate.driveFileId` in `config.json`.
3. Google Drive may cache thumbnails or block hotlinking, so updates may not be immediate or reliable. For guaranteed delivery, publish the image as a website asset instead.

GitHub Pages cannot access private Drive files. The image must be an image format supported by browsers (JPEG, PNG, WebP), not a PDF. RSVP submissions still require a configured Google Apps Script endpoint.

### Scratch to reveal the date
The date on the Save the Date card is hidden under a gold foil panel (also covered on the envelope preview). Guests scratch the foil with a finger or mouse; once about 35% is cleared the foil dissolves and a date popup appears with a day countdown, an **Add to calendar** (.ics) button and a **See the invitation** button that advances to the next card. Two quick taps on the panel, or Enter/Space for keyboard users, also reveal it.

Position the foil over the date in your artwork with the `--scratch-top`, `--scratch-height` and `--scratch-inset` variables at the top of `styles.css` (percentages of the card). Change the date, time and venue in `config.json` (`wedding`); the popup, programme header, calendar file and countdowns all read from it.

## Countdowns and time zones

`wedding.start`, `wedding.end` and `rsvp.deadline` in `config.json` are wall-clock times at the venue, interpreted in `wedding.timeZone` (default `Europe/London`). The site converts them to absolute instants, so the live countdowns in the date popup (to the wedding) and on the RSVP page (to the reply deadline) are correct for guests opening the invitation from any country. Dates shown as text use the venue's time zone.

### Programme screen (Thaali ceremony events)
After the invitation, **Programme ›** opens a full-screen page with a grid of event cards — image, step number, time, title and description — and a bar leading on to the RSVP. Until you add images, each card shows a themed glyph on a gradient. The current event is highlighted with a “Now” badge on the wedding day.

To let the couple update the programme without editing the site:

1. Create a Google Sheet with the header row `Time, Title, Description, Image, Glyph` (e.g. `10:00 am | Welcome & Nadaswaram | Guests are welcomed… | 1AbC… | 🎺`). `Image` can be a Google Drive file ID, a Drive share link, any image URL or a local path; `Glyph` is an optional emoji shown while the image loads or when none is given. Drive images must be shared as **Anyone with the link → Viewer**.
2. **File → Share → Publish to web**, choose the sheet and **Comma-separated values (.csv)**, then copy the link.
3. Paste it into `programme.sheetCsvUrl` in `config.json`.

The page fetches the sheet on load, when the Programme opens, and every `programme.refreshSeconds` while it stays open. If the sheet is unreachable or empty, the `programme.fallback` list in `config.json` is shown instead. You can also reference local images (e.g. `images/oonjal.jpg`) in the Image column or in the fallback list.

### Invitation card reveal
and respects reduced-motion settings (falls back to a plain fade). No additional image or library is required.

### Enlarge to read
Tapping the invitation card (or the "Tap to enlarge" button) opens a full-screen viewer so guests can read the artwork clearly: pinch or scroll to zoom up to 4×, drag to pan, double-tap toggles 2.5×, and × or Esc closes it.
