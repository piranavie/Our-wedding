// Presentation only. RSVP and configuration continue to use the Blazor/v2 services.
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function attachPetals(root) {
    const events = new AbortController();
    const between = (min, max) => min + Math.random() * (max - min);
    const scatter = petal => {
        const set = (name, value) => petal.style.setProperty(`--petal-${name}`, value);
        set('left', `${between(2, 98).toFixed(2)}%`);
        set('size', `${between(7, 14).toFixed(2)}px`);
        set('opacity', between(.25, .65).toFixed(2));
        set('drift', `${between(-85, 85).toFixed(2)}px`);
        set('sway', `${between(-35, 35).toFixed(2)}px`);
        set('turn', `${between(-180, 180).toFixed(2)}deg`);
        set('spin', `${between(-280, 280).toFixed(2)}deg`);
        set('flutter', between(.3, .8).toFixed(2));
        set('color', Math.random() < .25 ? '#e4c48a' : '#d88c99');
    };
    for (const petal of root.querySelectorAll('.petal')) {
        scatter(petal);
        const duration = between(11, 22);
        petal.style.setProperty('--petal-duration', `${duration.toFixed(2)}s`);
        petal.style.setProperty('--petal-delay', `${(-Math.random() * duration).toFixed(2)}s`);
        petal.addEventListener('animationiteration', event => {
            if (event.animationName === 'petal-shower') scatter(petal);
        }, { signal: events.signal });
    }
    root.setAttribute('data-petals-ready', 'true');
    return { dispose() { events.abort(); root.removeAttribute('data-petals-ready'); } };
}

export function localDateParts(iso) {
    const date = new Date(iso);
    return [
        new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date),
        new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(date),
        new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date),
        new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
    ];
}

export function focusPage(id) {
    const heading = document.getElementById(id);
    if (!heading) return;
    heading.focus({ preventScroll: true });
    // Keep the household's private URL fragment intact when changing screens.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

export function observeIllustrations(root) {
    const targets = root.querySelectorAll('.gold-illustration, .programme-screen .event');
    if (typeof IntersectionObserver === 'undefined') return { dispose() {} };
    const revealedRows = new WeakSet();
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const isRow = entry.target.matches('.programme-screen .event');
            if (isRow && revealedRows.has(entry.target)) continue;
            const visible = entry.isIntersecting && (isRow || entry.intersectionRatio >= .25);
            entry.target.setAttribute('data-in-view', String(visible));
            if (isRow && visible) {
                revealedRows.add(entry.target);
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: [0, .25] });
    for (const target of targets) {
        target.setAttribute('data-in-view', 'false');
        observer.observe(target);
    }
    return { dispose() { observer.disconnect(); } };
}

export function showDialog(dialog) {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    resetViewerScroll(dialog);
}

export function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
}

export function resetViewerScroll(dialog) {
    dialog?.querySelector('.viewer-scroll')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

export function attachScratch(surface, receiver) {
    const canvas = surface.querySelector('canvas');
    const context = canvas.getContext('2d');
    const events = new AbortController();
    const options = { signal: events.signal };
    const gridSize = 32;
    const coverage = new Uint8Array(gridSize * gridSize);
    const points = [];
    let activePointer = null;
    let previous = null;
    let revealed = false;
    let disposed = false;
    let cleared = 0;
    let frame = 0;
    let animation;
    let brush;
    let radius = 0;
    let ratio = 1;
    let width = 0;
    let height = 0;

    function releaseCapture() {
        const pointer = activePointer;
        activePointer = null;
        if (pointer !== null && surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
        previous = null;
    }

    async function reveal() {
        if (revealed || disposed) return;
        revealed = true;
        cancelAnimationFrame(frame);
        frame = 0;
        points.length = 0;
        releaseCapture();
        surface.classList.add('is-revealing');
        try {
            if (!prefersReducedMotion() && surface.animate) {
                animation = surface.animate([{ opacity: 1 }, { opacity: 0 }], {
                    duration: 420, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'forwards'
                });
                await animation.finished;
            }
            if (disposed) return;
            await receiver.invokeMethodAsync('RevealAsync');
        } catch (error) {
            // A component can be disposed while a callback is in flight.
            if (!disposed) {
                revealed = false;
                animation?.cancel();
                surface.classList.remove('is-revealing');
                console.error('Unable to reveal the invitation date.', error);
            }
        }
    }

    function paint() {
        if (!context || revealed || disposed) return;
        const bounds = surface.getBoundingClientRect();
        const newWidth = surface.clientWidth;
        const newHeight = surface.clientHeight;
        const newRatio = Math.min(window.devicePixelRatio || 1, 2);
        // Hidden cards must not erase the guest's scratch progress.
        if (!bounds.width || !bounds.height || !newWidth || !newHeight ||
            (width === newWidth && height === newHeight && ratio === newRatio)) return;
        drain();
        if (revealed) return;
        releaseCapture();
        let snapshot;
        if (width && height) {
            snapshot = document.createElement('canvas');
            snapshot.width = canvas.width;
            snapshot.height = canvas.height;
            snapshot.getContext('2d').drawImage(canvas, 0, 0);
        }
        width = newWidth;
        height = newHeight;
        ratio = newRatio;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        if (snapshot) {
            context.drawImage(snapshot, 0, 0, width, height);
        } else {
            const foil = context.createLinearGradient(0, 0, width, height);
            [[0, '#eed6a3'], [.32, '#bd9555'], [.52, '#f0d9a6'], [.76, '#b38a4e'], [1, '#dcc08b']]
                .forEach(([position, color]) => foil.addColorStop(position, color));
            context.fillStyle = foil;
            context.fillRect(0, 0, width, height);
            context.fillStyle = '#fff8df12';
            for (let y = 0; y < height; y += 4) context.fillRect(0, y, width, .5);
        }
        radius = Math.max(22, Math.min(40, width * .075));
        brush = document.createElement('canvas');
        brush.width = brush.height = Math.ceil(radius * 2 * ratio);
        const tip = brush.getContext('2d');
        const center = brush.width / 2;
        const feather = tip.createRadialGradient(center, center, 0, center, center, center);
        feather.addColorStop(0, '#000');
        feather.addColorStop(.72, '#000');
        feather.addColorStop(1, '#0000');
        tip.fillStyle = feather;
        tip.fillRect(0, 0, brush.width, brush.height);
        context.globalCompositeOperation = 'destination-out';
        surface.classList.add('painted');
    }

    // A small normalized grid tracks cleared area without reading the canvas on every stroke.
    function markCoverage(from, to) {
        const reach = radius * .8;
        const minX = Math.max(0, Math.floor((Math.min(from.x, to.x) - reach) / width * gridSize));
        const maxX = Math.min(gridSize - 1, Math.floor((Math.max(from.x, to.x) + reach) / width * gridSize));
        const minY = Math.max(0, Math.floor((Math.min(from.y, to.y) - reach) / height * gridSize));
        const maxY = Math.min(gridSize - 1, Math.floor((Math.max(from.y, to.y) + reach) / height * gridSize));
        const dx = to.x - from.x, dy = to.y - from.y;
        const length = dx * dx + dy * dy;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const index = y * gridSize + x;
                if (coverage[index]) continue;
                const px = (x + .5) / gridSize * width - from.x;
                const py = (y + .5) / gridSize * height - from.y;
                const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
                if ((px - t * dx) ** 2 + (py - t * dy) ** 2 <= reach * reach) {
                    coverage[index] = 1;
                    cleared++;
                }
            }
        }
    }

    function flush() {
        frame = 0;
        if (disposed || revealed) { points.length = 0; return; }
        for (const point of points) {
            const from = previous ?? point;
            const distance = Math.hypot(point.x - from.x, point.y - from.y);
            const steps = Math.max(1, Math.ceil(distance / (radius * .25)));
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                context.drawImage(brush, from.x + (point.x - from.x) * t - radius,
                    from.y + (point.y - from.y) * t - radius, radius * 2, radius * 2);
            }
            markCoverage(from, point);
            previous = point;
        }
        points.length = 0;
        if (cleared / coverage.length >= .35) void reveal();
    }

    function drain() {
        cancelAnimationFrame(frame);
        frame = 0;
        if (points.length) flush();
    }

    function scratch(event) {
        if (!context || !width || activePointer !== event.pointerId || revealed || disposed) return;
        const bounds = surface.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const samples = event.getCoalescedEvents?.() ?? [];
        for (const sample of samples.length ? samples : [event]) {
            points.push({
                x: Math.max(-radius, Math.min(width + radius, (sample.clientX - bounds.left) * width / bounds.width)),
                y: Math.max(-radius, Math.min(height + radius, (sample.clientY - bounds.top) * height / bounds.height))
            });
        }
        if (!frame) frame = requestAnimationFrame(flush);
    }

    surface.addEventListener('pointerdown', event => {
        if (event.button !== 0 || activePointer !== null || revealed || disposed) return;
        if (!context) { void reveal(); return; }
        paint();
        if (!width || !height || revealed) return;
        activePointer = event.pointerId;
        previous = null;
        surface.setPointerCapture(event.pointerId);
        surface.classList.add('active');
        scratch(event);
    }, options);
    surface.addEventListener('pointermove', scratch, options);
    function release(event) {
        if (event.pointerId !== activePointer) return;
        if (event.type === 'pointerup') scratch(event);
        drain();
        releaseCapture();
    }
    surface.addEventListener('pointerup', release, options);
    surface.addEventListener('pointercancel', release, options);
    surface.addEventListener('lostpointercapture', release, options);
    surface.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void reveal();
        }
    }, options);
    const resize = new ResizeObserver(paint);
    resize.observe(surface);
    paint();
    return {
        dispose() {
            disposed = true;
            cancelAnimationFrame(frame);
            points.length = 0;
            animation?.cancel();
            events.abort();
            releaseCapture();
            resize.disconnect();
        }
    };
}
