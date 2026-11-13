/* Optional owner-run import. Install alongside Code.gs in a fresh v2 project.
 * Source sheets are read only; no credentials are copied and no messages sent.
 */
function mapGuestTracker(values, maxAttending) {
  const normalize = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
	const headerIndex = values.findIndex(row => row.some(value => ['rsvp family name', 'family name'].includes(normalize(value))));
  if (headerIndex < 0) throw new Error('Source header Family Name was not found.');
  const headers = values[headerIndex].map(normalize);
  const column = (name, required) => {
	const matches = headers.map((header, index) => header === name ? index : -1).filter(index => index >= 0);
	if (matches.length > 1 || (required && matches.length !== 1)) throw new Error('Missing or duplicate source header: ' + name);
	return matches.length ? matches[0] : -1;
  };
  const fields = {
	family: column(headers.includes('family name') ? 'family name' : 'rsvp family name', true), side: column('family side', true),
	relationship: column('relationship type', true), phone: column('phone / whatsapp', false),
	expected: column(headers.includes('expected attendance') ? 'expected attendance' : 'epected attendance', true),
	response: column('rsvp response', false), count: column('rsvp no of people', false),
	updated: column('rsvp updated at', false)
  };
  const rows = [], missingCounts = [], phoneReview = [], normalizedFriends = [];
  let friendsBlock = false;
  values.slice(headerIndex + 1).forEach((source, index) => {
	const number = headerIndex + index + 2;
	const text = key => fields[key] < 0 ? '' : String(source[fields[key]] == null ? '' : source[fields[key]]).trim();
	const family = text('family');
	if (!family) return;
	let side = text('side'), relationship = text('relationship');
	if (normalize(side) === 'bride' || (relationship && normalize(relationship) !== "groom's friends")) friendsBlock = false;
	if (normalize(side) === 'groom' && normalize(relationship) === "groom's friends") friendsBlock = true;
	if (friendsBlock && (!side || normalize(side) === 'groom')) {
	  if (!side || !relationship) normalizedFriends.push(number);
	  side = 'Groom';
	  relationship = relationship || "Groom's friends";
	}
	side = normalize(side) === 'groom' ? 'Groom' : normalize(side) === 'bride' ? 'Bride' : '';
	if (!side) throw new Error('Source row ' + number + ': Family side must be Groom or Bride.');
	const expectedText = text('expected');
	const expected = expectedText === '' ? '' : Number(expectedText);
	if (expected !== '' && (!Number.isInteger(expected) || expected < 1 || expected > maxAttending))
	  throw new Error('Source row ' + number + ': expected attendance must be blank or a whole number from 1 to ' + maxAttending + '.');
	if (expected === '') missingCounts.push(number);
	const response = normalize(text('response'));
	if ((response && !['pending', 'no response', 'not responded'].includes(response)) || (text('count') && Number(text('count')) !== 0) || text('updated'))
	  throw new Error('Source row ' + number + ': existing RSVP response found. Stop and plan a response migration; this helper imports unresponded households only.');
	const phone = text('phone');
	if (phone) phoneReview.push(number);
	const row = new Array(WEDDING_SCHEMA.recordHeaders.length).fill('');
	row[G.side] = side;
	row[G.relationship] = cellText(relationship);
	row[G.family] = cellText(family);
	row[G.expected] = expected;
	row[G.status] = 'Pending';
	row[G.count] = 0;
	row[G.sent] = 'Not sent';
	row[G.members] = '[]';
	row[G.phone] = cellText(phone);
	rows.push(row);
  });
  if (!rows.length) throw new Error('No named households found. No spreadsheet was created.');
  return { rows, summary: { households: rows.length, groomHouseholds: rows.filter(row => row[G.side] === 'Groom').length,
	brideHouseholds: rows.filter(row => row[G.side] === 'Bride').length, missingCountSourceRows: missingCounts,
	phoneReviewSourceRows: phoneReview, normalizedFriendSourceRows: normalizedFriends } };
}

function readGuestTrackerImport() {
  const properties = PropertiesService.getScriptProperties();
  const sourceId = properties.getProperty('SOURCE_SPREADSHEET_ID');
  const sheetId = properties.getProperty('SOURCE_SHEET_ID');
  if (!sourceId || !sheetId || !/^\d+$/.test(sheetId)) throw new Error('Set SOURCE_SPREADSHEET_ID and numeric SOURCE_SHEET_ID in Script Properties.');
  const source = SpreadsheetApp.openById(sourceId);
  const sheet = source.getSheets().find(tab => tab.getSheetId() === Number(sheetId));
  if (!sheet) throw new Error('Source tab was not found; check SOURCE_SHEET_ID (the URL gid).');
  const settings = syncConfigurationFromWebsite();
  return mapGuestTracker(sheet.getDataRange().getDisplayValues(), settings.maxAttending);
}

function previewGuestTrackerImport() {
  const result = readGuestTrackerImport();
  console.log(JSON.stringify(result.summary));
  console.log('Preview only. No spreadsheet created, source changed, IDs generated or messages sent.');
  return result.summary;
}

function createWeddingSpreadsheetFromTracker() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
	const properties = PropertiesService.getScriptProperties();
	if (properties.getProperty('SPREADSHEET_ID')) throw new Error('A spreadsheet is already configured. Use a fresh Apps Script project; do not clear its SPREADSHEET_ID.');
	const result = readGuestTrackerImport();
	const url = setupNewWeddingSpreadsheet();
	const workbook = openWeddingWorkbook();
	const sheet = workbook.getSheetByName(WEDDING_SCHEMA.guests);
	if (sheet.getLastRow() !== 1) throw new Error('Destination Guest List is not empty. Nothing was imported.');
	if (result.rows.length + 1 > sheet.getMaxRows()) throw new Error('Too many households for the new tab. Expand and review the destination manually; do not rerun setup.');
	initializeHouseholds(workbook, result.rows);
	SpreadsheetApp.flush();
	console.log(JSON.stringify(result.summary));
	console.log('New spreadsheet: ' + url);
	console.log('Complete blank expected counts and review phone country codes before prepareInvitationLinks(). Source unchanged. No messages sent.');
	return url;
  } finally { lock.releaseLock(); }
}
