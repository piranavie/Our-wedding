const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../google-apps-script/v2/Code.gs'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const id = 'a'.repeat(32), other = 'b'.repeat(32);
function fixture() {
    const context = vm.createContext({ console: { log() {} } });
    vm.runInContext(source + '\nglobalThis.api = { SheetRepository, InvitationApplication, WEDDING_SCHEMA, G, prepareInvitationLinks };', context);
    const { WEDDING_SCHEMA: schema, G } = context.api;
    const sheets = {};
    const faults = { projection: false, technical: false, audit: false };
    function sheet(name, headers) {
        const data = [clone(headers)];
        const tab = { data, getLastRow: () => data.length, getLastColumn: () => Math.max(...data.map(row => row.length)),
            appendRow(row) { if (faults.audit) { faults.audit = false; throw new Error('audit failed'); } data.push(clone(row)); },
            getRange(r, c, n = 1, w = 1) {
                const range = {
                    getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => data[r - 1 + i]?.[c - 1 + j] ?? '')),
                    getDisplayValues() { return this.getValues().map(row => row.map(String)); },
                    getValue: () => data[r - 1]?.[c - 1] ?? '',
                    setValue(value) { return this.setValues([[value]]); },
                    setValues(rows) {
                        if (name === schema.technical && faults.technical) { faults.technical = false; throw new Error('technical failed'); }
                        if (name === schema.guests && faults.projection && c === 7) { faults.projection = false; throw new Error('projection failed'); }
                        rows.forEach((row, i) => { data[r - 1 + i] ??= []; row.forEach((v, j) => data[r - 1 + i][c - 1 + j] = clone(v)); }); return range;
                    },
                    createTextFinder(text) {
                        const matches = () => data.slice(r - 1, r - 1 + n).flatMap((row, i) => row[c - 1] === text ? [{ getRow: () => r + i }] : []);
                        return { matchEntireCell: () => ({ findAll: matches, findNext: () => matches()[0] }) };
                    }
                }; return range;
            }
        };
        sheets[name] = tab; return tab;
    }
    const guests = sheet(schema.guests, schema.guestHeaders), tech = sheet(schema.technical, schema.technicalHeaders), audit = sheet(schema.audit, schema.auditHeaders);
    guests.data.push(['Bride', 'Relative', 'Example', id, 'Sent', 'https://example.test/#invite=' + id, 'Pending', 2, 0]);
    const record = Array(17).fill('');
    Object.assign(record, { [G.id]: id, [G.side]: 'Bride', [G.family]: 'Example', [G.expected]: 2, [G.status]: 'Pending', [G.count]: 0, [G.sent]: 'Sent', [G.updated]: '2027-01-01T00:00:00.000Z', [G.members]: '[]' });
    tech.data.push([id, JSON.stringify(record)]);
    const workbook = { getSheetByName: name => sheets[name] };
    context.SpreadsheetApp = { flush() {} };
    const repository = new context.api.SheetRepository(workbook);
    const settings = { closesAt: '2027-08-09T00:00:00Z', maxAttending: 30, maxMembers: 30, siteUrl: 'https://example.test/', coupleNames: 'Example', deadlineLabel: 'August 8', sharing: { whatsAppUrl: 'https://wa.me/', messageTemplate: '{family} {url}' } };
    const app = new context.api.InvitationApplication(repository, settings, () => new Date('2027-07-01T00:00:00Z'), value => createHash('sha256').update(value).digest('hex'));
    const request = { invitationId: id, familyName: 'Updated', primaryContactName: 'Contact', status: 'Accepted', attendingCount: 2, members: ['One', 'Two'], requestId: 'c'.repeat(32), expectedVersion: record[G.updated] };
    context.loadWeddingSettings = () => settings;
    context.openWeddingWorkbook = () => workbook;
    context.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
    context.Utilities = { getUuid: () => other };
    return { context, app, request, repository, guests, tech, audit, faults, G, schema };
}

test('Guest List headers exactly match the nine requested columns', () => {
    const f = fixture();
    assert.deepEqual(clone(f.schema.guestHeaders), ['Family side','Relationship type','Family Name','Invite ID','Invitation Status','Invitation URL','RSVP Response','Epected attendance','RSVP No of People']);
});

test('family-only requests preserve legacy names and allow a lower attending count', () => {
    const f = fixture();
    const saved = f.app.save(f.request);
    const request = { invitationId: id, familyName: 'Family Only', status: 'Accepted', attendingCount: 1,
        requestId: 'd'.repeat(32), expectedVersion: saved.household.lastUpdated };
    const result = f.app.save(request);
    assert.equal(result.household.familyName, 'Family Only');
    assert.equal(result.household.attendingCount, 1);
    assert.equal(result.household.primaryContactName, 'Contact');
    assert.deepEqual(clone(result.household.members), ['One', 'Two']);
    assert.equal(f.guests.data[1].length, 9);
    assert.equal(f.guests.data[1][4], 'Sent');
    f.app.save(request);
    assert.equal(f.audit.data.length, 3);
});

test('minimal request retries repair a partial projection and support declining', () => {
    const f = fixture();
    const { primaryContactName, members, ...minimal } = f.request;
    f.faults.projection = true;
    assert.throws(() => f.app.save(minimal), /projection failed/);
    const saved = f.app.save(minimal);
    assert.equal(saved.household.status, 'Accepted');
    f.app.save({ ...minimal, status: 'Declined', attendingCount: 0, requestId: 'e'.repeat(32), expectedVersion: saved.household.lastUpdated });
    assert.equal(f.guests.data[1][6], 'Declined');
    assert.equal(f.guests.data[1][8], 0);
});

test('old 17-column storage fails schema validation instead of misreading data', () => {
    const f = fixture();
    f.guests.data[0] = clone(f.schema.recordHeaders);
    assert.throws(() => new f.context.api.SheetRepository({ getSheetByName: name => ({ 'Guest List': f.guests, 'RSVP': f.audit, 'RSVP Technical': f.tech })[name] }), /Unexpected schema/);
});

test('decline updates RSVP only, and manual expected counts survive response repair', () => {
    const f = fixture();
    f.guests.data[1][7] = 5;
    f.guests.data[1][4] = 'Not sent';
    f.app.save({ ...f.request, status: 'Declined', attendingCount: 0 });
    assert.equal(f.guests.data[1][6], 'Declined');
    assert.equal(f.guests.data[1][8], 0);
    assert.equal(f.guests.data[1][4], 'Not sent');
    assert.equal(f.guests.data[1][7], 5);
});

test('save stores contact/members privately and preserves manual delivery/expected fields', () => {
    const f = fixture(); f.app.save(f.request);
    assert.deepEqual(f.guests.data[1], ['Bride','Relative','Updated',id,'Sent','https://example.test/#invite=' + id,'Accepted',2,2]);
    assert.equal(f.guests.data[1].length, 9);
    assert.equal(JSON.parse(f.tech.data[1][1])[f.G.contact], 'Contact');
    assert.deepEqual(clone(f.app.lookup(id).household.members), ['One','Two']);
});

test('sorting visible rows does not detach technical data from an invitation', () => {
    const f = fixture();
    f.guests.data.splice(1, 0, ['Groom','Friend','Other',other,'Not sent','','Pending',1,0]);
    assert.equal(f.app.lookup(id).household.familyName, 'Example');
    f.app.save(f.request);
    assert.equal(f.guests.data[1][2], 'Other');
    assert.equal(f.guests.data[2][2], 'Updated');
});

test('interrupted visible projection is repaired on retry without duplicate audit or sent changes', () => {
    const f = fixture(); f.faults.projection = true;
    assert.throws(() => f.app.save(f.request), /projection failed/);
    assert.equal(f.guests.data[1][6], 'Pending');
    assert.equal(f.app.save(f.request).household.status, 'Accepted');
    assert.equal(f.guests.data[1][6], 'Accepted');
    assert.equal(f.guests.data[1][4], 'Sent');
    f.app.save(f.request);
    assert.equal(f.audit.data.length, 2);
});

test('technical failure leaves visible response unchanged and can retry', () => {
    const f = fixture(); f.faults.technical = true;
    assert.throws(() => f.app.save(f.request), /technical failed/);
    assert.equal(f.guests.data[1][2], 'Example');
    assert.equal(f.app.save(f.request).household.status, 'Accepted');
});

test('audit failure repairs on retry and stale edits still conflict', () => {
    const f = fixture(); f.faults.audit = true;
    assert.throws(() => f.app.save(f.request), /audit failed/);
    f.app.save(f.request);
    assert.equal(f.audit.data.length, 2);
    assert.throws(() => f.app.save({ ...f.request, requestId: 'd'.repeat(32) }), error => error.code === 'CONFLICT');
});

test('missing/duplicate technical records fail safely; unprepared URLs cannot look up', () => {
    const f = fixture(); f.guests.data[1][5] = '';
    assert.throws(() => f.app.lookup(id), error => error.code === 'NOT_FOUND');
    f.guests.data[1][5] = 'prepared';
    f.tech.data.push(clone(f.tech.data[1]));
    assert.throws(() => f.app.lookup(id), /Duplicate technical/);
    f.tech.data.length = 1;
    assert.throws(() => f.app.lookup(id), /Missing technical/);
});

test('link preparation preserves sent status and committed replies', () => {
    const f = fixture(); f.app.save(f.request);
    f.context.api.prepareInvitationLinks();
    assert.equal(f.guests.data[1][4], 'Sent');
    assert.equal(f.guests.data[1][6], 'Accepted');
    assert.equal(f.guests.data[1][3], id);
    assert.equal(f.app.lookup(id).household.primaryContactName, 'Contact');
});

test('new manual rows prepare with hidden data and Not sent; invalid counts block preparation', () => {
    const f = fixture(); f.guests.data.push(['Groom','Friend','New','','','','Pending','',0]);
    assert.throws(() => f.context.api.prepareInvitationLinks(), /Count/);
    assert.equal(f.guests.data[2][3], '');
    f.guests.data[2][7] = 1;
    f.context.api.prepareInvitationLinks();
    assert.equal(f.guests.data[2][3], other);
    assert.equal(f.guests.data[2][4], 'Not sent');
    assert.equal(f.app.lookup(other).household.expectedFamilyCount, 1);
});
