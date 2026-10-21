# Prakanth & Piranavie — Wedding Invitation

A lightweight static wedding invitation with an animated envelope, two invitation cards, and an RSVP interface. No npm, build step, Netlify, or database is required to **view** the invitation.

## Project structure

- `index.html` — semantic HTML for the invitation and RSVP form
- `styles.css` — responsive styles and animations
- `script.js` — envelope, card navigation, and RSVP form behavior
- `save_the_date.webp` / `invitation.webp` — invitation artwork
- `.github/workflows/pages.yml` — automatic GitHub Pages deployment

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

It must return JSON such as `{ "ok": true }` on success, and support browser requests from your GitHub Pages origin. Then set `RSVP_ENDPOINT` at the top of `script.js` to the endpoint URL. Test a Yes and No response and verify both actually appear in the sheet before sharing. Do not put secrets or private credentials in client-side code.

## Editing

- Wedding names and text: `index.html`
- Colours, fonts, layout, motion: `styles.css`
- Form logic, animations, RSVP endpoint: `script.js`
- Replace images using the same filenames to keep references working.
