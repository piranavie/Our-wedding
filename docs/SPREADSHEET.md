# New spreadsheet schema

`setupNewWeddingSpreadsheet()` creates a separate private workbook and styles its tabs. It does not reuse the old tab IDs or data. The new backend identifies tabs by the names below; do not rename them or reorder columns.

## Sheet 1 — OUR WEDDING | RSVP DASHBOARD

The following formulas are installed in B3:B10. All metrics exclude rows without an Invitation URL. Invited Households means households prepared for invitation, not confirmed message delivery.

| Cell | Metric | Formula |
| --- | --- | --- |
| B3 | Invited Households | `=COUNTIF('Guest List'!F2:F,"?*")` |
| B4 | Total Groom Guests | `=SUMIFS('Guest List'!H2:H,'Guest List'!A2:A,"Groom",'Guest List'!F2:F,"?*")` |
| B5 | Total Bride Guests | `=SUMIFS('Guest List'!H2:H,'Guest List'!A2:A,"Bride",'Guest List'!F2:F,"?*")` |
| B6 | Pending RSVPs | `=COUNTIFS('Guest List'!G2:G,"Pending",'Guest List'!F2:F,"?*")` |
| B7 | Confirmed Households | `=COUNTIFS('Guest List'!G2:G,"Accepted",'Guest List'!F2:F,"?*")` |
| B8 | Declined Households | `=COUNTIFS('Guest List'!G2:G,"Declined",'Guest List'!F2:F,"?*")` |
| B9 | Total Expected People | `=SUMIF('Guest List'!F2:F,"?*",'Guest List'!H2:H)` |
| B10 | Total Attending People | `=SUMIFS('Guest List'!I2:I,'Guest List'!G2:G,"Accepted",'Guest List'!F2:F,"?*")` |

Groom/Bride totals count expected people by side, not the number of household rows. Actual attending totals use Accepted responses. Pending/declined attending counts are zero. Sheet formulas recalculate automatically after RSVP writes.

The formulas are standard SUMIF/SUMIFS/COUNTIF/COUNTIFS and can be used in Excel after export. The live app writes to Google Sheets only, not downloaded Excel files.

## Sheet 2 — Guest List

| Column | Exact header | Ownership / meaning |
| --- | --- | --- |
| A | Family side | Organizer dropdown: Groom / Bride |
| B | Relationship type | Organizer category |
| C | Family Name | Household name; updated by guest responses |
| D | Invite ID | Generated random 32-character private identifier |
| E | Invitation Status | Organizer manually sets Not sent / Sent |
| F | Invitation URL | Generated private link; share manually |
| G | RSVP Response | Pending until the guest replies; then Accepted or Declined |
| H | Epected attendance | Organizer's expected household size; spelling retained as requested |
| I | RSVP No of People | Actual attending count; zero for Pending/Declined |

Guest List has exactly nine columns, with no hidden technical columns. Generation does not change delivery status to Sent. RSVP saves do not alter the organizer's side, relationship, expected attendance or delivery status. Share column F through your chosen messenger; there is no visible WhatsApp Link column.

Name changes are matched by Invitation ID, never by mutable names or phone numbers. The family name labels the household; it is not its database key. Unknown IDs cannot add a new household. The organizer adds a row and prepares its ID first.

Use the updated nine-column CSV in `google-apps-script/v2/sample-guests.csv`. Existing 17-column sheets are rejected, not silently reinterpreted. For an unissued tracker, use the documented backup/conversion workflow. An active responding sheet needs a separately reviewed migration.

## Hidden sheet — RSVP Technical

This tab has two headers: **Invite ID** and **Household Record JSON**. It stores RSVP timestamps, version, last request ID/hash and a committed response snapshot. Legacy contact/member names and optional imported phone data are retained without being collected by the simplified form. It is keyed by Invite ID, not row position, so sorting the complete Guest List does not detach records. Never edit, delete or regenerate these records manually.

The backend commits the technical record first, then projects Family Name, RSVP Response and RSVP No of People to Guest List. A subsequent lookup/retry repairs interrupted projections without overwriting manual delivery or expected counts. The existing audit-repair logic then handles interrupted audit appends. Avoid editing response-owned cells directly; use the household's invitation to correct a response.

Import/conversion allocates internal IDs to preserve technical data, but leaves Invitation URL blank. Those households cannot use the API until `prepareInvitationLinks()` succeeds. Missing technical records fail safely. Hiding is not access control: keep the entire workbook Restricted; never publish the technical tab or backup.

## Sheet 3 — RSVP (audit snapshots)

| Column | Header | Meaning |
| --- | --- | --- |
| A | Submitted At | Server save/version timestamp |
| B | Family Name | Submitted household name |
| C | Phone / WhatsApp | Organizer's phone value, never taken from public input |
| D | Attending | Yes / No |
| E | Guests | Actual attending count |
| F | Request ID | Client retry identifier |
| G | Invite ID | Household's stable Invitation ID |
| H | Last Updated | Server-generated version timestamp |
| I | Household Members | Snapshot JSON names |
| J | Request Hash | Payload fingerprint used to reject request-ID reuse |

This tab is an append-only audit, not the source of current dashboard totals. A changed response adds a snapshot while updating the same Guest List row. An unchanged retry reuses its Request ID and does not append another snapshot. Do not clear audit rows while guests are responding.

## API contract

All requests use POST to the owner's deployed `/exec` endpoint with `Content-Type: text/plain;charset=utf-8` and a JSON body. No public GET returns guest data.

- `action: lookup`, `invitationId`: returns one sanitized household, `closesAt`, `closed`.
- `action: rsvp`, `invitationId`, `familyName`, `status`, `attendingCount`, `requestId`, `expectedVersion`: validates and saves one household. Legacy `primaryContactName` and `members` are optional; omission preserves stored values. Explicit legacy fields remain validated for older clients and retry compatibility.
- `requestId`: new random 32-character hex value per changed submission; reuse after uncertain network failures.
- `expectedVersion`: the `household.lastUpdated` value from the latest lookup/save.
- Success: `ok: true`, `household`, `closesAt`, `closed`.
- Failure: `ok: false`, safe `error`, `code` (`VALIDATION`, `INVALID_INVITATION`, `NOT_FOUND`, `CONFLICT`, `CLOSED`, `BUSY`, `STORAGE`). HTTP 200 alone is not proof of success.

The server serializes lookup/save requests with a script lock, validates IDs and fields, escapes spreadsheet-formula prefixes in names, and enforces the cutoff using its clock. Guest data is never accepted by name-only lookup. Apps Script internal exceptions are logged for the organizer, not sent to guests.
