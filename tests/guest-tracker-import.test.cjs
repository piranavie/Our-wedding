const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = ['Code.gs', 'ImportGuestTracker.gs'].map(file => fs.readFileSync(path.join(__dirname, '../google-apps-script/v2', file), 'utf8')).join('\n');
const clone = value => JSON.parse(JSON.stringify(value));
const headers = ['Family side', 'Relationship type', 'RSVP Family Name', 'Phone / WhatsApp', 'Epected attendance', 'RSVP Response', 'RSVP No of People', 'RSVP Updated At', 'Invite ID', 'Invitation sent'];
function harness() {
    const context = vm.createContext({ console: { log() {} } });
    vm.runInContext(source + '\nglobalThis.api = { mapGuestTracker, previewGuestTrackerImport, createWeddingSpreadsheetFromTracker, G };', context);
    return { context, ...context.api };
}

test('tracker mapping preserves names, known counts and blank counts in exact v2 columns', () => {
    const { mapGuestTracker, G } = harness();
    const input = [['Tracker title'], headers,
        ['Groom', 'Relative', 'Family One', '', '4', '', '0'],
        ['Groom', '', ''],
        ['Bride', 'Relative', 'Family Two', '07123456789', '', '', '', '', 'legacy-id', 'Yes']];
    const before = clone(input);
    const result = mapGuestTracker(input, 30);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].length, 17);
    assert.equal(result.rows[0][G.expected], 4);
    assert.equal(result.rows[1][G.expected], '');
    assert.equal(result.rows[1][G.phone], '07123456789');
    assert.equal(result.rows[1][G.family], 'Family Two');
    assert.equal(result.rows[1][G.id], '');
    assert.equal(result.rows[1][G.url], '');
    assert.equal(result.rows[1][G.sent], 'Not sent');
    assert.equal(result.rows[1][G.status], 'Pending');
    assert.deepEqual(clone(result.summary.missingCountSourceRows), [5]);
    assert.deepEqual(clone(result.summary.phoneReviewSourceRows), [5]);
    assert.deepEqual(input, before);
});

test('the requested nine-column source with Family Name is accepted', () => {
    const { mapGuestTracker, G } = harness();
    const result = mapGuestTracker([
        ['Family side','Relationship type','Family Name','Invite ID','Invitation Status','Invitation URL','RSVP Response','Epected attendance','RSVP No of People'],
        ['Bride','Relative','Example','','Not sent','','Pending','',0]
    ], 30);
    assert.equal(result.rows[0][G.family], 'Example');
    assert.equal(result.rows[0][G.expected], '');
});

test('groom friend categories continue through blank cells and stop at bride section', () => {
    const { mapGuestTracker, G } = harness();
    const result = mapGuestTracker([headers,
        ['Groom', "Groom's friends", 'Friend One', '', '2'],
        ['', '', 'Friend Two', '', '1'],
        ['Bride', 'Relative', 'Family Three', '', '2']], 30);
    assert.equal(result.rows[1][G.side], 'Groom');
    assert.equal(result.rows[1][G.relationship], "Groom's friends");
    assert.equal(result.rows[2][G.relationship], 'Relative');
    assert.equal(result.summary.groomHouseholds, 2);
    assert.equal(result.summary.brideHouseholds, 1);
});

test('headers support reordered columns, whitespace and corrected expected spelling', () => {
    const { mapGuestTracker, G } = harness();
    const result = mapGuestTracker([[' RSVP Family Name ', 'EXPECTED ATTENDANCE', 'Relationship\n type', 'Family side'], ['Example', '2', 'Relative', 'bride']], 30);
    assert.equal(result.rows[0][G.expected], 2);
    assert.equal(result.rows[0][G.side], 'Bride');
});

test('invalid counts, missing sides, duplicate headers and existing responses fail safely', () => {
    const { mapGuestTracker } = harness();
    for (const count of ['0', '-1', '2.5', '31', 'unknown']) assert.throws(() => mapGuestTracker([headers, ['Bride', 'Relative', 'Example', '', count]], 30), /expected attendance/);
    assert.throws(() => mapGuestTracker([headers, ['', 'Relative', 'Example']], 30), /Family side/);
    assert.throws(() => mapGuestTracker([[...headers, 'Family side']], 30), /duplicate/);
    assert.throws(() => mapGuestTracker([headers], 30), /No named households/);
    for (const rest of [['Accepted', '2', ''], ['Declined', '0', ''], ['', '1', ''], ['', '', '2026-01-01']]) {
        assert.throws(() => mapGuestTracker([headers, ['Bride', 'Relative', 'Example', '', '2', ...rest]], 30), /existing RSVP response/);
    }
});

test('formula prefixes are escaped and duplicate display names are not merged', () => {
    const { mapGuestTracker, G } = harness();
    const row = ['Bride', '=1+1', '=Example', '+447700900000', '2'];
    const result = mapGuestTracker([headers, row, row], 30);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0][G.family], "'=Example");
    assert.equal(result.rows[0][G.relationship], "'=1+1");
    assert.equal(result.rows[0][G.phone], "'+447700900000");
});

function workflow(configured = false, failWrite = false) {
    const h = harness();
    const calls = [];
    const properties = new Map([['SOURCE_SPREADSHEET_ID', 'source'], ['SOURCE_SHEET_ID', '42']]);
    if (configured) properties.set('SPREADSHEET_ID', 'existing');
    h.context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties.get(key) }) };
    h.context.LockService = { getScriptLock: () => ({ waitLock: () => calls.push('lock'), releaseLock: () => calls.push('release') }) };
    h.context.SpreadsheetApp = {
        openById(id) { assert.equal(id, 'source'); calls.push('read'); return { getSheets: () => [{ getSheetId: () => 42, getDataRange: () => ({ getDisplayValues: () => [headers, ['Bride', 'Relative', 'Example', '', '2']] }) }] }; },
        flush: () => calls.push('flush')
    };
    h.context.syncConfigurationFromWebsite = () => ({ maxAttending: 30 });
    h.context.setupNewWeddingSpreadsheet = () => { calls.push('create'); properties.set('SPREADSHEET_ID', 'new'); return 'new-workbook-url'; };
    h.context.initializeHouseholds = (_, rows) => { if (failWrite) throw new Error('Write failed'); assert.equal(rows[0][3], 'Example'); calls.push('write'); };
    h.context.openWeddingWorkbook = () => ({ getSheetByName: name => {
        assert.equal(name, 'Guest List');
        return { getLastRow: () => 1, getMaxRows: () => 1000, getRange: (r, c, n, w) => {
            assert.deepEqual([r, c, n, w], [2, 1, 1, 17]);
            return { setValues: rows => { if (failWrite) throw new Error('Write failed'); assert.equal(rows[0][3], 'Example'); calls.push('write'); } };
        } };
    } });
    return { ...h, calls, properties };
}

test('preview only reads source and does not create a spreadsheet', () => {
    const h = workflow();
    assert.equal(h.previewGuestTrackerImport().households, 1);
    assert.deepEqual(h.calls, ['read']);
});

test('creation imports once to a new workbook, preserves configuration and releases lock', () => {
    const h = workflow();
    assert.equal(h.createWeddingSpreadsheetFromTracker(), 'new-workbook-url');
    assert.deepEqual(h.calls, ['lock', 'read', 'create', 'write', 'flush', 'release']);
    assert.throws(() => h.createWeddingSpreadsheetFromTracker(), /already configured/);
    assert.equal(h.calls.filter(x => x === 'create').length, 1);
});

test('existing configuration is rejected before reading or creating anything', () => {
    const h = workflow(true);
    assert.throws(() => h.createWeddingSpreadsheetFromTracker(), /already configured/);
    assert.deepEqual(h.calls, ['lock', 'release']);
});

test('write failures release the lock and retain the new workbook ID for manual recovery', () => {
    const h = workflow(false, true);
    assert.throws(() => h.createWeddingSpreadsheetFromTracker(), /Write failed/);
    assert.equal(h.properties.get('SPREADSHEET_ID'), 'new');
    assert.equal(h.calls.at(-1), 'release');
});
