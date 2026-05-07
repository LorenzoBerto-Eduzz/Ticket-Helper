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
const docSecondSearchKeys = new Set();
let extensionEnabled = false;

const BO_DASHBOARD_HOST = 'bo.eduzz.com';
const BO_DASHBOARD_PATH = '/dashboard';

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
  activeBOContextProcessId = null;
  activeBOContextTicketId = null;
  lastBOTabSyncProcessId = null;
  lastBOTabSyncSignature = null;
  lastBOTabSyncAt = 0;
  partnerDetailLookupStates.clear();
  docAccountsRefreshKeys.clear();
  docSearchRunKeys.clear();
  docSecondSearchKeys.clear();
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

function cancelSiblingBOActionOperationsForTab(tabId, actionKeyArg) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!Number.isInteger(tabId) || !actionKey) return;
  const prefix = `${tabId}:`;
  for (const opKey of Object.keys(boActionOperationTokens)) {
    if (!opKey.startsWith(prefix)) continue;
    if (opKey === `${tabId}:${actionKey}`) continue;
    delete boActionOperationTokens[opKey];
  }
  for (const promiseKey of Array.from(boActionInFlightPromises.keys())) {
    if (!promiseKey.startsWith(prefix)) continue;
    if (promiseKey.startsWith(`${tabId}:${actionKey}:`)) continue;
    boActionInFlightPromises.delete(promiseKey);
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

function setBOTabAssignment(slot, tabId, notify = true) {
  if (slot === 1) {
    const nextTabId = tabId ?? null;
    if (boTab1Id !== nextTabId) clearBOActionStateForTab(boTab1Id);
    boTab1Id = nextTabId;
  }
  if (slot === 2) {
    const nextTabId = tabId ?? null;
    if (boTab2Id !== nextTabId) {
      clearBO2LastAction();
      clearBOActionStateForTab(boTab2Id);
    }
    boTab2Id = nextTabId;
  }
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function setBOActionTabAssignment(actionKeyArg, tabId, notify = true) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!actionKey) return;
  const nextTabId = tabId ?? null;
  let changed = false;

  if (Number.isInteger(nextTabId)) {
    for (const key of ['faturas', 'nutror', 'contratos']) {
      if (key === actionKey) continue;
      if (boActionTabIds[key] === nextTabId) {
        clearBOActionStateForTab(boActionTabIds[key]);
        boActionTabIds[key] = null;
        changed = true;
      }
    }
  }

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
  for (const key of ['faturas', 'nutror', 'contratos']) {
    if (key === actionKey) continue;
    if (boActionTabIds[key] === tabId) {
      clearBOActionStateForTab(boActionTabIds[key]);
      boActionTabIds[key] = null;
    }
  }
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

function enqueueSerializedBOSearch(task, cooldownMs = 220, queueKey = 'global') {
  const key = queueKey || 'global';
  const prevQueue = boExecutionQueues.get(key) || Promise.resolve();
  const run = prevQueue
    .catch(() => {})
    .then(() => task())
    .finally(() => new Promise(resolve => setTimeout(resolve, cooldownMs)));
  boExecutionQueues.set(key, run.catch(() => {}));
  return run;
}

function queueKeyForBOTab(tabId) {
  return Number.isInteger(tabId) ? `tab:${tabId}` : 'global';
}





let pendingProc = null;




let sessionCache = {};





function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  return !!docValue &&
    hasValidDocLength(docValue) &&
    (isPendingProcessField(proc.accounts) || proc.accountsSource !== 'doc');
}

function isFinalDocSearchStatus(status) {
  return ['FOUND', 'NO_ACCOUNT', 'NO_RESULT', 'TIMEOUT'].includes(String(status || ''));
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
      if (searchKey && docSearchRunKeys.has(searchKey)) return;
      if (searchKey) docSearchRunKeys.add(searchKey);

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
          if (searchKey) docSearchRunKeys.delete(searchKey);
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
        if (searchKey && docSearchRunKeys.has(searchKey)) return;
        if (searchKey) docSearchRunKeys.add(searchKey);
        runDocSearch(boTab1Id, docValue)
          .then((nextResult) => {
            if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
            if (!isFinalDocSearchStatus(nextResult?.status)) return;
            if (needsDefinitiveDocAccounts(proc)) handleDocResult(proc, nextResult, boTab1Id);
            else if (nextResult?.status === 'FOUND' && isPartnerDetailPendingAccounts(proc.accounts)) scheduleSinglePartnerDetailLookup(proc, nextResult, boTab1Id);
          })
          .catch(() => {})
          .finally(() => {
            if (searchKey) docSearchRunKeys.delete(searchKey);
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
  if (!extensionEnabled) shutdownAllExtensionWork();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  chrome.runtime.openOptionsPage();
});





function createProcess(tabId, ticketId, isFocused = true) {
  
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
    retryCount: 0
  };

  processes.set(tabId, proc);

  
  
  if (isFocused) {
    activeProcessId = proc.processId;
    persistLastTicketTabId(tabId);
    setActiveBOContext(proc);
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
        const phantom = {
          processId: uid(),
          ticketId,
          tabId,
          name:     cached.name,
          email:    cached.email,
          doc:      cached.doc,
          accounts: cached.accounts ?? null,
          accountsSource: cached.accountsSource ?? null,
          status:   'COMPLETED',
          retryCount: 0
        };
        processes.set(tabId, phantom);
        if (isFocused) {
          activeProcessId = phantom.processId;
          persistLastTicketTabId(tabId);
          const contextChanged = activeBOContextTicketId !== phantom.ticketId;
          if (contextChanged) {
            syncDefinedBOTabsForProcess(phantom, { forceActions: true, contextChanged: true });
          } else {
            setActiveBOContext(phantom);
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

    
    
    const proc = createProcess(tabId, ticketId, isFocused);
    sendResponse({ processId: proc.processId, reuse: false });
    return true;
  }

  
  if (msg.action === 'GET_BO_TAB_STATE') {
    sendResponse({ state: getBOTabState() });
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
    proc.doc = '> Ticket sem email';
    proc.accounts = '-';
    proc.accountsSource = null;
    proc.status = 'ABORTED';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    return;
  }

  
  if (msg.action === 'TICKET_EXITED') {
    const proc = processes.get(tabId);
    if (proc) proc.status = 'ABORTED';
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
          force: false
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














function boEmailSearchScript(emailValue) {
  
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
  const MSG_NO_RECORD_NORM = 'nenhum registro';
  const SEARCH_TRIGGER_COOLDOWN_MS = 1400;
  const LOADING_HINTS_NORM = ['atualizando', 'carregando', 'refresh'];
  let lastSearchTriggerAt = 0;

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
      accountType
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
      accountType: accountTypeFromRows(matched)
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
                scheduleCheck(550);
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
                scheduleCheck(600);
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
          scheduleCheck(320);
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

        if (text === MSG_START_SEARCH || normText.includes(MSG_START_SEARCH_NORM)) {
          if (retryCount < 3) {
            if (triggerSearch(email)) {
              retryCount++;
              lastSearchAt = Date.now();
              scheduleCheck(500);
            } else {
              scheduleCheck(320);
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
    ensureOrbita();

    const searchUi = await waitForElement('#searchField, #menuSearch', 20000);
    if (!searchUi) return { status: 'ERROR' };

    await ensureClientes();

    if (!(await triggerSearchWithRetry(emailValue))) return { status: 'ERROR' };

    return waitForEmailResult(emailValue);
  })();
}

function boReadEmailSearchResultScript(emailValue) {
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
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
      accountType: accountTypeFromRows(matched)
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
  if (normText.includes(MSG_START_SEARCH_NORM)) return { status: 'PENDING' };
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
      proc.accounts = `? | ${result.accountType || 'Cliente'}`;
      proc.accountsSource = 'email';
      proc.status   = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      triggerAutoFaturasSearch(proc);
      triggerAutoAssignedActionSearches(proc);
      break;

    case 'FOUND':
      proc.name = result.name ? toTitleCase(result.name) : '-';
      proc.doc = result.doc;
      proc.accounts = '...';
      proc.accountsSource = null;
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      triggerAutoFaturasSearch(proc);
      triggerAutoAssignedActionSearches(proc);
      runDocValidationAndSearch(proc, boTabId);
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
  if (searchKey && docSearchRunKeys.has(searchKey)) return;

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

  proc.status = 'SEARCHING_DOC';
  boSearchBusy = true;
  boSearchOwner = proc.processId;
  if (searchKey) docSearchRunKeys.add(searchKey);

  const safetyTimer = setTimeout(() => {
    if (boSearchOwner === proc.processId) {
      boSearchBusy = false;
      boSearchOwner = null;
      if (searchKey) docSearchRunKeys.delete(searchKey);
      flushPending();
    }
  }, 25000);

  runDocSearch(boTabId, proc.doc)
    .then(result => {
      clearTimeout(safetyTimer);
      boSearchBusy = false;
      boSearchOwner = null;
      if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) {
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
      proc.accounts = '> Erro na busca doc';
      proc.accountsSource = null;
      proc.status = 'ABORTED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      flushPending();
    })
    .finally(() => {
      if (searchKey) docSearchRunKeys.delete(searchKey);
    });
}





function runDocSearch(boTabId, doc) {
  
  return enqueueSerializedBOSearch(() =>
    chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boDocSearchScript,
      args: [doc]
    }).then(results => results?.[0]?.result ?? { status: 'ERROR' }),
    220,
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

function readSinglePartnerDetail(boTabId, doc) {
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
    220,
    queueKeyForBOTab(boTabId)
  );
}








function boDocSearchScript(docValue) {
  
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';
  const MSG_START_SEARCH_NORM = 'faca uma busca para comecar';
  const MSG_NO_RECORD_NORM = 'nenhum registro';

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
    return true;
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

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const rowDoc = normalizeDoc(cells[3]?.textContent || '');
      if (rowDoc !== targetDoc) continue;

      count++;
      if (cells[0].querySelector('[data-tip="Parceiro"]')) {
        hasParceiro = true;
        parceiroCount++;
        if (hasPartnerRowBadge(cells)) partnerBadgeRowCount++;
      }
    }

    if (count === 0) return { status: 'NO_MATCH' };
    return {
      status: 'FOUND',
      count,
      hasParceiro,
      parceiroCount,
      partnerBadgeRowCount,
      partnerDetailLookup: parceiroCount === 1 || partnerBadgeRowCount === 1
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
      let firstMultiPartnerSeenAt = 0;

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
            triggerSearch(doc);
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
          if (sig === lastSignature) {
            stableCount++;
          } else {
            lastSignature = sig;
            stableCount = 1;
          }

          if (stableCount < 2) return;

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

        if (normText.includes(MSG_NO_RECORD_NORM)) {
          emptyStableCount++;
          if (emptyStableCount < 3) {
            scheduleCheck(700);
            return;
          }
          finish({ status: 'NO_ACCOUNT' });
          return;
        }

        if (text === MSG_START_SEARCH || normText.includes(MSG_START_SEARCH_NORM)) {
          emptyStableCount++;
          if (emptyStableCount < 4) scheduleCheck(600);
          else finish({ status: 'NO_RESULT' });
        }
      }

      checkNow();
    });
  }

  return (async () => {
    await ensureClientes();
    if (!triggerSearch(docValue)) return { status: 'ERROR' };
    return waitForDocResult(docValue);
  })();
}

function boReadDocSearchResultScript(docValue) {
  function normalizeDoc(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if ((h.textContent || '').trim() === 'Clientes') return h.parentElement;
    }
    return null;
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

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const rowDoc = normalizeDoc(cells[3]?.textContent || '');
      if (rowDoc !== targetDoc) continue;

      count++;
      if (cells[0].querySelector('[data-tip="Parceiro"]')) {
        hasParceiro = true;
        parceiroCount++;
        if (hasPartnerRowBadge(cells)) partnerBadgeRowCount++;
      }
    }

    if (!count) return { status: 'NO_MATCH' };
    return {
      status: 'FOUND',
      count,
      hasParceiro,
      parceiroCount,
      partnerBadgeRowCount,
      partnerDetailLookup: parceiroCount === 1 || partnerBadgeRowCount === 1
    };
  }

  const container = getResultsContainer();
  if (!container) return { status: 'NO_CONTAINER' };

  const rows = Array.from(container.querySelectorAll('tbody tr'));
  if (!rows.length) return { status: 'NO_ROWS' };

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
  if (partnerDetailLookupStates.has(lookupKey)) return;
  partnerDetailLookupStates.set(lookupKey, 'pending');

  setTimeout(() => {
    if (!isProcessStillValid(proc)) {
      partnerDetailLookupStates.set(lookupKey, 'done');
      return;
    }
    if (proc.processId !== processId) {
      partnerDetailLookupStates.set(lookupKey, 'done');
      return;
    }
    if (!canRunBOSearchForProcess(proc)) {
      partnerDetailLookupStates.set(lookupKey, 'done');
      return;
    }
    if (!hasValidDocLength(docToCheck)) {
      partnerDetailLookupStates.set(lookupKey, 'done');
      return;
    }
    if (!isPartnerDetailPendingAccounts(proc.accounts)) {
      partnerDetailLookupStates.set(lookupKey, 'done');
      return;
    }

    readSinglePartnerDetail(boTabId, docToCheck)
      .then((detailResult) => {
        if (!isProcessStillValid(proc)) return;
        if (proc.processId !== processId) return;
        if (detailResult?.status !== 'FOUND') return;

        const nextAccounts = formatAccountsLabelWithPartnerDetail(result, detailResult.detail);
        if (!nextAccounts) return;
        if (nextAccounts === proc.accounts && proc.accountsSource === 'doc') return;

        proc.accounts = nextAccounts;
        proc.accountsSource = 'doc';
        sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
        updateCacheFromProcess(proc);
      })
      .catch(() => {})
      .finally(() => {
        partnerDetailLookupStates.set(lookupKey, 'done');
      });
  }, 250);
}

function handleDocResult(proc, result, boTabId) {
  
  if (!isProcessStillValid(proc)) return;

  proc.status = 'PROCESSING_DOC_RESULT';

  switch (result?.status) {

    case 'NO_ACCOUNT':
    case 'NO_RESULT':
    case 'TIMEOUT':
      proc.accounts = '> Doc. Estrangeiro/Inv\u00e1lido';
      proc.accountsSource = 'doc';
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      triggerAutoFaturasSearch(proc);
      triggerAutoAssignedActionSearches(proc);
      break;

    case 'FOUND':
      if (!result.secondPass && Number.isInteger(boTabId)) {
        const secondSearchKey = partnerDetailLookupKey(proc, boTabId);
        if (secondSearchKey && !docSecondSearchKeys.has(secondSearchKey)) {
          docSecondSearchKeys.add(secondSearchKey);
          runDocSearch(boTabId, proc.doc)
            .then((secondResult) => {
              if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
              const definitiveResult =
                secondResult?.status === 'FOUND'
                  ? { ...secondResult, secondPass: true }
                  : { ...result, secondPass: true };
              handleDocResult(proc, definitiveResult, boTabId);
            })
            .catch(() => {
              if (!isProcessStillValid(proc) || !canRunBOSearchForProcess(proc)) return;
              handleDocResult(proc, { ...result, secondPass: true }, boTabId);
            })
            .finally(() => {
              if (secondSearchKey) docSecondSearchKeys.delete(secondSearchKey);
            });
          return;
        }
      }

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

  resolveAssignedBOActionTab('faturas', (boTab) => {
    if (!boTab) return;
    if (!canRunBOSearchForProcess(proc)) return;
    runOrReuseBOActionSearch({
      boTabId: boTab.id,
      actionKey: 'faturas',
      proc,
      searchValue: searchTarget.value,
      force: !!opts.force
    }).catch(() => {});
  });
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

function runFaturasSearch(boTabId, searchValue, op = null, proc = null) {
  
  return enqueueSerializedBOSearch(() =>
    shouldRunBOActionScript(op, proc)
      ? chrome.scripting.executeScript({
        target: { tabId: boTabId },
        func: boFaturasSearchScript,
        args: [searchValue]
      }).then(results => results?.[0]?.result ?? { status: 'ERROR' })
      : Promise.resolve({ status: 'STALE_CONTEXT' }),
    40,
    queueKeyForBOTab(boTabId)
  );
}

function runNutrorSearch(boTabId, searchValue, op = null, proc = null) {
  
  return enqueueSerializedBOSearch(() =>
    shouldRunBOActionScript(op, proc)
      ? chrome.scripting.executeScript({
        target: { tabId: boTabId },
        func: boSectionSearchScript,
        args: [searchValue, 'Nutror']
      }).then(results => results?.[0]?.result ?? { status: 'ERROR' })
      : Promise.resolve({ status: 'STALE_CONTEXT' }),
    40,
    queueKeyForBOTab(boTabId)
  );
}

function runContratosSearch(boTabId, searchValue, op = null, proc = null) {
  
  return enqueueSerializedBOSearch(() =>
    shouldRunBOActionScript(op, proc)
      ? chrome.scripting.executeScript({
        target: { tabId: boTabId },
        func: boSectionSearchScript,
        args: [searchValue, 'Next']
      }).then(results => results?.[0]?.result ?? { status: 'ERROR' })
      : Promise.resolve({ status: 'STALE_CONTEXT' }),
    40,
    queueKeyForBOTab(boTabId)
  );
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
      marksCompleted: (result) => result?.status === 'FOUND'
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
      marksCompleted: (result) => ['FOUND', 'NO_RESULT'].includes(result?.status)
    };
  }
  return null;
}

function runOrReuseBOActionSearch({ boTabId, actionKey, proc, searchValue, force = false }) {
  const cfg = getBOActionConfig(actionKey);
  if (!cfg || !Number.isInteger(boTabId) || !proc || !searchValue) {
    return Promise.resolve({ ok: false, reason: 'INVALID_ACTION' });
  }

  const currentValue = normalizeBOActionSearchValue(searchValue);
  const requestKey = getBOActionRequestKey(boTabId, cfg.key, currentValue, proc);
  if (!force && requestKey && boActionInFlightPromises.has(requestKey)) {
    return boActionInFlightPromises.get(requestKey);
  }

  const currentState = getBOActionState(boTabId, cfg.key, currentValue, proc);
  const stateMatches = !!currentState;
  if (!force && isRecentlyStartedBOAction(currentState)) {
    return Promise.resolve({ ok: true, skipped: true, reason: 'ALREADY_STARTING' });
  }

  const runSearchNow = () => {
    if (!canRunBOSearchForProcess(proc)) {
      return Promise.resolve({ ok: false, reason: 'EXTENSION_DISABLED' });
    }
    cancelSiblingBOActionOperationsForTab(boTabId, cfg.key);
    const op = startBOActionOperation(boTabId, cfg.key, currentValue, proc);
    return cfg.runSearch(boTabId, currentValue, op, proc)
      .then((result) => {
        if (result?.status === 'STALE_CONTEXT') {
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
          return { ok: true, searched: true, reason: 'SEARCH_STARTED' };
        }
        return { ok: false, reason: 'ERROR' };
      })
      .catch(() => ({ ok: false, reason: 'ERROR' }))
      .finally(() => finishBOActionOperation(op));
  };

  const actionPromise = cfg.hasVisibleResults(boTabId, currentValue)
    .then((hasVisibleResults) => {
      if (hasVisibleResults) {
        markBOActionState(boTabId, cfg.key, currentValue, proc, stateMatches ? undefined : 'VISIBLE');
        markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
        return { ok: true, skipped: true, reason: 'ALREADY_VISIBLE' };
      }
      if (stateMatches) clearBOActionStateForTab(boTabId);
      return runSearchNow();
    })
    .catch(() => runSearchNow());

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

  function isSearchCategory(expected) {
    const btn = document.querySelector('#menuSearch');
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

  function findSectionRoot() {
    const targetText = sectionId === 'Next' ? 'clientes next' : 'clientes nutror';
    const headers = Array.from(document.querySelectorAll('h3'));
    for (const header of headers) {
      if (normalizeText(header.textContent || '') !== targetText) continue;
      return header.closest('section, #contentContainer, .layout') || header.parentElement;
    }
    return null;
  }

  if (!inputMatchesExpected()) return false;
  if (!isProductTabChecked(sectionId)) return false;
  if (!isSearchCategory('clientes')) return false;
  const sectionRoot = findSectionRoot();
  if (!sectionRoot || !isVisible(sectionRoot)) return false;

  const rows = Array.from(sectionRoot.querySelectorAll('tbody tr, .customer-list tbody tr'))
    .filter(isVisible);
  if (rows.length > 0) return true;

  const text = normalizeText(sectionRoot.textContent || '');
  return text.includes('nenhum resultado') || text.includes('nenhum registro');
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

  function rootMatchesExpected(rootEl) {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;

    const input = document.querySelector('#searchField');
    const currentInput = String(input?.value ?? '').trim();
    if (currentInput) {
      if (expected.includes('@') || currentInput.includes('@')) {
        return normalizeText(currentInput) === normalizeText(expected);
      }
      const expectedDigits = normalizeDigits(expected);
      const currentDigits = normalizeDigits(currentInput);
      if (expectedDigits && currentDigits) return expectedDigits === currentDigits;
      return false;
    }

    const rootText = String(rootEl?.textContent || '');
    if (!rootText) return false;

    if (expected.includes('@')) {
      return normalizeText(rootText).includes(normalizeText(expected));
    }

    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    const rootDigits = normalizeDigits(rootText);
    return rootDigits.includes(expectedDigits);
  }

  function rootHasVisibleRows(rootEl) {
    if (!rootEl || !isVisible(rootEl)) return false;
    const rows = rootEl.querySelectorAll('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr');
    for (const row of rows) {
      if (isVisible(row)) return true;
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
    if (!rootMatchesExpected(root)) continue;
    if (isVisible(root)) return true;
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
    if (!root || !rootMatchesExpected(root)) continue;
    if (isVisible(root)) return true;
  }

  return false;
}

function boFaturasSearchScript(searchValue) {
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
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

  function clickElement(el) {
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
    const item = document.querySelector('#MyEduzz');
    if (!item) return false;
    if (item.classList.contains('checked')) return true;

    for (let attempt = 0; attempt < 3; attempt++) {
      clickElement(item.querySelector('a') || item);
      const deadline = Date.now() + 3500;
      while (Date.now() < deadline) {
        if (item.classList.contains('checked')) return true;
        await delay(120);
      }
    }
    return item.classList.contains('checked');
  }

  async function ensureFaturas2() {
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
      clickElement(btn);
      await delay(140);

      let item = null;
      const start = Date.now();
      while (!item && Date.now() - start < 2200) {
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

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input) return false;

    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);

    if (btn && isVisible(btn)) {
      clickElement(btn);
      return true;
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }

  function hasFaturasResultPopup() {
    const roots = Array.from(document.querySelectorAll('[tabindex="-1"], [role="dialog"], .MuiDialog-root, .MuiPopover-root'))
      .filter(isVisible);
    return roots.some((root) => normalizeText(root.textContent || '').includes('status da fatura'));
  }

  return (async () => {
    const orbitaReady = await ensureOrbita();
    if (!orbitaReady) return { status: 'ERROR' };

    const searchInput = await waitForElement('#searchField', 20000);
    if (!searchInput) return { status: 'ERROR' };
    if (!(await ensureOrbita())) return { status: 'ERROR' };

    const selected = await ensureFaturas2();
    if (!selected) return { status: 'ERROR' };
    if (!(await ensureOrbita())) return { status: 'ERROR' };
    if (!(await ensureFaturas2())) return { status: 'ERROR' };

    if (!triggerSearch(searchValue)) return { status: 'ERROR' };

    await delay(450);
    if (hasFaturasResultPopup()) return { status: 'FOUND' };
    return { status: 'SEARCH_STARTED' };
  })();
}

function boSectionSearchScript(searchValue, sectionId = 'Nutror') {
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
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
      if (normalizeText(header.textContent || '') !== target) continue;
      return header.closest('section, #contentContainer, .layout') || header.parentElement;
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

  async function ensureSection() {
    await dismissFaturasPopupIfPresent();
    if (isTargetProductTabChecked() && document.querySelector('#searchField')) return true;

    const item = findSectionMenuItem();
    if (!item) return false;
    const link = item.querySelector('a[href]') || item.querySelector('a');
    const clickTarget = link || item;

    for (let attempt = 0; attempt < 3; attempt++) {
      await dismissFaturasPopupIfPresent();
      clickElement(clickTarget);

      const deadline = Date.now() + 3500;
      while (Date.now() < deadline) {
        if (isTargetProductTabChecked() && document.querySelector('#searchField')) return true;
        await delay(120);
      }
    }

    return isTargetProductTabChecked() && !!document.querySelector('#searchField');
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

    return false;
  }

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input) return false;

    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);

    if (btn && isVisible(btn)) {
      clickElement(btn);
      return true;
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }

  function focusLoginButton() {
    if (sectionId !== 'Nutror') return false;
    if (!isTargetProductTabChecked()) return false;

    const root = findTargetSectionRoot();
    if (!root || !isVisible(root)) return false;

    const firstRow = Array.from(root.querySelectorAll('tbody tr, table tr'))
      .filter(isVisible)
      .find((row) => row.querySelector('#loginButton'));
    if (!firstRow) return false;

    const loginButtons = Array.from(firstRow.querySelectorAll('#loginButton'))
      .filter(isVisible);
    const target = loginButtons.find((button) => {
      const imgSrc = String(button.querySelector('img')?.getAttribute('src') || '').toLowerCase();
      const tip = normalizeText(button.closest('[data-tip]')?.getAttribute('data-tip') || '');
      return imgSrc.includes('nutror') || tip.includes('nutror');
    });
    if (!target) return false;

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    target.tabIndex = 0;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    target.setAttribute('currentitem', 'true');
    target.closest('[data-tip]')?.setAttribute('currentitem', 'true');
    return true;
  }

  function watchLoginButtonFocus() {
    if (sectionId !== 'Nutror') return;

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
      .filter(isVisible);
    return rows.length > 0;
  }

  function evaluateResultState() {
    if (!isTargetProductTabChecked()) return 'PENDING';
    const root = findTargetSectionRoot();
    const resultText = normalizeText(root?.innerText || '');
    if (resultText.includes('nenhum resultado')) return 'NO_RESULT';
    if (resultText.includes('nenhum registro')) return 'NO_RESULT';
    if (focusLoginButton()) return 'FOUND';
    if (hasVisibleResultRows()) return 'FOUND';
    if (resultText.includes('faca uma busca para comecar')) return 'WAITING_SEARCH';
    return 'PENDING';
  }

  return (async () => {
    await dismissFaturasPopupIfPresent();
    const sectionReady = await ensureSection();
    if (!sectionReady) return { status: 'ERROR' };

    const searchInput = await waitForElement('#searchField', 20000);
    if (!searchInput) return { status: 'ERROR' };
    if (!isTargetProductTabChecked()) return { status: 'ERROR' };

    const selected = await ensureClientes();
    if (!selected) return { status: 'ERROR' };
    if (!isTargetProductTabChecked()) return { status: 'ERROR' };
    if (!(await ensureClientes())) return { status: 'ERROR' };

    if (!triggerSearch(searchValue)) return { status: 'ERROR' };
    watchLoginButtonFocus();

    await delay(450);
    const state = evaluateResultState();
    if (state === 'FOUND') return { status: 'FOUND' };
    if (state === 'NO_RESULT') return { status: 'NO_RESULT' };
    return { status: 'SEARCH_STARTED' };
  })();
}





chrome.storage.session.get([
  'sessionCache',
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


