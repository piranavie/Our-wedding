const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../google-apps-script/v2/Code.gs'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/config.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
function harness(initial = {}) {
    const properties = new Map(Object.entries(initial));
    const writes = [], logs = [], fetches = [];
    const forbidden = () => { throw new Error('Unexpected workbook access'); };
    const context = vm.createContext({
        console: { log: text => logs.push(text) },
        PropertiesService: { getScriptProperties: () => ({
            getProperty: key => properties.has(key) ? properties.get(key) : null,
            setProperty: (key, value) => { writes.push(key); properties.set(key, value); }
        }) },
        SpreadsheetApp: { openById: forbidden, create: forbidden },
        UrlFetchApp: { fetch: url => {
            fetches.push(url);
            return { getResponseCode: () => 200, getContentText: () => JSON.stringify(config) };
        } }
    });
    vm.runInContext(source + '\nglobalThis.api = { diagnoseWeddingConfiguration, loadWeddingSettings, openWeddingWorkbook, checkWeddingSetup, syncConfigurationFromWebsite };', context);
    return { ...context.api, properties, writes, logs, fetches };
}

test('empty project diagnostics require no configuration and make no writes or network requests', () => {
    const h = harness();
    const report = clone(h.diagnoseWeddingConfiguration());
    assert(Object.values(report.propertyStatus).every(status => status === 'missing'));
    assert.equal(report.storedSettings, 'missing-or-empty');
    assert.equal(report.conversionState, 'missing-or-empty');
    assert.equal(report.siteUrlFormatValid, false);
    assert.equal(report.sourceSheetIdFormatValid, false);
    assert.equal(report.configuredWorkbookMatchesSource, null);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.fetches, []);
});

test('empty properties are distinguished from absent properties', () => {
    const report = harness({ APP_SETTINGS_JSON: '', TRACKER_CONVERSION: '' }).diagnoseWeddingConfiguration();
    assert.equal(report.propertyStatus.APP_SETTINGS_JSON, 'empty');
    assert.equal(report.propertyStatus.TRACKER_CONVERSION, 'empty');
    assert.equal(report.propertyStatus.SPREADSHEET_ID, 'missing');
});

for (const state of ['backup-created', 'converting', 'completed']) {
    test('diagnostics preserve and redact conversion state ' + state + ' without assuming workbook binding', () => {
        const initial = {
            SOURCE_SPREADSHEET_ID: 'private-source-id', SOURCE_SHEET_ID: '987654321',
            TRACKER_CONVERSION: JSON.stringify({ state, sourceId: 'private-source-id', backupSheetId: 123456789, originalName: 'private-tab-name' })
        };
        const h = harness(initial);
        const report = h.diagnoseWeddingConfiguration();
        assert.equal(report.conversionState, state);
        assert.equal(report.propertyStatus.SPREADSHEET_ID, 'missing');
        assert.equal(report.sourceSheetIdFormatValid, true);
        assert.equal(report.configuredWorkbookMatchesSource, null);
        assert.deepEqual(Object.fromEntries(h.properties), initial);
        assert.deepEqual(h.writes, []);
        assert.deepEqual(h.fetches, []);
        assert.doesNotMatch(h.logs.join('\n'), /private-source-id|987654321|123456789|private-tab-name/);
    });
}

test('malformed settings and conversion records produce redacted diagnostics rather than throwing', () => {
    for (const [value, settingsStatus, conversionStatus] of [
        ['{private-invalid-json', 'invalid-json', 'invalid-json'],
        ['null', 'invalid-deadline', 'unrecognized-record'],
        ['{}', 'invalid-deadline', 'unrecognized-record'],
        [JSON.stringify({ state: 'private-unknown-state' }), 'invalid-deadline', 'unrecognized-record']
    ]) {
        const h = harness({ APP_SETTINGS_JSON: value, TRACKER_CONVERSION: value });
        const report = h.diagnoseWeddingConfiguration();
        assert.equal(report.storedSettings, settingsStatus);
        assert.equal(report.conversionState, conversionStatus);
        assert.doesNotMatch(h.logs.join('\n'), /private-invalid-json|private-unknown-state/);
        assert.deepEqual(h.writes, []);
    }
});

test('diagnostics report settings and source equality without exposing values', () => {
    for (const id of ['private-source-id', 'private-other-id']) {
        const h = harness({
            SITE_URL: 'https://example.test/private-site/',
            APP_SETTINGS_JSON: JSON.stringify({ closesAt: '2027-08-08T23:00:00Z', coupleNames: 'private-names' }),
            SPREADSHEET_ID: id, SOURCE_SPREADSHEET_ID: 'private-source-id'
        });
        const report = h.diagnoseWeddingConfiguration();
        assert.equal(report.storedSettings, 'parseable-with-valid-deadline');
        assert.equal(report.siteUrlFormatValid, true);
        assert.equal(report.configuredWorkbookMatchesSource, id === 'private-source-id');
        assert.doesNotMatch(h.logs.join('\n'), /private-source-id|private-other-id|private-site|private-names/);
    }
});

test('missing settings fail before workbook inspection and do not recommend new setup', () => {
    const h = harness({ SPREADSHEET_ID: 'existing-workbook' });
    assert.throws(() => h.checkWeddingSetup(), error =>
        /APP_SETTINGS_JSON is missing or empty/.test(error.message) &&
        /Workbook\/conversion state has not been checked/.test(error.message) &&
        !/Run setupNewWeddingSpreadsheet first/.test(error.message));
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.fetches, []);
});

test('invalid stored settings have explicit configuration errors', () => {
    for (const value of ['{', 'null', '{}']) {
        assert.throws(() => harness({ APP_SETTINGS_JSON: value }).loadWeddingSettings(), /APP_SETTINGS_JSON.*invalid/);
    }
});

test('missing workbook binding has a separate diagnostic even with settings present', () => {
    const h = harness({ APP_SETTINGS_JSON: JSON.stringify({ closesAt: '2027-08-08T23:00:00Z' }) });
    assert.throws(() => h.checkWeddingSetup(), /SPREADSHEET_ID is missing or empty/);
    assert.deepEqual(h.writes, []);
});

test('configuration sync writes only the settings snapshot and never accesses sheets', () => {
    const initial = {
        SITE_URL: 'https://example.test/wedding/', SPREADSHEET_ID: 'existing-workbook',
        SOURCE_SPREADSHEET_ID: 'existing-workbook', SOURCE_SHEET_ID: '42',
        TRACKER_CONVERSION: JSON.stringify({ state: 'completed', backupSheetId: 123 })
    };
    const h = harness(initial);
    h.syncConfigurationFromWebsite();
    assert.deepEqual(h.writes, ['APP_SETTINGS_JSON']);
    for (const [key, value] of Object.entries(initial)) assert.equal(h.properties.get(key), value);
    assert.equal(h.fetches.length, 1);
    assert.match(h.fetches[0], /^https:\/\/example\.test\/wedding\/config\.json\?v=\d+$/);
    assert.equal(h.loadWeddingSettings().siteUrl, initial.SITE_URL);
});
