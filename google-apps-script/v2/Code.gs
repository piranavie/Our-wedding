/* Deploy ONLY this v2 script in a new Apps Script project, executing as the owner.
 * Invitation IDs are private bearer credentials. No API lists households or sends messages.
 */
const WEDDING_SCHEMA = Object.freeze({
  dashboard: 'OUR WEDDING | RSVP DASHBOARD',
  guests: 'Guest List',
  audit: 'RSVP',
	technical: 'RSVP Technical',
  guestHeaders: ['Family side', 'Relationship type', 'Family Name', 'Invite ID', 'Invitation Status',
	'Invitation URL', 'RSVP Response', 'Epected attendance', 'RSVP No of People'],
  technicalHeaders: ['Invite ID', 'Household Record JSON'],
  recordHeaders: [
	'Invitation ID', 'Groom/Bride Side', 'Relationship Type', 'Family Name',
	'Primary Contact Name', 'Expected Family Count', 'RSVP Status', 'Attending Count',
	'RSVP Date', 'Invitation Sent', 'Last Updated', 'Household Members',
	'Phone / WhatsApp', 'Invitation URL', 'WhatsApp Link', 'Last Request ID', 'Last Request Hash'
  ],
  auditHeaders: ['Submitted At', 'Family Name', 'Phone / WhatsApp', 'Attending', 'Guests',
	'Request ID', 'Invite ID', 'Last Updated', 'Household Members', 'Request Hash']
});
const G = Object.freeze({ id: 0, side: 1, relationship: 2, family: 3, contact: 4,
  expected: 5, status: 6, count: 7, rsvpDate: 8, sent: 9, updated: 10,
  members: 11, phone: 12, url: 13, whatsapp: 14, requestId: 15, requestHash: 16 });
const VISIBLE_FIELDS = Object.freeze([G.side, G.relationship, G.family, G.id, G.sent, G.url, G.status, G.expected, G.count]);

function visibleHousehold(row) { return VISIBLE_FIELDS.map(index => row[index]); }
function internalHousehold(row) {
  const values = new Array(WEDDING_SCHEMA.recordHeaders.length).fill('');
  VISIBLE_FIELDS.forEach((field, index) => { values[field] = row[index]; });
  return values;
}

class WeddingApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function isHexId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function isSiteUrl(value) {
  return /^https:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9._~%/-]*)?\/$/i.test(value);
}

function requireInvitationId(value) {
	if (!isHexId(value))
	throw new WeddingApiError('INVALID_INVITATION', 'Please use the complete private invitation link from the couple.');
  return value;
}

function cellText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
}

function readCellText(value) {
  const text = String(value == null ? '' : value);
  return /^'[\s\u0000-\u001f]*[=+\-@]/.test(text) ? text.slice(1) : text;
}

function isoText(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function hashPayload(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
	.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function configuredTimestamp(value, name) {
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?(Z|[+-]\d{2}:\d{2})$/);
  const invalid = () => new Error('config.json ' + name + ' must be a valid ISO timestamp with an explicit timezone offset.');
  if (!parts) throw invalid();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth ||
	  Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] || 0) > 59)
	throw invalid();
  if (parts[8] !== 'Z') {
	const hours = Number(parts[8].slice(1, 3));
	const minutes = Number(parts[8].slice(4, 6));
	if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw invalid();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw invalid();
  return timestamp;
}

function settingsFromConfig(config, siteUrl) {
	const deadline = configuredTimestamp(config && config.rsvp && config.rsvp.closesAt, 'rsvp.closesAt');
  const start = configuredTimestamp(config && config.wedding && config.wedding.start, 'wedding.start');
  const end = configuredTimestamp(config && config.wedding && config.wedding.end, 'wedding.end');
  if (deadline >= start || end <= start)
	throw new Error('The RSVP deadline must precede the wedding start, and the wedding end must follow it.');
  if (config.programme !== undefined) {
	if (!Array.isArray(config.programme)) throw new Error('The wedding programme must be an array.');
	config.programme.forEach(item => configuredTimestamp(item && item.start, 'programme.start'));
  }
  if (!Number.isInteger(config.rsvp.maxAttending) || config.rsvp.maxAttending < 1 || config.rsvp.maxAttending > 30 ||
	  !Number.isInteger(config.rsvp.maxMembers) || config.rsvp.maxMembers < 1 || config.rsvp.maxMembers > 30)
	throw new Error('RSVP limits must be integers between 1 and 30.');
  if (!isSiteUrl(siteUrl))
	throw new Error('SITE_URL must be the published HTTPS site folder URL ending with a slash, without query or fragment.');
  if (!config.sharing || config.sharing.whatsAppUrl !== 'https://wa.me/' || typeof config.sharing.messageTemplate !== 'string')
	throw new Error('Configure sharing.whatsAppUrl as https://wa.me/ and provide sharing.messageTemplate.');
  if (!config.coupleNames || !config.rsvp.deadlineLabel) throw new Error('Couple names and deadline label are required.');
  return { closesAt: new Date(deadline).toISOString(), maxAttending: config.rsvp.maxAttending,
	maxMembers: config.rsvp.maxMembers, coupleNames: config.coupleNames, deadlineLabel: config.rsvp.deadlineLabel,
	siteUrl, sharing: config.sharing };
}

function loadWeddingSettings() {
  const text = PropertiesService.getScriptProperties().getProperty('APP_SETTINGS_JSON');
	if (!text) throw new Error('APP_SETTINGS_JSON is missing or empty in this Apps Script project. Workbook/conversion state has not been checked. Run diagnoseWeddingConfiguration(), confirm the project and published SITE_URL, then use syncConfigurationFromWebsite() to restore settings only. Do not run setup/conversion or clear properties to fix this error.');
  let settings;
  try { settings = JSON.parse(text); }
  catch (_) { throw new Error('APP_SETTINGS_JSON contains invalid JSON. Preserve properties and confirm this project and published SITE_URL before refreshing settings with syncConfigurationFromWebsite().'); }
  if (!settings || !Number.isFinite(Date.parse(settings.closesAt)))
	throw new Error('APP_SETTINGS_JSON has an invalid stored RSVP deadline. Confirm this project and published SITE_URL before refreshing settings with syncConfigurationFromWebsite(); do not recreate the workbook.');
  return settings;
}

// Owner-run inventory only: no property writes, network requests or sheet access.
// Deliberately excludes property values, spreadsheet IDs and guest data from logs.
function diagnoseWeddingConfiguration() {
  const properties = PropertiesService.getScriptProperties();
  const keys = ['SITE_URL', 'APP_SETTINGS_JSON', 'SPREADSHEET_ID',
	'SOURCE_SPREADSHEET_ID', 'SOURCE_SHEET_ID', 'TRACKER_CONVERSION'];
  const values = {};
  const propertyStatus = {};
  keys.forEach(key => {
	values[key] = properties.getProperty(key);
	propertyStatus[key] = values[key] == null ? 'missing' : values[key] === '' ? 'empty' : 'present';
  });
  let storedSettings = 'missing-or-empty';
  if (values.APP_SETTINGS_JSON) {
	try {
	  const settings = JSON.parse(values.APP_SETTINGS_JSON);
	  storedSettings = settings && Number.isFinite(Date.parse(settings.closesAt))
		? 'parseable-with-valid-deadline' : 'invalid-deadline';
	} catch (_) { storedSettings = 'invalid-json'; }
  }
  let conversionState = 'missing-or-empty';
  if (values.TRACKER_CONVERSION) {
	try {
	  const record = JSON.parse(values.TRACKER_CONVERSION);
	  conversionState = record && ['backup-created', 'converting', 'completed'].includes(record.state)
		? record.state : 'unrecognized-record';
	} catch (_) { conversionState = 'invalid-json'; }
  }
  const result = {
	propertyStatus, storedSettings, conversionState,
	siteUrlFormatValid: isSiteUrl(String(values.SITE_URL || '').trim()),
	sourceSheetIdFormatValid: /^\d+$/.test(values.SOURCE_SHEET_ID || ''),
	configuredWorkbookMatchesSource: values.SPREADSHEET_ID && values.SOURCE_SPREADSHEET_ID
	  ? values.SPREADSHEET_ID === values.SOURCE_SPREADSHEET_ID : null,
	note: 'Current project properties only; no writes or workbook inspection. Missing properties do not prove setup/conversion never ran here or in another project. Preserve all properties and backups.'
  };
  console.log(JSON.stringify(result));
  return result;
}

function syncConfigurationFromWebsite() {
  const properties = PropertiesService.getScriptProperties();
  const siteUrl = String(properties.getProperty('SITE_URL') || '').trim();
	if (!isSiteUrl(siteUrl))
	throw new Error('Set SITE_URL to the published HTTPS site folder ending in /.');
  const response = UrlFetchApp.fetch(siteUrl + 'config.json?v=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Published config.json could not be fetched. Publish the Blazor app first.');
  const settings = settingsFromConfig(JSON.parse(response.getContentText()), siteUrl);
  properties.setProperty('APP_SETTINGS_JSON', JSON.stringify(settings));
  console.log('Configuration synchronized. RSVP closes at ' + settings.closesAt);
  return settings;
}

class SheetRepository {
  constructor(workbook) {
	this.workbook = workbook;
	this.guests = this.checkedSheet(WEDDING_SCHEMA.guests, WEDDING_SCHEMA.guestHeaders);
	this.audit = this.checkedSheet(WEDDING_SCHEMA.audit, WEDDING_SCHEMA.auditHeaders);
	this.technical = this.checkedSheet(WEDDING_SCHEMA.technical, WEDDING_SCHEMA.technicalHeaders);
  }

  checkedSheet(name, headers) {
	const sheet = this.workbook.getSheetByName(name);
	if (!sheet) throw new Error('Missing sheet: ' + name);
	const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
	if (sheet.getLastColumn() !== headers.length || !headers.every((header, index) => actual[index] === header)) throw new Error('Unexpected schema in ' + name + '. Use the matching setup/conversion; do not rename headers manually.');
	return sheet;
  }

  find(invitationId) {
	const lastRow = this.guests.getLastRow();
	if (lastRow < 2) return null;
	const matches = this.guests.getRange(2, 4, lastRow - 1, 1).createTextFinder(invitationId).matchEntireCell(true).findAll();
	if (matches.length > 1) throw new Error('Duplicate Invitation ID. Organizer must resolve duplicate rows.');
	if (!matches.length) return null;
	const number = matches[0].getRow();
	const record = this.read(number);
	return record.values[G.url] ? record : null;
  }

	technicalRecord(id) {
	if (!id || this.technical.getLastRow() < 2) return null;
	const matches = this.technical.getRange(2, 1, this.technical.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findAll();
	if (matches.length > 1) throw new Error('Duplicate technical Invite ID.');
	if (!matches.length) return null;
	const number = matches[0].getRow();
	const values = JSON.parse(this.technical.getRange(number, 2).getValue());
	if (!Array.isArray(values) || values.length !== WEDDING_SCHEMA.recordHeaders.length || values[G.id] !== id) throw new Error('Invalid technical household record.');
	return { number, values };
  }

  read(number) {
	const visible = this.guests.getRange(number, 1, 1, WEDDING_SCHEMA.guestHeaders.length).getValues()[0];
	const values = internalHousehold(visible);
	const stored = this.technicalRecord(values[G.id]);
	if (stored) {
	  [G.contact, G.rsvpDate, G.updated, G.members, G.phone, G.whatsapp, G.requestId, G.requestHash].forEach(field => { values[field] = stored.values[field]; });
	  if (stored.values[G.requestId]) {
		[G.family, G.status, G.count].forEach(field => { values[field] = stored.values[field]; });
		if (visible[2] !== values[G.family] || visible[6] !== values[G.status] || visible[8] !== values[G.count]) this.project({ number, values });
	  }
	} else if (values[G.id]) throw new Error('Missing technical household record. Restore it before using this invitation.');
	return { number, values };
  }

  project(record) {
	const row = record.values;
	// Only guest-owned fields: never overwrite manual delivery or expected counts.
	this.guests.getRange(record.number, 3).setValue(row[G.family]);
	this.guests.getRange(record.number, 7).setValue(row[G.status]);
	this.guests.getRange(record.number, 9).setValue(row[G.count]);
	SpreadsheetApp.flush();
  }

  store(record) {
	const existing = this.technicalRecord(record.values[G.id]);
	const number = existing ? existing.number : this.technical.getLastRow() + 1;
	this.technical.getRange(number, 1, 1, 2).setValues([[record.values[G.id], JSON.stringify(record.values)]]);
	SpreadsheetApp.flush();
  }

  write(record) {
	this.store(record);
	this.project(record);
  }

  findAudit(requestId) {
	const lastRow = this.audit.getLastRow();
	if (lastRow < 2) return null;
	const found = this.audit.getRange(2, 6, lastRow - 1, 1).createTextFinder(requestId).matchEntireCell(true).findNext();
	return found ? this.audit.getRange(found.getRow(), 1, 1, WEDDING_SCHEMA.auditHeaders.length).getValues()[0] : null;
  }

  appendAudit(record) {
	const row = record.values;
	this.audit.appendRow([isoText(row[G.updated]), row[G.family], row[G.phone],
	  row[G.status] === 'Accepted' ? 'Yes' : 'No', row[G.count], row[G.requestId], row[G.id],
	  isoText(row[G.updated]), row[G.members], row[G.requestHash]]);
	SpreadsheetApp.flush();
  }
}

class InvitationApplication {
  constructor(repository, settings, clock, hash) {
	this.repository = repository;
	this.settings = settings;
	this.clock = clock;
	this.hash = hash;
  }

  household(record) {
	const row = record.values;
	let members = [];
	if (row[G.members]) {
	  members = JSON.parse(String(row[G.members]));
	  if (!Array.isArray(members) || members.some(value => typeof value !== 'string')) throw new Error('Invalid household members data.');
	}
	return { invitationId: row[G.id], familyName: readCellText(row[G.family]),
	  primaryContactName: readCellText(row[G.contact]), expectedFamilyCount: Number(row[G.expected]),
	  status: row[G.status] || 'Pending', attendingCount: Number(row[G.count] || 0),
	  members, lastUpdated: isoText(row[G.updated]) };
  }

  response(record) {
	return { ok: true, household: this.household(record), closesAt: this.settings.closesAt,
	  closed: this.clock().getTime() >= Date.parse(this.settings.closesAt) };
  }

  lookup(invitationId) {
	const record = this.repository.find(requireInvitationId(invitationId));
	if (!record) throw new WeddingApiError('NOT_FOUND', 'This invitation was not found. Please ask the couple for a valid invitation link.');
	return this.response(record);
  }

  validate(body) {
	const invitationId = requireInvitationId(body.invitationId);
	if (!isHexId(body.requestId))
	  throw new WeddingApiError('VALIDATION', 'Invalid request ID. Reload the invitation and retry.');
	const familyName = typeof body.familyName === 'string' ? body.familyName.trim() : '';
	const contact = body.primaryContactName === undefined ? undefined : typeof body.primaryContactName === 'string' ? body.primaryContactName.trim() : '';
	if (!familyName || familyName.length > 120 || (contact || '').length > 120 || /[\u0000-\u001f]/.test(familyName + (contact || '')))
	  throw new WeddingApiError('VALIDATION', 'Enter valid names of up to 120 characters.');
	if (!['Accepted', 'Declined'].includes(body.status)) throw new WeddingApiError('VALIDATION', 'Please accept or decline.');
	if (!Number.isInteger(body.attendingCount) || (body.status === 'Accepted'
	  ? body.attendingCount < 1 || body.attendingCount > this.settings.maxAttending : body.attendingCount !== 0))
	  throw new WeddingApiError('VALIDATION', 'Check your attending count. Declined responses must have zero attendees.');
	if (body.members !== undefined && (!Array.isArray(body.members) || body.members.length > this.settings.maxMembers ||
		body.members.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\u0000-\u001f]/.test(name))))
	  throw new WeddingApiError('VALIDATION', 'Please check the household member names.');
	if (body.status === 'Accepted' && body.members !== undefined && body.members.length > body.attendingCount)
	  throw new WeddingApiError('VALIDATION', 'There cannot be more member names than people attending.');
	if (typeof body.expectedVersion !== 'string' || body.expectedVersion.length > 40)
	  throw new WeddingApiError('VALIDATION', 'Reload your saved response before making changes.');
	return { invitationId, familyName, primaryContactName: contact, status: body.status,
	  attendingCount: body.attendingCount, members: body.members === undefined ? undefined : body.members.map(name => name.trim()),
	  requestId: body.requestId, expectedVersion: body.expectedVersion };
  }

  save(body) {
	const value = this.validate(body);
	const now = this.clock();
	if (now.getTime() >= Date.parse(this.settings.closesAt))
	  throw new WeddingApiError('CLOSED', 'RSVP has closed. Please contact the couple for changes.');
	const record = this.repository.find(value.invitationId);
	if (!record) throw new WeddingApiError('NOT_FOUND', 'This invitation was not found. Please contact the couple.');
	const fingerprint = this.hash(JSON.stringify(value));
	const previous = this.repository.findAudit(value.requestId);
	if (previous) {
	  if (previous[6] !== value.invitationId || previous[9] !== fingerprint)
		throw new WeddingApiError('CONFLICT', 'This request ID was already used for another response. Reload your saved response.');
	  return this.response(record);
	}
	const row = record.values;
	if (row[G.requestId] === value.requestId) {
	  if (row[G.requestHash] !== fingerprint) throw new WeddingApiError('CONFLICT', 'Reload your saved response before making changes.');
	  // A row save can succeed while the audit append fails. An unchanged retry repairs that append.
	  this.repository.appendAudit(record);
	  return this.response(record);
	}
	if (isoText(row[G.updated]) !== value.expectedVersion)
	  throw new WeddingApiError('CONFLICT', 'Your household was updated elsewhere. Reload the saved response before making changes.');
	// Repair any prior partial audit write before accepting a newer response.
	if (row[G.requestId] && !this.repository.findAudit(row[G.requestId])) this.repository.appendAudit(record);
	row[G.family] = cellText(value.familyName);
	// Minimal clients omit legacy name fields; preserve saved data and old-client hashes.
	if (value.primaryContactName !== undefined) row[G.contact] = cellText(value.primaryContactName);
	row[G.status] = value.status;
	row[G.count] = value.attendingCount;
	row[G.rsvpDate] = now.toISOString();
	const previousTime = Date.parse(isoText(row[G.updated])) || 0;
	row[G.updated] = new Date(Math.max(now.getTime(), previousTime + 1)).toISOString();
	if (value.members !== undefined) row[G.members] = JSON.stringify(value.members);
	row[G.requestId] = value.requestId;
	row[G.requestHash] = fingerprint;
	this.repository.write(record);
	this.repository.appendAudit(record);
	return this.response(record);
  }
}

function openWeddingWorkbook() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
	if (!id) throw new Error('SPREADSHEET_ID is missing or empty in this Apps Script project. Settings synchronization does not select a workbook. Run diagnoseWeddingConfiguration() and inspect existing projects, workbooks and TRACKER_CONVERSION before choosing recovery or conversion. Do not run setup or clear properties blindly.');
  return SpreadsheetApp.openById(id);
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOutput({ ok: true, service: 'Wedding Invitation API', version: 2, method: 'POST' });
}

function doPost(event) {
  let lock;
  let locked = false;
  try {
	const raw = event && event.postData && event.postData.contents;
	if (!raw || raw.length > 12000) throw new WeddingApiError('VALIDATION', 'Invalid request size.');
	let body;
	try { body = JSON.parse(raw); } catch (_) { throw new WeddingApiError('VALIDATION', 'Invalid request JSON.'); }
	if (!body || typeof body !== 'object' || Array.isArray(body) || !['lookup', 'rsvp'].includes(body.action))
	  throw new WeddingApiError('VALIDATION', 'Unsupported request.');
	requireInvitationId(body.invitationId);
	lock = LockService.getScriptLock();
	locked = lock.tryLock(10000);
	if (!locked) throw new WeddingApiError('BUSY', 'RSVP is busy. Please retry in a moment.');
	const app = new InvitationApplication(new SheetRepository(openWeddingWorkbook()), loadWeddingSettings(), () => new Date(), hashPayload);
	return jsonOutput(body.action === 'lookup' ? app.lookup(body.invitationId) : app.save(body));
  } catch (error) {
	if (error instanceof WeddingApiError) return jsonOutput({ ok: false, code: error.code, error: error.message });
	console.error('Wedding API storage/configuration failure: ' + error.message);
	return jsonOutput({ ok: false, code: 'STORAGE', error: 'Unable to save or load your RSVP. Please retry or contact the couple.' });
  } finally {
	if (locked) lock.releaseLock();
  }
}

function styleDataSheet(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#611b31').setFontColor('#fff8e9').setFontWeight('bold').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 48);
  sheet.setColumnWidths(1, headers.length, 160);
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length).setVerticalAlignment('top').setWrap(true);
}

function createDashboard(sheet) {
  sheet.getRange('A1:D1').merge().setValue(WEDDING_SCHEMA.dashboard).setFontSize(20).setFontWeight('bold').setBackground('#611b31').setFontColor('#fff8e9');
  const metrics = [
	['Invited Households', '=COUNTIF(\'Guest List\'!F2:F,"?*")'],
	['Total Groom Guests', '=SUMIFS(\'Guest List\'!H2:H,\'Guest List\'!A2:A,"Groom",\'Guest List\'!F2:F,"?*")'],
	['Total Bride Guests', '=SUMIFS(\'Guest List\'!H2:H,\'Guest List\'!A2:A,"Bride",\'Guest List\'!F2:F,"?*")'],
	['Pending RSVPs', '=COUNTIFS(\'Guest List\'!G2:G,"Pending",\'Guest List\'!F2:F,"?*")'],
	['Confirmed Households', '=COUNTIFS(\'Guest List\'!G2:G,"Accepted",\'Guest List\'!F2:F,"?*")'],
	['Declined Households', '=COUNTIFS(\'Guest List\'!G2:G,"Declined",\'Guest List\'!F2:F,"?*")'],
	['Total Expected People', '=SUMIF(\'Guest List\'!F2:F,"?*",\'Guest List\'!H2:H)'],
	['Total Attending People', '=SUMIFS(\'Guest List\'!I2:I,\'Guest List\'!G2:G,"Accepted",\'Guest List\'!F2:F,"?*")']
  ];
  sheet.getRange(3, 1, metrics.length, 2).setValues(metrics).setFontSize(13);
  sheet.getRange('B3:B10').setNumberFormat('0').setFontSize(20).setFontColor('#611b31').setBackground('#fff0cb');
	sheet.getRange('A12:D12').merge().setValue('Totals use Epected attendance. Only rows with an Invitation URL are included; prepared does not mean sent.').setWrap(true);
  sheet.getRange('A14:D14').merge().setValue('1. Add households.  2. Run prepareInvitationLinks.  3. Share Invitation URL privately.  4. Set Invitation Status = Sent manually.').setWrap(true);
  sheet.setColumnWidth(1, 260); sheet.setColumnWidth(2, 140); sheet.setColumnWidths(3, 2, 180);
  sheet.setRowHeight(1, 55); sheet.setRowHeights(3, 8, 45); sheet.setRowHeight(12, 55); sheet.setRowHeight(14, 75);
  sheet.setFrozenRows(1);
}

function setupNewWeddingSpreadsheet() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('SPREADSHEET_ID')) throw new Error('A v2 spreadsheet is already configured. Setup refuses to overwrite or recreate it.');
  const settings = syncConfigurationFromWebsite();
  const workbook = SpreadsheetApp.create(settings.coupleNames + ' | Wedding RSVP');
  workbook.setSpreadsheetTimeZone('Europe/London');
  workbook.setSpreadsheetLocale('en_GB');
  const dashboard = workbook.getSheets()[0].setName(WEDDING_SCHEMA.dashboard);
  const guests = workbook.insertSheet(WEDDING_SCHEMA.guests);
  const audit = workbook.insertSheet(WEDDING_SCHEMA.audit);
	configureGuestSheet(guests, settings);
  styleDataSheet(audit, WEDDING_SCHEMA.auditHeaders);
	createTechnicalSheet(workbook);
  createDashboard(dashboard);
  properties.setProperty('SPREADSHEET_ID', workbook.getId());
  console.log('New spreadsheet created: ' + workbook.getUrl());
  console.log('The previous spreadsheet was not accessed or modified.');
  return workbook.getUrl();
}

function configureGuestSheet(sheet, settings) {
  if (sheet.getMaxColumns() > 9) sheet.deleteColumns(10, sheet.getMaxColumns() - 9);
  if (sheet.getMaxColumns() < 9) sheet.insertColumnsAfter(sheet.getMaxColumns(), 9 - sheet.getMaxColumns());
  styleDataSheet(sheet, WEDDING_SCHEMA.guestHeaders);
  const rows = sheet.getMaxRows() - 1;
  const dropdown = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, 1, rows, 1).setDataValidation(dropdown(['Groom', 'Bride']));
  sheet.getRange(2, 5, rows, 1).setDataValidation(dropdown(['Not sent', 'Sent']));
  sheet.getRange(2, 7, rows, 1).setDataValidation(dropdown(['Pending', 'Accepted', 'Declined']));
  sheet.getRange(2, 4, rows, 1).setNumberFormat('@');
  [8, 9].forEach(column => sheet.getRange(2, column, rows, 1).setNumberFormat('0').setDataValidation(
	SpreadsheetApp.newDataValidation().requireNumberBetween(column === 8 ? 1 : 0, settings.maxAttending).setAllowInvalid(false).build()));
}

function createTechnicalSheet(workbook) {
  const sheet = workbook.insertSheet(WEDDING_SCHEMA.technical);
  styleDataSheet(sheet, WEDDING_SCHEMA.technicalHeaders);
  sheet.hideSheet();
  return sheet;
}

function initializeHouseholds(workbook, rows) {
  const repository = new SheetRepository(workbook);
  if (repository.guests.getLastRow() > 1) throw new Error('Household initialization requires an empty Guest List.');
  const ids = new Set();
  rows.forEach((row, index) => {
	do { row[G.id] = Utilities.getUuid().replace(/-/g, '').toLowerCase(); } while (ids.has(row[G.id]));
	ids.add(requireInvitationId(row[G.id]));
	row[G.sent] = 'Not sent';
	row[G.url] = '';
	repository.store({ number: index + 2, values: row });
  });
  repository.guests.getRange(2, 1, rows.length, 9).setValues(rows.map(visibleHousehold));
  SpreadsheetApp.flush();
}

function invitationLink(settings, id) {
  return settings.siteUrl + '#invite=' + encodeURIComponent(requireInvitationId(id));
}

function whatsappLink(settings, family, id, phone) {
  const link = invitationLink(settings, id);
  const replacements = { family, couple: settings.coupleNames, url: link, deadline: settings.deadlineLabel };
  const text = settings.sharing.messageTemplate.replace(/\{(family|couple|url|deadline)\}/g, (_, key) => replacements[key]);
  const number = String(phone || '').replace(/[\s()+-]/g, '');
  if (number && !/^\d{7,15}$/.test(number)) throw new Error('Phone / WhatsApp must contain a valid international number or be blank.');
  return settings.sharing.whatsAppUrl + number + '?text=' + encodeURIComponent(text);
}

function prepareInvitationLinks() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
	const settings = loadWeddingSettings();
	const repository = new SheetRepository(openWeddingWorkbook());
	const sheet = repository.guests;
	const lastRow = sheet.getLastRow();
	if (lastRow < 2) return;
	const rows = Array.from({ length: lastRow - 1 }, (_, index) => repository.read(index + 2).values);
	const ids = new Set();
	rows.forEach(row => {
	  if (!row[G.id]) return;
	  requireInvitationId(row[G.id]);
	  if (ids.has(row[G.id])) throw new Error('Duplicate Invite ID.');
	  ids.add(row[G.id]);
	});
	rows.forEach((row, index) => {
	  if (!row[G.family]) return;
	  if (!['Groom', 'Bride'].includes(row[G.side]) || !Number.isInteger(Number(row[G.expected])) || Number(row[G.expected]) < 1 || Number(row[G.expected]) > settings.maxAttending)
		throw new Error('Row ' + (index + 2) + ': choose Groom/Bride and an Expected Family Count between 1 and ' + settings.maxAttending + '.');
	  let id = String(row[G.id] || '');
	  if (!id) { do { id = Utilities.getUuid().replace(/-/g, '').toLowerCase(); } while (ids.has(id)); }
	  requireInvitationId(id);
	  ids.add(id);
	  row[G.id] = id;
	  row[G.status] = row[G.status] || 'Pending';
	  row[G.count] = Number(row[G.count] || 0);
	  row[G.sent] = row[G.sent] || 'Not sent';
	  if (!['Not sent', 'Sent'].includes(row[G.sent])) throw new Error('Invitation Status must be Not sent or Sent.');
	  row[G.updated] = isoText(row[G.updated]) || new Date().toISOString();
	  row[G.members] = row[G.members] || '[]';
	  row[G.url] = invitationLink(settings, id);
	  row[G.whatsapp] = whatsappLink(settings, readCellText(row[G.family]), id, readCellText(row[G.phone]));
	});
	rows.forEach((row, index) => {
	  if (!row[G.family]) return;
	  repository.store({ number: index + 2, values: row });
	  sheet.getRange(index + 2, 1, 1, 9).setValues([visibleHousehold(row)]);
	});
	SpreadsheetApp.flush();
	console.log('Links prepared. Nothing was sent. Share Invitation URL privately and mark Invitation Status = Sent manually.');
  } finally { lock.releaseLock(); }
}

function addSampleHouseholds() {
  const repository = new SheetRepository(openWeddingWorkbook());
  if (repository.guests.getLastRow() > 1) throw new Error('Sample data is only allowed on an empty Guest List.');
	const samples = [['Groom', 'Friends', 'Sample Arun Family', '', 'Not sent', '', 'Pending', 3, 0],
	['Bride', 'Family', 'Sample Meena Family', '', 'Not sent', '', 'Pending', 4, 0]];
  repository.guests.getRange(2, 1, samples.length, samples[0].length).setValues(samples);
  prepareInvitationLinks();
}

function checkWeddingSetup() {
  const settings = loadWeddingSettings();
  const repository = new SheetRepository(openWeddingWorkbook());
  const result = { schemaValid: true, spreadsheetUrl: repository.workbook.getUrl(),
	closesAt: settings.closesAt, siteUrl: settings.siteUrl, note: 'This does not verify anonymous web-app access or browser CORS.' };
  console.log(JSON.stringify(result));
  return result;
}
