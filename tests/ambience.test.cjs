const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source contracts; visual appearance still needs desktop/mobile browser checks.
const read = file => fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation', file), 'utf8');
const page = read('Components/InvitationPage.razor');
const css = read('wwwroot/css/original-blazor.css');
const originalCss = read('wwwroot/css/original.css');

function rule(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
    assert.ok(match, `Missing rule: ${selector}`);
    return match[1];
}

test('intro, programme, details and RSVP share a single fixed background', () => {
    assert.equal((page.match(/class="backdrop"/g) || []).length, 1);
    assert.ok(page.indexOf('class="backdrop"') < page.indexOf('<main'));
    assert.match(rule(originalCss, '.backdrop'), /position:\s*fixed/);
    assert.match(rule(css, '.programme-screen'), /background:\s*transparent/);
    assert.match(rule(css, '.details-screen'), /background:\s*transparent/);
    assert.match(rule(css, '.original-rsvp-screen'), /background:\s*transparent/);
});

test('petal shower uses independent parameters and cannot intercept input', () => {
    assert.match(page, /i < 18/);
    assert.doesNotMatch(page + css, /--petal-index|petal:nth-child/);
    assert.match(rule(css, '.petals[data-petals-ready] .petal'), /animation:\s*petal-shower[^;]*infinite/);
    assert.match(rule(css, '.petals[data-petals-ready] .petal'), /animation-delay:\s*var\(--petal-delay\)/);
    assert.match(rule(originalCss, '.petals'), /pointer-events:\s*none/);
    assert.match(page, /class="petals[^\n]*aria-hidden="true"/);
    assert.doesNotMatch(page, /ShowPetals/);
    assert.doesNotMatch(page.match(/<div class="petals[^>]*>/)?.[0] ?? '', /\shidden=/);
});

test('flower control and its unused state are removed', () => {
    assert.doesNotMatch(page + css, /petal-toggle|_petalsPaused|is-paused/);
    assert.match(page, /class="petals" @ref="_petals"/);
});

test('reduced motion and printing suppress the shower', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(rule(reduced, '.petals'), /display:\s*none/);
    assert.match(reduced, /animation:\s*none\s*!important/);
    const print = css.slice(css.indexOf('@media print'));
    assert.match(print, /\.petals,[^{]*\{\s*display:\s*none\s*!important/);
});

test('opening page omits the family heading and keeps the opening action', () => {
    assert.doesNotMatch(page, /class="topline"|Together with our families/);
    assert.ok(page.indexOf('<OriginalEnvelope ') < page.indexOf('@if (_cardsVisible)'));
    assert.match(page, /OnOpen="OpenAsync"/);
});

test('envelope entrance starts immediately and yields to opening on tap', () => {
    assert.match(rule(css, '.stage .envelope'), /animation:\s*envelope-arrival 1\.4s var\(--ease-out\) both;/);
    assert.match(css, /@keyframes envelope-arrival/);
    assert.match(rule(css, '.stage.is-open .envelope'), /animation:\s*none/);
    const envelope = read('Components/OriginalEnvelope.razor');
    assert.match(envelope, /<button class="envelope" type="button"/);
    assert.match(envelope, /@onclick="OnOpen"/);
});

test('petals randomize independently, renew paths without changing clocks, and dispose', async t => {
    const { attachPetals } = await import('data:text/javascript;base64,' + Buffer.from(read('wwwroot/js/original-design.js')).toString('base64'));
    const previousRandom = Math.random;
    let seed = 12345;
    Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    t.after(() => { Math.random = previousRandom; });
    const petals = Array.from({ length: 18 }, () => {
        const petal = new EventTarget();
        petal.values = new Map();
        petal.style = { setProperty: (key, value) => petal.values.set(key, value) };
        return petal;
    });
    const attributes = new Map();
    const root = {
        querySelectorAll(selector) { assert.equal(selector, '.petal'); return petals; },
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name)
    };
    const session = attachPetals(root);
    assert.equal(attributes.get('data-petals-ready'), 'true');
    for (const petal of petals) {
        const number = name => parseFloat(petal.values.get('--petal-' + name));
        assert.ok(number('left') >= 2 && number('left') <= 98);
        assert.ok(number('duration') >= 11 && number('duration') <= 22);
        assert.ok(number('delay') <= 0 && number('delay') >= -number('duration') - .01);
        assert.ok(number('size') >= 7 && number('size') <= 14);
        assert.ok(number('drift') >= -85 && number('drift') <= 85);
    }
    for (const name of ['left', 'duration', 'delay', 'turn', 'drift']) {
        assert.ok(new Set(petals.map(p => p.values.get('--petal-' + name))).size > 15, name);
    }
    const [first, second] = petals;
    const before = new Map(first.values), other = new Map(second.values);
    const iteration = new Event('animationiteration');
    Object.defineProperty(iteration, 'animationName', { value: 'petal-shower' });
    first.dispatchEvent(iteration);
    assert.notEqual(first.values.get('--petal-left'), before.get('--petal-left'));
    assert.equal(first.values.get('--petal-duration'), before.get('--petal-duration'));
    assert.equal(first.values.get('--petal-delay'), before.get('--petal-delay'));
    assert.deepEqual(second.values, other);
    const renewed = new Map(first.values);
    first.dispatchEvent(new Event('animationiteration'));
    assert.deepEqual(first.values, renewed);
    session.dispose();
    session.dispose();
    assert.ok(!attributes.has('data-petals-ready'));
    first.dispatchEvent(iteration);
    assert.deepEqual(first.values, renewed);
    assert.match(page, /InvokeVoidAsync\("dispose"\)/);
});
