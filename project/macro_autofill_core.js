(() => {
  'use strict';

  const STORAGE_KEY = 'macroAutofillRules';
  const ACTIONS = Object.freeze([
    { id: 'supportEmail', name: 'Colar email de suporte' },
    { id: 'invoiceData', name: 'Colar dados da fatura' },
    { id: 'productName', name: 'Colar nome do produto' },
    { id: 'invoiceId', name: 'Colar ID da fatura' },
    { id: 'ccProducer', name: 'Colocar produtor em cópia' },
    { id: 'refundReceiptUpload', name: 'Baixar comprovante do reembolso' },
    { id: 'customerFirstName', name: 'Colar nome do cliente' },
    { id: 'customerEmail', name: 'Colar email do cliente' },
    { id: 'maskedEmails', name: 'Colar emails censurados' },
    { id: 'timeGreeting', name: 'Saudação por horário' },
    { id: 'solveResolved', name: 'Solucionar como resolvido' },
    { id: 'solveNoInteraction', name: 'Solucionar como sem interação' },
    { id: 'waitCustomer3Business', name: 'Aguardar cliente até 3 dias úteis' },
    { id: 'waitCustomerWeek', name: 'Aguardar cliente até 1 semana' },
    { id: 'waitProducer3Business', name: 'Aguardar produtor até 3 dias úteis' },
    { id: 'waitProducerWeek', name: 'Aguardar produtor até 1 semana' },
    { id: 'waitInternal3Business', name: 'Aguardar interno até 3 dias úteis' },
    { id: 'waitInternal1Business', name: 'Aguardar interno até 1 dia útil' }
  ]);
  const ACTION_IDS = new Set(ACTIONS.map(action => action.id));
  const FINAL_ACTIONS = Object.freeze({
    solveResolved: { status: 'Solucionado', solution: 'Resolvido' },
    solveNoInteraction: { status: 'Solucionado', solution: 'Sem interação' },
    waitCustomer3Business: { status: 'Pendente', pendingType: 'Aguardando cliente', businessDays: 3 },
    waitCustomerWeek: { status: 'Pendente', pendingType: 'Aguardando cliente', days: 7 },
    waitProducer3Business: { status: 'Pendente', pendingType: 'Aguardando produtor', businessDays: 3 },
    waitProducerWeek: { status: 'Pendente', pendingType: 'Aguardando produtor', days: 7 },
    waitInternal1Business: { status: 'Pendente', pendingType: 'Aguardando aprovação', businessDays: 1 },
    waitInternal3Business: { status: 'Pendente', pendingType: 'Aguardando aprovação', businessDays: 3 }
  });

  const LEGACY_ACTION_IDS = Object.freeze({ waitInternalWeek: 'waitInternal1Business' });

  function actionIdForName(name) {
    return ACTIONS.find(action => action.name === name)?.id ||
      (name === 'Aguardar interno até 1 semana' ? 'waitInternal1Business' : null);
  }

  function validRules(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap(rule => {
      const label = typeof rule?.label === 'string' ? rule.label : '';
      const key = label.toLowerCase();
      if (!label.trim() || seen.has(key)) return [];
      seen.add(key);
      return [{ id: String(rule.id || ''), label,
        action: ACTION_IDS.has(rule.action) ? rule.action :
          LEGACY_ACTION_IDS[rule.action] || null }];
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

  function eligibleFinalMatch(text, rules, action) {
    if (!FINAL_ACTIONS[action]) return null;
    const matches = findMatches(text, rules, true);
    return matches.length === 1 && matches[0].action === action ? matches[0] : null;
  }

  function returnDateForAction(action, today = new Date()) {
    const config = FINAL_ACTIONS[action];
    if (!config || (!config.businessDays && !config.days) ||
        !Number.isFinite(today?.getTime?.())) return null;
    const result = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let remaining = config.businessDays || config.days;
    while (remaining > 0) {
      result.setDate(result.getDate() + 1);
      if (config.days || (result.getDay() !== 0 && result.getDay() !== 6)) remaining--;
    }
    return result;
  }

  function formatReturnDate(date, format) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const parts = [String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'), String(date.getFullYear())];
    // HubSpot can append a relative-date hint to its format after entry.
    const dateFormat = String(format || '').trim().replace(/\s+\[[^\]]+\]$/, '');
    if (/^MM\/DD\/YYYY$/i.test(dateFormat)) return parts.join('/');
    if (/^DD\/MM\/(?:YYYY|AAAA)$/i.test(dateFormat))
      return [parts[1], parts[0], parts[2]].join('/');
    return null;
  }

  const api = { STORAGE_KEY, ACTIONS, FINAL_ACTIONS, validRules, findMatches,
    actionIdForName,
    greetingForHour, eligibleFinalMatch, returnDateForAction, formatReturnDate };
  globalThis.TicketHelperMacroAutofillCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
