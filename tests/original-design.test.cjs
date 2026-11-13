const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/js/original-design.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source + '\n//# sourceURL=original-design.js').toString('base64'));

function scratchHarness(t, { reduced = true, hasContext = true } = {}) {
    const previous = {};
    const frames = new Map();
    const handlers = new Map();
    const captures = new Set();
    const classes = new Set();
    let sequence = 0;
    let bounds = { left: 40, top: 20, width: 400, height: 400 };
    let observer;
    let reveals = 0;
    let animation;
    let session;
    function makeCanvas() {
        const context = {
            draws: [], transforms: [],
            drawImage(...args) { this.draws.push(args); },
            setTransform(...args) { this.transforms.push(args); },
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
            fillRect() {},
            getImageData() { throw new Error('Scratch must not read back the canvas'); }
        };
        return { width: 0, height: 0, context, getContext: () => context };
    }
    const canvas = makeCanvas();
    if (!hasContext) canvas.getContext = () => null;
    const surface = {
        querySelector: () => canvas,
        get clientWidth() { return bounds.width; },
        get clientHeight() { return bounds.height; },
        getBoundingClientRect: () => bounds,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        setPointerCapture: id => captures.add(id),
        hasPointerCapture: id => captures.has(id),
        releasePointerCapture: id => captures.delete(id),
        addEventListener(name, handler, { signal }) {
            handlers.set(name, handler);
            signal.addEventListener('abort', () => handlers.delete(name), { once: true });
        },
        animate(keyframes, options) {
            let resolve, reject;
            const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
            animation = { keyframes, options, finished, resolve, cancel: () => reject(new Error('Cancelled')) };
            return animation;
        }
    };
    const globals = {
        window: { devicePixelRatio: 3, matchMedia: () => ({ matches: reduced }) },
        document: { createElement: () => makeCanvas() },
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; observer = this; }
            observe() {}
            disconnect() { this.disconnected = true; }
        }
    };
    for (const [key, value] of Object.entries(globals)) {
        previous[key] = global[key];
        global[key] = value;
    }
    t.after(() => {
        session?.dispose();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    });
    function pointer(type, x, y, extra = {}) {
        handlers.get(type)?.({ type, pointerId: 1, button: 0, clientX: bounds.left + x, clientY: bounds.top + y, ...extra });
    }
    return {
        canvas, surface, frames, classes, captures, pointer,
        attach(helpers) { session = helpers.attachScratch(surface, this.receiver); return session; },
        receiver: { async invokeMethodAsync(method) { assert.equal(method, 'RevealAsync'); reveals++; } },
        get reveals() { return reveals; },
        get animation() { return animation; },
        get observer() { return observer; },
        frame() {
            const batch = [...frames.values()];
            frames.clear();
            batch.forEach(callback => callback());
        },
        resize(width, height) { bounds = { ...bounds, width, height }; observer.callback(); },
        key(key) {
            let prevented = false;
            handlers.get('keydown')?.({ key, preventDefault() { prevented = true; } });
            return prevented;
        },
        stroke(y) {
            pointer('pointerdown', 5, y);
            pointer('pointermove', bounds.width - 5, y);
            pointer('pointerup', bounds.width - 5, y);
        }
    };
}

test('scratch batches coalesced samples and interpolates a high-DPI soft brush', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    h.attach(helpers);
    assert.equal(h.canvas.width, 800);
    assert.equal(h.canvas.height, 800);
    assert.deepEqual(h.canvas.context.transforms[0], [2, 0, 0, 2, 0, 0]);
    h.pointer('pointerdown', 20, 100);
    h.pointer('pointermove', 180, 100, {
        getCoalescedEvents: () => [{ clientX: 120, clientY: 120 }, { clientX: 220, clientY: 120 }]
    });
    assert.equal(h.frames.size, 1);
    assert.equal(h.canvas.context.draws.length, 0);
    h.frame();
    assert.ok(h.canvas.context.draws.length > 20);
    assert.equal(h.reveals, 0);
});

test('separate gestures and cancelled pointers never join with a diagonal stroke', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    h.attach(helpers);
    h.pointer('pointerdown', 10, 10);
    h.pointer('pointercancel', 10, 10);
    const firstStroke = h.canvas.context.draws.length;
    h.pointer('pointerdown', 390, 390);
    h.pointer('pointerup', 390, 390);
    assert.ok(h.canvas.context.draws.length - firstStroke <= 4);
    assert.equal(h.captures.size, 0);
    assert.equal(h.frames.size, 0);
    assert.equal(h.reveals, 0);
});

test('scratching the same strip repeatedly does not inflate revealed coverage', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    h.attach(helpers);
    for (let i = 0; i < 12; i++) h.stroke(50);
    assert.equal(h.reveals, 0);
    for (let y = 110; y < 390; y += 60) h.stroke(y);
    assert.equal(h.reveals, 1);
    h.key('Enter');
    assert.equal(h.reveals, 1);
});

test('resize preserves the canvas and progress, including temporarily hidden cards', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    h.attach(helpers);
    h.stroke(50);
    h.stroke(120);
    h.resize(0, 0);
    assert.equal(h.canvas.width, 800);
    const before = h.canvas.context.draws.length;
    h.resize(800, 800);
    assert.equal(h.canvas.width, 1600);
    assert.equal(h.canvas.context.draws.length, before + 1);
    assert.deepEqual(h.canvas.context.draws.at(-1).slice(1), [0, 0, 800, 800]);
    h.stroke(420);
    h.stroke(560);
    assert.equal(h.reveals, 1);
});

test('keyboard reveal honors reduced motion and fires once', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    h.attach(helpers);
    assert.equal(h.key('ArrowDown'), false);
    assert.equal(h.key(' '), true);
    assert.equal(h.key('Enter'), true);
    assert.equal(h.reveals, 1);
    assert.equal(h.animation, undefined);
});

test('normal reveal fades the foil before opening the date', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t, { reduced: false });
    h.attach(helpers);
    h.key('Enter');
    assert.equal(h.reveals, 0);
    assert.equal(h.animation.options.duration, 420);
    assert.ok(h.classes.has('is-revealing'));
    h.animation.resolve();
    await new Promise(setImmediate);
    assert.equal(h.reveals, 1);
});

test('disposing a drawing session cancels frames, capture, and listeners', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t);
    const session = h.attach(helpers);
    h.pointer('pointerdown', 50, 50);
    assert.equal(h.frames.size, 1);
    session.dispose();
    h.frame();
    h.key('Enter');
    assert.equal(h.frames.size, 0);
    assert.equal(h.captures.size, 0);
    assert.equal(h.canvas.context.draws.length, 0);
    assert.equal(h.reveals, 0);
    assert.equal(h.observer.disconnected, true);
});

test('disposing during a reveal fade does not call a removed component', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t, { reduced: false });
    const session = h.attach(helpers);
    h.key('Enter');
    session.dispose();
    await new Promise(setImmediate);
    assert.equal(h.reveals, 0);
});

test('a browser without canvas can still reveal the date', async t => {
    const helpers = await modulePromise;
    const h = scratchHarness(t, { hasContext: false });
    h.attach(helpers);
    h.pointer('pointerdown', 50, 50);
    assert.equal(h.reveals, 1);
});

test('date presentation splits local date and time without repeating the full date', async () => {
    const helpers = await modulePromise;
    const date = new Date('2027-08-28T10:00:00+01:00');
    const parts = helpers.localDateParts(date.toISOString());
    assert.equal(parts.length, 4);
    assert.equal(parts[1], new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(date));
    assert.equal(parts[3], new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date));
});

test('page navigation focuses its heading and scrolls without changing the private link', async t => {
    const helpers = await modulePromise;
    const previous = { document: global.document, window: global.window };
    const calls = [];
    const href = 'https://example.com/#invite=' + 'a'.repeat(32);
    global.document = {
        getElementById(id) {
            assert.equal(id, 'details-title');
            return { focus: options => calls.push(['focus', options]) };
        }
    };
    global.window = { location: { href }, scrollTo: options => calls.push(['scroll', options]) };
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    });
    helpers.focusPage('details-title');
    assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { top: 0, left: 0, behavior: 'instant' }]]);
    assert.equal(window.location.href, href);
});

test('invitation viewer opens once, resets scroll and closes safely', async () => {
    const helpers = await modulePromise;
    let opened = 0, closed = 0;
    const scrolls = [];
    const dialog = {
        open: false,
        showModal() { this.open = true; opened++; },
        close() { this.open = false; closed++; },
        querySelector(selector) {
            assert.equal(selector, '.viewer-scroll');
            return { scrollTo: options => scrolls.push(options) };
        }
    };
    helpers.showDialog(dialog);
    helpers.showDialog(dialog);
    assert.equal(opened, 1);
    assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: 'instant' }]);
    helpers.resetViewerScroll(dialog);
    assert.equal(scrolls.length, 2);
    helpers.closeDialog(dialog);
    helpers.closeDialog(dialog);
    assert.equal(closed, 1);
    helpers.showDialog(dialog);
    assert.equal(opened, 2);
    assert.equal(scrolls.length, 3);
});

test('viewer helpers tolerate a missing dialog or scroll container', async () => {
    const helpers = await modulePromise;
    assert.doesNotThrow(() => helpers.showDialog(null));
    assert.doesNotThrow(() => helpers.closeDialog(null));
    assert.doesNotThrow(() => helpers.resetViewerScroll(null));
    assert.doesNotThrow(() => helpers.resetViewerScroll({ querySelector: () => null }));
});

test('page focus safely ignores a missing heading', async t => {
    const helpers = await modulePromise;
    const previous = global.document;
    global.document = { getElementById: () => null };
    t.after(() => {
        if (previous === undefined) delete global.document;
        else global.document = previous;
    });
    assert.doesNotThrow(() => helpers.focusPage('missing'));
});

test('venue directions use the complete confirmed destination rather than a broad search', () => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/config.json'), 'utf8'));
    const url = new URL(config.wedding.mapUrl);
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), `${config.wedding.venueName}, ${config.wedding.address}, UK`);
    assert.equal(url.searchParams.has('origin'), false);
    assert.equal(url.searchParams.has('travelmode'), false);
});

test('illustrations animate on entering the viewport and disconnect on disposal', async t => {
    const helpers = await modulePromise;
    const previous = global.IntersectionObserver;
    const art = { matches: () => false, setAttribute(name, value) { this[name] = value; } };
    let observer;
    global.IntersectionObserver = class {
        constructor(callback, options) { this.callback = callback; this.options = options; observer = this; }
        observe(target) { assert.equal(target, art); }
        disconnect() { this.disconnected = true; }
    };
    t.after(() => {
        if (previous === undefined) delete global.IntersectionObserver;
        else global.IntersectionObserver = previous;
    });
    const session = helpers.observeIllustrations({ querySelectorAll(selector) {
        assert.equal(selector, '.gold-illustration, .programme-screen .event');
        return [art];
    } });
    assert.equal(art['data-in-view'], 'false');
    assert.deepEqual(observer.options.threshold, [0, .25]);
    observer.callback([{ target: art, isIntersecting: true, intersectionRatio: .5 }]);
    assert.equal(art['data-in-view'], 'true');
    observer.callback([{ target: art, isIntersecting: true, intersectionRatio: .1 }]);
    assert.equal(art['data-in-view'], 'false');
    observer.callback([{ target: art, isIntersecting: false, intersectionRatio: 0 }]);
    assert.equal(art['data-in-view'], 'false');
    session.dispose();
    assert.equal(observer.disconnected, true);
});

test('illustrations remain usable without IntersectionObserver', async t => {
    const helpers = await modulePromise;
    const previous = global.IntersectionObserver;
    delete global.IntersectionObserver;
    t.after(() => { if (previous !== undefined) global.IntersectionObserver = previous; });
    const art = { setAttribute() { throw new Error('Fallback must not hide animation'); } };
    assert.doesNotThrow(() => helpers.observeIllustrations({ querySelectorAll: () => [art] }).dispose());
});

test('programme rows reveal on first intersection and never hide again', async t => {
    const helpers = await modulePromise;
    const previous = global.IntersectionObserver;
    const row = {
        matches(selector) { assert.equal(selector, '.programme-screen .event'); return true; },
        setAttribute(name, value) { this[name] = value; }
    };
    let observer;
    const removed = [];
    global.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; observer = this; }
        observe(target) { assert.equal(target, row); }
        unobserve(target) { removed.push(target); }
        disconnect() { this.disconnected = true; }
    };
    t.after(() => {
        if (previous === undefined) delete global.IntersectionObserver;
        else global.IntersectionObserver = previous;
    });
    const session = helpers.observeIllustrations({ querySelectorAll: () => [row] });
    assert.equal(row['data-in-view'], 'false');
    observer.callback([{ target: row, isIntersecting: false, intersectionRatio: 0 }]);
    assert.equal(row['data-in-view'], 'false');
    assert.equal(removed.length, 0);
    // A tall row must reveal even when only a small part fits in the viewport.
    observer.callback([{ target: row, isIntersecting: true, intersectionRatio: .01 }]);
    assert.equal(row['data-in-view'], 'true');
    assert.deepEqual(removed, [row]);
    // Ignore any queued exit notification after unobserving the revealed row.
    observer.callback([{ target: row, isIntersecting: false, intersectionRatio: 0 }]);
    assert.equal(row['data-in-view'], 'true');
    assert.equal(removed.length, 1);
    session.dispose();
    assert.equal(observer.disconnected, true);
});

test('photo time stays in the existing celebrations event at its original time', () => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation/wwwroot/config.json'), 'utf8'));
    const celebration = config.programme.filter(item => /celebrations/i.test(item.title));
    assert.equal(config.programme.length, 5);
    assert.equal(celebration.length, 1);
    assert.match(celebration[0].title, /photo time/i);
    assert.match(celebration[0].description, /photo time.*dancing/i);
    assert.equal(celebration[0].start, '2027-08-28T15:00:00+01:00');
});
