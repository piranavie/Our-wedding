(() => {
  'use strict';

  /* ---------- Helpers ---------- */

  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 400) : ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Removes and re-adds a class so its CSS animation plays again.
  function restartAnimation(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  // Shows/hides a full-screen section and keeps its accessibility state in sync.
  function setScreen(node, visible) {
    node.classList.toggle('visible', visible);
    node.setAttribute('aria-hidden', String(!visible));
  }

  // Appends a timestamp so Google/CDN caches never serve stale content.
  const withRefresh = url => url + (url.includes('?') ? '&' : '?') + 'refresh=' + Date.now();

  const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
  function deepMerge(base, extra) {
    const out = { ...base };
    for (const k of Object.keys(extra || {})) {
      out[k] = isObject(base[k]) && isObject(extra[k]) ? deepMerge(base[k], extra[k]) : extra[k];
    }
    return out;
  }

  // Interprets "YYYY-MM-DDTHH:mm" as wall-clock time in `timeZone` (the venue) and returns the
  // absolute instant, so countdowns are correct for guests in any time zone.
  function zonedDate(text, timeZone) {
    const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return new Date(NaN);
    const [y, mo, d, h = 0, mi = 0] = m.slice(1).map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    let utc = wall;
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      const wallClockOf = date => {
        const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
        return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      };
      // Two passes settle the offset correctly across DST boundaries.
      utc -= wallClockOf(new Date(utc)) - wall;
      utc -= wallClockOf(new Date(utc)) - wall;
    } catch { /* unknown zone: treat the wall-clock time as UTC */ }
    return new Date(utc);
  }

  /* ---------- Configuration (see config.json) ---------- */

  const CONFIG_URL = 'config.json';
  const DEFAULTS = {
    rsvpEndpoint: '',
    saveTheDate: { driveFileId: '', fallbackImage: 'save_the_date.webp' },
    wedding: { title: 'Wedding', location: '', timeZone: 'Europe/London', start: '2027-08-28T10:00', end: '2027-08-28T18:00' },
    rsvp: { deadline: '2027-08-08T23:59' },
    scratchThreshold: 0.35,
    programme: { sheetCsvUrl: '', refreshSeconds: 120, fallback: [] }
  };

  async function loadConfig() {
    try {
      const response = await fetch(withRefresh(CONFIG_URL), { cache: 'no-store' });
      if (!response.ok) throw new Error(response.statusText);
      return deepMerge(DEFAULTS, await response.json());
    } catch (err) {
      console.warn('config.json could not be loaded; using defaults.', err);
      return DEFAULTS;
    }
  }

  function init(config) {
    const RSVP_ENDPOINT = config.rsvpEndpoint;
    const SAVE_THE_DATE_FILE_ID = config.saveTheDate.driveFileId;
    const SAVE_THE_DATE_FALLBACK = config.saveTheDate.fallbackImage;
    const TIME_ZONE = config.wedding.timeZone || DEFAULTS.wedding.timeZone;
    const WEDDING = {
      title: config.wedding.title,
      location: config.wedding.location,
      start: zonedDate(config.wedding.start, TIME_ZONE),
      end: zonedDate(config.wedding.end, TIME_ZONE)
    };
    const RSVP_DEADLINE = zonedDate(config.rsvp.deadline, TIME_ZONE);
    const SCRATCH_THRESHOLD = Number(config.scratchThreshold) || DEFAULTS.scratchThreshold;
    const PROGRAMME_SHEET_CSV_URL = config.programme.sheetCsvUrl;
    const PROGRAMME_REFRESH_MS = Math.max(30, Number(config.programme.refreshSeconds) || DEFAULTS.programme.refreshSeconds) * 1000;
    const PROGRAMME_FALLBACK = Array.isArray(config.programme.fallback) ? config.programme.fallback : [];

    /* ---------- Save the Date artwork ---------- */

    function loadSaveTheDate() {
      const cardImage = $('saveTheDateImage');
      const envelopePreview = $('envCard');
      const apply = url => {
        cardImage.src = url;
        envelopePreview.style.backgroundImage = `url("${url}")`;
      };
      if (!SAVE_THE_DATE_FILE_ID) { apply(SAVE_THE_DATE_FALLBACK); return; }

      const imageUrl = withRefresh(`https://drive.google.com/thumbnail?id=${encodeURIComponent(SAVE_THE_DATE_FILE_ID)}&sz=w1600`);
      let settled = false;
      const settle = url => { if (!settled) { settled = true; clearTimeout(timeout); apply(url); } };
      const timeout = setTimeout(() => settle(SAVE_THE_DATE_FALLBACK), 8000);
      const probe = new Image();
      probe.onload = () => settle(imageUrl);
      probe.onerror = () => settle(SAVE_THE_DATE_FALLBACK);
      probe.src = imageUrl;
    }

    /* ---------- Envelope & card deck ---------- */

    const stage = $('stage');
    const envelope = $('envelope');
    const envCard = $('envCard');
    const deck = $('deck');
    const cards = [...deck.querySelectorAll('.card')];
    const prevBtn = $('prevBtn');
    const nextBtn = $('nextBtn');
    const label = $('label');
    const dots = cards.map(() => $('dots').appendChild(el('i')));

    let index = 0;
    let opened = false;

    function render() {
      cards.forEach((c, i) => {
        c.classList.toggle('current', i === index);
        c.classList.toggle('gone', i < index);
        c.classList.toggle('behind', i > index);
        c.setAttribute('aria-hidden', String(i !== index));
      });
      dots.forEach((d, i) => d.classList.toggle('on', i === index));
      label.textContent = cards[index].dataset.label;
      prevBtn.disabled = index === 0;
      nextBtn.textContent = index === cards.length - 1 ? 'Programme ›' : 'Next ›';
    }

    function go(n) {
      if (n < 0 || n >= cards.length || n === index) return;
      index = n;
      render();
      const card = cards[index];
      restartAnimation(card, 'shine');
      if (card.dataset.label === 'Invitation') sparkle(card);
    }

    const advance = () => index === cards.length - 1 ? showProgramme() : go(index + 1);

    // Lift the card out of the envelope and grow it into the full-size card (FLIP).
    function liftCard() {
      const first = cards[0];
      const from = envCard.getBoundingClientRect();
      const envTop = envelope.getBoundingClientRect().top;
      stage.classList.add('is-out');
      const to = first.getBoundingClientRect();
      const s = from.width / to.width;
      const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      const dy = from.top - to.top;
      // Only the part above the envelope's top edge is visible at the start.
      const visible = Math.max(0, envTop - from.top) / s;
      const clipBottom = Math.max(0, 100 - (visible / to.height) * 100);
      envCard.style.visibility = 'hidden';
      first.animate([
        { transformOrigin: '50% 0', transform: `translate(${dx}px,${dy}px) scale(${s})`, clipPath: `inset(0 0 ${clipBottom}% 0 round 4px)`, boxShadow: '0 10px 30px #0006' },
        { transformOrigin: '50% 0', transform: 'translate(0,0) scale(1)', clipPath: 'inset(0 0 0% 0 round 6px)', boxShadow: '0 30px 70px #050102b3' }
      ], { duration: reduced ? 300 : 1300, easing: 'cubic-bezier(.65,0,.35,1)' });
      cards[1].animate([{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: 1 }], { duration: reduced ? 300 : 1500, easing: 'ease-out' });
    }

    async function open() {
      if (opened) return;
      opened = true;
      stage.classList.add('is-open');
      await wait(2700);
      // Make the foil part of the card before it rises, so the lift's clip-path
      // uncovers it at the same moment the date area of the artwork appears.
      scratch.paint();
      scratch.show();
      liftCard();
      await wait(1300);
      cards[0].classList.add('shine');
      scratch.paint();
      nextBtn.focus({ preventScroll: true });
    }

    envelope.addEventListener('click', open);
    prevBtn.addEventListener('click', () => go(index - 1));
    nextBtn.addEventListener('click', advance);

    // Tap a card to advance; swipe left/right to move between cards.
    let startX = null, dragX = 0, moved = false;
    deck.addEventListener('pointerdown', e => {
      if (e.target.closest('.scratch, .zoom-hint')) return;
      startX = e.clientX; dragX = 0; moved = false;
      deck.setPointerCapture(e.pointerId);
    });
    deck.addEventListener('pointermove', e => {
      if (startX === null) return;
      dragX = e.clientX - startX;
      if (Math.abs(dragX) > 8) {
        moved = true;
        deck.classList.add('dragging');
        cards[index].style.transform = `translateX(${dragX}px) rotate(${dragX / 30}deg)`;
      }
    });
    const endDrag = () => {
      if (startX === null) return;
      deck.classList.remove('dragging');
      cards[index].style.transform = '';
      if (!moved) cards[index].dataset.label === 'Invitation' ? openViewer() : advance();
      else if (dragX < -60) advance();
      else if (dragX > 60) go(index - 1);
      startX = null;
    };
    deck.addEventListener('pointerup', endDrag);
    deck.addEventListener('pointercancel', endDrag);

    document.addEventListener('keydown', e => {
      if (!stage.classList.contains('is-out') || datePop.open || viewer.open || programmeScreen.classList.contains('visible')) return;
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    });

    /* ---------- Enlarged invitation viewer ---------- */

    const viewer = $('viewer');
    const viewerScroll = $('viewerScroll');
    const viewerImg = $('viewerImg');
    const ZOOM = { min: 1, max: 4 };
    let zoom = 1;

    function setZoom(next, originX, originY) {
      const prev = zoom;
      zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
      if (zoom === prev) return;
      // Keep the point under the finger/cursor fixed while scaling.
      const rect = viewerScroll.getBoundingClientRect();
      const px = (originX ?? rect.width / 2) - rect.left + viewerScroll.scrollLeft;
      const py = (originY ?? rect.height / 2) - rect.top + viewerScroll.scrollTop;
      viewerImg.style.width = `calc(min(100vw, 100dvh * 2 / 3) * ${zoom})`;
      viewerScroll.scrollLeft = px * (zoom / prev) - ((originX ?? rect.width / 2) - rect.left);
      viewerScroll.scrollTop = py * (zoom / prev) - ((originY ?? rect.height / 2) - rect.top);
    }

    function openViewer() {
      if (viewer.open) return;
      zoom = 1;
      viewerImg.style.width = '';
      viewer.showModal();
      viewerScroll.scrollTo(0, 0);
      $('viewerClose').focus({ preventScroll: true });
    }

    const closeViewer = () => { viewer.close(); nextBtn.focus({ preventScroll: true }); };

    $('zoomInvitation').addEventListener('click', openViewer);
    $('viewerClose').addEventListener('click', closeViewer);
    viewer.addEventListener('cancel', e => { e.preventDefault(); closeViewer(); });

    // Mouse wheel / trackpad zoom.
    viewerScroll.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    }, { passive: false });

    // Touch: pinch to zoom, one finger pans via native scrolling; double-tap toggles 1x/2.5x.
    const pointers = new Map();
    let pinchStart = null, lastTap = 0, panStart = null;
    viewerScroll.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
      } else if (e.pointerType === 'mouse') {
        panStart = { x: e.clientX, y: e.clientY, left: viewerScroll.scrollLeft, top: viewerScroll.scrollTop };
        viewerScroll.classList.add('dragging');
      }
    });
    viewerScroll.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pinchStart && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        setZoom(pinchStart.zoom * dist / pinchStart.dist, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      } else if (panStart) {
        viewerScroll.scrollLeft = panStart.left - (e.clientX - panStart.x);
        viewerScroll.scrollTop = panStart.top - (e.clientY - panStart.y);
      }
    });
    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (panStart && e.type === 'pointerup' && Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) < 6) tapToZoom(e);
      else if (e.pointerType !== 'mouse' && e.type === 'pointerup' && pointers.size === 0) tapToZoom(e);
      panStart = null;
      viewerScroll.classList.remove('dragging');
    };
    function tapToZoom(e) {
      const now = Date.now();
      if (now - lastTap < 320) setZoom(zoom > 1.2 ? 1 : 2.5, e.clientX, e.clientY);
      lastTap = now;
    }
    viewerScroll.addEventListener('pointerup', endPointer);
    viewerScroll.addEventListener('pointercancel', endPointer);

    /* ---------- Invitation sparkles ---------- */

    // Scatter a short-lived burst of gold sparkles across the card.
    function sparkle(card) {
      if (reduced) return;
      card.querySelectorAll('.sparkle').forEach(s => s.remove());
      for (let i = 0; i < 18; i++) {
        const s = el('i', 'sparkle');
        s.style.left = (6 + Math.random() * 88) + '%';
        s.style.top = (4 + Math.random() * 92) + '%';
        s.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(1) + 'px');
        s.style.setProperty('--dy', (Math.random() * 40 - 20).toFixed(1) + 'px');
        s.style.animationDelay = (0.35 + Math.random() * 1.3) + 's';
        s.addEventListener('animationend', () => s.remove());
        card.appendChild(s);
      }
    }

    /* ---------- Scratch to reveal the date ---------- */

    function initScratch() {
      const panel = $('scratch');
      const canvas = $('scratchFoil');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let revealed = false;
      let scratching = false;
      let last = null;
      let moved = 0;
      let taps = 0;
      let tapTimer = null;

      function paint() {
        if (revealed) return;
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const { width, height } = panel.getBoundingClientRect();
        if (!width || !height) return;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        const foil = ctx.createLinearGradient(0, 0, width, height);
        foil.addColorStop(0, '#f6dc9c');
        foil.addColorStop(.35, '#b8873f');
        foil.addColorStop(.5, '#f3d593');
        foil.addColorStop(.65, '#a8783a');
        foil.addColorStop(1, '#e9c47c');
        ctx.fillStyle = foil;
        ctx.fillRect(0, 0, width, height);

        // Fine brushed texture so the foil reads as metallic.
        ctx.globalAlpha = .12;
        ctx.fillStyle = '#000';
        for (let x = 0; x < width; x += 3) ctx.fillRect(x, 0, 1, height);
        ctx.globalAlpha = 1;

        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(32, height * .45);
        panel.classList.add('painted');
      }

      function clearedRatio() {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const step = 4 * 16;
        let clear = 0;
        for (let i = 3; i < data.length; i += step) if (data[i] < 40) clear++;
        return clear / (data.length / step);
      }

      function point(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }

      function scratchTo(p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        if (last) {
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        last = p;
        if (clearedRatio() > SCRATCH_THRESHOLD) reveal();
      }

      function reveal() {
        if (revealed) return;
        revealed = true;
        stop();
        panel.classList.add('revealed');
        panel.setAttribute('aria-hidden', 'true');
        panel.tabIndex = -1;
        if (navigator.vibrate) navigator.vibrate(18);
        setTimeout(showDatePop, reduced ? 100 : 500);
      }

      function start(e) {
        if (revealed || e.button > 0) return;
        if (!panel.classList.contains('painted')) paint();
        e.preventDefault();
        e.stopPropagation();
        scratching = true;
        last = null;
        moved = 0;
        panel.classList.add('active');
        try { panel.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
        scratchTo(point(e));
      }

      function move(e) {
        if (!scratching) return;
        e.preventDefault();
        moved++;
        scratchTo(point(e));
      }

      function stop() {
        scratching = false;
        last = null;
      }

      // Fallback for guests who tap instead of rubbing: two quick taps reveal the date.
      function tap() {
        if (moved > 3) return;
        taps++;
        clearTimeout(tapTimer);
        if (taps >= 2) reveal();
        else tapTimer = setTimeout(() => { taps = 0; }, 600);
      }

      if (window.PointerEvent) {
        panel.addEventListener('pointerdown', start);
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        panel.addEventListener('pointerup', tap);
      } else {
        const touch = fn => e => { const t = e.touches[0] || e.changedTouches[0]; fn(Object.assign(t, { button: 0, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() })); };
        panel.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        panel.addEventListener('mouseup', tap);
        panel.addEventListener('touchstart', touch(start), { passive: false });
        window.addEventListener('touchmove', touch(move), { passive: false });
        window.addEventListener('touchend', stop);
        panel.addEventListener('touchend', tap);
      }
      panel.addEventListener('contextmenu', e => e.preventDefault());
      panel.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
      });

      new ResizeObserver(paint).observe(panel);
      window.addEventListener('resize', paint);
      window.addEventListener('orientationchange', paint);
      paint();

      // Makes the foil visible; called just before the card rises out of the envelope.
      const show = () => panel.classList.add('ready');
      return { paint, show };
    }

    /* ---------- Live countdowns ---------- */

    // Date.now() is the guest's own clock, so the remaining time is correct wherever they open the invitation.
    function remainingUntil(target) {
      const ms = Math.max(0, target - Date.now());
      return {
        days: Math.floor(ms / 86400000),
        hours: Math.floor(ms / 3600000) % 24,
        minutes: Math.floor(ms / 60000) % 60,
        seconds: Math.floor(ms / 1000) % 60,
        done: ms === 0
      };
    }

    // Binds a .countdown element (with [data-unit] tiles) to a target Date.
    // `isActive` lets the ticker pause while the countdown is off screen.
    function createCountdown(root, target, isActive) {
      if (!root || isNaN(target)) return { update() {} };
      const units = Object.fromEntries([...root.querySelectorAll('[data-unit]')].map(el => [el.dataset.unit, el]));

      function setUnit(name, value) {
        const el = units[name];
        const text = name === 'days' ? value.toLocaleString() : String(value).padStart(2, '0');
        if (el.textContent === text) return;
        el.textContent = text;
        restartAnimation(el.parentElement, 'tick');
      }

      function update() {
        const r = remainingUntil(target);
        Object.keys(units).forEach(k => setUnit(k, r[k]));
        root.classList.toggle('done', r.done);
      }

      update();
      setInterval(() => { if (isActive()) update(); }, 1000);
      return { update };
    }

    /* ---------- Date popup ---------- */

    const datePop = $('datePop');
    const weddingCountdown = createCountdown($('countdown'), WEDDING.start, () => datePop.open);

    // Fill the popup, programme header and RSVP intro from config.json so the dates live in one place.
    // Text is shown in the venue's time zone; countdowns use the guest's clock.
    (function applyWeddingText() {
      const d = WEDDING.start;
      if (isNaN(d)) return;
      const fmt = (date, opts) => date.toLocaleString('en-GB', { timeZone: TIME_ZONE, ...opts });
      const time = date => fmt(date, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
      const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
      set('datePopDay', fmt(d, { weekday: 'long' }));
      set('datePopNum', fmt(d, { day: 'numeric' }));
      set('datePopMonth', fmt(d, { month: 'long', year: 'numeric' }));
      if (!isNaN(WEDDING.end)) set('datePopTime', `${time(d)} – ${time(WEDDING.end)}`);
      set('programmeNote', fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
      if (!isNaN(RSVP_DEADLINE)) set('rsvpDeadline', fmt(RSVP_DEADLINE, { day: 'numeric', month: 'long', year: 'numeric' }));
    })();

    function showDatePop() {
      if (datePop.open) return;
      weddingCountdown.update();
      datePop.showModal();
      sparkle(cards[0]);
    }

    function closeDatePop({ next = false } = {}) {
      datePop.close();
      if (next) {
        go(1);
        return;
      }
      nextBtn.classList.add('nudge');
      nextBtn.addEventListener('animationend', () => nextBtn.classList.remove('nudge'), { once: true });
      nextBtn.focus({ preventScroll: true });
    }

    function downloadCalendar() {
      const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const escape = s => String(s).replace(/([,;\\])/g, '\\$1');
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Our Wedding//EN', 'BEGIN:VEVENT',
        `UID:${WEDDING.start.getTime()}@our-wedding`,
        `DTSTAMP:${utc(new Date())}`,
        `DTSTART:${utc(WEDDING.start)}`, `DTEND:${utc(WEDDING.end)}`,
        `SUMMARY:${escape(WEDDING.title)}`, `LOCATION:${escape(WEDDING.location)}`,
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      Object.assign(el('a'), { href: url, download: 'wedding.ics' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    $('datePopNext').addEventListener('click', () => closeDatePop({ next: true }));
    $('datePopClose').addEventListener('click', () => closeDatePop());
    $('addToCalendar').addEventListener('click', downloadCalendar);
    datePop.addEventListener('cancel', e => { e.preventDefault(); closeDatePop(); });
    datePop.addEventListener('click', e => { if (e.target === datePop) closeDatePop(); });

    /* ---------- Programme (Google Sheet) ---------- */

    const timeline = $('timeline');
    const programmeUpdated = $('programmeUpdated');
    const DRIVE_THUMB = id => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w600`;

    function parseCsv(text) {
      const rows = [];
      let row = [], cell = '', quoted = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
          if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
          else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows.filter(r => r.some(c => c.trim()));
    }

    // Sheet columns are matched by header name (case-insensitive): Time, Title, Description, Image, Glyph.
    function sheetToEvents(csv) {
      const [header = [], ...rows] = parseCsv(csv);
      const index = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
      const field = (row, name) => (row[index[name]] || '').trim();
      return rows
        .map(r => ({ time: field(r, 'time'), title: field(r, 'title'), description: field(r, 'description'), image: field(r, 'image'), glyph: field(r, 'glyph') }))
        .filter(e => e.title);
    }

    // Accepts a Drive file ID, a Drive share link, any image URL, or a local path.
    function imageUrl(value) {
      const v = (value || '').trim();
      if (!v) return '';
      const drive = v.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
      if (drive) return DRIVE_THUMB(drive[1]);
      if (/^https?:\/\//i.test(v) || /[\/.]/.test(v)) return v;
      return DRIVE_THUMB(v);
    }

    // "10:15 am" / "2 pm" / "14:30" on the wedding day → Date, or null when unparseable.
    function parseTime(text) {
      const m = (text || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!m) return null;
      let hours = Number(m[1]);
      const meridiem = m[3] && m[3].toLowerCase();
      if (meridiem) hours = hours % 12 + (meridiem === 'pm' ? 12 : 0);
      const d = new Date(WEDDING.start);
      d.setHours(hours, Number(m[2] || 0), 0, 0);
      return d;
    }

    // Returns 'past' | 'now' | 'upcoming' for every event based on the current time.
    function eventStatuses(events, now = Date.now()) {
      const times = events.map(e => parseTime(e.time));
      return times.map((t, i) => {
        if (!t || t > now) return 'upcoming';
        const next = times.slice(i + 1).find(Boolean);
        return !next || next > now ? 'now' : 'past';
      });
    }

    function renderEventMedia(event) {
      const media = el('div', 'event-media');
      const glyph = el('span', 'event-glyph', event.glyph || '❀');
      glyph.setAttribute('aria-hidden', 'true');
      media.appendChild(glyph);
      const src = imageUrl(event.image);
      if (src) {
        const img = Object.assign(el('img'), { src, alt: '', loading: 'lazy', draggable: false });
        img.onload = () => glyph.remove();
        img.onerror = () => img.remove();
        media.appendChild(img);
      }
      return media;
    }

    function renderEvent(event, i, status) {
      const li = el('li', `event ${status}`);
      li.style.setProperty('--i', i);
      if (status === 'now') li.setAttribute('aria-current', 'step');

      const step = el('span', 'event-step', String(i + 1));
      step.setAttribute('aria-hidden', 'true');

      const body = el('div', 'event-body');
      if (event.time) body.appendChild(el('p', 'event-time', event.time));
      body.appendChild(el('h3', 'event-title', event.title));
      if (event.description) body.appendChild(el('p', 'event-desc', event.description));

      li.append(step, renderEventMedia(event), body);
      return li;
    }

    let currentEvents = [];

    function renderProgramme(events) {
      currentEvents = events;
      const statuses = eventStatuses(events);
      timeline.replaceChildren(...events.map((e, i) => renderEvent(e, i, statuses[i])));
      if (!events.length) timeline.appendChild(el('li', 'events-empty', 'The programme will be published soon.'));
      timeline.setAttribute('aria-busy', 'false');
    }

    function renderSkeleton(count = 6) {
      timeline.replaceChildren(...Array.from({ length: count }, () => el('li', 'event skeleton')));
      timeline.setAttribute('aria-busy', 'true');
    }

    async function fetchSheetEvents() {
      const response = await fetch(withRefresh(PROGRAMME_SHEET_CSV_URL), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(response.statusText);
      const events = sheetToEvents(await response.text());
      if (!events.length) throw new Error('empty sheet');
      return events;
    }

    async function loadProgramme() {
      if (!PROGRAMME_SHEET_CSV_URL) { renderProgramme(PROGRAMME_FALLBACK); return; }
      renderSkeleton();
      try {
        renderProgramme(await fetchSheetEvents());
        programmeUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } catch (err) {
        console.warn('Programme sheet unavailable; showing fallback.', err);
        renderProgramme(PROGRAMME_FALLBACK);
      }
    }

    // Re-fetch the sheet when configured; otherwise just recompute which event is “now”.
    function refreshProgramme() {
      if (PROGRAMME_SHEET_CSV_URL) loadProgramme();
      else renderProgramme(currentEvents);
    }

    const programmeScreen = $('programmeScreen');

    function showProgramme() {
      setScreen(programmeScreen, true);
      programmeScreen.querySelector('.programme-scroll').scrollTop = 0;
      refreshProgramme();
      $('programmeBack').focus({ preventScroll: true });
    }

    const hideProgramme = () => setScreen(programmeScreen, false);

    $('programmeBack').addEventListener('click', () => { hideProgramme(); nextBtn.focus(); });
    $('programmeRsvp').addEventListener('click', () => { hideProgramme(); showRsvp(); });

    /* ---------- RSVP ---------- */

    const rsvpScreen = $('rsvpScreen');
    const rsvpForm = $('rsvpForm');
    const rsvpFields = $('rsvpFields');
    const guestName = $('guestName');
    const guestCount = $('guestCount');
    const countGroup = $('guestCountGroup');
    const rsvpError = $('rsvpError');
    const attendYes = $('attendYes');
    const attendNo = $('attendNo');
    let attending = null;
    const rsvpCountdown = createCountdown($('rsvpCountdown'), RSVP_DEADLINE, () => rsvpScreen.classList.contains('visible'));

    function showRsvp() {
      setScreen(rsvpScreen, true);
      rsvpCountdown.update();
      attendYes.focus();
    }

    const hideRsvp = () => setScreen(rsvpScreen, false);

    function choose(value) {
      attending = value;
      attendYes.setAttribute('aria-pressed', String(value));
      attendNo.setAttribute('aria-pressed', String(!value));
      rsvpFields.hidden = false;
      guestName.disabled = false;
      countGroup.hidden = !value;
      guestCount.disabled = !value;
      rsvpError.hidden = true;
      guestName.focus();
    }

    attendYes.addEventListener('click', () => choose(true));
    attendNo.addEventListener('click', () => choose(false));

    function showThanks() {
      const n = Number(guestCount.value);
      rsvpForm.hidden = true;
      $('rsvpIntro').hidden = true;
      $('rsvpTitle').textContent = 'Thank you!';
      $('rsvpThanks').hidden = false;
      $('rsvpThanksText').textContent = attending
        ? `We are delighted you can join us! Your RSVP for ${n} ${n === 1 ? 'guest' : 'guests'} has been received.`
        : 'Thank you for letting us know. You will be missed, and we appreciate your warm wishes.';
    }
    $('rsvpBack').addEventListener('click', () => { hideRsvp(); showProgramme(); });

    rsvpForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (attending === null) return;
      const submit = $('submitRsvp');
      submit.disabled = true;
      submit.textContent = 'Sending…';
      rsvpError.hidden = true;
      try {
        if (!RSVP_ENDPOINT) throw new Error('RSVP submissions are not configured yet. Please contact the couple.');
        const response = await fetch(RSVP_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ name: guestName.value.trim(), attending, guests: attending ? Number(guestCount.value) : 0 })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save your RSVP. Please try again.');
        showThanks();
      } catch (err) {
        rsvpError.textContent = err.message || 'Something went wrong. Please try again.';
        rsvpError.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Send my RSVP →';
      }
    });

    /* ---------- Ambience ---------- */

    function initPetals() {
      const petals = $('petals');
      for (let i = 0; i < 17; i++) {
        const p = el('i', 'petal');
        p.style.left = (i * 37 % 100) + '%';
        p.style.animationDuration = (9 + (i * 7 % 8)) + 's';
        p.style.animationDelay = (-i * 1.3) + 's';
        p.style.opacity = .2 + (i % 5) * .09;
        petals.appendChild(p);
      }
    }

    /* ---------- Boot ---------- */

    loadSaveTheDate();
    render();
    const scratch = initScratch();
    initPetals();
    loadProgramme();
    // Keep guests up to date while the programme is on screen.
    setInterval(() => { if (programmeScreen.classList.contains('visible')) refreshProgramme(); }, PROGRAMME_REFRESH_MS);
  }

  loadConfig().then(init);
})();
