'use strict';





















const processes = new Map();


let activeProcessId = null;


let focusedTabId = null;


let lastTicketTabId = null;

function persistLastTicketTabId(tabId) {
  lastTicketTabId = tabId;
  chrome.storage.session.set({ lastTicketTabId: tabId }).catch(() => {});
}


let boTab1Id = null;
let boTab2Id = null;
let boAssignArmedSlot = null;
let boAssignArmedAction = null;
let boActionTabIds = {
  faturas: null,
  nutror: null,
  contratos: null
};
let bo2LastActionType = null;
let bo2LastActionDoc = null;
let bo2LastActionProcessId = null;
let bo2LastActionTicketId = null;
let bo2PendingFaturasToken = 0;
let bo2PendingFaturas = null;
let boTabActionStates = {};
let boActionOperationTokens = {};
const boActionInFlightPromises = new Map();
let lastBOTabSyncProcessId = null;
let lastBOTabSyncSignature = null;
let lastBOTabSyncAt = 0;
let activeBOContextProcessId = null;
let activeBOContextTicketId = null;
const partnerDetailLookupStates = new Map();
const docAccountsRefreshKeys = new Set();
const docSearchRunKeys = new Set();
const docSearchRunStartedAt = new Map();
const docResultWatchKeys = new Set();
let extensionEnabled = false;

const BO_DASHBOARD_HOST = 'bo.eduzz.com';
const BO_DASHBOARD_PATH = '/dashboard';
const BO_CONTENT_SCRIPT_URLS = ['*://bo.eduzz.com/*'];
const TICKET_HELPER_CONTENT_FILES = ['popup_ui.js', 'content.js'];

function injectTicketHelperIntoTab(tabId) {
  if (!Number.isInteger(tabId)) return Promise.resolve(false);
  return chrome.scripting.executeScript({
    target: { tabId },
    files: TICKET_HELPER_CONTENT_FILES
  })
    .then(() => true)
    .catch(() => false);
}

function injectTicketHelperIntoOpenBOTabs() {
  chrome.tabs.query({ url: BO_CONTENT_SCRIPT_URLS }, (tabs) => {
    for (const tab of tabs || []) {
      injectTicketHelperIntoTab(tab.id);
    }
  });
}

function persistBOTabState() {
  chrome.storage.session.set({
    boTab1Id,
    boTab2Id,
    boAssignArmedSlot,
    boAssignArmedAction,
    boActionTabIds,
    boTabActionStates
  }).catch(() => {});
}

function persistBOContextState() {
  chrome.storage.session.set({
    activeBOContextProcessId,
    activeBOContextTicketId,
    lastBOTabSyncProcessId,
    lastBOTabSyncSignature,
    lastBOTabSyncAt
  }).catch(() => {});
}

function shutdownAllExtensionWork() {
  for (const proc of processes.values()) {
    proc.status = 'ABORTED';
  }
  processes.clear();
  activeProcessId = null;
  pendingProc = null;
  boSearchBusy = false;
  boSearchOwner = null;
  clearBO2LastAction();
  boActionOperationTokens = {};
  boActionInFlightPromises.clear();
  boExecutionQueues.clear();
  boExecutionQueueVersions.clear();
  activeBOContextProcessId = null;
  activeBOContextTicketId = null;
  lastBOTabSyncProcessId = null;
  lastBOTabSyncSignature = null;
  lastBOTabSyncAt = 0;
  partnerDetailLookupStates.clear();
  docAccountsRefreshKeys.clear();
  docSearchRunKeys.clear();
  docSearchRunStartedAt.clear();
  docResultWatchKeys.clear();
  persistBOContextState();
  persistBOTabState();
}

function isExtensionEnabled() {
  return extensionEnabled === true;
}

function normalizeActionTabKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'faturas' || key === 'nutror' || key === 'contratos') return key;
  return null;
}

function clearBO2LastAction() {
  bo2LastActionType = null;
  bo2LastActionDoc = null;
  bo2LastActionProcessId = null;
  bo2LastActionTicketId = null;
  bo2PendingFaturas = null;
  bo2PendingFaturasToken = 0;
}

function markBO2LastAction(actionType, docValue, processId = null, ticketId = null) {
  bo2LastActionType = actionType || null;
  bo2LastActionDoc = docValue ? String(docValue).trim() : null;
  bo2LastActionProcessId = processId || null;
  bo2LastActionTicketId = ticketId || null;
}

function isSameFaturasContext(searchValue, processId, ticketId, ctx) {
  if (!ctx || !searchValue) return false;
  if ((ctx.value || '') !== String(searchValue).trim()) return false;
  return (ctx.processId && processId && ctx.processId === processId) ||
    (!!ctx.ticketId && !!ticketId && ctx.ticketId === ticketId);
}

function startPendingFaturas(searchValue, processId, ticketId) {
  const token = ++bo2PendingFaturasToken;
  bo2PendingFaturas = {
    token,
    value: String(searchValue ?? '').trim(),
    processId: processId || null,
    ticketId: ticketId || null
  };
  return token;
}

function finishPendingFaturas(token) {
  if (!bo2PendingFaturas) return;
  if (bo2PendingFaturas.token !== token) return;
  bo2PendingFaturas = null;
}

function clearBOActionStateForTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  const key = String(tabId);
  if (Object.prototype.hasOwnProperty.call(boTabActionStates, key)) {
    delete boTabActionStates[key];
  }
  for (const opKey of Object.keys(boActionOperationTokens)) {
    if (opKey.startsWith(`${tabId}:`)) delete boActionOperationTokens[opKey];
  }
  for (const promiseKey of Array.from(boActionInFlightPromises.keys())) {
    if (promiseKey.startsWith(`${tabId}:`)) boActionInFlightPromises.delete(promiseKey);
  }
}

function normalizeBOActionSearchValue(value) {
  return String(value ?? '').trim();
}

function markBOActionState(tabId, actionKeyArg, searchValue, proc, resultStatus = 'FOUND') {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!Number.isInteger(tabId) || !actionKey || !proc) return;
  boTabActionStates[String(tabId)] = {
    actionKey,
    searchValue: normalizeBOActionSearchValue(searchValue),
    processId: proc.processId || null,
    ticketId: proc.ticketId || null,
    resultStatus: resultStatus || 'FOUND',
    completedAt: Date.now()
  };
  persistBOTabState();
}

function hasBOActionState(tabId, actionKeyArg, searchValue, procOrIds = {}) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!Number.isInteger(tabId) || !actionKey) return false;
  const state = boTabActionStates[String(tabId)];
  if (!state || state.actionKey !== actionKey) return false;
  if (state.searchValue !== normalizeBOActionSearchValue(searchValue)) return false;

  const ticketId = procOrIds.ticketId || null;
  if (ticketId && state.ticketId !== ticketId) return false;

  return true;
}

function getBOActionState(tabId, actionKeyArg, searchValue, procOrIds = {}) {
  return hasBOActionState(tabId, actionKeyArg, searchValue, procOrIds)
    ? boTabActionStates[String(tabId)]
    : null;
}

function getBOActionRequestKey(tabId, actionKeyArg, searchValue, proc) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!Number.isInteger(tabId) || !actionKey || !proc) return '';
  return [
    tabId,
    actionKey,
    proc.ticketId || '',
    normalizeBOActionSearchValue(searchValue)
  ].join(':');
}

function isRecentlyStartedBOAction(state, maxAgeMs = 3500) {
  if (!state || state.resultStatus !== 'SEARCH_STARTED') return false;
  const age = Date.now() - Number(state.completedAt || 0);
  return age >= 0 && age < maxAgeMs;
}

function isCompletedBOActionState(state) {
  return ['FOUND', 'NO_RESULT', 'VISIBLE'].includes(String(state?.resultStatus || ''));
}

function startBOActionOperation(tabId, actionKeyArg, searchValue, proc) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!Number.isInteger(tabId) || !actionKey || !proc) return null;
  const key = `${tabId}:${actionKey}`;
  const token = uid();
  const op = {
    key,
    token,
    tabId,
    actionKey,
    searchValue: normalizeBOActionSearchValue(searchValue),
    processId: proc.processId || null,
    ticketId: proc.ticketId || null
  };
  boActionOperationTokens[key] = op;
  return op;
}

function cancelBOActionOperationsForTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  const prefix = `${tabId}:`;
  for (const opKey of Object.keys(boActionOperationTokens)) {
    if (opKey.startsWith(prefix)) delete boActionOperationTokens[opKey];
  }
  for (const promiseKey of Array.from(boActionInFlightPromises.keys())) {
    if (promiseKey.startsWith(prefix)) boActionInFlightPromises.delete(promiseKey);
  }
}

function shouldRunBOActionScript(op, proc) {
  if (!op || !proc) return true;
  return isBOActionOperationCurrent(op, proc);
}

function isBOActionOperationCurrent(op, proc) {
  if (!op || !proc) return false;
  const live = boActionOperationTokens[op.key];
  if (!live || live.token !== op.token) return false;
  if (op.ticketId && proc.ticketId && op.ticketId !== proc.ticketId) return false;
  if (activeBOContextTicketId && proc.ticketId && activeBOContextTicketId !== proc.ticketId) return false;
  return canRunBOSearchForProcess(proc);
}

function finishBOActionOperation(op) {
  if (!op) return;
  const live = boActionOperationTokens[op.key];
  if (live?.token === op.token) delete boActionOperationTokens[op.key];
}

function stampBOActionPageRun(tabId, op) {
  if (!Number.isInteger(tabId) || !op?.token) return Promise.resolve();
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (token, actionKey, searchValue, ticketId) => {
      window.__ticketHelperBOActionRun = {
        token,
        actionKey,
        searchValue,
        ticketId,
        startedAt: Date.now()
      };
    },
    args: [op.token, op.actionKey, op.searchValue, op.ticketId]
  }).catch(() => {});
}

function setActiveBOContext(proc) {
  if (!proc) return false;
  const changed = activeBOContextTicketId !== proc.ticketId;
  activeBOContextProcessId = proc.processId;
  activeBOContextTicketId = proc.ticketId;
  persistBOContextState();
  return changed;
}

function isDashboardBOTabUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.hostname === BO_DASHBOARD_HOST && u.pathname.startsWith(BO_DASHBOARD_PATH);
  } catch {
    return false;
  }
}

function getBOTabState() {
  return {
    boTab1Id,
    boTab2Id,
    boTab1Assigned: !!boTab1Id,
    boTab2Assigned: !!boTab2Id,
    armedSlot: boAssignArmedSlot,
    armedAction: boAssignArmedAction,
    actionTabs: {
      faturas: Number.isInteger(boActionTabIds.faturas),
      nutror: Number.isInteger(boActionTabIds.nutror),
      contratos: Number.isInteger(boActionTabIds.contratos)
    }
  };
}

function notifyExtensionViews(payload) {
  if (!payload) return;

  const send = () => {
    chrome.runtime.sendMessage(payload, () => {
      
      
      void chrome.runtime.lastError;
    });
  };

  if (!chrome.runtime?.getContexts) {
    send();
    return;
  }

  const optionsUrl = chrome.runtime.getURL('options.html');
  try {
    chrome.runtime.getContexts({ contextTypes: ['TAB'] }, (contexts) => {
      const err = chrome.runtime.lastError;
      if (err || !Array.isArray(contexts)) return;

      const hasOptionsTab = contexts.some((ctx) =>
        ctx?.contextType === 'TAB' &&
        typeof ctx.documentUrl === 'string' &&
        ctx.documentUrl.startsWith(optionsUrl)
      );

      if (!hasOptionsTab) return;
      send();
    });
  } catch {
    send();
  }
}

function broadcastBOTabState() {
  const payload = { action: 'BO_TAB_STATE', state: getBOTabState() };
  notifyExtensionViews(payload);

  const targetTabIds = new Set();
  for (const tabId of processes.keys()) {
    if (Number.isInteger(tabId)) targetTabIds.add(tabId);
  }
  if (Number.isInteger(focusedTabId)) targetTabIds.add(focusedTabId);
  if (Number.isInteger(lastTicketTabId)) targetTabIds.add(lastTicketTabId);
  if (Number.isInteger(boTab1Id)) targetTabIds.add(boTab1Id);
  if (Number.isInteger(boTab2Id)) targetTabIds.add(boTab2Id);
  if (Number.isInteger(boActionTabIds.faturas)) targetTabIds.add(boActionTabIds.faturas);
  if (Number.isInteger(boActionTabIds.nutror)) targetTabIds.add(boActionTabIds.nutror);
  if (Number.isInteger(boActionTabIds.contratos)) targetTabIds.add(boActionTabIds.contratos);

  
  
  chrome.tabs.query(
    { url: ['*://*.hubspot.com/*', '*://conversas.hyperflow.global/*'] },
    (tabs) => {
      for (const tab of tabs || []) {
        if (Number.isInteger(tab?.id)) targetTabIds.add(tab.id);
      }
      for (const tabId of targetTabIds) {
        sendToTab(tabId, payload);
      }
    }
  );
}

function setArmedBOTabSlot(slot, notify = true) {
  boAssignArmedSlot = slot;
  boAssignArmedAction = null;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function setArmedBOActionTab(actionKeyArg, notify = true) {
  boAssignArmedAction = normalizeActionTabKey(actionKeyArg);
  boAssignArmedSlot = null;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function clearBOActionTabAssignmentsForTab(tabId, exceptActionKey = null) {
  if (!Number.isInteger(tabId)) return false;
  let changed = false;
  for (const key of ['faturas', 'nutror', 'contratos']) {
    if (key === exceptActionKey) continue;
    if (boActionTabIds[key] === tabId) {
      clearBOActionStateForTab(boActionTabIds[key]);
      boActionTabIds[key] = null;
      changed = true;
    }
  }
  return changed;
}

function setBOTabAssignment(slot, tabId, notify = true) {
  let changed = false;
  if (slot === 1) {
    const nextTabId = tabId ?? null;
    if (boTab1Id !== nextTabId) clearBOActionStateForTab(boTab1Id);
    if (Number.isInteger(nextTabId)) changed = clearBOActionTabAssignmentsForTab(nextTabId) || changed;
    changed = changed || boTab1Id !== nextTabId;
    boTab1Id = nextTabId;
  }
  if (slot === 2) {
    const nextTabId = tabId ?? null;
    if (boTab2Id !== nextTabId) {
      clearBO2LastAction();
      clearBOActionStateForTab(boTab2Id);
    }
    if (Number.isInteger(nextTabId)) changed = clearBOActionTabAssignmentsForTab(nextTabId) || changed;
    changed = changed || boTab2Id !== nextTabId;
    boTab2Id = nextTabId;
  }
  persistBOTabState();
  if (notify && changed) broadcastBOTabState();
}

function setBOActionTabAssignment(actionKeyArg, tabId, notify = true) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!actionKey) return;
  let nextTabId = tabId ?? null;
  let changed = false;

  if (Number.isInteger(nextTabId) && (nextTabId === boTab1Id || nextTabId === boTab2Id)) {
    nextTabId = null;
  }

  if (Number.isInteger(nextTabId)) changed = clearBOActionTabAssignmentsForTab(nextTabId, actionKey) || changed;

  if (boActionTabIds[actionKey] !== nextTabId) {
    clearBOActionStateForTab(boActionTabIds[actionKey]);
    boActionTabIds[actionKey] = nextTabId;
    changed = true;
  }

  if (!changed) return;
  clearBO2LastAction();
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function clearBOTabAssignments(notify = true) {
  boTab1Id = null;
  boTab2Id = null;
  boAssignArmedSlot = null;
  boAssignArmedAction = null;
  boActionTabIds = {
    faturas: null,
    nutror: null,
    contratos: null
  };
  boTabActionStates = {};
  boActionOperationTokens = {};
  clearBO2LastAction();
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function getAssignedBOTabId(slot) {
  return slot === 2 ? boTab2Id : boTab1Id;
}

function focusBOTab(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      callback(false);
      return;
    }

    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        callback(false);
        return;
      }
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        callback(true);
      });
    });
  });
}

function assignBOTabSlotFromArmedTab(slot, tabId) {
  const hadBO1Assigned = Number.isInteger(boTab1Id);
  const prevBoTab2Id = boTab2Id;
  const otherSlot = slot === 1 ? 2 : 1;
  const currentTargetTabId = getAssignedBOTabId(slot);
  const currentOtherTabId = getAssignedBOTabId(otherSlot);

  if (currentOtherTabId === tabId) {
    
    
    if (currentTargetTabId && currentTargetTabId !== tabId) {
      if (otherSlot === 1) boTab1Id = currentTargetTabId;
      else boTab2Id = currentTargetTabId;
    } else {
      if (otherSlot === 1) boTab1Id = null;
      else boTab2Id = null;
    }
  }

  clearBOActionStateForTab(currentTargetTabId);
  clearBOActionStateForTab(tabId);
  clearBOActionTabAssignmentsForTab(tabId);
  if (slot === 1) boTab1Id = tabId;
  else boTab2Id = tabId;

  if (prevBoTab2Id !== boTab2Id) clearBO2LastAction();

  boAssignArmedSlot = null;
  boAssignArmedAction = null;
  persistBOTabState();
  broadcastBOTabState();

  const bo1WasJustAssigned = !hadBO1Assigned && Number.isInteger(boTab1Id);
  if (slot === 1 && bo1WasJustAssigned) {
    restartCurrentTicketAfterBO1Assigned();
  }
}

function assignBOActionTabFromArmedTab(actionKeyArg, tabId) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!actionKey) return;
  if (tabId === boTab1Id || tabId === boTab2Id) {
    clearBOActionStateForTab(boActionTabIds[actionKey]);
    boActionTabIds[actionKey] = null;
    boAssignArmedAction = null;
    boAssignArmedSlot = null;
    clearBO2LastAction();
    persistBOTabState();
    broadcastBOTabState();
    return;
  }
  clearBOActionTabAssignmentsForTab(tabId, actionKey);
  clearBOActionStateForTab(boActionTabIds[actionKey]);
  clearBOActionStateForTab(tabId);
  boActionTabIds[actionKey] = tabId;
  boAssignArmedAction = null;
  boAssignArmedSlot = null;
  clearBO2LastAction();
  persistBOTabState();
  broadcastBOTabState();
}

function findTabIdByProcessId(processId) {
  if (!processId) return null;
  for (const [tabId, proc] of processes.entries()) {
    if (proc?.processId === processId) return tabId;
  }
  return null;
}

function restartCurrentTicketAfterBO1Assigned() {
  const candidateTabId =
    (Number.isInteger(lastTicketTabId) ? lastTicketTabId : null) ??
    findTabIdByProcessId(activeProcessId) ??
    (Number.isInteger(focusedTabId) ? focusedTabId : null);

  if (!Number.isInteger(candidateTabId)) return;
  const blockedText = '> Sem aba BO 1 definida';
  const currentProc = processes.get(candidateTabId);
  const processDoc = String(currentProc?.doc ?? '').trim();
  const cachedDoc = String(sessionCache[candidateTabId]?.doc ?? '').trim();
  const isBlockedWaitingForBO1 =
    processDoc === blockedText || cachedDoc === blockedText;

  if (!isBlockedWaitingForBO1) return;
  sendToTab(candidateTabId, { action: 'RESTART_TICKET_PROCESS' });
}

function assignArmedBOTabFromTab(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  if (!isDashboardBOTabUrl(tab.url || '')) return;

  if (boAssignArmedSlot) {
    assignBOTabSlotFromArmedTab(boAssignArmedSlot, tab.id);
    return;
  }
  if (boAssignArmedAction) {
    assignBOActionTabFromArmedTab(boAssignArmedAction, tab.id);
  }
}

function clearAssignedBOTabIfRemoved(tabId) {
  let changed = false;
  if (boTab1Id === tabId) {
    clearBOActionStateForTab(tabId);
    boTab1Id = null;
    changed = true;
  }
  if (boTab2Id === tabId) {
    clearBOActionStateForTab(tabId);
    boTab2Id = null;
    clearBO2LastAction();
    changed = true;
  }
  for (const actionKey of ['faturas', 'nutror', 'contratos']) {
    if (boActionTabIds[actionKey] === tabId) {
      clearBOActionStateForTab(tabId);
      boActionTabIds[actionKey] = null;
      clearBO2LastAction();
      changed = true;
    }
  }
  if (changed) {
    persistBOTabState();
    broadcastBOTabState();
  }
}

function resolveAssignedBOTab1(callback) {
  if (!boTab1Id) {
    callback(null);
    return;
  }

  chrome.tabs.get(boTab1Id, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      if (boTab1Id !== null) setBOTabAssignment(1, null);
      callback(null);
      return;
    }
    callback(tab);
  });
}

function resolveAssignedBOTab2(callback) {
  if (!boTab2Id) {
    callback(null);
    return;
  }

  chrome.tabs.get(boTab2Id, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      if (boTab2Id !== null) setBOTabAssignment(2, null);
      callback(null);
      return;
    }
    callback(tab);
  });
}

function resolveAssignedBOActionTab(actionKeyArg, callback) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!actionKey) {
    resolveAssignedBOTab2(callback);
    return;
  }

  const actionTabId = boActionTabIds[actionKey];
  if (!actionTabId) {
    resolveAssignedBOTab2(callback);
    return;
  }

  chrome.tabs.get(actionTabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      if (boActionTabIds[actionKey] !== null) setBOActionTabAssignment(actionKey, null);
      resolveAssignedBOTab2(callback);
      return;
    }
    callback(tab);
  });
}

function normalizeDocForFaturasSearch(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === '-' || text === '...') return '';
  if (text.startsWith('>')) return '';
  return text;
}

function normalizeEmailForFaturasSearch(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === '-' || text === '...') return '';
  if (text.startsWith('>')) return '';
  return text.includes('@') ? text : '';
}

function chooseActionFieldValue(messageValue, processValue, normalizer = (value) => String(value ?? '').trim()) {
  const msgValue = normalizer(messageValue);
  if (msgValue) return messageValue;
  const procValue = normalizer(processValue);
  if (procValue) return processValue;
  return typeof messageValue === 'string' ? messageValue : processValue;
}

function hasValidDocLength(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14;
}

function isForeignOrInvalidDocStatus(accountsValue) {
  const text = String(accountsValue ?? '').trim().toLowerCase();
  if (!text || text === '-' || text === '...') return false;
  return text.includes('estrangeiro') || text.includes('inválido') || text.includes('invalido');
}

function isNoDocStatus(docValue) {
  const text = String(docValue ?? '').trim().toLowerCase();
  if (!text || text === '-' || text === '...') return false;
  return text.includes('conta sem doc');
}

function resolveFaturasSearchValue({ doc, email, accounts }) {
  const docValue = normalizeDocForFaturasSearch(doc);
  const emailValue = normalizeEmailForFaturasSearch(email);

  const docInvalidConfirmed = isForeignOrInvalidDocStatus(accounts);
  const noDocConfirmed = isNoDocStatus(doc);

  
  
  if ((docInvalidConfirmed || noDocConfirmed) && emailValue) {
    return { value: emailValue, mode: 'email' };
  }
  if (docValue && hasValidDocLength(docValue)) {
    return { value: docValue, mode: 'doc' };
  }
  return null;
}

function resolveNutrorSearchValue({ doc, email, accounts }) {
  const docValue = normalizeDocForFaturasSearch(doc);
  const emailValue = normalizeEmailForFaturasSearch(email);
  const docInvalidConfirmed = isForeignOrInvalidDocStatus(accounts);
  const noDocConfirmed = isNoDocStatus(doc);

  if (docValue && hasValidDocLength(docValue)) {
    return { value: docValue, mode: 'doc' };
  }
  if ((docInvalidConfirmed || noDocConfirmed) && emailValue) {
    return { value: emailValue, mode: 'email' };
  }
  return null;
}

function resolveContratosSearchValue({ doc, email, accounts }) {
  return resolveNutrorSearchValue({ doc, email, accounts });
}


let boSearchBusy = false;


let boSearchOwner = null;

const boExecutionQueues = new Map();
const boExecutionQueueVersions = new Map();

function getBOExecutionQueueVersion(queueKey) {
  const key = queueKey || 'global';
  return Number(boExecutionQueueVersions.get(key) || 0);
}

function enqueueSerializedBOSearch(task, cooldownMs = 220, queueKey = 'global', queueVersion = null) {
  const key = queueKey || 'global';
  const expectedVersion = Number.isInteger(queueVersion) ? queueVersion : getBOExecutionQueueVersion(key);
  const prevQueue = boExecutionQueues.get(key) || Promise.resolve();
  const run = prevQueue
    .catch(() => {})
    .then(() => {
      if (getBOExecutionQueueVersion(key) !== expectedVersion) {
        return { status: 'STALE_QUEUE' };
      }
      return task();
    })
    .finally(() => new Promise(resolve => setTimeout(resolve, cooldownMs)));
  boExecutionQueues.set(key, run.catch(() => {}));
  return run;
}

function queueKeyForBOTab(tabId) {
  return Number.isInteger(tabId) ? `tab:${tabId}` : 'global';
}

function resetBOExecutionQueueForTab(tabId) {
  const key = queueKeyForBOTab(tabId);
  boExecutionQueueVersions.set(key, getBOExecutionQueueVersion(key) + 1);
  boExecutionQueues.set(key, Promise.resolve());
  return getBOExecutionQueueVersion(key);
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timeoutId = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}





let pendingProc = null;




let sessionCache = {};

const TICKET_HISTORY_SESSION_KEY = 'ticketHistory';
const ACTIVE_HISTORY_CANDIDATE_SESSION_KEY = 'activeHistoryCandidate';
const HUBSPOT_PORTAL_ID_SESSION_KEY = 'hubspotPortalId';
const MAX_TICKET_HISTORY_ITEMS = 30;
let ticketHistory = [];
let activeHistoryCandidate = null;
let hubspotPortalId = null;





function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isUsableHistoryField(value) {
  const text = String(value ?? '').trim();
  return !!text && text !== '-' && text !== '...' && !text.startsWith('>');
}

function normalizeHistoryItem(rawItem) {
  const id = String(rawItem?.id ?? '').trim();
  const kind = rawItem?.kind === 'hubspot' || rawItem?.kind === 'hyperflow' ? rawItem.kind : '';
  const name = String(rawItem?.name ?? '').trim() || '-';
  if (!id || !kind) return null;
  return { kind, id, name };
}

function getHistoryItemKey(item) {
  const normalized = normalizeHistoryItem(item);
  return normalized ? `${normalized.kind}:${normalized.id}` : '';
}

function normalizeTicketHistory(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const items = [];

  for (const rawItem of source) {
    const item = normalizeHistoryItem(rawItem);
    const key = getHistoryItemKey(item);
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= MAX_TICKET_HISTORY_ITEMS) break;
  }

  return items;
}

function syncTicketHistorySession() {
  chrome.storage.session.set({
    [TICKET_HISTORY_SESSION_KEY]: ticketHistory,
    [ACTIVE_HISTORY_CANDIDATE_SESSION_KEY]: activeHistoryCandidate,
    [HUBSPOT_PORTAL_ID_SESSION_KEY]: hubspotPortalId
  }).catch(() => {});
}

function extractHubSpotPortalIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || '');
    if (!url.hostname.includes('hubspot.com')) return '';
    return url.pathname
      .split('/')
      .filter(Boolean)
      .find(part => /^\d{6,}$/.test(part)) || '';
  } catch {
    return '';
  }
}

function updateHubSpotPortalIdFromUrl(rawUrl) {
  const portalId = extractHubSpotPortalIdFromUrl(rawUrl);
  if (!portalId || hubspotPortalId === portalId) return;
  hubspotPortalId = portalId;
  syncTicketHistorySession();
}

function getHistoryKindFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || '');
    if (url.hostname.includes('hubspot.com')) return 'hubspot';
    if (url.hostname === 'conversas.hyperflow.global') return 'hyperflow';
  } catch {
  }
  return '';
}

function buildHistoryUrl(item) {
  const id = String(item?.id ?? '').trim();
  if (!id) return '';
  if (item?.kind === 'hyperflow') {
    return `https://conversas.hyperflow.global/all-chats/${encodeURIComponent(id)}`;
  }
  if (item?.kind === 'hubspot' && hubspotPortalId) {
    return `https://app.hubspot.com/help-desk/${encodeURIComponent(hubspotPortalId)}/view/search/ticket/${encodeURIComponent(id)}`;
  }
  return '';
}

function getVisibleTicketHistory() {
  const activeKey = getHistoryItemKey(activeHistoryCandidate);
  return ticketHistory
    .filter(item => item?.id && getHistoryItemKey(item) !== activeKey)
    .map(item => ({
      kind: item.kind,
      id: String(item.id),
      name: String(item.name || '-')
    }));
}

function openHistoryItem(itemId, itemKind, openerTab, callback) {
  const id = String(itemId ?? '').trim();
  const kind = itemKind === 'hubspot' || itemKind === 'hyperflow' ? itemKind : '';
  const item = ticketHistory.find(entry => (
    String(entry?.id) === id && (!kind || entry?.kind === kind)
  ));
  const url = buildHistoryUrl(item);
  if (!item || !url) {
    callback?.({ ok: false, reason: item?.kind === 'hubspot' ? 'MISSING_HUBSPOT_PORTAL' : 'NOT_FOUND' });
    return;
  }

  const createProps = {
    url,
    active: true
  };
  if (Number.isInteger(openerTab?.id)) createProps.openerTabId = openerTab.id;
  if (Number.isInteger(openerTab?.index)) createProps.index = openerTab.index + 1;

  chrome.tabs.create(createProps, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      callback?.({ ok: false, reason: 'OPEN_FAILED' });
      return;
    }
    if (Number.isInteger(tab.id)) {
      focusedTabId = tab.id;
      persistLastTicketTabId(tab.id);
    }
    callback?.({ ok: true, tabId: tab.id });
  });
}

function resolveHistoryDisplayName(snapshot = {}) {
  const rawName = String(snapshot.name ?? '').trim();
  if (isUsableHistoryField(rawName) && !rawName.includes('@')) {
    return rawName.split(/\s+/)[0] || rawName;
  }

  const rawEmail = String(snapshot.email ?? '').trim();
  if (isUsableHistoryField(rawEmail)) return rawEmail;

  if (isUsableHistoryField(rawName)) return rawName;
  return '-';
}

function makeHistoryCandidate(proc, sourceUrl = '') {
  if (!proc?.ticketId) return null;
  updateHubSpotPortalIdFromUrl(sourceUrl);
  const kind = getHistoryKindFromUrl(sourceUrl);
  if (!kind) return null;

  return {
    kind,
    id: String(proc.ticketId),
    name: resolveHistoryDisplayName(proc),
    email: isUsableHistoryField(proc.email) ? String(proc.email).trim() : '',
    tabId: Number.isInteger(proc.tabId) ? proc.tabId : null,
    processId: proc.processId || null,
    updatedAt: Date.now()
  };
}

function finalizeActiveHistoryCandidate() {
  if (!activeHistoryCandidate?.id || !activeHistoryCandidate?.kind) return;

  const item = {
    kind: String(activeHistoryCandidate.kind),
    id: String(activeHistoryCandidate.id),
    name: resolveHistoryDisplayName(activeHistoryCandidate)
  };

  ticketHistory = [
    item,
    ...ticketHistory.filter(existing => getHistoryItemKey(existing) !== getHistoryItemKey(item))
  ].slice(0, MAX_TICKET_HISTORY_ITEMS);
  syncTicketHistorySession();
}

function setActiveHistoryCandidate(proc, sourceUrl = '') {
  if (!proc?.ticketId) return;

  const candidate = makeHistoryCandidate(proc, sourceUrl);
  if (!candidate) return;

  if (activeHistoryCandidate?.id && activeHistoryCandidate.id !== candidate.id) {
    finalizeActiveHistoryCandidate();
  }

  activeHistoryCandidate = {
    ...candidate,
    name: resolveHistoryDisplayName(candidate)
  };
  ticketHistory = ticketHistory.filter(item => getHistoryItemKey(item) !== getHistoryItemKey(activeHistoryCandidate));
  syncTicketHistorySession();
}

function updateActiveHistoryCandidateFromProcess(proc) {
  if (!proc?.ticketId || !activeHistoryCandidate) return;
  if (String(activeHistoryCandidate.id) !== String(proc.ticketId)) return;

  activeHistoryCandidate = {
    ...activeHistoryCandidate,
    name: resolveHistoryDisplayName(proc),
    email: isUsableHistoryField(proc.email) ? String(proc.email).trim() : activeHistoryCandidate.email || '',
    processId: proc.processId || activeHistoryCandidate.processId || null,
    tabId: Number.isInteger(proc.tabId) ? proc.tabId : activeHistoryCandidate.tabId ?? null,
    updatedAt: Date.now()
  };
  syncTicketHistorySession();
}

function finalizeActiveHistoryCandidateForProcess(procOrTicketId) {
  const ticketId = typeof procOrTicketId === 'object'
    ? procOrTicketId?.ticketId
    : procOrTicketId;
  if (!activeHistoryCandidate?.id || String(activeHistoryCandidate.id) !== String(ticketId ?? '')) return;

  if (typeof procOrTicketId === 'object' && procOrTicketId) {
    updateActiveHistoryCandidateFromProcess(procOrTicketId);
  }
  finalizeActiveHistoryCandidate();
  activeHistoryCandidate = null;
  syncTicketHistorySession();
}

function isProcessActive(processId) {
  return processId === activeProcessId;
}








function isProcessStillValid(proc) {
  if (proc.status === 'ABORTED') return false;
  const current = processes.get(proc.tabId);
  return current && current.processId === proc.processId;
}

function getCurrentTicketOwnerTabId() {
  if (Number.isInteger(lastTicketTabId)) return lastTicketTabId;
  if (Number.isInteger(focusedTabId)) return focusedTabId;
  return null;
}

function isCurrentTicketOwnerProcess(proc) {
  if (!proc) return false;
  const ownerTabId = getCurrentTicketOwnerTabId();
  if (!Number.isInteger(ownerTabId)) return false;
  return proc.tabId === ownerTabId;
}

function canRunBOSearchForProcess(proc) {
  return isExtensionEnabled() && isProcessStillValid(proc) && isCurrentTicketOwnerProcess(proc);
}

function isPendingProcessField(value) {
  const text = String(value ?? '').trim();
  return !text || text === '...';
}

function normalizeSearchableField(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text === '...') return '';
  if (text.startsWith('>')) return '';
  return text;
}

function isConcreteProcessField(value) {
  const text = String(value ?? '').trim();
  return !!text && text !== '...' && text !== '-';
}

function hydrateProcessFromSnapshot(proc, snapshot) {
  if (!proc || !snapshot) return false;
  let dirty = false;

  const applyField = (fieldName) => {
    const nextValue = snapshot[fieldName];
    if (!isConcreteProcessField(nextValue)) return;
    if (proc[fieldName] === nextValue) return;
    proc[fieldName] = nextValue;
    dirty = true;
  };

  applyField('name');
  applyField('email');
  applyField('doc');
  applyField('accounts');
  applyField('accountsSource');

  const docValue = normalizeSearchableField(proc.doc);
  if (
    docValue &&
    hasValidDocLength(docValue) &&
    proc.accountsSource !== 'doc' &&
    !isPendingProcessField(proc.accounts)
  ) {
    proc.accounts = '...';
    proc.accountsSource = null;
    dirty = true;
  }

  if (dirty) updateCacheFromProcess(proc);
  return dirty;
}

function stopProcessForMissingBO1(proc) {
  if (!proc) return;
  const normalizeStoppedField = (value) => {
    const text = String(value ?? '').trim();
    return !text || text === '...' ? '-' : value;
  };

  proc.name = normalizeStoppedField(proc.name);
  const knownEmail = normalizeStoppedField(proc.email || sessionCache[proc.tabId]?.email || '-');
  proc.email = knownEmail;
  proc.doc = '> Sem aba BO 1 definida';
  proc.accounts = '-';
  proc.accountsSource = null;
  proc.status = 'ABORTED';
  finalizeStoppedDisplayFields(proc);
  sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
  updateCacheFromProcess(proc);
}

function resumeProcessIfNeeded(proc) {
  if (!proc || !isProcessStillValid(proc)) return;
  if (!canRunBOSearchForProcess(proc)) return;
  if (boSearchBusy && boSearchOwner === proc.processId) return;

  const emailValue = normalizeSearchableField(proc.email);
  const docValue = normalizeSearchableField(proc.doc);

  const needsDocFromEmail = !!emailValue && isPendingProcessField(proc.doc);
  const needsAccountsFromDoc =
    !!docValue &&
    hasValidDocLength(docValue) &&
    (isPendingProcessField(proc.accounts) || proc.accountsSource !== 'doc');

  if (needsDocFromEmail) {
    scheduleBOSearch(proc);
    return;
  }

  if (!needsAccountsFromDoc) return;

  if (boSearchBusy) {
    setTimeout(() => resumeProcessIfNeeded(proc), 250);
    return;
  }

  resolveAssignedBOTab1((boTab) => {
    if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
    if (!boTab) {
      stopProcessForMissingBO1(proc);
      flushPending();
      return;
    }
    runDocValidationAndSearch(proc, boTab.id);
  });
}

function isPartnerDetailPendingAccounts(value) {
  return String(value ?? '').includes('Parceiro - ...');
}

function partnerDetailLookupKey(proc, boTabId) {
  if (!proc || !Number.isInteger(boTabId)) return '';
  return [
    proc.processId || '',
    proc.ticketId || '',
    normalizeSearchableField(proc.doc),
    boTabId
  ].join('|');
}

function markDocSearchRunning(searchKey) {
  if (!searchKey) return;
  docSearchRunKeys.add(searchKey);
  docSearchRunStartedAt.set(searchKey, Date.now());
}

function clearDocSearchRunning(searchKey) {
  if (!searchKey) return;
  docSearchRunKeys.delete(searchKey);
  docSearchRunStartedAt.delete(searchKey);
}

function clearDocSearchStateForProcess(proc, boTabId) {
  const searchKey = partnerDetailLookupKey(proc, boTabId);
  if (!searchKey) return;
  clearDocSearchRunning(searchKey);
  docResultWatchKeys.delete(searchKey);
  docAccountsRefreshKeys.delete(searchKey);
  partnerDetailLookupStates.delete(searchKey);
}

function isDocSearchRunning(searchKey, maxAgeMs = 8000) {
  if (!searchKey || !docSearchRunKeys.has(searchKey)) return false;
  const startedAt = Number(docSearchRunStartedAt.get(searchKey) || 0);
  if (startedAt && Date.now() - startedAt <= maxAgeMs) return true;
  clearDocSearchRunning(searchKey);
  return false;
}

function pendingPartnerDocResultFromAccounts(accounts) {
  if (!isPartnerDetailPendingAccounts(accounts)) return null;
  const count = Number(String(accounts || '').match(/^\s*(\d+)/)?.[1] || 1);
  return {
    status: 'FOUND',
    count: Number.isFinite(count) && count > 0 ? count : 1,
    hasParceiro: true,
    parceiroCount: 1
  };
}

function hasIncompleteBOContext(proc) {
  if (!proc) return false;
  return (
    isPendingProcessField(proc.doc) ||
    isPendingProcessField(proc.accounts)
  );
}

function needsDefinitiveDocAccounts(proc) {
  if (!proc) return false;
  const docValue = normalizeSearchableField(proc.doc);
  const accountsText = String(proc.accounts ?? '').trim();
  return !!docValue &&
    hasValidDocLength(docValue) &&
    (isPendingProcessField(proc.accounts) || accountsText === '-' || proc.accountsSource !== 'doc');
}

function isFinalDocSearchStatus(status) {
  return String(status || '') === 'FOUND';
}

function syncDefinedBOTabsForProcess(proc, opts = {}) {
  if (!proc || !isProcessStillValid(proc)) return;
  if (!canRunBOSearchForProcess(proc)) return;

  const forceActions = opts.forceActions !== false;
  const contextChanged = setActiveBOContext(proc);
  if (!contextChanged && !opts.contextChanged && !opts.force) {
    return;
  }

  const incompleteContext = hasIncompleteBOContext(proc);
  const docValue = normalizeSearchableField(proc.doc);
  const emailValue = normalizeSearchableField(proc.email);
  const syncSignature = [
    proc.ticketId,
    docValue,
    emailValue,
    String(proc.accounts || ''),
    String(proc.accountsSource || ''),
    boTab1Id || '',
    boTab2Id || '',
    boActionTabIds.faturas || '',
    boActionTabIds.nutror || '',
    boActionTabIds.contratos || ''
  ].join('|');
  const now = Date.now();
  if (
    lastBOTabSyncSignature === syncSignature &&
    now - lastBOTabSyncAt < 5000 &&
    !incompleteContext
  ) {
    return;
  }
  lastBOTabSyncProcessId = proc.processId;
  lastBOTabSyncSignature = syncSignature;
  lastBOTabSyncAt = now;
  persistBOContextState();

  if (docValue && hasValidDocLength(docValue)) {
    resolveAssignedBOTab1((boTab) => {
      if (!boTab) return;
      if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;

      if (isPartnerDetailPendingAccounts(proc.accounts) && !isPendingProcessField(proc.accounts)) {
        const pendingResult = pendingPartnerDocResultFromAccounts(proc.accounts);
        scheduleSinglePartnerDetailLookup(proc, pendingResult, boTab.id);
        return;
      }

      const searchKey = partnerDetailLookupKey(proc, boTab.id);
      if (isDocSearchRunning(searchKey)) {
        scheduleDocResultWatch(proc, boTab.id, docValue);
        return;
      }
      markDocSearchRunning(searchKey);

      runDocSearch(boTab.id, docValue)
        .then((result) => {
          if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
          if (!isFinalDocSearchStatus(result?.status)) return;

          if (needsDefinitiveDocAccounts(proc)) {
            handleDocResult(proc, result, boTab.id);
            return;
          }

          if (
            isPartnerDetailPendingAccounts(proc.accounts) &&
            result?.hasParceiro &&
            shouldLookupPartnerDetail(result)
          ) {
            scheduleSinglePartnerDetailLookup(proc, result, boTab.id);
          }
        })
        .catch(() => {})
        .finally(() => {
          clearDocSearchRunning(searchKey);
        });
    });
  } else if (emailValue && (isPendingProcessField(proc.doc) || isPendingProcessField(proc.accounts))) {
    resumeProcessIfNeeded(proc);
  } else if (emailValue) {
    scheduleBOSearch(proc);
  }

  if (forceActions) {
    triggerAutoFaturasSearch(proc, { force: true });
    triggerAutoAssignedActionSearches(proc, { force: true });
  }
}

function ensureDefinedBOTabsMatchProcess(proc) {
  if (!proc || !isProcessStillValid(proc)) return;
  if (!canRunBOSearchForProcess(proc)) return;

  const docValue = normalizeSearchableField(proc.doc);
  if (docValue && hasValidDocLength(docValue) && Number.isInteger(boTab1Id)) {
    readDocSearchResult(boTab1Id, docValue)
      .then((result) => {
        if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
        if (isFinalDocSearchStatus(result?.status)) {
          if (needsDefinitiveDocAccounts(proc)) handleDocResult(proc, result, boTab1Id);
          else if (result?.status === 'FOUND' && isPartnerDetailPendingAccounts(proc.accounts)) scheduleSinglePartnerDetailLookup(proc, result, boTab1Id);
          return;
        }

        const searchKey = partnerDetailLookupKey(proc, boTab1Id);
        if (isDocSearchRunning(searchKey)) {
          scheduleDocResultWatch(proc, boTab1Id, docValue);
          return;
        }
        markDocSearchRunning(searchKey);
        runDocSearch(boTab1Id, docValue)
          .then((nextResult) => {
            if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
            if (!isFinalDocSearchStatus(nextResult?.status)) return;
            if (needsDefinitiveDocAccounts(proc)) handleDocResult(proc, nextResult, boTab1Id);
            else if (nextResult?.status === 'FOUND' && isPartnerDetailPendingAccounts(proc.accounts)) scheduleSinglePartnerDetailLookup(proc, nextResult, boTab1Id);
          })
          .catch(() => {})
          .finally(() => {
            clearDocSearchRunning(searchKey);
          });
      })
      .catch(() => {});
  }

  triggerAutoFaturasSearch(proc, { force: true });
  triggerAutoAssignedActionSearches(proc, { force: true });
}

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function sendToTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, message, () => {
    const err = chrome.runtime.lastError;
    if (err) return; 
  });
}

function sendPopupUpdate(proc, fields = {}) {
  if (!proc) return;
  const mergedFields = { ...fields };
  if (!Object.prototype.hasOwnProperty.call(mergedFields, 'email')) {
    mergedFields.email = proc.email ?? null;
  }
  sendToTab(proc.tabId, {
    action: 'UPDATE_POPUP',
    processId: proc.processId,
    fields: mergedFields
  });
}

function syncSessionCache() {
  chrome.storage.session.set({ sessionCache }).catch(() => {});
}

function extractHubSpotTicketIdFromUrl(urlStr) {
  if (!urlStr) return null;
  const direct = (urlStr.match(/\/ticket\/(\d+)/) || [])[1];
  if (direct) return direct;

  try {
    const u = new URL(urlStr);
    const eschref = u.searchParams.get('eschref');
    if (!eschref) return null;
    const decoded = decodeURIComponent(eschref);
    return (decoded.match(/\/ticket\/(\d+)/) || [])[1] || null;
  } catch {
    return null;
  }
}

function extractTicketIdFromTabUrl(urlStr) {
  if (!urlStr) return null;

  try {
    const u = new URL(urlStr);

    if (u.hostname.includes('hubspot.com')) {
      return extractHubSpotTicketIdFromUrl(urlStr);
    }

    if (u.hostname === 'conversas.hyperflow.global') {
      const m = u.pathname.match(/\/chats\/(\d+)/) || u.pathname.match(/\/all-chats\/(\d+)/);
      return m ? m[1] : null;
    }
  } catch {
    return null;
  }

  return null;
}

function isSupportedTicketHost(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.hostname.includes('hubspot.com') || u.hostname === 'conversas.hyperflow.global';
  } catch {
    return false;
  }
}

function isLikelyTicketContextUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('hubspot.com')) {
      if (/\/ticket\/\d+/.test(u.pathname)) return true;
      if (u.pathname.includes('/help-desk/') && u.pathname.includes('/thread/')) return true;
      return false;
    }
    if (u.hostname === 'conversas.hyperflow.global') {
      if (/\/chats\/\d+/.test(u.pathname)) return true;
      if (/\/all-chats(?:\/|$)/.test(u.pathname)) return true;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function refreshFocusedTicketOwnership(tabId) {
  if (!tabId) return;

  chrome.tabs.get(tabId, (tab) => {
    const urlTicketId = extractTicketIdFromTabUrl(tab?.url || '');
    const cachedTicketId = sessionCache[tabId]?.id || null;
    const supportedHost = isSupportedTicketHost(tab?.url || '');
    const likelyTicketContext = isLikelyTicketContextUrl(tab?.url || '');
    const proc = processes.get(tabId);
    const hasLiveProcess = !!(proc && proc.status !== 'ABORTED');

    
    
    if (urlTicketId) {
      persistLastTicketTabId(tabId);
      if (!sessionCache[tabId]) {
        sessionCache[tabId] = { id: urlTicketId, name: null, email: null, doc: null, accounts: null };
        syncSessionCache();
      } else if (!sessionCache[tabId].id) {
        sessionCache[tabId].id = urlTicketId;
        syncSessionCache();
      }
    }
    
    
    else if (supportedHost && cachedTicketId) {
      persistLastTicketTabId(tabId);
    }
    
    else if (likelyTicketContext) {
      persistLastTicketTabId(tabId);
    }
    
    else if (supportedHost && hasLiveProcess) {
      persistLastTicketTabId(tabId);
    }

    
    chrome.tabs.sendMessage(tabId, { action: 'GET_CURRENT_DATA' }, (resp) => {
      
      if (tabId !== focusedTabId) return;

      const err = chrome.runtime.lastError;
      const hasLiveTicket = !err && resp?.isTicketPage && !!resp?.data?.id;

      if (hasLiveTicket) {
        persistLastTicketTabId(tabId);
        sessionCache[tabId] = {
          id: resp.data.id ?? null,
          name: resp.data.name ?? null,
          email: resp.data.email ?? null,
          doc: resp.data.doc ?? null,
          accounts: resp.data.accounts ?? null,
          accountsSource: sessionCache[tabId]?.accountsSource ?? processes.get(tabId)?.accountsSource ?? null
        };
        syncSessionCache();

        const liveProc = processes.get(tabId);
        if (liveProc && liveProc.status !== 'ABORTED') {
          hydrateProcessFromSnapshot(liveProc, resp.data);
          activeProcessId = liveProc.processId;
          const contextChanged = activeBOContextTicketId !== liveProc.ticketId;
          if (contextChanged) {
            syncDefinedBOTabsForProcess(liveProc, { forceActions: true, contextChanged: true });
          }
        }
        return;
      }

      
      const fallbackProc = processes.get(tabId);
      if (fallbackProc && fallbackProc.status !== 'ABORTED') {
        hydrateProcessFromSnapshot(fallbackProc, sessionCache[tabId] || null);
        activeProcessId = fallbackProc.processId;
        persistLastTicketTabId(tabId);
        const contextChanged = activeBOContextTicketId !== fallbackProc.ticketId;
        if (contextChanged) {
          syncDefinedBOTabsForProcess(fallbackProc, { forceActions: true, contextChanged: true });
        }
      }
    });
  });
}





chrome.action.onClicked.addListener(() => {
  chrome.storage.local.get('enabled', ({ enabled }) => {
    const nextEnabled = !enabled;
    if (!nextEnabled) {
      extensionEnabled = false;
      shutdownAllExtensionWork();
    }
    chrome.storage.local.set({ enabled: nextEnabled });
  });
});

chrome.storage.local.get('enabled', ({ enabled }) => {
  extensionEnabled = !!enabled;
  if (!extensionEnabled) shutdownAllExtensionWork();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  extensionEnabled = !!changes.enabled.newValue;
  if (!extensionEnabled) {
    shutdownAllExtensionWork();
    return;
  }
  injectTicketHelperIntoOpenBOTabs();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  chrome.runtime.openOptionsPage();
  injectTicketHelperIntoOpenBOTabs();
});

chrome.runtime.onStartup.addListener(() => {
  injectTicketHelperIntoOpenBOTabs();
});





function createProcess(tabId, ticketId, isFocused = true, sourceUrl = '') {
  
  const old = processes.get(tabId);
  if (old) old.status = 'ABORTED';

  const proc = {
    processId: uid(),
    ticketId,
    tabId,
    name: null,
    email: null,
    doc: null,
    accounts: null,
    accountsSource: null,
    status: 'STARTING',
    docSearchRetryCount: 0,
    retryCount: 0
  };

  processes.set(tabId, proc);

  
  
  if (isFocused) {
    activeProcessId = proc.processId;
    persistLastTicketTabId(tabId);
    setActiveBOContext(proc);
    setActiveHistoryCandidate(proc, sourceUrl);
  }

  
  sessionCache[tabId] = { id: ticketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
  syncSessionCache();

  return proc;
}

function updateCacheFromProcess(proc) {
  if (!sessionCache[proc.tabId]) return;
  sessionCache[proc.tabId] = {
    id: proc.ticketId,
    name: proc.name,
    email: proc.email,
    doc: proc.doc,
    accounts: proc.accounts,
    accountsSource: proc.accountsSource ?? null
  };
  syncSessionCache();
  updateActiveHistoryCandidateFromProcess(proc);
}

function finalizeStoppedDisplayFields(proc) {
  if (!proc) return;
  const shouldFallbackToDash = (value) => {
    if (value == null) return true;
    const text = String(value).trim();
    return text === '' || text === '...';
  };
  if (shouldFallbackToDash(proc.name)) proc.name = '-';
  if (shouldFallbackToDash(proc.email)) proc.email = '-';
  if (shouldFallbackToDash(proc.doc)) proc.doc = '-';
  if (shouldFallbackToDash(proc.accounts)) {
    proc.accounts = '-';
    proc.accountsSource = null;
  }
}





chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  const action = msg?.action;
  if (!isExtensionEnabled() && action !== 'FORCE_DISABLE' && action !== 'OPEN_OPTIONS' && action !== 'GET_BO_TAB_STATE') {
    sendResponse?.({ ok: false, disabled: true, reason: 'EXTENSION_DISABLED' });
    return true;
  }

  
  if (msg.action === 'TICKET_DETECTED') {
    const { ticketId, forceNew } = msg;

    
    
    
    
    const senderTabActive = !!sender.tab?.active;
    const isFocused = (tabId === focusedTabId) || senderTabActive;
    if (isFocused && Number.isInteger(tabId) && focusedTabId !== tabId) {
      focusedTabId = tabId;
    }

    const existing = processes.get(tabId);

    
    
    if (
      !forceNew &&
      existing &&
      existing.ticketId === ticketId &&
      existing.status !== 'ABORTED'
    ) {
      
      if (isFocused) {
        hydrateProcessFromSnapshot(existing, sessionCache[tabId] || null);
        activeProcessId = existing.processId;
        persistLastTicketTabId(tabId);
        setActiveHistoryCandidate(existing, sender.tab?.url || '');
        const contextChanged = activeBOContextTicketId !== existing.ticketId;
        if (contextChanged) {
          syncDefinedBOTabsForProcess(existing, { forceActions: true, contextChanged: true });
        } else {
          setActiveBOContext(existing);
        }
      }
      const cached = sessionCache[tabId] || null;
      sendResponse({ processId: existing.processId, reuse: true, data: cached });
      return true;
    }

    
    if (!forceNew && !existing) {
      const cached = sessionCache[tabId];
      if (cached && cached.id === ticketId && cached.email) {
        const cachedDocValue = normalizeSearchableField(cached.doc);
        const cachedNeedsDocAccounts =
          !!cachedDocValue &&
          hasValidDocLength(cachedDocValue) &&
          cached.accountsSource !== 'doc';
        const phantom = {
          processId: uid(),
          ticketId,
          tabId,
          name:     cached.name,
          email:    cached.email,
          doc:      cached.doc,
          accounts: cachedNeedsDocAccounts ? null : (cached.accounts ?? null),
          accountsSource: cachedNeedsDocAccounts ? null : (cached.accountsSource ?? null),
          status:   cachedNeedsDocAccounts ? 'STARTING' : 'COMPLETED',
          retryCount: 0
        };
        processes.set(tabId, phantom);
        if (isFocused) {
          activeProcessId = phantom.processId;
          persistLastTicketTabId(tabId);
          setActiveHistoryCandidate(phantom, sender.tab?.url || '');
          const contextChanged = activeBOContextTicketId !== phantom.ticketId;
          if (contextChanged) {
            syncDefinedBOTabsForProcess(phantom, { forceActions: true, contextChanged: true });
          } else {
            setActiveBOContext(phantom);
            if (cachedNeedsDocAccounts) resumeProcessIfNeeded(phantom);
          }
        }
        sendResponse({ processId: phantom.processId, reuse: true, data: cached });
        return true;
      }
    }

    
    
    if (!forceNew && !isFocused) {
      sendResponse({ deferred: true, focused: false });
      return true;
    }

    
    
    const proc = createProcess(tabId, ticketId, isFocused, sender.tab?.url || '');
    sendResponse({ processId: proc.processId, reuse: false });
    return true;
  }

  
  if (msg.action === 'GET_BO_TAB_STATE') {
    sendResponse({ state: getBOTabState() });
    return true;
  }

  if (msg.action === 'GET_TICKET_HISTORY') {
    sendResponse({ ok: true, history: getVisibleTicketHistory() });
    return true;
  }

  if (msg.action === 'OPEN_HISTORY_ITEM') {
    openHistoryItem(msg.id, msg.kind, sender.tab, sendResponse);
    return true;
  }

  if (msg.action === 'ARM_BO_TAB') {
    const slot = msg.slot === 2 ? 2 : 1;
    const assignedTabId = getAssignedBOTabId(slot);

    if (assignedTabId) {
      focusBOTab(assignedTabId, (focused) => {
        if (!focused) {
          setBOTabAssignment(slot, null, false);
          setArmedBOTabSlot(slot, false);
          broadcastBOTabState();
        } else {
          setArmedBOTabSlot(null, false);
          broadcastBOTabState();
        }
        sendResponse({ ok: true, focused, state: getBOTabState() });
      });
      return true;
    }

    setArmedBOTabSlot(slot);
    sendResponse({ ok: true, focused: false, state: getBOTabState() });
    return true;
  }

  if (msg.action === 'ARM_ACTION_TAB') {
    const actionKey = normalizeActionTabKey(msg.actionKey ?? msg.actionType);
    if (!actionKey) {
      sendResponse({ ok: false, reason: 'INVALID_ACTION', state: getBOTabState() });
      return true;
    }

    const assignedTabId = boActionTabIds[actionKey];
    if (assignedTabId) {
      focusBOTab(assignedTabId, (focused) => {
        if (!focused) {
          setBOActionTabAssignment(actionKey, null, false);
          setArmedBOActionTab(actionKey, false);
          broadcastBOTabState();
        } else {
          setArmedBOActionTab(null, false);
          broadcastBOTabState();
        }
        sendResponse({ ok: true, focused, state: getBOTabState() });
      });
      return true;
    }

    setArmedBOActionTab(actionKey);
    sendResponse({ ok: true, focused: false, state: getBOTabState() });
    return true;
  }

  if (msg.action === 'FOCUS_ACTION_TAB') {
    const actionKey = normalizeActionTabKey(msg.actionKey ?? msg.actionType);
    if (!actionKey) {
      sendResponse({ ok: false, reason: 'INVALID_ACTION' });
      return true;
    }

    const assignedTabId = boActionTabIds[actionKey];
    if (!assignedTabId) {
      sendResponse({ ok: false, reason: 'NO_ACTION_TAB' });
      return true;
    }

    focusBOTab(assignedTabId, (focused) => {
      if (!focused) {
        setBOActionTabAssignment(actionKey, null);
        sendResponse({ ok: false, reason: 'NO_ACTION_TAB' });
        return;
      }
      sendResponse({ ok: true, focused: true });
    });
    return true;
  }

  if (msg.action === 'RESET_BO_TABS') {
    clearBOTabAssignments();
    sendResponse({ ok: true, state: getBOTabState() });
    return true;
  }

  
  if (msg.action === 'FOCUS_BO_TAB') {
    setArmedBOTabSlot(1);
    return;
  }

  
  if (msg.action === 'DATA_EXTRACTED') {
    const { processId, email } = msg;

    
    
    
    const proc = processes.get(tabId);
    if (!proc || proc.processId !== processId) return;

    let dirty = false;

    const extractedEmail = String(email ?? '').trim();
    if (extractedEmail) {
      if (proc.email !== extractedEmail) {
        proc.email = extractedEmail;
        dirty = true;
      }
      
      sendPopupUpdate(proc, { email: proc.email });
    }

    if (dirty) updateCacheFromProcess(proc);

    
    if (proc.email && proc.status === 'STARTING') {
      scheduleBOSearch(proc);
    }
    return;
  }

  
  if (msg.action === 'EMAIL_UNAVAILABLE') {
    const { processId } = msg;
    const proc = processes.get(tabId);
    if (!proc || proc.processId !== processId) return;
    proc.email = '> Ticket sem email';
    proc.doc = '-';
    proc.accounts = '-';
    proc.accountsSource = null;
    proc.status = 'ABORTED';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, email: proc.email, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    return;
  }

  
  if (msg.action === 'TICKET_EXITED') {
    const proc = processes.get(tabId);
    if (proc) {
      finalizeActiveHistoryCandidateForProcess(proc);
      proc.status = 'ABORTED';
    } else {
      const cachedTicketId = sessionCache[tabId]?.id;
      if (cachedTicketId) finalizeActiveHistoryCandidateForProcess(cachedTicketId);
    }
    delete sessionCache[tabId];
    syncSessionCache();
    return;
  }

  
  if (msg.action === 'FORCE_DISABLE') {
    extensionEnabled = false;
    shutdownAllExtensionWork();
    chrome.storage.local.set({ enabled: false });
    return;
  }

  if (msg.action === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (
    msg.action === 'RUN_FATURAS_SEARCH' ||
    msg.action === 'RUN_NUTROR_SEARCH' ||
    msg.action === 'RUN_CONTRATOS_SEARCH'
  ) {
    const actionKey =
      msg.action === 'RUN_FATURAS_SEARCH' ? 'faturas' :
      msg.action === 'RUN_NUTROR_SEARCH' ? 'nutror' :
      'contratos';
    const cfg = getBOActionConfig(actionKey);
    const proc = processes.get(tabId);
    const currentTicketId = msg.ticketId || proc?.ticketId || null;
    const isSameTicketContext =
      !!msg.processId &&
      !!proc?.processId &&
      msg.processId !== proc.processId &&
      !!currentTicketId &&
      !!proc?.ticketId &&
      currentTicketId === proc.ticketId;

    if (!cfg) {
      sendResponse({ ok: false, reason: 'INVALID_ACTION' });
      return true;
    }
    if (!proc) {
      sendResponse({ ok: false, reason: 'NO_PROCESS' });
      return true;
    }
    if (msg.processId && proc?.processId && msg.processId !== proc.processId && !isSameTicketContext) {
      sendResponse({ ok: false, reason: 'PROCESS_MISMATCH' });
      return true;
    }

    const actionDoc = chooseActionFieldValue(msg.doc, proc.doc, normalizeDocForFaturasSearch);
    const actionEmail = chooseActionFieldValue(msg.email, proc.email, normalizeEmailForFaturasSearch);
    const actionAccounts = chooseActionFieldValue(msg.accounts, proc.accounts, (value) => {
      const text = String(value ?? '').trim();
      if (!text || text === '-' || text === '...') return '';
      return text;
    });

    const searchTarget = cfg.resolveSearchValue({
      doc: actionDoc,
      email: actionEmail,
      accounts: actionAccounts
    });
    if (!searchTarget?.value) {
      sendResponse({ ok: false, reason: 'NO_DOC' });
      return true;
    }

    if (Number.isInteger(tabId)) {
      focusedTabId = tabId;
      persistLastTicketTabId(tabId);
    }
    setActiveBOContext(proc);
    resolveAssignedBOActionTab(actionKey, (boTab) => {
      if (!boTab) {
        sendResponse({ ok: false, reason: 'NO_BO2' });
        return;
      }

      focusBOTab(boTab.id, (focused) => {
        if (!focused) {
          if (boActionTabIds[actionKey] === boTab.id) setBOActionTabAssignment(actionKey, null);
          else if (boTab2Id === boTab.id) setBOTabAssignment(2, null);
          sendResponse({ ok: false, reason: 'NO_BO2' });
          return;
        }

        runOrReuseBOActionSearch({
          boTabId: boTab.id,
          actionKey,
          proc,
          searchValue: searchTarget.value,
          force: false,
          source: 'button'
        }).then((result) => {
          sendResponse({ ...result, focused: true });
        }).catch(() => {
          sendResponse({ ok: false, focused: true, reason: 'ERROR' });
        });
      });
    });

    return true;
  }

  if (msg.action === 'RERUN_AUTO_FATURAS' || msg.action === 'SYNC_ACTIVE_TICKET_CONTEXT') {
    const proc = processes.get(tabId);
    if (!proc) {
      sendResponse({ ok: false, reason: 'NO_PROCESS' });
      return true;
    }

    if (msg.processId && proc.processId !== msg.processId) {
      sendResponse({ ok: false, reason: 'PROCESS_MISMATCH' });
      return true;
    }

    if (msg.action === 'SYNC_ACTIVE_TICKET_CONTEXT') {
      const contextChanged = activeBOContextTicketId !== proc.ticketId;
      if (contextChanged) {
        syncDefinedBOTabsForProcess(proc, { forceActions: true, contextChanged: true });
      } else {
        setActiveBOContext(proc);
      }
    } else {
      triggerAutoFaturasSearch(proc, { force: true });
      triggerAutoAssignedActionSearches(proc, { force: true });
    }
    sendResponse({ ok: true });
    return true;
  }
});





chrome.tabs.onActivated.addListener(({ tabId }) => {
  focusedTabId = tabId;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    assignArmedBOTabFromTab(tab);

    const url = tab.url || '';
    const hasUrlTicket = !!extractTicketIdFromTabUrl(url);
    const hasLikelyTicketContext = isLikelyTicketContextUrl(url);
    const hasCachedTicket = !!sessionCache[tabId]?.id;
    const proc = processes.get(tabId);
    const hasLiveProcess = !!(proc && proc.status !== 'ABORTED');

    
    
    if (hasUrlTicket || hasLikelyTicketContext || hasCachedTicket || hasLiveProcess) {
      persistLastTicketTabId(tabId);
    }
  });
  refreshFocusedTicketOwnership(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (!tabs.length) return;
    const tab = tabs[0];
    focusedTabId = tab.id;
    assignArmedBOTabFromTab(tab);
    refreshFocusedTicketOwnership(tab.id);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const proc = processes.get(tabId);
  if (proc) finalizeActiveHistoryCandidateForProcess(proc);
  else if (sessionCache[tabId]?.id) finalizeActiveHistoryCandidateForProcess(sessionCache[tabId].id);
  processes.delete(tabId);
  delete sessionCache[tabId];
  syncSessionCache();
  clearAssignedBOTabIfRemoved(tabId);
  if (lastTicketTabId === tabId) persistLastTicketTabId(null);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  
  
  if (!changeInfo.url) return;
  if (tab?.active) assignArmedBOTabFromTab(tab);
  if (tabId !== focusedTabId) return;
  if (!tab?.active) return;
  refreshFocusedTicketOwnership(tabId);
});





function isCopyableFieldValue(v) {
  if (typeof v !== 'string') return false;
  const text = v.trim();
  return !!text && text !== '-' && text !== '...' && !text.startsWith('>');
}

function pickShortcutPayload(command, data) {
  if (!data) return null;

  switch (command) {
    case 'copy-id': {
      const id = data.id;
      if (!isCopyableFieldValue(String(id ?? ''))) return null;
      return { type: 'id', value: String(id) };
    }
    case 'copy-name': {
      const n = data.name;
      if (!isCopyableFieldValue(n)) return null;
      return { type: 'name', value: n.includes('@') ? n : n.split(/\s+/)[0] };
    }
    case 'copy-email': {
      const e = data.email;
      if (!isCopyableFieldValue(e)) return null;
      return { type: 'email', value: e };
    }
    case 'copy-doc': {
      const d = data.doc;
      if (!isCopyableFieldValue(d)) return null;
      return { type: 'doc', value: d };
    }
    default:
      return null;
  }
}

const OFFSCREEN_DOC_PATH = 'offscreen.html';
let creatingOffscreenDoc = null;

async function hasOffscreenDocument() {
  try {
    if (chrome.offscreen?.hasDocument) {
      return await chrome.offscreen.hasDocument();
    }
    if (!self.clients?.matchAll) return false;
    const matchedClients = await self.clients.matchAll();
    return matchedClients.some((client) => client.url.includes(OFFSCREEN_DOC_PATH));
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return false;
  if (await hasOffscreenDocument()) return true;

  if (!creatingOffscreenDoc) {
    creatingOffscreenDoc = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOC_PATH,
      reasons: ['CLIPBOARD'],
      justification: 'Copy shortcut values even when the omnibox is focused'
    }).catch(() => {}).finally(() => {
      creatingOffscreenDoc = null;
    });
  }

  await creatingOffscreenDoc;
  return hasOffscreenDocument();
}

function copyValueViaOffscreen(value, onDone) {
  (async () => {
    try {
      const ready = await ensureOffscreenDocument();
      if (!ready) {
        onDone(false);
        return;
      }

      chrome.runtime.sendMessage({ action: 'OFFSCREEN_COPY_TEXT', value }, (resp) => {
        if (chrome.runtime.lastError) {
          onDone(false);
          return;
        }
        onDone(!!resp?.ok);
      });
    } catch {
      onDone(false);
    }
  })();
}

function copyValueInActiveTab(value, onDone) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTabId = tabs?.[0]?.id;
    if (!activeTabId) return onDone(false);

    chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (v) => {
        if (!document?.body) return false;
        return navigator.clipboard.writeText(v)
          .then(() => true)
          .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = v;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return !!ok;
          });
      },
      args: [value]
    }, (results) => {
      if (chrome.runtime.lastError) return onDone(false);
      const ok = !!results?.[0]?.result;
      onDone(ok);
    });
  });
}

function performShortcutCopy(command, sourceTabId, data) {
  const payload = pickShortcutPayload(command, data);
  if (!payload) return;

  copyValueViaOffscreen(payload.value, (offscreenOk) => {
    if (offscreenOk) {
      if (sourceTabId) sendToTab(sourceTabId, { action: 'SHOW_CHECKMARK', type: payload.type });
      return;
    }

    copyValueInActiveTab(payload.value, (ok) => {
      if (!ok) return;
      if (sourceTabId) {
        sendToTab(sourceTabId, { action: 'SHOW_CHECKMARK', type: payload.type });
      }
    });
  });
}

chrome.commands.onCommand.addListener((command) => {
  
  chrome.storage.session.get(['sessionCache', 'lastTicketTabId'], (stored) => {
    if (stored.sessionCache) {
      if (!sessionCache || Object.keys(sessionCache).length === 0) {
        sessionCache = stored.sessionCache;
      } else {
        for (const [tabKey, value] of Object.entries(stored.sessionCache)) {
          if (!sessionCache[tabKey]) sessionCache[tabKey] = value;
        }
      }
    }
    
    if ((lastTicketTabId === null || lastTicketTabId === undefined) && stored.lastTicketTabId) {
      lastTicketTabId = stored.lastTicketTabId;
    }

    
    
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs?.[0] || null;
      const activeTabId = activeTab?.id ?? null;
      const activeUrlTicketId = extractTicketIdFromTabUrl(activeTab?.url || '');
      const activeCache = activeTabId ? sessionCache[activeTabId] : null;
      const activeProc = activeTabId ? processes.get(activeTabId) : null;
      const activeHasTicket =
        !!activeUrlTicketId ||
        !!activeCache?.id ||
        !!(activeProc && activeProc.status !== 'ABORTED');

      let sourceTabId = lastTicketTabId;

      if (activeTabId && activeHasTicket) {
        sourceTabId = activeTabId;
        focusedTabId = activeTabId;
        persistLastTicketTabId(activeTabId);

        if (activeUrlTicketId) {
          if (!sessionCache[activeTabId]) {
            sessionCache[activeTabId] = {
              id: activeUrlTicketId,
              name: null,
              email: null,
              doc: null,
              accounts: null
            };
            syncSessionCache();
          } else if (!sessionCache[activeTabId].id) {
            sessionCache[activeTabId].id = activeUrlTicketId;
            syncSessionCache();
          }
        }
      }

      if (!sourceTabId) return;
      const cachedData = sessionCache[sourceTabId] || null;

      
      chrome.tabs.sendMessage(sourceTabId, { action: 'GET_CURRENT_DATA' }, (resp) => {
        const err = chrome.runtime.lastError;
        const liveData = (!err && resp?.data?.id) ? resp.data : null;

        if (liveData) {
          sessionCache[sourceTabId] = {
            id: liveData.id ?? null,
            name: liveData.name ?? null,
            email: liveData.email ?? null,
            doc: liveData.doc ?? null,
            accounts: liveData.accounts ?? null
          };
          syncSessionCache();
        }

        performShortcutCopy(command, sourceTabId, liveData || cachedData);
      });
    });
  });
});









function scheduleBOSearch(proc) {
  
  if (proc.status === 'ABORTED') return;
  if (!proc.email) return;
  if (!canRunBOSearchForProcess(proc)) return;

  proc.status = 'RESOLVING_BO_TAB';

  if (boSearchBusy) {
    
    
    pendingProc = proc;
    return;
  }

  runBOSearch(proc);
}

function runBOSearch(proc) {
  
  if (!proc || !canRunBOSearchForProcess(proc)) return;

  pendingProc = null;

  resolveAssignedBOTab1((boTab) => {
    if (!canRunBOSearchForProcess(proc)) return;

    if (!boTab) {
      stopProcessForMissingBO1(proc);
      flushPending();
      return;
    }

    proc.status = 'SEARCHING_EMAIL';
    boSearchBusy = true;
    boSearchOwner = proc.processId;

    const safetyTimer = setTimeout(() => {
      if (boSearchOwner === proc.processId) {
        boSearchBusy = false;
        boSearchOwner = null;
        flushPending();
      }
    }, 25000);

    runEmailSearch(boTab.id, proc.email)
      .then(result => {
        clearTimeout(safetyTimer);
        boSearchBusy = false;
        boSearchOwner = null;
        if (!canRunBOSearchForProcess(proc)) {
          flushPending();
          return;
        }
        handleEmailResult(proc, result, boTab.id);
        
        
        if (!boSearchBusy) flushPending();
      })
      .catch(() => {
        clearTimeout(safetyTimer);
        boSearchBusy = false;
        boSearchOwner = null;
        if (!canRunBOSearchForProcess(proc)) {
          flushPending();
          return;
        }
        proc.doc = '> Erro na busca';
        proc.accounts = '-';
        proc.accountsSource = null;
        proc.status = 'ABORTED';
        finalizeStoppedDisplayFields(proc);
        sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
        updateCacheFromProcess(proc);
        flushPending();
      });
  });
}


function flushPending() {
  
  if (!pendingProc) return;
  if (boSearchBusy) return;

  const proc = pendingProc;
  pendingProc = null;

  if (!canRunBOSearchForProcess(proc)) return;

  runBOSearch(proc);
}





function runEmailSearch(boTabId, email) {
  return enqueueSerializedBOSearch(() => {
    const injectedWait = chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boEmailSearchScript,
      args: [email]
    }).then(results => results?.[0]?.result ?? { status: 'ERROR' });

    const backgroundPoll = pollEmailSearchResult(boTabId, email, 25000);
    return Promise.race([injectedWait, backgroundPoll]);
  },
    220,
    queueKeyForBOTab(boTabId)
  );
}

function pollEmailSearchResult(boTabId, email, timeoutMs = 25000) {
  const started = Date.now();

  return new Promise(resolve => {
    let done = false;
    let timer = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const tick = () => {
      if (done) return;
      if (Date.now() - started > timeoutMs) {
        finish({ status: 'TIMEOUT' });
        return;
      }

      readEmailSearchResult(boTabId, email)
        .then((result) => {
          if (done) return;
          if (result?.status && !['PENDING', 'NO_CONTAINER', 'STALE_SEARCH'].includes(result.status)) {
            finish(result);
            return;
          }
          timer = setTimeout(tick, 550);
        })
        .catch(() => {
          if (!done) timer = setTimeout(tick, 700);
        });
    };

    timer = setTimeout(tick, 900);
  });
}

function readEmailSearchResult(boTabId, email) {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boReadEmailSearchResultScript,
    args: [email]
  }).then(results => results?.[0]?.result ?? { status: 'ERROR' });
}

function shouldLookupNoDocAccountDetail(result) {
  if (!result?.previewUrl) return false;
  if (Number(result.matchedCount || 0) !== 1) return false;
  return String(result.accountType || '').trim().toLowerCase() === 'parceiro';
}

function formatNoDocAccountsLabel(baseType, detail) {
  const base = String(baseType || 'Cliente').trim() || 'Cliente';
  const iconName = String(detail || '').trim();
  if (!iconName) return `? | ${base}`;
  if (base.toLowerCase() === iconName.toLowerCase()) return `? | ${base}`;
  return `? | ${base} - ${iconName}`;
}

function scheduleNoDocAccountDetailLookup(proc, boTabId, previewUrl, baseType) {
  if (!proc || !Number.isInteger(boTabId) || !previewUrl) return;
  const processId = proc.processId;
  const ticketId = proc.ticketId;

  readPartnerDetailFromPreviewUrl(boTabId, previewUrl)
    .then((result) => {
      if (!isProcessStillValid(proc)) return;
      if (proc.processId !== processId || proc.ticketId !== ticketId) return;
      if (result?.status !== 'FOUND' || !result.detail) return;

      const nextAccounts = formatNoDocAccountsLabel(baseType, result.detail);
      if (nextAccounts === proc.accounts) return;

      proc.accounts = nextAccounts;
      proc.accountsSource = 'email';
      sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
      updateCacheFromProcess(proc);
    })
    .catch(() => {});
}














function boEmailSearchScript(emailValue) {
  
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
  const MSG_START_SEARCH_ALT_NORM = 'faca uma pesquisa';
  const MSG_NO_RECORD_NORM = 'nenhum registro';
  const SEARCH_TRIGGER_COOLDOWN_MS = 140;
  const LOADING_HINTS_NORM = ['atualizando', 'carregando', 'refresh'];
  const searchToken = `email:${emailValue}:${Date.now()}:${Math.random()}`;
  let lastSearchTriggerAt = 0;

  globalThis.__ticketHelperBO1SearchToken = searchToken;

  function isSearchCurrent() {
    return globalThis.__ticketHelperBO1SearchToken === searchToken;
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickElement(el) {
    if (!isSearchCurrent()) return;
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function findFaturasPopup() {
    const candidates = Array.from(document.querySelectorAll('.css-5qctmg, [tabindex="-1"], [role="dialog"], .MuiDialog-root, .MuiPopover-root'))
      .filter(isVisible);
    return candidates.find((el) => {
      const text = normalizeText(el.textContent || '');
      return text.includes('status da fatura') ||
        (text.includes('fatura') && text.includes('produto') && text.includes('valor'));
    }) || null;
  }

  async function dismissFaturasPopupIfPresent() {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!isSearchCurrent()) return false;
      const popup = findFaturasPopup();
      if (!popup) return true;

      const closeBtn = Array.from(popup.querySelectorAll('button, [role="button"], [aria-label]'))
        .filter(isVisible)
        .find((el) => {
          const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '');
          return label.includes('fechar') || label.includes('close') || label === 'x';
        });

      if (closeBtn) clickElement(closeBtn);
      else {
        const escDown = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        const escUp = new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        popup.dispatchEvent(escDown);
        document.dispatchEvent(escDown);
        window.dispatchEvent(escDown);
        popup.dispatchEvent(escUp);
        document.dispatchEvent(escUp);
        window.dispatchEvent(escUp);
      }

      await delay(80);
    }

    return !findFaturasPopup();
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const immediate = document.querySelector(selector);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const root = document.documentElement || document.body;
      if (!root) {
        resolve(null);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        cleanup();
        resolve(el);
      });

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timer);
      }

      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function ensureOrbita() {
    const item = document.querySelector('#MyEduzz');
    if (!item) return;
    if (!item.classList.contains('checked')) item.querySelector('a')?.click();
  }

  async function ensureClientes() {
    function getSearchCategoryButton() {
      const direct = document.querySelector('#menuSearch');
      if (direct && isVisible(direct)) return direct;

      const input = document.querySelector('#searchField');
      if (input) {
        const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
        const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
        if (rootBtn && isVisible(rootBtn)) return rootBtn;

        const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
        const localBtn =
          inputRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          null;
        if (localBtn && isVisible(localBtn)) return localBtn;
      }

      const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]'))
        .filter(isVisible);
      return candidates.find((el) => {
        const txt = normalizeText(el.querySelector('span')?.textContent || el.textContent || '');
        return txt.includes('cliente') || txt.includes('curso') || txt.includes('fatura') || txt.includes('produto');
      }) || candidates[0] || null;
    }

    function isClientesSelected(baseBtn) {
      const activeBtn = getSearchCategoryButton() || baseBtn;
      const current = normalizeText(activeBtn?.querySelector('span')?.textContent || activeBtn?.textContent || '');
      return current.includes('cliente');
    }

    function findClientesOption() {
      const byId = Array.from(document.querySelectorAll('#menuClientes, [id*="menuClientes"]'))
        .filter(isVisible);
      if (byId.length) return byId[0];

      const nodes = Array.from(document.querySelectorAll(
        '[role="menu"] [role="menuitem"], [role="listbox"] [role="option"], [role="menuitem"], [role="option"], li, button'
      )).filter(isVisible);

      let contains = null;
      for (const node of nodes) {
        const txt = normalizeText(node.textContent || '');
        if (!txt) continue;
        if (txt === 'clientes' || txt === 'cliente') return node;
        if (!contains && txt.includes('cliente')) contains = node;
      }
      return contains;
    }

    const btn = getSearchCategoryButton();
    if (!btn) return !!document.querySelector('#searchField');

    if (isClientesSelected(btn)) return true;

    for (let attempt = 0; attempt < 4; attempt++) {
      clickElement(btn);
      await delay(140);

      let item = null;
      const start = Date.now();
      while (!item && Date.now() - start < 2200) {
        item = findClientesOption();
        if (item) break;
        await delay(90);
      }

      if (item) {
        clickElement(item);
        await delay(220);
      }

      if (isClientesSelected(btn)) return true;
      await delay(120);
    }

    return !!document.querySelector('#searchField');
  }

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input) return false;

    const now = Date.now();
    if (now - lastSearchTriggerAt < SEARCH_TRIGGER_COOLDOWN_MS) return false;

    input.focus();
    setReactInput(input, value);

    if (input.value !== value) setReactInput(input, value);
    const ariaDisabled = (btn?.getAttribute('aria-disabled') || '').toLowerCase();
    if (btn && !btn.disabled && ariaDisabled !== 'true' && isVisible(btn)) {
      clickElement(btn);
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    lastSearchTriggerAt = Date.now();
    return true;
  }

  async function triggerSearchWithRetry(value) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!isSearchCurrent()) return false;
      if (triggerSearch(value)) return true;
      await delay(180);
    }
    return false;
  }

  function extractCanonicalEmail(text) {
    const m = (text || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
    return m ? m[0] : null;
  }

  function splitEmailParts(value) {
    const idx = value.indexOf('@');
    if (idx <= 0) return null;
    return {
      local: value.slice(0, idx),
      domain: value.slice(idx + 1)
    };
  }

  function sameEmailOrBrVariant(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;

    const pa = splitEmailParts(a);
    const pb = splitEmailParts(b);
    if (!pa || !pb) return false;
    if (pa.local !== pb.local) return false;

    const da = pa.domain;
    const db = pb.domain;
    return da === `${db}.br` || db === `${da}.br`;
  }

  function accountTypeFromRows(matchedRows) {
    let hasParceiro = false;
    let hasCliente = false;

    for (const row of matchedRows) {
      const cells = row.querySelectorAll('td');
      if (!cells.length) continue;
      if (cells[0]?.querySelector('[data-tip="Parceiro"]')) hasParceiro = true;
      else hasCliente = true;
    }

    if (hasParceiro && hasCliente) return 'Consultar tipo';
    if (hasParceiro) return 'Parceiro';
    return 'Cliente';
  }

  function getRowPreviewUrl(row) {
    const preview =
      row?.querySelector?.('a[data-tip="Preview do cliente"][href*="/dashboard/clientes/"]') ||
      row?.querySelector?.('a[href*="/dashboard/clientes/"]');
    return preview?.href || null;
  }

  function hasUsableDocValue(value) {
    const doc = String(value || '').trim();
    if (!doc) return false;
    const norm = doc.toLowerCase();
    return norm !== '-' && norm !== '--' && norm !== 'null';
  }

  function parseVisibleRowsFallback(rows) {
    if (rows.length !== 1) return null;
    const cells = rows[0].querySelectorAll('td');
    if (cells.length < 4) return null;

    const rowName = (cells[1]?.textContent || '').trim() || null;
    const rowDoc = (cells[3]?.textContent || '').trim();
    const accountType = accountTypeFromRows(rows);

    if (hasUsableDocValue(rowDoc)) {
      return {
        status: 'FOUND',
        doc: rowDoc,
        name: rowName,
        matchedCount: 1,
        accountType
      };
    }

    return {
      status: 'NO_DOC',
      name: rowName,
      matchedCount: 1,
      accountType,
      previewUrl: getRowPreviewUrl(rows[0])
    };
  }

  function isSearchFieldAligned(email) {
    const targetEmail = extractCanonicalEmail(email);
    if (!targetEmail) return false;
    const currentInputValue = document.querySelector('#searchField')?.value || '';
    const currentEmail = extractCanonicalEmail(currentInputValue);
    return sameEmailOrBrVariant(currentEmail, targetEmail);
  }

  function parseRowsForEmail(rows, email) {
    const targetEmail = extractCanonicalEmail(email);
    if (!targetEmail) return { status: 'NO_ACCOUNT' };

    const matched = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      
      
      const rowEmail = extractCanonicalEmail(cells[2]?.textContent || '') ||
        extractCanonicalEmail(row.textContent || '');
      if (sameEmailOrBrVariant(rowEmail, targetEmail)) matched.push(row);
    }

    if (!matched.length) return { status: 'NO_MATCH' };

    for (const row of matched) {
      const cells = row.querySelectorAll('td');
      const rowName = (cells[1]?.textContent || '').trim();
      const rowDoc = (cells[3]?.textContent || '').trim();
      if (!rowDoc) continue;
      return {
        status: 'FOUND',
        doc: rowDoc,
        name: rowName || null,
        matchedCount: matched.length,
        accountType: accountTypeFromRows(matched)
      };
    }

    let fallbackName = null;
    for (const row of matched) {
      const cells = row.querySelectorAll('td');
      const rowName = (cells[1]?.textContent || '').trim();
      if (rowName) {
        fallbackName = rowName;
        break;
      }
    }

    return {
      status: 'NO_DOC',
      name: fallbackName,
      matchedCount: matched.length,
      accountType: accountTypeFromRows(matched),
      previewUrl: matched.length === 1 ? getRowPreviewUrl(matched[0]) : null
    };
  }

  function waitForEmailResult(email) {
    return new Promise(resolve => {
      const MIN_NO_ACCOUNT_DELAY_MS = 1200;
      const root = document.documentElement || document.body;
      const deadline = Date.now() + 25000;
      let retryCount = 0;
      let done = false;
      let checkTimer = null;
      let nonMatchStable = 0;
      let lastRowsSignature = '';
      let noAccountStable = 0;
      let lastSearchAt = Date.now();

      const observer = root
        ? new MutationObserver(() => scheduleCheck(120))
        : null;

      if (observer) observer.observe(root, { childList: true, subtree: true, characterData: true });

      const interval = setInterval(() => scheduleCheck(0), 1000);
      const hardTimeout = setTimeout(() => finish({ status: 'TIMEOUT' }), 25000);

      function finish(result) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        clearTimeout(checkTimer);
        clearInterval(interval);
        clearTimeout(hardTimeout);
        resolve(result);
      }

      function scheduleCheck(delayMs) {
        if (done) return;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkNow, delayMs);
      }

      function rowsSignature(rows) {
        return rows.map(row => row.textContent || '').join('\n---\n');
      }

      function checkNow() {
        if (done) return;
        if (!isSearchCurrent()) {
          finish({ status: 'CANCELLED' });
          return;
        }

        if (Date.now() > deadline) {
          finish({ status: 'TIMEOUT' });
          return;
        }

        const container = getResultsContainer();
        if (!container) return;

        const rows = Array.from(container.querySelectorAll('tbody tr'));
        if (rows.length) {
          noAccountStable = 0;
          const queryAligned = isSearchFieldAligned(email);
          if (!queryAligned) {
            if (retryCount < 3) {
              if (triggerSearch(email)) {
                retryCount++;
                lastSearchAt = Date.now();
                scheduleCheck(180);
              } else {
                scheduleCheck(280);
              }
            } else {
              finish({ status: 'NO_RESULT' });
            }
            return;
          }

          const parsed = parseRowsForEmail(rows, email);
          if (parsed.status === 'FOUND') {
            finish(parsed);
            return;
          }
          if (parsed.status === 'NO_DOC') {
            
            
            finish(parsed);
            return;
          }
          if (parsed.status === 'NO_ACCOUNT') {
            finish({ status: 'NO_ACCOUNT' });
            return;
          }
          if (parsed.status === 'NO_MATCH') {
            const fallback = parseVisibleRowsFallback(rows);
            if (fallback) {
              finish(fallback);
              return;
            }
          }

          const sig = rowsSignature(rows);
          if (sig === lastRowsSignature) {
            nonMatchStable++;
          } else {
            lastRowsSignature = sig;
            nonMatchStable = 1;
          }

          if (nonMatchStable >= 2) {
            if (retryCount < 3) {
              if (triggerSearch(email)) {
                retryCount++;
                nonMatchStable = 0;
                lastRowsSignature = '';
                lastSearchAt = Date.now();
                scheduleCheck(180);
              } else {
                scheduleCheck(300);
              }
            } else {
              finish({ status: 'NO_ACCOUNT' });
            }
          }
          return;
        }

        nonMatchStable = 0;
        lastRowsSignature = '';

        const h4 = container.querySelector('h4');
        const text = h4?.textContent?.trim() || '';
        const normText = normalizeText(text);

        if (LOADING_HINTS_NORM.some((hint) => normText.includes(hint))) {
          scheduleCheck(140);
          return;
        }

        if (normText.includes(MSG_NO_RECORD_NORM) || normText.includes('nenhum resultado')) {
          const elapsed = Date.now() - lastSearchAt;
          if (elapsed < MIN_NO_ACCOUNT_DELAY_MS) {
            scheduleCheck((MIN_NO_ACCOUNT_DELAY_MS - elapsed) + 120);
            return;
          }

          noAccountStable++;
          if (noAccountStable >= 2) {
            finish({ status: 'NO_ACCOUNT' });
          } else {
            scheduleCheck(350);
          }
          return;
        }

        noAccountStable = 0;

        if (text === MSG_START_SEARCH || normText.includes(MSG_START_SEARCH_NORM) || normText.includes(MSG_START_SEARCH_ALT_NORM)) {
          if (retryCount < 3) {
            if (triggerSearch(email)) {
              retryCount++;
              lastSearchAt = Date.now();
              scheduleCheck(180);
            } else {
              scheduleCheck(140);
            }
          } else {
            finish({ status: 'NO_RESULT' });
          }
        }
      }

      checkNow();
    });
  }

  return (async () => {
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    await dismissFaturasPopupIfPresent();
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    ensureOrbita();

    const searchUi = await waitForElement('#searchField, #menuSearch', 20000);
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    if (!searchUi) return { status: 'ERROR' };

    await ensureClientes();
    if (!isSearchCurrent()) return { status: 'CANCELLED' };

    if (!(await triggerSearchWithRetry(emailValue))) return { status: 'ERROR' };

    return waitForEmailResult(emailValue);
  })();
}

function boReadEmailSearchResultScript(emailValue) {
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
  const MSG_START_SEARCH_ALT_NORM = 'faca uma pesquisa';
  const MSG_NO_RECORD_NORM = 'nenhum registro';
  const LOADING_HINTS_NORM = ['atualizando', 'carregando', 'refresh'];

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractCanonicalEmail(text) {
    const m = (text || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
    return m ? m[0] : null;
  }

  function splitEmailParts(value) {
    const idx = value.indexOf('@');
    if (idx <= 0) return null;
    return {
      local: value.slice(0, idx),
      domain: value.slice(idx + 1)
    };
  }

  function sameEmailOrBrVariant(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const pa = splitEmailParts(a);
    const pb = splitEmailParts(b);
    if (!pa || !pb) return false;
    if (pa.local !== pb.local) return false;
    return pa.domain === `${pb.domain}.br` || pb.domain === `${pa.domain}.br`;
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function isSearchFieldAligned(email) {
    const targetEmail = extractCanonicalEmail(email);
    if (!targetEmail) return false;
    const currentInputValue = document.querySelector('#searchField')?.value || '';
    const currentEmail = extractCanonicalEmail(currentInputValue);
    return sameEmailOrBrVariant(currentEmail, targetEmail);
  }

  function accountTypeFromRows(matchedRows) {
    let hasParceiro = false;
    let hasCliente = false;

    for (const row of matchedRows) {
      const cells = row.querySelectorAll('td');
      if (!cells.length) continue;
      if (cells[0]?.querySelector('[data-tip="Parceiro"]')) hasParceiro = true;
      else hasCliente = true;
    }

    if (hasParceiro && hasCliente) return 'Consultar tipo';
    if (hasParceiro) return 'Parceiro';
    return 'Cliente';
  }

  function getRowPreviewUrl(row) {
    const preview =
      row?.querySelector?.('a[data-tip="Preview do cliente"][href*="/dashboard/clientes/"]') ||
      row?.querySelector?.('a[href*="/dashboard/clientes/"]');
    return preview?.href || null;
  }

  function hasUsableDocValue(value) {
    const doc = String(value || '').trim();
    if (!doc) return false;
    const norm = doc.toLowerCase();
    return norm !== '-' && norm !== '--' && norm !== 'null';
  }

  function parseRowsForEmail(rows, email) {
    const targetEmail = extractCanonicalEmail(email);
    if (!targetEmail) return { status: 'NO_ACCOUNT' };

    const matched = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const rowEmail = extractCanonicalEmail(cells[2]?.textContent || '') ||
        extractCanonicalEmail(row.textContent || '');
      if (sameEmailOrBrVariant(rowEmail, targetEmail)) matched.push(row);
    }

    if (!matched.length) return { status: 'PENDING' };

    for (const row of matched) {
      const cells = row.querySelectorAll('td');
      const rowName = (cells[1]?.textContent || '').trim();
      const rowDoc = (cells[3]?.textContent || '').trim();
      if (!rowDoc) continue;
      if (hasUsableDocValue(rowDoc)) {
        return {
          status: 'FOUND',
          doc: rowDoc,
          name: rowName || null,
          matchedCount: matched.length,
          accountType: accountTypeFromRows(matched)
        };
      }
    }

    const firstCells = matched[0]?.querySelectorAll('td') || [];
    return {
      status: 'NO_DOC',
      name: (firstCells[1]?.textContent || '').trim() || null,
      matchedCount: matched.length,
      accountType: accountTypeFromRows(matched),
      previewUrl: matched.length === 1 ? getRowPreviewUrl(matched[0]) : null
    };
  }

  const container = getResultsContainer();
  if (!container) return { status: 'NO_CONTAINER' };
  if (!isSearchFieldAligned(emailValue)) return { status: 'STALE_SEARCH' };

  const rows = Array.from(container.querySelectorAll('tbody tr'));
  if (rows.length) return parseRowsForEmail(rows, emailValue);

  const h4 = container.querySelector('h4');
  const normText = normalizeText(h4?.textContent || container.textContent || '');
  if (LOADING_HINTS_NORM.some((hint) => normText.includes(hint))) return { status: 'PENDING' };
  if (normText.includes(MSG_NO_RECORD_NORM) || normText.includes('nenhum resultado')) return { status: 'NO_ACCOUNT' };
  if (normText.includes(MSG_START_SEARCH_NORM) || normText.includes(MSG_START_SEARCH_ALT_NORM)) return { status: 'PENDING' };
  return { status: 'PENDING' };
}

function handleEmailResult(proc, result, boTabId) {
  
  
  if (proc.status === 'ABORTED') return;

  proc.status = 'PROCESSING_EMAIL_RESULT';

  switch (result?.status) {

    case 'NO_ACCOUNT':
      proc.name     = '-';
      proc.doc      = '> Email sem conta';
      proc.accounts = '-';
      proc.accountsSource = null;
      proc.status   = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      break;

    case 'NO_DOC':
      proc.name = result.name ? toTitleCase(result.name) : '-';
      proc.doc      = '> Conta sem doc';
      proc.accounts = shouldLookupNoDocAccountDetail(result)
        ? `? | ${result.accountType || 'Cliente'} - ...`
        : `? | ${result.accountType || 'Cliente'}`;
      proc.accountsSource = 'email';
      proc.status   = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      if (shouldLookupNoDocAccountDetail(result)) {
        scheduleNoDocAccountDetailLookup(proc, boTabId, result.previewUrl, result.accountType || 'Cliente');
      }
      triggerAutoFaturasSearch(proc);
      triggerAutoAssignedActionSearches(proc);
      break;

    case 'FOUND':
      proc.name = result.name ? toTitleCase(result.name) : '-';
      proc.doc = result.doc;
      proc.accounts = '...';
      proc.accountsSource = null;
      proc.docSearchRetryCount = 0;
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      triggerAutoFaturasSearch(proc);
      triggerAutoAssignedActionSearches(proc);
      clearDocSearchStateForProcess(proc, boTabId);
      runDocValidationAndSearch(proc, boTabId);
      break;

    case 'CANCELLED':
      if (normalizeSearchableField(proc.doc) && needsDefinitiveDocAccounts(proc)) {
        clearDocSearchStateForProcess(proc, boTabId);
        runDocValidationAndSearch(proc, boTabId);
      }
      break;

    default:
      proc.doc      = '> Erro na busca';
      proc.accounts = '-';
      proc.accountsSource = null;
      proc.status   = 'ABORTED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      break;
  }
}





function runDocValidationAndSearch(proc, boTabId) {
  
  if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
  const searchKey = partnerDetailLookupKey(proc, boTabId);
  if (isDocSearchRunning(searchKey)) {
    scheduleDocResultWatch(proc, boTabId, proc.doc);
    setTimeout(() => {
      if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
      if (!needsDefinitiveDocAccounts(proc)) return;
      if (boSearchBusy || isDocSearchRunning(searchKey, 1200)) {
        scheduleDocResultWatch(proc, boTabId, proc.doc);
        setTimeout(() => runDocValidationAndSearch(proc, boTabId), 700);
        return;
      }
      runDocValidationAndSearch(proc, boTabId);
    }, 650);
    return;
  }

  proc.status = 'VALIDATING_DOC';

  const digits = proc.doc.replace(/\D/g, '');

  
  if (digits.length !== 11 && digits.length !== 14) {
    proc.accounts = '> Doc. Estrangeiro/Inv\u00e1lido';
    proc.accountsSource = 'doc';
    proc.status = 'COMPLETED';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    triggerAutoFaturasSearch(proc);
    triggerAutoAssignedActionSearches(proc);
    flushPending();
    return;
  }

  if (needsDefinitiveDocAccounts(proc)) {
    proc.accounts = '...';
    proc.accountsSource = null;
    sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
  }

  proc.status = 'SEARCHING_DOC';
  boSearchBusy = true;
  boSearchOwner = proc.processId;
  markDocSearchRunning(searchKey);

  const safetyTimer = setTimeout(() => {
    if (boSearchOwner === proc.processId) {
      boSearchBusy = false;
      boSearchOwner = null;
      clearDocSearchRunning(searchKey);
      flushPending();
    }
  }, 25000);

  runDocSearch(boTabId, proc.doc, { bypassQueue: true })
    .then(result => {
      clearTimeout(safetyTimer);
      boSearchBusy = false;
      boSearchOwner = null;
      if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) {
        flushPending();
        return;
      }
      if (!needsDefinitiveDocAccounts(proc) && result?.status !== 'FOUND') {
        flushPending();
        return;
      }
      handleDocResult(proc, result, boTabId);
      flushPending();
    })
    .catch(() => {
      clearTimeout(safetyTimer);
      boSearchBusy = false;
      boSearchOwner = null;
      if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) {
        flushPending();
        return;
      }
      if (!needsDefinitiveDocAccounts(proc)) {
        flushPending();
        return;
      }
      proc.accounts = '...';
      proc.accountsSource = null;
      proc.status = 'SEARCHING_DOC';
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      scheduleDocResultWatch(proc, boTabId, proc.doc);
      flushPending();
    })
    .finally(() => {
      clearDocSearchRunning(searchKey);
    });
}





function runDocSearch(boTabId, doc, opts = {}) {
  return enqueueSerializedBOSearch(() =>
    chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boDocSearchScript,
      args: [doc]
    }).then(results => results?.[0]?.result ?? { status: 'ERROR' }),
    opts.cooldownMs ?? 90,
    queueKeyForBOTab(boTabId)
  );
}

function readDocSearchResult(boTabId, doc) {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boReadDocSearchResultScript,
    args: [doc]
  }).then(results => results?.[0]?.result ?? { status: 'ERROR' });
}

function scheduleDocResultWatch(proc, boTabId, docValue) {
  if (!proc || !Number.isInteger(boTabId)) return;
  const watchKey = partnerDetailLookupKey(proc, boTabId);
  if (!watchKey || docResultWatchKeys.has(watchKey)) return;
  docResultWatchKeys.add(watchKey);

  const processId = proc.processId;
  const startedAt = Date.now();
  let attempts = 0;

  const clearWatch = () => docResultWatchKeys.delete(watchKey);
  const retryDocSearch = () => {
    if (!isProcessStillValid(proc) || proc.processId !== processId || !canRunBOSearchForProcess(proc)) {
      clearWatch();
      return;
    }
    if (!needsDefinitiveDocAccounts(proc)) {
      clearWatch();
      return;
    }

    proc.docSearchRetryCount = Number(proc.docSearchRetryCount || 0) + 1;
    proc.accounts = '...';
    proc.accountsSource = null;
    proc.status = 'SEARCHING_DOC';
    sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    clearWatch();

    const retryDelay = proc.docSearchRetryCount > 5 ? 5000 : 500;
    setTimeout(() => {
      if (!isProcessStillValid(proc) || proc.processId !== processId || !canRunBOSearchForProcess(proc)) return;
      if (!needsDefinitiveDocAccounts(proc)) return;
      if (boSearchBusy || isDocSearchRunning(partnerDetailLookupKey(proc, boTabId), 1200)) {
        scheduleDocResultWatch(proc, boTabId, docValue);
        return;
      }
      runDocValidationAndSearch(proc, boTabId);
    }, retryDelay);
  };

  const tick = () => {
    if (!isProcessStillValid(proc) || proc.processId !== processId || !canRunBOSearchForProcess(proc)) {
      clearWatch();
      return;
    }
    if (!needsDefinitiveDocAccounts(proc) && !isPendingProcessField(proc.accounts)) {
      clearWatch();
      return;
    }
    if (Date.now() - startedAt > 15000 || attempts >= 30) {
      retryDocSearch();
      return;
    }

    attempts++;
    readDocSearchResult(boTabId, docValue)
      .then((result) => {
        if (!isProcessStillValid(proc) || proc.processId !== processId || !canRunBOSearchForProcess(proc)) return;
        if (!isFinalDocSearchStatus(result?.status)) return;
        handleDocResult(proc, { ...result, secondPass: true }, boTabId);
        clearWatch();
      })
      .catch(() => {})
      .finally(() => {
        if (!docResultWatchKeys.has(watchKey)) return;
        setTimeout(tick, attempts < 6 ? 350 : 700);
      });
  };

  setTimeout(tick, 350);
}

function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => finish(false), timeoutMs);

    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') finish(true);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(false);
        return;
      }
      if (tab?.status === 'complete') finish(true);
    });
  });
}

function createInactiveTabNear(openerTabId, url) {
  return new Promise(resolve => {
    chrome.tabs.get(openerTabId, (opener) => {
      // Chrome exposes splitViewId for observing/querying Split View tabs, but
      // does not currently expose an extension API to create a native Split View.
      // Keep this as an inactive, short-lived tab instead of loading BO twice in BO1.
      const createProps = { url, active: false, openerTabId };
      if (!chrome.runtime.lastError && opener) {
        createProps.windowId = opener.windowId;
        if (Number.isInteger(opener.index)) createProps.index = opener.index + 1;
      }

      chrome.tabs.create(createProps, (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          resolve(null);
          return;
        }
        resolve(tab);
      });
    });
  });
}

async function readPartnerDetailFromPreviewUrl(openerTabId, previewUrl) {
  const tab = await createInactiveTabNear(openerTabId, previewUrl);
  if (!tab?.id) return { status: 'ERROR' };

  try {
    await waitForTabLoad(tab.id, 20000);
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: boReadPartnerDetailFromCurrentPreviewScript
      }).catch(() => null);
      const detailResult = results?.[0]?.result;
      if (detailResult?.status === 'FOUND') return detailResult;
      await new Promise(resolve => setTimeout(resolve, 220));
    }
    return { status: 'NO_DETAIL' };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function readSinglePartnerDetail(boTabId, doc, previewUrl = null) {
  if (previewUrl) return readPartnerDetailFromPreviewUrl(boTabId, previewUrl);

  return enqueueSerializedBOSearch(() =>
    chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boReadSinglePartnerDetailScript,
      args: [doc]
    }).then(async (results) => {
      const result = results?.[0]?.result ?? { status: 'ERROR' };
      if (result?.status === 'PREVIEW_URL' && result.url) {
        return readPartnerDetailFromPreviewUrl(boTabId, result.url);
      }
      return result;
    }),
    40,
    queueKeyForBOTab(boTabId)
  );
}








function boDocSearchScript(docValue) {
  
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
  const MSG_START_SEARCH_ALT_NORM = 'faca uma pesquisa';
  const MSG_NO_RECORD_NORM = 'nenhum registro';
  const LOADING_HINTS_NORM = ['atualizando', 'carregando', 'refresh', 'refreshing'];
  const SEARCH_TRIGGER_MIN_GAP_MS = 120;
  const searchToken = `doc:${docValue}:${Date.now()}:${Math.random()}`;
  let lastSearchTriggerAt = 0;

  globalThis.__ticketHelperBO1SearchToken = searchToken;

  function isSearchCurrent() {
    return globalThis.__ticketHelperBO1SearchToken === searchToken;
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickElement(el) {
    if (!isSearchCurrent()) return;
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function findFaturasPopup() {
    const candidates = Array.from(document.querySelectorAll('.css-5qctmg, [tabindex="-1"], [role="dialog"], .MuiDialog-root, .MuiPopover-root'))
      .filter(isVisible);
    return candidates.find((el) => {
      const text = normalizeText(el.textContent || '');
      return text.includes('status da fatura') ||
        (text.includes('fatura') && text.includes('produto') && text.includes('valor'));
    }) || null;
  }

  async function dismissFaturasPopupIfPresent() {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!isSearchCurrent()) return false;
      const popup = findFaturasPopup();
      if (!popup) return true;

      const closeBtn = Array.from(popup.querySelectorAll('button, [role="button"], [aria-label]'))
        .filter(isVisible)
        .find((el) => {
          const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '');
          return label.includes('fechar') || label.includes('close') || label === 'x';
        });

      if (closeBtn) clickElement(closeBtn);
      else {
        const escDown = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        const escUp = new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        popup.dispatchEvent(escDown);
        document.dispatchEvent(escDown);
        window.dispatchEvent(escDown);
        popup.dispatchEvent(escUp);
        document.dispatchEvent(escUp);
        window.dispatchEvent(escUp);
      }

      await delay(80);
    }

    return !findFaturasPopup();
  }

  async function ensureOrbita() {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (!isSearchCurrent()) return false;
      const item = document.querySelector('#MyEduzz');
      if (!item) {
        await delay(60);
        continue;
      }
      if (item.classList.contains('checked')) return true;
      clickElement(item.querySelector('a') || item);
      await delay(120);
      if (item.classList.contains('checked') || document.querySelector('#MyEduzz.checked')) return true;
    }
    return !!document.querySelector('#MyEduzz.checked');
  }

  async function ensureClientes() {
    function getSearchCategoryButton() {
      const direct = document.querySelector('#menuSearch');
      if (direct && isVisible(direct)) return direct;

      const input = document.querySelector('#searchField');
      if (input) {
        const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
        const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
        if (rootBtn && isVisible(rootBtn)) return rootBtn;

        const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
        const localBtn =
          inputRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          null;
        if (localBtn && isVisible(localBtn)) return localBtn;
      }

      const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]'))
        .filter(isVisible);
      return candidates.find((el) => {
        const txt = normalizeText(el.querySelector('span')?.textContent || el.textContent || '');
        return txt.includes('cliente') || txt.includes('curso') || txt.includes('fatura') || txt.includes('produto');
      }) || candidates[0] || null;
    }

    function isClientesSelected(baseBtn) {
      const activeBtn = getSearchCategoryButton() || baseBtn;
      const current = normalizeText(activeBtn?.querySelector('span')?.textContent || activeBtn?.textContent || '');
      return current.includes('cliente');
    }

    function findClientesOption() {
      const byId = Array.from(document.querySelectorAll('#menuClientes, [id*="menuClientes"]'))
        .filter(isVisible);
      if (byId.length) return byId[0];

      const nodes = Array.from(document.querySelectorAll(
        '[role="menu"] [role="menuitem"], [role="listbox"] [role="option"], [role="menuitem"], [role="option"], li, button'
      )).filter(isVisible);

      let contains = null;
      for (const node of nodes) {
        const txt = normalizeText(node.textContent || '');
        if (!txt) continue;
        if (txt === 'clientes' || txt === 'cliente') return node;
        if (!contains && txt.includes('cliente')) contains = node;
      }
      return contains;
    }

    const btn = getSearchCategoryButton();
    if (!btn) return !!document.querySelector('#searchField');

    if (isClientesSelected(btn)) return true;

    for (let attempt = 0; attempt < 4; attempt++) {
      clickElement(btn);
      await delay(140);

      let item = null;
      const start = Date.now();
      while (!item && Date.now() - start < 2200) {
        item = findClientesOption();
        if (item) break;
        await delay(90);
      }

      if (item) {
        clickElement(item);
        await delay(220);
      }

      if (isClientesSelected(btn)) return true;
      await delay(120);
    }

    return !!document.querySelector('#searchField');
  }

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input) return false;

    const now = Date.now();
    if (now - lastSearchTriggerAt < SEARCH_TRIGGER_MIN_GAP_MS) return false;

    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);
    const ariaDisabled = (btn?.getAttribute('aria-disabled') || '').toLowerCase();
    if (btn && !btn.disabled && ariaDisabled !== 'true' && isVisible(btn)) {
      clickElement(btn);
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    lastSearchTriggerAt = Date.now();
    return true;
  }

  async function triggerSearchSoon(value) {
    const deadline = Date.now() + 900;
    while (Date.now() < deadline) {
      if (!isSearchCurrent()) return false;
      if (triggerSearch(value)) return true;
      await delay(25);
    }
    return false;
  }

  function parseDocRows(rows, doc) {
    function normalizeDoc(value) {
      return (value || '').replace(/\D/g, '');
    }

    function hasPartnerRowBadge(cells) {
      return !!cells[1]?.querySelector('[data-tip] img, [data-tip] .material-icons');
    }

    const targetDoc = normalizeDoc(doc);
    if (!targetDoc) return { status: 'NO_ACCOUNT' };

    let count = 0;
    let hasParceiro = false;
    let parceiroCount = 0;
    let partnerBadgeRowCount = 0;
    const partnerPreviewUrls = [];
    const partnerBadgePreviewUrls = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const rowDoc = normalizeDoc(cells[3]?.textContent || '');
      if (rowDoc !== targetDoc) continue;

      count++;
      if (cells[0].querySelector('[data-tip="Parceiro"]')) {
        hasParceiro = true;
        parceiroCount++;
        const preview =
          row.querySelector('a[data-tip="Preview do cliente"][href*="/dashboard/clientes/"]') ||
          row.querySelector('a[href*="/dashboard/clientes/"]');
        if (preview?.href) partnerPreviewUrls.push(preview.href);
        if (hasPartnerRowBadge(cells)) {
          partnerBadgeRowCount++;
          if (preview?.href) partnerBadgePreviewUrls.push(preview.href);
        }
      }
    }

    if (count === 0) return { status: 'NO_MATCH' };
    const partnerPreviewUrl =
      partnerBadgePreviewUrls.length === 1
        ? partnerBadgePreviewUrls[0]
        : (parceiroCount === 1 && partnerPreviewUrls.length === 1 ? partnerPreviewUrls[0] : null);
    return {
      status: 'FOUND',
      count,
      hasParceiro,
      parceiroCount,
      partnerBadgeRowCount,
      partnerDetailLookup: parceiroCount === 1 || partnerBadgeRowCount === 1,
      partnerPreviewUrl
    };
  }

  function waitForDocResult(doc) {
    return new Promise(resolve => {
      const root = document.documentElement || document.body;
      const deadline = Date.now() + 25000;
      let done = false;
      let stableCount = 0;
      let noMatchStableCount = 0;
      let emptyStableCount = 0;
      let lastSignature = '';
      let checkTimer = null;
      let secondSearchStarted = false;
      let secondSearchConfirmedAt = 0;
      let firstMultiPartnerSeenAt = 0;
      let ignoredSecondSearchSignature = '';
      let searchRetryInFlight = false;

      const observer = root
        ? new MutationObserver(() => scheduleCheck(120))
        : null;

      if (observer) observer.observe(root, { childList: true, subtree: true, characterData: true });

      const interval = setInterval(() => scheduleCheck(0), 1000);
      const hardTimeout = setTimeout(() => finish({ status: 'TIMEOUT' }), 25000);

      function finish(result) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        clearTimeout(checkTimer);
        clearInterval(interval);
        clearTimeout(hardTimeout);
        resolve(result);
      }

      function scheduleCheck(delayMs) {
        if (done) return;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkNow, delayMs);
      }

      function rowsSignature(rows) {
        return rows.map(row => row.textContent || '').join('\n---\n');
      }

      function requestSearchSoon() {
        if (searchRetryInFlight) return;
        searchRetryInFlight = true;
        triggerSearchSoon(doc)
          .then((triggered) => {
            if (triggered) secondSearchConfirmedAt = Date.now();
          })
          .finally(() => {
            searchRetryInFlight = false;
          });
      }

      function checkNow() {
        if (done) return;
        if (!isSearchCurrent()) {
          finish({ status: 'CANCELLED' });
          return;
        }

        if (Date.now() > deadline) {
          finish({ status: 'TIMEOUT' });
          return;
        }

        const container = getResultsContainer();
        if (!container) return;

        const rows = Array.from(container.querySelectorAll('tbody tr'));
        if (rows.length) {
          const parsed = parseDocRows(rows, doc);
          if (parsed.status === 'FOUND' && !secondSearchStarted) {
            secondSearchStarted = true;
            stableCount = 0;
            noMatchStableCount = 0;
            emptyStableCount = 0;
            lastSignature = '';
            firstMultiPartnerSeenAt = 0;
            ignoredSecondSearchSignature = rowsSignature(rows);
            requestSearchSoon();
            scheduleCheck(120);
            return;
          }

          if (
            parsed.status === 'FOUND' &&
            parsed.hasParceiro &&
            Number(parsed.parceiroCount || 0) > 1 &&
            !parsed.partnerDetailLookup
          ) {
            if (!firstMultiPartnerSeenAt) firstMultiPartnerSeenAt = Date.now();
            if (Date.now() - firstMultiPartnerSeenAt < 1200) {
              scheduleCheck(180);
              return;
            }
          }

          const sig = rowsSignature(rows);
          if (
            parsed.status === 'FOUND' &&
            secondSearchStarted &&
            ignoredSecondSearchSignature &&
            sig === ignoredSecondSearchSignature &&
            (!secondSearchConfirmedAt || Date.now() - secondSearchConfirmedAt < 260)
          ) {
            stableCount = 0;
            scheduleCheck(80);
            return;
          }

          if (sig === lastSignature) {
            stableCount++;
          } else {
            lastSignature = sig;
            stableCount = 1;
          }

          const requiredStableCount = secondSearchStarted ? 1 : 2;
          if (stableCount < requiredStableCount) {
            scheduleCheck(secondSearchStarted ? 80 : 180);
            return;
          }

          if (parsed.status === 'FOUND') {
            finish({ ...parsed, secondPass: true });
            return;
          }

          noMatchStableCount++;
          if (noMatchStableCount >= 4) {
            finish({ status: 'NO_ACCOUNT' });
            return;
          }

          scheduleCheck(600);
          return;
        }

        stableCount = 0;
        lastSignature = '';
        noMatchStableCount = 0;

        const h4 = container.querySelector('h4');
        const text = h4?.textContent?.trim() || '';
        const normText = normalizeText(text);

        if (LOADING_HINTS_NORM.some((hint) => normText.includes(hint))) {
          scheduleCheck(120);
          return;
        }

        if (normText.includes(MSG_NO_RECORD_NORM)) {
          emptyStableCount++;
          if (emptyStableCount < 3) {
            scheduleCheck(700);
            return;
          }
          finish({ status: 'NO_ACCOUNT' });
          return;
        }

        if (text === MSG_START_SEARCH || normText.includes(MSG_START_SEARCH_NORM) || normText.includes(MSG_START_SEARCH_ALT_NORM)) {
          emptyStableCount++;
          if (emptyStableCount <= 2) {
            requestSearchSoon();
            scheduleCheck(160);
          } else if (emptyStableCount < 5) {
            scheduleCheck(220);
          } else {
            finish({ status: 'NO_RESULT' });
          }
        }
      }

      checkNow();
    });
  }

  return (async () => {
    await dismissFaturasPopupIfPresent();
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    if (!(await ensureOrbita())) return { status: 'ERROR' };
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    await ensureClientes();
    if (!isSearchCurrent()) return { status: 'CANCELLED' };
    if (!(await triggerSearchSoon(docValue))) return { status: 'ERROR' };
    return waitForDocResult(docValue);
  })();
}

function boReadDocSearchResultScript(docValue) {
  function normalizeDoc(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function isSearchFieldAligned(doc) {
    const expected = normalizeDoc(doc);
    if (!expected) return true;
    const input = document.querySelector('#searchField');
    const current = normalizeDoc(input?.value || '');
    return !!current && current === expected;
  }

  function parseDocRows(rows, doc) {
    const targetDoc = normalizeDoc(doc);
    if (!targetDoc) return { status: 'NO_MATCH' };

    function hasPartnerRowBadge(cells) {
      return !!cells[1]?.querySelector('[data-tip] img, [data-tip] .material-icons');
    }

    let count = 0;
    let hasParceiro = false;
    let parceiroCount = 0;
    let partnerBadgeRowCount = 0;
    const partnerPreviewUrls = [];
    const partnerBadgePreviewUrls = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const rowDoc = normalizeDoc(cells[3]?.textContent || '');
      if (rowDoc !== targetDoc) continue;

      count++;
      if (cells[0].querySelector('[data-tip="Parceiro"]')) {
        hasParceiro = true;
        parceiroCount++;
        const preview =
          row.querySelector('a[data-tip="Preview do cliente"][href*="/dashboard/clientes/"]') ||
          row.querySelector('a[href*="/dashboard/clientes/"]');
        if (preview?.href) partnerPreviewUrls.push(preview.href);
        if (hasPartnerRowBadge(cells)) {
          partnerBadgeRowCount++;
          if (preview?.href) partnerBadgePreviewUrls.push(preview.href);
        }
      }
    }

    if (!count) return { status: 'NO_MATCH' };
    const partnerPreviewUrl =
      partnerBadgePreviewUrls.length === 1
        ? partnerBadgePreviewUrls[0]
        : (parceiroCount === 1 && partnerPreviewUrls.length === 1 ? partnerPreviewUrls[0] : null);
    return {
      status: 'FOUND',
      count,
      hasParceiro,
      parceiroCount,
      partnerBadgeRowCount,
      partnerDetailLookup: parceiroCount === 1 || partnerBadgeRowCount === 1,
      partnerPreviewUrl
    };
  }

  const container = getResultsContainer();
  if (!container) return { status: 'NO_CONTAINER' };
  if (!isSearchFieldAligned(docValue)) return { status: 'STALE_SEARCH' };

  const rows = Array.from(container.querySelectorAll('tbody tr'));
  if (!rows.length) {
    const text = normalizeText(container.textContent || '');
    if (text.includes('nenhum registro') || text.includes('nenhum resultado')) {
      return { status: 'NO_ROWS' };
    }
    if (text.includes('faca uma busca para comecar') || text.includes('faca uma pesquisa')) return { status: 'NO_ROWS' };
    return { status: 'NO_ROWS' };
  }

  return parseDocRows(rows, docValue);
}

function boReadSinglePartnerDetailScript(docValue) {
  function normalizeDoc(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function findSinglePartnerPreviewButton(doc) {
    const targetDoc = normalizeDoc(doc);
    if (!targetDoc) return null;
    const container = getResultsContainer();
    if (!container) return null;

    const matches = [];
    const badgeMatches = [];
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const rowDoc = normalizeDoc(cells[3]?.textContent || '');
      if (rowDoc !== targetDoc) continue;
      if (!cells[0].querySelector('[data-tip="Parceiro"]')) continue;

      const preview =
        row.querySelector('a[data-tip="Preview do cliente"][href*="/dashboard/clientes/"]') ||
        row.querySelector('a[href*="/dashboard/clientes/"]');
      if (!preview) continue;
      matches.push(preview);
      if (cells[1]?.querySelector('[data-tip] img, [data-tip] .material-icons')) badgeMatches.push(preview);
    }

    if (badgeMatches.length === 1) return badgeMatches[0];
    return matches.length === 1 ? matches[0] : null;
  }

  function clickElement(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function getPartnerDetailFromDocument(rootDoc) {
    if (!rootDoc) return null;
    const root =
      rootDoc.querySelector('.clientDetails') ||
      rootDoc.querySelector('[class*="clientDetails"]') ||
      rootDoc;
    const iconBoxes = Array.from(root.querySelectorAll('.justify-icons-v2'));

    for (const box of iconBoxes) {
      const firstIcon = Array.from(box.querySelectorAll('[data-tip]'))
        .map(el => normalizeText(el.getAttribute('data-tip') || el.textContent || ''))
        .find(Boolean);
      if (firstIcon) return firstIcon;
    }

    return null;
  }

  function getPartnerDetailFromPreview() {
    return getPartnerDetailFromDocument(document);
  }

  async function waitForPartnerDetail() {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const detail = getPartnerDetailFromPreview();
      if (detail) return detail;
      await delay(180);
    }
    return null;
  }

  return (async () => {
    const currentDetail = getPartnerDetailFromPreview();
    if (currentDetail) return { status: 'FOUND', detail: currentDetail };

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      const preview = findSinglePartnerPreviewButton(docValue);
      if (preview) return { status: 'PREVIEW_URL', url: preview.href };
      await delay(160);
    }

    return { status: 'NO_SINGLE_PARTNER' };
  })();
}

function boReadPartnerDetailFromCurrentPreviewScript() {
  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getPartnerDetailFromPreview() {
    const root =
      document.querySelector('.clientDetails') ||
      document.querySelector('[class*="clientDetails"]') ||
      document;
    const iconBoxes = Array.from(root.querySelectorAll('.justify-icons-v2'));

    for (const box of iconBoxes) {
      const firstIcon = Array.from(box.querySelectorAll('[data-tip]'))
        .map(el => normalizeText(el.getAttribute('data-tip') || el.textContent || ''))
        .find(Boolean);
      if (firstIcon) return firstIcon;
    }

    return null;
  }

  const detail = getPartnerDetailFromPreview();
  if (!detail) return { status: 'NO_DETAIL' };
  return { status: 'FOUND', detail };
}

function formatAccountsLabelFromDocResult(result) {
  if (!result || result.status !== 'FOUND') return '';
  if (result.count === 10) return '9+ | Consultar tipo';
  const partnerSuffix = formatPartnerSuffixFromDocResult(result);
  const type = result.hasParceiro ? `Parceiro${partnerSuffix}` : 'Cliente';
  return `${result.count} | ${type}`;
}

function formatPartnerSuffixFromDocResult(result) {
  if (!result?.hasParceiro) return '';
  if (result.partnerDetailLookup) return ' - ...';
  const parceiroCount = Number(result.parceiroCount || 0);
  if (parceiroCount > 1) return ` - ${parceiroCount}`;
  if (parceiroCount === 1) return ' - ...';
  return '';
}

function shouldLookupPartnerDetail(result) {
  if (!result?.hasParceiro) return false;
  return Number(result.parceiroCount || 0) === 1 || result.partnerDetailLookup === true;
}

function formatAccountsLabelWithPartnerDetail(result, detail) {
  if (!result || result.status !== 'FOUND') return '';
  if (!result.hasParceiro) return formatAccountsLabelFromDocResult(result);
  if (result.count === 10) return '9+ | Consultar tipo';
  const label = String(detail || '').trim() || '...';
  return `${result.count} | Parceiro - ${label}`;
}

function countFromAccountsLabel(value) {
  const count = Number(String(value || '').match(/^\s*(\d+)/)?.[1] || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function scheduleDocAccountsRefresh(proc, boTabId) {
  if (!proc) return;
  if (!Number.isInteger(boTabId)) return;
  const lookupKey = partnerDetailLookupKey(proc, boTabId);
  if (lookupKey && docAccountsRefreshKeys.has(lookupKey)) return;
  if (lookupKey) docAccountsRefreshKeys.add(lookupKey);
  const processId = proc.processId;
  const docToCheck = proc.doc;

  setTimeout(() => {
    const clearRefreshKey = () => {
      if (lookupKey) docAccountsRefreshKeys.delete(lookupKey);
    };
    if (!isProcessStillValid(proc)) {
      clearRefreshKey();
      return;
    }
    if (proc.processId !== processId) {
      clearRefreshKey();
      return;
    }
    if (!hasValidDocLength(docToCheck)) {
      clearRefreshKey();
      return;
    }
    if (boSearchBusy) {
      clearRefreshKey();
      return;
    }

    readDocSearchResult(boTabId, docToCheck)
      .then((nextResult) => {
        if (!isProcessStillValid(proc)) return;
        if (proc.processId !== processId) return;
        if (nextResult?.status !== 'FOUND') return;

        const nextAccounts = formatAccountsLabelFromDocResult(nextResult);
        const shouldLookupSinglePartner = shouldLookupPartnerDetail(nextResult);

        if (!nextAccounts) return;
        if (
          shouldLookupSinglePartner &&
          String(proc.accounts || '').includes('Parceiro - ') &&
          !String(proc.accounts || '').includes('Parceiro - ...')
        ) {
          return;
        }

        if (nextAccounts !== proc.accounts || proc.accountsSource !== 'doc') {
          proc.accounts = nextAccounts;
          proc.accountsSource = 'doc';
          sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
          updateCacheFromProcess(proc);
        }

        if (shouldLookupSinglePartner && isPartnerDetailPendingAccounts(proc.accounts)) {
          scheduleSinglePartnerDetailLookup(proc, nextResult, boTabId);
        }
      })
      .catch(() => {})
      .finally(() => {
        clearRefreshKey();
      });
  }, 2000);
}

function scheduleSinglePartnerDetailLookup(proc, result, boTabId) {
  if (!proc) return;
  if (!result?.hasParceiro) return;
  if (!shouldLookupPartnerDetail(result)) return;
  if (!Number.isInteger(boTabId)) return;
  if (!isPartnerDetailPendingAccounts(proc.accounts)) return;

  const processId = proc.processId;
  const docToCheck = proc.doc;
  const lookupKey = partnerDetailLookupKey(proc, boTabId);
  if (!lookupKey) return;
  if (docAccountsRefreshKeys.has(lookupKey)) return;
  const resultCount = Number(result.count || 0);
  const existingState = partnerDetailLookupStates.get(lookupKey);
  if (existingState?.state === 'pending' && Number(existingState.count || 0) >= resultCount) return;
  if (existingState?.state === 'done' && Number(existingState.count || 0) >= resultCount) return;

  const lookupToken = uid();
  partnerDetailLookupStates.set(lookupKey, {
    state: 'pending',
    token: lookupToken,
    count: resultCount
  });

  const isLookupCurrent = () => {
    const state = partnerDetailLookupStates.get(lookupKey);
    return state?.state === 'pending' && state.token === lookupToken;
  };

  setTimeout(() => {
    if (!isLookupCurrent()) return;
    if (!isProcessStillValid(proc)) {
      partnerDetailLookupStates.set(lookupKey, { state: 'done', count: resultCount });
      return;
    }
    if (proc.processId !== processId) {
      partnerDetailLookupStates.set(lookupKey, { state: 'done', count: resultCount });
      return;
    }
    if (!canRunBOSearchForProcess(proc)) {
      partnerDetailLookupStates.set(lookupKey, { state: 'done', count: resultCount });
      return;
    }
    if (!hasValidDocLength(docToCheck)) {
      partnerDetailLookupStates.set(lookupKey, { state: 'done', count: resultCount });
      return;
    }
    if (!isPartnerDetailPendingAccounts(proc.accounts)) {
      partnerDetailLookupStates.set(lookupKey, { state: 'done', count: resultCount });
      return;
    }

    readSinglePartnerDetail(boTabId, docToCheck, result.partnerPreviewUrl)
      .then((detailResult) => {
        if (!isLookupCurrent()) return;
        if (!isProcessStillValid(proc)) return;
        if (proc.processId !== processId) return;
        if (detailResult?.status !== 'FOUND') return;

        const currentCount = countFromAccountsLabel(proc.accounts);
        const resultForDetail = {
          ...result,
          count: Math.max(Number(result.count || 0), currentCount)
        };
        const nextAccounts = formatAccountsLabelWithPartnerDetail(resultForDetail, detailResult.detail);
        if (!nextAccounts) return;
        if (nextAccounts === proc.accounts && proc.accountsSource === 'doc') return;

        proc.accounts = nextAccounts;
        proc.accountsSource = 'doc';
        sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
        updateCacheFromProcess(proc);
      })
      .catch(() => {})
      .finally(() => {
        if (isLookupCurrent()) {
          const currentCount = countFromAccountsLabel(proc.accounts);
          partnerDetailLookupStates.set(lookupKey, {
            state: 'done',
            count: Math.max(resultCount, currentCount)
          });
        }
      });
  }, 0);
}

function handleDocResult(proc, result, boTabId) {
  
  if (!isProcessStillValid(proc)) return;

  proc.status = 'PROCESSING_DOC_RESULT';

  switch (result?.status) {

    case 'NO_ACCOUNT':
    case 'NO_RESULT':
    case 'TIMEOUT':
      proc.status = 'SEARCHING_DOC';
      scheduleDocResultWatch(proc, boTabId, proc.doc);
      break;

    case 'CANCELLED':
      proc.status = 'SEARCHING_DOC';
      scheduleDocResultWatch(proc, boTabId, proc.doc);
      break;

    case 'FOUND':
      proc.docSearchRetryCount = 0;
      proc.accounts = formatAccountsLabelFromDocResult(result);
      proc.accountsSource = 'doc';
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      
      scheduleSinglePartnerDetailLookup(proc, result, boTabId);
      break;

    default:
      proc.accounts = '> Erro na busca doc';
      proc.accountsSource = null;
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      break;
  }

  updateCacheFromProcess(proc);
}

function triggerAutoFaturasSearch(proc, opts = {}) {
  if (!proc) return;
  if (!canRunBOSearchForProcess(proc)) return;
  const cfg = getBOActionConfig('faturas');
  const searchTarget = cfg.resolveSearchValue({
    doc: proc.doc,
    email: proc.email,
    accounts: proc.accounts
  });
  if (!searchTarget?.value) return;

  const runOnTab = (boTab) => {
    if (!boTab) return;
    if (!canRunBOSearchForProcess(proc)) return;
    runOrReuseBOActionSearch({
      boTabId: boTab.id,
      actionKey: 'faturas',
      proc,
      searchValue: searchTarget.value,
      force: !!opts.force
    }).catch(() => {});
  };

  resolveAssignedBOActionTab('faturas', (boTab) => {
    runOnTab(boTab);
  });

  if (Number.isInteger(boTab2Id) && Number.isInteger(boActionTabIds.faturas) && boActionTabIds.faturas !== boTab2Id) {
    resolveAssignedBOTab2((boTab) => {
      if (!boTab) return;
      if (boActionTabIds.faturas && boTab.id === boActionTabIds.faturas) return;
      runOnTab(boTab);
    });
  }
}

function triggerAutoAssignedActionSearches(proc, opts = {}) {
  if (!proc) return;
  if (!canRunBOSearchForProcess(proc)) return;

  for (const cfg of [getBOActionConfig('nutror'), getBOActionConfig('contratos')]) {
    if (!cfg) continue;
    if (!Number.isInteger(boActionTabIds[cfg.key])) continue;

    const searchTarget = cfg.resolveSearchValue({
      doc: proc.doc,
      email: proc.email,
      accounts: proc.accounts
    });
    if (!searchTarget?.value) continue;

    resolveAssignedBOActionTab(cfg.key, (boTab) => {
      if (!boTab) return;
      if (!canRunBOSearchForProcess(proc)) return;
      runOrReuseBOActionSearch({
        boTabId: boTab.id,
        actionKey: cfg.key,
        proc,
        searchValue: searchTarget.value,
        force: !!opts.force
      }).catch(() => {});
    });
  }
}

function runFaturasSearch(boTabId, searchValue, op = null, proc = null, opts = {}) {
  return enqueueSerializedBOSearch(() =>
    shouldRunBOActionScript(op, proc)
      ? chrome.scripting.executeScript({
        target: { tabId: boTabId },
        func: boFaturasSearchScript,
        args: [searchValue, op?.token || null]
      }).then(results => results?.[0]?.result ?? { status: 'ERROR' })
      : Promise.resolve({ status: 'STALE_CONTEXT' }),
    opts.cooldownMs ?? 90,
    queueKeyForBOTab(boTabId),
    opts.queueVersion
  );
}

function runNutrorSearch(boTabId, searchValue, op = null, proc = null, opts = {}) {
  return enqueueSerializedBOSearch(() =>
    runSectionSearchScriptWithRetry(boTabId, searchValue, 'Nutror', op, proc),
    opts.cooldownMs ?? 90,
    queueKeyForBOTab(boTabId),
    opts.queueVersion
  );
}

function runContratosSearch(boTabId, searchValue, op = null, proc = null, opts = {}) {
  return enqueueSerializedBOSearch(() =>
    runSectionSearchScriptWithRetry(boTabId, searchValue, 'Next', op, proc),
    opts.cooldownMs ?? 90,
    queueKeyForBOTab(boTabId),
    opts.queueVersion
  );
}

async function runSectionSearchScriptWithRetry(boTabId, searchValue, sectionId, op = null, proc = null) {
  const retryableStatuses = new Set(['ERROR']);
  const retryDelays = [420, 700];

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (!shouldRunBOActionScript(op, proc)) return { status: 'STALE_CONTEXT' };

    const result = await chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boSectionSearchScript,
      args: [searchValue, sectionId, op?.token || null]
    })
      .then(results => results?.[0]?.result ?? { status: 'ERROR' })
      .catch(() => ({ status: 'ERROR' }));

    if (!shouldRunBOActionScript(op, proc)) return { status: 'STALE_CONTEXT' };
    if (!retryableStatuses.has(String(result?.status || ''))) return result;
    if (attempt >= retryDelays.length) return result;

    await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
  }

  return { status: 'ERROR' };
}

function hasVisibleFaturasResults(boTabId, expectedSearchValue = '') {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boHasVisibleFaturasResultsScript,
    args: [expectedSearchValue]
  }).then(results => Boolean(results?.[0]?.result));
}

function hasVisibleSectionResults(boTabId, sectionId, expectedSearchValue = '') {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boHasVisibleSectionResultsScript,
    args: [sectionId, expectedSearchValue]
  }).then(results => Boolean(results?.[0]?.result));
}

function hasBOActionSearchContext(boTabId, actionKey, expectedSearchValue = '') {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boActionSearchContextMatchesScript,
    args: [actionKey, expectedSearchValue]
  }).then(results => Boolean(results?.[0]?.result));
}

function getBOActionConfig(actionKeyArg) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (actionKey === 'faturas') {
    return {
      key: 'faturas',
      actionType: 'FATURAS_SEARCH',
      sectionId: null,
      resolveSearchValue: resolveFaturasSearchValue,
      runSearch: runFaturasSearch,
      hasVisibleResults: (tabId, value) => hasVisibleFaturasResults(tabId, value),
      marksCompleted: (result) => result?.status === 'FOUND',
      requiresVisibleProof: true
    };
  }
  if (actionKey === 'nutror') {
    return {
      key: 'nutror',
      actionType: 'NUTROR_SEARCH',
      sectionId: 'Nutror',
      resolveSearchValue: resolveNutrorSearchValue,
      runSearch: runNutrorSearch,
      hasVisibleResults: (tabId, value) => hasVisibleSectionResults(tabId, 'Nutror', value),
      marksCompleted: (result) => ['FOUND', 'NO_RESULT'].includes(result?.status)
    };
  }
  if (actionKey === 'contratos') {
    return {
      key: 'contratos',
      actionType: 'CONTRATOS_SEARCH',
      sectionId: 'Next',
      resolveSearchValue: resolveContratosSearchValue,
      runSearch: runContratosSearch,
      hasVisibleResults: (tabId, value) => hasVisibleSectionResults(tabId, 'Next', value),
      marksCompleted: (result) => ['FOUND', 'NO_RESULT'].includes(result?.status),
      alwaysRunOnButton: true
    };
  }
  return null;
}

function runOrReuseBOActionSearch({ boTabId, actionKey, proc, searchValue, force = false, source = 'auto' }) {
  const cfg = getBOActionConfig(actionKey);
  if (!cfg || !Number.isInteger(boTabId) || !proc || !searchValue) {
    return Promise.resolve({ ok: false, reason: 'INVALID_ACTION' });
  }

  const currentValue = normalizeBOActionSearchValue(searchValue);
  const isButtonClick = source === 'button';
  const requestKey = getBOActionRequestKey(boTabId, cfg.key, currentValue, proc);
  if (!force && requestKey && boActionInFlightPromises.has(requestKey)) {
    return boActionInFlightPromises.get(requestKey);
  }

  const currentState = getBOActionState(boTabId, cfg.key, currentValue, proc);
  const stateMatches = !!currentState;
  const shouldForceButtonRun = isButtonClick && cfg.alwaysRunOnButton;
  cancelBOActionOperationsForTab(boTabId);
  resetBOExecutionQueueForTab(boTabId);
  stampBOActionPageRun(boTabId, {
    token: uid(),
    actionKey: cfg.key,
    searchValue: currentValue,
    ticketId: proc.ticketId || null
  });

  const runSearchNow = () => {
    if (!canRunBOSearchForProcess(proc)) {
      return Promise.resolve({ ok: false, reason: 'EXTENSION_DISABLED' });
    }
    cancelBOActionOperationsForTab(boTabId);
    const op = startBOActionOperation(boTabId, cfg.key, currentValue, proc);
    const queueVersion = resetBOExecutionQueueForTab(boTabId);
    return stampBOActionPageRun(boTabId, op)
      .then(() => cfg.runSearch(boTabId, currentValue, op, proc, { queueVersion }))
      .then((result) => {
        if (result?.status === 'STALE_CONTEXT' || result?.status === 'STALE_QUEUE') {
          return { ok: true, ignored: true, reason: 'STALE_CONTEXT' };
        }
        if (!isBOActionOperationCurrent(op, proc)) {
          return { ok: true, ignored: true, reason: 'STALE_CONTEXT' };
        }
        if (cfg.marksCompleted(result)) {
          markBOActionState(boTabId, cfg.key, currentValue, proc, result?.status || 'FOUND');
          markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
          return { ok: true, searched: true, reason: result?.status || 'FOUND' };
        }
        if (result?.status === 'SEARCH_STARTED') {
          markBOActionState(boTabId, cfg.key, currentValue, proc, 'SEARCH_STARTED');
          markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
          for (const delayMs of [1200, 2600]) {
            setTimeout(() => {
              if (!canRunBOSearchForProcess(proc)) return;
              if (activeBOContextTicketId && proc.ticketId && activeBOContextTicketId !== proc.ticketId) return;
              cfg.hasVisibleResults(boTabId, currentValue)
                .then((visible) => {
                  if (!visible || !canRunBOSearchForProcess(proc)) return;
                  markBOActionState(boTabId, cfg.key, currentValue, proc, 'VISIBLE');
                  markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
                })
                .catch(() => {});
            }, delayMs);
          }
          return { ok: true, searched: true, reason: 'SEARCH_STARTED' };
        }
        return { ok: false, reason: 'ERROR' };
      })
      .catch(() => ({ ok: false, reason: 'ERROR' }))
      .finally(() => finishBOActionOperation(op));
  };

  const runSearchForMode = () => {
    if (!isButtonClick) return runSearchNow();

    return runSearchNow().then((result) => {
      const shouldRetry =
        !result?.ignored &&
        ['ERROR'].includes(String(result?.reason || result?.status || ''));

      if (!shouldRetry) return result;

      clearBOActionStateForTab(boTabId);
      return new Promise(resolve => setTimeout(resolve, 350))
        .then(() => runSearchNow());
    });
  };

  const visibleResultsPromise = shouldForceButtonRun
    ? Promise.resolve(false)
    : withTimeout(
      cfg.hasVisibleResults(boTabId, currentValue),
      850,
      false
    );

  const actionPromise = visibleResultsPromise
    .then(async (hasVisibleResults) => {
      if (hasVisibleResults) {
        markBOActionState(boTabId, cfg.key, currentValue, proc, stateMatches ? undefined : 'VISIBLE');
        markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
        return { ok: true, skipped: true, reason: 'ALREADY_VISIBLE' };
      }
      const contextStillMatches = stateMatches
        ? await withTimeout(hasBOActionSearchContext(boTabId, cfg.key, currentValue), 550, false)
        : false;
      if (!force && !shouldForceButtonRun && !cfg.requiresVisibleProof && stateMatches && contextStillMatches && isRecentlyStartedBOAction(currentState)) {
        markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
        return { ok: true, skipped: true, reason: 'ALREADY_STARTING' };
      }
      if (isButtonClick && currentState?.resultStatus === 'NO_RESULT') {
        clearBOActionStateForTab(boTabId);
        return runSearchForMode();
      }
      if (!force && !shouldForceButtonRun && !cfg.requiresVisibleProof && stateMatches && contextStillMatches && isCompletedBOActionState(currentState)) {
        markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
        return {
          ok: true,
          skipped: true,
          reason: currentState.resultStatus === 'NO_RESULT' ? 'ALREADY_NO_RESULT' : 'ALREADY_COMPLETED'
        };
      }
      if (stateMatches) clearBOActionStateForTab(boTabId);
      return runSearchForMode();
    })
    .catch(() => runSearchForMode());

  if (requestKey) {
    boActionInFlightPromises.set(requestKey, actionPromise);
    actionPromise.finally(() => {
      if (boActionInFlightPromises.get(requestKey) === actionPromise) {
        boActionInFlightPromises.delete(requestKey);
      }
    });
  }

  return actionPromise;
}

function boActionSearchContextMatchesScript(actionKey = '', expectedSearchValue = '') {
  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function inputMatchesExpected() {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;
    const input = document.querySelector('#searchField');
    const current = String(input?.value ?? '').trim();
    if (!current) return false;
    if (expected.includes('@') || current.includes('@')) {
      return normalizeText(current) === normalizeText(expected);
    }
    const expectedDigits = normalizeDigits(expected);
    const currentDigits = normalizeDigits(current);
    return !!expectedDigits && expectedDigits === currentDigits;
  }

  function isProductTabChecked(id) {
    const item = document.querySelector(`#${id}`);
    return !!item && item.classList.contains('checked');
  }

  function getSearchCategoryButton() {
    const direct = document.querySelector('#menuSearch');
    if (direct) return direct;

    const input = document.querySelector('#searchField');
    if (input) {
      const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
      const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
      if (rootBtn) return rootBtn;

      const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
      return inputRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
        inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
        null;
    }

    return null;
  }

  function currentSearchCategory() {
    const btn = getSearchCategoryButton();
    return normalizeText(btn?.textContent || '');
  }

  const key = normalizeText(actionKey);
  const category = currentSearchCategory();
  if (!inputMatchesExpected()) return false;

  if (key === 'faturas') {
    return isProductTabChecked('MyEduzz') &&
      category.includes('fatura') &&
      !category.includes('antiga');
  }

  if (key === 'nutror') {
    return isProductTabChecked('Nutror') &&
      category.includes('cliente');
  }

  if (key === 'contratos') {
    return isProductTabChecked('Next') &&
      category.includes('cliente');
  }

  return false;
}

function boHasVisibleSectionResultsScript(sectionId = 'Nutror', expectedSearchValue = '') {
  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isProductTabChecked(id) {
    const item = document.querySelector(`#${id}`);
    return !!item && item.classList.contains('checked');
  }

  function getSearchCategoryButton() {
    const direct = document.querySelector('#menuSearch');
    if (direct && isVisible(direct)) return direct;

    const input = document.querySelector('#searchField');
    if (input) {
      const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
      const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
      if (rootBtn && isVisible(rootBtn)) return rootBtn;

      const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
      const localBtn =
        inputRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
        inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
        null;
      if (localBtn && isVisible(localBtn)) return localBtn;
    }

    const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]'))
      .filter(isVisible);
    return candidates.find((el) => {
      const txt = normalizeText(el.querySelector('span')?.textContent || el.textContent || '');
      return txt.includes('cliente') || txt.includes('fatura') || txt.includes('produto') || txt.includes('curso');
    }) || candidates[0] || null;
  }

  function isSearchCategory(expected) {
    const btn = getSearchCategoryButton();
    const text = normalizeText(btn?.textContent || '');
    if (expected === 'clientes') return text.includes('cliente');
    if (expected === 'faturas') return text.includes('fatura') && !text.includes('antiga');
    return false;
  }

  function inputMatchesExpected() {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;
    const input = document.querySelector('#searchField');
    const current = String(input?.value ?? '').trim();
    if (!current) return false;
    if (expected.includes('@') || current.includes('@')) {
      return normalizeText(current) === normalizeText(expected);
    }
    const expectedDigits = normalizeDigits(expected);
    const currentDigits = normalizeDigits(current);
    return !!expectedDigits && expectedDigits === currentDigits;
  }

  function textMatchesExpected(textValue) {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;
    const text = String(textValue ?? '');
    if (!text) return false;
    if (expected.includes('@')) return normalizeText(text).includes(normalizeText(expected));
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    return normalizeDigits(text).includes(expectedDigits);
  }

  function findSectionRoot() {
    const targetText = sectionId === 'Next' ? 'clientes next' : 'clientes nutror';
    const headers = Array.from(document.querySelectorAll('h3'));
    for (const header of headers) {
      const headerText = normalizeText(header.textContent || '');
      if (headerText !== targetText && !(isProductTabChecked(sectionId) && headerText.includes('cliente'))) continue;
      return header.closest('section, #contentContainer, .layout') || header.parentElement;
    }
    if (isProductTabChecked(sectionId)) {
      const contentRoot = document.querySelector('#contentContainer, section.layout, .layout');
      if (contentRoot) return contentRoot;
    }
    return null;
  }

  function hasNoResultText(root = null) {
    const text = normalizeText((root || document.body || document.documentElement)?.textContent || '');
    return text.includes('nenhum resultado') || text.includes('nenhum registro');
  }

  function focusNutrorLoginButton(sectionRoot, shouldFocus = true) {
    if (sectionId !== 'Nutror' || !sectionRoot) return null;

    const isNutrorLoginButton = (button) => {
      if (!button || !isVisible(button)) return false;
      const imgSrc = String(button.querySelector('img')?.getAttribute('src') || '').toLowerCase();
      const tip = normalizeText(button.closest('[data-tip]')?.getAttribute('data-tip') || '');
      const color = String(button.getAttribute('style') || '').toLowerCase();
      return imgSrc.includes('nutror') || tip.includes('nutror') || color.includes('60, 206, 82');
    };

    const expected = String(expectedSearchValue ?? '').trim();
    const rows = Array.from(sectionRoot.querySelectorAll('.customer-list tbody tr, tbody tr'))
      .filter((row) => isVisible(row) && normalizeText(row.textContent || ''));
    const matchingRow = rows.find((row) => textMatchesExpected(row.textContent || '')) || (!expected ? rows[0] : null);
    const firstRowTarget = Array.from(matchingRow?.querySelectorAll('#loginButton, button') || [])
      .find(isNutrorLoginButton);
    const target = firstRowTarget ||
      Array.from(sectionRoot.querySelectorAll('#loginButton, button')).find(isNutrorLoginButton);
    if (!target) return null;

    if (!shouldFocus) return target;

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    target.tabIndex = 0;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    target.setAttribute('currentitem', 'true');
    target.closest('[data-tip]')?.setAttribute('currentitem', 'true');
    return target;
  }

  function isManualEntryTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.matches('input, textarea, select, [contenteditable="true"]')) return true;
    return !!el.closest('input, textarea, select, [contenteditable="true"], form');
  }

  function clearNutrorLoginSelection(sectionRoot) {
    if (!sectionRoot) return;
    sectionRoot
      .querySelectorAll('#loginButton[currentitem="true"], button[currentitem="true"], [data-tip][currentitem="true"]')
      .forEach(el => el.setAttribute('currentitem', 'false'));
  }

  function installNutrorEnterHandler(sectionRoot) {
    if (sectionId !== 'Nutror' || !sectionRoot) return;
    if (document.__ticketHelperNutrorEnterHandlerInstalled) return;
    document.__ticketHelperNutrorEnterHandlerInstalled = true;

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (!isProductTabChecked('Nutror')) return;
      if (!isSearchCategory('clientes')) return;
      const root = findSectionRoot();
      if (!root || !isVisible(root)) return;
      if (isManualEntryTarget(event.target) || isManualEntryTarget(document.activeElement)) {
        clearNutrorLoginSelection(root);
        return;
      }
      const button = focusNutrorLoginButton(root, false);
      if (!button) return;
      if (document.activeElement !== button && event.target !== button) return;
      event.preventDefault();
      event.stopPropagation();
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
    }, true);
  }

  if (!isProductTabChecked(sectionId)) return false;
  if (!isSearchCategory('clientes')) return false;
  const sectionRoot = findSectionRoot();
  if (!sectionRoot || !isVisible(sectionRoot)) return false;

  const rows = Array.from(sectionRoot.querySelectorAll('tbody tr, .customer-list tbody tr'))
    .filter((row) => isVisible(row) && normalizeText(row.textContent || ''));
  if (rows.length > 0 && rows.some((row) => textMatchesExpected(row.textContent || ''))) {
    focusNutrorLoginButton(sectionRoot);
    installNutrorEnterHandler(sectionRoot);
    return true;
  }

  return false;
}

function boHasVisibleFaturasResultsScript(expectedSearchValue = '') {
  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOrbitaSelected() {
    const item = document.querySelector('#MyEduzz');
    return !!item && item.classList.contains('checked');
  }

  function isFaturasSelected() {
    const btn = document.querySelector('#menuSearch');
    const text = normalizeText(btn?.textContent || '');
    return text.includes('fatura') && !text.includes('antiga');
  }

  function textMatchesExpected(textValue) {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;
    const text = String(textValue ?? '');
    if (!text) return false;
    if (expected.includes('@')) {
      return normalizeText(text).includes(normalizeText(expected));
    }
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    const rootDigits = normalizeDigits(text);
    return rootDigits.includes(expectedDigits);
  }

  function rootHasMatchingRows(rootEl) {
    if (!rootEl || !isVisible(rootEl)) return false;
    const rows = rootEl.querySelectorAll('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr');
    for (const row of rows) {
      if (isVisible(row) && textMatchesExpected(row.textContent || '')) return true;
    }
    return false;
  }

  if (!isOrbitaSelected()) return false;
  if (!isFaturasSelected()) return false;

  const directRoots = Array.from(document.querySelectorAll('[tabindex="-1"].css-5qctmg, [tabindex="-1"]'))
    .filter((root) => {
      const text = normalizeText(root.textContent || '');
      return text.includes('status da fatura');
    });

  for (const root of directRoots) {
    if (rootHasMatchingRows(root)) return true;
  }

  const statusLabels = Array.from(document.querySelectorAll('span, p, div'))
    .filter((el) => {
      const text = normalizeText(el.textContent || '');
      return text === 'status da fatura:' && isVisible(el);
    });

  for (const label of statusLabels) {
    const root =
      label.closest('[tabindex="-1"]') ||
      label.closest('[role="dialog"]') ||
      label.closest('.MuiDialog-root') ||
      label.closest('.MuiPopover-root') ||
      label.parentElement;
    if (rootHasMatchingRows(root)) return true;
  }

  return false;
}

function boFaturasSearchScript(searchValue, actionToken = null) {
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isCurrentAction() {
    return !actionToken || window.__ticketHelperBOActionRun?.token === actionToken;
  }

  function staleResult() {
    return { status: 'STALE_CONTEXT' };
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickElement(el) {
    if (!isCurrentAction()) return;
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForSubmitGate() {
    const minGapMs = 50;
    for (let attempt = 0; attempt < 2; attempt++) {
      const elapsed = Date.now() - Number(window.__ticketHelperLastBOSubmitAt || 0);
      if (elapsed >= minGapMs) break;
      await delay(minGapMs - elapsed);
      if (!isCurrentAction()) return false;
    }
    if (!isCurrentAction()) return false;
    window.__ticketHelperLastBOSubmitAt = Date.now();
    return true;
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const immediate = document.querySelector(selector);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const root = document.documentElement || document.body;
      if (!root) {
        resolve(null);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        cleanup();
        resolve(el);
      });

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timer);
      }

      observer.observe(root, { childList: true, subtree: true });
    });
  }

  async function ensureOrbita() {
    if (!isCurrentAction()) return false;
    const item = document.querySelector('#MyEduzz');
    if (!item) return false;
    if (item.classList.contains('checked')) return true;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isCurrentAction()) return false;
      clickElement(item.querySelector('a') || item);
      const deadline = Date.now() + 3500;
      while (Date.now() < deadline) {
        if (!isCurrentAction()) return false;
        if (item.classList.contains('checked')) return true;
        await delay(120);
      }
    }
    return item.classList.contains('checked');
  }

  async function ensureFaturas2() {
    if (!isCurrentAction()) return false;
    function getSearchCategoryButton() {
      const direct = document.querySelector('#menuSearch');
      if (direct && isVisible(direct)) return direct;

      const input = document.querySelector('#searchField');
      if (input) {
        const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
        const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
        if (rootBtn && isVisible(rootBtn)) return rootBtn;

        const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
        const localBtn =
          inputRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') ||
          null;
        if (localBtn && isVisible(localBtn)) return localBtn;
      }

      const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]'))
        .filter(isVisible);
      return candidates.find((el) => {
        const txt = normalizeText(el.querySelector('span')?.textContent || el.textContent || '');
        return txt.includes('fatura') || txt.includes('cliente') || txt.includes('curso') || txt.includes('produto');
      }) || candidates[0] || null;
    }

    function isFaturasSelected(baseBtn) {
      const activeBtn = getSearchCategoryButton() || baseBtn;
      const txt = normalizeText(activeBtn?.querySelector('span')?.textContent || activeBtn?.textContent || '');
      return txt.includes('faturas') && !txt.includes('antiga');
    }

    function findFaturasOption() {
      const byId = Array.from(
        document.querySelectorAll('#menuFaturas, [id*="menuFaturas"]')
      ).filter(isVisible);
      if (byId.length) return byId[0];

      const nodes = Array.from(
        document.querySelectorAll(
          '[role="menu"] [role="menuitem"], [role="listbox"] [role="option"], [role="menuitem"], [role="option"], li, button'
        )
      ).filter(isVisible);

      return nodes.find((node) => {
        const txt = normalizeText(node.textContent || '');
        return txt.includes('faturas') && !txt.includes('antiga');
      }) || null;
    }

    const btn = getSearchCategoryButton();
    if (!btn) return false;

    if (isFaturasSelected(btn)) return true;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (!isCurrentAction()) return false;
      clickElement(btn);
      await delay(140);

      let item = null;
      const start = Date.now();
      while (!item && Date.now() - start < 2200) {
        if (!isCurrentAction()) return false;
        item = findFaturasOption();
        if (item) break;
        await delay(90);
      }

      if (item) {
        clickElement(item);
        await delay(260);
      }

      if (isFaturasSelected(btn)) return true;
      await delay(140);
    }

    return false;
  }

  async function triggerSearch(value) {
    if (!isCurrentAction()) return false;
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input) return false;

    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);
    if (!(await waitForSubmitGate())) return false;
    if (!isCurrentAction()) return false;

    if (btn && isVisible(btn)) {
      clickElement(btn);
      return true;
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }

  async function triggerSearchSoon(value) {
    const deadline = Date.now() + 900;
    while (Date.now() < deadline) {
      if (!isCurrentAction()) return false;
      if (await triggerSearch(value)) return true;
      await delay(25);
    }
    return false;
  }

  function rowMatchesSearchValue(row) {
    const expected = String(searchValue ?? '').trim();
    if (!expected) return true;
    const text = String(row?.textContent || '');
    if (!text) return false;
    if (expected.includes('@')) return normalizeText(text).includes(normalizeText(expected));
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    return normalizeDigits(text).includes(expectedDigits);
  }

  function hasMatchingFaturasRows() {
    const roots = Array.from(document.querySelectorAll('[tabindex="-1"], [role="dialog"], .MuiDialog-root, .MuiPopover-root'))
      .filter((root) => isVisible(root) && normalizeText(root.textContent || '').includes('status da fatura'));

    for (const root of roots) {
      const rows = Array.from(root.querySelectorAll('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr'))
        .filter(isVisible);
      if (rows.some(rowMatchesSearchValue)) return true;
    }

    return false;
  }

  return (async () => {
    if (!isCurrentAction()) return staleResult();
    const orbitaReady = await ensureOrbita();
    if (!isCurrentAction()) return staleResult();
    if (!orbitaReady) return { status: 'ERROR' };

    const searchInput = await waitForElement('#searchField', 20000);
    if (!isCurrentAction()) return staleResult();
    if (!searchInput) return { status: 'ERROR' };
    if (!(await ensureOrbita())) return { status: 'ERROR' };
    if (!isCurrentAction()) return staleResult();

    const selected = await ensureFaturas2();
    if (!isCurrentAction()) return staleResult();
    if (!selected) return { status: 'ERROR' };
    if (!(await ensureOrbita())) return { status: 'ERROR' };
    if (!isCurrentAction()) return staleResult();
    if (!(await ensureFaturas2())) return { status: 'ERROR' };
    if (!isCurrentAction()) return staleResult();

    if (!(await triggerSearch(searchValue))) return { status: 'ERROR' };

    await delay(450);
    if (!isCurrentAction()) return staleResult();
    if (hasMatchingFaturasRows()) return { status: 'FOUND' };
    return { status: 'SEARCH_STARTED' };
  })();
}

function boSectionSearchScript(searchValue, sectionId = 'Nutror', actionToken = null) {
  let lastSearchStartedAt = 0;
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isCurrentAction() {
    return !actionToken || window.__ticketHelperBOActionRun?.token === actionToken;
  }

  function staleResult() {
    return { status: 'STALE_CONTEXT' };
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findFaturasPopup() {
    const candidates = Array.from(document.querySelectorAll('.css-5qctmg, [tabindex="-1"]'))
      .filter(isVisible);
    return candidates.find((el) => {
      const text = normalizeText(el.textContent || '');
      return text.includes('status da fatura') ||
        (text.includes('fatura') && text.includes('produto') && text.includes('valor'));
    }) || null;
  }

  async function dismissFaturasPopupIfPresent() {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!isCurrentAction()) return false;
      const popup = findFaturasPopup();
      if (!popup) return true;

      const closeBtn = Array.from(popup.querySelectorAll('button, [role="button"], [aria-label]'))
        .filter(isVisible)
        .find((el) => {
          const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '');
          return label.includes('fechar') || label.includes('close') || label === 'x';
        });

      if (closeBtn) clickElement(closeBtn);
      else {
        const escDown = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        const escUp = new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        popup.dispatchEvent(escDown);
        document.dispatchEvent(escDown);
        window.dispatchEvent(escDown);
        popup.dispatchEvent(escUp);
        document.dispatchEvent(escUp);
        window.dispatchEvent(escUp);
      }

      await delay(180);
    }

    return !findFaturasPopup();
  }

  function sectionLabel() {
    return sectionId === 'Next' ? 'clientes next' : 'clientes nutror';
  }

  function isTargetProductTabChecked() {
    const item = document.querySelector(`#${sectionId}`);
    return !!item && item.classList.contains('checked');
  }

  function isTargetSectionVisible() {
    const target = sectionLabel();
    const headers = Array.from(document.querySelectorAll('h3'))
      .filter(isVisible);
    if (headers.some((header) => normalizeText(header.textContent || '') === target)) return true;
    return isTargetProductTabChecked() && !!document.querySelector('#searchField');
  }

  function findTargetSectionRoot() {
    const target = sectionLabel();
    const headers = Array.from(document.querySelectorAll('h3'))
      .filter(isVisible);
    for (const header of headers) {
      const headerText = normalizeText(header.textContent || '');
      if (headerText !== target && !(isTargetProductTabChecked() && headerText.includes('cliente'))) continue;
      return header.closest('section, #contentContainer, .layout') || header.parentElement;
    }
    if (isTargetProductTabChecked()) {
      const contentRoot = document.querySelector('#contentContainer, section.layout, .layout');
      if (contentRoot) return contentRoot;
    }
    return null;
  }

  function findSectionMenuItem() {
    const exactById = document.querySelector(`#${sectionId}`);
    if (exactById && isVisible(exactById)) return exactById;

    const target = sectionId === 'Next' ? 'next' : 'nutror';
    const nodes = Array.from(document.querySelectorAll('li, button, a, [role="button"], [role="menuitem"]'))
      .filter(isVisible);

    for (const node of nodes) {
      const id = normalizeText(node.id || '');
      const text = normalizeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (id === target || text === target) return node;
    }

    for (const node of nodes) {
      const id = normalizeText(node.id || '');
      const text = normalizeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (id.includes(target) || text.includes(target)) return node;
    }

    return null;
  }

  function clickElement(el) {
    if (!isCurrentAction()) return;
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForSubmitGate() {
    const minGapMs = 50;
    for (let attempt = 0; attempt < 2; attempt++) {
      const elapsed = Date.now() - Number(window.__ticketHelperLastBOSubmitAt || 0);
      if (elapsed >= minGapMs) break;
      await delay(minGapMs - elapsed);
      if (!isCurrentAction()) return false;
    }
    if (!isCurrentAction()) return false;
    window.__ticketHelperLastBOSubmitAt = Date.now();
    return true;
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const immediate = document.querySelector(selector);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const root = document.documentElement || document.body;
      if (!root) {
        resolve(null);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        cleanup();
        resolve(el);
      });

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timer);
      }

      observer.observe(root, { childList: true, subtree: true });
    });
  }

  async function waitForTargetSearchField(timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const input = document.querySelector('#searchField');
      if (isTargetProductTabChecked() && input && isVisible(input)) return input;
      await delay(60);
    }
    return null;
  }

  async function ensureSection() {
    if (!isCurrentAction()) return 'ERROR';
    await dismissFaturasPopupIfPresent();
    if (!isCurrentAction()) return 'ERROR';
    if (isTargetProductTabChecked() && await waitForTargetSearchField(700)) return 'READY';

    const item = findSectionMenuItem();
    if (!item) return 'ERROR';
    const link = item.querySelector('a[href]') || item.querySelector('a');
    const clickTarget = link || item;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isCurrentAction()) return 'ERROR';
      await dismissFaturasPopupIfPresent();
      clickElement(clickTarget);

      if (await waitForTargetSearchField(2500)) return 'READY';
    }

    const fallbackInput = await waitForTargetSearchField(900);
    return isTargetProductTabChecked() && fallbackInput ? 'READY' : 'ERROR';
  }

  async function ensureClientes() {
    if (!isCurrentAction()) return false;
    function getSearchCategoryButton() {
      const direct = document.querySelector('#menuSearch');
      if (direct && isVisible(direct)) return direct;

      const input = document.querySelector('#searchField');
      if (input) {
        const searchRoot = input.closest('.main_search') || input.closest('header') || input.closest('form')?.parentElement;
        const rootBtn = searchRoot?.querySelector?.('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]') || null;
        if (rootBtn && isVisible(rootBtn)) return rootBtn;

        const inputRoot = input.closest('form, .jss85, .jss100, .jss86, .jss91') || input.parentElement;
        const localBtn =
          inputRoot?.querySelector?.('button[aria-haspopup="true"]') ||
          inputRoot?.parentElement?.querySelector?.('button[aria-haspopup="true"]') ||
          null;
        if (localBtn && isVisible(localBtn)) return localBtn;
      }

      const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="true"], [role="button"][aria-haspopup="true"]'))
        .filter(isVisible);
      const scored = candidates.find((el) => {
        const txt = normalizeText(el.querySelector('span')?.textContent || el.textContent || '');
        return txt.includes('cliente') || txt.includes('curso') || txt.includes('fatura') || txt.includes('produto');
      });
      return scored || candidates[0] || null;
    }

    function isClientesSelected(baseBtn) {
      const activeBtn = getSearchCategoryButton() || baseBtn;
      const txt = normalizeText(activeBtn?.querySelector('span')?.textContent || activeBtn?.textContent || '');
      return txt.includes('cliente');
    }

    function findClientesOption() {
      const byId = Array.from(
        document.querySelectorAll('#menuClientes, [id*="menuClientes"]')
      ).filter(isVisible);
      if (byId.length) return byId[0];

      const nodes = Array.from(
        document.querySelectorAll(
          '[role="menu"] [role="menuitem"], [role="listbox"] [role="option"], [role="menuitem"], [role="option"], li, button'
        )
      ).filter(isVisible);

      let contains = null;
      for (const node of nodes) {
        const txt = normalizeText(node.textContent || '');
        if (!txt) continue;
        if (txt === 'clientes' || txt === 'cliente') return node;
        if (!contains && txt.includes('cliente')) contains = node;
      }
      return contains;
    }

    const btn = getSearchCategoryButton();
    if (!btn) return false;

    if (isClientesSelected(btn)) return true;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (!isCurrentAction()) return false;
      clickElement(btn);
      await delay(140);

      let item = null;
      const start = Date.now();
      while (!item && Date.now() - start < 2200) {
        if (!isCurrentAction()) return false;
        item = findClientesOption();
        if (item) break;
        await delay(90);
      }

      if (item) {
        clickElement(item);
        await delay(220);
      }

      if (isClientesSelected(btn)) return true;
      await delay(120);
    }

    return false;
  }

  async function triggerSearch(value) {
    if (!isCurrentAction()) return false;
    const input = document.querySelector('#searchField');
    if (!input) return false;

    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);
    input.dispatchEvent(new KeyboardEvent('keyup', { key: String(value).slice(-1) || '0', bubbles: true }));
    await delay(60);
    if (!isCurrentAction()) return false;

    const form = input.closest('form');
    const btn =
      form?.querySelector('button[type="submit"]') ||
      document.querySelector('button[type="submit"]');
    const classText = normalizeText(btn?.className || '');
    const ariaDisabled = String(btn?.getAttribute('aria-disabled') || '').toLowerCase();
    const canClickButton =
      btn &&
      isVisible(btn) &&
      !btn.disabled &&
      ariaDisabled !== 'true' &&
      !classText.includes('disabled');

    if (!(await waitForSubmitGate())) return false;
    if (!isCurrentAction()) return false;

    if (canClickButton) {
      lastSearchStartedAt = Date.now();
      clickElement(btn);
      return true;
    }

    if (form) {
      lastSearchStartedAt = Date.now();
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    lastSearchStartedAt = Date.now();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }

  async function triggerSearchSoon(value) {
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      if (!isCurrentAction()) return false;
      if (!isTargetProductTabChecked()) return false;
      if (await triggerSearch(value)) return true;
      await delay(35);
    }
    return false;
  }

  function focusButtonElement(target) {
    if (!isCurrentAction()) return false;
    if (!target || !isVisible(target)) return false;
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    target.tabIndex = 0;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    target.setAttribute('currentitem', 'true');
    target.closest('[data-tip]')?.setAttribute('currentitem', 'true');
    return document.activeElement === target || target.matches(':focus');
  }

  function clickButtonElement(target) {
    if (!isCurrentAction()) return false;
    if (!target || !isVisible(target)) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }

  function isNutrorLoginButton(button) {
    if (!button || !isVisible(button)) return false;
    const imgSrc = String(button.querySelector('img')?.getAttribute('src') || '').toLowerCase();
    const tip = normalizeText(button.closest('[data-tip]')?.getAttribute('data-tip') || '');
    const color = String(button.getAttribute('style') || '').toLowerCase();
    return imgSrc.includes('nutror') || tip.includes('nutror') || color.includes('60, 206, 82');
  }

  function getNutrorLoginButton() {
    const root = findTargetSectionRoot();
    if (!root || !isVisible(root)) return null;

    const expected = String(searchValue ?? '').trim();
    const resultRows = Array.from(root.querySelectorAll('.customer-list tbody tr, tbody tr'))
      .filter((row) => isVisible(row) && normalizeText(row.textContent || '').trim());
    const firstResultRow = resultRows.find(rowMatchesSearchValue) || (!expected ? resultRows[0] : null);

    const rowTarget = Array.from(firstResultRow?.querySelectorAll('#loginButton, button') || [])
      .find(isNutrorLoginButton);
    if (rowTarget) return rowTarget;

    return Array.from(root.querySelectorAll('#loginButton, button'))
      .find(isNutrorLoginButton) || null;
  }

  function focusLoginButton() {
    if (sectionId !== 'Nutror') return false;
    if (!isTargetProductTabChecked()) return false;
    return focusButtonElement(getNutrorLoginButton());
  }

  function isManualEntryTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.matches('input, textarea, select, [contenteditable="true"]')) return true;
    return !!el.closest('input, textarea, select, [contenteditable="true"], form');
  }

  function clearNutrorLoginSelection() {
    const root = findTargetSectionRoot() || document;
    root
      .querySelectorAll('#loginButton[currentitem="true"], button[currentitem="true"], [data-tip][currentitem="true"]')
      .forEach(el => el.setAttribute('currentitem', 'false'));
  }

  function installNutrorEnterHandler() {
    if (sectionId !== 'Nutror') return;
    if (document.__ticketHelperNutrorEnterHandlerInstalled) return;
    document.__ticketHelperNutrorEnterHandlerInstalled = true;

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (!isTargetProductTabChecked()) return;
      if (isManualEntryTarget(event.target) || isManualEntryTarget(document.activeElement)) {
        clearNutrorLoginSelection();
        return;
      }
      const target = getNutrorLoginButton();
      if (!target) return;
      if (document.activeElement !== target && event.target !== target) return;
      event.preventDefault();
      event.stopPropagation();
      clickButtonElement(target);
    }, true);
  }

  function watchLoginButtonFocus() {
    if (sectionId !== 'Nutror') return;
    installNutrorEnterHandler();

    const deadline = Date.now() + 12000;
    let done = false;
    let observer = null;
    let intervalId = null;
    let timeoutId = null;

    const cleanup = () => {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const tryFocus = () => {
      if (done) return;
      if (!isCurrentAction()) {
        cleanup();
        return;
      }
      if (isManualEntryTarget(document.activeElement)) {
        clearNutrorLoginSelection();
        cleanup();
        return;
      }
      if (focusLoginButton()) {
        cleanup();
        return;
      }
      if (Date.now() >= deadline) cleanup();
    };

    try {
      observer = new MutationObserver(tryFocus);
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      observer = null;
    }
    intervalId = setInterval(tryFocus, 250);
    timeoutId = setTimeout(cleanup, 12500);
    tryFocus();
  }

  function hasVisibleResultRows() {
    if (!isTargetProductTabChecked()) return false;
    const root = findTargetSectionRoot();
    if (!root || !isVisible(root)) return false;
    const rows = Array.from(root.querySelectorAll('tbody tr, table tr'))
      .filter((row) => isVisible(row) && normalizeText(row.textContent || ''));
    return rows.some(rowMatchesSearchValue);
  }

  function rowMatchesSearchValue(row) {
    const expected = String(searchValue ?? '').trim();
    if (!expected) return true;
    const text = String(row?.textContent || '');
    if (!text) return false;
    if (expected.includes('@')) return normalizeText(text).includes(normalizeText(expected));
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    return normalizeDigits(text).includes(expectedDigits);
  }

  function hasNoResultText(root = null) {
    const text = normalizeText((root || document.body || document.documentElement)?.textContent || '');
    return text.includes('nenhum resultado') || text.includes('nenhum registro');
  }

  function evaluateResultState() {
    if (!isCurrentAction()) return 'STALE';
    if (!isTargetProductTabChecked()) return 'PENDING';
    const root = findTargetSectionRoot();
    if (hasNoResultText(root) || hasNoResultText()) {
      if (lastSearchStartedAt && Date.now() - lastSearchStartedAt < 280) return 'PENDING';
      return 'NO_RESULT';
    }
    if (hasVisibleResultRows()) {
      installNutrorEnterHandler();
      focusLoginButton();
      return 'FOUND';
    }
    const resultText = normalizeText((root || document.body || document.documentElement)?.textContent || '');
    if (resultText.includes('faca uma busca para comecar') || resultText.includes('faca uma pesquisa')) return 'WAITING_SEARCH';
    return 'PENDING';
  }

  async function waitForResultState(maxMs = 4200) {
    const deadline = Date.now() + maxMs;
    let lastState = 'PENDING';
    while (Date.now() < deadline) {
      if (!isCurrentAction()) return 'STALE';
      lastState = evaluateResultState();
      if (lastState === 'STALE') return lastState;
      if (lastState === 'FOUND' || lastState === 'NO_RESULT' || lastState === 'WAITING_SEARCH') return lastState;
      await delay(90);
    }
    return lastState;
  }

  return (async () => {
    if (!isCurrentAction()) return staleResult();
    await dismissFaturasPopupIfPresent();
    if (!isCurrentAction()) return staleResult();
    const sectionState = await ensureSection();
    if (!isCurrentAction()) return staleResult();
    if (sectionState !== 'READY') return { status: 'ERROR' };

    const searchInput = await waitForElement('#searchField', 20000);
    if (!isCurrentAction()) return staleResult();
    if (!searchInput) return { status: 'ERROR' };
    if (!isTargetProductTabChecked()) return { status: 'ERROR' };

    const selected = await ensureClientes();
    if (!isCurrentAction()) return staleResult();
    if (!selected) return { status: 'ERROR' };
    if (!isTargetProductTabChecked()) return { status: 'ERROR' };
    if (!(await ensureClientes())) return { status: 'ERROR' };
    if (!isCurrentAction()) return staleResult();

    if (!(await triggerSearchSoon(searchValue))) return { status: 'ERROR' };
    if (!isCurrentAction()) return staleResult();
    watchLoginButtonFocus();

    const firstState = await waitForResultState(4200);
    if (!isCurrentAction() || firstState === 'STALE') return staleResult();
    if (firstState === 'FOUND' || firstState === 'WAITING_SEARCH') {
      if (!(await triggerSearchSoon(searchValue))) return firstState === 'FOUND' ? { status: 'FOUND' } : { status: 'SEARCH_STARTED' };
      if (!isCurrentAction()) return staleResult();
      watchLoginButtonFocus();
    }

    const state = await waitForResultState(4200);
    if (!isCurrentAction() || state === 'STALE') return staleResult();
    if (state === 'FOUND') return { status: 'FOUND' };
    if (state === 'NO_RESULT') return { status: 'NO_RESULT' };
    return { status: 'SEARCH_STARTED' };
  })();
}





chrome.storage.session.get([
  'sessionCache',
  TICKET_HISTORY_SESSION_KEY,
  ACTIVE_HISTORY_CANDIDATE_SESSION_KEY,
  HUBSPOT_PORTAL_ID_SESSION_KEY,
  'lastTicketTabId',
  'boTab1Id',
  'boTab2Id',
  'boAssignArmedSlot',
  'boAssignArmedAction',
  'boActionTabIds',
  'boTabActionStates',
  'activeBOContextProcessId',
  'activeBOContextTicketId',
  'lastBOTabSyncProcessId',
  'lastBOTabSyncSignature',
  'lastBOTabSyncAt'
], (data) => {
  if (data.sessionCache) sessionCache = data.sessionCache;
  ticketHistory = normalizeTicketHistory(data[TICKET_HISTORY_SESSION_KEY]);
  activeHistoryCandidate = data[ACTIVE_HISTORY_CANDIDATE_SESSION_KEY]?.id && data[ACTIVE_HISTORY_CANDIDATE_SESSION_KEY]?.kind
    ? data[ACTIVE_HISTORY_CANDIDATE_SESSION_KEY]
    : null;
  hubspotPortalId = String(data[HUBSPOT_PORTAL_ID_SESSION_KEY] || '').trim() || null;
  if (data.lastTicketTabId) lastTicketTabId = data.lastTicketTabId;
  if (Number.isInteger(data.boTab1Id)) boTab1Id = data.boTab1Id;
  if (Number.isInteger(data.boTab2Id)) boTab2Id = data.boTab2Id;
  if (data.boAssignArmedSlot === 1 || data.boAssignArmedSlot === 2) boAssignArmedSlot = data.boAssignArmedSlot;
  boAssignArmedAction = normalizeActionTabKey(data.boAssignArmedAction);
  if (data.boActionTabIds && typeof data.boActionTabIds === 'object') {
    boActionTabIds = {
      faturas: Number.isInteger(data.boActionTabIds.faturas) ? data.boActionTabIds.faturas : null,
      nutror: Number.isInteger(data.boActionTabIds.nutror) ? data.boActionTabIds.nutror : null,
      contratos: Number.isInteger(data.boActionTabIds.contratos) ? data.boActionTabIds.contratos : null
    };
  }
  if (data.boTabActionStates && typeof data.boTabActionStates === 'object') {
    boTabActionStates = data.boTabActionStates;
  }
  activeBOContextProcessId = data.activeBOContextProcessId || null;
  activeBOContextTicketId = data.activeBOContextTicketId || null;
  lastBOTabSyncProcessId = data.lastBOTabSyncProcessId || null;
  lastBOTabSyncSignature = data.lastBOTabSyncSignature || null;
  lastBOTabSyncAt = Number(data.lastBOTabSyncAt || 0);
});
