const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/js/invitation.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('invitation ID is read from fragment; malformed IDs are rejected', async () => {
    const helpers = await modulePromise;
    const id = 'a'.repeat(32);
    global.window = { location: { href: 'https://example.com/#invite=' + id } };
    assert.equal(helpers.getInvitationId(), id);
    window.location.href = 'https://example.com/?invite=' + id;
    assert.equal(helpers.getInvitationId(), id);
    window.location.href = 'https://example.com/#invite=not-valid';
    assert.equal(helpers.getInvitationId(), '');
    window.location.href = 'https://example.com/';
    assert.equal(helpers.getInvitationId(), '');
});
test('date formatting includes the visitor timezone', async () => {
    const helpers = await modulePromise;
    const result = helpers.formatLocalDate('2027-08-28T10:00:00+01:00');
    assert.ok(result.includes('2027'));
    assert.ok(result.includes(Intl.DateTimeFormat().resolvedOptions().timeZone));
});
test('music plays and pauses through gesture handlers without a public toggle export', async () => {
    const helpers = await modulePromise;
    const previous = { document: global.document, Audio: global.Audio, Element: global.Element };
    const handlers = {};
    let audio;
    global.document = {
        querySelectorAll: () => [],
        addEventListener: (name, handler) => { handlers[name] = handler; }
    };
    global.Element = class {
        constructor(selector) { this.selector = selector; }
        closest(selector) { return this.selector === selector; }
    };
    global.Audio = class {
        constructor() { this.paused = true; audio = this; }
        addEventListener() {}
        async play() { this.paused = false; }
        pause() { this.paused = true; }
    };
    try {
        assert.equal('toggleMusic' in helpers, false);
        helpers.prepareMusic('assets/music.mp3', 0.35);
        handlers.click({ target: new Element('[data-open-invitation]') });
        await new Promise(setImmediate);
        assert.equal(audio.paused, false);
        handlers.click({ target: new Element('[data-music-toggle]') });
        assert.equal(audio.paused, true);
        handlers.click({ target: new Element('[data-music-toggle]') });
        await new Promise(setImmediate);
        assert.equal(audio.paused, false);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    }
});

test('one calendar action downloads the supplied ICS and releases its temporary URL', async t => {
    const helpers = await modulePromise;
    const previousDocument = global.document;
    const calls = [];
    let blob, cleanup;
    const anchor = {
        click() { calls.push('click'); },
        remove() { calls.push('remove'); }
    };
    global.document = {
        createElement(tag) { assert.equal(tag, 'a'); return anchor; },
        body: { append(element) { assert.equal(element, anchor); calls.push('append'); } }
    };
    t.after(() => {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
    });
    t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:wedding-event'; });
    const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
    t.mock.method(global, 'setTimeout', callback => { cleanup = callback; });
    const content = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    helpers.downloadCalendar('our-wedding.ics', content);
    assert.equal(blob.type, 'text/calendar;charset=utf-8');
    assert.equal(await blob.text(), content);
    assert.equal(anchor.href, 'blob:wedding-event');
    assert.equal(anchor.download, 'our-wedding.ics');
    assert.deepEqual(calls, ['append', 'click', 'remove']);
    assert.equal(revoke.mock.callCount(), 0);
    cleanup();
    assert.equal(revoke.mock.callCount(), 1);
    assert.deepEqual(revoke.mock.calls[0].arguments, ['blob:wedding-event']);
});
