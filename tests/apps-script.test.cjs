const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../google-apps-script/v2/Code.gs'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/config.json'), 'utf8'));
const context = vm.createContext({ console, Date, Set, JSON, Number, String, Error, Array, encodeURIComponent });
vm.runInContext(source + '\nglobalThis.api = { InvitationApplication, WeddingApiError, WEDDING_SCHEMA, G, settingsFromConfig, syncConfigurationFromWebsite, cellText, readCellText, invitationLink, whatsappLink, createDashboard, doPost, doGet, setupNewWeddingSpreadsheet };', context);
const api = context.api;
const { G } = api;
const id = 'a'.repeat(32);
const id2 = 'b'.repeat(32);
const requestId = 'c'.repeat(32);
const settings = api.settingsFromConfig(config, 'https://example.github.io/wedding/');
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

class MemoryRepository {
    constructor() {
        const values = new Array(api.WEDDING_SCHEMA.recordHeaders.length).fill('');
        Object.assign(values, { [G.id]: id, [G.side]: 'Groom', [G.family]: 'Sample Family', [G.contact]: 'Arun',
            [G.expected]: 4, [G.status]: 'Pending', [G.count]: 0, [G.sent]: 'No',
            [G.updated]: '2027-01-01T00:00:00.000Z', [G.members]: '[]', [G.phone]: '+447700900000' });
        this.records = new Map([[id, { number: 2, values }]]);
        this.audits = [];
        this.writes = 0;
        this.failAudit = false;
    }
    find(key) { return this.records.has(key) ? clone(this.records.get(key)) : null; }
    write(record) { this.records.set(record.values[G.id], clone(record)); this.writes++; }
    findAudit(key) { return this.audits.find(row => row[5] === key) || null; }
    appendAudit(record) {
        if (this.failAudit) { this.failAudit = false; throw new Error('Simulated audit failure'); }
        const r = record.values;
        this.audits.push([r[G.updated], r[G.family], r[G.phone], r[G.status] === 'Accepted' ? 'Yes' : 'No',
            r[G.count], r[G.requestId], r[G.id], r[G.updated], r[G.members], r[G.requestHash]]);
    }
}
function fixture(now = '2027-08-08T22:59:59.999Z') {
    const repository = new MemoryRepository();
    const app = new api.InvitationApplication(repository, settings, () => new Date(now), hash);
    return { repository, app };
}
function request(overrides = {}) {
    return { action: 'rsvp', invitationId: id, familyName: 'Updated Family', primaryContactName: 'Meena',
        status: 'Accepted', attendingCount: 2, members: ['Arun', 'Meena'], requestId,
        expectedVersion: '2027-01-01T00:00:00.000Z', ...overrides };
}
function code(expected) { return error => error.code === expected; }

test('UK end-of-day deadline maps to August 8 at 23:00 UTC', () => {
    assert.equal(settings.closesAt, '2027-08-08T23:00:00.000Z');
});
test('deadline without timezone offset is rejected', () => {
    const invalid = clone(config); invalid.rsvp.closesAt = '2027-08-08T23:59';
    assert.throws(() => api.settingsFromConfig(invalid, 'https://example.com/'), /timezone offset/);
});
const configurationCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'configuration-cases.json'), 'utf8'));
for (const scenario of configurationCases) {
    test('shared configuration: ' + scenario.name, () => {
        const candidate = clone(config);
        const segments = scenario.path.split('.');
        const target = segments.slice(0, -1).reduce((value, key) => value[key], candidate);
        target[segments.at(-1)] = scenario.value;
        if (scenario.valid) assert.doesNotThrow(() => api.settingsFromConfig(candidate, 'https://example.com/'));
        else assert.throws(() => api.settingsFromConfig(candidate, 'https://example.com/'), /timestamp|timezone offset|programme|precede/);
    });
}
test('configuration and sync enforce the same site URL rule', () => {
    const previousProperties = context.PropertiesService;
    const previousFetch = context.UrlFetchApp;
    let siteUrl;
    let fetches = 0;
    context.PropertiesService = { getScriptProperties: () => ({ getProperty: () => siteUrl, setProperty() {} }) };
    context.UrlFetchApp = { fetch: () => {
        fetches++;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(config) };
    } };
    try {
        for (siteUrl of ['', 'http://example.com/', 'https://example.com', 'https://user@example.com/',
            'https://example.com/?x=1', 'https://example.com/#invite=abc']) {
            assert.throws(() => api.settingsFromConfig(config, siteUrl), /SITE_URL/);
            assert.throws(() => api.syncConfigurationFromWebsite(), /SITE_URL/);
        }
        assert.equal(fetches, 0);
        for (siteUrl of ['https://example.com/', 'https://example.github.io/wedding/']) {
            assert.equal(api.settingsFromConfig(config, siteUrl).siteUrl, siteUrl);
            assert.equal(api.syncConfigurationFromWebsite().siteUrl, siteUrl);
        }
        assert.equal(fetches, 2);
    } finally {
        context.PropertiesService = previousProperties;
        context.UrlFetchApp = previousFetch;
    }
});
test('invitation and request IDs share the same strict hex format', () => {
    const { app } = fixture();
    for (const invalid of [null, undefined, 123, {}, [], 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'g'.repeat(32)]) {
        assert.throws(() => app.lookup(invalid), code('INVALID_INVITATION'));
        assert.throws(() => app.save(request({ requestId: invalid })), code('VALIDATION'));
    }
});
test('lookup returns only the requested household, without phone or side', () => {
    const { app } = fixture(); const result = app.lookup(id);
    assert.equal(result.household.familyName, 'Sample Family');
    assert.equal(result.household.status, 'Pending');
    assert.equal('phone' in result.household, false);
    assert.equal('side' in result.household, false);
    assert.equal(result.closed, false);
});
test('missing, malformed and unknown IDs never create guest records', () => {
    const { app, repository } = fixture();
    for (const invalid of ['', undefined, 'short', '../../Guest List']) assert.throws(() => app.lookup(invalid), code('INVALID_INVITATION'));
    assert.throws(() => app.lookup(id2), code('NOT_FOUND'));
    assert.throws(() => app.save(request({ invitationId: id2 })), code('NOT_FOUND'));
    assert.equal(repository.records.size, 1); assert.equal(repository.writes, 0);
});
test('accept updates family, contact, members and attending count on the same row', () => {
    const { app, repository } = fixture(); const result = app.save(request());
    assert.equal(result.ok, true); assert.equal(result.household.familyName, 'Updated Family');
    assert.equal(result.household.primaryContactName, 'Meena');
    assert.deepEqual(clone(result.household.members), ['Arun', 'Meena']);
    assert.equal(result.household.attendingCount, 2); assert.equal(repository.records.size, 1);
    assert.equal(repository.audits.length, 1);
    assert.equal(repository.find(id).values[G.expected], 4);
});
test('a household can change accepted to declined without duplicate households', () => {
    const { app, repository } = fixture(); const first = app.save(request());
    const result = app.save(request({ requestId: 'd'.repeat(32), expectedVersion: first.household.lastUpdated,
        status: 'Declined', attendingCount: 0 }));
    assert.equal(result.household.status, 'Declined'); assert.equal(result.household.attendingCount, 0);
    assert.equal(repository.records.size, 1); assert.equal(repository.audits.length, 2);
});
test('a declined household can accept again before cutoff', () => {
    const { app } = fixture(); const first = app.save(request({ status: 'Declined', attendingCount: 0 }));
    const next = app.save(request({ requestId: 'e'.repeat(32), expectedVersion: first.household.lastUpdated }));
    assert.equal(next.household.status, 'Accepted');
});
test('unchanged retries are idempotent', () => {
    const { app, repository } = fixture(); app.save(request()); app.save(request());
    assert.equal(repository.writes, 1); assert.equal(repository.audits.length, 1);
});
test('request ID reused with different payload is rejected', () => {
    const { app } = fixture(); app.save(request());
    assert.throws(() => app.save(request({ familyName: 'Changed' })), code('CONFLICT'));
});
test('stale versions are rejected instead of overwriting newer edits', () => {
    const { app, repository } = fixture(); app.save(request());
    assert.throws(() => app.save(request({ requestId: 'e'.repeat(32) })), code('CONFLICT'));
    assert.equal(repository.writes, 1);
});
test('retry of an older committed request does not revert a newer response', () => {
    const { app, repository } = fixture(); const first = app.save(request());
    app.save(request({ requestId: 'e'.repeat(32), expectedVersion: first.household.lastUpdated, familyName: 'Newest' }));
    assert.equal(app.save(request()).household.familyName, 'Newest'); assert.equal(repository.writes, 2);
});
test('audit failure is not reported as success and unchanged retry repairs it', () => {
    const { app, repository } = fixture(); repository.failAudit = true;
    assert.throws(() => app.save(request()), /audit failure/);
    const result = app.save(request());
    assert.equal(result.ok, true); assert.equal(repository.writes, 1); assert.equal(repository.audits.length, 1);
});
test('a newer request repairs a missing prior audit before saving', () => {
    const { app, repository } = fixture(); repository.failAudit = true;
    assert.throws(() => app.save(request()), /audit failure/);
    const current = app.lookup(id).household;
    app.save(request({ requestId: 'e'.repeat(32), familyName: 'Newest', expectedVersion: current.lastUpdated }));
    assert.equal(repository.audits.length, 2); assert.equal(repository.writes, 2);
});
test('exact deadline and later reject submissions with no writes', () => {
    for (const date of ['2027-08-08T23:00:00.000Z', '2027-08-09T12:00:00Z']) {
        const { app, repository } = fixture(date);
        assert.throws(() => app.save(request()), code('CLOSED'));
        assert.equal(app.lookup(id).closed, true); assert.equal(repository.writes, 0);
    }
});
test('invalid names, status, counts, members and versions are rejected', () => {
    for (const patch of [{ familyName: ' ' }, { familyName: 'x'.repeat(121) }, { familyName: 'bad\nname' },
        { primaryContactName: 'x'.repeat(121) }, { status: 'Pending' }, { attendingCount: 0 },
        { attendingCount: 31 }, { attendingCount: 1.5 }, { status: 'Declined', attendingCount: 1 },
        { members: [''] }, { members: ['a', 'b', 'c'] }, { members: [123] }, { members: 'a' },
        { requestId: 'bad' }, { expectedVersion: null }]) {
        const { app, repository } = fixture();
        assert.throws(() => app.save(request(patch)), code('VALIDATION'));
        assert.equal(repository.writes, 0);
    }
});
test('formula-like names are saved as text and returned without storage prefix', () => {
    const { app, repository } = fixture(); const result = app.save(request({ familyName: '=SUM(A1:A5)', primaryContactName: '@person' }));
    assert.equal(repository.find(id).values[G.family], "'=SUM(A1:A5)");
    assert.equal(result.household.familyName, '=SUM(A1:A5)');
    assert.equal(result.household.primaryContactName, '@person');
});
test('private link uses a fragment and no names or phone', () => {
    assert.equal(api.invitationLink(settings, id), 'https://example.github.io/wedding/#invite=' + id);
});
test('manual WhatsApp link encodes the corrected family and private link', () => {
    const url = new URL(api.whatsappLink(settings, 'A & B {url}', id, '+44 7700 900000'));
    assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/447700900000');
    assert.ok(url.searchParams.get('text').includes('Dear A & B {url}'));
    assert.ok(url.searchParams.get('text').includes('#invite=' + id));
});
test('blank phone supports manual recipient selection; bad phone is rejected', () => {
    assert.ok(api.whatsappLink(settings, 'Family', id, '').startsWith('https://wa.me/?text='));
    assert.throws(() => api.whatsappLink(settings, 'Family', id, 'abc'), /international number/);
});
test('dashboard generates all eight live formulas', () => {
    let metrics;
    const chain = new Proxy({}, { get: (_, key) => (...args) => { if (key === 'setValues') metrics = args[0]; return chain; } });
    const sheet = new Proxy({}, { get: () => () => chain });
    api.createDashboard(sheet);
    assert.equal(metrics.length, 8);
    assert.ok(metrics.every(row => row[1].startsWith('=')));
    assert.ok(metrics.find(row => row[0] === 'Total Attending People')[1].includes('Accepted'));
});
test('setup refuses to overwrite an already configured spreadsheet', () => {
    context.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'existing-id' }) };
    assert.throws(() => api.setupNewWeddingSpreadsheet(), /refuses to overwrite/);
});
test('public API rejects malformed, unsupported and automatic-send requests before storage access', () => {
    context.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) };
    for (const body of ['{', '[]', '{}', JSON.stringify({ action: 'processInvitations' }), 'x'.repeat(12001)]) {
        const response = JSON.parse(api.doPost({ postData: { contents: body } }).text);
        assert.equal(response.ok, false); assert.equal(response.code, 'VALIDATION');
    }
    assert.equal(JSON.parse(api.doGet().text).version, 2);
});
