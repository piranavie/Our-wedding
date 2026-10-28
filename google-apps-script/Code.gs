/* Wedding RSVP receiver. Deploy as a web app executing as the sheet owner.
 * This public endpoint accepts submissions only; it never returns guest records.
 */
const DEFAULTS = {
  spreadsheetId: '1GDBerZT4qlJsuzFYmnJb8wi43t1sa4edkqIvg1FYcnQ',
  rsvpSheetId: 668031434,
  rsvpHeaders: ['Submitted At', 'Family Name', 'Phone / WhatsApp', 'Attending', 'Guests', 'Request ID', 'Invite ID', 'Last Updated'],
  tabs: {
	guestList: 'Guest List'
  },
  columns: {
	phoneWhatsapp: 'Phone / WhatsApp',
	rsvpFamilyName: 'RSVP Family Name',
	inviteId: 'Invite ID',
	invitationStatus: 'Invitation Status',
	invitationSent: 'Invitation sent',
	invitationSentAt: 'Invitation Sent At',
	invitationUrl: 'Invitation URL',
	rsvpResponse: 'RSVP Response',
	rsvpNoOfPeople: 'RSVP No of People',
	rsvpUpdatedAt: 'RSVP Updated At'
  }
};

let APP_CONFIG = null;
const INVITATION_TRIGGER_HANDLER = 'processInvitationsScheduled';

function getSpreadsheetIdFromUrl(urlText) {
  const text = String(urlText || '').trim();
  if (!text) return '';
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
}

function deepMerge(base, extra) {
  const out = Object.assign({}, base);
  Object.keys(extra || {}).forEach(key => {
	const baseValue = base && base[key];
	const extraValue = extra[key];
	const bothObjects = baseValue && extraValue && typeof baseValue === 'object' && typeof extraValue === 'object' && !Array.isArray(baseValue) && !Array.isArray(extraValue);
	out[key] = bothObjects ? deepMerge(baseValue, extraValue) : extraValue;
  });
  return out;
}

function loadAppConfig() {
  if (APP_CONFIG) return APP_CONFIG;

  let loaded = {};
  const properties = PropertiesService.getScriptProperties();
  const configUrl = String(properties.getProperty('CONFIG_JSON_URL') || '').trim();

  if (configUrl) {
	const response = UrlFetchApp.fetch(configUrl, { muteHttpExceptions: true });
	if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
	  loaded = JSON.parse(response.getContentText() || '{}');
	}
  }

function checkInvitationSystemHealth() {
  const properties = PropertiesService.getScriptProperties();
  const config = loadAppConfig();
  const triggers = ScriptApp.getProjectTriggers();
  const autoSendTrigger = triggers.find(t => t.getHandlerFunction() === INVITATION_TRIGGER_HANDLER);

  const requiredProperties = {
	WHATSAPP_API_TOKEN: Boolean(String(properties.getProperty('WHATSAPP_API_TOKEN') || '').trim()),
	WHATSAPP_PHONE_NUMBER_ID: Boolean(String(properties.getProperty('WHATSAPP_PHONE_NUMBER_ID') || '').trim()),
	INVITATION_BASE_URL: Boolean(String(properties.getProperty('INVITATION_BASE_URL') || '').trim())
  };

  const optionalProperties = {
	CONFIG_JSON_URL: Boolean(String(properties.getProperty('CONFIG_JSON_URL') || '').trim()),
	RSVP_DEADLINE: Boolean(String(properties.getProperty('RSVP_DEADLINE') || '').trim())
  };

  const missingRequired = Object.keys(requiredProperties).filter(key => !requiredProperties[key]);

  return {
	ok: missingRequired.length === 0,
	requiredProperties,
	optionalProperties,
	missingRequired,
	autoSendEnabled: Boolean(autoSendTrigger),
	autoSendHandler: autoSendTrigger ? autoSendTrigger.getHandlerFunction() : '',
	config: {
	  spreadsheetId: config.spreadsheetId,
	  rsvpSheetId: config.rsvpSheetId,
	  guestListTab: config.tabs.guestList,
	  phoneColumn: config.columns.phoneWhatsapp,
	  familyColumn: config.columns.rsvpFamilyName,
	  rsvpStatusColumn: config.columns.rsvpResponse,
	  totalAttendingColumn: config.columns.rsvpNoOfPeople,
	  invitationSentColumn: config.columns.invitationSent
	}
  };
}

  const cfg = deepMerge(DEFAULTS, {
	googleSheets: loaded.googleSheets || {}
  }).googleSheets;

  const sheetIdFromUrl = getSpreadsheetIdFromUrl(cfg.spreadsheetUrl);
  APP_CONFIG = {
	spreadsheetId: sheetIdFromUrl || DEFAULTS.spreadsheetId,
	rsvpSheetId: Number(properties.getProperty('RSVP_SHEET_ID') || DEFAULTS.rsvpSheetId),
	rsvpHeaders: DEFAULTS.rsvpHeaders,
	tabs: {
	  guestList: String(cfg.tabs?.guestList || DEFAULTS.tabs.guestList)
	},
	columns: {
	  phoneWhatsapp: String(cfg.columns?.phoneWhatsapp || DEFAULTS.columns.phoneWhatsapp),
	  rsvpFamilyName: String(cfg.columns?.rsvpFamilyName || DEFAULTS.columns.rsvpFamilyName),
	  inviteId: String(cfg.columns?.inviteId || DEFAULTS.columns.inviteId),
	  invitationStatus: String(cfg.columns?.invitationStatus || DEFAULTS.columns.invitationStatus),
	  invitationSent: String(cfg.columns?.invitationSent || DEFAULTS.columns.invitationSent),
	  invitationSentAt: String(cfg.columns?.invitationSentAt || DEFAULTS.columns.invitationSentAt),
	  invitationUrl: String(cfg.columns?.invitationUrl || DEFAULTS.columns.invitationUrl),
	  rsvpResponse: String(cfg.columns?.rsvpResponse || DEFAULTS.columns.rsvpResponse),
	  rsvpNoOfPeople: String(cfg.columns?.rsvpNoOfPeople || DEFAULTS.columns.rsvpNoOfPeople),
	  rsvpUpdatedAt: String(cfg.columns?.rsvpUpdatedAt || DEFAULTS.columns.rsvpUpdatedAt)
	}
  };
  return APP_CONFIG;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
	.setMimeType(ContentService.MimeType.JSON);
}

function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
	throw new Error('Invalid RSVP submission.');
  }
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
	throw new Error('Please enter a name or family name of up to 120 characters.');
  }
  if (typeof body.attending !== 'boolean') {
	throw new Error('Please choose whether you will attend.');
  }
  if (!Number.isInteger(body.guests) ||
	  (body.attending ? body.guests < 1 || body.guests > 30 : body.guests !== 0)) {
	throw new Error('Please enter a guest count between 1 and 30, or zero when declining.');
  }
  if (typeof body.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestId)) {
	throw new Error('Invalid submission ID. Please reload the invitation and try again.');
  }
	const inviteId = typeof body.inviteId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.inviteId.trim()) ? body.inviteId.trim() : '';
  const invitedPhone = typeof body.invitedPhone === 'string' && /^\+?\d{7,20}$/.test(body.invitedPhone.replace(/[^+\d]/g, ''))
	? body.invitedPhone.replace(/[^+\d]/g, '')
	: '';
  return {
	name: body.name.trim(),
	inviteId,
	invitedPhone,
	attending: body.attending,
	guests: body.guests,
	requestId: body.requestId
  };
}

function normalizePhone(raw) {
  return String(raw == null ? '' : raw).replace(/[^+\d]/g, '');
}

function normalizeInviteId(raw) {
  const value = String(raw == null ? '' : raw).trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : '';
}

function readHeaderMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
	const key = String(h || '').trim();
	if (key) map[key] = i + 1;
  });
  return map;
}

function getCol(config, key) {
  return config.columns[key];
}

function ensureGuestListHeaders(sheet, headerMap) {
  const config = loadAppConfig();
	const required = [
	getCol(config, 'phoneWhatsapp'),
	getCol(config, 'rsvpFamilyName'),
	getCol(config, 'inviteId'),
	getCol(config, 'invitationStatus'),
	getCol(config, 'invitationSent'),
	getCol(config, 'invitationSentAt'),
	getCol(config, 'invitationUrl'),
	getCol(config, 'rsvpResponse'),
	getCol(config, 'rsvpNoOfPeople'),
	getCol(config, 'rsvpUpdatedAt')
  ];
  const missing = required.filter(h => !headerMap[h]);
  if (!missing.length) return;
  const start = sheet.getLastColumn() + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
}

function makeInviteId() {
  const bytes = Utilities.getUuid().replace(/-/g, '');
  return bytes.slice(0, 24);
}

function upsertGuestInviteRecord(workbook, rowNumber, baseUrl, familyName, phone, inviteId) {
	const config = loadAppConfig();
  const sheet = workbook.getSheetByName(config.tabs.guestList);
  if (!sheet) throw new Error('Guest List tab was not found.');

  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  let headerMap = readHeaderMap(headers);
  ensureGuestListHeaders(sheet, headerMap);

  const refreshedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  headerMap = readHeaderMap(refreshedHeaders);

  const url = new URL(baseUrl);
  url.searchParams.set('family', familyName);
  url.searchParams.set('phone', phone);
  url.searchParams.set('invite', inviteId);

  const updates = [
	[headerMap[getCol(config, 'rsvpFamilyName')], safeCellText(familyName)],
	[headerMap[getCol(config, 'phoneWhatsapp')], safeCellText(phone)],
	[headerMap[getCol(config, 'inviteId')], inviteId],
	[headerMap[getCol(config, 'invitationUrl')], url.toString()]
  ];

  updates.forEach(item => {
	const col = item[0];
	const value = item[1];
	if (col) sheet.getRange(rowNumber, col).setValue(value);
  });

  return url.toString();
}

function findGuestRowByInvite(workbook, inviteId, invitedPhone) {
	const config = loadAppConfig();
  const sheet = workbook.getSheetByName(config.tabs.guestList);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return null;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const headerMap = readHeaderMap(headers);
	const inviteCol = headerMap[getCol(config, 'inviteId')];
  const phoneCol = headerMap[getCol(config, 'phoneWhatsapp')];
  const familyCol = headerMap[getCol(config, 'rsvpFamilyName')];
  const rsvpCol = headerMap[getCol(config, 'rsvpResponse')];
  const guestsCol = headerMap[getCol(config, 'rsvpNoOfPeople')];
  const updatedCol = headerMap[getCol(config, 'rsvpUpdatedAt')];

  const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
	const row = rows[i];
	const rowInvite = normalizeInviteId(inviteCol ? row[inviteCol - 1] : '');
	const rowPhone = normalizePhone(phoneCol ? row[phoneCol - 1] : '');
	if ((inviteId && rowInvite && rowInvite === inviteId) || (invitedPhone && rowPhone && rowPhone === invitedPhone)) {
	  return {
		sheet,
		rowNumber: i + 2,
		headerMap,
		familyCol,
		rsvpCol,
		guestsCol,
		updatedCol
	  };
	}
  }
  return null;
}

function updateGuestRsvp(workbook, submission) {
  const match = findGuestRowByInvite(workbook, submission.inviteId, submission.invitedPhone);
  if (!match) return false;

  if (match.familyCol) {
	match.sheet.getRange(match.rowNumber, match.familyCol).setValue(safeCellText(submission.name));
  }
  if (match.rsvpCol) {
	match.sheet.getRange(match.rowNumber, match.rsvpCol).setValue(submission.attending ? 'Accepted' : 'Declined');
  }
  if (match.guestsCol) {
	match.sheet.getRange(match.rowNumber, match.guestsCol).setValue(submission.guests);
  }
  if (match.updatedCol) {
	match.sheet.getRange(match.rowNumber, match.updatedCol).setValue(new Date());
  }
  return true;
}

function validateInviteBaseUrl(urlText) {
  const value = String(urlText == null ? '' : urlText).trim();
  if (!value) throw new Error('Missing invitationBaseUrl parameter.');
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
	throw new Error('invitationBaseUrl must be an HTTP(S) URL without credentials.');
  }
  url.hash = '';
  return url.toString();
}

function sendInvitationMessage(phone, text, _inviteUrl) {
	const properties = PropertiesService.getScriptProperties();
  const token = String(properties.getProperty('WHATSAPP_API_TOKEN') || '').trim();
  const phoneNumberId = String(properties.getProperty('WHATSAPP_PHONE_NUMBER_ID') || '').trim();
  if (!token || !phoneNumberId) {
	throw new Error('WhatsApp API is not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Script Properties.');
  }
  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
  const to = normalizePhone(phone).replace(/^\+/, '');
  const response = UrlFetchApp.fetch(endpoint, {
	method: 'post',
	contentType: 'application/json',
	headers: { Authorization: `Bearer ${token}` },
	muteHttpExceptions: true,
	payload: JSON.stringify({
	  messaging_product: 'whatsapp',
	  recipient_type: 'individual',
	  to,
	  type: 'text',
	  text: {
		preview_url: true,
		body: text
	  }
	})
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
	throw new Error(`WhatsApp send failed (${code}): ${response.getContentText().slice(0, 300)}`);
  }
}

function isInvitationAlreadySent(statusValue, sentFlagValue) {
  const status = String(statusValue || '').trim().toLowerCase();
  const sentFlag = String(sentFlagValue || '').trim().toLowerCase();
  return status === 'sent' || sentFlag === 'yes' || sentFlag === 'true';
}

function buildInvitationMessage(family, inviteUrl) {
  return `Dear ${family},\n\nWe warmly invite you to celebrate our wedding.\n\nOpen your invitation and kindly RSVP here:\n${inviteUrl}`;
}

function processGuestInvitations(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
	throw new Error('Invalid invitation processing request.');
  }
  const invitationBaseUrl = validateInviteBaseUrl(body.invitationBaseUrl);
	const config = loadAppConfig();
  const workbook = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = workbook.getSheetByName(config.tabs.guestList);
  if (!sheet) throw new Error('Guest List tab was not found.');

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return { ok: true, processed: 0, skipped: 0 };

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const headerMap = readHeaderMap(headers);
	if (!headerMap[getCol(config, 'phoneWhatsapp')]) throw new Error(`Guest List is missing the ${getCol(config, 'phoneWhatsapp')} column.`);

  ensureGuestListHeaders(sheet, headerMap);
  const freshHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const freshMap = readHeaderMap(freshHeaders);

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  let processed = 0;
  let skipped = 0;
  const errors = [];

  rows.forEach((row, i) => {
	const rowNumber = i + 2;
	const phone = normalizePhone(row[freshMap[getCol(config, 'phoneWhatsapp')] - 1]);
	const currentStatus = row[freshMap[getCol(config, 'invitationStatus')] - 1];
	const sentFlag = row[freshMap[getCol(config, 'invitationSent')] - 1];
	if (!phone) {
	  skipped++;
	  return;
	}

	const familyRaw = String(row[freshMap[getCol(config, 'rsvpFamilyName')] - 1] || '').trim();
	const family = familyRaw || 'Guest Family';
	const existingInviteId = normalizeInviteId(row[freshMap[getCol(config, 'inviteId')] - 1]);
	const inviteId = existingInviteId || makeInviteId();
	const inviteUrl = upsertGuestInviteRecord(workbook, rowNumber, invitationBaseUrl, family, phone, inviteId);

	if (isInvitationAlreadySent(currentStatus, sentFlag)) {
	  skipped++;
	  return;
	}

	if (freshMap[getCol(config, 'invitationStatus')]) {
	  sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationStatus')]).setValue('Prepared');
	}

	const message = buildInvitationMessage(family, inviteUrl);
	try {
	  sendInvitationMessage(phone, message, inviteUrl);
	  sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationStatus')]).setValue('Sent');
	  if (freshMap[getCol(config, 'invitationSent')]) sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationSent')]).setValue('Yes');
	  sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationSentAt')]).setValue(new Date());
	  processed++;
	} catch (err) {
	  sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationStatus')]).setValue('Send failed');
	  if (freshMap[getCol(config, 'invitationSent')]) sheet.getRange(rowNumber, freshMap[getCol(config, 'invitationSent')]).setValue('No');
	  errors.push(`Row ${rowNumber}: ${err.message}`);
	}
  });

  return {
	ok: errors.length === 0,
	processed,
	skipped,
	errors
  };
}

function processInvitationsNow() {
  const invitationBaseUrl = String(PropertiesService.getScriptProperties().getProperty('INVITATION_BASE_URL') || '').trim();
  if (!invitationBaseUrl) {
	throw new Error('Set INVITATION_BASE_URL in Script Properties before running processInvitationsNow.');
  }
  return processGuestInvitations({ invitationBaseUrl });
}

function processInvitationsScheduled() {
  try {
	return processInvitationsNow();
  } catch (err) {
	console.error('Scheduled invitation send failed: ' + err.message);
	return { ok: false, error: err.message };
  }
}

function installInvitationScheduler() {
  ScriptApp.getProjectTriggers()
	.filter(trigger => trigger.getHandlerFunction() === INVITATION_TRIGGER_HANDLER)
	.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(INVITATION_TRIGGER_HANDLER)
	.timeBased()
	.everyMinutes(15)
	.create();

  return { ok: true, message: 'Invitation scheduler installed (every 15 minutes).' };
}

function removeInvitationScheduler() {
  ScriptApp.getProjectTriggers()
	.filter(trigger => trigger.getHandlerFunction() === INVITATION_TRIGGER_HANDLER)
	.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  return { ok: true, message: 'Invitation scheduler removed.' };
}

function onOpen() {
  SpreadsheetApp.getUi()
	.createMenu('Wedding Invitations')
	.addItem('Send pending invitations', 'processInvitationsNow')
	.addItem('Check system health', 'showInvitationSystemHealth')
	.addSeparator()
	.addItem('Enable auto-send (every 15 min)', 'installInvitationScheduler')
	.addItem('Disable auto-send', 'removeInvitationScheduler')
	.addToUi();
}

function showInvitationSystemHealth() {
  const health = checkInvitationSystemHealth();
  SpreadsheetApp.getUi().alert('Invitation System Health', JSON.stringify(health, null, 2), SpreadsheetApp.getUi().ButtonSet.OK);
}

// Spreadsheet cells must treat untrusted guest names as text, never formulas.
function safeCellText(value) {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value;
}

function doPost(e) {
	let body;
  let submission;
  try {
	const raw = e && e.postData && e.postData.contents;
	if (!raw || raw.length > 4096) return jsonResponse({ ok: false, error: 'Invalid submission size.' });
	try {
	  body = JSON.parse(raw);
	} catch (_) {
	  return jsonResponse({ ok: false, error: 'Invalid submission format.' });
	}
	if (body && body.action === 'processInvitations') {
	  const result = processGuestInvitations(body);
	  return jsonResponse(result);
	}
	submission = validateSubmission(body);
  } catch (err) {
	return jsonResponse({ ok: false, error: err.message });
  }

  const lock = LockService.getScriptLock();
  let locked = false;
  try {
	lock.waitLock(10000);
	locked = true;
	const config = loadAppConfig();
	const workbook = SpreadsheetApp.openById(config.spreadsheetId);
	const sheet = workbook.getSheets().find(item => item.getSheetId() === config.rsvpSheetId);
	if (!sheet) throw new Error('The configured RSVP tab was not found.');

	const properties = PropertiesService.getScriptProperties();
	const deadlineText = String(properties.getProperty('RSVP_DEADLINE') || '').trim();
	if (deadlineText) {
	  const deadlineDate = new Date(deadlineText);
	  if (!isNaN(deadlineDate.getTime()) && new Date().getTime() > deadlineDate.getTime()) {
		throw new Error('The RSVP deadline has passed. Please contact the couple directly.');
	  }
	}

	const lastRow = sheet.getLastRow();
	if (lastRow === 0) {
	  sheet.getRange(1, 1, 1, config.rsvpHeaders.length).setValues([config.rsvpHeaders]);
	} else {
	  const headers = sheet.getRange(1, 1, 1, config.rsvpHeaders.length).getDisplayValues()[0];
	  if (!config.rsvpHeaders.every((header, i) => headers[i] === header)) {
		// Refuse to overwrite or append into an unknown existing sheet layout.
		throw new Error('The RSVP tab headers do not match the documented schema.');
	  }
	}

	// Retrying after a lost network response must not append a duplicate RSVP.
	if (lastRow > 1) {
	  const duplicate = sheet.getRange(2, 6, lastRow - 1, 1)
		.createTextFinder(submission.requestId).matchEntireCell(true).findNext();
	  if (duplicate) return jsonResponse({ ok: true });
	}
	updateGuestRsvp(workbook, submission);
	sheet.appendRow([
	  new Date(),
	  safeCellText(submission.name),
	  safeCellText(submission.invitedPhone || ''),
	  submission.attending ? 'Yes' : 'No',
	  submission.guests,
	  submission.requestId,
	  submission.inviteId || '',
	  new Date()
	]);
	SpreadsheetApp.flush();
	return jsonResponse({ ok: true });
  } catch (err) {
	console.error('RSVP storage error: ' + err.message);
	return jsonResponse({ ok: false, error: 'Unable to save your RSVP. Please try again later or contact the couple.' });
  } finally {
	if (locked) lock.releaseLock();
  }
}

function doGet() {
	return jsonResponse({ ok: true, service: 'Wedding RSVP', method: 'POST', actions: ['RSVP', 'processInvitations'] });
}
