(() => {
  'use strict';

  const STORAGE_KEY = 'macroAutofillRules';
  const ACTIONS = Object.freeze([
    { id: 'supportEmail', name: 'Colar email de suporte' },
    { id: 'invoiceData', name: 'Colar dados da fatura' },
    { id: 'productName', name: 'Colar nome do produto' },
    { id: 'invoiceId', name: 'Colar ID da fatura' },
    { id: 'ccProducer', name: 'Colocar produtor em cópia' },
    { id: 'customerFirstName', name: 'Colar nome do cliente' },
    { id: 'customerEmail', name: 'Colar email do cliente' },
    { id: 'maskedEmails', name: 'Colar emails censurados' },
    { id: 'timeGreeting', name: 'Saudação por horário' }
  ]);
  const ACTION_IDS = new Set(ACTIONS.map(action => action.id));

  function validRules(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap(rule => {
      const label = typeof rule?.label === 'string' ? rule.label : '';
      const key = label.toLowerCase();
      if (!label.trim() || seen.has(key)) return [];
      seen.add(key);
      return [{ id: String(rule.id || ''), label,
        action: ACTION_IDS.has(rule.action) ? rule.action : null }];
    });
  }

  function findMatches(text, rules, includeUnassigned = false) {
    const active = validRules(rules).filter(rule => includeUnassigned || rule.action)
      .map(rule => ({ ...rule, key: rule.label.toLowerCase() }))
      .sort((a, b) => b.label.length - a.label.length);
    const matches = [];
    for (let index = 0; index < text.length;) {
      const found = active.find(rule =>
        text.slice(index, index + rule.label.length).toLowerCase() === rule.key);
      if (!found) { index++; continue; }
      matches.push({ start: index, end: index + found.label.length,
        label: text.slice(index, index + found.label.length), action: found.action });
      index += found.label.length;
    }
    return matches;
  }

  function greetingForHour(hour) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (hour >= 4 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 19) return 'Boa tarde';
    return 'Boa noite';
  }

  const api = { STORAGE_KEY, ACTIONS, validRules, findMatches, greetingForHour };
  globalThis.TicketHelperMacroAutofillCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
