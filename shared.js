(() => {
  'use strict';

  // Shared by the invitation and the WhatsApp link generator.
  async function loadConfig() {
    const response = await fetch(`config.json?refresh=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load config.json (${response.status}).`);
    const config = await response.json();
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config.json must contain a JSON object.');
    }
    return config;
  }

  function getCoupleNames(config) {
    return typeof config?.coupleNames === 'string' ? config.coupleNames.trim() : '';
  }

  function normalizeGuestName(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }

  // One replacement pass keeps guest text literal, including braces and dollar signs.
  function formatTemplate(template, values) {
    return template.replace(/\{(family|couple|url)\}/g, (placeholder, key) => values[key] ?? placeholder);
  }

  window.InvitationShared = Object.freeze({ loadConfig, getCoupleNames, normalizeGuestName, formatTemplate });
})();
