/* Optional in-place conversion. Install with Code.gs and ImportGuestTracker.gs.
 * Run in a fresh owner-controlled project after stopping legacy writers/triggers.
 */
function inspectGuestTrackerConversion() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('SPREADSHEET_ID') || properties.getProperty('TRACKER_CONVERSION'))
	throw new Error('Already configured or conversion recorded. Inspect the existing workbook/backup; do not clear properties to retry.');
  const id = properties.getProperty('SOURCE_SPREADSHEET_ID');
  const gid = properties.getProperty('SOURCE_SHEET_ID');
  if (!id || !gid || !/^\d+$/.test(gid)) throw new Error('Set SOURCE_SPREADSHEET_ID and numeric SOURCE_SHEET_ID.');
  const workbook = SpreadsheetApp.openById(id);
  const sheet = workbook.getSheets().find(tab => tab.getSheetId() === Number(gid));
  if (!sheet) throw new Error('Source tab not found.');
	[WEDDING_SCHEMA.guests, WEDDING_SCHEMA.dashboard, WEDDING_SCHEMA.audit, WEDDING_SCHEMA.technical].forEach(name => {
	const existing = workbook.getSheetByName(name);
	if (existing && existing.getSheetId() !== sheet.getSheetId())
	  throw new Error('Existing tab conflicts with required name: ' + name + '. Nothing was changed.');
  });
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length || sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).length)
	throw new Error('Source tab contains protections. Review them before conversion; nothing was changed.');
  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
	const headerIndex = values.findIndex(row => row.some(value => ['rsvp family name', 'family name'].includes(normalize(value))));
  if (headerIndex < 0) throw new Error('Legacy guest headers not found; tab may already be converted.');
  const headers = values[headerIndex].map(normalize);
  values.slice(headerIndex + 1).forEach((row, index) => {
	headers.forEach((header, column) => {
	  const value = normalize(row[column]);
	  if ((['invite id', 'invitation id', 'invitation url', 'invitation sent at'].includes(header) && value) ||
		  (header === 'invitation sent' && value && !['no', 'false', 'not sent'].includes(value)) ||
		  (header === 'invitation status' && value && !['pending', 'not sent', 'draft'].includes(value)))
		throw new Error('Source row ' + (headerIndex + index + 2) + ': issued invitation or delivery data found. Plan a credential migration instead.');
	});
  });
  const settings = syncConfigurationFromWebsite();
  const result = mapGuestTracker(values, settings.maxAttending);
  const snapshot = JSON.stringify({ values: range.getValues(), formulas: range.getFormulas() });
  return { workbook, sheet, settings, result, snapshot };
}

function previewGuestTrackerConversion() {
  const inspection = inspectGuestTrackerConversion();
  console.log(JSON.stringify(inspection.result.summary));
  console.log('Preview only. The selected tab will be backed up, renamed Guest List and converted, retaining its gid.');
  return inspection.result.summary;
}

function convertExistingGuestTracker() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
	const { workbook, sheet, settings, result, snapshot } = inspectGuestTrackerConversion();
	const properties = PropertiesService.getScriptProperties();
	const backup = sheet.copyTo(workbook);
	const record = { state: 'backup-created', sourceId: workbook.getId(), sourceSheetId: sheet.getSheetId(),
	  originalName: sheet.getName(), backupSheetId: backup.getSheetId(), createdAt: new Date().toISOString() };
	properties.setProperty('TRACKER_CONVERSION', JSON.stringify(record));
	backup.setName('Guest backup ' + backup.getSheetId());
	SpreadsheetApp.flush();
	const fingerprint = tab => {
	  const range = tab.getDataRange();
	  return JSON.stringify({ values: range.getValues(), formulas: range.getFormulas() });
	};
	if (fingerprint(backup) !== snapshot || fingerprint(sheet) !== snapshot)
	  throw new Error('Backup verification failed or source changed. Source was not cleared. Inspect the backup and conversion record.');
	record.state = 'converting';
	properties.setProperty('TRACKER_CONVERSION', JSON.stringify(record));
	const filter = sheet.getFilter();
	if (filter) filter.remove();
	sheet.getDataRange().breakApart();
	sheet.clear();
	sheet.clearConditionalFormatRules();
	if (sheet.getMaxColumns() < WEDDING_SCHEMA.guestHeaders.length)
	  sheet.insertColumnsAfter(sheet.getMaxColumns(), WEDDING_SCHEMA.guestHeaders.length - sheet.getMaxColumns());
	if (sheet.getMaxRows() < result.rows.length + 1)
	  sheet.insertRowsAfter(sheet.getMaxRows(), result.rows.length + 1 - sheet.getMaxRows());
	sheet.showRows(1, sheet.getMaxRows());
	sheet.showColumns(1, sheet.getMaxColumns());
	sheet.setName(WEDDING_SCHEMA.guests);
	configureGuestSheet(sheet, settings);
	const audit = workbook.insertSheet(WEDDING_SCHEMA.audit);
	styleDataSheet(audit, WEDDING_SCHEMA.auditHeaders);
	createTechnicalSheet(workbook);
	initializeHouseholds(workbook, result.rows);
	const dashboard = workbook.insertSheet(WEDDING_SCHEMA.dashboard);
	createDashboard(dashboard);
	SpreadsheetApp.flush();
	record.state = 'completed';
	properties.setProperty('TRACKER_CONVERSION', JSON.stringify(record));
	properties.setProperty('SPREADSHEET_ID', workbook.getId());
	console.log(JSON.stringify(result.summary));
	console.log('Converted existing tab: ' + workbook.getUrl() + '#gid=' + sheet.getSheetId());
	console.log('Backup retained: ' + backup.getName() + '. Complete blank counts and review phones before prepareInvitationLinks(). Nothing sent.');
	return workbook.getUrl() + '#gid=' + sheet.getSheetId();
  } finally { lock.releaseLock(); }
}
