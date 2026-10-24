(() => {
  'use strict';
  const shared = window.InvitationShared;
  const $ = id => document.getElementById(id);
  const form = $('shareForm');
  const result = $('shareResult');
  const error = $('shareError');
  const urlInput = $('invitationUrl');
  const familyInput = $('familyName');
  const createButton = form.querySelector('button[type="submit"]');
  let shareConfig = null;

  async function loadShareConfig() {
    try {
      const config = await shared.loadConfig();
      const coupleNames = shared.getCoupleNames(config);
      if (!coupleNames || typeof config.whatsappMessage !== 'string' || !config.whatsappMessage.trim()) {
        throw new Error('Set coupleNames and whatsappMessage in config.json before sharing invitations.');
      }
      shareConfig = { coupleNames, message: config.whatsappMessage };
      $('shareCoupleNames').textContent = shareConfig.coupleNames;
      document.title = `Prepare a family invitation | ${shareConfig.coupleNames}`;
      createButton.textContent = 'Create invitation link';
      createButton.disabled = false;
    } catch (err) {
      createButton.textContent = 'Settings unavailable — reload to retry';
      error.textContent = `Could not load invitation settings: ${err.message} Check config.json and open this page from the published website.`;
      error.hidden = false;
    }
  }

  loadShareConfig();

  if (location.protocol === 'https:' || location.protocol === 'http:') {
    const url = new URL('index.html', location.href);
    url.search = '';
    url.hash = '';
    urlInput.value = url.href;
  }

  form.addEventListener('input', () => {
    result.hidden = true;
    if (shareConfig) error.hidden = true;
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!shareConfig) return;
    error.hidden = true;
    result.hidden = true;
    try {
      const family = shared.normalizeGuestName(familyInput.value);
      if (!family) throw new Error('Enter a family or guest name.');
      const url = new URL(urlInput.value.trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Enter a published HTTP or HTTPS invitation URL without credentials.');
      }
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('Use your published website address, not a localhost address.');
      }
      url.hash = '';
      url.searchParams.set('family', family);
      const values = { family, couple: shareConfig.coupleNames, url: url.href };
      const message = shared.formatTemplate(shareConfig.message, values);
      $('personalLink').value = url.href;
      $('messagePreview').value = message;
      const whatsapp = new URL('https://wa.me/');
      whatsapp.searchParams.set('text', message);
      $('whatsappLink').href = whatsapp.href;
      $('copyLink').textContent = 'Copy link';
      result.hidden = false;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  $('copyLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('personalLink').value);
      $('copyLink').textContent = 'Link copied';
    } catch (_) {
      $('personalLink').focus();
      $('personalLink').select();
      $('copyLink').textContent = 'Link selected — copy it manually';
    }
  });
})();
