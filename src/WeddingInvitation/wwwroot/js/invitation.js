let music;
let listenersInstalled = false;

export function formatLocalDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full', timeStyle: 'short'
    }).format(new Date(value)) + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
}

export function getInvitationId() {
    const url = new URL(window.location.href);
    // Fragment IDs are not sent to GitHub Pages in HTTP requests.
    const id = new URLSearchParams(url.hash.slice(1)).get('invite') || url.searchParams.get('invite') || '';
    return /^[a-f0-9]{32}$/.test(id) ? id : '';
}

function showMusicState(message) {
    document.querySelectorAll('[data-music-toggle]').forEach(button => {
        button.setAttribute('aria-pressed', String(Boolean(music && !music.paused)));
        button.textContent = music && !music.paused ? '♫ Pause music' : '♫ Play music';
    });
    document.querySelectorAll('[data-music-status]').forEach(status => { status.textContent = message; });
}

async function playMusic() {
    if (!music) return false;
    try {
        await music.play();
        showMusicState('Background music playing.');
        return true;
    } catch {
        showMusicState('Music could not start. Use Play music to try again.');
        return false;
    }
}

export function prepareMusic(url, volume) {
    if (!url) return;
    if (music) music.pause();
    music = new Audio(url);
    music.loop = true;
    music.preload = 'none';
    music.volume = Math.max(0, Math.min(1, volume));
    music.addEventListener('error', () => showMusicState('Music is unavailable. You can still enjoy the invitation.'));
    if (!listenersInstalled) {
        // Invoke play directly inside the user gesture, before asynchronous Blazor rendering.
        document.addEventListener('click', event => {
            if (!(event.target instanceof Element)) return;
            if (event.target.closest('[data-open-invitation]')) void playMusic();
            if (event.target.closest('[data-music-toggle]')) void toggleMusic();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && music) { music.pause(); showMusicState('Music paused.'); }
        });
        listenersInstalled = true;
    }
    showMusicState('Music will start when you open the invitation.');
}

async function toggleMusic() {
    if (!music) return false;
    if (music.paused) return playMusic();
    music.pause();
    showMusicState('Music paused.');
    return false;
}

export function downloadCalendar(filename, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function focusElement(id) {
    document.getElementById(id)?.focus({ preventScroll: true });
}
