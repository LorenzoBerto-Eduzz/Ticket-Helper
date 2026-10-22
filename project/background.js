'use strict';





















const processes = new Map();


let activeProcessId = null;


let focusedTabId = null;
let focusEventEpoch = 0;
let pendingTicketFocusTabId = null;
const ticketNavigationEpochs = new Map();


let lastTicketTabId = null;
let lastTicketWindowId = null;
let currentTicketEpoch = 0;
let boPageInvalidation = Promise.resolve();
let ticketSessionWriteRunning = false;
let ticketSessionDirty = false;
let pausedTicketSnapshot = null;
let pausedSnapshotCapturePromise = Promise.resolve();

function persistLastTicketTabId(tabId) {
  lastTicketTabId = tabId;
  queueTicketSessionStateWrite();
}

function queueTicketSessionStateWrite() {
  ticketSessionDirty = true;
  if (ticketSessionWriteRunning) return;
  ticketSessionWriteRunning = true;
  queueMicrotask(async () => {
    while (ticketSessionDirty) {
      ticketSessionDirty = false;
      try {
        await chrome.storage.session.set({ sessionCache: { ...sessionCache }, lastTicketTabId });
      } catch (_) {}
    }
    ticketSessionWriteRunning = false;
  });
}

function notifyTicketOwnerChanged(previousTabId, nextTabId) {
  const message = {
    action: 'TICKET_OWNER_CHANGED',
    ownerTabId: lastTicketTabId,
    ownerTicketId: sessionCache[lastTicketTabId]?.id || processes.get(lastTicketTabId)?.ticketId || null,
    ownerEpoch: currentTicketEpoch,
    focusedTabId
  };
  for (const tabId of new Set([previousTabId, nextTabId])) {
    if (Number.isInteger(tabId)) sendToTab(tabId, message);
  }
}

function retireTicketBoundWork() {
  bo2OrbitaManualRequest++;
  invalidateBO2CustomerRun();
  invalidateBO2NutrorRun();
  invalidateBO1FaturasRun();
  invalidateBO1ContratosRun();
  bo2OrbitaEmailCompleted.clear();
  pendingProc = null;
  boSearchBusy = false;
  boSearchOwner = null;
  clearBO2LastAction();
  const boTabIds = [...new Set([boTab1Id, boTab2Id, ...Object.values(boActionTabIds)])]
    .filter(Number.isInteger);
  for (const tabId of boTabIds) {
    if (!Number.isInteger(tabId)) continue;
    resetBOExecutionQueueForTab(tabId);
    cancelBOActionOperationsForTab(tabId);
  }
  boPageInvalidation = Promise.all(boTabIds.map((tabId) =>
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__ticketHelperBO1SearchToken = null;
        window.__ticketHelperBOActionRun = null;
      }
    }).catch(() => {})
  ));
  boTabActionStates = {};
  persistBOTabState();
  partnerDetailLookupStates.clear();
  docAccountsRefreshKeys.clear();
  docSearchRunKeys.clear();
  docSearchRunStartedAt.clear();
  docResultWatchKeys.clear();
  activeBOContextProcessId = null;
  activeBOContextTicketId = null;
  lastBOTabSyncProcessId = null;
  lastBOTabSyncSignature = null;
  lastBOTabSyncAt = 0;
  persistBOContextState();
}

function claimTicketOwner(tabId, ticketId) {
  if (!Number.isInteger(tabId) || !ticketId) return false;
  const nextId = String(ticketId);
  const priorId = String(sessionCache[lastTicketTabId]?.id ||
    processes.get(lastTicketTabId)?.ticketId || activeHistoryCandidate?.id || '');
  const changed = lastTicketTabId !== tabId || priorId !== nextId;
  if (changed) {
    const previousTabId = lastTicketTabId;
    const priorProcess = processes.get(lastTicketTabId);
    if (priorProcess) updateActiveHistoryCandidateFromProcess(priorProcess);
    if (activeHistoryCandidate?.id && String(activeHistoryCandidate.id) !== nextId) {
      finalizeActiveHistoryCandidate();
      activeHistoryCandidate = null;
      syncTicketHistorySession();
    }
    for (const [otherTabId, proc] of processes) {
      if (otherTabId === tabId && String(proc.ticketId) === nextId) continue;
      proc.status = 'ABORTED';
      processes.delete(otherTabId);
    }
    for (const key of Object.keys(sessionCache)) {
      if (Number(key) === tabId && String(sessionCache[key]?.id) === nextId) continue;
      delete sessionCache[key];
    }
    syncSessionCache();
    activeProcessId = null;
    retireTicketBoundWork();
    currentTicketEpoch++;
    persistLastTicketTabId(tabId);
    notifyTicketOwnerChanged(previousTabId, tabId);
  } else {
    persistLastTicketTabId(tabId);
  }
  pendingTicketFocusTabId = null;
  getExistingTab(tabId).then((tab) => {
    if (lastTicketTabId !== tabId || !Number.isInteger(tab?.windowId)) return;
    if (lastTicketWindowId !== tab.windowId) {
      lastTicketWindowId = tab.windowId;
      scheduleBOWindowLayoutCapture();
    }
  });
  return changed;
}

function noteFocusedTab(tab) {
  if (!Number.isInteger(tab?.id)) return;
  const previousFocusedTabId = focusedTabId;
  focusedTabId = tab.id;
  if (previousFocusedTabId !== tab.id) notifyTicketOwnerChanged(previousFocusedTabId, tab.id);
  const url = tab.url || '';
  if ((extractTicketIdFromTabUrl(url) || isLikelyTicketContextUrl(url)) &&
      Number.isInteger(tab.windowId) && lastTicketWindowId !== tab.windowId) {
    lastTicketWindowId = tab.windowId;
    scheduleBOWindowLayoutCapture();
  }
  pendingTicketFocusTabId = tab.id !== lastTicketTabId &&
    (extractTicketIdFromTabUrl(url) || isLikelyTicketContextUrl(url)) ? tab.id : null;
}

function persistPausedTicketSnapshot(snapshot) {
  pausedTicketSnapshot = snapshot || null;
  return chrome.storage.session.set({ pausedTicketSnapshot }).catch(() => {});
}

function capturePausedTicketSnapshot() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['lastTicketTabId', 'sessionCache'], (stored) => {
      const ownerTabId = Number.isInteger(lastTicketTabId) ? lastTicketTabId : stored.lastTicketTabId;
      if (!Number.isInteger(ownerTabId)) {
        persistPausedTicketSnapshot(null).finally(resolve);
        return;
      }

      chrome.tabs.get(ownerTabId, (tab) => {
        if (chrome.runtime.lastError || !tab || (Number.isInteger(lastTicketTabId) && ownerTabId !== lastTicketTabId)) {
          persistPausedTicketSnapshot(null).finally(resolve);
          return;
        }
        const url = String(tab.url || '');
        const ticketId = String(
          sessionCache[ownerTabId]?.id || stored.sessionCache?.[ownerTabId]?.id || processes.get(ownerTabId)?.ticketId || ''
        ).trim();
        const isTicketAddress = !!extractTicketIdFromTabUrl(url) || isLikelyTicketContextUrl(url);
        persistPausedTicketSnapshot(isTicketAddress && ticketId ? { tabId: ownerTabId, url, ticketId } : null).finally(resolve);
      });
    });
  });
}


let boTab1Id = null;
let boTab2Id = null;
let backOffice2TabIds = [null, null];
let boTabWindowIds = [null, null, null, null];
const BO_WINDOW_LAYOUT_KEY = 'boWindowLayout';
const DEFAULT_BO_WINDOW_LAYOUT = ['other-1', 'other-1', 'other-2', 'other-2'];
let boWindowLayoutCaptureQueue = Promise.resolve();
let boAssignArmedSlot = null;
let boAssignArmedAction = null;
let boActionTabIds = {
  orbita: null,
  faturas: null,
  nutror: null,
  contratos: null
};
let requiredBOTabsReady = false;
let boTabsLaunchInProgress = false;
let pendingBO2LaunchResume = null;
let pendingBO1FaturasLaunchResume = null;
let pendingBO1ContratosLaunchResume = null;
let bo2SetupPlaceholderTabId = null;
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
const BO_DASHBOARD_HOME_URL = 'https://bo.eduzz.com/dashboard/home';
const BACK_OFFICE_2_HOST = 'bo2.eduzz.com';
const BO2_CUSTOMER_URL = 'https://bo2.eduzz.com/bo/customer';
const BO2_NUTROR_URL = 'https://bo2.eduzz.com/nutror/clientes';
const BO1_FATURAS_URL = 'https://bo.eduzz.com/dashboard/home';
const BO1_CONTRATOS_URL = 'https://bo.eduzz.com/dashboard/contratos-next';
const BO_SETUP_PLACEHOLDER_URL = 'about:blank';
const BO_ACTION_KEYS = ['orbita', 'faturas', 'nutror', 'contratos'];
const BO_LAUNCH_WINDOW_TAB_COUNT = 2;
const BO_LAUNCH_TAB_COUNT = BO_LAUNCH_WINDOW_TAB_COUNT * 2;

function clearRetiredProducerWarningsFromOpenBOTabs() {
  chrome.tabs.query({ url: '*://bo.eduzz.com/*' }, (tabs) => {
    for (const tab of tabs || []) {
      if (!Number.isInteger(tab.id)) continue;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          document.querySelectorAll('.ticket-helper-producer-warning, #ticket-helper-producer-warning-styles').forEach((node) => node.remove());
          document.querySelectorAll('[data-tickethelper-producer-warning], [data-tickethelper-faturas-age-warning-id]').forEach((node) => {
            node.removeAttribute('data-tickethelper-producer-warning');
            node.removeAttribute('data-tickethelper-producer-warning-id');
            node.removeAttribute('data-tickethelper-faturas-age-warning-id');
          });
        }
      }).catch(() => {});
    }
  });
}

function persistBOTabState() {
  chrome.storage.session.set({
    boTab1Id,
    boTab2Id,
    backOffice2TabIds,
    boTabWindowIds,
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
  bo2OrbitaManualRequest++;
  invalidateBO2CustomerRun();
  invalidateBO2NutrorRun();
  bo2OrbitaEmailCompleted.clear();
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
  if (key === 'orbita' || key === 'faturas' || key === 'nutror' || key === 'contratos') return key;
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
  const ownerEpoch = currentTicketEpoch;
  return boPageInvalidation.then(() => {
    if (ownerEpoch !== currentTicketEpoch) return;
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
  });
}

function setActiveBOContext(proc) {
  if (!proc) return false;
  const changed = activeBOContextTicketId !== proc.ticketId;
  activeBOContextProcessId = proc.processId;
  activeBOContextTicketId = proc.ticketId;
  persistBOContextState();
  return changed;
}

function isBackOfficeTabUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' && u.hostname === BO_DASHBOARD_HOST;
  } catch {
    return false;
  }
}

function isBackOffice2TabUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' && u.hostname === BACK_OFFICE_2_HOST;
  } catch {
    return false;
  }
}

function getRequiredBOTabAssignments() {
  return [boTab1Id, boTab2Id, ...backOffice2TabIds];
}

function setRequiredBOTabAssignment(index, tabId) {
  if (index === 0) boTab1Id = tabId;
  else if (index === 1) boTab2Id = tabId;
  else if (index === 2 || index === 3) backOffice2TabIds[index - 2] = tabId;
}

function expectedBOTabUrl(index) {
  if (index === 0) return BO1_FATURAS_URL;
  if (index === 1) return BO1_CONTRATOS_URL;
  return index === BO_LAUNCH_WINDOW_TAB_COUNT ? BO2_CUSTOMER_URL : BO2_NUTROR_URL;
}

function rememberBOTabWindow(index, tab) {
  if (!Number.isInteger(index) || !Number.isInteger(tab?.windowId)) return;
  boTabWindowIds[index] = tab.windowId;
}

function normalizeBOWindowLayout(value) {
  if (!Array.isArray(value) || value.length !== BO_LAUNCH_TAB_COUNT) {
    return [...DEFAULT_BO_WINDOW_LAYOUT];
  }
  return value.map((group, index) =>
    group === 'ticket' || /^other-[1-4]$/.test(group)
      ? group : DEFAULT_BO_WINDOW_LAYOUT[index]);
}

async function readBOWindowLayout() {
  try {
    const stored = await chrome.storage.local.get(BO_WINDOW_LAYOUT_KEY);
    return normalizeBOWindowLayout(stored[BO_WINDOW_LAYOUT_KEY]);
  } catch (_) {
    return [...DEFAULT_BO_WINDOW_LAYOUT];
  }
}

async function captureBOWindowLayout(allowDuringLaunch = false) {
  if (boTabsLaunchInProgress && !allowDuringLaunch) return;
  const ids = getRequiredBOTabAssignments();
  const tabs = await Promise.all(ids.map(getExistingTab));
  if (ids.some((id, index) => getRequiredBOTabAssignments()[index] !== id) ||
      (boTabsLaunchInProgress && !allowDuringLaunch)) return;
  tabs.forEach((tab, index) => rememberBOTabWindow(index, tab));
  if (!boTabWindowIds.some(Number.isInteger)) return;

  const previous = await readBOWindowLayout();
  const ticketTab = await getExistingTab(lastTicketTabId);
  let ticketWindowId = Number.isInteger(ticketTab?.windowId)
    ? ticketTab.windowId : lastTicketWindowId;
  if (!Number.isInteger(ticketWindowId) && previous.includes('ticket')) {
    const ticketSlot = previous.findIndex((group, index) =>
      group === 'ticket' && Number.isInteger(boTabWindowIds[index]));
    if (ticketSlot < 0) return;
    ticketWindowId = boTabWindowIds[ticketSlot];
  }
  if (boTabsLaunchInProgress && !allowDuringLaunch) return;

  const groupsByWindow = new Map();
  if (Number.isInteger(ticketWindowId)) groupsByWindow.set(ticketWindowId, 'ticket');
  let nextOtherGroup = 1;
  const nextLayout = tabs.map((tab, index) => {
    const windowId = tab?.windowId;
    if (!Number.isInteger(windowId)) return previous[index];
    if (!groupsByWindow.has(windowId)) {
      groupsByWindow.set(windowId, `other-${nextOtherGroup++}`);
    }
    return groupsByWindow.get(windowId);
  });
  tabs.forEach((tab, index) => {
    if (!tab && groupsByWindow.has(boTabWindowIds[index])) {
      nextLayout[index] = groupsByWindow.get(boTabWindowIds[index]);
    }
  });
  if (nextLayout.every((group, index) => group === previous[index])) return;
  await chrome.storage.local.set({ [BO_WINDOW_LAYOUT_KEY]: nextLayout }).catch(() => {});
}

function scheduleBOWindowLayoutCapture() {
  boWindowLayoutCaptureQueue = boWindowLayoutCaptureQueue
    .then(() => captureBOWindowLayout(), () => captureBOWindowLayout())
    .catch(() => {});
  return boWindowLayoutCaptureQueue;
}

function syncBOTabWindowIdsForExistingTabs() {
  const ids = getRequiredBOTabAssignments();
  Promise.all(ids.map(getExistingTab)).then((tabs) => {
    if (ids.some((id, index) => getRequiredBOTabAssignments()[index] !== id)) return;
    let changed = false;
    tabs.forEach((tab, index) => {
      if (tab && Number.isInteger(tab.windowId) && boTabWindowIds[index] !== tab.windowId) {
        boTabWindowIds[index] = tab.windowId;
        changed = true;
      }
    });
    if (changed) {
      persistBOTabState();
      scheduleBOWindowLayoutCapture();
    }
  });
}

function hasRequiredBOTabAssignments() {
  const tabIds = getRequiredBOTabAssignments();
  return tabIds.every(Number.isInteger) && new Set(tabIds).size === tabIds.length;
}

function checkRequiredBOTabsReady() {
  const tabIds = getRequiredBOTabAssignments();
  if (!hasRequiredBOTabAssignments()) {
    requiredBOTabsReady = false;
    return Promise.resolve(false);
  }

  return Promise.all(tabIds.map(getExistingTab)).then((tabs) => {
    if (getRequiredBOTabAssignments().some((id, index) => id !== tabIds[index])) {
      return requiredBOTabsReady;
    }
    requiredBOTabsReady = tabs.length === tabIds.length && tabs.every((tab, index) =>
      !!tab && (index < BO_LAUNCH_WINDOW_TAB_COUNT ? isBackOfficeTabUrl : isBackOffice2TabUrl)
        (tab.url || tab.pendingUrl || '')
    );
    return requiredBOTabsReady;
  }).catch(() => {
    if (getRequiredBOTabAssignments().every((id, index) => id === tabIds[index])) {
      requiredBOTabsReady = false;
    }
    return false;
  });
}

function checkAndResumeCurrentTicketSearches() {
  const previousReadyState = requiredBOTabsReady;
  checkRequiredBOTabsReady().then((ready) => {
    if (previousReadyState !== ready) broadcastBOTabState();
    if (BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER) return;
    if (!ready || !isExtensionEnabled() || !Number.isInteger(lastTicketTabId)) return;
    const proc = processes.get(lastTicketTabId);
    if (!proc || !isProcessStillValid(proc)) return;
    if (proc.status === 'WAITING_REQUIRED_BO_TABS') proc.status = 'STARTING';
    syncDefinedBOTabsForProcess(proc, { force: true, forceActions: true });
  });
}

function getBOTabState() {
  const requiredTabsAssigned = hasRequiredBOTabAssignments();
  return {
    boTab1Id,
    boTab2Id,
    backOffice2TabIds: [...backOffice2TabIds],
    boTab1Assigned: !!boTab1Id,
    boTab2Assigned: !!boTab2Id,
    backOffice2TabsAssigned: backOffice2TabIds.map(Number.isInteger),
    requiredTabsAssigned,
    requiredTabsReady: requiredTabsAssigned && requiredBOTabsReady,
    armedSlot: boAssignArmedSlot,
    armedAction: boAssignArmedAction,
    actionTabs: {
      orbita: Number.isInteger(boActionTabIds.orbita),
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
  for (const tabId of backOffice2TabIds) {
    if (Number.isInteger(tabId)) targetTabIds.add(tabId);
  }
  if (Number.isInteger(boActionTabIds.orbita)) targetTabIds.add(boActionTabIds.orbita);
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
  for (const key of BO_ACTION_KEYS) {
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
    if (boTab1Id !== nextTabId) {
      invalidateBO1FaturasRun();
      clearBOActionStateForTab(boTab1Id);
    }
    if (Number.isInteger(nextTabId)) changed = clearBOActionTabAssignmentsForTab(nextTabId) || changed;
    changed = changed || boTab1Id !== nextTabId;
    boTab1Id = nextTabId;
  }
  if (slot === 2) {
    const nextTabId = tabId ?? null;
    if (boTab2Id !== nextTabId) {
      invalidateBO1ContratosRun();
      clearBO2LastAction();
      clearBOActionStateForTab(boTab2Id);
    }
    if (Number.isInteger(nextTabId)) changed = clearBOActionTabAssignmentsForTab(nextTabId) || changed;
    changed = changed || boTab2Id !== nextTabId;
    boTab2Id = nextTabId;
  }
  if (changed) {
    requiredBOTabsReady = false;
    persistBOTabState();
    if (notify) broadcastBOTabState();
    checkAndResumeCurrentTicketSearches();
    if (slot === 1 && Number.isInteger(boTab1Id)) {
      resumeBO1FaturasSearchAfterTabAssignment().catch(() => {});
    }
    if (slot === 2 && Number.isInteger(boTab2Id)) {
      resumeBO1ContratosSearchAfterTabAssignment().catch(() => {});
    }
  } else {
    persistBOTabState();
  }
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
  requiredBOTabsReady = false;
  persistBOTabState();
  if (notify) broadcastBOTabState();
  checkAndResumeCurrentTicketSearches();
}

function clearBOTabAssignments(notify = true) {
  invalidateBO1FaturasRun();
  invalidateBO1ContratosRun();
  pendingBO2LaunchResume = null;
  pendingBO1FaturasLaunchResume = null;
  pendingBO1ContratosLaunchResume = null;
  bo2SetupPlaceholderTabId = null;
  boTab1Id = null;
  boTab2Id = null;
  backOffice2TabIds = [null, null];
  boTabWindowIds = [null, null, null, null];
  boAssignArmedSlot = null;
  boAssignArmedAction = null;
  boActionTabIds = {
    orbita: null,
    faturas: null,
    nutror: null,
    contratos: null
  };
  boTabActionStates = {};
  boActionOperationTokens = {};
  clearBO2LastAction();
  requiredBOTabsReady = false;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function getWindowForLaunch(sourceTab) {
  return new Promise((resolve) => {
    if (!Number.isInteger(sourceTab?.windowId)) {
      resolve(null);
      return;
    }
    chrome.windows.get(sourceTab.windowId, {}, (win) => {
      if (chrome.runtime.lastError || !win) {
        resolve(null);
        return;
      }
      resolve(win);
    });
  });
}

function getLastFocusedNormalWindow() {
  return new Promise((resolve) => {
    chrome.windows.getLastFocused({ populate: false }, (win) => {
      resolve(chrome.runtime.lastError || win?.type !== 'normal' ? null : win);
    });
  });
}

function buildBOSetupWindowProps(sourceWindow, screenBounds, position = 'top') {
  const props = {
    url: BO_SETUP_PLACEHOLDER_URL,
    type: 'normal',
    focused: true
  };

  const screenLeft = Number(screenBounds?.left);
  const screenTop = Number(screenBounds?.top);
  const screenWidth = Number(screenBounds?.width);
  const screenHeight = Number(screenBounds?.height);
  if (
    Number.isFinite(screenLeft) && Number.isFinite(screenTop) &&
    Number.isFinite(screenWidth) && screenWidth > 0 &&
    Number.isFinite(screenHeight) && screenHeight > 0
  ) {
    props.width = Math.min(screenWidth, Math.max(400, Math.floor(screenWidth / 2)));
    props.height = Math.min(screenHeight, Math.max(300, Math.floor(screenHeight / 2)));
    props.left = Math.round(screenLeft + screenWidth - props.width);
    props.top = Math.round(screenTop + (position === 'bottom' ? screenHeight - props.height : 0));
    return props;
  }

  if (sourceWindow && Number.isInteger(sourceWindow.left) && Number.isInteger(sourceWindow.top)) {
    const sourceWidth = Number(sourceWindow.width || 0);
    const sourceHeight = Number(sourceWindow.height || 0);
    props.width = Math.max(400, Math.floor(sourceWidth / 2));
    props.height = Math.max(300, Math.floor(sourceHeight / 2));
    props.top = sourceWindow.top + (position === 'bottom' ? sourceHeight - props.height : 0);
    props.left = sourceWindow.left + sourceWidth - props.width;
  }

  return props;
}

function createBOSetupWindow(createProps) {
  return new Promise((resolve) => {
    chrome.windows.create(createProps, (win) => {
      if (chrome.runtime.lastError || !win?.id) {
        resolve(null);
        return;
      }
      resolve(win);
    });
  });
}

function createBOSetupTab(windowId, index, url) {
  return new Promise((resolve) => {
    if (!Number.isInteger(windowId)) {
      resolve(null);
      return;
    }
    const createProperties = {
      windowId,
      url,
      active: false
    };
    if (Number.isInteger(index)) createProperties.index = index;
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function updateBOSetupTabToDashboard(tabId, url, active = false) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId)) {
      resolve(null);
      return;
    }
    chrome.tabs.update(tabId, {
      url,
      active: !!active
    }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function queryTabsInWindow(windowId) {
  return new Promise((resolve) => {
    if (!Number.isInteger(windowId)) {
      resolve([]);
      return;
    }
    chrome.tabs.query({ windowId }, (tabs) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(tabs || []);
    });
  });
}

function getExistingWindow(windowId) {
  return new Promise((resolve) => {
    if (!Number.isInteger(windowId)) return resolve(null);
    chrome.windows.get(windowId, { populate: false }, (win) => {
      if (chrome.runtime.lastError || !win?.id) return resolve(null);
      resolve(win);
    });
  });
}

async function getFirstBOSetupTab(win) {
  const fromWindow = Array.isArray(win?.tabs)
    ? win.tabs.find((tab) => Number.isInteger(tab?.id))
    : null;
  if (fromWindow?.id) return fromWindow;

  for (let attempt = 0; attempt < 10; attempt++) {
    const tabs = await queryTabsInWindow(win?.id);
    const firstTab = tabs
      .filter((tab) => Number.isInteger(tab?.id))
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))[0];
    if (firstTab?.id) return firstTab;
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  return null;
}

function getExistingTab(tabId) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId)) {
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

async function launchDefinedBOTabs(sourceTab, screenBounds, ticketContext = null) {
  if (boTabsLaunchInProgress) {
    return { ok: false, reason: 'LAUNCH_IN_PROGRESS', state: getBOTabState() };
  }
  if (hasRequiredBOTabAssignments()) {
    return { ok: false, reason: 'HAS_ASSIGNMENTS', state: getBOTabState() };
  }

  boTabsLaunchInProgress = true;
  boAssignArmedSlot = null;
  boAssignArmedAction = null;
  persistBOTabState();
  try {
    await boWindowLayoutCaptureQueue;
    await captureBOWindowLayout(true);
    const savedLayout = await readBOWindowLayout();
    const ids = getRequiredBOTabAssignments();
    const liveTabs = await Promise.all(ids.map(getExistingTab));
    const seenIds = new Set();
    liveTabs.forEach((tab, index) => {
      if (ids[index] == null) return;
      if (!tab || seenIds.has(ids[index])) {
        setRequiredBOTabAssignment(index, null);
        requiredBOTabsReady = false;
      } else {
        seenIds.add(ids[index]);
        rememberBOTabWindow(index, tab);
      }
    });

    const missingSlots = getRequiredBOTabAssignments()
      .map((tabId, index) => Number.isInteger(tabId) ? null : index)
      .filter(Number.isInteger);
    if (!missingSlots.length) {
      persistBOTabState();
      broadcastBOTabState();
      return { ok: false, reason: 'HAS_ASSIGNMENTS', state: getBOTabState() };
    }
    if (missingSlots.includes(BO_LAUNCH_WINDOW_TAB_COUNT)) {
      pendingBO2LaunchResume = { sourceTab, ticketContext };
    }
    if (missingSlots.includes(0)) {
      pendingBO1FaturasLaunchResume = { sourceTab, ticketContext };
    }
    if (missingSlots.includes(1)) {
      pendingBO1ContratosLaunchResume = { sourceTab, ticketContext };
    }

    const ticketTab = await getExistingTab(lastTicketTabId);
    const ticketWindow = await getExistingWindow(ticketTab?.windowId ?? lastTicketWindowId) ||
      await getWindowForLaunch(sourceTab) || await getLastFocusedNormalWindow();
    const liveGroupWindowIds = new Map();
    liveTabs.forEach((tab, index) => {
      if (tab && !liveGroupWindowIds.has(savedLayout[index])) {
        liveGroupWindowIds.set(savedLayout[index], tab.windowId);
      }
    });
    const groups = new Map();
    for (const slot of missingSlots) {
      const rememberedWindowId = boTabWindowIds[slot];
      const key = savedLayout[slot];
      const windowId = key === 'ticket' ? ticketWindow?.id :
        (liveGroupWindowIds.get(key) ?? rememberedWindowId);
      if (!groups.has(key)) groups.set(key, { windowId, slots: [] });
      groups.get(key).slots.push(slot);
    }

    const screenProps = buildBOSetupWindowProps(null, screenBounds, 'top');
    const sourceWindow = Number.isInteger(screenProps.left) && Number.isInteger(screenProps.top)
      ? null
      : await getWindowForLaunch(sourceTab);
    const createGroup = async (group) => {
      let targetWindow = await getExistingWindow(group.windowId);
      let firstTab = null;
      if (!targetWindow) {
        const firstSlot = group.slots[0];
        const position = firstSlot < BO_LAUNCH_WINDOW_TAB_COUNT ? 'top' : 'bottom';
        const props = buildBOSetupWindowProps(sourceWindow, screenBounds, position);
        targetWindow = await createBOSetupWindow(props);
        if (!targetWindow) return false;
        firstTab = await getFirstBOSetupTab(targetWindow);
        if (!firstTab?.id) return false;
      }

      let createdAll = true;
      for (const slot of group.slots) {
        const url = expectedBOTabUrl(slot);
        const usesPlaceholder = !!firstTab;
        // A new window starts on about:blank; mark it before Chrome emits its
        // navigation events so that it cannot cancel the pending customer count.
        if (slot === BO_LAUNCH_WINDOW_TAB_COUNT && usesPlaceholder) {
          bo2SetupPlaceholderTabId = firstTab.id;
        }
        const tab = firstTab
          ? await updateBOSetupTabToDashboard(firstTab.id, url, false)
          : await createBOSetupTab(targetWindow.id, undefined, url);
        firstTab = null;
        if (!tab?.id) {
          if (slot === BO_LAUNCH_WINDOW_TAB_COUNT) bo2SetupPlaceholderTabId = null;
          createdAll = false;
          continue;
        }
        setRequiredBOTabAssignment(slot, tab.id);
        rememberBOTabWindow(slot, { ...tab, windowId: targetWindow.id });
        clearBOActionStateForTab(tab.id);
        persistBOTabState();
      }
      return createdAll;
    };

    const outcomes = await Promise.all([...groups.values()].map(createGroup));
    requiredBOTabsReady = false;
    persistBOTabState();
    const faturasTabAtLaunch = await getExistingTab(boTab1Id);
    const contratosTabAtLaunch = await getExistingTab(boTab2Id);
    await Promise.allSettled([
      faturasTabAtLaunch?.status === 'complete' &&
        faturasTabAtLaunch.url?.startsWith(BO1_FATURAS_URL)
        ? resumeBO1FaturasSearchAfterTabAssignment(sourceTab, ticketContext) : null,
      contratosTabAtLaunch?.status === 'complete' &&
        contratosTabAtLaunch.url?.startsWith(BO1_CONTRATOS_URL)
        ? resumeBO1ContratosSearchAfterTabAssignment(sourceTab, ticketContext) : null,
      Number.isInteger(backOffice2TabIds[0])
        ? resumeBO2CustomerCountAfterTabAssignment(sourceTab, ticketContext) : null,
      Number.isInteger(backOffice2TabIds[1])
        ? resumeBO2NutrorSearchAfterTabAssignment() : null
    ]);
    broadcastBOTabState();
    await checkRequiredBOTabsReady();
    const customerTab = await getExistingTab(backOffice2TabIds[0]);
    if (pendingBO2LaunchResume && customerTab?.status === 'complete' &&
        customerTab.url?.startsWith(BO2_CUSTOMER_URL)) {
      const pending = pendingBO2LaunchResume;
      pendingBO2LaunchResume = null;
      bo2SetupPlaceholderTabId = null;
      await resumeBO2CustomerCountAfterTabAssignment(pending.sourceTab, pending.ticketContext);
    }
    const faturasTab = await getExistingTab(boTab1Id);
    if (pendingBO1FaturasLaunchResume && faturasTab?.status === 'complete' &&
        faturasTab.url?.startsWith(BO1_FATURAS_URL)) {
      const pending = pendingBO1FaturasLaunchResume;
      pendingBO1FaturasLaunchResume = null;
      await resumeBO1FaturasSearchAfterTabAssignment(pending.sourceTab, pending.ticketContext);
    }
    const contratosTab = await getExistingTab(boTab2Id);
    if (pendingBO1ContratosLaunchResume && contratosTab?.status === 'complete' &&
        contratosTab.url?.startsWith(BO1_CONTRATOS_URL)) {
      const pending = pendingBO1ContratosLaunchResume;
      pendingBO1ContratosLaunchResume = null;
      await resumeBO1ContratosSearchAfterTabAssignment(pending.sourceTab, pending.ticketContext);
    }
    const allAssigned = hasRequiredBOTabAssignments();
    const launchSucceeded = outcomes.every(Boolean) && allAssigned;
    return {
      ok: launchSucceeded,
      reason: launchSucceeded ? undefined : 'TABS_FAILED',
      state: getBOTabState()
    };
  } finally {
    boTabsLaunchInProgress = false;
    scheduleBOWindowLayoutCapture();
    if (!Number.isInteger(backOffice2TabIds[0])) {
      pendingBO2LaunchResume = null;
      bo2SetupPlaceholderTabId = null;
    }
    if (!Number.isInteger(boTab1Id)) pendingBO1FaturasLaunchResume = null;
    if (!Number.isInteger(boTab2Id)) pendingBO1ContratosLaunchResume = null;
  }
}

function getAssignedBOTabId(slot) {
  return slot === 2 ? boTab2Id : boTab1Id;
}

function focusBOTab(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !isBackOfficeTabUrl(tab.url || '')) {
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

function waitForBOTabAwake(tabId, timeoutMs = 1800) {
  if (!Number.isInteger(tabId)) return Promise.resolve(false);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tick = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !isBackOfficeTabUrl(tab.url || '')) {
          resolve(false);
          return;
        }

        if (tab.status && tab.status !== 'complete' && Date.now() - startedAt < timeoutMs) {
          setTimeout(tick, 90);
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId },
          func: () => Boolean(document?.body)
        }).then((results) => {
          resolve(Boolean(results?.[0]?.result));
        }).catch(() => {
          if (Date.now() - startedAt >= timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(tick, 120);
        });
      });
    };

    tick();
  });
}

function assignBOTabSlotFromArmedTab(slot, tabId) {
  if ((slot === 1 && boTab1Id !== tabId) ||
      (slot === 2 && boTab1Id === tabId)) invalidateBO1FaturasRun();
  if (slot === 2 && boTab2Id !== tabId) invalidateBO1ContratosRun();
  const hadBO1Assigned = Number.isInteger(boTab1Id);
  const prevBoTab2Id = boTab2Id;
  const otherSlot = slot === 1 ? 2 : 1;
  const targetIndex = slot - 1;
  const otherIndex = otherSlot - 1;
  const currentTargetTabId = getAssignedBOTabId(slot);
  const currentOtherTabId = getAssignedBOTabId(otherSlot);

  if (currentOtherTabId === tabId) {
    
    
    if (currentTargetTabId && currentTargetTabId !== tabId) {
      if (otherSlot === 1) boTab1Id = currentTargetTabId;
      else boTab2Id = currentTargetTabId;
      boTabWindowIds[otherIndex] = boTabWindowIds[targetIndex];
    } else {
      if (otherSlot === 1) boTab1Id = null;
      else boTab2Id = null;
      boTabWindowIds[otherIndex] = null;
    }
  }

  clearBOActionStateForTab(currentTargetTabId);
  clearBOActionStateForTab(tabId);
  clearBOActionTabAssignmentsForTab(tabId);
  if (slot === 1) boTab1Id = tabId;
  else boTab2Id = tabId;
  getExistingTab(tabId).then((tab) => {
    if (getRequiredBOTabAssignments()[targetIndex] !== tabId || !tab) return;
    rememberBOTabWindow(targetIndex, tab);
    persistBOTabState();
    scheduleBOWindowLayoutCapture();
  });

  if (prevBoTab2Id !== boTab2Id) clearBO2LastAction();

  boAssignArmedSlot = null;
  boAssignArmedAction = null;
  persistBOTabState();
  broadcastBOTabState();

  const bo1WasJustAssigned = !hadBO1Assigned && Number.isInteger(boTab1Id);
  if (slot === 1 && bo1WasJustAssigned) {
    restartCurrentTicketAfterBO1Assigned();
  }
  if (Number.isInteger(boTab1Id) && (slot === 1 || currentOtherTabId === tabId)) {
    resumeBO1FaturasSearchAfterTabAssignment().catch(() => {});
  }
  if (Number.isInteger(boTab2Id) && (slot === 2 || currentOtherTabId === tabId)) {
    resumeBO1ContratosSearchAfterTabAssignment().catch(() => {});
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
  if (BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER) return;
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
  if (!isBackOfficeTabUrl(tab.url || '')) return;

  if (boAssignArmedSlot) {
    assignBOTabSlotFromArmedTab(boAssignArmedSlot, tab.id);
    return;
  }
  if (boAssignArmedAction) {
    assignBOActionTabFromArmedTab(boAssignArmedAction, tab.id);
  }
}

function clearAssignedBOTabIfRemoved(tabId) {
  if (tabId === backOffice2TabIds[0]) {
    pendingBO2LaunchResume = null;
    bo2SetupPlaceholderTabId = null;
  }
  stopPendingBO2CustomerCount(tabId);
  if (tabId === backOffice2TabIds[1]) invalidateBO2NutrorRun();
  let changed = false;
  if (boTab1Id === tabId) {
    pendingBO1FaturasLaunchResume = null;
    invalidateBO1FaturasRun();
    clearBOActionStateForTab(tabId);
    boTab1Id = null;
    changed = true;
  }
  if (boTab2Id === tabId) {
    pendingBO1ContratosLaunchResume = null;
    invalidateBO1ContratosRun();
    clearBOActionStateForTab(tabId);
    boTab2Id = null;
    clearBO2LastAction();
    changed = true;
  }
  for (let index = 0; index < backOffice2TabIds.length; index++) {
    if (backOffice2TabIds[index] !== tabId) continue;
    backOffice2TabIds[index] = null;
    changed = true;
  }
  for (const actionKey of BO_ACTION_KEYS) {
    if (boActionTabIds[actionKey] === tabId) {
      clearBOActionStateForTab(tabId);
      boActionTabIds[actionKey] = null;
      clearBO2LastAction();
      changed = true;
    }
  }
  if (changed) {
    requiredBOTabsReady = false;
    persistBOTabState();
    broadcastBOTabState();
    checkAndResumeCurrentTicketSearches();
  }
}

function resolveAssignedBOTab1(callback) {
  if (!boTab1Id) {
    callback(null);
    return;
  }

  chrome.tabs.get(boTab1Id, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      if (boTab1Id !== null) setBOTabAssignment(1, null);
      callback(null);
      return;
    }
    if (!isBackOfficeTabUrl(tab.url || tab.pendingUrl || '')) return callback(null);
    callback(tab);
  });
}

function resolveAssignedBOTab2(callback) {
  if (!boTab2Id) {
    callback(null);
    return;
  }

  chrome.tabs.get(boTab2Id, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      if (boTab2Id !== null) setBOTabAssignment(2, null);
      callback(null);
      return;
    }
    if (!isBackOfficeTabUrl(tab.url || tab.pendingUrl || '')) return callback(null);
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
    if (chrome.runtime.lastError || !tab) {
      if (boActionTabIds[actionKey] !== null) setBOActionTabAssignment(actionKey, null);
      resolveAssignedBOTab2(callback);
      return;
    }
    if (!isBackOfficeTabUrl(tab.url || tab.pendingUrl || '')) return callback(null);
    callback(tab);
  });
}

function resolveAssignedBODedicatedActionTab(actionKeyArg, callback) {
  const actionKey = normalizeActionTabKey(actionKeyArg);
  if (!actionKey) {
    callback(null);
    return;
  }

  const actionTabId = boActionTabIds[actionKey];
  if (!actionTabId) {
    callback(null);
    return;
  }

  chrome.tabs.get(actionTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      if (boActionTabIds[actionKey] !== null) setBOActionTabAssignment(actionKey, null);
      callback(null);
      return;
    }
    if (!isBackOfficeTabUrl(tab.url || tab.pendingUrl || '')) return callback(null);
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
  const text = String(value ?? '').trim();
  if (!text) return false;

  const rawCpf = /^\d{11}$/;
  const formattedCpf = /^\d{3}[-./]\d{3}[-./]\d{3}[-./]\d{2}$/;
  const rawCnpj = /^\d{14}$/;
  const formattedCnpj = /^\d{2}[-./]\d{3}[-./]\d{3}[-./]\d{4}[-./]\d{2}$/;

  return rawCpf.test(text) || formattedCpf.test(text) || rawCnpj.test(text) || formattedCnpj.test(text);
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
    .then(async () => {
      await boPageInvalidation;
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
let sessionStateReady = false;
let resolveSessionStateReady = null;
const sessionStateReadyPromise = new Promise((resolve) => {
  resolveSessionStateReady = resolve;
});

function markSessionStateReady() {
  if (sessionStateReady) return;
  sessionStateReady = true;
  resolveSessionStateReady?.(true);
}

function ensureSessionStateReady(timeoutMs = 1200) {
  if (sessionStateReady) return Promise.resolve(true);
  return withTimeout(sessionStateReadyPromise, timeoutMs, false);
}

const TICKET_HISTORY_SESSION_KEY = 'ticketHistory';
const ACTIVE_HISTORY_CANDIDATE_SESSION_KEY = 'activeHistoryCandidate';
const HUBSPOT_PORTAL_ID_SESSION_KEY = 'hubspotPortalId';
const MAX_TICKET_HISTORY_ITEMS = 100;
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
  const rawEmail = String(rawItem?.email ?? '').trim();
  const legacyName = String(rawItem?.name ?? '').trim();
  const email = isUsableHistoryField(rawEmail)
    ? rawEmail
    : (legacyName.includes('@') && isUsableHistoryField(legacyName) ? legacyName : '-');
  if (!id || !kind) return null;
  return { kind, id, email };
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
      email: String(item.email || '-')
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
    active: false
  };
  if (Number.isInteger(openerTab?.id)) createProps.openerTabId = openerTab.id;
  if (Number.isInteger(openerTab?.index)) createProps.index = openerTab.index + 1;

  chrome.tabs.create(createProps, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      callback?.({ ok: false, reason: 'OPEN_FAILED' });
      return;
    }
    callback?.({ ok: true, tabId: tab.id });
  });
}

function resolveHistoryEmail(snapshot = {}) {
  const rawEmail = String(snapshot.email ?? '').trim();
  if (isUsableHistoryField(rawEmail)) return rawEmail;
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
    email: resolveHistoryEmail(proc),
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
    email: resolveHistoryEmail(activeHistoryCandidate)
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
    email: resolveHistoryEmail(candidate)
  };
  ticketHistory = ticketHistory.filter(item => getHistoryItemKey(item) !== getHistoryItemKey(activeHistoryCandidate));
  syncTicketHistorySession();
}

function updateActiveHistoryCandidateFromProcess(proc) {
  if (!proc?.ticketId || !activeHistoryCandidate) return;
  if (String(activeHistoryCandidate.id) !== String(proc.ticketId)) return;

  activeHistoryCandidate = {
    ...activeHistoryCandidate,
    email: isUsableHistoryField(proc.email) ? String(proc.email).trim() : activeHistoryCandidate.email || '-',
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








const BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER = true;
const bo2CustomerRuns = new Map();
const bo2OrbitaEmailCompleted = new Map();
let bo2OrbitaManualRequest = 0;

function resolveHubSpotBO2SearchTarget(proc) {
  if (!proc || !['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP'].includes(proc.status)) return null;
  if (proc.status === 'REQUESTER_LOOKUP') {
    const email = normalizeEmailForFaturasSearch(proc.email);
    return email && !/\s/.test(email) ? { mode: 'email', value: email.toLowerCase() } : null;
  }
  const doc = normalizeDocForFaturasSearch(proc.doc);
  if (hasValidDocLength(doc)) {
    return { mode: 'doc', value: doc.replace(/\D/g, '') };
  }
  if (!isNoDocStatus(proc.doc) && !isForeignOrInvalidDocStatus(proc.doc)) return null;
  const email = normalizeEmailForFaturasSearch(proc.email);
  return email && !/\s/.test(email) ? { mode: 'email', value: email.toLowerCase() } : null;
}

function isRequesterLookupPending(doc, accountType) {
  return String(doc || '').trim() === '...' && !!String(accountType || '').trim();
}

function isFinalRequesterLookupDoc(doc) {
  return ['> Email sem conta', '> Múltiplas contas'].includes(String(doc || '').trim());
}

function preserveFinalRequesterLookupDoc(nextDoc, previousDoc) {
  return isFinalRequesterLookupDoc(previousDoc) && nextDoc !== previousDoc
    ? previousDoc : nextDoc;
}

function invalidateBO2CustomerRun() {
  const tabId = backOffice2TabIds[0];
  if (!Number.isInteger(tabId) || !bo2CustomerRuns.size) return;
  chrome.scripting.executeScript({ target: { tabId },
    args: [[...bo2CustomerRuns.values()]],
    func: (tokens) => {
      if (tokens.includes(globalThis.__ticketHelperCustomerSearchToken)) {
        globalThis.__ticketHelperCustomerSearchToken = null;
      }
    }
  }).catch(() => {});
}

function canContinueBO2CustomerCount(proc, tabId, target, ownerEpoch) {
  const currentTarget = resolveHubSpotBO2SearchTarget(proc);
  return isExtensionEnabled() && processes.get(proc.tabId)?.processId === proc.processId &&
    ['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP'].includes(proc.status) &&
    isCurrentTicketOwnerProcess(proc) &&
    currentTicketEpoch === ownerEpoch && backOffice2TabIds[0] === tabId &&
    currentTarget?.mode === target.mode && currentTarget.value === target.value;
}

function hasCompletedBO2CustomerCount(value) {
  const text = String(value ?? '').trim();
  return /^.+ \| (?:[1-4]|5\+)$/.test(text) || text === '> Nenhuma conta';
}

function normalizeHubSpotAccountType(value) {
  const text = String(value ?? '').trim();
  return /^[-–—−]+$/.test(text) ? 'Cliente Final' : text;
}

function stopPendingBO2CustomerCount(tabId) {
  if (backOffice2TabIds[0] !== tabId) return;
  const proc = processes.get(lastTicketTabId);
  if (!proc || !bo2CustomerRuns.has(proc.processId) || proc.accounts !== '...' ||
      !isCurrentTicketOwnerProcess(proc)) return;
  proc.accounts = '-';
  proc.accountsSource = null;
  proc.maskedEmails = null;
  sendPopupUpdate(proc, { accounts: '-' });
  updateCacheFromProcess(proc);
  invalidateBO2CustomerRun();
  bo2CustomerRuns.delete(proc.processId);
}

function startBO2CustomerCountIfReady(proc) {
  if (proc) proc.accountType = normalizeHubSpotAccountType(proc.accountType);
  const target = resolveHubSpotBO2SearchTarget(proc);
  if (!proc || !['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP'].includes(proc.status) ||
      isFinalRequesterLookupDoc(proc.doc) ||
      !isCurrentTicketOwnerProcess(proc) || !isExtensionEnabled() ||
      !Number.isInteger(backOffice2TabIds[0]) || !target ||
      (target.mode === 'doc' && (!proc.accountType ||
        (proc.accountsSource === 'bo2_customer' &&
          (proc.accounts === '> Nenhuma conta' || !!proc.maskedEmails)))) ||
      (target.mode === 'email' && bo2OrbitaEmailCompleted.get(proc.processId) === target.value) ||
      bo2CustomerRuns.has(proc.processId)) return;
  if (target.mode === 'doc') {
    proc.accounts = '...';
    proc.accountsSource = null;
    proc.maskedEmails = null;
    sendPopupUpdate(proc, { accounts: '...' });
    updateCacheFromProcess(proc);
  } else if (proc.status === 'REQUESTER_LOOKUP') {
    sendPopupUpdate(proc, { doc: '...' });
  }
  runBO2CustomerCount(proc);
}

async function resumeBO2CustomerCountAfterTabAssignment(sourceTab = null, ticketContext = null) {
  const ownerTabId = lastTicketTabId;
  const ownerEpoch = currentTicketEpoch;
  const assignedTabId = backOffice2TabIds[0];
  const cached = sessionCache[ownerTabId] || {};
  const captured = sourceTab?.id === ownerTabId && !!ticketContext?.processId &&
    !!ticketContext?.ticketId && !!resolveHubSpotBO2SearchTarget({
      status: ticketContext.doc === '...' && ticketContext.accountType
        ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED',
      doc: ticketContext.doc, email: ticketContext.email
    });
  const ticketId = String(captured ? ticketContext.ticketId : cached.id || '');
  if (String(cached.id || '') === ticketId && isFinalRequesterLookupDoc(cached.doc)) return;
  const doc = captured ? String(ticketContext.doc).trim() : cached.doc;
  const email = captured ? String(ticketContext.email || '').trim() : cached.email;
  const requesterPending = isRequesterLookupPending(doc,
    captured ? ticketContext.accountType : cached.accountType);
  const target = resolveHubSpotBO2SearchTarget({
    status: requesterPending ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED', doc, email
  });
  if (!isExtensionEnabled() || !Number.isInteger(ownerTabId) ||
      !Number.isInteger(assignedTabId) || !ticketId || !target) return;

  const ownerTab = await getExistingTab(ownerTabId);
  if (lastTicketTabId !== ownerTabId || currentTicketEpoch !== ownerEpoch ||
      backOffice2TabIds[0] !== assignedTabId ||
      (String(sessionCache[ownerTabId]?.id || '') === ticketId &&
        isFinalRequesterLookupDoc(sessionCache[ownerTabId]?.doc)) ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId ||
      (!captured && sessionCache[ownerTabId]?.id &&
        String(sessionCache[ownerTabId].id) !== ticketId)) return;

  let proc = processes.get(ownerTabId);
  if (proc && ((String(proc.ticketId) === ticketId && isFinalRequesterLookupDoc(proc.doc)) ||
      bo2CustomerRuns.has(proc.processId))) return;
  const live = captured ? {
    currentProcessId: ticketContext.processId,
    data: { accountType: ticketContext.accountType }
  } : await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' })
    .catch(() => null);
  if (lastTicketTabId !== ownerTabId || currentTicketEpoch !== ownerEpoch ||
      backOffice2TabIds[0] !== assignedTabId || !live?.currentProcessId ||
      (String(sessionCache[ownerTabId]?.id || '') === ticketId &&
        isFinalRequesterLookupDoc(sessionCache[ownerTabId]?.doc)) ||
      (!captured && (!live.isTicketPage ||
        String(live.currentTicketId || '') !== ticketId ||
        String(live.data?.id || '') !== ticketId))) return;
  const accountType = normalizeHubSpotAccountType(
    (captured ? ticketContext.accountType : null) || cached.accountType ||
    proc?.accountType || live.data?.accountType);
  if (target.mode === 'doc' && !accountType) return;
  const completedCount = target.mode === 'doc' && String(cached.id || '') === ticketId &&
    String(cached.doc || '').trim() === String(doc).trim() &&
    hasCompletedBO2CustomerCount(cached.accounts) &&
    (cached.accounts === '> Nenhuma conta' || !!cached.maskedEmails);
  if (completedCount) {
    const countMatch = String(cached.accounts).match(/ \| ([1-4]|5\+)$/);
    if (countMatch && String(cached.accounts) !== `${accountType} | ${countMatch[1]}`) {
      cached.accounts = `${accountType} | ${countMatch[1]}`;
      cached.accountType = accountType;
      syncSessionCache();
      if (proc && String(proc.ticketId) === ticketId) {
        proc.accounts = cached.accounts;
        proc.accountType = accountType;
      }
      sendToTab(ownerTabId, { action: 'UPDATE_POPUP', processId: live.currentProcessId,
        fields: { accounts: cached.accounts } });
    }
    return;
  }
  if (!proc || String(proc.ticketId) !== ticketId ||
      proc.processId !== live.currentProcessId) {
    if (proc) proc.status = 'ABORTED';
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: captured ? ticketContext.name : cached.name,
      email, doc,
      accounts: '-', accountsSource: null, maskedEmails: null,
      accountType, status: requesterPending ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED',
      docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
    activeProcessId = proc.processId;
  }
  proc.doc = doc;
  proc.email = email;
  proc.accountType = accountType;
  proc.accountsSource = null;
  proc.maskedEmails = null;
  proc.status = requesterPending ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED';
  if (captured && String(sessionCache[ownerTabId]?.id || '') !== ticketId) {
    sessionCache[ownerTabId] = { id: ticketId,
      name: ticketContext.name ?? null, email: ticketContext.email ?? null,
      doc, accounts: '-', accountsSource: null, accountType };
    syncSessionCache();
  }
  startBO2CustomerCountIfReady(proc);
}

function applyRequesterCustomerLookup(proc, result, searchedEmail) {
  if (result?.kind !== 'found' && result?.kind !== 'none') return false;
  const recoveredDoc = result.kind === 'found' && result.count === 1
    ? normalizeCachedHubSpotDoc(result.docs?.[0] || '--') : null;
  proc.doc = result.kind === 'none' ? '> Email sem conta' :
    result.count !== 1 ? '> Múltiplas contas' :
    hasValidDocLength(recoveredDoc) ? recoveredDoc.replace(/\D/g, '') : recoveredDoc;
  if (result.kind === 'found' && result.count === 1 &&
      (!proc.name || proc.name === '-')) {
    proc.name = toTitleCase(result.names?.[0] || '') || proc.name;
  }
  proc.status = result.kind === 'none' || result.count !== 1
    ? 'SIDEBAR_HALTED' : 'SIDEBAR_RESOLVED';
  proc.accounts = proc.status === 'SIDEBAR_RESOLVED' &&
    hasValidDocLength(proc.doc) ? '...' : '-';
  proc.accountsSource = null;
  proc.maskedEmails = null;
  sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
  updateCacheFromProcess(proc);
  if (proc.status === 'SIDEBAR_RESOLVED' && !hasValidDocLength(proc.doc)) {
    bo2OrbitaEmailCompleted.set(proc.processId, searchedEmail);
  }
  return proc.status === 'SIDEBAR_RESOLVED';
}

async function runBO2CustomerCount(proc, { preserveCompleted = false } = {}) {
  const tabId = backOffice2TabIds[0];
  const target = resolveHubSpotBO2SearchTarget(proc);
  if (!target || !Number.isInteger(tabId)) return;
  if (bo2CustomerRuns.has(proc.processId)) return;
  const runId = uid();
  bo2CustomerRuns.set(proc.processId, runId);
  let resolvedRequester = false;
  const ownerEpoch = currentTicketEpoch;
  const stillCurrent = () => bo2CustomerRuns.get(proc.processId) === runId &&
    canContinueBO2CustomerCount(proc, tabId, target, ownerEpoch);
  try {
    if (!stillCurrent()) return;
    let tab = await chrome.tabs.get(tabId);
    if (!stillCurrent()) return;
    const onCustomerPage = (url) => {
      try { const parsed = new URL(url); return parsed.origin === 'https://bo2.eduzz.com' &&
        parsed.pathname.replace(/\/$/, '') === '/bo/customer'; } catch { return false; }
    };
    if (!onCustomerPage(tab.url || tab.pendingUrl || '')) {
      tab = await chrome.tabs.update(tabId, { url: BO2_CUSTOMER_URL });
    }
    if (!stillCurrent()) return;
    const pageDeadline = Date.now() + 30000;
    while (stillCurrent() && Date.now() < pageDeadline) {
      tab = await chrome.tabs.get(tabId);
      if (onCustomerPage(tab.url || '') && tab.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stillCurrent() || !onCustomerPage(tab?.url || '') || tab?.status !== 'complete') {
      if (stillCurrent() && target.mode === 'doc' && !preserveCompleted) {
        proc.accounts = '-';
        proc.accountsSource = null;
        proc.maskedEmails = null;
        sendPopupUpdate(proc, { accounts: '-' });
        updateCacheFromProcess(proc);
      }
      return;
    }
    const results = await chrome.scripting.executeScript({ target: { tabId },
      args: [target.value, target.mode, runId],
      func: async (expectedValue, mode, token) => {
        globalThis.__ticketHelperCustomerSearchToken = token;
        const active = () => globalThis.__ticketHelperCustomerSearchToken === token &&
          location.origin === 'https://bo2.eduzz.com' &&
          location.pathname.replace(/\/$/, '') === '/bo/customer';
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const readyDeadline = Date.now() + 30000;
        let input, button, main;
        while (active() && Date.now() < readyDeadline) {
          main = document.querySelector('main');
          input = main?.querySelector('#customer-search-input');
          button = main?.querySelector('#customer-search-button');
          if (input && button && !button.disabled) break;
          await sleep(100);
        }
        if (!active() || !input || !button) return { kind: 'unavailable' };
        const resultRoot = () => Array.from(main.children).find(node =>
          node.classList.contains('bo:flex-col') && node.classList.contains('bo:gap-4'));
        const maskEmail = (value) => {
          const match = String(value || '').trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
          if (!match) return null;
          return `${match[1].slice(0, 2)}****${match[1].slice(5)}@${match[2]}`;
        };
        const readResult = () => {
          const root = resultRoot();
          if (main.querySelector('.ant-empty-description')?.textContent?.trim() ===
              'Nenhum cliente encontrado') return { kind: 'none' };
          if (!root) return { kind: 'pending' };
          const cards = [...root.querySelectorAll('.ant-card.ant-card-bordered')];
          if (!cards.length) return { kind: 'pending' };
          const maskedEmails = [];
          const docs = [];
          const names = [];
          for (const card of cards) {
            const labels = [...card.querySelectorAll('.ant-card-body span')];
            const emailLabel = labels.find(node => node.textContent?.trim() === 'E-mail:');
            const foundEmail = String(emailLabel?.nextElementSibling?.textContent || '').trim();
            if (mode === 'email') {
              if (foundEmail.toLowerCase() !== expectedValue) return { kind: 'mismatch' };
              const docLabel = labels.find(node => node.textContent?.trim() === 'CPF/CNPJ:');
              docs.push(String(docLabel?.nextElementSibling?.textContent || '').trim());
              names.push(card.querySelector('.ant-card-head-title > div > span')?.textContent?.trim() || '');
            } else {
              const docLabel = labels.find(node => node.textContent?.trim() === 'CPF/CNPJ:');
              const foundDoc = docLabel?.nextElementSibling?.textContent?.replace(/\D/g, '') || '';
              if (foundDoc !== expectedValue) return { kind: 'mismatch' };
              const maskedEmail = maskEmail(foundEmail);
              if (!maskedEmail) return { kind: 'pending' };
              maskedEmails.push(maskedEmail);
            }
          }
          return { kind: 'found', count: cards.length, maskedEmails, docs, names };
        };
        let resultChanged = false;
        let lastResultMutationAt = 0;
        let submitted = false;
        const observer = new MutationObserver(records => {
          if (!submitted) return;
          if (records.some(record => {
            const root = resultRoot();
            const empty = main.querySelector('.ant-empty');
            return (root && (record.target === root || root.contains(record.target) ||
              [...record.addedNodes].some(node => node === root || node.contains?.(root)))) ||
              (empty && (record.target === empty || empty.contains(record.target) ||
              [...record.addedNodes].some(node => node === empty || node.contains?.(empty))));
          })) {
            resultChanged = true;
            lastResultMutationAt = Date.now();
          }
        });
        observer.observe(main, { childList: true, characterData: true, subtree: true });
        try {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, expectedValue);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(0);
          if (!active()) return { kind: 'cancelled' };
          submitted = true;
          button.click();
          const resultDeadline = Date.now() + 45000;
          let candidate = null;
          let candidateSince = 0;
          while (active() && Date.now() < resultDeadline) {
            const currentInput = mode === 'doc' ? input.value.replace(/\D/g, '') :
              input.value.trim().toLowerCase();
            if (currentInput !== expectedValue) {
              return { kind: 'cancelled' };
            }
            const value = readResult();
            const pending = !!main.querySelector('.ant-spin-spinning, [aria-busy="true"], .ant-skeleton');
            const resultReady = value.kind === 'found' ||
              (value.kind === 'none' && !pending && resultChanged);
            if (resultReady) {
              const signature = `${value.kind}:${value.count ?? ''}:${value.maskedEmails?.join('\n') || ''}:${value.docs?.join('|') || ''}:${value.names?.join('|') || ''}`;
              if (candidate !== signature) { candidate = signature; candidateSince = Date.now(); }
              if (Date.now() - candidateSince >= 500 &&
                  Date.now() - lastResultMutationAt >= 500) return value;
            } else { candidate = null; }
            await sleep(100);
          }
          return { kind: active() ? 'unavailable' : 'cancelled' };
        } finally { observer.disconnect(); }
      }
    });
    if (!stillCurrent()) return;
    const tabAfter = await chrome.tabs.get(tabId).catch(() => null);
    if (!stillCurrent()) return;
    const currentUrl = tabAfter?.url || '';
    if (!onCustomerPage(currentUrl)) {
      if (target.mode === 'doc' && !preserveCompleted) {
        proc.accounts = '-';
        proc.accountsSource = null;
        proc.maskedEmails = null;
        sendPopupUpdate(proc, { accounts: '-' });
        updateCacheFromProcess(proc);
      }
      return;
    }
    const result = results?.[0]?.result;
    if (target.mode === 'email') {
      if (proc.status === 'REQUESTER_LOOKUP') {
        resolvedRequester = applyRequesterCustomerLookup(proc, result, target.value);
        return;
      }
      if (result?.kind === 'found' || result?.kind === 'none') {
        bo2OrbitaEmailCompleted.set(proc.processId, target.value);
      }
      return;
    }
    if (preserveCompleted && result?.kind !== 'found' && result?.kind !== 'none') return;
    const hasCompleteEmails = result?.kind === 'found' && Number.isInteger(result.count) &&
      Array.isArray(result.maskedEmails) && result.maskedEmails.length === result.count;
    proc.accounts = hasCompleteEmails
      ? `${normalizeHubSpotAccountType(proc.accountType) || '-'} | ${result.count >= 5 ? '5+' : result.count}`
      : result?.kind === 'none' ? '> Nenhuma conta' : '-';
    proc.accountsSource = hasCompleteEmails || result?.kind === 'none'
      ? 'bo2_customer' : null;
    proc.maskedEmails = hasCompleteEmails ? result.maskedEmails.join('\n') : null;
    sendPopupUpdate(proc, { accounts: proc.accounts });
    updateCacheFromProcess(proc);
  } catch (_) {
    if (!stillCurrent()) return;
    if (target.mode === 'doc' && !preserveCompleted) {
      proc.accounts = '-';
      proc.accountsSource = null;
      proc.maskedEmails = null;
      sendPopupUpdate(proc, { accounts: '-' });
      updateCacheFromProcess(proc);
    }
  } finally {
    const lookupUnavailable = !resolvedRequester && proc.status === 'REQUESTER_LOOKUP' &&
      stillCurrent();
    if (bo2CustomerRuns.get(proc.processId) === runId) bo2CustomerRuns.delete(proc.processId);
    if (lookupUnavailable) sendPopupUpdate(proc, { doc: '-' });
    if (resolvedRequester && processes.get(proc.tabId)?.processId === proc.processId &&
        isCurrentTicketOwnerProcess(proc)) {
      startBO2CustomerCountIfReady(proc);
      startBO2NutrorSearchIfReady(proc);
      startBO1FaturasSearchIfReady(proc);
      startBO1ContratosSearchIfReady(proc);
    }
  }
}

const bo2NutrorRuns = new Map();
const bo2NutrorAutoStarted = new Map();
const bo2NutrorResults = new Map();
let bo2NutrorManualRequest = 0;

function invalidateBO2NutrorRun() {
  bo2NutrorManualRequest++;
  const tabId = backOffice2TabIds[1];
  if (Number.isInteger(tabId) && bo2NutrorRuns.has(tabId)) {
    const token = bo2NutrorRuns.get(tabId);
    chrome.scripting.executeScript({ target: { tabId }, args: [token],
      func: (expected) => {
        if (globalThis.__ticketHelperNutrorSearchToken === expected) {
          globalThis.__ticketHelperNutrorSearchToken = null;
        }
      }
    }).catch(() => {});
  }
  bo2NutrorRuns.clear();
  bo2NutrorAutoStarted.clear();
  bo2NutrorResults.clear();
}

function startBO2NutrorSearchIfReady(proc) {
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tabId = backOffice2TabIds[1];
  if (proc?.status !== 'SIDEBAR_RESOLVED' || !target ||
      !Number.isInteger(tabId) || !isExtensionEnabled() ||
      !isCurrentTicketOwnerProcess(proc) || processes.get(proc.tabId)?.processId !== proc.processId) return;
  const key = `${target.mode}:${target.value}`;
  if (bo2NutrorAutoStarted.get(proc.processId)?.key === key) return;
  const entry = { key };
  bo2NutrorAutoStarted.set(proc.processId, entry);
  hasVisibleBO2NutrorResult(tabId, proc, target).then((ready) =>
    ready || bo2NutrorAutoStarted.get(proc.processId) !== entry
      ? ready : runBO2NutrorSearch(proc, target)
  ).then((submitted) => {
    if (!submitted && bo2NutrorAutoStarted.get(proc.processId) === entry) {
      bo2NutrorAutoStarted.delete(proc.processId);
    }
  }).catch(() => {
    if (bo2NutrorAutoStarted.get(proc.processId) === entry) {
      bo2NutrorAutoStarted.delete(proc.processId);
    }
  });
}

async function runBO2NutrorSearch(proc, target = resolveHubSpotBO2SearchTarget(proc)) {
  const tabId = backOffice2TabIds[1];
  if (!target || !Number.isInteger(tabId)) return false;
  const token = uid();
  const ownerEpoch = currentTicketEpoch;
  bo2NutrorRuns.set(tabId, token);
  bo2NutrorResults.delete(proc.processId);
  if (String(sessionCache[proc.tabId]?.id || '') === String(proc.ticketId) &&
      sessionCache[proc.tabId]?.nutrorResult) {
    delete sessionCache[proc.tabId].nutrorResult;
    syncSessionCache();
  }
  const stillCurrent = () => isExtensionEnabled() &&
    bo2NutrorRuns.get(tabId) === token && currentTicketEpoch === ownerEpoch &&
    backOffice2TabIds[1] === tabId && isCurrentTicketOwnerProcess(proc) &&
    processes.get(proc.tabId)?.processId === proc.processId &&
    resolveHubSpotBO2SearchTarget(proc)?.value === target.value;
  const onNutrorPage = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === 'https://bo2.eduzz.com' &&
        parsed.pathname.replace(/\/$/, '') === '/nutror/clientes';
    } catch { return false; }
  };
  try {
    if (!stillCurrent()) return false;
    await chrome.scripting.executeScript({ target: { tabId }, args: [token],
      func: (nextToken) => { globalThis.__ticketHelperNutrorSearchToken = nextToken; }
    }).catch(() => {});
    if (!stillCurrent()) return false;
    let tab = await getExistingTab(tabId);
    if (!tab || !stillCurrent()) return false;
    if (!onNutrorPage(tab.url || tab.pendingUrl || '')) {
      tab = await chrome.tabs.update(tabId, { url: BO2_NUTROR_URL });
    }
    const pageDeadline = Date.now() + 30000;
    while (stillCurrent() && Date.now() < pageDeadline) {
      tab = await getExistingTab(tabId);
      if (onNutrorPage(tab?.url || '') && tab.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stillCurrent() || !onNutrorPage(tab?.url || '') || tab?.status !== 'complete') return false;
    const results = await chrome.scripting.executeScript({ target: { tabId },
      args: [target.value, target.mode, token],
      func: async (expectedValue, mode, runToken) => {
        globalThis.__ticketHelperNutrorSearchToken = runToken;
        const active = () => globalThis.__ticketHelperNutrorSearchToken === runToken &&
          location.origin === 'https://bo2.eduzz.com' &&
          location.pathname.replace(/\/$/, '') === '/nutror/clientes';
        let input = null;
        const deadline = Date.now() + 30000;
        while (active() && Date.now() < deadline) {
          input = document.querySelector('#client-list-search');
          if (input && !input.disabled) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!active() || !input || input.disabled) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, expectedValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!active() || input.value !== expectedValue) return false;
        const enter = (type) => new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        });
        input.dispatchEvent(enter('keydown'));
        input.dispatchEvent(enter('keypress'));
        input.dispatchEvent(enter('keyup'));
        if (!active() || input.value !== expectedValue) return null;
        const normalize = value => mode === 'doc'
          ? String(value || '').replace(/\D/g, '')
          : String(value || '').trim().toLowerCase();
        const resultDeadline = Date.now() + 45000;
        let candidate = null;
        let candidateSince = 0;
        while (active() && Date.now() < resultDeadline) {
          const query = [...document.querySelectorAll('span.ant-typography-secondary')]
            .find(node => node.textContent?.trim().startsWith('Resultado para:'));
          const shownValue = query?.querySelector('strong')?.textContent;
          const table = document.querySelector('.ant-table-wrapper');
          const rows = [...(table?.querySelectorAll('tbody.ant-table-tbody tr.ant-table-row') || [])];
          const loading = !!table?.querySelector('.ant-spin-spinning, [aria-busy="true"], .ant-skeleton');
          const keys = rows.map(row => row.getAttribute('data-row-key'));
          const matches = rows.length && keys.every(Boolean) && rows.every(row => {
            const cells = row.querySelectorAll('td.ant-table-cell');
            const value = mode === 'doc' ? cells[3]?.textContent :
              cells[0]?.querySelector('span.ant-typography-secondary')?.textContent;
            return normalize(value) === expectedValue;
          });
          if (!loading && normalize(input.value) === expectedValue &&
              normalize(shownValue) === expectedValue && matches) {
            const signature = keys.join('\n');
            if (signature !== candidate) { candidate = signature; candidateSince = Date.now(); }
            if (Date.now() - candidateSince >= 500) return { keys };
          } else {
            if (!loading && normalize(shownValue) === expectedValue && !rows.length &&
                table?.querySelector('.ant-empty')) {
              if (candidate !== 'empty') { candidate = 'empty'; candidateSince = Date.now(); }
              if (Date.now() - candidateSince >= 500) return { keys: [] };
            } else {
              candidate = null;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
      }
    });
    if (!stillCurrent()) return false;
    const finalTab = await getExistingTab(tabId);
    const result = results?.[0]?.result;
    if (!stillCurrent() || !onNutrorPage(finalTab?.url || '') ||
        !Array.isArray(result?.keys)) return false;
    if (result.keys.length) bo2NutrorResults.set(proc.processId, {
      key: `${target.mode}:${target.value}`, keys: result.keys
    });
    if (result.keys.length && String(sessionCache[proc.tabId]?.id || '') === String(proc.ticketId)) {
      sessionCache[proc.tabId].nutrorResult = {
        key: `${target.mode}:${target.value}`, keys: result.keys
      };
      syncSessionCache();
    }
    return true;
  } catch {
    return false;
  } finally {
    if (bo2NutrorRuns.get(tabId) === token) bo2NutrorRuns.delete(tabId);
  }
}

async function resumeBO2NutrorSearchAfterTabAssignment() {
  const ownerTabId = lastTicketTabId;
  const ownerEpoch = currentTicketEpoch;
  if (!isExtensionEnabled() || !Number.isInteger(ownerTabId) ||
      !Number.isInteger(backOffice2TabIds[1])) return;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '');
  if (!ticketId) return;
  const ownerTab = await getExistingTab(ownerTabId);
  if (ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' })
      .catch(() => null);
    if (ownerEpoch !== currentTicketEpoch || !live?.isTicketPage ||
        String(live.data?.id || '') !== ticketId || !live.currentProcessId) return;
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: cached.name, email: cached.email, doc: cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: isRequesterLookupPending(cached.doc, cached.accountType)
        ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED',
      docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (proc.status === 'SIDEBAR_RESOLVED') startBO2NutrorSearchIfReady(proc);
}

async function hasVisibleBO2NutrorResult(tabId, proc, target) {
  const cached = sessionCache[proc.tabId];
  const saved = bo2NutrorResults.get(proc.processId) ||
    (String(cached?.id || '') === String(proc.ticketId) ? cached?.nutrorResult : null);
  if (!saved?.keys?.length || saved.key !== `${target.mode}:${target.value}`) return false;
  const tab = await getExistingTab(tabId);
  try {
    const url = new URL(tab?.url || '');
    if (url.origin !== 'https://bo2.eduzz.com' ||
        url.pathname.replace(/\/$/, '') !== '/nutror/clientes') return false;
  } catch { return false; }
  const results = await chrome.scripting.executeScript({ target: { tabId },
    args: [target.value, target.mode],
    func: (expectedValue, mode) => {
      const normalize = value => mode === 'doc'
        ? String(value || '').replace(/\D/g, '')
        : String(value || '').trim().toLowerCase();
      const input = document.querySelector('#client-list-search');
      const query = [...document.querySelectorAll('span.ant-typography-secondary')]
        .find(node => node.textContent?.trim().startsWith('Resultado para:'));
      const table = document.querySelector('.ant-table-wrapper');
      if (!input || normalize(input.value) !== expectedValue ||
          normalize(query?.querySelector('strong')?.textContent) !== expectedValue ||
          !table || table.querySelector('.ant-spin-spinning, [aria-busy="true"], .ant-skeleton')) return null;
      const rows = [...table.querySelectorAll('tbody.ant-table-tbody tr.ant-table-row')];
      if (!rows.length) return null;
      const keys = rows.map(row => row.getAttribute('data-row-key'));
      if (!keys.every(Boolean) || !rows.every(row => {
        const cells = row.querySelectorAll('td.ant-table-cell');
        const value = mode === 'doc' ? cells[3]?.textContent :
          cells[0]?.querySelector('span.ant-typography-secondary')?.textContent;
        return normalize(value) === expectedValue;
      })) return null;
      return keys;
    }
  }).catch(() => null);
  const keys = results?.[0]?.result;
  return Array.isArray(keys) && keys.length === saved.keys.length &&
    keys.every((key, index) => key === saved.keys[index]);
}

async function runManualBO2NutrorSearch() {
  const request = ++bo2NutrorManualRequest;
  if (!await ensureSessionStateReady() || !isExtensionEnabled()) return false;
  const ownerTabId = lastTicketTabId;
  const tabId = backOffice2TabIds[1];
  const ownerEpoch = currentTicketEpoch;
  if (!Number.isInteger(ownerTabId) || !Number.isInteger(tabId)) return false;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (request !== bo2NutrorManualRequest || !ticketId || ownerEpoch !== currentTicketEpoch ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return false;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' })
      .catch(() => null);
    if (request !== bo2NutrorManualRequest || ownerEpoch !== currentTicketEpoch || !live?.isTicketPage ||
        String(live.data?.id || '') !== ticketId || !live.currentProcessId) return false;
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: cached.name, email: cached.email, doc: cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: 'SIDEBAR_RESOLVED', docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (isRequesterLookupPending(proc.doc, proc.accountType) ||
      proc.status === 'REQUESTER_LOOKUP') return false;
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tab = await getExistingTab(tabId);
  if (request !== bo2NutrorManualRequest || !target || !tab || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId || backOffice2TabIds[1] !== tabId) return false;
  await chrome.tabs.update(tabId, { active: true });
  if (request !== bo2NutrorManualRequest) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  if (request !== bo2NutrorManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId) return false;
  if (await hasVisibleBO2NutrorResult(tabId, proc, target)) {
    return request === bo2NutrorManualRequest && ownerEpoch === currentTicketEpoch;
  }
  if (request !== bo2NutrorManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId || backOffice2TabIds[1] !== tabId ||
      resolveHubSpotBO2SearchTarget(proc)?.value !== target.value) return false;
  const entry = { key: `${target.mode}:${target.value}` };
  bo2NutrorAutoStarted.set(proc.processId, entry);
  const submitted = await runBO2NutrorSearch(proc, target);
  if (!submitted && bo2NutrorAutoStarted.get(proc.processId) === entry) {
    bo2NutrorAutoStarted.delete(proc.processId);
  }
  return submitted;
}

const bo1FaturasRuns = new Map();
const bo1FaturasAutoStarted = new Map();
let bo1FaturasManualRequest = 0;

function invalidateBO1FaturasRun() {
  bo1FaturasManualRequest++;
  const tabId = boTab1Id;
  const token = bo1FaturasRuns.get(tabId);
  if (Number.isInteger(tabId) && token) {
    chrome.scripting.executeScript({ target: { tabId }, args: [token],
      func: expected => {
        if (globalThis.__ticketHelperFaturasSearchToken === expected) {
          globalThis.__ticketHelperFaturasSearchToken = null;
        }
      }
    }).catch(() => {});
  }
  bo1FaturasRuns.clear();
  bo1FaturasAutoStarted.clear();
}

function startBO1FaturasSearchIfReady(proc) {
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tabId = boTab1Id;
  if (proc?.status !== 'SIDEBAR_RESOLVED' || !target ||
      !Number.isInteger(tabId) || !isExtensionEnabled() ||
      !isCurrentTicketOwnerProcess(proc) || processes.get(proc.tabId)?.processId !== proc.processId) return;
  const key = `${target.mode}:${target.value}`;
  if (bo1FaturasAutoStarted.get(proc.processId)?.key === key) return;
  const entry = { key };
  bo1FaturasAutoStarted.set(proc.processId, entry);
  hasVisibleBO1FaturasResult(tabId, target).then(ready =>
    ready || bo1FaturasAutoStarted.get(proc.processId) !== entry
      ? ready : runBO1FaturasSearch(proc, target)
  ).then(done => {
    if (!done && bo1FaturasAutoStarted.get(proc.processId) === entry) {
      bo1FaturasAutoStarted.delete(proc.processId);
    }
  }).catch(() => {
    if (bo1FaturasAutoStarted.get(proc.processId) === entry) {
      bo1FaturasAutoStarted.delete(proc.processId);
    }
  });
}

function bo1FaturasResultProofScript(expectedValue, mode) {
  if (location.origin !== 'https://bo.eduzz.com' ||
      location.pathname.replace(/\/$/, '') !== '/dashboard/home' ||
      !document.querySelector('#MyEduzz.checked')) return false;
  const category = document.querySelector('#menuSearch')?.textContent?.trim().toLowerCase() || '';
  if (!category.includes('fatura') || category.includes('antiga')) return false;
  const normalize = value => mode === 'doc'
    ? String(value || '').replace(/\D/g, '')
    : String(value || '').trim().toLowerCase();
  if (normalize(document.querySelector('#searchField')?.value) !== expectedValue) return false;
  const popup = [...document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')]
    .find(node => node.textContent?.includes('Status da fatura:') &&
      node.querySelector('.MuiTableContainer-root tbody') &&
      getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
  if (!popup ||
      popup.querySelector('[aria-busy="true"], .MuiCircularProgress-root')) return false;
  const rows = [...popup.querySelectorAll('.MuiTableContainer-root tbody tr.houston-table-row-has-action')];
  if (!rows.length) return false;
  return rows.every(row => {
    const buyer = row.querySelector('td');
    if (!buyer) return false;
    if (mode === 'email') {
      const match = buyer.textContent?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return normalize(match?.[0]) === expectedValue;
    }
    const match = buyer.textContent?.match(/CPF\/CNPJ\s*:\s*([0-9.\-/]+)/i);
    return normalize(match?.[1]) === expectedValue;
  });
}

async function hasVisibleBO1FaturasResult(tabId, target) {
  const tab = await getExistingTab(tabId);
  try {
    const url = new URL(tab?.url || '');
    if (url.origin !== 'https://bo.eduzz.com' ||
        url.pathname.replace(/\/$/, '') !== '/dashboard/home') return false;
  } catch { return false; }
  const result = await chrome.scripting.executeScript({ target: { tabId },
    args: [target.value, target.mode], func: bo1FaturasResultProofScript
  }).catch(() => null);
  return result?.[0]?.result === true;
}

async function bo1FaturasSearchScript(expectedValue, mode, token) {
  globalThis.__ticketHelperFaturasSearchToken = token;
  const active = () => globalThis.__ticketHelperFaturasSearchToken === token &&
    location.origin === 'https://bo.eduzz.com' &&
    location.pathname.replace(/\/$/, '') === '/dashboard/home';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const readyUntil = Date.now() + 30000;
  while (active() && Date.now() < readyUntil &&
      (!document.querySelector('#MyEduzz') || !document.querySelector('#searchField') ||
        !document.querySelector('#menuSearch'))) {
    await sleep(100);
  }
  if (!active()) return false;
  const findPopup = () => [...document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')]
    .find(node => node.textContent?.includes('Status da fatura:') &&
      node.querySelector('.MuiTableContainer-root tbody') &&
      getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
  const oldPopup = findPopup();
  if (oldPopup) {
    const backdrop = oldPopup.closest('[role="presentation"]')?.querySelector('[aria-hidden="true"]');
    backdrop?.click();
    await sleep(100);
    if (findPopup()) {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
      });
      oldPopup.dispatchEvent(escape);
      document.dispatchEvent(escape);
    }
    const deadline = Date.now() + 3000;
    while (active() && Date.now() < deadline && findPopup()) await sleep(100);
    if (!active() || findPopup()) return false;
  }
  const orbita = document.querySelector('#MyEduzz');
  if (!orbita) return false;
  if (!orbita.classList.contains('checked')) {
    (orbita.querySelector('a') || orbita).click();
    const deadline = Date.now() + 5000;
    while (active() && Date.now() < deadline &&
        !document.querySelector('#MyEduzz.checked')) await sleep(100);
    if (!active() || !document.querySelector('#MyEduzz.checked')) return false;
  }
  let category = document.querySelector('#menuSearch');
  if (!category) return false;
  const selected = () => {
    const text = document.querySelector('#menuSearch')?.textContent?.trim().toLowerCase() || '';
    return text.includes('fatura') && !text.includes('antiga');
  };
  if (!selected()) {
    category.click();
    const deadline = Date.now() + 5000;
    let option = null;
    while (active() && Date.now() < deadline) {
      option = document.querySelector('#menuFaturas');
      if (option) break;
      await sleep(100);
    }
    if (!active() || !option) return false;
    option.click();
    const selectedUntil = Date.now() + 5000;
    while (active() && Date.now() < selectedUntil && !selected()) await sleep(100);
    if (!active() || !selected()) return false;
  }
  let input = null;
  let submit = null;
  const submitDeadline = Date.now() + 5000;
  while (active() && Date.now() < submitDeadline) {
    input = document.querySelector('#searchField');
    submit = input?.closest('form')?.querySelector('button[type="submit"]');
    if (input && submit && !submit.disabled) break;
    await sleep(100);
  }
  if (!active() || !input || !submit || submit.disabled) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, expectedValue);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(0);
  if (!active() || input.value !== expectedValue) return false;
  submit.click();
  const deadline = Date.now() + 45000;
  let candidate = null;
  let candidateSince = 0;
  const normalize = value => mode === 'doc'
    ? String(value || '').replace(/\D/g, '')
    : String(value || '').trim().toLowerCase();
  const rowsMatch = rows => rows.length > 0 && rows.every(row => {
    const buyer = row.querySelector('td');
    if (!buyer) return false;
    if (mode === 'email') {
      const match = buyer.textContent?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return normalize(match?.[0]) === expectedValue;
    }
    const match = buyer.textContent?.match(/CPF\/CNPJ\s*:\s*([0-9.\-/]+)/i);
    return normalize(match?.[1]) === expectedValue;
  });
  while (active() && Date.now() < deadline) {
    const popup = findPopup();
    const busy = !!popup?.querySelector('[aria-busy="true"], .MuiCircularProgress-root');
    const rows = [...(popup?.querySelectorAll('.MuiTableContainer-root tbody tr.houston-table-row-has-action') || [])];
    const proof = !!document.querySelector('#MyEduzz.checked') && selected() &&
      normalize(input.value) === expectedValue && rowsMatch(rows);
    if (popup && !busy && (proof || !rows.length)) {
      const signature = proof ? rows.map(row => row.querySelector('td')?.textContent || '').join('\n') : 'empty';
      if (signature !== candidate) { candidate = signature; candidateSince = Date.now(); }
      if (Date.now() - candidateSince >= (proof ? 500 : 1500)) {
        return proof ? 'found' : 'empty';
      }
    } else if (popup && !busy && rows.length) {
      const signature = `mismatch:${rows.map(row => row.querySelector('td')?.textContent || '').join('\n')}`;
      if (signature !== candidate) { candidate = signature; candidateSince = Date.now(); }
      if (Date.now() - candidateSince >= 1500) return 'mismatch';
    } else {
      candidate = null;
    }
    await sleep(100);
  }
  return false;
}

async function runBO1FaturasSearch(proc, target = resolveHubSpotBO2SearchTarget(proc)) {
  const tabId = boTab1Id;
  if (!target || !Number.isInteger(tabId)) return false;
  const token = uid();
  const ownerEpoch = currentTicketEpoch;
  bo1FaturasRuns.set(tabId, token);
  const stillCurrent = () => isExtensionEnabled() && bo1FaturasRuns.get(tabId) === token &&
    currentTicketEpoch === ownerEpoch && boTab1Id === tabId &&
    isCurrentTicketOwnerProcess(proc) && processes.get(proc.tabId)?.processId === proc.processId &&
    resolveHubSpotBO2SearchTarget(proc)?.mode === target.mode &&
    resolveHubSpotBO2SearchTarget(proc)?.value === target.value;
  try {
    if (!stillCurrent()) return false;
    await chrome.scripting.executeScript({ target: { tabId }, args: [token],
      func: value => { globalThis.__ticketHelperFaturasSearchToken = value; }
    }).catch(() => {});
    if (!stillCurrent()) return false;
    let tab = await getExistingTab(tabId);
    if (!tab) return false;
    const onPage = url => {
      try { const parsed = new URL(url); return parsed.origin === 'https://bo.eduzz.com' &&
        parsed.pathname.replace(/\/$/, '') === '/dashboard/home'; } catch { return false; }
    };
    if (!onPage(tab.url || tab.pendingUrl || '')) {
      tab = await chrome.tabs.update(tabId, { url: BO1_FATURAS_URL });
    }
    const pageDeadline = Date.now() + 30000;
    while (stillCurrent() && Date.now() < pageDeadline) {
      tab = await getExistingTab(tabId);
      if (onPage(tab?.url || '') && tab.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stillCurrent() || !onPage(tab?.url || '') || tab?.status !== 'complete') return false;
    for (let attempt = 0; attempt < 2 && stillCurrent(); attempt++) {
      const result = await chrome.scripting.executeScript({ target: { tabId },
        args: [target.value, target.mode, token], func: bo1FaturasSearchScript
      });
      if (!stillCurrent()) return false;
      const status = result?.[0]?.result;
      if (status === 'found' || status === 'empty') return true;
      if (status !== 'mismatch') return false;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (bo1FaturasRuns.get(tabId) === token) bo1FaturasRuns.delete(tabId);
  }
}

async function resumeBO1FaturasSearchAfterTabAssignment(sourceTab = null, ticketContext = null) {
  const ownerTabId = lastTicketTabId;
  const ownerEpoch = currentTicketEpoch;
  const assignedTabId = boTab1Id;
  if (!isExtensionEnabled() || !Number.isInteger(ownerTabId) || !Number.isInteger(assignedTabId)) return;
  const cached = sessionCache[ownerTabId] || {};
  const captured = sourceTab?.id === ownerTabId && !!ticketContext?.ticketId &&
    !!ticketContext?.processId && !!resolveHubSpotBO2SearchTarget({
      status: 'SIDEBAR_RESOLVED', doc: ticketContext.doc, email: ticketContext.email
    });
  const ticketId = String(captured ? ticketContext.ticketId : cached.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (!ticketId || ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
      boTab1Id !== assignedTabId ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId ||
      (captured && proc.processId !== ticketContext.processId)) {
    const live = captured ? { currentProcessId: ticketContext.processId } :
      await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' }).catch(() => null);
    if (ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
        boTab1Id !== assignedTabId || !live?.currentProcessId ||
        (!captured && (!live.isTicketPage ||
          String(live.currentTicketId || '') !== ticketId ||
          String(live.data?.id || '') !== ticketId))) return;
    if (proc) proc.status = 'ABORTED';
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: captured ? ticketContext.name : cached.name,
      email: captured ? ticketContext.email : cached.email,
      doc: captured ? ticketContext.doc : cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: isRequesterLookupPending(captured ? ticketContext.doc : cached.doc,
        cached.accountType) ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED',
      docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (captured && proc.processId === ticketContext.processId &&
      proc.status !== 'SIDEBAR_RESOLVED') {
    proc.email = ticketContext.email;
    proc.doc = ticketContext.doc;
    proc.status = 'SIDEBAR_RESOLVED';
  }
  if (proc.status === 'SIDEBAR_RESOLVED') startBO1FaturasSearchIfReady(proc);
}

async function focusBO1DashboardPage(tabId) {
  const tab = await getExistingTab(tabId);
  if (!tab?.active || (!tab.url?.startsWith(BO1_FATURAS_URL) &&
      !tab.url?.startsWith(BO1_CONTRATOS_URL))) return;
  const win = await getExistingWindow(tab.windowId);
  if (!win?.focused) return;
  await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const body = document.body;
    if (!body) return;
    const hadTabIndex = body.hasAttribute('tabindex');
    const previousTabIndex = body.getAttribute('tabindex');
    if (!hadTabIndex) body.setAttribute('tabindex', '-1');
    body.focus({ preventScroll: true });
    if (!hadTabIndex) body.removeAttribute('tabindex');
    else body.setAttribute('tabindex', previousTabIndex);
  } }).catch(() => {});
}

async function runManualBO1FaturasSearch() {
  const request = ++bo1FaturasManualRequest;
  if (!await ensureSessionStateReady() || !isExtensionEnabled()) return false;
  const ownerTabId = lastTicketTabId;
  const tabId = boTab1Id;
  const ownerEpoch = currentTicketEpoch;
  if (!Number.isInteger(ownerTabId) || !Number.isInteger(tabId)) return false;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (request !== bo1FaturasManualRequest || !ticketId || ownerEpoch !== currentTicketEpoch ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return false;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' }).catch(() => null);
    if (request !== bo1FaturasManualRequest || ownerEpoch !== currentTicketEpoch ||
        !live?.isTicketPage || String(live.data?.id || '') !== ticketId || !live.currentProcessId) return false;
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: cached.name, email: cached.email, doc: cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: 'SIDEBAR_RESOLVED', docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (isRequesterLookupPending(proc.doc, proc.accountType) ||
      proc.status === 'REQUESTER_LOOKUP') return false;
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tab = await getExistingTab(tabId);
  if (!target || !tab || request !== bo1FaturasManualRequest ||
      ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId || boTab1Id !== tabId) return false;
  await chrome.tabs.update(tabId, { active: true });
  if (request !== bo1FaturasManualRequest) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  if (request !== bo1FaturasManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId) return false;
  await focusBO1DashboardPage(tabId);
  if (await hasVisibleBO1FaturasResult(tabId, target)) {
    return request === bo1FaturasManualRequest && ownerEpoch === currentTicketEpoch;
  }
  if (request !== bo1FaturasManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId || boTab1Id !== tabId ||
      resolveHubSpotBO2SearchTarget(proc)?.value !== target.value) return false;
  const entry = { key: `${target.mode}:${target.value}` };
  bo1FaturasAutoStarted.set(proc.processId, entry);
  const done = await runBO1FaturasSearch(proc, target);
  if (request === bo1FaturasManualRequest && ownerEpoch === currentTicketEpoch &&
      lastTicketTabId === ownerTabId) await focusBO1DashboardPage(tabId);
  if (!done && bo1FaturasAutoStarted.get(proc.processId) === entry) {
    bo1FaturasAutoStarted.delete(proc.processId);
  }
  return done;
}

const bo1ContratosRuns = new Map();
const bo1ContratosAutoStarted = new Map();
let bo1ContratosManualRequest = 0;

function invalidateBO1ContratosRun() {
  bo1ContratosManualRequest++;
  const tabId = boTab2Id;
  const token = bo1ContratosRuns.get(tabId);
  if (Number.isInteger(tabId) && token) {
    chrome.scripting.executeScript({ target: { tabId }, args: [token],
      func: expected => {
        if (globalThis.__ticketHelperContratosSearchToken === expected) {
          globalThis.__ticketHelperContratosSearchToken = null;
        }
      }
    }).catch(() => {});
  }
  bo1ContratosRuns.clear();
  bo1ContratosAutoStarted.clear();
  const cached = sessionCache[lastTicketTabId];
  if (cached?.contratosResult) {
    delete cached.contratosResult;
    syncSessionCache();
  }
}

function bo1ContratosVisibleAnchorScript(expectedValue, mode, contractId) {
  if (location.origin !== 'https://bo.eduzz.com' ||
      location.pathname.replace(/\/$/, '') !== '/dashboard/contratos-next' ||
      !document.querySelector('#Next.checked') ||
      !/^contratos$/i.test(document.querySelector('#contentContainer h3')?.textContent?.trim() || '')) return false;
  const category = document.querySelector('.main_search button[aria-haspopup="true"]');
  if (!/^clientes?$/i.test(category?.textContent?.trim() || '')) return false;
  const input = document.querySelector('#searchField');
  const normalize = value => mode === 'doc'
    ? String(value || '').replace(/\D/g, '')
    : String(value || '').trim().toLowerCase();
  if (normalize(input?.value) !== expectedValue) return false;
  return [...document.querySelectorAll('#contentContainer .customer-list tbody tr.trLabel')]
    .some(row => row.querySelector('td:nth-child(2) > div')?.textContent?.trim() === contractId);
}

async function hasVisibleBO1ContratosResult(tabId, proc, target) {
  const cached = sessionCache[proc.tabId];
  const saved = String(cached?.id || '') === String(proc.ticketId)
    ? cached?.contratosResult : null;
  if (!saved?.id || saved.key !== `${target.mode}:${target.value}`) return false;
  const tab = await getExistingTab(tabId);
  if (!isBO1ContratosResultPage(tab?.url)) return false;
  const result = await chrome.scripting.executeScript({ target: { tabId },
    args: [target.value, target.mode, saved.id], func: bo1ContratosVisibleAnchorScript
  }).catch(() => null);
  return result?.[0]?.result === true;
}

function isBO1ContratosWorkPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://bo.eduzz.com' &&
      ['/dashboard/home', '/dashboard/contratos-next']
        .includes(parsed.pathname.replace(/\/$/, ''));
  } catch { return false; }
}

function isBO1ContratosResultPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://bo.eduzz.com' &&
      parsed.pathname.replace(/\/$/, '') === '/dashboard/contratos-next';
  } catch { return false; }
}

function startBO1ContratosSearchIfReady(proc) {
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tabId = boTab2Id;
  if (proc?.status !== 'SIDEBAR_RESOLVED' || !target ||
      !Number.isInteger(tabId) || !isExtensionEnabled() ||
      !isCurrentTicketOwnerProcess(proc) || processes.get(proc.tabId)?.processId !== proc.processId) return;
  const key = `${target.mode}:${target.value}`;
  if (bo1ContratosAutoStarted.get(proc.processId)?.key === key) return;
  const entry = { key };
  bo1ContratosAutoStarted.set(proc.processId, entry);
  hasVisibleBO1ContratosResult(tabId, proc, target).then(ready =>
    ready || bo1ContratosAutoStarted.get(proc.processId) !== entry
      ? ready : runBO1ContratosSearch(proc, target)
  ).then(done => {
    if (!done && bo1ContratosAutoStarted.get(proc.processId) === entry) {
      bo1ContratosAutoStarted.delete(proc.processId);
    }
  }).catch(() => {
    if (bo1ContratosAutoStarted.get(proc.processId) === entry) {
      bo1ContratosAutoStarted.delete(proc.processId);
    }
  });
}

async function bo1ContratosSearchScript(expectedValue, mode, token, acceptVisibleResult = false) {
  globalThis.__ticketHelperContratosSearchToken = token;
  const active = () => globalThis.__ticketHelperContratosSearchToken === token &&
    location.origin === 'https://bo.eduzz.com' &&
    ['/dashboard/home', '/dashboard/contratos-next']
      .includes(location.pathname.replace(/\/$/, ''));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (read, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (active() && Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };
  const next = await until(() => document.querySelector('#Next'), 30000);
  if (!next || !active()) return false;
  if (!next.classList.contains('checked')) {
    (next.querySelector('a') || next).click();
    if (!await until(() => document.querySelector('#Next.checked'), 8000)) return false;
  }
  const category = await until(() =>
    document.querySelector('.main_search button[aria-haspopup="true"]'), 20000);
  if (!category || !active()) return false;
  const clientesSelected = () => /^clientes?$/i.test(
    document.querySelector('.main_search button[aria-haspopup="true"]')?.textContent?.trim() || '');
  if (!clientesSelected()) {
    category.click();
    const option = await until(() => document.querySelector('#menuClientes') ||
      [...document.querySelectorAll('[role="menuitem"]')]
        .find(node => /^clientes?$/i.test(node.textContent?.trim() || '')), 5000);
    if (!option || !active()) return false;
    option.click();
    if (!await until(clientesSelected, 5000)) return false;
  }
  const input = await until(() => document.querySelector('#searchField'), 5000);
  const submit = input?.closest('form')?.querySelector('button[type="submit"]');
  const root = await until(() => document.querySelector('#contentContainer'), 5000);
  if (!input || !submit || submit.disabled || !root || !active()) return false;
  const normalize = value => mode === 'doc'
    ? String(value || '').replace(/\D/g, '')
    : String(value || '').trim().toLowerCase();
  const ids = () => [...document.querySelectorAll('#contentContainer .customer-list tbody tr.trLabel')]
    .map(row => row.querySelector('td:nth-child(2) > div')?.textContent?.trim() || '')
    .filter(value => /^\d+$/.test(value));
  if (acceptVisibleResult &&
      location.pathname.replace(/\/$/, '') === '/dashboard/contratos-next' &&
      /^contratos$/i.test(root.querySelector('h3')?.textContent?.trim() || '') &&
      clientesSelected() && normalize(input.value) === expectedValue) {
    const previousPage = root.querySelector('button[aria-label="Previous page"]');
    const firstId = ids()[0];
    if (firstId && (!previousPage || previousPage.disabled) &&
        !root.querySelector('[aria-busy="true"], .MuiCircularProgress-root')) {
      await sleep(500);
      if (active() && ids()[0] === firstId && normalize(input.value) === expectedValue &&
          (!previousPage || previousPage.disabled) &&
          !root.querySelector('[aria-busy="true"], .MuiCircularProgress-root')) {
        return { id: firstId };
      }
    }
  }
  const before = ids().join(',');
  const beforeInput = normalize(input.value);
  let lastMutationAt = Date.now();
  let sawResultMutation = false;
  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
    sawResultMutation = true;
  });
  observer.observe(root.parentElement || root,
    { childList: true, characterData: true, subtree: true });
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, expectedValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(0);
    if (!active() || normalize(input.value) !== expectedValue) return false;
    submit.click();
    const deadline = Date.now() + 45000;
    let candidate = null;
    let candidateSince = 0;
    while (active() && Date.now() < deadline) {
      const currentIds = ids();
      const heading = document.querySelector('#contentContainer h3')?.textContent?.trim() || '';
      const ready = /^contratos$/i.test(heading) &&
        document.querySelector('#Next.checked') && clientesSelected() &&
        normalize(input.value) === expectedValue &&
        !document.querySelector('#contentContainer [aria-busy="true"], #contentContainer .MuiCircularProgress-root');
      const changed = currentIds.join(',') !== before;
      const sameVisibleTarget = beforeInput === expectedValue && !!before;
      if (ready && !currentIds.length && sawResultMutation &&
          /nenhum resultado|nenhum contrato|n[aã]o h[aá] resultados|sem resultados/i
            .test(document.querySelector('#contentContainer')?.textContent || '') &&
          Date.now() - lastMutationAt >= 700) {
        return { id: null };
      }
      if (ready && currentIds.length && (changed || sameVisibleTarget) &&
          Date.now() - lastMutationAt >= 500) {
        const signature = currentIds.join(',');
        if (signature !== candidate) { candidate = signature; candidateSince = Date.now(); }
        if (Date.now() - candidateSince >= 500) {
          return { id: currentIds[0] };
        }
      } else { candidate = null; }
      await sleep(100);
    }
    return false;
  } finally { observer.disconnect(); }
}

async function bo1ContratosAwaitResultScript(expectedValue, mode, token) {
  globalThis.__ticketHelperContratosSearchToken = token;
  const normalize = value => mode === 'doc'
    ? String(value || '').replace(/\D/g, '')
    : String(value || '').trim().toLowerCase();
  const deadline = Date.now() + 45000;
  let candidate = null;
  let candidateSince = 0;
  while (globalThis.__ticketHelperContratosSearchToken === token &&
      location.origin === 'https://bo.eduzz.com' &&
      location.pathname.replace(/\/$/, '') === '/dashboard/contratos-next' &&
      Date.now() < deadline) {
    const root = document.querySelector('#contentContainer');
    const category = document.querySelector('.main_search button[aria-haspopup="true"]');
    const input = document.querySelector('#searchField');
    const ready = root && /^contratos$/i.test(root.querySelector('h3')?.textContent?.trim() || '') &&
      document.querySelector('#Next.checked') &&
      /^clientes?$/i.test(category?.textContent?.trim() || '') &&
      normalize(input?.value) === expectedValue &&
      !root.querySelector('[aria-busy="true"], .MuiCircularProgress-root');
    let nextCandidate = null;
    if (ready) {
      const previousPage = root.querySelector('button[aria-label="Previous page"]');
      const firstId = root.querySelector(
        '.customer-list tbody tr.trLabel td:nth-child(2) > div'
      )?.textContent?.trim() || '';
      if (/^\d+$/.test(firstId) && (!previousPage || previousPage.disabled)) {
        nextCandidate = `id:${firstId}`;
      } else if (/nenhum resultado|nenhum contrato|n[aã]o h[aá] resultados|sem resultados/i
        .test(root.textContent || '')) {
        nextCandidate = 'empty';
      }
    }
    if (nextCandidate !== candidate) {
      candidate = nextCandidate;
      candidateSince = Date.now();
    } else if (candidate && Date.now() - candidateSince >= 700) {
      return candidate === 'empty' ? { id: null } : { id: candidate.slice(3) };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function runBO1ContratosSearch(proc, target = resolveHubSpotBO2SearchTarget(proc)) {
  const tabId = boTab2Id;
  if (!target || !Number.isInteger(tabId)) return false;
  const token = uid();
  const ownerEpoch = currentTicketEpoch;
  bo1ContratosRuns.set(tabId, token);
  const stillCurrent = () => isExtensionEnabled() && bo1ContratosRuns.get(tabId) === token &&
    currentTicketEpoch === ownerEpoch && boTab2Id === tabId &&
    isCurrentTicketOwnerProcess(proc) && processes.get(proc.tabId)?.processId === proc.processId &&
    resolveHubSpotBO2SearchTarget(proc)?.mode === target.mode &&
    resolveHubSpotBO2SearchTarget(proc)?.value === target.value;
  try {
    if (!stillCurrent()) return false;
    let tab = await getExistingTab(tabId);
    if (!tab) return false;
    if (!isBO1ContratosWorkPage(tab.url || tab.pendingUrl)) {
      tab = await chrome.tabs.update(tabId, { url: BO1_CONTRATOS_URL });
    }
    const deadline = Date.now() + 30000;
    while (stillCurrent() && Date.now() < deadline) {
      tab = await getExistingTab(tabId);
      if (isBO1ContratosWorkPage(tab?.url) && tab.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stillCurrent() || tab?.status !== 'complete') return false;
    const saved = String(sessionCache[proc.tabId]?.id || '') === String(proc.ticketId)
      ? sessionCache[proc.tabId]?.contratosResult : null;
    const hasCurrentAnchor = !!saved?.id && saved.key === `${target.mode}:${target.value}`;
    for (let attempt = 0; attempt < 2 && stillCurrent(); attempt++) {
      let result = null;
      try {
        result = await chrome.scripting.executeScript({ target: { tabId },
          args: attempt === 0
            ? [target.value, target.mode, token, !hasCurrentAnchor]
            : [target.value, target.mode, token],
          func: attempt === 0 ? bo1ContratosSearchScript : bo1ContratosAwaitResultScript
        });
      } catch {}
      if (!stillCurrent()) return false;
      const answer = result?.[0]?.result;
      if (answer && typeof answer === 'object') {
        const cached = sessionCache[proc.tabId];
        if (String(cached?.id || '') === String(proc.ticketId)) {
          cached.contratosResult = answer.id
            ? { key: `${target.mode}:${target.value}`, id: answer.id } : null;
          syncSessionCache();
        }
        return true;
      }
      if (attempt === 0) {
        const retryDeadline = Date.now() + 10000;
        while (stillCurrent() && Date.now() < retryDeadline) {
          tab = await getExistingTab(tabId);
          if (isBO1ContratosResultPage(tab?.url) && tab.status === 'complete') break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (bo1ContratosRuns.get(tabId) === token) bo1ContratosRuns.delete(tabId);
  }
}

async function resumeBO1ContratosSearchAfterTabAssignment(sourceTab = null, ticketContext = null) {
  const ownerTabId = lastTicketTabId;
  const ownerEpoch = currentTicketEpoch;
  const assignedTabId = boTab2Id;
  if (!isExtensionEnabled() || !Number.isInteger(ownerTabId) || !Number.isInteger(assignedTabId)) return;
  const cached = sessionCache[ownerTabId] || {};
  const captured = sourceTab?.id === ownerTabId && !!ticketContext?.ticketId &&
    !!ticketContext?.processId && !!resolveHubSpotBO2SearchTarget({
      status: 'SIDEBAR_RESOLVED', doc: ticketContext.doc, email: ticketContext.email
    });
  const ticketId = String(captured ? ticketContext.ticketId : cached.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (!ticketId || ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
      boTab2Id !== assignedTabId ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId ||
      (captured && proc.processId !== ticketContext.processId)) {
    const live = captured ? { currentProcessId: ticketContext.processId } :
      await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' }).catch(() => null);
    if (ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
        boTab2Id !== assignedTabId || !live?.currentProcessId ||
        (!captured && (!live.isTicketPage ||
          String(live.currentTicketId || '') !== ticketId ||
          String(live.data?.id || '') !== ticketId))) return;
    if (proc) proc.status = 'ABORTED';
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: captured ? ticketContext.name : cached.name,
      email: captured ? ticketContext.email : cached.email,
      doc: captured ? ticketContext.doc : cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: isRequesterLookupPending(captured ? ticketContext.doc : cached.doc,
        cached.accountType) ? 'REQUESTER_LOOKUP' : 'SIDEBAR_RESOLVED',
      docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (captured && proc.processId === ticketContext.processId &&
      proc.status !== 'SIDEBAR_RESOLVED') {
    proc.email = ticketContext.email;
    proc.doc = ticketContext.doc;
    proc.status = 'SIDEBAR_RESOLVED';
  }
  if (proc.status === 'SIDEBAR_RESOLVED') startBO1ContratosSearchIfReady(proc);
}

async function runManualBO1ContratosSearch() {
  const request = ++bo1ContratosManualRequest;
  if (!await ensureSessionStateReady() || !isExtensionEnabled()) return false;
  const ownerTabId = lastTicketTabId;
  const tabId = boTab2Id;
  const ownerEpoch = currentTicketEpoch;
  if (!Number.isInteger(ownerTabId) || !Number.isInteger(tabId)) return false;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (request !== bo1ContratosManualRequest || !ticketId || ownerEpoch !== currentTicketEpoch ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return false;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' }).catch(() => null);
    if (request !== bo1ContratosManualRequest || ownerEpoch !== currentTicketEpoch ||
        !live?.isTicketPage || String(live.data?.id || '') !== ticketId || !live.currentProcessId) return false;
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: cached.name, email: cached.email, doc: cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: 'SIDEBAR_RESOLVED', docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  if (isRequesterLookupPending(proc.doc, proc.accountType) ||
      proc.status === 'REQUESTER_LOOKUP') return false;
  const target = resolveHubSpotBO2SearchTarget(proc);
  const tab = await getExistingTab(tabId);
  if (!target || !tab || request !== bo1ContratosManualRequest ||
      ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId || boTab2Id !== tabId) return false;
  await chrome.tabs.update(tabId, { active: true });
  if (request !== bo1ContratosManualRequest) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  if (request !== bo1ContratosManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId) return false;
  await focusBO1DashboardPage(tabId);
  if (await hasVisibleBO1ContratosResult(tabId, proc, target)) {
    return request === bo1ContratosManualRequest && ownerEpoch === currentTicketEpoch;
  }
  if (request !== bo1ContratosManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId || boTab2Id !== tabId ||
      resolveHubSpotBO2SearchTarget(proc)?.value !== target.value) return false;
  const entry = { key: `${target.mode}:${target.value}` };
  bo1ContratosAutoStarted.set(proc.processId, entry);
  const done = await runBO1ContratosSearch(proc, target);
  if (request === bo1ContratosManualRequest && ownerEpoch === currentTicketEpoch &&
      lastTicketTabId === ownerTabId) await focusBO1DashboardPage(tabId);
  if (!done && bo1ContratosAutoStarted.get(proc.processId) === entry) {
    bo1ContratosAutoStarted.delete(proc.processId);
  }
  return done;
}

async function hasVisibleBO2OrbitaDocResult(tabId, proc, target) {
  if (target?.mode !== 'doc' || proc?.accountsSource !== 'bo2_customer' ||
      !hasCompletedBO2CustomerCount(proc.accounts) || !proc.maskedEmails) return false;
  const expectedCount = String(proc.maskedEmails).split('\n').filter(Boolean).length;
  const countLabel = String(proc.accounts).match(/ \| ([1-4]|5\+)$/)?.[1];
  if (!expectedCount || countLabel !== (expectedCount >= 5 ? '5+' : String(expectedCount))) return false;
  const tab = await getExistingTab(tabId);
  try {
    const url = new URL(tab?.url || '');
    if (url.origin !== 'https://bo2.eduzz.com' ||
        url.pathname.replace(/\/$/, '') !== '/bo/customer') return false;
  } catch { return false; }
  const results = await chrome.scripting.executeScript({ target: { tabId },
    args: [target.value],
    func: (expectedDoc) => {
      const main = document.querySelector('main');
      const input = main?.querySelector('#customer-search-input');
      if (!input || input.value.replace(/\D/g, '') !== expectedDoc) return null;
      if (main.querySelector('.ant-spin-spinning, [aria-busy="true"], .ant-skeleton')) return null;
      const root = [...main.children].find(node =>
        node.classList.contains('bo:flex-col') && node.classList.contains('bo:gap-4'));
      const cards = [...(root?.querySelectorAll('.ant-card.ant-card-bordered') || [])];
      if (!cards.length) return null;
      const maskedEmails = [];
      for (const card of cards) {
        const labels = [...card.querySelectorAll('.ant-card-body span')];
        const label = labels.find(node => node.textContent?.trim() === 'CPF/CNPJ:');
        const doc = label?.nextElementSibling?.textContent?.replace(/\D/g, '') || '';
        if (doc !== expectedDoc) return null;
        const emailLabel = labels.find(node => node.textContent?.trim() === 'E-mail:');
        const email = String(emailLabel?.nextElementSibling?.textContent || '').trim();
        const match = email.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
        if (!match) return null;
        maskedEmails.push(`${match[1].slice(0, 2)}****${match[1].slice(5)}@${match[2]}`);
      }
      return maskedEmails;
    }
  }).catch(() => null);
  const visibleEmails = results?.[0]?.result;
  return Array.isArray(visibleEmails) && visibleEmails.length === expectedCount &&
    visibleEmails.join('\n') === proc.maskedEmails;
}

async function hasVisibleBO2FinalRequesterResult(tabId, email, finalDoc) {
  const tab = await getExistingTab(tabId);
  try {
    const url = new URL(tab?.url || '');
    if (url.origin !== 'https://bo2.eduzz.com' ||
        url.pathname.replace(/\/$/, '') !== '/bo/customer') return false;
  } catch { return false; }
  const results = await chrome.scripting.executeScript({ target: { tabId },
    args: [email, finalDoc],
    func: (expectedEmail, expectedDoc) => {
      const main = document.querySelector('main');
      const input = main?.querySelector('#customer-search-input');
      if (input?.value.trim().toLowerCase() !== expectedEmail ||
          main.querySelector('.ant-spin-spinning, [aria-busy="true"], .ant-skeleton')) return false;
      const root = [...main.children].find(node =>
        node.classList.contains('bo:flex-col') && node.classList.contains('bo:gap-4'));
      const cards = [...(root?.querySelectorAll('.ant-card.ant-card-bordered') || [])];
      if (expectedDoc === '> Email sem conta') {
        return !cards.length && main.querySelector('.ant-empty-description')?.textContent?.trim() ===
          'Nenhum cliente encontrado';
      }
      return cards.length > 1 && cards.every(card => {
        const labels = [...card.querySelectorAll('.ant-card-body span')];
        const emailLabel = labels.find(node => node.textContent?.trim() === 'E-mail:');
        return emailLabel?.nextElementSibling?.textContent?.trim().toLowerCase() === expectedEmail;
      });
    }
  }).catch(() => null);
  return results?.[0]?.result === true;
}

async function runManualBO2OrbitaSearch() {
  const request = ++bo2OrbitaManualRequest;
  if (!await ensureSessionStateReady() || !isExtensionEnabled()) return false;
  const ownerTabId = lastTicketTabId;
  const tabId = backOffice2TabIds[0];
  const ownerEpoch = currentTicketEpoch;
  if (!Number.isInteger(ownerTabId) || !Number.isInteger(tabId)) return false;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '');
  const ownerTab = await getExistingTab(ownerTabId);
  if (request !== bo2OrbitaManualRequest || !ticketId || ownerEpoch !== currentTicketEpoch ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) return false;
  let proc = processes.get(ownerTabId);
  if (!proc || String(proc.ticketId) !== ticketId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' })
      .catch(() => null);
    if (request !== bo2OrbitaManualRequest || ownerEpoch !== currentTicketEpoch ||
        !live?.isTicketPage || String(live.data?.id || '') !== ticketId ||
        !live.currentProcessId) return false;
    proc = {
      processId: live.currentProcessId, ticketId, tabId: ownerTabId,
      name: cached.name, email: cached.email, doc: cached.doc,
      accounts: cached.accounts, accountsSource: cached.accountsSource,
      accountType: cached.accountType, maskedEmails: cached.maskedEmails,
      status: 'SIDEBAR_RESOLVED', docSearchRetryCount: 0, retryCount: 0
    };
    processes.set(ownerTabId, proc);
  }
  const finalRequester = isFinalRequesterLookupDoc(proc.doc);
  const searchProc = finalRequester
    ? { ...proc, status: 'SIDEBAR_RESOLVED', doc: '> Conta sem doc' } : proc;
  const target = resolveHubSpotBO2SearchTarget(searchProc);
  const tab = await getExistingTab(tabId);
  if (request !== bo2OrbitaManualRequest || !target || !tab ||
      ownerEpoch !== currentTicketEpoch || lastTicketTabId !== ownerTabId ||
      backOffice2TabIds[0] !== tabId) return false;
  await chrome.tabs.update(tabId, { active: true });
  if (request !== bo2OrbitaManualRequest) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  if (request !== bo2OrbitaManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId) return false;
  if (finalRequester) {
    if (await hasVisibleBO2FinalRequesterResult(tabId, target.value, proc.doc)) return true;
    if (request !== bo2OrbitaManualRequest || ownerEpoch !== currentTicketEpoch ||
        lastTicketTabId !== ownerTabId || backOffice2TabIds[0] !== tabId ||
        !isFinalRequesterLookupDoc(processes.get(ownerTabId)?.doc)) return false;
    await runBO2CustomerCount(searchProc);
    return request === bo2OrbitaManualRequest && ownerEpoch === currentTicketEpoch;
  }
  const preserveCompleted = target.mode === 'doc' &&
    proc.accountsSource === 'bo2_customer' && hasCompletedBO2CustomerCount(proc.accounts) &&
    !!proc.maskedEmails;
  if (preserveCompleted && await hasVisibleBO2OrbitaDocResult(tabId, proc, target)) {
    return request === bo2OrbitaManualRequest && ownerEpoch === currentTicketEpoch;
  }
  if (request !== bo2OrbitaManualRequest || ownerEpoch !== currentTicketEpoch ||
      lastTicketTabId !== ownerTabId || backOffice2TabIds[0] !== tabId ||
      resolveHubSpotBO2SearchTarget(proc)?.value !== target.value) return false;
  invalidateBO2CustomerRun();
  bo2CustomerRuns.delete(proc.processId);
  bo2OrbitaEmailCompleted.delete(proc.processId);
  if (!preserveCompleted) {
    proc.accounts = target.mode === 'doc' ? '...' : '-';
    proc.accountsSource = target.mode === 'doc' ? null : 'hubspot_sidebar';
    proc.maskedEmails = null;
    sendPopupUpdate(proc, { accounts: proc.accounts });
    updateCacheFromProcess(proc);
  }
  await runBO2CustomerCount(proc, { preserveCompleted });
  return request === bo2OrbitaManualRequest && ownerEpoch === currentTicketEpoch;
}

function isProcessStillValid(proc) {
  if (proc.status === 'ABORTED' || proc.status === 'NO_EMAIL' ||
      ['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP', 'SIDEBAR_HALTED'].includes(proc.status)) return false;
  const current = processes.get(proc.tabId);
  return current && current.processId === proc.processId;
}

function getCurrentTicketOwnerTabId() {
  return Number.isInteger(lastTicketTabId) ? lastTicketTabId : null;
}

function isCurrentTicketOwnerProcess(proc) {
  if (!proc) return false;
  const ownerTabId = getCurrentTicketOwnerTabId();
  if (!Number.isInteger(ownerTabId)) return false;
  if (Number.isInteger(pendingTicketFocusTabId) && pendingTicketFocusTabId !== proc.tabId) return false;
  return proc.tabId === ownerTabId;
}

function canRunBOSearchForProcess(proc) {
  return !BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER && isExtensionEnabled() &&
    requiredBOTabsReady && isProcessStillValid(proc) && isCurrentTicketOwnerProcess(proc);
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

function normalizeCachedHubSpotDoc(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text === '...') return value;
  if (/^[-–—−]{2,}$/.test(text)) return '> Conta sem doc';
  if (text.startsWith('>')) return value;
  return hasValidDocLength(text) ? text : '> Doc. Estrang./Inválido';
}

function isConcreteProcessField(value) {
  const text = String(value ?? '').trim();
  return !!text && text !== '...' && text !== '-';
}

function hydrateProcessFromSnapshot(proc, snapshot) {
  if (!proc || !snapshot) return false;
  let dirty = false;

  const applyField = (fieldName) => {
    const nextValue = fieldName === 'doc'
      ? normalizeCachedHubSpotDoc(snapshot[fieldName])
      : snapshot[fieldName];
    if (fieldName === 'doc' && isFinalRequesterLookupDoc(proc.doc) &&
        nextValue !== proc.doc) return;
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
  applyField('accountType');
  applyField('maskedEmails');

  const docValue = normalizeSearchableField(proc.doc);
  if (
    !proc.accountType && proc.accountsSource !== 'hubspot_sidebar' &&
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
  if (!opts.requiredTabsReady) {
    checkRequiredBOTabsReady().then((ready) => {
      if (ready && isProcessStillValid(proc)) {
        syncDefinedBOTabsForProcess(proc, { ...opts, requiredTabsReady: true });
      }
    });
    return;
  }
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
    boActionTabIds.orbita || '',
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
  if (!proc || processes.get(proc.tabId)?.processId !== proc.processId ||
      !isCurrentTicketOwnerProcess(proc)) return;
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
  queueTicketSessionStateWrite();
}

function normalizeActionProcessSnapshotField(messageValue, cachedValue, normalizer) {
  const msgValue = normalizer(messageValue);
  if (msgValue) return messageValue;
  const cachedFieldValue = normalizer(cachedValue);
  if (cachedFieldValue) return cachedValue;
  return null;
}

function buildActionProcessSnapshot(msg, cached = {}, ticketId = null) {
  const normalizeAccounts = (value) => {
    const text = String(value ?? '').trim();
    if (!text || text === '-' || text === '...') return '';
    return text;
  };

  return {
    id: ticketId || cached?.id || msg?.ticketId || null,
    name: normalizeActionProcessSnapshotField(msg?.name, cached?.name, normalizeSearchableField),
    email: normalizeActionProcessSnapshotField(msg?.email, cached?.email, normalizeEmailForFaturasSearch),
    doc: normalizeActionProcessSnapshotField(msg?.doc, cached?.doc, normalizeDocForFaturasSearch),
    accounts: normalizeActionProcessSnapshotField(msg?.accounts, cached?.accounts, normalizeAccounts),
    accountsSource: cached?.accountsSource ?? null
  };
}

// MV3 service workers can restart while a ticket popup stays alive; manual action clicks carry enough
// current-item data to rebuild the in-memory process instead of making the user refocus the ticket tab.
function recoverProcessForActionMessage(tabId, msg, sender = {}) {
  if (!Number.isInteger(tabId) || tabId !== lastTicketTabId) return null;

  const existing = processes.get(tabId);
  const cached = sessionCache[tabId] || {};
  const urlTicketId = extractTicketIdFromTabUrl(sender.tab?.url || '');
  if (urlTicketId && msg?.ticketId && String(urlTicketId) !== String(msg.ticketId)) return null;
  if (cached.id && msg?.ticketId && String(cached.id) !== String(msg.ticketId)) return null;
  const ticketId = String(msg?.ticketId || cached?.id || extractTicketIdFromTabUrl(sender.tab?.url || '') || '').trim();
  if (!ticketId) return existing && existing.status !== 'ABORTED' ? existing : null;

  const snapshot = buildActionProcessSnapshot(msg, cached, ticketId);
  if (existing && existing.status !== 'ABORTED' && String(existing.ticketId) === ticketId) {
    hydrateProcessFromSnapshot(existing, snapshot);
    activeProcessId = existing.processId;
    persistLastTicketTabId(tabId);
    setActiveHistoryCandidate(existing, sender.tab?.url || '');
    return existing;
  }

  const processId = String(msg?.processId || '').trim() || uid();
  const proc = {
    processId,
    ticketId,
    tabId,
    name: snapshot.name ?? null,
    email: snapshot.email ?? null,
    doc: snapshot.doc ?? null,
    accounts: snapshot.accounts ?? null,
    accountsSource: snapshot.accountsSource ?? null,
    status: 'COMPLETED',
    docSearchRetryCount: 0,
    retryCount: 0
  };

  processes.set(tabId, proc);
  activeProcessId = proc.processId;
  if (String(sessionCache[tabId]?.id || '') !== ticketId) {
    sessionCache[tabId] = { id: ticketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
  }
  setActiveHistoryCandidate(proc, sender.tab?.url || '');
  updateCacheFromProcess(proc);
  return proc;
}

function extractHubSpotTicketIdFromUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    if (u.hostname !== 'app.hubspot.com') return null;
    const direct = (u.pathname.match(/^\/help-desk\/[^/]+\/view(?:\/[^?#]*)?\/ticket\/(\d+)(?:\/|$)/) || [])[1];
    if (direct) return direct;
    const eschref = u.searchParams.get('eschref');
    if (!eschref) return null;
    const decoded = decodeURIComponent(eschref);
    return (decoded.match(/^\/help-desk\/[^/]+\/view(?:\/[^?#]*)?\/ticket\/(\d+)(?:\/|$)/) || [])[1] || null;
  } catch {
    return null;
  }
}

function extractTicketIdFromTabUrl(urlStr) {
  if (!urlStr) return null;

  try {
    const u = new URL(urlStr);

    if (u.hostname === 'app.hubspot.com') {
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
    if (u.hostname === 'app.hubspot.com') {
      if (/^\/help-desk\/[^/]+\/view(?:\/|$)/.test(u.pathname) &&
          (/\/ticket\/\d+(?:\/|$)/.test(u.pathname) || /\/thread\/[^/]+(?:\/|$)/.test(u.pathname))) return true;
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
  const navigationEpoch = ticketNavigationEpochs.get(tabId) || 0;
  const focusEpoch = focusEventEpoch;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || navigationEpoch !== (ticketNavigationEpochs.get(tabId) || 0)) return;
    const urlTicketId = extractTicketIdFromTabUrl(tab?.url || '');
    const cachedTicketId = sessionCache[tabId]?.id || null;
    const likelyTicketContext = isLikelyTicketContextUrl(tab?.url || '');
    const proc = processes.get(tabId);
    const hasLiveProcess = !!(proc && proc.status !== 'ABORTED');
    const isFocused = tabId === focusedTabId && focusEpoch === focusEventEpoch;

    if (!isFocused) {
      if (tabId === lastTicketTabId) {
        const ownerId = cachedTicketId || proc?.ticketId || null;
        if ((!urlTicketId && !likelyTicketContext) ||
            (urlTicketId && ownerId && String(urlTicketId) !== String(ownerId))) {
          clearCurrentTicketForTab(tabId);
        }
      }
      return;
    }

    if (urlTicketId) {
      const existingTicketId = hasLiveProcess ? proc.ticketId : cachedTicketId;
      claimTicketOwner(tabId, urlTicketId);
      if (existingTicketId && String(existingTicketId) !== String(urlTicketId)) {
        const replacement = createProcess(tabId, urlTicketId, true, tab.url || '');
        sendToTab(tabId, { action: 'RESTART_TICKET_PROCESS', expectedTicketId: urlTicketId });
        activeProcessId = replacement.processId;
      }
      if (!sessionCache[tabId]) {
        sessionCache[tabId] = { id: urlTicketId, name: null, email: null, doc: null, accounts: null };
        syncSessionCache();
      } else if (!sessionCache[tabId].id) {
        sessionCache[tabId].id = urlTicketId;
        syncSessionCache();
      }
    }
    chrome.tabs.sendMessage(tabId, { action: 'GET_CURRENT_DATA' }, (resp) => {
      const err = chrome.runtime.lastError;
      if (tabId !== focusedTabId || focusEpoch !== focusEventEpoch ||
          navigationEpoch !== (ticketNavigationEpochs.get(tabId) || 0)) return;
      if (!err && resp?.ownerEpoch !== currentTicketEpoch && urlTicketId) {
        notifyTicketOwnerChanged(null, tabId);
      }
      const hasLiveTicket = !err && resp?.isTicketPage && !!resp?.data?.id &&
        resp.ownerEpoch === currentTicketEpoch;
      if (!err && resp?.isTicketPage === false && pendingTicketFocusTabId === tabId) {
        pendingTicketFocusTabId = null;
      }

      if (hasLiveTicket) {
        if (urlTicketId && String(resp.data.id) !== String(urlTicketId)) return;
        claimTicketOwner(tabId, resp.data.id);
        const priorCache = sessionCache[tabId] || {};
        sessionCache[tabId] = {
          id: resp.data.id ?? priorCache.id ?? null,
          name: resp.data.name ?? priorCache.name ?? null,
          email: resp.data.email ?? priorCache.email ?? null,
          doc: priorCache.id === resp.data.id
            ? preserveFinalRequesterLookupDoc(resp.data.doc ?? priorCache.doc ?? null, priorCache.doc)
            : resp.data.doc ?? null,
          accounts: resp.data.accounts ?? priorCache.accounts ?? null,
          accountsSource: priorCache.accountsSource ?? processes.get(tabId)?.accountsSource ?? null,
          maskedEmails: priorCache.maskedEmails ?? processes.get(tabId)?.maskedEmails ?? null,
          nutrorResult: priorCache.nutrorResult ?? null,
          contratosResult: priorCache.contratosResult ?? null,
          accountType: priorCache.accountType ?? processes.get(tabId)?.accountType ??
            (String(resp.data.accountType || '').trim() === '--'
              ? 'Cliente Final' : resp.data.accountType ?? null)
        };
        syncSessionCache();
        if (isFinalRequesterLookupDoc(sessionCache[tabId].doc) &&
            !isFinalRequesterLookupDoc(resp.data.doc) && resp.currentProcessId) {
          sendToTab(tabId, { action: 'UPDATE_POPUP', processId: resp.currentProcessId,
            fields: { doc: sessionCache[tabId].doc, accounts: '-' } });
        }

        let liveProc = processes.get(tabId);
        let recovered = false;
        if ((!liveProc || liveProc.status === 'ABORTED') && tabId === lastTicketTabId) {
          liveProc = createProcess(tabId, resp.data.id, false, tab.url || '');
          hydrateProcessFromSnapshot(liveProc, { ...priorCache, ...resp.data,
            doc: sessionCache[tabId].doc,
            accountType: priorCache.accountType ??
              (String(resp.data.accountType || '').trim() === '--'
                ? 'Cliente Final' : resp.data.accountType ?? null),
            id: resp.data.id });
          recovered = true;
        }
        if (liveProc && liveProc.status !== 'ABORTED' && liveProc.ticketId === String(resp.data.id)) {
          hydrateProcessFromSnapshot(liveProc, { ...resp.data, doc: sessionCache[tabId].doc });
          activeProcessId = liveProc.processId;
          const contextChanged = recovered || activeBOContextTicketId !== liveProc.ticketId;
          if (contextChanged) {
            setActiveHistoryCandidate(liveProc, tab.url || '');
            syncDefinedBOTabsForProcess(liveProc, { forceActions: true, contextChanged: true, force: true });
          }
        }
        return;
      }

      const fallbackProc = processes.get(tabId);
      if (tabId === lastTicketTabId && likelyTicketContext && fallbackProc && fallbackProc.status !== 'ABORTED') {
        hydrateProcessFromSnapshot(fallbackProc, sessionCache[tabId] || null);
        activeProcessId = fallbackProc.processId;
        const contextChanged = activeBOContextTicketId !== fallbackProc.ticketId;
        if (contextChanged) {
          syncDefinedBOTabsForProcess(fallbackProc, { forceActions: true, contextChanged: true });
        }
        return;
      }

      if (urlTicketId && tabId === lastTicketTabId) return;
      if (tabId === lastTicketTabId) clearCurrentTicketForTab(tabId);
    });
  });
}

function requestTicketContext(tabId, callback) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.sendMessage(tabId, { action: 'GET_TICKET_CONTEXT' }, (response) => {
      const messageError = chrome.runtime.lastError;
      callback?.({
        tab: { ...tab, url: !messageError && response?.url ? response.url : tab.url },
        isTicketPage: !messageError && response?.isTicketPage === true,
        ticketId: !messageError ? response?.ticketId || null : null
      });
    });
  });
}

function completeResumeValidation(tabId, expectedTicketId = null) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, {
    action: 'RESUME_VALIDATION_COMPLETE',
    expectedTicketId: expectedTicketId || null
  }, () => {
    void chrome.runtime.lastError;
  });
}

chrome.action.onClicked.addListener(() => {
  toggleWorkEnabled();
});

chrome.storage.local.get('enabled', ({ enabled }) => {
  if (typeof enabled !== 'boolean') {
    chrome.storage.local.set({ enabled: false });
    return;
  }
  extensionEnabled = !!enabled;
  if (!extensionEnabled) {
    shutdownAllExtensionWork();
    return;
  }
  sessionStateReadyPromise.then(() => {
    if (!isExtensionEnabled()) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!isExtensionEnabled() || !Number.isInteger(tabId)) return;
      noteFocusedTab(tabs?.[0]);
      refreshFocusedTicketOwnership(tabId);
    });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  extensionEnabled = !!changes.enabled.newValue;
  if (!extensionEnabled) {
    pausedSnapshotCapturePromise = capturePausedTicketSnapshot();
    shutdownAllExtensionWork();
    return;
  }
  checkAndResumeCurrentTicketSearches();
  setTimeout(() => {
    pausedSnapshotCapturePromise.then(resumeCurrentTicketOwnerAfterEnable);
  }, 220);
});

function toggleWorkEnabled(callback) {
  chrome.storage.local.get('enabled', (data) => {
    const nextEnabled = data?.enabled === false;
    chrome.storage.local.set({ enabled: nextEnabled }, () => callback?.(nextEnabled));
  });
}

function resumeCurrentTicketOwnerAfterEnable() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (!isExtensionEnabled()) return;
    const activeTab = tabs?.[0];
    const activeTabId = activeTab?.id;
    if (!Number.isInteger(activeTabId)) {
      discardPausedTicketSnapshot();
      return;
    }

    focusedTabId = activeTabId;
    requestTicketContext(activeTabId, (context) => {
      if (!isExtensionEnabled() || focusedTabId !== activeTabId) return;
      const activeUrl = context?.tab?.url || activeTab.url || '';
      const activeIsTicketPage = context?.isTicketPage || !!extractTicketIdFromTabUrl(activeUrl) || isLikelyTicketContextUrl(activeUrl);
      if (!activeIsTicketPage) {
        discardPausedTicketSnapshot();
        completeResumeValidation(activeTabId);
        return;
      }

      resumeTicketContext(activeTabId, context, pausedTicketSnapshot);
    });
  });
}

function discardPausedTicketSnapshot() {
  const snapshot = pausedTicketSnapshot;
  if (snapshot && Number.isInteger(snapshot.tabId)) clearCurrentTicketForTab(snapshot.tabId);
  if (Number.isInteger(lastTicketTabId) && lastTicketTabId !== snapshot?.tabId) clearCurrentTicketForTab(lastTicketTabId);
  persistLastTicketTabId(null);
  persistPausedTicketSnapshot(null);
}

function resumeTicketContext(ownerTabId, context, snapshot = null) {
  if (!isExtensionEnabled() || !Number.isInteger(ownerTabId)) return;
  const url = context?.tab?.url || '';
  const urlTicketId = extractTicketIdFromTabUrl(url);
  const currentTicketId = String(context?.ticketId || urlTicketId || '').trim() || null;
  const snapshotKind = getHistoryKindFromUrl(snapshot?.url || '');
  const currentKind = getHistoryKindFromUrl(url);
  const sameTicket = !!snapshot && !!currentTicketId &&
    String(snapshot.ticketId) === currentTicketId &&
    !!snapshotKind && snapshotKind === currentKind;

  if (snapshot && Number.isInteger(snapshot.tabId) && !sameTicket) clearCurrentTicketForTab(snapshot.tabId);
  if (Number.isInteger(lastTicketTabId) && lastTicketTabId !== ownerTabId && lastTicketTabId !== snapshot?.tabId) {
    clearCurrentTicketForTab(lastTicketTabId);
  }

  if (sameTicket && snapshot?.tabId !== ownerTabId && sessionCache[snapshot.tabId]) {
    sessionCache[ownerTabId] = { ...sessionCache[snapshot.tabId] };
    delete sessionCache[snapshot.tabId];
    syncSessionCache();
  } else if (!sameTicket) {
    delete sessionCache[ownerTabId];
    syncSessionCache();
  }

  const ticketIdToResume = currentTicketId || (sameTicket ? snapshot?.ticketId : null);
  if (ticketIdToResume) claimTicketOwner(ownerTabId, ticketIdToResume);
  if (currentTicketId && sameTicket && String(sessionCache[ownerTabId]?.id || '') !== currentTicketId) {
    sessionCache[ownerTabId] = { id: currentTicketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
    syncSessionCache();
  } else if (currentTicketId && !sameTicket) {
    sessionCache[ownerTabId] = { id: currentTicketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
    syncSessionCache();
  }

  persistPausedTicketSnapshot(null);
  completeResumeValidation(ownerTabId, ticketIdToResume);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  chrome.storage.local.get('enabled', (data) => {
    if (typeof data?.enabled !== 'boolean') chrome.storage.local.set({ enabled: false });
  });
  chrome.runtime.openOptionsPage();
  if (details.reason === 'update') clearRetiredProducerWarningsFromOpenBOTabs();
});

chrome.runtime.onStartup.addListener(() => {
  if (!isExtensionEnabled()) return;
  if (Number.isInteger(lastTicketTabId)) refreshFocusedTicketOwnership(lastTicketTabId);
});





function createProcess(tabId, ticketId, isFocused = true, sourceUrl = '') {
  if (isFocused) claimTicketOwner(tabId, ticketId);
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
    accountType: null,
    maskedEmails: null,
    status: 'STARTING',
    docSearchRetryCount: 0,
    retryCount: 0
  };

  processes.set(tabId, proc);

  
  
  if (isFocused) {
    activeProcessId = proc.processId;
    setActiveBOContext(proc);
    setActiveHistoryCandidate(proc, sourceUrl);
  }

  
  sessionCache[tabId] = { id: ticketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
  syncSessionCache();

  return proc;
}

function updateCacheFromProcess(proc) {
  if (!proc || processes.get(proc.tabId)?.processId !== proc.processId ||
      lastTicketTabId !== proc.tabId ||
      String(sessionCache[proc.tabId]?.id || '') !== String(proc.ticketId)) return;
  proc.doc = normalizeCachedHubSpotDoc(proc.doc);
  proc.doc = preserveFinalRequesterLookupDoc(proc.doc, sessionCache[proc.tabId]?.doc);
  if (isFinalRequesterLookupDoc(proc.doc)) {
    proc.status = 'SIDEBAR_HALTED';
    proc.accounts = '-';
    proc.accountsSource = null;
    proc.maskedEmails = null;
  }
  sessionCache[proc.tabId] = {
    id: proc.ticketId,
    name: proc.name,
    email: proc.email,
    doc: proc.doc,
    accounts: proc.accounts,
    accountsSource: proc.accountsSource ?? null,
    accountType: proc.accountType ?? null,
    maskedEmails: proc.maskedEmails ?? null,
    nutrorResult: sessionCache[proc.tabId]?.nutrorResult ?? null,
    contratosResult: sessionCache[proc.tabId]?.contratosResult ?? null
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

function clearCurrentTicketForTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  const wasOwner = lastTicketTabId === tabId;
  const proc = processes.get(tabId);
  if (proc) {
    finalizeActiveHistoryCandidateForProcess(proc);
    proc.status = 'ABORTED';
    processes.delete(tabId);
    if (activeProcessId === proc.processId) activeProcessId = null;
    if (pendingProc?.processId === proc.processId) pendingProc = null;
  } else if (sessionCache[tabId]?.id) {
    finalizeActiveHistoryCandidateForProcess(sessionCache[tabId].id);
  }

  delete sessionCache[tabId];
  syncSessionCache();
  if (wasOwner) {
    persistLastTicketTabId(null);
    activeProcessId = null;
    currentTicketEpoch++;
    retireTicketBoundWork();
    notifyTicketOwnerChanged(tabId, null);
  }

  if (proc && activeBOContextProcessId === proc.processId) {
    activeBOContextProcessId = null;
    activeBOContextTicketId = null;
    persistBOContextState();
  }
}





chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  const action = msg?.action;
  if (action === 'TOGGLE_WORK_ENABLED') {
    toggleWorkEnabled((enabled) => sendResponse({ enabled }));
    return true;
  }

  if (action === 'GET_TICKET_OWNER_STATE') {
    sessionStateReadyPromise.then(() => {
      if (!isExtensionEnabled()) {
        sendResponse({ ownerTabId: lastTicketTabId, ownerTicketId: null,
          ownerEpoch: currentTicketEpoch, focusedTabId: null, thisTabId: tabId });
        return;
      }
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const queryError = chrome.runtime.lastError;
        const activeTab = !queryError ? tabs?.[0] : null;
        const reply = () => sendResponse({
          ownerTabId: lastTicketTabId,
          ownerTicketId: sessionCache[lastTicketTabId]?.id || processes.get(lastTicketTabId)?.ticketId || null,
          ownerEpoch: currentTicketEpoch,
          focusedTabId,
          thisTabId: tabId
        });
        if (!Number.isInteger(activeTab?.windowId)) {
          reply();
          return;
        }
        chrome.windows.get(activeTab.windowId, (window) => {
          const windowError = chrome.runtime.lastError;
          if (windowError || !window?.focused) {
            reply();
            return;
          }
          chrome.tabs.get(activeTab.id, (liveTab) => {
            const tabError = chrome.runtime.lastError;
            if (!tabError && liveTab?.active && liveTab.windowId === activeTab.windowId) {
              noteFocusedTab(liveTab);
              const ticketId = extractTicketIdFromTabUrl(liveTab.url || '');
              if (ticketId) {
                claimTicketOwner(liveTab.id, ticketId);
                if (String(sessionCache[liveTab.id]?.id || '') !== String(ticketId)) {
                  sessionCache[liveTab.id] = { id: ticketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
                  syncSessionCache();
                }
              }
            }
            reply();
          });
        });
      });
    });
    return true;
  }

  if (!isExtensionEnabled() && action !== 'FORCE_DISABLE' && action !== 'OPEN_OPTIONS' && action !== 'GET_BO_TAB_STATE') {
    sendResponse?.({ ok: false, disabled: true, reason: 'EXTENSION_DISABLED' });
    return true;
  }

  
  if (msg.action === 'TICKET_DETECTED') {
    const { ticketId, forceNew } = msg;
    const runTicketDetection = () => {
    const focusEpoch = focusEventEpoch;
    const navigationEpoch = ticketNavigationEpochs.get(tabId) || 0;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const queryError = chrome.runtime.lastError;
      const focusedTab = tabs?.[0];
      let liveTab = null;
      let liveWindow = null;
      try {
        if (Number.isInteger(tabId)) {
          liveTab = await chrome.tabs.get(tabId);
          if (liveTab) liveWindow = await chrome.windows.get(liveTab.windowId);
        }
      } catch (_) {}
      const urlTicketId = extractTicketIdFromTabUrl(liveTab?.url || '');
      if (queryError || focusEpoch !== focusEventEpoch ||
          navigationEpoch !== (ticketNavigationEpochs.get(tabId) || 0) ||
          !Number.isInteger(tabId) || focusedTab?.id !== tabId ||
          !liveTab?.active || !liveWindow?.focused ||
          focusedTab?.windowId !== liveTab.windowId ||
          !ticketId || (!urlTicketId && !isLikelyTicketContextUrl(liveTab?.url || '')) ||
          (urlTicketId && String(urlTicketId) !== String(ticketId))) {
        sendResponse({ deferred: true, focused: false });
        return;
      }
      focusedTabId = tabId;
      claimTicketOwner(tabId, ticketId);
      const isFocused = true;

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
      if (['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP'].includes(existing.status)) {
        startBO2CustomerCountIfReady(existing);
        startBO2NutrorSearchIfReady(existing);
        startBO1FaturasSearchIfReady(existing);
        startBO1ContratosSearchIfReady(existing);
      }
      return true;
    }

    
    if (!forceNew && !existing) {
      const cached = sessionCache[tabId];
      if (cached && String(cached.id) === String(ticketId)) {
        const cachedDocValue = normalizeSearchableField(cached.doc);
        const cachedNeedsDocAccounts =
          !cached.accountType && cached.accountsSource !== 'hubspot_sidebar' &&
          !!cachedDocValue &&
          hasValidDocLength(cachedDocValue) &&
          cached.accountsSource !== 'doc';
        const cachedNeedsGathering = [cached.name, cached.email, cached.doc, cached.accounts]
          .some(isPendingProcessField);
        const phantom = {
          processId: uid(),
          ticketId,
          tabId,
          name:     cached.name,
          email:    cached.email,
          doc:      cached.doc,
          accounts: cachedNeedsDocAccounts ? null : (cached.accounts ?? null),
          accountsSource: cachedNeedsDocAccounts ? null : (cached.accountsSource ?? null),
          accountType: cached.accountType ?? null,
          maskedEmails: cached.maskedEmails ?? null,
          status: isFinalRequesterLookupDoc(cached.doc) ? 'SIDEBAR_HALTED' :
            cached.accountType && cached.doc === '...' ? 'REQUESTER_LOOKUP' :
            cached.accountType || cached.accountsSource === 'hubspot_sidebar' ||
              cached.accountsSource === 'bo2_customer' ? 'SIDEBAR_RESOLVED'
            : cached.email === '> Ticket sem email' ? 'NO_EMAIL'
            : cachedNeedsDocAccounts || cachedNeedsGathering ? 'STARTING' : 'COMPLETED',
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
        if (['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP'].includes(phantom.status)) {
          startBO2CustomerCountIfReady(phantom);
          startBO2NutrorSearchIfReady(phantom);
          startBO1FaturasSearchIfReady(phantom);
          startBO1ContratosSearchIfReady(phantom);
        }
        return true;
      }
    }

    
    
    const proc = createProcess(tabId, ticketId, isFocused, sender.tab?.url || '');
    sendResponse({ processId: proc.processId, reuse: false });
    });
    };
    if (sessionStateReady) runTicketDetection();
    else sessionStateReadyPromise.then(runTicketDetection);
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

  if (msg.action === 'LAUNCH_DEFINED_BO_TABS') {
    launchDefinedBOTabs(sender.tab, msg.screenBounds, msg.ticketContext)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, reason: 'LAUNCH_FAILED', state: getBOTabState() }));
    return true;
  }

  
  if (msg.action === 'FOCUS_BO_TAB') {
    setArmedBOTabSlot(1);
    return;
  }

  
  if (msg.action === 'HUBSPOT_ACCOUNT_RESOLVED') {
    const proc = processes.get(tabId);
    const urlTicketId = extractTicketIdFromTabUrl(sender.tab?.url || '');
    if (!proc || proc.processId !== msg.processId || !isCurrentTicketOwnerProcess(proc) ||
        String(urlTicketId || '') !== String(proc.ticketId)) {
      sendResponse({ ok: false, reason: 'STALE_TICKET' });
      return;
    }

    const count = Number(msg.count) || 0;
    const kind = ['single', 'requester', 'matched_lookup', 'no_email', 'multiple_requesters']
      .includes(msg.kind) ? msg.kind : 'unavailable';
    if (isFinalRequesterLookupDoc(proc.doc)) {
      sendResponse({ ok: true });
      return;
    }
    const receivedDoc = String(msg.doc ?? '').trim();
    const nextDoc = kind === 'single'
      ? (!receivedDoc || /^[-–—−]+$/.test(receivedDoc)
        ? '> Conta sem doc'
        : normalizeCachedHubSpotDoc(receivedDoc))
      : ['requester', 'matched_lookup'].includes(kind) ? '...' : '-';
    const rawType = String(msg.accountType ?? '').trim();
    const nextAccountType = ['single', 'matched_lookup'].includes(kind)
      ? (!rawType ? (proc.doc === nextDoc
        ? normalizeHubSpotAccountType(proc.accountType) || '-' : '-')
        : normalizeHubSpotAccountType(rawType)) :
      kind === 'requester' ? 'Verificar Contas' : null;
    if (kind === 'single' && proc.doc === nextDoc &&
        hasCompletedBO2CustomerCount(proc.accounts) &&
        (proc.accounts === '> Nenhuma conta' || !!proc.maskedEmails)) {
      proc.name = String(msg.name || '').trim() || '-';
      proc.email = String(msg.email || '').trim() || '-';
      proc.accountType = nextAccountType;
      const finishedCount = String(proc.accounts).match(/ \| ([1-4]|5\+)$/);
      if (finishedCount) proc.accounts = `${nextAccountType} | ${finishedCount[1]}`;
      proc.accountsSource = 'bo2_customer';
      proc.status = 'SIDEBAR_RESOLVED';
      sendPopupUpdate(proc, { name: proc.name, email: proc.email, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      sendResponse({ ok: true });
      startBO2NutrorSearchIfReady(proc);
      startBO1FaturasSearchIfReady(proc);
      startBO1ContratosSearchIfReady(proc);
      return;
    }
    proc.name = ['single', 'requester', 'matched_lookup'].includes(kind)
      ? (String(msg.name || '').trim() || '-') : '-';
    proc.email = ['single', 'requester', 'matched_lookup'].includes(kind)
      ? (String(msg.email || '').trim() || '-') :
      kind === 'multiple_requesters' ? '> Múltiplas Contas' : '> Ticket sem email';
    proc.doc = nextDoc;
    proc.accountType = nextAccountType;
    proc.maskedEmails = null;
    const shouldCountAccounts = kind === 'single' && hasValidDocLength(proc.doc) &&
      Number.isInteger(backOffice2TabIds[0]);
    proc.accounts = shouldCountAccounts ? '...' : '-';
    proc.accountsSource = shouldCountAccounts ? null : 'hubspot_sidebar';
    proc.status = ['requester', 'matched_lookup'].includes(kind) ? 'REQUESTER_LOOKUP' :
      kind === 'single' ? 'SIDEBAR_RESOLVED' : 'SIDEBAR_HALTED';
    sendPopupUpdate(proc, { name: proc.name, email: proc.email,
      doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    sendResponse({ ok: true });
    startBO2CustomerCountIfReady(proc);
    if (proc.status === 'SIDEBAR_RESOLVED') {
      startBO2NutrorSearchIfReady(proc);
      startBO1FaturasSearchIfReady(proc);
      startBO1ContratosSearchIfReady(proc);
    }
    return;
  }

  if (msg.action === 'DATA_EXTRACTED') {
    const { processId, email } = msg;

    
    
    
    const proc = processes.get(tabId);
    if (!proc || proc.processId !== processId ||
        ['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP', 'SIDEBAR_HALTED'].includes(proc.status) ||
        !isCurrentTicketOwnerProcess(proc)) return;

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
    if (!proc || proc.processId !== processId ||
        ['SIDEBAR_RESOLVED', 'REQUESTER_LOOKUP', 'SIDEBAR_HALTED'].includes(proc.status) ||
        !isCurrentTicketOwnerProcess(proc)) return;
    proc.email = '> Ticket sem email';
    proc.doc = '-';
    proc.accounts = '-';
    proc.accountsSource = null;
    proc.status = 'NO_EMAIL';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, email: proc.email, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    return;
  }

  
  if (msg.action === 'TICKET_EXITED') {
    const current = processes.get(tabId);
    const currentId = current?.ticketId || sessionCache[tabId]?.id || null;
    if (msg.ticketId && currentId && String(msg.ticketId) !== String(currentId)) return;
    if (msg.processId && msg.processId !== current?.processId) return;
    if (!msg.processId && currentId && tabId === lastTicketTabId &&
        String(extractTicketIdFromTabUrl(sender.tab?.url || '') || '') === String(currentId || '')) return;
    clearCurrentTicketForTab(tabId);
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

  if (msg.action === 'COPY_BO2_MASKED_EMAILS') {
    copyMaskedBO2EmailsOrAssignTabs(msg.ticketId, msg.processId, sender.tab?.id)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'ACTION_FAILED' }));
    return true;
  }

  if (
    msg.action === 'RUN_ORBITA_SEARCH' ||
    msg.action === 'RUN_FATURAS_SEARCH' ||
    msg.action === 'RUN_NUTROR_SEARCH' ||
    msg.action === 'RUN_CONTRATOS_SEARCH'
  ) {
    const actionKey =
      msg.action === 'RUN_ORBITA_SEARCH' ? 'orbita' :
      msg.action === 'RUN_FATURAS_SEARCH' ? 'faturas' :
      msg.action === 'RUN_NUTROR_SEARCH' ? 'nutror' :
      'contratos';

    ensureSessionStateReady().then(() => {
    const cfg = getBOActionConfig(actionKey);
    const proc = recoverProcessForActionMessage(tabId, msg, sender);
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
    const resolveActionTabForButton =
      actionKey === 'orbita'
        ? resolveAssignedBODedicatedActionTab
        : resolveAssignedBOActionTab;
    resolveActionTabForButton(actionKey, (boTab) => {
      if (!boTab) {
        sendResponse({ ok: false, reason: actionKey === 'orbita' ? 'NO_ACTION_TAB' : 'NO_BO2' });
        return;
      }

      focusBOTab(boTab.id, (focused) => {
        if (!focused) {
          if (boActionTabIds[actionKey] === boTab.id) setBOActionTabAssignment(actionKey, null);
          else if (boTab2Id === boTab.id) setBOTabAssignment(2, null);
          sendResponse({ ok: false, reason: 'NO_BO2' });
          return;
        }

        waitForBOTabAwake(boTab.id, 4500)
          .then((awake) => awake ? true : waitForBOTabAwake(boTab.id, 2500))
          .then(() => runOrReuseBOActionSearch({
            boTabId: boTab.id,
            actionKey,
            proc,
            searchValue: searchTarget.value,
            force: false,
            source: 'button'
          }))
          .then((result) => {
            sendResponse({ ...result, focused: true });
          }).catch(() => {
            sendResponse({ ok: false, focused: true, reason: 'ERROR' });
          });
      });
    });
    }).catch(() => {
      sendResponse({ ok: false, reason: 'ERROR' });
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





chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (!isExtensionEnabled() || !sessionStateReady) return;
  chrome.windows.get(windowId, (window) => {
    if (chrome.runtime.lastError || !window?.focused) return;
    const eventEpoch = ++focusEventEpoch;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.active || eventEpoch !== focusEventEpoch) return;
      noteFocusedTab(tab);
      assignArmedBOTabFromTab(tab);
      refreshFocusedTicketOwnership(tabId);
    });
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!isExtensionEnabled() || !sessionStateReady) return;
  const eventEpoch = ++focusEventEpoch;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const previousFocusedTabId = focusedTabId;
    focusedTabId = null;
    pendingTicketFocusTabId = null;
    notifyTicketOwnerChanged(previousFocusedTabId, null);
    return;
  }
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (!tabs?.length || eventEpoch !== focusEventEpoch) return;
    chrome.windows.get(windowId, (window) => {
      if (chrome.runtime.lastError || !window?.focused || eventEpoch !== focusEventEpoch) return;
      const tab = tabs[0];
      noteFocusedTab(tab);
      assignArmedBOTabFromTab(tab);
      refreshFocusedTicketOwnership(tab.id);
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!sessionStateReady) {
    sessionStateReadyPromise.then(() => {
      ticketNavigationEpochs.delete(tabId);
      clearCurrentTicketForTab(tabId);
      clearAssignedBOTabIfRemoved(tabId);
    });
    return;
  }
  ticketNavigationEpochs.delete(tabId);
  clearCurrentTicketForTab(tabId);
  clearAssignedBOTabIfRemoved(tabId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  if (tabId === lastTicketTabId && Number.isInteger(attachInfo?.newWindowId)) {
    lastTicketWindowId = attachInfo.newWindowId;
    scheduleBOWindowLayoutCapture();
  }
  const slot = getRequiredBOTabAssignments().indexOf(tabId);
  if (slot < 0 || !Number.isInteger(attachInfo?.newWindowId) ||
      boTabWindowIds[slot] === attachInfo.newWindowId) return;
  boTabWindowIds[slot] = attachInfo.newWindowId;
  persistBOTabState();
  scheduleBOWindowLayoutCapture();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isExtensionEnabled() || !sessionStateReady) return;
  if (tabId === boTab1Id && changeInfo.status === 'complete' &&
      (tab?.url || '').startsWith(BO1_FATURAS_URL) && pendingBO1FaturasLaunchResume) {
    const pending = pendingBO1FaturasLaunchResume;
    pendingBO1FaturasLaunchResume = null;
    resumeBO1FaturasSearchAfterTabAssignment(pending.sourceTab, pending.ticketContext)
      .catch(() => {});
  }
  if (tabId === boTab2Id && changeInfo.status === 'complete' &&
      (tab?.url || '').startsWith(BO1_CONTRATOS_URL) && pendingBO1ContratosLaunchResume) {
    const pending = pendingBO1ContratosLaunchResume;
    pendingBO1ContratosLaunchResume = null;
    resumeBO1ContratosSearchAfterTabAssignment(pending.sourceTab, pending.ticketContext)
      .catch(() => {});
  }
  if (tabId === backOffice2TabIds[0] && changeInfo.status === 'complete' &&
      (tab?.url || '').startsWith(BO2_CUSTOMER_URL) && pendingBO2LaunchResume) {
    const pending = pendingBO2LaunchResume;
    pendingBO2LaunchResume = null;
    bo2SetupPlaceholderTabId = null;
    resumeBO2CustomerCountAfterTabAssignment(pending.sourceTab, pending.ticketContext)
      .catch(() => {});
  }
  if (!changeInfo.url) return;
  if (tabId === backOffice2TabIds[0]) {
    const placeholderDuringSetup = changeInfo.url === BO_SETUP_PLACEHOLDER_URL &&
      (tabId === bo2SetupPlaceholderTabId ||
        (tab?.pendingUrl || tab?.url || '').startsWith(BO2_CUSTOMER_URL));
    try {
      const url = new URL(changeInfo.url);
      if (url.origin !== 'https://bo2.eduzz.com' ||
          url.pathname.replace(/\/$/, '') !== '/bo/customer') {
        if (!placeholderDuringSetup) stopPendingBO2CustomerCount(tabId);
      }
    } catch {
      if (!placeholderDuringSetup) stopPendingBO2CustomerCount(tabId);
    }
  }
  ticketNavigationEpochs.set(tabId, (ticketNavigationEpochs.get(tabId) || 0) + 1);
  const nextTicketId = extractTicketIdFromTabUrl(changeInfo.url);
  if (tabId === focusedTabId && nextTicketId) {
    claimTicketOwner(tabId, nextTicketId);
    if (String(sessionCache[tabId]?.id || '') !== String(nextTicketId)) {
      sessionCache[tabId] = { id: nextTicketId, name: null, email: null, doc: null, accounts: null, accountsSource: null };
      syncSessionCache();
    }
  }
  if (tabId === lastTicketTabId) {
    const currentTicketId = sessionCache[tabId]?.id || processes.get(tabId)?.ticketId || null;
    if ((!nextTicketId && !isLikelyTicketContextUrl(changeInfo.url)) ||
        (nextTicketId && currentTicketId && String(nextTicketId) !== String(currentTicketId))) {
      clearCurrentTicketForTab(tabId);
    }
  }
  if (getRequiredBOTabAssignments().includes(tabId)) {
    const atExpectedHost = backOffice2TabIds.includes(tabId)
      ? isBackOffice2TabUrl(changeInfo.url)
      : isBackOfficeTabUrl(changeInfo.url);
    if (!atExpectedHost) {
      if (requiredBOTabsReady) {
        requiredBOTabsReady = false;
        broadcastBOTabState();
      }
    } else if (!requiredBOTabsReady) {
      checkAndResumeCurrentTicketSearches();
    }
  }
  if (tabId === lastTicketTabId && tabId !== focusedTabId) {
    const nextTicketId = extractTicketIdFromTabUrl(tab?.url || '');
    const currentTicketId = sessionCache[tabId]?.id || processes.get(tabId)?.ticketId || null;
    if (nextTicketId && currentTicketId && String(nextTicketId) !== String(currentTicketId)) {
      clearCurrentTicketForTab(tabId);
      return;
    }
    refreshFocusedTicketOwnership(tabId);
    return;
  }
  if (tabId !== focusedTabId) return;
  if (tab?.active) assignArmedBOTabFromTab(tab);
  refreshFocusedTicketOwnership(tabId);
});





function isCopyableFieldValue(v) {
  if (typeof v !== 'string') return false;
  const text = v.trim();
  return !!text && text !== '-' && text !== '...' && !/^[-–—−]+$/.test(text) && !text.startsWith('>');
}

function pickShortcutPayload(command, data) {
  if (!data) return null;

  switch (command) {
    case '02-copy-id': {
      const id = data.id;
      if (!isCopyableFieldValue(String(id ?? ''))) return null;
      return { value: String(id) };
    }
    case '03-copy-name': {
      const n = data.name;
      if (!isCopyableFieldValue(n)) return null;
      return { value: n.includes('@') ? n : n.split(/\s+/)[0] };
    }
    case '04-copy-email': {
      const e = data.email;
      if (!isCopyableFieldValue(e)) return null;
      return { value: e };
    }
    case '05-copy-doc': {
      const d = data.doc;
      if (!isCopyableFieldValue(d)) return null;
      return { value: d };
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

function copyValueViaOffscreen(value, onDone, softBreakLines = false) {
  (async () => {
    try {
      const ready = await ensureOffscreenDocument();
      if (!ready) {
        onDone(false);
        return;
      }

      chrome.runtime.sendMessage({ action: 'OFFSCREEN_COPY_TEXT', value, softBreakLines }, (resp) => {
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

function copyValueInActiveTab(value, onDone, softBreakLines = false) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTabId = tabs?.[0]?.id;
    if (!activeTabId) return onDone(false);

    chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: async (v, useSoftBreaks) => {
        if (!document?.body) return false;
        if (useSoftBreaks) {
          const span = document.createElement('span');
          String(v).split(/\r?\n/).forEach((line, index) => {
            if (index) span.appendChild(document.createElement('br'));
            span.appendChild(document.createTextNode(line));
          });
          const html = span.outerHTML;
          try {
            if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
              await navigator.clipboard.write([new ClipboardItem({
                'text/plain': new Blob([v], { type: 'text/plain' }),
                'text/html': new Blob([html], { type: 'text/html' })
              })]);
              return true;
            }
          } catch (_) {}
          const container = document.createElement('div');
          container.contentEditable = 'true';
          container.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
          container.innerHTML = html;
          document.body.appendChild(container);
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(container);
            selection.removeAllRanges();
            selection.addRange(range);
            return !!document.execCommand('copy');
          } catch (_) {
            return false;
          } finally {
            window.getSelection()?.removeAllRanges();
            container.remove();
          }
        }
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
      args: [value, softBreakLines]
    }, (results) => {
      if (chrome.runtime.lastError) return onDone(false);
      const ok = !!results?.[0]?.result;
      onDone(ok);
    });
  });
}

function shortcutCopyField(command) {
  switch (command) {
    case '02-copy-id': return 'id';
    case '03-copy-name': return 'name';
    case '04-copy-email': return 'email';
    case '05-copy-doc': return 'doc';
    default: return '';
  }
}

function notifyShortcutCopySuccess(tabId, field) {
  if (!tabId || !field) return;
  chrome.tabs.sendMessage(tabId, { action: 'COPY_VALUE_FEEDBACK', field, copiedAt: Date.now() }, () => {
    void chrome.runtime.lastError;
  });
}

async function copyMaskedBO2EmailsOrAssignTabs(expectedTicketId = null, expectedProcessId = null,
  requestingTabId = null) {
  if (!await ensureSessionStateReady() || !isExtensionEnabled()) {
    return { ok: false, reason: 'NOT_READY' };
  }
  const ownerTabId = lastTicketTabId;
  const ownerEpoch = currentTicketEpoch;
  const cached = sessionCache[ownerTabId];
  const ticketId = String(cached?.id || '').trim();
  const proc = processes.get(ownerTabId);
  if (!ticketId && !Number.isInteger(backOffice2TabIds[0]) && !expectedTicketId) {
    const activeTab = Number.isInteger(requestingTabId)
      ? await getExistingTab(requestingTabId)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0];
    const result = await launchDefinedBOTabs(activeTab || null, null);
    return { ok: !!result?.ok, action: 'assign' };
  }
  if (!Number.isInteger(ownerTabId) || !ticketId ||
      (Number.isInteger(pendingTicketFocusTabId) && pendingTicketFocusTabId !== ownerTabId) ||
      (Number.isInteger(requestingTabId) && requestingTabId !== ownerTabId) ||
      (expectedTicketId && String(expectedTicketId) !== ticketId)) {
    return { ok: false, reason: 'NO_CURRENT_TICKET' };
  }
  const ownerTab = await getExistingTab(ownerTabId);
  if (ownerEpoch !== currentTicketEpoch || ownerTabId !== lastTicketTabId ||
      (Number.isInteger(pendingTicketFocusTabId) && pendingTicketFocusTabId !== ownerTabId) ||
      String(extractHubSpotTicketIdFromUrl(ownerTab?.url || '') || '') !== ticketId) {
    return { ok: false, reason: 'STALE_TICKET' };
  }
  if (expectedProcessId && proc && proc.processId !== expectedProcessId) {
    const live = await chrome.tabs.sendMessage(ownerTabId, { action: 'GET_CURRENT_DATA' })
      .catch(() => null);
    if (ownerEpoch !== currentTicketEpoch || !live?.isTicketPage ||
        live.ownerEpoch !== ownerEpoch ||
        String(live.currentProcessId || '') !== String(expectedProcessId) ||
        String(live.data?.id || '') !== ticketId) {
      return { ok: false, reason: 'STALE_TICKET' };
    }
  }
  if (!Number.isInteger(backOffice2TabIds[0])) {
    const launched = await chrome.tabs.sendMessage(ownerTabId, {
      action: 'RUN_BO_SETUP_ACTION', expectedTicketId: ticketId, ownerEpoch
    }).catch(() => null);
    return { ok: !!launched?.ok, action: 'assign' };
  }
  const value = proc?.ticketId === ticketId && proc.maskedEmails || cached.maskedEmails;
  const accounts = proc?.ticketId === ticketId ? proc.accounts : cached.accounts;
  const accountsSource = proc?.ticketId === ticketId ? proc.accountsSource : cached.accountsSource;
  if (accountsSource !== 'bo2_customer' || !hasCompletedBO2CustomerCount(accounts) ||
      typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: 'NO_EMAILS' };
  }
  if (ownerEpoch !== currentTicketEpoch || ownerTabId !== lastTicketTabId ||
      (Number.isInteger(pendingTicketFocusTabId) && pendingTicketFocusTabId !== ownerTabId)) {
    return { ok: false, reason: 'STALE_TICKET' };
  }
  let copied = await new Promise(resolve => copyValueViaOffscreen(value, resolve, true));
  if (!copied) copied = await new Promise(resolve => copyValueInActiveTab(value, resolve, true));
  if (copied && ownerEpoch === currentTicketEpoch && ownerTabId === lastTicketTabId) {
    notifyShortcutCopySuccess(ownerTabId, 'accounts');
  }
  return { ok: !!copied, action: 'copy' };
}

function performShortcutCopy(command, data, sourceTabId) {
  const payload = pickShortcutPayload(command, data);
  if (!payload) return;
  const field = shortcutCopyField(command);

  copyValueViaOffscreen(payload.value, (offscreenOk) => {
    if (offscreenOk) {
      notifyShortcutCopySuccess(sourceTabId, field);
      return;
    }

    copyValueInActiveTab(payload.value, (activeTabOk) => {
      if (activeTabOk) notifyShortcutCopySuccess(sourceTabId, field);
    });
  });
}

function copyFieldFromCurrentTicket(command, commandTab = null) {
  const useActiveTab = (activeTab) => {
    const activeTabId = activeTab?.id ?? null;
    const activeUrlTicketId = extractTicketIdFromTabUrl(activeTab?.url || '');
    const activeLooksLikeTicket = !!activeUrlTicketId || isLikelyTicketContextUrl(activeTab?.url || '');
    const sourceTabId = activeLooksLikeTicket ? activeTabId : lastTicketTabId;
    if (!Number.isInteger(sourceTabId)) return;

    if (activeUrlTicketId) {
      focusedTabId = activeTabId;
      claimTicketOwner(activeTabId, activeUrlTicketId);
      if (String(sessionCache[activeTabId]?.id || '') !== activeUrlTicketId) {
        sessionCache[activeTabId] = { id: activeUrlTicketId, name: null, email: null, doc: null, accounts: null };
        syncSessionCache();
      }
    }

    const startedEpoch = currentTicketEpoch;
    const startedFocusEpoch = focusEventEpoch;
    const copyThroughBackground = () => chrome.tabs.sendMessage(sourceTabId,
      { action: 'GET_CURRENT_DATA' }, (resp) => {
      const err = chrome.runtime.lastError;
      if (startedEpoch !== currentTicketEpoch || startedFocusEpoch !== focusEventEpoch) return;
      const liveData = !err && resp?.isTicketPage && resp?.data?.id &&
        resp.ownerEpoch === currentTicketEpoch &&
        (!activeUrlTicketId || String(resp.data.id) === activeUrlTicketId) ? resp.data : null;

      if (activeLooksLikeTicket && !activeUrlTicketId && liveData) {
        focusedTabId = activeTabId;
        claimTicketOwner(activeTabId, liveData.id);
      }
      if (sourceTabId !== lastTicketTabId) return;

      if (liveData) {
        const priorCache = sessionCache[sourceTabId] || null;
        sessionCache[sourceTabId] = {
          id: liveData.id,
          name: liveData.name ?? null,
          email: liveData.email ?? null,
          doc: priorCache?.id === liveData.id
            ? preserveFinalRequesterLookupDoc(liveData.doc ?? priorCache.doc ?? null, priorCache.doc)
            : liveData.doc ?? null,
          accounts: liveData.accounts ?? null,
          accountsSource: priorCache?.id === liveData.id ? (priorCache.accountsSource ?? null) : null,
          maskedEmails: priorCache?.id === liveData.id ? (priorCache.maskedEmails ?? null) : null,
          nutrorResult: priorCache?.id === liveData.id ? (priorCache.nutrorResult ?? null) : null,
          contratosResult: priorCache?.id === liveData.id ? (priorCache.contratosResult ?? null) : null,
          accountType: priorCache?.id === liveData.id
            ? (priorCache.accountType ?? (String(liveData.accountType || '').trim() === '--'
              ? 'Cliente Final' : liveData.accountType ?? null)) : null
        };
        syncSessionCache();
        performShortcutCopy(command, liveData, sourceTabId);
        return;
      }

      const cachedData = sessionCache[sourceTabId] || null;
      if (!cachedData?.id || activeLooksLikeTicket && !activeUrlTicketId) return;
      if (activeUrlTicketId && String(cachedData.id) !== activeUrlTicketId) return;
      chrome.tabs.get(sourceTabId, (sourceTab) => {
        if (chrome.runtime.lastError || !sourceTab || sourceTabId !== lastTicketTabId ||
            startedFocusEpoch !== focusEventEpoch || startedEpoch !== currentTicketEpoch) return;
        const sourceUrlId = extractTicketIdFromTabUrl(sourceTab.url || '');
        if (sourceUrlId ? String(sourceUrlId) !== String(cachedData.id) :
          !isLikelyTicketContextUrl(sourceTab.url || '')) return;
        performShortcutCopy(command, cachedData, sourceTabId);
      });
    });
    const field = shortcutCopyField(command);
    if (field && activeUrlTicketId && sourceTabId === activeTabId) {
      chrome.tabs.sendMessage(sourceTabId, {
        action: 'COPY_SHORTCUT_FIELD', field, ticketId: activeUrlTicketId,
        ownerEpoch: startedEpoch
      }, (response) => {
        void chrome.runtime.lastError;
        if (!response?.ok) copyThroughBackground();
      });
      return;
    }
    const cached = sessionCache[sourceTabId];
    if (!activeLooksLikeTicket && sourceTabId === lastTicketTabId &&
        pickShortcutPayload(command, cached)) {
      chrome.tabs.get(sourceTabId, (sourceTab) => {
        if (chrome.runtime.lastError || !sourceTab ||
            startedEpoch !== currentTicketEpoch || startedFocusEpoch !== focusEventEpoch ||
            sourceTabId !== lastTicketTabId) return;
        const sourceTicketId = extractTicketIdFromTabUrl(sourceTab.url || '');
        if (sourceTicketId && String(sourceTicketId) === String(cached.id)) {
          performShortcutCopy(command, cached, sourceTabId);
        } else {
          copyThroughBackground();
        }
      });
      return;
    }
    copyThroughBackground();
  };
  if (commandTab?.active && Number.isInteger(commandTab.id)) {
    useActiveTab(commandTab);
    return;
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    useActiveTab(tabs?.[0] || null);
  });
}

function blockedManualBOActionField(command, ownerTabId) {
  const cached = sessionCache[ownerTabId];
  const proc = processes.get(ownerTabId);
  const ticketId = String(cached?.id || proc?.ticketId || '');
  const currentProc = proc && String(proc.ticketId) === ticketId ? proc : null;
  const emails = [currentProc?.email, cached?.email].map(value => String(value || '').trim());
  const docs = [currentProc?.doc, cached?.doc];
  if (emails.includes('> Ticket sem email') || emails.includes('> Múltiplas Contas')) return 'email';
  if (docs.some(isFinalRequesterLookupDoc) && command !== '07-orbita-search') return 'doc';
  return null;
}

async function runManualBOSearchWithTabFeedback(command, getAssignedTabId, runSearch) {
  try {
    if (!await ensureSessionStateReady() || !isExtensionEnabled()) return;
    const ownerTabId = lastTicketTabId;
    const ownerEpoch = currentTicketEpoch;
    const blockedField = blockedManualBOActionField(command, ownerTabId);
    const tabId = getAssignedTabId();
    const missingTab = !Number.isInteger(tabId) || !await getExistingTab(tabId);
    if (ownerTabId !== lastTicketTabId || ownerEpoch !== currentTicketEpoch) return;
    if (missingTab || blockedField) {
      sendToTab(ownerTabId, { action: 'FLASH_BLOCKED_BO_ACTION',
        missingTab, blockedField, triggeredAt: Date.now() });
      return;
    }
    await runSearch();
  } catch (_) {}
}

async function copyMaskedEmailsWithStatusFeedback() {
  try {
    if (!await ensureSessionStateReady() || !isExtensionEnabled()) return;
    const ownerTabId = lastTicketTabId;
    const ownerEpoch = currentTicketEpoch;
    const blockedField = blockedManualBOActionField('06-copy-bo1-masked-emails', ownerTabId);
    if (!blockedField) {
      await copyMaskedBO2EmailsOrAssignTabs();
      return;
    }
    const tabId = backOffice2TabIds[0];
    const missingTab = !Number.isInteger(tabId) || !await getExistingTab(tabId);
    if (ownerTabId !== lastTicketTabId || ownerEpoch !== currentTicketEpoch) return;
    sendToTab(ownerTabId, { action: 'FLASH_BLOCKED_BO_ACTION',
      missingTab, blockedField, triggeredAt: Date.now() });
  } catch (_) {}
}

function handleCopyCommand(command, commandTab) {
  if (command === '07-orbita-search') {
    runManualBOSearchWithTabFeedback(command, () => backOffice2TabIds[0], runManualBO2OrbitaSearch);
    return;
  }
  if (command === '08-nutror-search') {
    runManualBOSearchWithTabFeedback(command, () => backOffice2TabIds[1], runManualBO2NutrorSearch);
    return;
  }
  if (command === '09-faturas-search') {
    runManualBOSearchWithTabFeedback(command, () => boTab1Id, runManualBO1FaturasSearch);
    return;
  }
  if (command === '10-contratos-search') {
    runManualBOSearchWithTabFeedback(command, () => boTab2Id, runManualBO1ContratosSearch);
    return;
  }
  if (command === '06-copy-bo1-masked-emails') {
    copyMaskedEmailsWithStatusFeedback();
    return;
  }

  if (sessionStateReady) {
    copyFieldFromCurrentTicket(command, commandTab);
    return;
  }

  ensureSessionStateReady().then((ready) => {
    if (ready) {
      copyFieldFromCurrentTicket(command, commandTab);
      return;
    }
    chrome.storage.session.get(['sessionCache', 'lastTicketTabId'], (stored) => {
      if (stored.sessionCache) sessionCache = { ...stored.sessionCache, ...sessionCache };
      if (!Number.isInteger(lastTicketTabId) && Number.isInteger(stored.lastTicketTabId)) {
        lastTicketTabId = stored.lastTicketTabId;
      }
      copyFieldFromCurrentTicket(command, commandTab);
    });
  });
}

chrome.commands.onCommand.addListener((command, commandTab) => {
  if (isExtensionEnabled()) {
    handleCopyCommand(command, commandTab);
    return;
  }
  // A newly woken service worker may receive a command before its initial
  // enabled-state read completes.
  chrome.storage.local.get('enabled', ({ enabled }) => {
    if (enabled !== true) return;
    extensionEnabled = true;
    handleCopyCommand(command, commandTab);
  });
});









function scheduleBOSearch(proc) {
  if (BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER) return;
  if (!proc || proc.status === 'ABORTED' || proc.status === 'NO_EMAIL' ||
      proc.email === '> Ticket sem email') return;
  if (!proc.email) return;

  checkRequiredBOTabsReady().then((ready) => {
    if (!isProcessStillValid(proc) || !isCurrentTicketOwnerProcess(proc)) return;
    if (!ready) {
      proc.status = 'WAITING_REQUIRED_BO_TABS';
      return;
    }
    if (!canRunBOSearchForProcess(proc)) return;

    proc.status = 'RESOLVING_BO_TAB';
    if (boSearchBusy) {
      pendingProc = proc;
      return;
    }
    runBOSearch(proc);
  });
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
        if (boSearchOwner !== proc.processId) return;
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
        if (boSearchOwner !== proc.processId) return;
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

  if (!hasValidDocLength(proc.doc)) {
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
      if (boSearchOwner !== proc.processId) return;
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
      if (boSearchOwner !== proc.processId) return;
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
}

function triggerAutoAssignedActionSearches(proc, opts = {}) {
  if (!proc) return;
  if (!canRunBOSearchForProcess(proc)) return;

  for (const cfg of [getBOActionConfig('orbita'), getBOActionConfig('nutror'), getBOActionConfig('contratos')]) {
    if (!cfg) continue;
    if (!Number.isInteger(boActionTabIds[cfg.key])) continue;

    const searchTarget = cfg.resolveSearchValue({
      doc: proc.doc,
      email: proc.email,
      accounts: proc.accounts
    });
    if (!searchTarget?.value) continue;

    resolveAssignedBODedicatedActionTab(cfg.key, (boTab) => {
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

function runOrbitaSearch(boTabId, searchValue, op = null, proc = null, opts = {}) {
  const shouldRunDefinitiveSecondPass =
    !String(searchValue ?? '').includes('@') &&
    hasValidDocLength(searchValue);
  return enqueueSerializedBOSearch(() =>
    runSectionSearchScriptWithRetry(boTabId, searchValue, 'MyEduzz', op, proc, {
      doubleSearch: shouldRunDefinitiveSecondPass
    }),
    opts.cooldownMs ?? 90,
    queueKeyForBOTab(boTabId),
    opts.queueVersion
  );
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

async function runSectionSearchScriptWithRetry(boTabId, searchValue, sectionId, op = null, proc = null, opts = {}) {
  const retryableStatuses = new Set(['ERROR']);
  const retryDelays = [420, 700];

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (!shouldRunBOActionScript(op, proc)) return { status: 'STALE_CONTEXT' };

    const result = await chrome.scripting.executeScript({
      target: { tabId: boTabId },
      func: boSectionSearchScript,
      args: [searchValue, sectionId, op?.token || null, opts]
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
  if (actionKey === 'orbita') {
    return {
      key: 'orbita',
      actionType: 'ORBITA_SEARCH',
      sectionId: 'MyEduzz',
      resolveSearchValue: resolveNutrorSearchValue,
      runSearch: runOrbitaSearch,
      hasVisibleResults: (tabId, value) => hasVisibleSectionResults(tabId, 'MyEduzz', value),
      marksCompleted: (result) => ['FOUND', 'NO_RESULT'].includes(result?.status),
      requiresVisibleProof: true
    };
  }
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
      marksCompleted: (result) => ['FOUND', 'NO_RESULT'].includes(result?.status),
      requiresVisibleProof: true
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
  if (BO_SEARCHES_PAUSED_FOR_SIDEBAR_REMASTER) {
    return Promise.resolve({ ok: false, reason: 'BO_SEARCHES_PAUSED' });
  }
  const cfg = getBOActionConfig(actionKey);
  if (!cfg || !Number.isInteger(boTabId) || !proc || !searchValue) {
    return Promise.resolve({ ok: false, reason: 'INVALID_ACTION' });
  }
  if (!requiredBOTabsReady) {
    return Promise.resolve({ ok: false, reason: 'REQUIRED_BO_TABS_UNAVAILABLE' });
  }

  const currentValue = normalizeBOActionSearchValue(searchValue);
  const isButtonClick = source === 'button';
  const requestKey = getBOActionRequestKey(boTabId, cfg.key, currentValue, proc);
  if (!force && !isButtonClick && requestKey && boActionInFlightPromises.has(requestKey)) {
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
    if (!isExtensionEnabled()) return Promise.resolve({ ok: false, reason: 'EXTENSION_DISABLED' });
    if (!requiredBOTabsReady) return Promise.resolve({ ok: false, reason: 'REQUIRED_BO_TABS_UNAVAILABLE' });
    if (!canRunBOSearchForProcess(proc)) return Promise.resolve({ ok: false, reason: 'STALE_CONTEXT' });
    cancelBOActionOperationsForTab(boTabId);
    const op = startBOActionOperation(boTabId, cfg.key, currentValue, proc);
    const queueVersion = resetBOExecutionQueueForTab(boTabId);
    return stampBOActionPageRun(boTabId, op)
      .then(() => canRunBOSearchForProcess(proc) && isBOActionOperationCurrent(op, proc)
        ? cfg.runSearch(boTabId, currentValue, op, proc, { queueVersion })
        : { status: 'STALE_CONTEXT' })
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
      if (!force && !isButtonClick && !shouldForceButtonRun && !cfg.requiresVisibleProof && stateMatches && contextStillMatches && isRecentlyStartedBOAction(currentState)) {
        markBO2LastAction(cfg.actionType, currentValue, proc.processId, proc.ticketId);
        return { ok: true, skipped: true, reason: 'ALREADY_STARTING' };
      }
      if (isButtonClick && currentState?.resultStatus === 'NO_RESULT') {
        clearBOActionStateForTab(boTabId);
        return runSearchForMode();
      }
      if (!force && !isButtonClick && !shouldForceButtonRun && !cfg.requiresVisibleProof && stateMatches && contextStillMatches && isCompletedBOActionState(currentState)) {
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

  if (key === 'orbita') {
    return isProductTabChecked('MyEduzz') &&
      category.includes('cliente');
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

  function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
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
    const targetText =
      sectionId === 'Next' ? 'clientes next' :
      sectionId === 'MyEduzz' ? 'clientes' :
      'clientes nutror';
    const headers = Array.from(document.querySelectorAll('h3'));
    for (const header of headers) {
      const headerText = normalizeText(header.textContent || '');
      if (
        headerText !== targetText &&
        !(isProductTabChecked(sectionId) && headerText.includes('cliente'))
      ) continue;
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

  function getFaturasRows(rootEl) {
    return Array.from(rootEl?.querySelectorAll?.('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr') || [])
      .filter((row) => isVisible(row) && normalizeText(row.textContent || ''));
  }

  function getBuyerCell(row) {
    return row?.querySelector?.('td') || null;
  }

  function getBuyerEmail(row) {
    const text = getBuyerCell(row)?.textContent || '';
    const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? normalizeEmail(match[0]) : '';
  }

  function getBuyerDoc(row) {
    const text = getBuyerCell(row)?.textContent || '';
    const match = String(text).match(/CPF\/CNPJ\s*:\s*([0-9.\-\/]+)/i);
    return match ? normalizeDigits(match[1]) : '';
  }

  function rowMatchesExpectedIdentity(row) {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return true;
    if (expected.includes('@')) {
      return getBuyerEmail(row) === normalizeEmail(expected);
    }
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    return getBuyerDoc(row) === expectedDigits;
  }

  function rowClearlyBelongsToAnotherSearch(row) {
    const expected = String(expectedSearchValue ?? '').trim();
    if (!expected) return false;
    if (expected.includes('@')) {
      const buyerEmail = getBuyerEmail(row);
      return !!buyerEmail && buyerEmail !== normalizeEmail(expected);
    }
    const expectedDigits = normalizeDigits(expected);
    const buyerDoc = getBuyerDoc(row);
    return !!expectedDigits && !!buyerDoc && buyerDoc !== expectedDigits;
  }

  function rootHasMatchingRows(rootEl) {
    if (!rootEl || !isVisible(rootEl)) return false;
    const rows = getFaturasRows(rootEl);
    if (!rows.length) return false;
    if (rows.some(rowClearlyBelongsToAnotherSearch)) return false;
    return rows.some(rowMatchesExpectedIdentity);
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

  function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
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

  function findFaturasPopups() {
    return Array.from(document.querySelectorAll('[tabindex="-1"], [role="dialog"], .MuiDialog-root, .MuiPopover-root'))
      .filter((root) => isVisible(root) && normalizeText(root.textContent || '').includes('status da fatura'));
  }

  function getFaturasRows(rootEl) {
    return Array.from(rootEl?.querySelectorAll?.('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr') || [])
      .filter((row) => isVisible(row) && normalizeText(row.textContent || ''));
  }

  function getBuyerCell(row) {
    return row?.querySelector?.('td') || null;
  }

  function getBuyerEmail(row) {
    const text = getBuyerCell(row)?.textContent || '';
    const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? normalizeEmail(match[0]) : '';
  }

  function getBuyerDoc(row) {
    const text = getBuyerCell(row)?.textContent || '';
    const match = String(text).match(/CPF\/CNPJ\s*:\s*([0-9.\-\/]+)/i);
    return match ? normalizeDigits(match[1]) : '';
  }

  function rowMatchesSearchValue(row) {
    const expected = String(searchValue ?? '').trim();
    if (!expected) return true;
    if (expected.includes('@')) return getBuyerEmail(row) === normalizeEmail(expected);
    const expectedDigits = normalizeDigits(expected);
    if (!expectedDigits) return true;
    return getBuyerDoc(row) === expectedDigits;
  }

  function rowClearlyBelongsToAnotherSearch(row) {
    const expected = String(searchValue ?? '').trim();
    if (!expected) return false;
    if (expected.includes('@')) {
      const buyerEmail = getBuyerEmail(row);
      return !!buyerEmail && buyerEmail !== normalizeEmail(expected);
    }
    const expectedDigits = normalizeDigits(expected);
    const buyerDoc = getBuyerDoc(row);
    return !!expectedDigits && !!buyerDoc && buyerDoc !== expectedDigits;
  }

  function popupHasForeignFaturasRows(rootEl) {
    return getFaturasRows(rootEl).some(rowClearlyBelongsToAnotherSearch);
  }

  async function dismissFaturasPopup(rootEl) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!isCurrentAction()) return false;
      if (!rootEl || !isVisible(rootEl)) return true;
      const escDown = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      const escUp = new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      rootEl.dispatchEvent(escDown);
      document.dispatchEvent(escDown);
      window.dispatchEvent(escDown);
      rootEl.dispatchEvent(escUp);
      document.dispatchEvent(escUp);
      window.dispatchEvent(escUp);
      await delay(120);
    }

    return !rootEl || !isVisible(rootEl);
  }

  async function dismissForeignFaturasPopupBeforeSearch() {
    const foreignPopup = findFaturasPopups().find(popupHasForeignFaturasRows);
    if (!foreignPopup) return true;
    return dismissFaturasPopup(foreignPopup);
  }

  function hasMatchingFaturasRows() {
    for (const root of findFaturasPopups()) {
      const rows = getFaturasRows(root);
      if (!rows.length) continue;
      if (rows.some(rowClearlyBelongsToAnotherSearch)) continue;
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
    if (!(await dismissForeignFaturasPopupBeforeSearch())) return { status: 'ERROR' };
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

function boSectionSearchScript(searchValue, sectionId = 'Nutror', actionToken = null, options = {}) {
  let lastSearchStartedAt = 0;
  const shouldRunSecondSearch = options?.doubleSearch !== false;
  
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
    if (sectionId === 'MyEduzz') return 'clientes';
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

    const target =
      sectionId === 'Next' ? 'next' :
      sectionId === 'MyEduzz' ? 'myeduzz' :
      'nutror';
    const aliases =
      sectionId === 'MyEduzz' ? ['myeduzz', 'orbita'] :
      sectionId === 'Next' ? ['next'] :
      ['nutror'];
    const nodes = Array.from(document.querySelectorAll('li, button, a, [role="button"], [role="menuitem"]'))
      .filter(isVisible);

    for (const node of nodes) {
      const id = normalizeText(node.id || '');
      const text = normalizeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (aliases.includes(id) || aliases.includes(text)) return node;
    }

    for (const node of nodes) {
      const id = normalizeText(node.id || '');
      const text = normalizeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (id.includes(target) || text.includes(target) || aliases.some(alias => id.includes(alias) || text.includes(alias))) return node;
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
    if (shouldRunSecondSearch && (firstState === 'FOUND' || firstState === 'WAITING_SEARCH')) {
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
  'pausedTicketSnapshot',
  'boTab1Id',
  'boTab2Id',
  'backOffice2TabIds',
  'boTabWindowIds',
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
  activeHistoryCandidate = normalizeHistoryItem(data[ACTIVE_HISTORY_CANDIDATE_SESSION_KEY]);
  hubspotPortalId = String(data[HUBSPOT_PORTAL_ID_SESSION_KEY] || '').trim() || null;
  if (data.lastTicketTabId) lastTicketTabId = data.lastTicketTabId;
  pausedTicketSnapshot = data.pausedTicketSnapshot || null;
  if (Number.isInteger(data.boTab1Id)) boTab1Id = data.boTab1Id;
  if (Number.isInteger(data.boTab2Id)) boTab2Id = data.boTab2Id;
  if (Array.isArray(data.backOffice2TabIds)) {
    backOffice2TabIds = [0, 1].map((index) =>
      Number.isInteger(data.backOffice2TabIds[index]) ? data.backOffice2TabIds[index] : null);
  }
  if (Array.isArray(data.boTabWindowIds)) {
    boTabWindowIds = [0, 1, 2, 3].map((index) =>
      Number.isInteger(data.boTabWindowIds[index]) ? data.boTabWindowIds[index] : null);
  }
  if (data.boAssignArmedSlot === 1 || data.boAssignArmedSlot === 2) boAssignArmedSlot = data.boAssignArmedSlot;
  boAssignArmedAction = normalizeActionTabKey(data.boAssignArmedAction);
  if (data.boActionTabIds && typeof data.boActionTabIds === 'object') {
    boActionTabIds = {
      orbita: Number.isInteger(data.boActionTabIds.orbita) ? data.boActionTabIds.orbita : null,
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
  markSessionStateReady();
  syncBOTabWindowIdsForExistingTabs();
  checkAndResumeCurrentTicketSearches();
  if (Number.isInteger(lastTicketTabId)) refreshFocusedTicketOwnership(lastTicketTabId);
});
