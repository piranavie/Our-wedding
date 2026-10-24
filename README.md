# Wedding Invitation

A lightweight static wedding invitation with an animated envelope, two invitation cards, and an RSVP interface. No npm, build step, Netlify, or database is required to **view** the invitation.

## Project structure

- `index.html` — semantic HTML for the invitation and RSVP form
- `styles.css` — responsive styles and animations
- `script.js` — envelope, card navigation, scratch card, programme and RSVP form behavior
- `shared.js` — common configuration loading, name normalization, and safe message-template formatting; loaded before each page's script
- `config.json` — couple names, WhatsApp message, RSVP endpoint, wedding date/venue, programme sheet URL and fallback events
- `invitation.webp` — full invitation artwork
- `save_the_date.webp` — local Save the Date artwork, used by the first card and envelope preview
- `share.html`, `share.js`, `share.css` — family-personalized WhatsApp invitation link generator
- `google-apps-script/Code.gs` — prepared Google Sheets RSVP receiver (owner deployment required)
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

RSVP submissions remain unavailable until `rsvpEndpoint` in `config.json` is set to a deployed receiver.

## Publish on GitHub Pages

1. Upload the **contents** of this folder to the **root** of the `main` branch of `piranavie/Our-wedding` (not inside another folder).
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Under **Actions**, confirm that **Publish wedding invitation** succeeds.
4. Open `https://piranavie.github.io/Our-wedding/`.

If an older GitHub Pages workflow exists, remove it to avoid competing deployments.

## RSVP setup (required before sending to guests)

The RSVP form shows a configuration error rather than pretending to save a response until a working endpoint is configured. GitHub Pages cannot execute the receiver.

The prepared receiver in `google-apps-script/Code.gs` targets spreadsheet `15ZZUWV8frLQvOnyolBEJSoTB3LnJ34ZQ`, tab `668031434`. See [receiver setup and verification](google-apps-script/README.md). The spreadsheet viewing URL is not a submission endpoint. The owner must deploy the handler and supply its HTTPS `/exec` URL for `rsvpEndpoint` in `config.json`.

The form sends:

```json
{"name":"Thangasuthan Family","attending":true,"guests":3,"requestId":"0123456789abcdef0123456789abcdef"}
```

An unchanged retry reuses its request ID to avoid duplicate rows. A success message appears only after the receiver returns `ok: true`. No deployment or live sheet validation has been performed.

## Personalized WhatsApp invitations

Edit `coupleNames` in `config.json` to change the couple's names in the invitation heading, browser titles, image descriptions, calendar event title, and WhatsApp message. The current value is `Prakath & Piranvie`. Names embedded in WebP artwork must be updated separately.

Edit `whatsappMessage` in the same file to change the message. Its placeholders are `{family}` for the recipient, `{couple}` for `coupleNames`, and `{url}` for the personalized invitation link. Use `\n` for line breaks inside the JSON string. The sharing page loads this configuration before enabling link creation; it does not silently use hard-coded names if configuration loading fails.

Open `share.html` on your published website. Enter the published invitation URL and the family or guest name, choose **Create invitation link**, then **Review in WhatsApp**. Choose the recipient and review the message before sending; nothing is sent automatically. You can also copy the generated link.

The generated link uses the `family` query parameter, for example `index.html?family=Thangasuthan%20Family`. The invitation displays a personal greeting and prefills the editable RSVP name. Names are inserted as text, not HTML. Without a family parameter, the invitation remains generic and the guest enters their name.

The name is visible in the URL; it is not private or authenticated. Do not include sensitive information. Family links do not restrict guest counts or access. The link generator stores no family list and does not submit data to the RSVP sheet.

For a guest preview as Piranavie, open `index.html?family=Piranavie` on the running website. This changes only that link's greeting and RSVP name; it does not change the configured couple names or submit an RSVP.

### Automatic invitation sending from Google Sheet

The Apps Script receiver can process a `Guest List` sheet and send invitation links automatically to rows where `Phone / WhatsApp` is not blank.

- Personalized links include `family`, `phone`, and `invite` parameters.
- Guest RSVP updates are mapped back to the matching guest row by `Invite ID` (or phone fallback).
- Corrected RSVP family name, RSVP response, and number of people are written back to the guest row.

See `google-apps-script/README.md` for required columns, script properties, and execution steps (`processInvitationsNow()`).

## Editing

- Couple names and WhatsApp message: `config.json` (`coupleNames`, `whatsappMessage`)
- Other invitation text: `index.html`
- Colours, fonts, layout, motion: `styles.css`
- Form logic, animations: `script.js`
- Settings (RSVP endpoint, wedding details, programme): `config.json`
- Replace images using the same filenames to keep references working.


## Local Save the Date artwork

The first card and envelope preview load `save_the_date.webp` directly from this folder. No Google Drive request or image-loading JavaScript is needed. The temporary photo-free HTML/CSS card has been removed; the original WebP file itself was never modified.

Replace `save_the_date.webp` to update the artwork. Text embedded in the image is not generated from `config.json`: keep the artwork date and the configured wedding date in sync. The date popup and countdowns use `config.json` and the venue time zone. Scrolling, larger cards, and navigation that unlocks after the scratch reveal remain enabled.

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
The invitation card uses a reveal animation and respects reduced-motion settings. No additional image or library is required.

### Enlarge to read
Tapping the invitation card (or the "Tap to enlarge" button) opens a full-screen viewer so guests can read the artwork clearly: pinch or scroll to zoom up to 4×, drag to pan, double-tap toggles 2.5×, and × or Esc closes it.
