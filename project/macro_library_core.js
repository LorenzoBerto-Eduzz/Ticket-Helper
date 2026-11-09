(() => {
  'use strict';
  if (globalThis.TicketHelperMacroCore) return;
  const FORMAT = 'tickethelper-macros-v1';
  const MAX_IMPORT_BYTES = 100_000_000;
  function normalizeShortcut(value) {
    const bits = String(value || '').split('+').map(bit => bit.trim()).filter(Boolean);
    const key = bits.pop();
    if (!key || !/^(?:Space|[a-z0-9])$/i.test(key)) return '';
    const mods = new Set(bits.map(bit => bit.toLowerCase()));
    if ([...mods].some(mod => !['ctrl', 'alt', 'shift'].includes(mod)) || !mods.size) return '';
    return [...['Ctrl', 'Alt', 'Shift'].filter(mod => mods.has(mod.toLowerCase())),
      key.toLowerCase() === 'space' ? 'Space' : key.toUpperCase()].join('+');
  }
  function eventShortcut(event) {
    if (event.metaKey || event.repeat || event.isComposing) return '';
    const key = event.code === 'Space' ? 'Space' :
      /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(event.code) ? event.code.slice(-1) : '';
    if (!key) return '';
    return normalizeShortcut([event.ctrlKey && 'Ctrl', event.altKey && 'Alt',
      event.shiftKey && 'Shift', key].filter(Boolean).join('+'));
  }
  function parseProKeys(text) {
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    const root = Array.isArray(data) ? data : data?.snippets;
    if (!Array.isArray(root) || root[0] !== 'Snippets') throw new Error('Exportação ProKeys inválida.');
    const rows = [];
    function visit(folder) {
      for (const item of folder.slice(2)) {
        if (Array.isArray(item)) visit(item);
        else if (item && typeof item.name === 'string' && typeof item.body === 'string')
          rows.push({ abbreviation: item.name, body: item.body });
        else throw new Error('Exportação ProKeys contém um item inválido.');
      }
    }
    visit(root);
    return rows;
  }
  function activeIndex(rows) {
    const winners = new Map();
    return [...rows].sort((a, b) => a.id - b.id).map(row => {
      const key = row.abbreviation.toLocaleLowerCase();
      if (!winners.has(key) && row.html) winners.set(key, row.id);
      return { id: row.id, abbreviation: row.abbreviation, activeId: winners.get(key) || null };
    });
  }
  const api = { FORMAT, MAX_IMPORT_BYTES, normalizeShortcut, eventShortcut,
    parseProKeys, activeIndex };
  globalThis.TicketHelperMacroCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
