(() => {
  'use strict';

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
      .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  }

  function matches(query, fields) {
    const needle = normalize(query).trim();
    return !needle || fields.some(field => normalize(field).includes(needle));
  }

  const api = { normalize, matches };
  globalThis.TicketHelperSearchFilterCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
