const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = ['Code.gs', 'ImportGuestTracker.gs', 'ConvertGuestTracker.gs'].map(name => fs.readFileSync(path.join(__dirname, '../google-apps-script/v2', name), 'utf8')).join('\n');
const clone = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
    const calls = [];
    const props = new Map([['SOURCE_SPREADSHEET_ID', 'source'], ['SOURCE_SHEET_ID', '42'], ...Object.entries(options.properties || {})]);
    const initial = [['Family side', 'Relationship type', 'RSVP Family Name', 'Epected attendance', 'Invite ID', 'RSVP Response'], ['Bride', 'Relative', 'Example Family', options.blank ? '' : '2', options.issued || '', options.response || '']];
    const context = vm.createContext({ console: { log() {} } });
    vm.runInContext(code + '\nglobalThis.api = { previewGuestTrackerConversion, convertExistingGuestTracker };', context);
    const tabs = [];
    let nextId = 100;
    const range = () => {
        const obj = {};
        ['setBackground','setFontColor','setFontWeight','setWrap','setVerticalAlignment','createFilter','setDataValidation','setNumberFormat','setFontSize','merge','setValue'].forEach(method => obj[method] = () => obj);
        obj.setValues = () => obj;
        return obj;
    };
    function tab(name, id, values = []) {
        let data = clone(values), columns = 12, rows = 1000;
        const t = { getSheetId: () => id, getName: () => name, getMaxRows: () => rows, getMaxColumns: () => columns,
            getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map(row => row.length)),
            deleteColumns(_, n) { columns -= n; },
            hideSheet() { t.hidden = true; },
            getProtections: () => options.protected && id === 42 ? [{}] : [],
            setName(value) { name = value; return t; },
            getDataRange: () => ({ getValues: () => clone(data), getDisplayValues: () => clone(data), getFormulas: () => data.map(row => row.map(() => '')), breakApart: () => calls.push('unmerge') }),
            copyTo() { calls.push('backup'); if (options.backupFail) throw new Error('Copy failed'); const b = tab('Copy', nextId++, options.badBackup ? [] : data); tabs.push(b); return b; },
            getFilter: () => ({ remove: () => calls.push('remove-filter') }),
            clear() { calls.push('clear'); data = []; }, clearConditionalFormatRules() {},
            insertColumnsAfter(_, n) { columns += n; }, insertRowsAfter(_, n) { rows += n; },
            getRange(r, c, n, w) { const obj = range(); obj.setValues = values => {
                if (id === 42 && r === 2) { calls.push('write'); if (options.writeFail) throw new Error('Write failed'); }
                if (typeof r === 'number') values.forEach((row, i) => { data[r - 1 + i] = clone(row); });
                return obj;
            };
            obj.getDisplayValues = obj.getValues = () => data.slice(r - 1, r - 1 + (n || 1)).map(row => row.slice(c - 1, c - 1 + (w || 1)));
            obj.getValue = () => data[r - 1]?.[c - 1];
            obj.createTextFinder = text => ({ matchEntireCell: () => ({ findAll: () => data.slice(r - 1).flatMap((row, i) => row[c - 1] === text ? [{ getRow: () => r + i }] : []) }) });
            return obj; }
        };
        ['showRows','showColumns','hideColumns','setFrozenRows','setRowHeight','setColumnWidths','setColumnWidth','setRowHeights'].forEach(method => t[method] = () => t);
        return t;
    }
    const original = tab('Tracker', 42, initial); tabs.push(original);
    if (options.conflict) tabs.push(tab(options.conflict, 99));
    const workbook = { getId: () => 'source', getUrl: () => 'https://example.test/sheet', getSheets: () => tabs,
        getSheetByName: name => tabs.find(t => t.getName() === name), insertSheet(name) { calls.push('insert:' + name); const t = tab(name, nextId++); tabs.push(t); return t; } };
    context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => { calls.push('property:' + key); props.set(key, value); } }) };
    context.SpreadsheetApp = { ProtectionType: { SHEET: 'sheet', RANGE: 'range' }, openById: () => workbook, flush: () => calls.push('flush'), newDataValidation: () => {
        const builder = { requireValueInList: () => builder, setAllowInvalid: () => builder, requireNumberBetween: () => builder, build: () => ({}) }; return builder;
    } };
    context.LockService = { getScriptLock: () => ({ waitLock: () => calls.push('lock'), releaseLock: () => calls.push('release') }) };
    context.syncConfigurationFromWebsite = () => ({ maxAttending: 30 });
    context.Utilities = { getUuid: () => 'a'.repeat(32) };
    return { ...context.api, calls, props, tabs, original, initial };
}

test('conversion preview makes no workbook edits', () => {
    const h = harness();
    assert.equal(h.previewGuestTrackerConversion().households, 1);
    assert.deepEqual(h.calls, []);
});

test('conversion verifies backup before clearing, retains gid and binds backend last', () => {
    const h = harness({ blank: true });
    assert.equal(h.convertExistingGuestTracker(), 'https://example.test/sheet#gid=42');
    assert.equal(h.original.getSheetId(), 42);
    assert.equal(h.original.getName(), 'Guest List');
    assert.deepEqual(h.tabs.find(t => t.getName().startsWith('Guest backup')).getDataRange().getValues(), h.initial);
    assert(h.calls.indexOf('backup') < h.calls.indexOf('clear'));
    assert(h.calls.indexOf('flush') < h.calls.indexOf('clear'));
    assert(h.calls.indexOf('write') < h.calls.indexOf('property:SPREADSHEET_ID'));
    assert.equal(h.original.getDataRange().getValues()[1][7], '');
    assert.equal(h.original.getMaxColumns(), 9);
    assert(h.tabs.find(t => t.getName() === 'RSVP Technical').hidden);
    assert(h.tabs.some(t => t.getName() === 'RSVP'));
    assert(h.tabs.some(t => t.getName() === 'OUR WEDDING | RSVP DASHBOARD'));
    assert.equal(JSON.parse(h.props.get('TRACKER_CONVERSION')).state, 'completed');
    assert.equal(h.props.get('SPREADSHEET_ID'), 'source');
    assert.throws(() => h.convertExistingGuestTracker(), /Already configured/);
    assert.equal(h.calls.filter(x => x === 'backup').length, 1);
});

for (const [name, options, error] of [
    ['existing configuration', { properties: { SPREADSHEET_ID: 'other' } }, /Already configured/],
    ['unfinished conversion', { properties: { TRACKER_CONVERSION: '{}' } }, /Already configured/],
    ['tab conflict', { conflict: 'RSVP' }, /conflicts/],
    ['protected source', { protected: true }, /protections/],
    ['issued link', { issued: 'old-id' }, /issued invitation/],
    ['response data', { response: 'Accepted' }, /existing RSVP/]
]) test(name + ' prevents backup and source changes', () => {
    const h = harness(options);
    assert.throws(() => h.convertExistingGuestTracker(), error);
    assert.deepEqual(h.calls, ['lock', 'release']);
    assert.deepEqual(h.original.getDataRange().getValues(), h.initial);
});

test('backup failure never clears the source', () => {
    const h = harness({ backupFail: true });
    assert.throws(() => h.convertExistingGuestTracker(), /Copy failed/);
    assert(!h.calls.includes('clear'));
    assert.deepEqual(h.original.getDataRange().getValues(), h.initial);
});

test('backup verification failure leaves source unchanged and recovery record intact', () => {
    const h = harness({ badBackup: true });
    assert.throws(() => h.convertExistingGuestTracker(), /Backup verification failed/);
    assert(!h.calls.includes('clear'));
    assert(h.props.has('TRACKER_CONVERSION'));
    assert(!h.props.has('SPREADSHEET_ID'));
});

test('write failure retains backup and guard without configuring live backend', () => {
    const h = harness({ writeFail: true });
    assert.throws(() => h.convertExistingGuestTracker(), /Write failed/);
    assert.deepEqual(h.tabs.find(t => t.getName().startsWith('Guest backup')).getDataRange().getValues(), h.initial);
    assert.equal(JSON.parse(h.props.get('TRACKER_CONVERSION')).state, 'converting');
    assert(!h.props.has('SPREADSHEET_ID'));
    assert.equal(h.calls.at(-1), 'release');
});
