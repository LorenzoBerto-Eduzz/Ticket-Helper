if (window.__ticketHelperLoaded) {

} else {
window.__ticketHelperLoaded = true;




















let enabled        = false;
let resumeValidationPending = false;
let resumeValidationComplete = false;
let popup          = null;
let popupDragging  = false;
let popupPositionReady = false;
let popupHasStoredPosition = false;
let popupOwnerStateResolved = false;
let popupOwnerTabId = null;
let popupOwnerTicketId = null;
let popupOwnerEpoch = null;
let popupThisTabId = null;
let popupFocusedTabId = null;
let popupOwnerRequestId = 0;
const copyFeedbackTimers = new Map();
let bodyReadyObserver = null;
let bodyReadyCallback = null;
let bootstrapPopupPositionData = null;
let lastUrl        = location.href;

let currentProcessId = null;
let currentTicketId  = null;
let localTicketGeneration = 0;


let localData = { id: null, name: null, email: null, doc: null, accounts: null };
let boTabState = {
  boTab1Assigned: false,
  boTab2Assigned: false,
  backOffice2TabsAssigned: [false, false],
  requiredTabsAssigned: false,
  requiredTabsReady: false,
  armedSlot: null,
  armedAction: null,
  actionTabs: { orbita: false, faturas: false, nutror: false, contratos: false }
};
let boTabStateResolved = false;
let boTabsHintDismissed = false;
let boActionHintDismissed = false;


let emailSent      = false;
let nameSent       = false;
let hoverAttempted = false;


let extractionTimer  = null;
let urlObserver      = null;
let urlPollTimer     = null;
let resizeTimer      = null;
let routeCheckTimer  = null;
let routeEventHandler = null;
let hyperflowListClickHandler = null;
let hubspotTicketClickHandler = null;
let popupValueMeasureContext = null;
let historyHooksInstalled = false;
let originalHistoryPushState = null;
let originalHistoryReplaceState = null;
let ticketHelperPushStateWrapper = null;
let ticketHelperReplaceStateWrapper = null;
let lastFaturasRefreshTicketId = null;
let hubSpotSidebarWatch = null;
let hubSpotAccountWatch = null;
let hubSpotAccountResult = null;
const hubSpotPinnedSidebarLists = new Set();
let pendingHubSpotTicketId = null;
let pendingHubSpotTicketStartedAt = 0;
let ticketTransitionRetryTimers = [];
let ticketExtractionNudgeTimer = null;
let trustedHubSpotUrlTicketId = null;
let trustedHubSpotUrlTicketUntil = 0;
let historyViewOpen = false;
let historyViewTicketId = null;
let historyOutsideClickHandlerInstalled = false;





const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractEmail(str) {
  if (!str) return null;
  const m = str.match(emailRegex);
  return m ? m[0].toLowerCase() : null;
}

function msgBg(msg) {
  return new Promise(resolve => {
    try {
      if (!chrome?.runtime?.id) {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage(msg, resp => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve(null);
          return;
        }
        resolve(resp ?? null);
      });
    } catch { resolve(null); }
  });
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function msgBgActionRun(msg) {
  const first = await msgBg(msg);
  const reason = String(first?.reason || '');
  if (reason !== 'NO_PROCESS' && reason !== 'PROCESS_MISMATCH') return first;
  await waitMs(180);
  return msgBg({ ...msg, retryAfterProcessRecovery: true });
}

function safeSetLocal(data) {
  try {
    if (!chrome?.storage?.local?.set) return;
    chrome.storage.local.set(data, () => {
      void chrome.runtime?.lastError;
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (message.includes('Extension context invalidated')) return;
    throw err;
  }
}

function isCopyablePopupValue(v) {
  if (typeof v !== 'string') return false;
  const text = v.trim();
  return !!text && text !== '-' && text !== '...' && !/^[-–—−]+$/.test(text) && !text.startsWith('>');
}

function normalizeCachedHubSpotDoc(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text === '...') return value;
  if (/^[-–—−]{2,}$/.test(text)) return '> Conta sem doc';
  if (text.startsWith('>')) return value;
  return hasValidDocLengthForAction(text) ? text : '> Doc. Estrang./Inválido';
}

function isFinalRequesterLookupDoc(value) {
  return ['> Email sem conta', '> Múltiplas contas'].includes(String(value || '').trim());
}

function applyPopupFields(fields) {
  const next = { ...fields };
  if (Object.prototype.hasOwnProperty.call(next, 'doc')) {
    next.doc = normalizeCachedHubSpotDoc(next.doc);
    if (isFinalRequesterLookupDoc(localData.doc) && next.doc !== localData.doc) {
      delete next.doc;
    }
  }
  if (isFinalRequesterLookupDoc(localData.doc) || isFinalRequesterLookupDoc(next.doc)) {
    next.accounts = '-';
  }
  Object.assign(localData, next);
}

function waitForBody(cb) {
  if (document.body) {
    cb();
    return;
  }
  bodyReadyCallback = cb;
  if (bodyReadyObserver) return;
  const finish = () => {
    if (!document.body) return;
    bodyReadyObserver.disconnect();
    bodyReadyObserver = null;
    document.removeEventListener('DOMContentLoaded', finish);
    const callback = bodyReadyCallback;
    bodyReadyCallback = null;
    callback?.();
  };
  bodyReadyObserver = new MutationObserver(finish);
  bodyReadyObserver.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', finish, { once: true });
}

function getPopupPositionStorageKeys() {
  const host = isHubSpot() ? 'hubspot' : 'hyperflow';
  return [
    `popupPosition_${host}`,
    ...[8, 7, 6, 5, 4, 3].map(version => `popupPosition_compactHeader_v${version}_${host}`),
    ...[2, 1].map(version => `popupPosition_wideLayout_v${version}_${host}`)
  ];
}

function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}





function isHubSpot()     { return location.hostname.includes('hubspot.com'); }
function isHubSpotApp()  { return location.hostname === 'app.hubspot.com'; }
function isHyperflow()   { return location.hostname === 'conversas.hyperflow.global'; }
function isValidDomain() { return isHubSpot() || isHyperflow(); }

function extractHubSpotTicketIdFromText(text) {
  if (!text) return null;
  const m = text.match(/\/ticket\/(\d+)/);
  return m ? m[1] : null;
}

function extractHubSpotTicketIdFromHref(href) {
  if (!href) return null;
  const direct = extractHubSpotTicketIdFromText(href);
  if (direct) return direct;

  try {
    const url = new URL(href, location.origin);
    const eschref = url.searchParams.get('eschref');
    if (eschref) {
      const decoded = decodeURIComponent(eschref);
      const fromEscHref = extractHubSpotTicketIdFromText(decoded);
      if (fromEscHref) return fromEscHref;
    }
  } catch {

  }

  return null;
}

function extractHubSpotTicketIdFromDom() {
  const selectors = [
    '[data-test-id="ticket-header-contact-detail-link"] a[href]',
    '[data-test-id="ticket-header-name-link"] a[href]',
    '[data-test-id="ticket-panel-enlarge-button"][href]',
    'a[data-speculation-target="crm-links-CRM_OBJECT_RECORD"][href*="/ticket/"]',
    'a[href*="/help-desk/"][href*="/ticket/"][href*="/thread/"]'
  ];

  for (const selector of selectors) {
    const links = Array.from(document.querySelectorAll(selector));
    for (const link of links) {
      const fromLink = extractHubSpotTicketIdFromHref(link.href || link.getAttribute('href'));
      if (fromLink) return fromLink;
    }
  }

  return null;
}

function hasHubSpotTicketShell() {
  const selectors = [
    '[data-test-id="ticket-header-name-link"]',
    '[data-test-id="ticket-header-contact-detail-link"]',
    '[data-test-id="ticket-panel-close-button"]',
    '[data-test-id="ticket-panel-enlarge-button"]',
    '[data-test-id="inbox-thread-loaded"]',
    '[data-test-id="AgentThreadHistory"]',
    '[data-test-id="card-wrapper-ASSOCIATION_V3/0-1"]',
    '[data-sidebar-key="Requerente"]',
    '[data-sidebar-key="Requester"]'
  ];

  return selectors.some(selector => {
    const el = document.querySelector(selector);
    return el && (isElementVisible(el) || !!el.textContent?.trim());
  });
}

function markTrustedHubSpotUrlTicket(ticketId, durationMs = 6500) {
  trustedHubSpotUrlTicketId = ticketId || null;
  trustedHubSpotUrlTicketUntil = trustedHubSpotUrlTicketId ? Date.now() + durationMs : 0;
}

function clearTrustedHubSpotUrlTicket() {
  trustedHubSpotUrlTicketId = null;
  trustedHubSpotUrlTicketUntil = 0;
}

function isTrustedHubSpotUrlTicket(ticketId) {
  if (!ticketId || trustedHubSpotUrlTicketId !== ticketId) return false;
  if (Date.now() <= trustedHubSpotUrlTicketUntil) return true;
  clearTrustedHubSpotUrlTicket();
  return false;
}

function isHubSpotTicketPage() {
  if (!isHubSpotApp() || !/^\/help-desk\/[^/]+\/view(?:\/|$)/.test(location.pathname)) return false;
  if (/\/ticket\/\d+(?:\/|$)/.test(location.pathname)) return true;
  if (!/\/thread\/[^/]+(?:\/|$)/.test(location.pathname)) return false;
  return !!extractHubSpotTicketIdFromDom();
}

function normalizeHyperflowProtocol(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

function isHyperflowDirectChatPath() {
  return /\/chats\/\d+/.test(location.pathname || '') ||
    /\/all-chats\/\d+/.test(location.pathname || '');
}

function getActiveHyperflowDrawerRoot() {
  const candidates = Array.from(document.querySelectorAll(
    '.MuiDrawer-paperAnchorRight, [class*="MuiDrawer-paperAnchorRight"], [class*="MuiDrawer-paper"][class*="AnchorRight"]'
  ));
  const visible = candidates.filter(isElementVisible);
  return visible[visible.length - 1] || null;
}

function getHyperflowSearchRoot() {
  return getActiveHyperflowDrawerRoot() || (isHyperflowDirectChatPath() ? document : null);
}

function getHyperflowProtocolFromElement(protocolEl) {
  if (!protocolEl) return null;
  const raw =
    protocolEl.getAttribute('aria-label')?.trim() ||
    protocolEl.innerText?.trim() ||
    protocolEl.textContent?.trim() ||
    '';
  return normalizeHyperflowProtocol(raw);
}

function getHyperflowProtocolElements(root = document, expectedProtocol = null) {
  const elements = Array.from(root.querySelectorAll('span.chat-protocol, .chat-protocol'));
  const matching = elements.filter(el => {
    const protocol = getHyperflowProtocolFromElement(el);
    return protocol && (!expectedProtocol || protocol === expectedProtocol);
  });
  const visible = matching.filter(isElementVisible);
  return visible.length ? visible : matching;
}

function rootHasHyperflowEmailLabel(root) {
  if (!root?.querySelectorAll) return false;
  return Array.from(root.querySelectorAll('span.MuiTypography-caption, span'))
    .some(label => /^e-mail\s*:/i.test((label.innerText || label.textContent || '').trim()));
}

function getHyperflowInfoRootForProtocolEl(protocolEl) {
  if (!protocolEl) return null;
  let node = protocolEl.parentElement;
  while (node && node !== document.body) {
    if (rootHasHyperflowEmailLabel(node)) return node;
    node = node.parentElement;
  }
  return protocolEl.closest?.('.MuiDrawer-paperAnchorRight, [class*="MuiDrawer-paperAnchorRight"], [class*="MuiDrawer-paper"][class*="AnchorRight"]') ||
    (isHyperflowDirectChatPath() ? document : null);
}

function getHyperflowRootsForProtocol(expectedProtocol) {
  const roots = [];
  const seen = new Set();
  const protocolEls = getHyperflowProtocolElements(document, expectedProtocol);
  for (const protocolEl of protocolEls) {
    const root = getHyperflowInfoRootForProtocolEl(protocolEl);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function getActiveHyperflowProtocolElement() {
  const root = getHyperflowSearchRoot();
  if (!root) return null;

  const headerCandidates = getHyperflowProtocolElements(root)
    .filter(el => !!el.closest('.chat-header-contact'));
  const visibleHeader = headerCandidates.filter(isElementVisible);
  if (visibleHeader.length) return visibleHeader[visibleHeader.length - 1];

  const genericCandidates = getHyperflowProtocolElements(root);
  const visibleGeneric = genericCandidates.filter(isElementVisible);
  if (visibleGeneric.length) return visibleGeneric[visibleGeneric.length - 1];

  return headerCandidates[0] || genericCandidates[0] || null;
}

function extractHyperflowTicketIdFromDom() {
  const protocolEl = getActiveHyperflowProtocolElement();
  return getHyperflowProtocolFromElement(protocolEl);
}

function extractHyperflowTicketIdFromPath() {
  const path = location.pathname || '';
  const direct =
    path.match(/\/chats\/(\d+)/)?.[1] ||
    path.match(/\/all-chats\/(\d+)/)?.[1] ||
    null;
  return normalizeHyperflowProtocol(direct);
}

function isHyperflowTicketPage() {
  if (!isHyperflow()) return false;
  if (extractHyperflowTicketIdFromPath()) return true;
  return !!getActiveHyperflowDrawerRoot() && !!extractHyperflowTicketIdFromDom();
}

function isTicketPage() {
  if (isHubSpot())   return isHubSpotTicketPage();
  if (isHyperflow()) return isHyperflowTicketPage();
  return false;
}

function extractTicketId() {
  if (isHubSpot()) {
    if (!isHubSpotTicketPage()) return null;
    const fromUrl = extractHubSpotTicketIdFromText(location.href);
    const fromDom = extractHubSpotTicketIdFromDom();
    if (fromUrl && fromDom && fromUrl !== fromDom && isTrustedHubSpotUrlTicket(fromUrl)) return fromUrl;
    if (fromDom) return fromDom;
    return fromUrl;
  }
  if (isHyperflow()) {
    const fromPath = extractHyperflowTicketIdFromPath();
    if (fromPath) return fromPath;
    const fromDom = extractHyperflowTicketIdFromDom();
    if (fromDom) return fromDom;
    if (!isHyperflowTicketPage()) return null;
    return null;
  }
  return null;
}

function setPendingHubSpotTicket(ticketId) {
  pendingHubSpotTicketId = ticketId || null;
  pendingHubSpotTicketStartedAt = pendingHubSpotTicketId ? Date.now() : 0;
}

function clearPendingHubSpotTicket() {
  pendingHubSpotTicketId = null;
  pendingHubSpotTicketStartedAt = 0;
  clearTicketTransitionRetryTimers();
}

function getPendingHubSpotTicket() {
  if (!pendingHubSpotTicketId) return null;
  if (Date.now() - pendingHubSpotTicketStartedAt > 5000) {
    clearPendingHubSpotTicket();
    return null;
  }
  return pendingHubSpotTicketId;
}

function getPendingHubSpotTicketAgeMs(ticketId = null) {
  if (!pendingHubSpotTicketId) return 0;
  if (ticketId && pendingHubSpotTicketId !== ticketId) return 0;
  return Date.now() - pendingHubSpotTicketStartedAt;
}

function shouldTrustHubSpotUrlTicket(ticketId, fromDom = null) {
  if (!ticketId) return false;
  const fromUrl = extractHubSpotTicketIdFromText(location.href);
  if (fromUrl !== ticketId) return false;
  if (!hasHubSpotTicketShell()) return false;
  if (fromDom === ticketId) return true;
  return getPendingHubSpotTicketAgeMs(ticketId) >= 850;
}

function getHubSpotTicketTransitionState() {
  if (!isHubSpotTicketPage()) return { ticketId: null, waitForDom: false };

  const fromUrl = extractHubSpotTicketIdFromText(location.href);
  const fromDom = extractHubSpotTicketIdFromDom();
  const pendingTicketId = getPendingHubSpotTicket();

  if (pendingTicketId) {
    if (fromDom === pendingTicketId) {
      clearPendingHubSpotTicket();
      clearTrustedHubSpotUrlTicket();
      return { ticketId: pendingTicketId, waitForDom: false };
    }
    if (fromUrl && fromUrl !== pendingTicketId && fromDom === fromUrl) {
      clearPendingHubSpotTicket();
      clearTrustedHubSpotUrlTicket();
      return { ticketId: fromDom, waitForDom: false };
    }
    if (shouldTrustHubSpotUrlTicket(pendingTicketId, fromDom)) {
      clearPendingHubSpotTicket();
      markTrustedHubSpotUrlTicket(pendingTicketId);
      return { ticketId: pendingTicketId, waitForDom: false };
    }
    return { ticketId: pendingTicketId, waitForDom: true };
  }

  if (fromUrl && fromUrl !== currentTicketId) {
    if (!fromDom) {
      setPendingHubSpotTicket(fromUrl);
      return { ticketId: fromUrl, waitForDom: true };
    }
    if (fromDom === fromUrl) {
      clearTrustedHubSpotUrlTicket();
      return { ticketId: fromUrl, waitForDom: false };
    }
    if (fromDom === currentTicketId) {
      setPendingHubSpotTicket(fromUrl);
      return { ticketId: fromUrl, waitForDom: true };
    }
    setPendingHubSpotTicket(fromUrl);
    return { ticketId: fromUrl, waitForDom: true };
  }

  if (fromUrl && fromDom && fromDom !== fromUrl && fromUrl === currentTicketId && !currentProcessId) {
    setPendingHubSpotTicket(fromUrl);
    return { ticketId: fromUrl, waitForDom: true };
  }

  if (fromUrl && fromDom && fromDom !== fromUrl) {
    if (isTrustedHubSpotUrlTicket(fromUrl)) return { ticketId: fromUrl, waitForDom: false };
    setPendingHubSpotTicket(fromUrl);
    return { ticketId: fromUrl, waitForDom: true };
  }
  if (fromDom) return { ticketId: fromDom, waitForDom: false };
  if (fromUrl) {
    setPendingHubSpotTicket(fromUrl);
    return { ticketId: fromUrl, waitForDom: true };
  }
  return { ticketId: null, waitForDom: false };
}

function getCurrentTicketTransitionState() {
  if (isHubSpot()) return getHubSpotTicketTransitionState();
  const ticketId = extractTicketId();
  return { ticketId, waitForDom: false };
}

function clearTicketTransitionRetryTimers() {
  for (const timerId of ticketTransitionRetryTimers) clearTimeout(timerId);
  ticketTransitionRetryTimers = [];
}

function clearTicketExtractionNudgeTimer() {
  if (ticketExtractionNudgeTimer) {
    clearTimeout(ticketExtractionNudgeTimer);
    ticketExtractionNudgeTimer = null;
  }
}

function scheduleTicketTransitionRetry() {
  clearTicketTransitionRetryTimers();
  ticketTransitionRetryTimers = [120, 360, 900, 1500, 2400].map(delay =>
    setTimeout(() => {
      if (enabled && popup) onPageChange();
    }, delay)
  );
}

function scheduleTicketExtractionNudge(ticketId) {
  clearTicketExtractionNudgeTimer();
  if (!ticketId) return;

  ticketExtractionNudgeTimer = setTimeout(() => {
    ticketExtractionNudgeTimer = null;
    if (!enabled || !popup) return;
    if (!isTicketPage()) return;
    if (currentTicketId !== ticketId || currentProcessId) return;

    const { ticketId: observedTicketId, waitForDom } = getCurrentTicketTransitionState();
    if (observedTicketId !== ticketId) return;

    if (waitForDom) {
      if (isHubSpot() && shouldTrustHubSpotUrlTicket(ticketId, extractHubSpotTicketIdFromDom())) {
        clearPendingHubSpotTicket();
        markTrustedHubSpotUrlTicket(ticketId);
        enterTicket(ticketId, true);
        return;
      }
      scheduleTicketTransitionRetry();
      scheduleTicketExtractionNudge(ticketId);
      return;
    }

    enterTicket(ticketId, true);
  }, 1250);
}





chrome.storage.local.get(['enabled', ...(isHubSpotApp() ? getPopupPositionStorageKeys() : [])], (data) => {
  enabled = data?.enabled === true;
  bootstrapPopupPositionData = enabled && isHubSpotApp() ? data : null;
  if (enabled && isHubSpotApp() && !document.body) requestPopupOwnerState();
  init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if ('popupPosition_hubspot' in changes && isHubSpotApp() && popup && !popupDragging) {
    popupHasStoredPosition = hasPopupPosition(changes.popupPosition_hubspot.newValue);
    applyPopupPosition(popupHasStoredPosition ? changes.popupPosition_hubspot.newValue : null,
      popupHasStoredPosition && document.hasFocus());
  }
  if (bootstrapPopupPositionData && 'popupPosition_hubspot' in changes) {
    bootstrapPopupPositionData.popupPosition_hubspot = changes.popupPosition_hubspot.newValue;
  }

  if (!('enabled' in changes)) return;
  enabled = !!changes.enabled.newValue;
  if (!enabled) {
    resumeValidationPending = false;
    resumeValidationComplete = false;
    clearTimeout(extractionTimer);
    clearTicketTransitionRetryTimers();
    clearTicketExtractionNudgeTimer();
    clearPendingHubSpotTicket();
    teardown();
    return;
  }
  resumeValidationPending = !resumeValidationComplete && document.hasFocus() && document.visibilityState !== 'hidden';
  init(false, !resumeValidationPending);
});

function init(forceFocusedTicket = true, startFocusedTicket = true) {
  if (!enabled) {
    teardown();
    return;
  }


  if (!isValidDomain()) return;
  waitForBody(() => {
    if (!enabled) return;

    injectStyles();
    if (!popup) createPopup();
    requestPopupOwnerState();
    startUrlObserver();
    if (isHyperflow()) startHyperflowListClickObserver();
    if (isHubSpot()) startHubSpotTicketClickObserver();
    applyPopupVisibility();
    if (enabled && document.hasFocus()) {
      if (startFocusedTicket) onFocusGained(forceFocusedTicket);
      else if (!resumeValidationPending) onFocusGained(false);
    }
  });
}

function teardown() {

  clearCopyFeedback();
  clearHubSpotAccountCardOrder();
  popup?.remove();
  popup = null;
  popupDragging = false;
  popupPositionReady = false;
  popupOwnerStateResolved = false;
  popupOwnerRequestId++;
  popupHasStoredPosition = false;
  urlObserver?.disconnect();
  urlObserver = null;
  if (urlPollTimer) {
    clearInterval(urlPollTimer);
    urlPollTimer = null;
  }
  if (routeCheckTimer) {
    clearTimeout(routeCheckTimer);
    routeCheckTimer = null;
  }
  if (routeEventHandler) {
    window.removeEventListener('popstate', routeEventHandler);
    window.removeEventListener('hashchange', routeEventHandler);
    window.removeEventListener('ticket-helper-route-change', routeEventHandler);
    routeEventHandler = null;
  }
  if (historyHooksInstalled) {
    if (history.pushState === ticketHelperPushStateWrapper) history.pushState = originalHistoryPushState;
    if (history.replaceState === ticketHelperReplaceStateWrapper) history.replaceState = originalHistoryReplaceState;
    originalHistoryPushState = null;
    originalHistoryReplaceState = null;
    ticketHelperPushStateWrapper = null;
    ticketHelperReplaceStateWrapper = null;
    historyHooksInstalled = false;
  }
  if (hyperflowListClickHandler) {
    document.removeEventListener('click', hyperflowListClickHandler, true);
    hyperflowListClickHandler = null;
  }
  if (hubspotTicketClickHandler) {
    document.removeEventListener('click', hubspotTicketClickHandler, true);
    hubspotTicketClickHandler = null;
  }
  clearTicketTransitionRetryTimers();
  clearTicketExtractionNudgeTimer();
  clearTimeout(extractionTimer);
  resetProcess();
}

function resetProcess() {
  stopHubSpotSidebarWatch();
  stopHubSpotAccountWatch();
  if (hubSpotAccountResult?.retryTimer) clearTimeout(hubSpotAccountResult.retryTimer);
  hubSpotAccountResult = null;
  localTicketGeneration++;
  currentProcessId = null;
  currentTicketId  = null;
  emailSent        = false;
  nameSent         = false;
  hoverAttempted   = false;
  lastFaturasRefreshTicketId = null;
  localData = { id: null, name: null, email: null, doc: null, accounts: null };
  pendingPopupUpdates = {};
  clearTrustedHubSpotUrlTicket();
}

function startUrlObserver() {
  if (urlObserver) return;

  const checkRouteChange = () => {
    routeCheckTimer = null;
    if (!popup) return;

    let changed = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      changed = true;
    }

    if (!enabled) {
      applyPopupVisibility();
      return;
    }

    // Only the focused tab can own the current ticket. Background tabs still
    // track their URL, but should not repeatedly inspect HubSpot's DOM.
    if (!document.hasFocus()) return;

    const pendingHubSpotTicket = isHubSpot() ? getPendingHubSpotTicket() : null;
    if (pendingHubSpotTicket) {
      const domTicketId = extractHubSpotTicketIdFromDom();
      if (domTicketId === pendingHubSpotTicket) changed = true;
    } else {
      const observedTicketId = extractTicketId();
      if (observedTicketId !== currentTicketId) changed = true;
    }

    if (changed) onPageChange();
  };

  const scheduleRouteCheck = (delay = 0) => {
    if (routeCheckTimer) {
      if (delay) return;
      clearTimeout(routeCheckTimer);
    }
    routeCheckTimer = setTimeout(checkRouteChange, delay);
  };

  if (!historyHooksInstalled) {
    originalHistoryPushState = history.pushState;
    originalHistoryReplaceState = history.replaceState;
    ticketHelperPushStateWrapper = function (...args) {
      const result = originalHistoryPushState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };
    ticketHelperReplaceStateWrapper = function (...args) {
      const result = originalHistoryReplaceState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };
    history.pushState = ticketHelperPushStateWrapper;
    history.replaceState = ticketHelperReplaceStateWrapper;

    historyHooksInstalled = true;
  }

  routeEventHandler = () => scheduleRouteCheck(0);
  window.addEventListener('popstate', routeEventHandler);
  window.addEventListener('hashchange', routeEventHandler);
  window.addEventListener('ticket-helper-route-change', routeEventHandler);

  urlObserver = new MutationObserver((records) => {
    if (!document.hasFocus()) return;
    if (records.every(record => popup?.contains(record.target))) return;
    scheduleRouteCheck(120);
  });
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });

  if (!urlPollTimer) {
    urlPollTimer = setInterval(checkRouteChange, 700);
  }
}

function findHyperflowListRowFromTarget(target) {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const hasCopyProtocol = !!node.querySelector?.('[aria-label="Copy protocol"]');
    const hasContactHint = !!node.querySelector?.('[aria-label="Filter by contact"]');
    if (hasCopyProtocol && hasContactHint) return node;
    node = node.parentElement;
  }
  return null;
}

function extractProtocolFromHyperflowListRow(rowEl) {
  if (!rowEl) return null;
  const copyBlock = rowEl.querySelector('[aria-label="Copy protocol"]');
  if (!copyBlock) return null;
  const raw = copyBlock.innerText || '';
  return normalizeHyperflowProtocol(raw);
}

function startHyperflowListClickObserver() {
  if (hyperflowListClickHandler) return;
  hyperflowListClickHandler = (event) => {
    if (!enabled || !popup || !isHyperflow()) return;
    if (!isPrimaryPlainClick(event)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const nudgeHyperflowCheck = (delays = [30, 80, 160, 320, 700, 1300]) => {
      for (const delay of delays) {
        setTimeout(() => { if (enabled && popup) onPageChange(); }, delay);
      }
    };

    const chatRow = findHyperflowListRowFromTarget(target);
    if (!chatRow) {
      if (/\/all-chats(?:\/|$)/.test(location.pathname || '')) nudgeHyperflowCheck();
      return;
    }
    const clickedProtocol = extractProtocolFromHyperflowListRow(chatRow);



    if (clickedProtocol) {
      setTimeout(() => {
        if (!enabled || !popup) return;
        primeTicketSwitch(clickedProtocol);
        enterTicket(clickedProtocol);
      }, 30);
    }
    nudgeHyperflowCheck([45, 120, 260, 600]);
  };

  document.addEventListener('click', hyperflowListClickHandler, true);
}

function isPrimaryPlainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function startHubSpotTicketClickObserver() {
  if (hubspotTicketClickHandler) return;
  hubspotTicketClickHandler = (event) => {
    if (!enabled || !popup || !isHubSpot()) return;
    if (!(event.target instanceof Element)) return;
    if (!isPrimaryPlainClick(event)) return;
    if (event.target.closest('#ticket-helper-popup')) return;

    const nudgePageChange = () => {
      for (const delay of [60, 200, 450, 900, 1500, 2400]) {
        setTimeout(() => { if (enabled && popup) onPageChange(); }, delay);
      }
    };

    const link = event.target.closest('a[href]');
    if (!link) {
      nudgePageChange();
      return;
    }
    const clickedTicketId = extractHubSpotTicketIdFromHref(link.href);
    if (!clickedTicketId) {
      nudgePageChange();
      return;
    }

    setTimeout(() => {
      if (!enabled || !popup) return;
      const domTicketId = extractHubSpotTicketIdFromDom();
      const urlTicketId = extractHubSpotTicketIdFromText(location.href);
      const shouldTrustClicked =
        !domTicketId ||
        domTicketId === currentTicketId ||
        urlTicketId === clickedTicketId;
      const settledTicketId = shouldTrustClicked ? clickedTicketId : domTicketId;
      primeTicketSwitch(settledTicketId);
      if (domTicketId === settledTicketId) {
        clearPendingHubSpotTicket();
        enterTicket(settledTicketId);
      } else {
        setPendingHubSpotTicket(settledTicketId);
        scheduleTicketTransitionRetry();
      }
    }, 30);
    nudgePageChange();
  };

  document.addEventListener('click', hubspotTicketClickHandler, true);
}

window.addEventListener('focus', () => {
  if (!enabled || !popup) return;
  if (isHubSpotApp() && popupPositionReady) restoreOrClampPopupPosition();
  requestPopupOwnerState();
  applyPopupVisibility();
  setTimeout(onFocusGained, 150);
});

document.addEventListener('visibilitychange', () => {
  if (!enabled || !popup) return;
  if (document.visibilityState === 'hidden') {
    clearCopyFeedback();
    applyPopupVisibility();
    return;
  }
  requestPopupOwnerState();
  if (document.visibilityState === 'visible') setTimeout(onFocusGained, 150);
  if (document.visibilityState === 'visible' && isHubSpotApp() && popupPositionReady) restoreOrClampPopupPosition();
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (popupPositionReady) restoreOrClampPopupPosition();
    renderPopup();
  }, 120);
});

function primeTicketSwitch(ticketId) {
  if (!ticketId) return;
  if (ticketId === currentTicketId) return;

  resetProcess();
  currentTicketId = ticketId;
  localData.id = ticketId;
  renderPopup();
  if (isHubSpot()) {
    startHubSpotSidebarWatch(ticketId);
  }
  scheduleTicketExtractionNudge(ticketId);
}

function hasPendingGatherFields() {
  return localData.name === null || localData.email === null || localData.doc === null || localData.accounts === null;
}






function onPageChange() {

  if (!popup) return;
  if (resumeValidationPending || !document.hasFocus()) return;
  if (!enabled) {
    if (!isTicketPage()) resetProcess();
    applyPopupVisibility();
    return;
  }
  if (!isTicketPage()) {
    applyPopupVisibility();
    leaveTicket();
    return;
  }
  applyPopupVisibility();
  const { ticketId, waitForDom } = getCurrentTicketTransitionState();
  if (!ticketId) { leaveTicket(); return; }

  if (waitForDom) {
    primeTicketSwitch(ticketId);
    scheduleTicketTransitionRetry();
    return;
  }

  if (ticketId === currentTicketId && currentProcessId) {
    if (hasPendingGatherFields()) {
      enterTicket(ticketId);
    }
    return;
  }
  primeTicketSwitch(ticketId);
  enterTicket(ticketId);
}



function onFocusGained(force = false) {
  if (!popup) return;
  if (document.visibilityState === 'hidden') return;
  if (resumeValidationPending) return;
  if (!enabled) {
    applyPopupVisibility();
    return;
  }
  if (!isTicketPage()) {
    applyPopupVisibility();
    leaveTicket();
    return;
  }
  applyPopupVisibility();
  const { ticketId, waitForDom } = getCurrentTicketTransitionState();
  if (!ticketId) { leaveTicket(); return; }
  if (waitForDom) {
    primeTicketSwitch(ticketId);
    scheduleTicketTransitionRetry();
    return;
  }
  if (force || ticketId !== currentTicketId) {
    primeTicketSwitch(ticketId);
  }
  enterTicket(ticketId, force);
}

function leaveTicket() {
  clearTimeout(extractionTimer);
  clearPendingHubSpotTicket();
  const hadCurrentTicket = !!currentTicketId;
  const exitedTicketId = currentTicketId;
  const exitedProcessId = currentProcessId;
  resetProcess();
  renderPopup();
  if (hadCurrentTicket) {
    msgBg({ action: 'TICKET_EXITED', ticketId: exitedTicketId, processId: exitedProcessId }).then(() => {
      if (historyViewOpen) refreshHistoryView();
    });
  }
}





async function enterTicket(ticketId, force = false) {



  if (force || ticketId !== currentTicketId || !currentProcessId) {
    clearTimeout(extractionTimer);
  }

  const startedGeneration = localTicketGeneration;
  const resp = await msgBg({ action: 'TICKET_DETECTED', ticketId, forceNew: force });
  if (!enabled || !popup || startedGeneration !== localTicketGeneration ||
      currentTicketId !== ticketId || !isTicketPage()) return;
  if (!resp?.processId) {
    if (resp?.deferred) {
      setTimeout(() => {
        if (enabled && popup) onFocusGained();
      }, 180);
    }
    return;
  }




  const observedTicketId = extractTicketId();
  if (observedTicketId && observedTicketId !== ticketId) {
    setTimeout(() => {
      if (enabled && popup) onPageChange();
    }, 120);
    return;
  }


  if (resp.reuse && !force) {
    if (resp.data?.id && String(resp.data.id) !== String(ticketId)) {
      setTimeout(() => {
        if (enabled && popup) enterTicket(ticketId, true);
      }, 60);
      return;
    }

    const sameFrozenTicket = String(currentTicketId || '') === String(ticketId);
    const frozenData = sameFrozenTicket ? { ...localData } : {};
    const preserveFrozenValue = (value) => value !== null && value !== undefined && value !== '...';
    currentTicketId  = ticketId;
    currentProcessId = resp.processId;
    clearTicketExtractionNudgeTimer();

    if (resp.data) {
      localData = {
        id:       sameFrozenTicket && preserveFrozenValue(frozenData.id) ? frozenData.id : (resp.data.id ?? ticketId),
        name:     sameFrozenTicket && preserveFrozenValue(frozenData.name) ? frozenData.name : (resp.data.name ?? null),
        email:    sameFrozenTicket && preserveFrozenValue(frozenData.email) ? frozenData.email : (resp.data.email ?? null),
        doc:      normalizeCachedHubSpotDoc(isFinalRequesterLookupDoc(resp.data.doc)
          ? resp.data.doc : sameFrozenTicket && preserveFrozenValue(frozenData.doc)
            ? frozenData.doc : (resp.data.doc ?? null)),
        accounts: sameFrozenTicket && preserveFrozenValue(frozenData.accounts) ? frozenData.accounts : (resp.data.accounts ?? null)
      };
      renderPopup();
    }
    requestAutoFaturasRefreshOnTicketSwitch(ticketId, resp.processId);
    if (isHubSpot() && !isFinalRequesterLookupDoc(localData.doc)) {
      extractHubSpot(resp.processId, ticketId);
    }
    else if (hasPendingGatherFields() && isHyperflow()) extractHyperflow(resp.processId, ticketId);
    if (historyViewOpen && historyViewTicketId !== ticketId) refreshHistoryView();
    return;
  }


  const keepTrustedHubSpotUrl =
    isHubSpot() &&
    isTrustedHubSpotUrlTicket(ticketId) &&
    extractHubSpotTicketIdFromText(location.href) === ticketId;

  const keepEarlySidebarRead = isHubSpot() && currentTicketId === ticketId && !currentProcessId &&
    (hubSpotSidebarWatch?.generation === localTicketGeneration ||
     hubSpotAccountWatch?.generation === localTicketGeneration ||
     hubSpotAccountResult?.generation === localTicketGeneration);
  if (!keepEarlySidebarRead) resetProcess();
  if (keepTrustedHubSpotUrl) markTrustedHubSpotUrlTicket(ticketId);
  currentTicketId  = ticketId;
  localData.id     = ticketId;
  currentProcessId = resp.processId;
  clearTicketExtractionNudgeTimer();
  lastFaturasRefreshTicketId = ticketId;
  renderPopup();



  const buffered = pendingPopupUpdates[currentProcessId];
  if (buffered?.length) {
    for (const fields of buffered) applyPopupFields(fields);
    renderPopup();
  }
  delete pendingPopupUpdates[currentProcessId];

  if (isHubSpot())   extractHubSpot(resp.processId, ticketId);
  if (isHyperflow()) extractHyperflow(resp.processId, ticketId);
  if (historyViewOpen && historyViewTicketId !== ticketId) refreshHistoryView();
}

function requestAutoFaturasRefreshOnTicketSwitch(ticketId, processId) {
  if (!ticketId) return;
  if (lastFaturasRefreshTicketId === ticketId) return;
  lastFaturasRefreshTicketId = ticketId;
  msgBg({ action: 'SYNC_ACTIVE_TICKET_CONTEXT', processId });
}


















function findMatchingHubSpotHeader(ticketId) {
  if (!isHubSpotTicketPage()) return null;
  const urlTicketId = extractHubSpotTicketIdFromText(location.href);
  if (urlTicketId !== ticketId) return null;

  const headers = document.querySelectorAll('[data-component-name="TicketHeader"]');
  for (let index = headers.length - 1; index >= 0; index--) {
    const header = headers[index];
    if (!isElementVisible(header)) continue;
    const displayedId = header.querySelector('[data-test-id="ticket-header-ticket-id"]')
      ?.textContent?.match(/\d+/)?.[0] || null;
    const titleHref = header.querySelector('[data-test-id="ticket-header-name-link"] a[href]')
      ?.getAttribute('href') || '';
    const linkedId = extractHubSpotTicketIdFromHref(titleHref);
    if (displayedId && displayedId !== ticketId) continue;
    if (linkedId && linkedId !== ticketId) continue;
    if (displayedId !== ticketId && linkedId !== ticketId) continue;
    return header;
  }
  return null;
}

function stopHubSpotSidebarWatch() {
  const watch = hubSpotSidebarWatch;
  if (!watch) return;
  watch.observer?.disconnect();
  watch.sectionObserver?.disconnect();
  clearTimeout(watch.retryId);
  clearTimeout(watch.timeoutId);
  clearTimeout(watch.warmupId);
  for (const frameId of watch.frameIds) cancelAnimationFrame(frameId);
  watch.restoreScroll?.();
  if (watch.scroller) {
    if (watch.scrollBehaviorValue) {
      watch.scroller.style.setProperty('scroll-behavior', watch.scrollBehaviorValue,
        watch.scrollBehaviorPriority);
    } else {
      watch.scroller.style.removeProperty('scroll-behavior');
    }
  }
  hubSpotSidebarWatch = null;
}

function getVisibleHubSpotSidebarWrapper() {
  return Array.from(document.querySelectorAll(
    '[data-onboarding="help-desk-ticket-sidebar-wrapper"]'
  )).find(isElementVisible) || null;
}

function getVisibleHubSpotSidebar() {
  const wrapper = getVisibleHubSpotSidebarWrapper();
  if (!wrapper) return null;
  return Array.from(wrapper.querySelectorAll('[data-test-id="help-desk-ticket-sidebar"]'))
    .find(isElementVisible) || null;
}

function getHubSpotSidebarCard(sidebar, name) {
  const details = sidebar.querySelector('[data-test-id="tab-0-content"]');
  if (!details) return null;
  if (name === 'Other tickets') {
    const card = details.querySelector('[data-test-id="card-wrapper-OTHER_TICKETS/0"]');
    if (!card) return null;
    const title = card.querySelector('[data-selenium-test="crm-card-title"]')
      ?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const countMatch = title.match(/\(\s*(\d+)\s*\)\s*$/);
    return { card, title, count: countMatch ? Number(countMatch[1]) : null };
  }
  for (const card of details.querySelectorAll('[data-test-id^="card-wrapper-"]')) {
    if (name === 'Requerente' &&
        card.getAttribute('data-test-id') !== 'card-wrapper-ASSOCIATION_V3/0-1') continue;
    const title = card.querySelector('[data-selenium-test="crm-card-title"]')
      ?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const countMatch = title.match(/^(.+?)\s*\((\d+)\)$/);
    if (name === 'Requerente' || title === name || countMatch?.[1] === name) {
      return { card, title, count: countMatch ? Number(countMatch[2]) : null };
    }
  }
  return null;
}

function getHubSpotEduzzAccountsShell(sidebar) {
  return getHubSpotSidebarCard(sidebar, 'Contas Eduzz');
}

function getHubSpotRequesterShell(sidebar) {
  return getHubSpotSidebarCard(sidebar, 'Requerente');
}

function getHubSpotOtherTicketsShell(sidebar) {
  return getHubSpotSidebarCard(sidebar, 'Other tickets');
}

function getHubSpotAboutTicketShell(sidebar) {
  return sidebar.querySelector(
    '[data-test-id="tab-0-content"] [data-card-id="PROPERTIES_V3/0-5/HELPDESK_SIDEBAR"]'
  )?.closest('[data-test-id^="card-wrapper-"]') || null;
}

function clearHubSpotAccountCardOrder() {
  for (const list of hubSpotPinnedSidebarLists) {
    list.removeAttribute('data-ticket-helper-priority-list');
    for (const item of list.children) {
      item.removeAttribute('data-ticket-helper-other-first');
      item.removeAttribute('data-ticket-helper-about-second');
      item.removeAttribute('data-ticket-helper-account-third');
      item.removeAttribute('data-ticket-helper-requester-fourth');
    }
  }
  hubSpotPinnedSidebarLists.clear();
}

function keepHubSpotPriorityCardsFirst(sidebar) {
  const otherItem = getHubSpotOtherTicketsShell(sidebar)?.card.parentElement;
  const aboutItem = getHubSpotAboutTicketShell(sidebar)?.parentElement;
  const accountItem = getHubSpotEduzzAccountsShell(sidebar)?.card.parentElement;
  const requesterItem = getHubSpotRequesterShell(sidebar)?.card.parentElement;
  const list = aboutItem?.parentElement;
  if (!list?.matches('[data-test-id="UIDragList:FlipMove"]')) return;
  if ((otherItem && otherItem.parentElement !== list) ||
      (accountItem && accountItem.parentElement !== list) ||
      (requesterItem && requesterItem.parentElement !== list)) return;
  if (hubSpotPinnedSidebarLists.has(list) &&
      list.hasAttribute('data-ticket-helper-priority-list') &&
      (!otherItem || otherItem.hasAttribute('data-ticket-helper-other-first')) &&
      aboutItem.hasAttribute('data-ticket-helper-about-second') &&
      (!accountItem || accountItem.hasAttribute('data-ticket-helper-account-third')) &&
      (!requesterItem || requesterItem.hasAttribute('data-ticket-helper-requester-fourth'))) return;

  for (const oldList of hubSpotPinnedSidebarLists) {
    if (oldList === list) continue;
    oldList.removeAttribute('data-ticket-helper-priority-list');
    for (const oldItem of oldList.children) {
      oldItem.removeAttribute('data-ticket-helper-other-first');
      oldItem.removeAttribute('data-ticket-helper-about-second');
      oldItem.removeAttribute('data-ticket-helper-account-third');
      oldItem.removeAttribute('data-ticket-helper-requester-fourth');
    }
    hubSpotPinnedSidebarLists.delete(oldList);
  }
  for (const sibling of list.children) {
    if (sibling !== otherItem) sibling.removeAttribute('data-ticket-helper-other-first');
    if (sibling !== aboutItem) sibling.removeAttribute('data-ticket-helper-about-second');
    if (sibling !== accountItem) sibling.removeAttribute('data-ticket-helper-account-third');
    if (sibling !== requesterItem) sibling.removeAttribute('data-ticket-helper-requester-fourth');
  }
  list.setAttribute('data-ticket-helper-priority-list', '');
  if (otherItem) otherItem.setAttribute('data-ticket-helper-other-first', '');
  aboutItem.setAttribute('data-ticket-helper-about-second', '');
  if (accountItem) accountItem.setAttribute('data-ticket-helper-account-third', '');
  if (requesterItem) requesterItem.setAttribute('data-ticket-helper-requester-fourth', '');
  hubSpotPinnedSidebarLists.add(list);
}

function isHubSpotDetailsContentReady(sidebar) {
  const aboutCard = getHubSpotAboutTicketShell(sidebar)?.querySelector(
    '[data-transitional-component="ExpandableSection"]'
  );
  if (!aboutCard) return false;
  if (aboutCard.getAttribute('data-selenium-expanded') === 'false') return true;
  return !!aboutCard.querySelector('[data-open-complete="true"]');
}

function getHubSpotSidebarLoadTarget(section) {
  return section.card.querySelector('[data-test-id$="-loading"]') || section.card;
}

function isHubSpotSidebarCardReady(sidebar, name) {
  const section = getHubSpotSidebarCard(sidebar, name);
  if (!section || section.count === null) return false;
  const collapsed = !!section.card.querySelector(
    '[data-transitional-component="Clickable"][aria-expanded="false"]'
  );
  if (name === 'Other tickets') {
    if (collapsed) return false;
    if (section.count === 0) return true;
    return section.card.querySelectorAll(
      '[data-test-id="contact-ticket-tile"]'
    ).length >= section.count;
  }
  if (collapsed) return false;
  if (section.count === 0) return true;
  return section.card.querySelectorAll('[data-selenium-test="chicklet"]').length >= section.count;
}

function isHubSpotAccountSectionReady(sidebar) {
  return isHubSpotSidebarCardReady(sidebar, 'Contas Eduzz');
}

function startHubSpotSidebarWatch(ticketId) {
  if (!isHubSpot() || !ticketId) return;
  if (hubSpotSidebarWatch?.ticketId === ticketId &&
      hubSpotSidebarWatch.generation === localTicketGeneration) return;
  stopHubSpotSidebarWatch();

  const watch = {
    ticketId,
    generation: localTicketGeneration,
    observer: null,
    sectionObserver: null,
    sectionCard: null,
    sectionCheckQueued: false,
    retryId: null,
    retryKind: null,
    timeoutId: null,
    warmupId: null,
    clicks: 0,
    tabClicks: 0,
    aboutExpandClicks: 0,
    lastAboutExpandAt: 0,
    lastOtherTicketsToggleAt: 0,
    frameIds: [],
    scroller: null,
    scrollBehaviorValue: '',
    scrollBehaviorPriority: '',
    restoreScroll: null,
    scrolling: false,
    checkQueued: false
  };
  hubSpotSidebarWatch = watch;

  const isCurrent = () => hubSpotSidebarWatch === watch && enabled &&
    watch.generation === localTicketGeneration && currentTicketId === ticketId &&
    extractHubSpotTicketIdFromText(location.href) === ticketId &&
    document.visibilityState !== 'hidden';
  const queueFrame = (callback) => {
    const frameId = requestAnimationFrame(() => {
      watch.frameIds = watch.frameIds.filter(id => id !== frameId);
      callback();
    });
    watch.frameIds.push(frameId);
  };
  const warmDetails = (sidebar) => {
    if (watch.scrolling) return;
    if (!isHubSpotDetailsContentReady(sidebar)) {
      if (!watch.warmupId) {
        watch.warmupId = setTimeout(() => {
          watch.warmupId = null;
          check();
        }, 120);
      }
      return;
    }
    if (isHubSpotAccountSectionReady(sidebar) &&
        isHubSpotSidebarCardReady(sidebar, 'Requerente') &&
        isHubSpotSidebarCardReady(sidebar, 'Other tickets')) {
      stopHubSpotSidebarWatch();
      return;
    }
    watch.scrolling = true;
    queueFrame(() => {
      if (!isCurrent()) {
        stopHubSpotSidebarWatch();
        return;
      }
      if (!sidebar.isConnected || !findMatchingHubSpotHeader(ticketId) ||
          !isHubSpotDetailsContentReady(sidebar)) {
        watch.scrolling = false;
        check();
        return;
      }
      const scrollPositions = new Map();
      const captureScrollAncestors = (card) => {
        for (let node = card.parentElement; node; node = node.parentElement) {
          if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 &&
              !scrollPositions.has(node)) scrollPositions.set(node, node.scrollTop);
        }
      };
      watch.restoreScroll = () => {
        for (const [node, originalTop] of scrollPositions) {
          if (!node.isConnected) continue;
          const top = sidebar.contains(node) || node === sidebar ? 0 : originalTop;
          node.scrollTo({ top, behavior: 'instant' });
        }
        watch.restoreScroll = null;
      };
      const sections = ['Contas Eduzz', 'Requerente', 'Other tickets'];
      const visitSection = (index) => {
        if (!isCurrent() || !sidebar.isConnected) {
          stopHubSpotSidebarWatch();
          return;
        }
        if (index >= sections.length) {
          stopHubSpotSidebarWatch();
          return;
        }
        const name = sections[index];
        if (isHubSpotSidebarCardReady(sidebar, name)) {
          visitSection(index + 1);
          return;
        }
        const startedAt = Date.now();
        let lastPositionAt = 0;
        const checkSection = () => {
          if (!isCurrent() || !sidebar.isConnected) {
            stopHubSpotSidebarWatch();
            return;
          }
          const section = getHubSpotSidebarCard(sidebar, name);
          if (section) {
            if (watch.sectionCard !== section.card) {
              watch.sectionObserver?.disconnect();
              watch.sectionCard = section.card;
              watch.sectionObserver = new MutationObserver(() => {
                if (watch.sectionCheckQueued) return;
                watch.sectionCheckQueued = true;
                queueMicrotask(() => {
                  watch.sectionCheckQueued = false;
                  checkSection();
                });
              });
              watch.sectionObserver.observe(section.card, {
                childList: true, characterData: true, attributes: true,
                attributeFilter: ['aria-expanded', 'data-selenium-expanded'], subtree: true
              });
            }
            captureScrollAncestors(section.card);
            if (!lastPositionAt || Date.now() - lastPositionAt >= 800) {
              getHubSpotSidebarLoadTarget(section).scrollIntoView({
                block: 'center', inline: 'nearest', behavior: 'instant'
              });
              lastPositionAt = Date.now();
            }
            const expanded = !section.card.querySelector(
              '[data-transitional-component="Clickable"][aria-expanded="false"]'
            );
            if (name === 'Other tickets' && section.count !== null && !expanded &&
                Date.now() - watch.lastOtherTicketsToggleAt > 500) {
              const control = section.card.querySelector(
                `[data-transitional-component="Clickable"][aria-expanded="${expanded}"]`
              );
              if (control && control.getAttribute('aria-disabled') !== 'true') {
                watch.lastOtherTicketsToggleAt = Date.now();
                control.click();
              }
            }
            if (!expanded && name === 'Requerente' &&
                getHubSpotEduzzAccountsShell(sidebar)?.count === 1) {
              const control = section.card.querySelector(
                '[data-transitional-component="Clickable"][aria-expanded="false"]');
              if (control?.getAttribute('aria-disabled') !== 'true') control?.click();
            }
            const loaded = isHubSpotSidebarCardReady(sidebar, name);
            if (loaded) {
              visitSection(index + 1);
              return;
            }
          }
          if (Date.now() - startedAt >= 4000) {
            visitSection(index + 1);
            return;
          }
          clearTimeout(watch.warmupId);
          watch.warmupId = setTimeout(() => {
            watch.warmupId = null;
            checkSection();
          }, 300);
        };
        checkSection();
      };
      visitSection(0);
    });
  };
  const check = () => {
    if (!isCurrent()) {
      stopHubSpotSidebarWatch();
      return;
    }
    const sidebar = getVisibleHubSpotSidebar();
    if (sidebar) {
      if (watch.retryKind === 'toggle') {
        clearTimeout(watch.retryId);
        watch.retryId = null;
        watch.retryKind = null;
      }
      const detailsTab = sidebar.querySelector(
        '[role="navigation"][data-content="true"] [data-tab-id="0"][data-tab-link="true"]'
      );
      if (!detailsTab || !isElementVisible(detailsTab)) return;
      if (detailsTab.getAttribute('data-tab-selected') === 'true') {
        clearTimeout(watch.retryId);
        watch.retryId = null;
        watch.retryKind = null;
        if (!findMatchingHubSpotHeader(ticketId)) return;
        keepHubSpotPriorityCardsFirst(sidebar);
        const aboutExpandControl = getHubSpotAboutTicketShell(sidebar)?.querySelector(
          '[data-transitional-component="Clickable"][aria-expanded="false"]'
        );
        if (aboutExpandControl && aboutExpandControl.getAttribute('aria-disabled') !== 'true') {
          if (watch.aboutExpandClicks < 3 && Date.now() - watch.lastAboutExpandAt > 400) {
            watch.aboutExpandClicks++;
            watch.lastAboutExpandAt = Date.now();
            aboutExpandControl.click();
          }
          return;
        }
        if (!isHubSpotDetailsContentReady(sidebar)) {
          warmDetails(sidebar);
          return;
        }
        startHubSpotAccountWatch(ticketId);
        warmDetails(sidebar);
        return;
      }
      if (watch.tabClicks >= 3 || watch.retryId ||
          detailsTab.getAttribute('aria-disabled') === 'true') return;
      watch.tabClicks++;
      detailsTab.click();
      watch.retryKind = 'tab';
      watch.retryId = setTimeout(() => {
        watch.retryId = null;
        watch.retryKind = null;
        check();
      }, 1200);
      return;
    }
    if (!findMatchingHubSpotHeader(ticketId) || watch.clicks >= 3 || watch.retryId) return;

    const sidebarWrapper = getVisibleHubSpotSidebarWrapper();
    // HubSpot can mount the visible sidebar shell before its inner panel. Treat
    // that shell as an opening/open sidebar and wait for its content instead of
    // clicking the toggle a second time during the mount transition.
    if (sidebarWrapper) return;

    const toggle = Array.from(document.querySelectorAll('button[data-test-id="crm-sidebar-toggle"]'))
      .find(isElementVisible);
    if (!toggle || toggle.disabled || toggle.getAttribute('aria-disabled') === 'true') return;
    const iconName = toggle.querySelector('[data-icon-name]')?.getAttribute('data-icon-name');
    const explicitlyCollapsed = iconName === 'SidebarLeftExpand' ||
      toggle.getAttribute('aria-expanded') === 'false';
    if (!explicitlyCollapsed || iconName === 'SidebarLeftCollapse' ||
        toggle.getAttribute('aria-expanded') === 'true') return;

    watch.clicks++;
    toggle.click();
    watch.retryKind = 'toggle';
    watch.retryId = setTimeout(() => {
      watch.retryId = null;
      watch.retryKind = null;
      check();
    }, 1200);
  };

  check();
  if (hubSpotSidebarWatch !== watch) return;
  watch.observer = new MutationObserver((records) => {
    if (records.every(record => popup?.contains(record.target)) || watch.checkQueued) return;
    watch.checkQueued = true;
    queueMicrotask(() => {
      watch.checkQueued = false;
      check();
    });
  });
  watch.observer.observe(document.documentElement || document, {
    childList: true,
    attributes: true,
    attributeFilter: ['aria-expanded', 'aria-disabled', 'data-open-complete'],
    subtree: true
  });
  watch.timeoutId = setTimeout(() => {
    if (hubSpotSidebarWatch !== watch) return;
    stopHubSpotSidebarWatch();
  }, 20000);
}

function stopHubSpotAccountWatch() {
  const watch = hubSpotAccountWatch;
  if (!watch) return;
  watch.observer?.disconnect();
  clearInterval(watch.pollId);
  clearTimeout(watch.timeoutId);
  hubSpotAccountWatch = null;
}

function publishHubSpotAccountResult() {
  const result = hubSpotAccountResult;
  if (!result || !currentProcessId || result.sentProcessId === currentProcessId ||
      result.pendingProcessId === currentProcessId ||
      isFinalRequesterLookupDoc(localData.doc) ||
      result.generation !== localTicketGeneration || result.ticketId !== currentTicketId) return;
  const processId = currentProcessId;
  result.pendingProcessId = processId;
  msgBg({ action: 'HUBSPOT_ACCOUNT_RESOLVED', processId,
    kind: result.kind, count: result.count, name: result.name,
    email: result.email, doc: result.doc, accountType: result.accountType }).then(response => {
    if (hubSpotAccountResult !== result || result.pendingProcessId !== processId) return;
    result.pendingProcessId = null;
    if (response?.ok) {
      result.sentProcessId = processId;
      return;
    }
    if (response !== null || currentProcessId !== processId ||
        result.generation !== localTicketGeneration || result.ticketId !== currentTicketId ||
        result.sendRetries >= 3) return;
    result.sendRetries++;
    result.retryTimer = setTimeout(() => {
      result.retryTimer = null;
      publishHubSpotAccountResult();
    }, 200 * result.sendRetries);
  });
}

function resolveHubSpotAccountResult(ticketId, generation, data) {
  if (!enabled || currentTicketId !== ticketId || generation !== localTicketGeneration ||
      extractHubSpotTicketIdFromText(location.href) !== ticketId ||
      document.visibilityState === 'hidden' || isFinalRequesterLookupDoc(localData.doc)) return;
  if (hubSpotAccountResult) return;
  stopHubSpotAccountWatch();
  const kind = data.kind;
  const count = Number(data.count) || 0;
  const name = ['single', 'requester', 'matched_lookup'].includes(kind)
    ? (capitalizeNameWords(data.name) || '-') : '-';
  const email = ['single', 'requester', 'matched_lookup'].includes(kind)
    ? (data.email?.trim() || '-') :
    kind === 'multiple_requesters' ? '> Múltiplas Contas' :
    '> Ticket sem email';
  const rawDoc = String(data.doc ?? '').trim();
  const doc = kind === 'single'
    ? (isMissingHubSpotCardValue(rawDoc) ? '> Conta sem doc' : normalizeCachedHubSpotDoc(rawDoc))
    : ['requester', 'matched_lookup'].includes(kind) ? '...' : '-';
  hubSpotAccountResult = { ticketId, generation, kind, count, name, email, doc,
    accountType: ['single', 'matched_lookup'].includes(kind)
      ? (String(data.accountType ?? '').trim() || '-') :
      kind === 'requester' ? 'Verificar Contas' : '-',
    sentProcessId: null, pendingProcessId: null, sendRetries: 0, retryTimer: null };
  const priorAccounts = String(localData.accounts ?? '').trim();
  const keepCompletedAccounts = kind === 'single' && localData.doc === doc &&
    (/^.+ \| (?:[1-4]|5\+)$/.test(priorAccounts) || priorAccounts === '> Nenhuma conta');
  Object.assign(localData, { name, email, doc,
    accounts: keepCompletedAccounts ? priorAccounts :
      kind === 'single' && hasValidDocLengthForAction(doc) &&
      boTabState.backOffice2TabsAssigned[0] ? '...' : '-' });
  renderPopup();
  publishHubSpotAccountResult();
}

function capitalizeNameWords(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_match, boundary, letter) =>
      `${boundary}${letter.toLocaleUpperCase('pt-BR')}`);
}

function isMissingHubSpotCardValue(value) {
  return !String(value ?? '').trim() || /^[-–—−]+$/.test(String(value).trim());
}

function findHubSpotEduzzAccountsCard(sidebar) {
  return getHubSpotEduzzAccountsShell(sidebar);
}

function readHubSpotRequester(sidebar) {
  const section = getHubSpotRequesterShell(sidebar);
  if (!section || section.count === null) return null;
  const expand = section.card.querySelector(
    '[data-transitional-component="Clickable"][aria-expanded="false"]');
  if (expand) return null;
  if (section.count === 0) return { kind: 'no_email' };
  const tiles = [...section.card.querySelectorAll('[data-selenium-test="chicklet"]')];
  if (tiles.length < section.count) return null;
  const requesters = tiles.filter(tile => tile.querySelector('[data-test-id="0-1-Solicitante"]'));
  if (!requesters.length) return { kind: 'no_email' };
  if (requesters.length > 1) return { kind: 'multiple_requesters' };
  const tile = requesters[0];
  const email = tile.querySelector('[data-test-id="contact-chicklet-email"] a[href^="mailto:"]')
    ?.textContent?.trim() || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { kind: 'no_email' };
  return { kind: 'requester', email,
    name: tile.querySelector('[data-test-id="contact-chicklet-job-title"]')?.textContent?.trim() || '' };
}

function readHubSpotAccountTile(tile) {
  const emailField = tile.querySelector('[data-test-id="formatted-property-email"]');
  return {
    name: tile.querySelector('[data-test-id="formatted-property-razao_social"]')?.textContent || '',
    email: emailField?.querySelector('a[href^="mailto:"]')?.textContent ||
      emailField?.textContent || '',
    doc: tile.querySelector('[data-test-id="formatted-property-cpf_cnpj"]')?.textContent || '',
    accountType: tile.querySelector('[data-test-id="formatted-property-belt_elite"]')?.textContent || ''
  };
}

function startHubSpotAccountWatch(ticketId) {
  if (!enabled || !ticketId || hubSpotAccountResult?.ticketId === ticketId) return;
  if (hubSpotAccountWatch?.ticketId === ticketId &&
      hubSpotAccountWatch.generation === localTicketGeneration) return;
  stopHubSpotAccountWatch();
  const watch = { ticketId, generation: localTicketGeneration, observer: null,
    observedSidebar: null,
    pollId: null, timeoutId: null, tileSeenAt: 0, requesterSeenAt: 0,
    expandClicks: 0, lastExpandAt: 0,
    requesterExpandClicks: 0, lastRequesterExpandAt: 0, checkQueued: false };
  hubSpotAccountWatch = watch;
  const isCurrent = () => enabled && hubSpotAccountWatch === watch &&
    watch.generation === localTicketGeneration && currentTicketId === ticketId &&
    extractHubSpotTicketIdFromText(location.href) === ticketId &&
    document.visibilityState !== 'hidden';
  const check = () => {
    if (!isCurrent()) {
      if (hubSpotAccountWatch === watch) stopHubSpotAccountWatch();
      return;
    }
    const sidebar = getVisibleHubSpotSidebar();
    if (sidebar && watch.observer && watch.observedSidebar !== sidebar) {
      watch.observer.disconnect();
      watch.observer.observe(sidebar, { childList: true, characterData: true, subtree: true });
      watch.observedSidebar = sidebar;
    }
    if (!sidebar || !findMatchingHubSpotHeader(ticketId) ||
        !isHubSpotDetailsContentReady(sidebar) ||
        sidebar.querySelector('[role="navigation"][data-content="true"] [data-tab-id="0"]')
          ?.getAttribute('data-tab-selected') !== 'true') return;
    const found = findHubSpotEduzzAccountsCard(sidebar);
    if (!found) return;
    const expandControl = found.card.querySelector(
      '[data-transitional-component="Clickable"][aria-expanded="false"]'
    );
    if (expandControl) {
      if (expandControl.getAttribute('aria-disabled') !== 'true' &&
          watch.expandClicks < 3 && Date.now() - watch.lastExpandAt > 400) {
        watch.expandClicks++;
        watch.lastExpandAt = Date.now();
        expandControl.click();
      }
      return;
    }
    if (found.count === null) return;
    if (found.count !== 1) {
      const requesterExpand = getHubSpotRequesterShell(sidebar)?.card.querySelector(
        '[data-transitional-component="Clickable"][aria-expanded="false"]');
      if (requesterExpand) {
        if (requesterExpand.getAttribute('aria-disabled') !== 'true' &&
            watch.requesterExpandClicks < 3 &&
            Date.now() - watch.lastRequesterExpandAt > 400) {
          watch.requesterExpandClicks++;
          watch.lastRequesterExpandAt = Date.now();
          requesterExpand.click();
        }
        return;
      }
      const requester = readHubSpotRequester(sidebar);
      if (!requester) return;
      if (!watch.requesterSeenAt) watch.requesterSeenAt = Date.now();
      if (requester.kind !== 'requester' &&
          Date.now() - watch.requesterSeenAt < 800) return;
      if (requester.kind === 'requester' && !requester.name &&
          Date.now() - watch.requesterSeenAt < 800) return;
      if (requester.kind !== 'requester') {
        resolveHubSpotAccountResult(ticketId, watch.generation, requester);
        return;
      }
      if (found.count === 0) {
        resolveHubSpotAccountResult(ticketId, watch.generation, requester);
        return;
      }
      const accountTiles = [...found.card.querySelectorAll('[data-selenium-test="chicklet"]')];
      if (accountTiles.length < found.count) return;
      if (accountTiles.some(tile => !tile.querySelector('[data-test-id="formatted-property-email"]') ||
          !tile.querySelector('[data-test-id="formatted-property-cpf_cnpj"]'))) return;
      const accounts = accountTiles.map(readHubSpotAccountTile);
      if (accounts.some(account => !account.email.trim()) &&
          Date.now() - watch.requesterSeenAt < 800) return;
      const matches = accounts
        .filter(account => account.email.trim().toLowerCase() === requester.email.toLowerCase());
      if (matches.length === 1 && !matches[0].doc.trim() &&
          Date.now() - watch.requesterSeenAt < 800) return;
      if (matches.length !== 1) {
        resolveHubSpotAccountResult(ticketId, watch.generation, requester);
        return;
      }
      const match = matches[0];
      resolveHubSpotAccountResult(ticketId, watch.generation,
        { kind: isMissingHubSpotCardValue(match.doc) ? 'matched_lookup' : 'single',
          count: 1, ...match });
      return;
    }
    const tile = found.card.querySelector('[data-selenium-test="chicklet"]');
    if (!tile) return;
    if (!watch.tileSeenAt) watch.tileSeenAt = Date.now();
    const nameEl = tile.querySelector('[data-test-id="formatted-property-razao_social"]');
    const emailEl = tile.querySelector('[data-test-id="formatted-property-email"]');
    const docEl = tile.querySelector('[data-test-id="formatted-property-cpf_cnpj"]');
    const accountTypeEl = tile.querySelector('[data-test-id="formatted-property-belt_elite"]');
    if ((!nameEl || !emailEl || !docEl || !accountTypeEl) &&
        Date.now() - watch.tileSeenAt < 800) return;
    resolveHubSpotAccountResult(ticketId, watch.generation,
      { kind: 'single', count: 1, ...readHubSpotAccountTile(tile) });
  };
  check();
  if (hubSpotAccountWatch !== watch) return;
  watch.observer = new MutationObserver((records) => {
    if (records.every(record => popup?.contains(record.target)) || watch.checkQueued) return;
    watch.checkQueued = true;
    queueMicrotask(() => { watch.checkQueued = false; check(); });
  });
  const sidebar = getVisibleHubSpotSidebar();
  if (sidebar) {
    watch.observer.observe(sidebar, { childList: true, characterData: true, subtree: true });
    watch.observedSidebar = sidebar;
  }
  watch.pollId = setInterval(check, 200);
  watch.timeoutId = setTimeout(() => {
    if (!isCurrent()) return;
    if (!hubSpotAccountResult || hubSpotAccountResult.ticketId !== ticketId) {
      Object.assign(localData, { name: '-', email: '-', doc: '-' });
      renderPopup();
    }
    clearInterval(watch.pollId);
    watch.pollId = setInterval(check, 1000);
  }, 15000);
}

function extractHubSpot(processId, ticketId) {
  if (currentProcessId !== processId || currentTicketId !== ticketId) return;
  if (isFinalRequesterLookupDoc(localData.doc)) return;
  if (!hubSpotAccountResult && !hubSpotAccountWatch) startHubSpotSidebarWatch(ticketId);
  publishHubSpotAccountResult();
}
function extractHyperflow(processId, ticketId) {




  let waitAttempts = 0;

  function readHyperflowEmailFromRoot(root) {
    const searchRoot = root || getHyperflowSearchRoot() || document;
    const labels = Array.from(searchRoot.querySelectorAll('span.MuiTypography-caption, span'));
    for (const label of labels) {
      const labelText = (label.innerText || label.textContent || '').trim();
      if (!/^e-mail\s*:/i.test(labelText)) continue;

      const valueEl =
        label.nextElementSibling ||
        label.parentElement?.querySelector('span[aria-label*="@"]') ||
        null;
      const text =
        valueEl?.getAttribute('aria-label')?.trim() ||
        valueEl?.innerText?.trim() ||
        valueEl?.textContent?.trim() ||
        '';
      const email = extractEmail(text);
      if (email) return email;
    }

    const labelled = Array.from(searchRoot.querySelectorAll('span[aria-label*="@"], [aria-label*="@"]'));
    for (const el of labelled) {
      const email = extractEmail(el.getAttribute('aria-label') || el.textContent || '');
      if (email) return email;
    }

    return null;
  }

  function readHyperflowEmailForProtocol(protocol) {
    const roots = getHyperflowRootsForProtocol(protocol);
    for (const root of roots) {
      const email = readHyperflowEmailFromRoot(root);
      if (email) return email;
    }
    return null;
  }

  function sendHyperflowEmail(email) {
    if (!email || emailSent || currentProcessId !== processId) return false;
    emailSent = true;
    localData.email = email;
    renderPopup();
    msgBg({ action: 'DATA_EXTRACTED', processId, email });
    return true;
  }

  function waitForDom() {
    if (currentProcessId !== processId) return;
    waitAttempts++;

    const urlProtocolId = extractHyperflowTicketIdFromPath();
    const hasMatchingDomProtocol = getHyperflowRootsForProtocol(ticketId).length > 0;
    const protocolId = hasMatchingDomProtocol
      ? ticketId
      : (urlProtocolId ? null : extractHyperflowTicketIdFromDom());

    if (protocolId !== ticketId) {
      if (waitAttempts >= 300) {
        setAllEmpty();
      } else {
        extractionTimer = setTimeout(waitForDom, waitAttempts < 20 ? 25 : 50);
      }
      return;
    }


    readOnce(processId);
  }

  function readOnce(processId) {
    if (currentProcessId !== processId) return;
    const observedTicketId = extractTicketId();
    if (!observedTicketId || observedTicketId !== ticketId) {
      extractionTimer = setTimeout(waitForDom, 45);
      return;
    }




    const email = readHyperflowEmailForProtocol(ticketId);

    if (email) {
      sendHyperflowEmail(email);
    } else {
      if (waitAttempts < 80) {
        extractionTimer = setTimeout(waitForDom, waitAttempts < 20 ? 35 : 75);
        return;
      }

      localData.name = '-';
      localData.email = '-';
      localData.doc = '-';
      localData.accounts = '-';
    }

    renderPopup();
  }

  function setAllEmpty() {
    if (currentProcessId !== processId) return;
    localData.name     = '-';
    localData.email    = '-';
    localData.doc      = '-';
    localData.accounts = '-';
    renderPopup();
  }

  waitForDom();
}








let pendingPopupUpdates = {};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'COPY_SHORTCUT_FIELD') {
    const ticketId = String(msg.ticketId || '');
    const isId = msg.field === 'id';
    const routeMatches = isHubSpot() &&
      String(extractHubSpotTicketIdFromText(location.href) || '') === ticketId;
    const transition = isId ? null : getCurrentTicketTransitionState();
    if (!enabled || document.visibilityState !== 'visible' || !routeMatches ||
        (!isId && (!isTicketPage() || transition.waitForDom ||
          String(transition.ticketId || '') !== ticketId ||
          String(currentTicketId || '') !== ticketId))) {
      sendResponse({ ok: false });
      return;
    }
    let value = null;
    const field = msg.field;
    if (field === 'id') value = ticketId;
    else if (field === 'name') {
      const name = localData.name;
      if (isCopyablePopupValue(name)) value = name.includes('@') ? name : name.split(/\s+/)[0];
    } else if (field === 'email') value = localData.email;
    else if (field === 'doc') value = normalizeCachedHubSpotDoc(localData.doc);
    if (!isCopyablePopupValue(value)) {
      sendResponse({ ok: false });
      return;
    }
    copyTextToClipboard(value).then((ok) => {
      const stillCurrent = enabled && document.visibilityState === 'visible' &&
        String(extractHubSpotTicketIdFromText(location.href) || '') === ticketId &&
        String(localData.id || '') === ticketId;
      if (ok && stillCurrent) flashCopiedValue(field, Date.now());
      sendResponse({ ok: !!ok });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.action === 'COPY_VALUE_FEEDBACK') {
    flashCopiedValue(msg.field, msg.copiedAt);
    return;
  }

  if (msg.action === 'RUN_BO_SETUP_ACTION') {
    if (!enabled || !isHubSpotTicketPage() ||
        popupOwnerTabId !== popupThisTabId ||
        String(currentTicketId || '') !== String(msg.expectedTicketId || '') ||
        popupOwnerEpoch !== msg.ownerEpoch) {
      sendResponse({ ok: false });
      return;
    }
    flashCopiedValue('accounts', Date.now());
    runBOSetupAction().then(result => sendResponse({ ok: !!result?.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.action === 'GET_TICKET_CONTEXT') {
    sendResponse({ isTicketPage: isTicketPage(), ticketId: extractTicketId(), url: location.href });
    return;
  }

  if (msg.action === 'RESUME_VALIDATION_COMPLETE') {
    resumeValidationComplete = true;
    resumeValidationPending = false;
    if (!enabled || !popup || !document.hasFocus() || document.visibilityState === 'hidden') return;
    if (!isTicketPage()) {
      onFocusGained(true);
      return;
    }

    const ticketId = extractTicketId();
    const expectedTicketId = String(msg.expectedTicketId || '').trim();
    if (ticketId) {
      if (ticketId !== currentTicketId) primeTicketSwitch(ticketId);
      enterTicket(ticketId, false);
      return;
    }

    if (expectedTicketId) {
      primeTicketSwitch(expectedTicketId);
      enterTicket(expectedTicketId, false);
      return;
    }

    onFocusGained(true);
    return;
  }

  if (msg.action === 'RESTART_TICKET_PROCESS') {
    if (!enabled || !popup || !isTicketPage()) return;
    const ticketId = msg.expectedTicketId || extractTicketId();
    if (!ticketId) return;
    if (ticketId !== currentTicketId) primeTicketSwitch(ticketId);
    enterTicket(ticketId, false);
    return;
  }

  if (msg.action === 'GET_CURRENT_DATA') {
    const transition = getCurrentTicketTransitionState();
    const hasCurrentPageData = isTicketPage() && !transition.waitForDom &&
      !!transition.ticketId && String(transition.ticketId) === String(currentTicketId);
    sendResponse({
      data: {
        id: hasCurrentPageData ? localData.id ?? null : null,
        name: hasCurrentPageData ? localData.name ?? null : null,
        email: hasCurrentPageData ? localData.email ?? null : null,
        doc: hasCurrentPageData ? normalizeCachedHubSpotDoc(localData.doc ?? null) : null,
        accounts: hasCurrentPageData ? localData.accounts ?? null : null,
        accountType: hasCurrentPageData && hubSpotAccountResult?.ticketId === currentTicketId &&
          ['single', 'requester', 'matched_lookup'].includes(hubSpotAccountResult.kind)
          ? hubSpotAccountResult.accountType : null
      },
      currentTicketId,
      currentProcessId,
      ownerEpoch: popupOwnerEpoch,
      isTicketPage: isTicketPage()
    });
    return;
  }

  if (msg.action === 'TICKET_OWNER_CHANGED') {
    const nextEpoch = Number.isInteger(msg.ownerEpoch) ? msg.ownerEpoch : null;
    if (nextEpoch !== null && (popupOwnerEpoch === null || nextEpoch >= popupOwnerEpoch)) {
      const nextOwnerTabId = Number.isInteger(msg.ownerTabId) ? msg.ownerTabId : null;
      const previousOwnerWasThisTab = popupOwnerTabId === popupThisTabId;
      const generationChanged = previousOwnerWasThisTab && popupOwnerEpoch !== null &&
        nextEpoch !== popupOwnerEpoch;
      if (Number.isInteger(popupThisTabId) && currentTicketId &&
          (nextOwnerTabId !== popupThisTabId || generationChanged)) {
        clearTimeout(extractionTimer);
        resetProcess();
        renderPopup();
      }
      popupOwnerTabId = nextOwnerTabId;
      popupOwnerTicketId = msg.ownerTicketId ? String(msg.ownerTicketId) : null;
      popupOwnerEpoch = nextEpoch;
    }
    if (Number.isInteger(msg.focusedTabId)) popupFocusedTabId = msg.focusedTabId;
    applyPopupVisibility();
    requestPopupOwnerState();
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'UPDATE_POPUP') {
    if (!msg.processId) return;

    if (msg.processId === currentProcessId) {
      if (msg.fields) {
        applyPopupFields(msg.fields);
        renderPopup();
      }
      return;
    }

    if (!pendingPopupUpdates[msg.processId]) pendingPopupUpdates[msg.processId] = [];
    if (msg.fields) {
      const fields = { ...msg.fields };
      if (Object.prototype.hasOwnProperty.call(fields, 'doc')) {
        fields.doc = normalizeCachedHubSpotDoc(fields.doc);
      }
      pendingPopupUpdates[msg.processId].push(fields);
    }
  }
  if (msg.action === 'BO_TAB_STATE') {
    if (msg.state) {
      applyBOTabState(msg.state);
      renderBOTabButtons();
    }
  }
  if (msg.action === 'FLASH_BLOCKED_BO_ACTION') {
    flashBlockedBOAction(msg.triggeredAt, msg.missingTab, msg.blockedField);
  }
});





function clearHistoryView() {
  const historyView = popup?.querySelector('#th-history-view');
  if (!historyView) return null;
  historyView.replaceChildren();
  return historyView;
}

function renderHistoryRows(items) {
  const historyView = clearHistoryView();
  if (!historyView) return;

  const historyItems = (Array.isArray(items) ? items : [])
    .filter(item => String(item?.id ?? '') !== String(currentTicketId ?? ''));
  if (!historyItems.length) {
    const empty = document.createElement('div');
    empty.className = 'th-history-empty';
    empty.textContent = 'Sem histórico';
    historyView.appendChild(empty);
    return;
  }

  for (const item of historyItems) {
    const id = String(item?.id ?? '').trim();
    if (!id) continue;
    const email = String(item?.email || '-');

    const row = document.createElement('div');
    row.className = 'th-history-row';
    row.dataset.historyId = id;
    row.dataset.historyKind = item?.kind === 'hubspot' || item?.kind === 'hyperflow'
      ? item.kind
      : '';
    const idEl = document.createElement('button');
    idEl.type = 'button';
    idEl.className = 'th-history-id';
    idEl.textContent = id;
    idEl.title = `Copiar ID ${id}`;
    idEl.setAttribute('aria-label', `Copiar ID ${id}`);

    const emailEl = document.createElement('button');
    emailEl.type = 'button';
    emailEl.className = 'th-history-email';
    emailEl.textContent = email;
    emailEl.title = 'Abrir em nova aba';
    emailEl.setAttribute('aria-label', `Abrir ticket ${id} em nova aba`);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'th-history-open';
    openBtn.title = 'Abrir em nova aba';
    openBtn.setAttribute('aria-label', `Abrir ticket ${id} em nova aba`);
    openBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3"/><path d="M21 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7"/></svg>';

    row.append(idEl, emailEl, openBtn);
    historyView.appendChild(row);
  }
}

async function refreshHistoryView() {
  if (!historyViewOpen) return;
  const ticketId = currentTicketId;
  const resp = await msgBg({ action: 'GET_TICKET_HISTORY' });
  if (!historyViewOpen || currentTicketId !== ticketId) return;
  renderHistoryRows(resp?.history || []);
  historyViewTicketId = ticketId;
}

function setHistoryViewOpen(open) {
  if (!popup) return;
  historyViewOpen = !!open;
  if (!historyViewOpen) historyViewTicketId = null;

  const historyBtn = popup.querySelector('#th-btn-history');
  const historyView = popup.querySelector('#th-history-view');
  popup.classList.toggle('is-history-open', historyViewOpen);
  historyBtn?.classList.toggle('is-active', historyViewOpen);
  historyBtn?.setAttribute('aria-pressed', historyViewOpen ? 'true' : 'false');
  historyView?.setAttribute('aria-hidden', historyViewOpen ? 'false' : 'true');

  if (historyViewOpen) {
    refreshHistoryView();
  }
}

function installHistoryOutsideClickHandler() {
  if (historyOutsideClickHandlerInstalled) return;
  historyOutsideClickHandlerInstalled = true;

  document.addEventListener('click', (event) => {
    if (!historyViewOpen || !popup) return;
    if (popup.contains(event.target)) return;
    setHistoryViewOpen(false);
  }, true);

  window.addEventListener('blur', () => {
    if (historyViewOpen) setHistoryViewOpen(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && historyViewOpen) setHistoryViewOpen(false);
  });
}




function setPopupValueText(element, value) {
  if (!element) return;
  const rawText = String(value ?? '');
  const isEndState = rawText.trim().startsWith('>');
  const row = element.closest('.th-copyable');
  row?.classList.toggle('is-non-copyable', isEndState);
  if (row) {
    if (isEndState) row.setAttribute('aria-disabled', 'true');
    else row.removeAttribute('aria-disabled');
  }
  const statusMatch = rawText.match(/^>\s*(.*?)\s*$/);
  let fullText = rawText;
  if (statusMatch) {
    let label = statusMatch[1].replace(/\s*<$/, '').trim();
    if (/^conta sem doc\.?$/i.test(label)) label = 'Conta sem doc.';
    fullText = `${label} <`;
  }
  element.classList.toggle('is-muted-status',
    (element.id === 'th-doc-val' && /^conta sem doc\.\s*<$/i.test(fullText.trim())) ||
    (element.id === 'th-email-val' && /^(?:ticket sem (?:email|conta)|múltiplas contas)\s*<$/i.test(fullText.trim())));
  element._ticketHelperFullValue = fullText;
  fitPopupValueText(element, fullText);
}

function fitPopupValueText(element, fullText = element?._ticketHelperFullValue ?? '') {
  if (!element?.isConnected) return;
  const availableWidth = element.clientWidth;
  if (!availableWidth) {
    // Hidden popup values are fitted once the popup becomes visible again.
    element.textContent = fullText;
    element._ticketHelperRenderedWidth = 0;
    return;
  }

  if (element._ticketHelperRenderedValue === fullText &&
      element._ticketHelperRenderedWidth === availableWidth) return;
  element._ticketHelperRenderedValue = fullText;
  element._ticketHelperRenderedWidth = availableWidth;

  const style = getComputedStyle(element);
  if (!popupValueMeasureContext) {
    popupValueMeasureContext = document.createElement('canvas').getContext('2d');
  }
  if (!popupValueMeasureContext) {
    element.textContent = fullText;
    return;
  }

  popupValueMeasureContext.font = style.font;
  if (popupValueMeasureContext.measureText(fullText).width <= availableWidth) {
    element.textContent = fullText;
    return;
  }

  const chars = Array.from(fullText);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('')}…`;
    if (popupValueMeasureContext.measureText(candidate).width <= availableWidth) low = mid;
    else high = mid - 1;
  }
  element.textContent = `${chars.slice(0, low).join('')}…`;
}

function isPendingPopupField(value) {
  const text = String(value ?? '').trim();
  return !text || text === '...';
}

function getPopupFieldDisplayValue(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '...') return '-';
  if (/^>\s*(erro(?: na busca)?|sem aba bo\b)/i.test(text)) return '-';
  return text;
}

function isPopupFieldLoading(field, value) {
  const text = String(value ?? '').trim();
  const isPending = isPendingPopupField(value) || (field === 'accounts' && text.endsWith('...'));
  if (isHubSpotTicketPage() && ['name', 'email', 'doc'].includes(field)) {
    if (field === 'doc' &&
        ['requester', 'matched_lookup'].includes(hubSpotAccountResult?.kind)) {
      return enabled && !!currentTicketId && boTabState.backOffice2TabsAssigned[0] && isPending;
    }
    return enabled && !!currentTicketId && !hubSpotAccountResult && isPending;
  }
  if (isHubSpotTicketPage() && field === 'accounts') {
    if (!enabled || !currentTicketId || !boTabState.backOffice2TabsAssigned[0] || !isPending) {
      return false;
    }
    return !hubSpotAccountResult || hasValidDocLengthForAction(localData.doc);
  }
  if (!enabled || !currentTicketId || !isPending || !boTabState.requiredTabsReady) return false;
  if (field === 'name' || field === 'email') return true;
  if (!currentProcessId) return false;
  if (field === 'doc') return !!normalizeEmailForAction(localData.email);
  if (field === 'accounts') {
    const accountsText = String(value ?? '').trim();
    return hasValidDocLengthForAction(localData.doc) || accountsText.endsWith('...');
  }
  return false;
}

function renderPopupField(field, element, value) {
  const loading = isPopupFieldLoading(field, value);
  const text = String(value ?? '').trim();
  const unfinishedAccounts = field === 'accounts' && text.endsWith('...');
  setPopupValueText(element, loading || unfinishedAccounts ? '-' : getPopupFieldDisplayValue(value));
  const row = popup.querySelector(`#th-${field}-row`);
  if (loading && row && !row.classList.contains('is-value-loading')) {
    row.classList.add('is-value-loading');
    return true;
  }
  row?.classList.toggle('is-value-loading', loading);
  return false;
}

function syncPopupLoadingAnimations() {
  const animations = [...popup.querySelectorAll('.is-value-loading')]
    .map(row => row.getAnimations({ subtree: true })
      .find(animation => animation.animationName === 'th-value-loading-spin'))
    .filter(Boolean);
  // Anchor every spinner to the same document timeline, including ones added later.
  for (const animation of animations) animation.startTime = 0;
}

function renderPopup() {

  if (!popup) return;

  localData.doc = normalizeCachedHubSpotDoc(localData.doc);

  const idEl       = popup.querySelector('#th-id-val');
  const nameEl     = popup.querySelector('#th-name-val');
  const emailEl    = popup.querySelector('#th-email-val');
  const docEl      = popup.querySelector('#th-doc-val');
  const accountsEl = popup.querySelector('#th-accounts-val');
  if (!idEl) return;

  const { id, name, email, doc, accounts } = localData;
  const accountsDisplay = boTabStateResolved && !boTabState.backOffice2TabsAssigned[0]
    ? 'Atribuir BO' : accounts;

  if (!id) {
    for (const field of ['id', 'name', 'email', 'doc', 'accounts']) {
      popup.querySelector(`#th-${field}-row`)?.classList.remove('is-value-loading');
    }
    setPopupValueText(idEl, '-');
    setPopupValueText(nameEl, '-');
    setPopupValueText(emailEl, '-');
    setPopupValueText(docEl, '-');
    setPopupValueText(accountsEl, accountsDisplay || '-');
    updateActionButtonsState();
    return;
  }

  setPopupValueText(idEl, id);
  let loadingStarted = false;
  loadingStarted = renderPopupField('name', nameEl, name) || loadingStarted;
  loadingStarted = renderPopupField('email', emailEl, email) || loadingStarted;
  loadingStarted = renderPopupField('doc', docEl, doc) || loadingStarted;
  loadingStarted = renderPopupField('accounts', accountsEl, accountsDisplay) || loadingStarted;
  syncPopupLoadingAnimations();
  if (loadingStarted) requestAnimationFrame(syncPopupLoadingAnimations);
  updateActionButtonsState();
}

function updateActionButtonsState() {

  if (!popup) return;
  const orbitaBtn = popup.querySelector('#th-action-orbita');
  const faturasBtn = popup.querySelector('#th-action-faturas');
  const nutrorBtn = popup.querySelector('#th-action-nutror');
  const contratosBtn = popup.querySelector('#th-action-contratos');
  if (!orbitaBtn && !faturasBtn && !nutrorBtn && !contratosBtn) return;
  const actionStates = [
    { key: 'orbita', btn: orbitaBtn, target: resolveOrbitaActionTarget(localData) },
    { key: 'faturas', btn: faturasBtn, target: resolveFaturasActionTarget(localData) },
    { key: 'nutror', btn: nutrorBtn, target: resolveNutrorActionTarget(localData) },
    { key: 'contratos', btn: contratosBtn, target: resolveContratosActionTarget(localData) }
  ];

  for (const item of actionStates) {
    if (!item.btn) continue;

    const hasSpecificTab = !!boTabState.actionTabs?.[item.key];
    const usesBO1Fallback = item.key === 'orbita' && !hasSpecificTab;
    const hasTargetTab = usesBO1Fallback
      ? !!boTabState.boTab1Assigned
      : hasSpecificTab || !!boTabState.boTab2Assigned;
    const hasSearchValue = !!item.target?.value;
    const canUseAction = boTabState.requiredTabsReady && hasTargetTab && hasSearchValue;
    const canArmActionTab = !hasTargetTab;
    const isArmedAction = boTabState.armedAction === item.key;

    item.btn.classList.toggle('is-available', canUseAction);
    item.btn.classList.toggle('is-unavailable', !canUseAction);
    item.btn.classList.toggle('is-armable', canArmActionTab);
    item.btn.classList.toggle('is-armed', isArmedAction && canArmActionTab);
    item.btn.classList.toggle('has-action-tab', hasSpecificTab);
    item.btn.classList.toggle('can-assign-action-tab', item.key === 'orbita' && !hasSpecificTab);
  }
  updateActionTabsHint();
}





function requestPopupOwnerState() {
  if (!enabled || !isValidDomain()) return;
  const requestId = ++popupOwnerRequestId;
  msgBg({ action: 'GET_TICKET_OWNER_STATE' }).then((state) => {
    if (requestId !== popupOwnerRequestId || !enabled || !state || !Number.isInteger(state.thisTabId)) return;
    const previousOwnerTabId = popupOwnerTabId;
    const previousOwnerEpoch = popupOwnerEpoch;
    popupOwnerStateResolved = true;
    popupOwnerTabId = Number.isInteger(state.ownerTabId) ? state.ownerTabId : null;
    popupOwnerTicketId = state.ownerTicketId ? String(state.ownerTicketId) : null;
    popupOwnerEpoch = Number.isInteger(state.ownerEpoch) ? state.ownerEpoch : null;
    popupThisTabId = state.thisTabId;
    if (Number.isInteger(state.focusedTabId)) popupFocusedTabId = state.focusedTabId;
    const ownerGenerationChanged = previousOwnerTabId === popupThisTabId &&
      previousOwnerEpoch !== null && popupOwnerEpoch !== previousOwnerEpoch;
    if ((popupOwnerTabId !== popupThisTabId || ownerGenerationChanged) && currentTicketId) {
      clearTimeout(extractionTimer);
      resetProcess();
      renderPopup();
      if (popupOwnerTabId === popupThisTabId && popupFocusedTabId === popupThisTabId) {
        onFocusGained(false);
      }
    } else if (popupOwnerTabId === popupThisTabId && state.ownerTicketId &&
               currentTicketId && String(currentTicketId) !== String(state.ownerTicketId)) {
      primeTicketSwitch(String(state.ownerTicketId));
    }
    applyPopupVisibility();
  });
}

function applyPopupVisibility() {
  if (!popup) return;
  const isOwnerPage = popupOwnerTabId === popupThisTabId;
  const isNeutralPage = popupOwnerTabId === null && popupFocusedTabId === popupThisTabId;
  const shouldShow = enabled && isHubSpotApp() && popupOwnerStateResolved &&
    (isOwnerPage || isNeutralPage);
  const wasHidden = popup.style.display === 'none';
  if (!shouldShow && !wasHidden) clearCopyFeedback();
  if (shouldShow && wasHidden && popupPositionReady) restoreOrClampPopupPosition();
  popup.style.display = shouldShow ? '' : 'none';
  if (shouldShow && wasHidden) renderPopup();
}

function createPopup() {

  if (popup || !document.body) return;
  const existingPopup = document.getElementById('ticket-helper-popup');
  if (existingPopup) existingPopup.remove();

  popup = document.createElement('div');
  popup.id = 'ticket-helper-popup';
  popup.style.visibility = 'hidden';
  popupPositionReady = false;
  historyViewOpen = false;
  historyViewTicketId = null;
  const sharedMarkup = window.TicketHelperPopupUI?.getMarkup?.();
  if (!sharedMarkup) {
    popup = null;
    return;
  }
  popup.innerHTML = sharedMarkup;

  popup.style.position = 'fixed';
  popup.style.zIndex = '2147483647';
  popup.style.pointerEvents = 'auto';
  document.documentElement.appendChild(popup);
  shieldPopupFromPageClicks();
  const actionsGrid = popup.querySelector('.th-actions-grid');
  if (actionsGrid) {
    while (actionsGrid.children.length > 4) {
      actionsGrid.lastElementChild?.remove();
    }
  }


  const posKey = isHubSpot() ? 'popupPosition_hubspot' : 'popupPosition_hyperflow';
  const positionLayoutKey = `popupPosition_compactHeader_v8_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV7Key = `popupPosition_compactHeader_v7_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV6Key = `popupPosition_compactHeader_v6_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV5Key = `popupPosition_compactHeader_v5_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV4Key = `popupPosition_compactHeader_v4_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV3Key = `popupPosition_compactHeader_v3_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV2Key = `popupPosition_wideLayout_v2_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const positionLayoutV1Key = `popupPosition_wideLayout_v1_${isHubSpot() ? 'hubspot' : 'hyperflow'}`;
  const popupForPosition = popup;

  const applyStoredPosition = (data) => {
    if (popup !== popupForPosition || !popup.isConnected) return;
    let pos = data?.[posKey];
    if (hasPopupPosition(pos) && data?.[positionLayoutKey] !== true) {
      const priorLeftAdjustment = data?.[positionLayoutV7Key] === true ? 0
        : data?.[positionLayoutV6Key] === true ? -2
        : data?.[positionLayoutV5Key] === true ? -6
        : data?.[positionLayoutV4Key] === true ? -14
        : data?.[positionLayoutV3Key] === true || data?.[positionLayoutV2Key] === true ? 42.32
        : data?.[positionLayoutV1Key] === true ? 67.92 : -111.28;
      const leftAdjustment = priorLeftAdjustment + 8;
      const topAdjustment = data?.[positionLayoutV7Key] === true || data?.[positionLayoutV6Key] === true || data?.[positionLayoutV5Key] === true
        || data?.[positionLayoutV4Key] === true || data?.[positionLayoutV3Key] === true ? 0 : 24;
      pos = { ...pos, left: Number(pos.left) + leftAdjustment, top: Number(pos.top) + topAdjustment };
      safeSetLocal({ [posKey]: pos, [positionLayoutKey]: true });
    } else if (data?.[positionLayoutKey] !== true) {
      safeSetLocal({ [positionLayoutKey]: true });
    }
    popupHasStoredPosition = hasPopupPosition(pos);
    applyPopupPosition(popupHasStoredPosition ? pos : null,
      popupHasStoredPosition && document.hasFocus());
    popupPositionReady = true;
    popup.style.visibility = 'visible';
    applyPopupVisibility();
  };
  if (bootstrapPopupPositionData) {
    const data = bootstrapPopupPositionData;
    bootstrapPopupPositionData = null;
    applyStoredPosition(data);
  } else {
    chrome.storage.local.get(getPopupPositionStorageKeys(), applyStoredPosition);
  }

  bindDragging();
  bindButtons();
  bindRowClicks();
  renderBOTabButtons();
  requestBOTabState();
}

function shieldPopupFromPageClicks() {
  if (!popup) return;

  const stopBubble = (event) => {
    event.stopPropagation();
  };

  popup.addEventListener('pointerdown', stopBubble, false);
  popup.addEventListener('mousedown', stopBubble, false);
  popup.addEventListener('click', stopBubble, false);
}





function bindDragging() {
  const handle = popup.querySelector('.th-drag-handle');
  let ox = 0, oy = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    popupDragging = true;
    const rect = popup.getBoundingClientRect();
    popup.style.left   = rect.left + 'px';
    popup.style.top    = rect.top  + 'px';
    popup.style.right  = 'auto';
    popup.style.bottom = 'auto';
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!popupDragging) return;
    popup.style.left = (e.clientX - ox) + 'px';
    popup.style.top  = (e.clientY - oy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!popupDragging) return;
    popupDragging = false;
    popupHasStoredPosition = true;
    document.body.style.userSelect = '';
    clampPopup(true);
  });
}





function measurePopupSize() {
  const hidden = getComputedStyle(popup).display === 'none';
  const previousDisplay = popup.style.display;
  const previousVisibility = popup.style.visibility;
  if (hidden) {
    popup.style.visibility = 'hidden';
    popup.style.display = 'flex';
  }
  const { width, height } = popup.getBoundingClientRect();
  if (hidden) {
    popup.style.display = previousDisplay;
    popup.style.visibility = previousVisibility;
  }
  return { width, height };
}

function clampPopup(save = false) {
  if (!popup) return;
  popup.style.maxWidth = `calc(100vw - 40px)`;
  const left   = parseFloat(popup.style.left) || 0;
  const top    = parseFloat(popup.style.top)  || 0;
  const { width, height } = measurePopupSize();
  const margin = 10;

  const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
  const clampedLeft = Math.max(margin, Math.min(left, viewportWidth - width - margin));
  const clampedTop = Math.max(margin, Math.min(top, viewportHeight - height - margin));


  if (clampedLeft !== left || clampedTop !== top) {
    popup.style.left = clampedLeft + 'px';
    popup.style.top  = clampedTop  + 'px';
  }
  popup.style.right  = 'auto';
  popup.style.bottom = 'auto';
  if (save) {
    const posKey = isHubSpot() ? 'popupPosition_hubspot' : 'popupPosition_hyperflow';
    safeSetLocal({ [posKey]: { left: clampedLeft, top: clampedTop } });
  }
}

function applyPopupPosition(position, saveClamped = false) {
  if (!popup) return;
  if (hasPopupPosition(position)) {
    popup.style.left = `${Number(position.left)}px`;
    popup.style.top = `${Number(position.top)}px`;
    clampPopup(saveClamped);
    return;
  }

  popup.style.left = '10px';
  popup.style.top = '10px';
  popup.style.maxWidth = `calc(100vw - 40px)`;
  const { width, height } = measurePopupSize();
  const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
  popup.style.left = `${Math.max(10, viewportWidth - width - 10)}px`;
  popup.style.top = `${Math.max(10, viewportHeight - height - 10)}px`;
  clampPopup(false);
}

function hasPopupPosition(position) {
  return !!position && position.left != null && position.top != null &&
    Number.isFinite(Number(position.left)) && Number.isFinite(Number(position.top));
}

function restoreOrClampPopupPosition() {
  if (!popup || !popupPositionReady) return;
  if (popupHasStoredPosition) clampPopup(document.hasFocus());
  else applyPopupPosition(null, false);
}





function bindButtons() {

  popup.querySelector('#th-btn-close').title = 'Desativar TicketHelper';
  popup.querySelector('#th-btn-close').addEventListener('click', () => msgBg({ action: 'TOGGLE_WORK_ENABLED' }));
  popup.querySelector('#th-btn-gear').addEventListener('click', () => msgBg({ action: 'OPEN_OPTIONS' }));
  installHistoryOutsideClickHandler();

  const historyBtn = popup.querySelector('#th-btn-history');
  const historyView = popup.querySelector('#th-history-view');
  if (historyBtn) {
    historyBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setHistoryViewOpen(!historyViewOpen);
    });
  }
  if (historyView) {
    historyView.addEventListener('click', async (event) => {
      if (!(event.target instanceof Element)) return;

      event.preventDefault();
      event.stopPropagation();

      const row = event.target.closest('.th-history-row');
      if (!row) return;

      const id = row.dataset.historyId;
      if (!id) return;
      if (event.target.closest('.th-history-email, .th-history-open')) {
        await msgBg({ action: 'OPEN_HISTORY_ITEM', id, kind: row.dataset.historyKind || '' });
        return;
      }
      if (!event.target.closest('.th-history-id')) return;
      copyTextToClipboard(id).then(ok => {
        if (ok) flashHistoryRow(row, Date.now());
      }).catch(() => {});
    });
  }
  popup.addEventListener('click', (event) => {
    if (!historyViewOpen) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('#th-btn-history, .th-history-row')) return;
    setHistoryViewOpen(false);
  });

  popup.querySelector('#th-btn-bo-reset').addEventListener('click', () => runBOSetupAction());
}

async function runBOSetupAction() {
  const shouldLaunch = !boTabState.requiredTabsAssigned;
  const sidebar = shouldLaunch && isHubSpotTicketPage()
    ? getVisibleHubSpotSidebar() : null;
  const accountCard = sidebar ? findHubSpotEduzzAccountsCard(sidebar) : null;
  const accountType = hubSpotAccountResult?.ticketId === currentTicketId &&
    ['single', 'requester', 'matched_lookup'].includes(hubSpotAccountResult.kind)
    ? hubSpotAccountResult.accountType :
    accountCard?.count === 1 ? accountCard.card.querySelector(
      '[data-selenium-test="chicklet"] [data-test-id="formatted-property-belt_elite"]'
    )?.textContent : null;
  const resp = await msgBg({
    action: shouldLaunch ? 'LAUNCH_DEFINED_BO_TABS' : 'RESET_BO_TABS',
    ticketContext: shouldLaunch && isHubSpotTicketPage() && currentTicketId && currentProcessId
      ? { ticketId: currentTicketId, processId: currentProcessId,
        name: localData.name, email: localData.email,
        doc: normalizeCachedHubSpotDoc(localData.doc),
        accountType }
      : undefined,
    screenBounds: shouldLaunch ? {
      left: window.screen.availLeft,
      top: window.screen.availTop,
      width: window.screen.availWidth,
      height: window.screen.availHeight
    } : undefined
  });
  if (resp?.state) {
    applyBOTabState(resp.state);
    renderBOTabButtons();
  }
  return resp;
}

function normalizeDocForAction(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === '-' || text === '...') return '';
  if (text.startsWith('>')) return '';
  return text;
}

function normalizeEmailForAction(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === '-' || text === '...') return '';
  if (text.startsWith('>')) return '';
  return text.includes('@') ? text : '';
}

function hasValidDocLengthForAction(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;

  const rawCpf = /^\d{11}$/;
  const formattedCpf = /^\d{3}[-./]\d{3}[-./]\d{3}[-./]\d{2}$/;
  const rawCnpj = /^\d{14}$/;
  const formattedCnpj = /^\d{2}[-./]\d{3}[-./]\d{3}[-./]\d{4}[-./]\d{2}$/;

  return rawCpf.test(text) || formattedCpf.test(text) || rawCnpj.test(text) || formattedCnpj.test(text);
}

function isForeignOrInvalidDocStatusForAction(accountsValue) {
  const text = String(accountsValue ?? '').trim().toLowerCase();
  if (!text || text === '-' || text === '...') return false;
  return text.includes('estrangeiro') || text.includes('inválido') || text.includes('invalido');
}

function isNoDocStatusForAction(docValue) {
  const text = String(docValue ?? '').trim().toLowerCase();
  if (!text || text === '-' || text === '...') return false;
  return text.includes('conta sem doc');
}

function resolveFaturasActionTarget({ doc, email, accounts }) {
  const docValue = normalizeDocForAction(doc);
  const emailValue = normalizeEmailForAction(email);
  const canUseEmail = isForeignOrInvalidDocStatusForAction(accounts) || isNoDocStatusForAction(doc);

  if (canUseEmail && emailValue) return { value: emailValue, mode: 'email' };
  if (docValue && hasValidDocLengthForAction(docValue)) return { value: docValue, mode: 'doc' };
  return null;
}

function resolveNutrorActionTarget({ doc, email, accounts }) {
  const docValue = normalizeDocForAction(doc);
  const emailValue = normalizeEmailForAction(email);
  const canUseEmail = isNoDocStatusForAction(doc) || isForeignOrInvalidDocStatusForAction(accounts);

  if (docValue && hasValidDocLengthForAction(docValue)) return { value: docValue, mode: 'doc' };
  if (canUseEmail && emailValue) return { value: emailValue, mode: 'email' };
  return null;
}

function resolveOrbitaActionTarget({ doc, email, accounts }) {
  return resolveNutrorActionTarget({ doc, email, accounts });
}

function normalizeActionKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'orbita' || key === 'faturas' || key === 'nutror' || key === 'contratos') return key;
  return null;
}

function applyBOTabState(state) {
  const armedAction = normalizeActionKey(state?.armedAction);
  const actionTabs = state?.actionTabs || {};
  boTabState = {
    boTab1Assigned: !!state?.boTab1Assigned,
    boTab2Assigned: !!state?.boTab2Assigned,
    backOffice2TabsAssigned: [0, 1].map((index) =>
      !!state?.backOffice2TabsAssigned?.[index]),
    requiredTabsAssigned: !!state?.requiredTabsAssigned,
    requiredTabsReady: !!state?.requiredTabsReady,
    armedSlot: state?.armedSlot ?? null,
    armedAction,
    actionTabs: {
      orbita: !!actionTabs.orbita,
      faturas: !!actionTabs.faturas,
      nutror: !!actionTabs.nutror,
      contratos: !!actionTabs.contratos
    }
  };
  boTabStateResolved = true;
  renderPopup();
}

function resolveContratosActionTarget({ doc, email, accounts }) {
  return resolveNutrorActionTarget({ doc, email, accounts });
}

function hasAnyAssignedBOTab() {
  return !!(
    boTabState.boTab1Assigned ||
    boTabState.boTab2Assigned ||
    boTabState.actionTabs?.orbita ||
    boTabState.actionTabs?.faturas ||
    boTabState.actionTabs?.nutror ||
    boTabState.actionTabs?.contratos
  );
}

function renderBOTabButtons() {
  if (!popup) return;
  const resetBtn = popup.querySelector('#th-btn-bo-reset');
  if (!resetBtn) return;

  if (resetBtn) {
    const launchMode = !boTabState.requiredTabsAssigned;
    resetBtn.classList.toggle('is-launch-mode', launchMode);
    resetBtn.title = launchMode ? 'Lançar Abas Backoffice' : 'Limpar abas BO';
    resetBtn.setAttribute('aria-label', launchMode ? 'Lançar Abas Backoffice' : 'Limpar abas BO');
  }
  updateBOTabsHint();
  updateActionButtonsState();
}

function updateBOTabsHint() {
  if (!popup) return;
  const hint = popup.querySelector('#th-bo-hint');
  const hintText = popup.querySelector('#th-bo-hint-text');
  if (!hint || !hintText) return;

  let message = '';
  let requiredTabsUnavailable = false;

  if (!boTabState.requiredTabsAssigned) {
    message = 'atribua as quatro abas BO1 e BO2';
    requiredTabsUnavailable = true;
  } else if (!boTabState.requiredTabsReady) {
    message = 'retorne as abas aos sites BO1 e BO2';
    requiredTabsUnavailable = true;
  }

  if ((!requiredTabsUnavailable && boTabsHintDismissed) || !message) {
    hint.classList.remove('is-visible');
  } else {
    hintText.textContent = message;
    hint.classList.add('is-visible');
  }

  updateActionTabsHint();
}

function updateActionTabsHint() {
  if (!popup) return;
  const hint = popup.querySelector('#th-action-hint');
  const hintText = popup.querySelector('#th-action-hint-text');
  if (!hint || !hintText) return;

  const hasSpecificActionTab = !!(
    boTabState.actionTabs?.orbita ||
    boTabState.actionTabs?.faturas ||
    boTabState.actionTabs?.nutror ||
    boTabState.actionTabs?.contratos
  );
  const shouldShow = !boActionHintDismissed && !boTabState.boTab2Assigned && !hasSpecificActionTab;

  if (!shouldShow) {
    hint.classList.remove('is-visible');
    return;
  }

  hintText.textContent = 'ou defina abas específicas';
  hint.classList.add('is-visible');
}

async function requestBOTabState() {
  const resp = await msgBg({ action: 'GET_BO_TAB_STATE' });
  if (!resp?.state) return;

  applyBOTabState(resp.state);
  renderBOTabButtons();
}





function bindRowClicks() {

  popup.querySelector('#th-id-row').addEventListener('click', () => {
    if (!isCopyablePopupValue(String(localData.id ?? ''))) return;
    copyValue(String(localData.id), 'id');
  });

  popup.querySelector('#th-name-row').addEventListener('click', () => {
    const v = localData.name;
    if (!isCopyablePopupValue(v)) return;
    copyValue(v.includes('@') ? v : v.split(' ')[0], 'name');
  });

  popup.querySelector('#th-email-row').addEventListener('click', () => {
    const v = localData.email;
    if (!isCopyablePopupValue(v)) return;
    copyValue(v, 'email');
  });

  popup.querySelector('#th-doc-row').addEventListener('click', () => {
    const v = localData.doc;
    if (!isCopyablePopupValue(v)) return;
    copyValue(v, 'doc');
  });

  popup.querySelector('#th-accounts-row').addEventListener('click', () => {
    if (!boTabStateResolved) return;
    if (!boTabState.backOffice2TabsAssigned[0]) {
      flashCopiedValue('accounts', Date.now());
      runBOSetupAction();
      return;
    }
    if (!/^.+ \| (?:[1-4]|5\+)$/.test(String(localData.accounts || '')) ||
        !currentTicketId) return;
    msgBg({ action: 'COPY_BO2_MASKED_EMAILS', ticketId: currentTicketId,
      processId: currentProcessId });
  });
}

function copyValue(text, field) {
  copyTextToClipboard(text).then(ok => {
    if (ok) flashCopiedValue(field, Date.now());
  }).catch(() => {});
}

function clearCopyFeedback() {
  for (const timer of copyFeedbackTimers.values()) clearTimeout(timer);
  copyFeedbackTimers.clear();
  popup?.querySelectorAll('.is-copy-success').forEach(row => row.classList.remove('is-copy-success'));
  popup?.querySelectorAll('.is-bo-missing').forEach(element => element.classList.remove('is-bo-missing'));
}

function setCopyFlashWidth(row, valueElement) {
  if (!valueElement) return;
  if (!popupValueMeasureContext) {
    popupValueMeasureContext = document.createElement('canvas').getContext('2d');
  }
  if (!popupValueMeasureContext) return;
  popupValueMeasureContext.font = getComputedStyle(valueElement).font;
  const textWidth = Math.ceil(popupValueMeasureContext.measureText(
    valueElement.textContent || '').width);
  row.style.setProperty('--th-copy-flash-width',
    `${Math.min(textWidth, valueElement.clientWidth || row.clientWidth) + 8}px`);
}

function flashCopiedValue(field, copiedAt) {
  if (!['id', 'name', 'email', 'doc', 'accounts'].includes(field)) return;
  if (!popup || popup.style.display === 'none' || document.visibilityState !== 'visible') return;
  if (!Number.isFinite(copiedAt) || Date.now() - copiedAt > 500) return;
  const target = popup?.querySelector(`#th-${field}-row`);
  if (!target) return;

  clearTimeout(copyFeedbackTimers.get(field));
  setCopyFlashWidth(target, target.querySelector('.th-val'));
  target.classList.add('is-copy-success');
  for (const animation of target.getAnimations({ subtree: true })) {
    if (animation.animationName === 'th-copy-success') {
      animation.currentTime = 0;
      animation.play();
    }
  }
  copyFeedbackTimers.set(field, setTimeout(() => {
    target.classList.remove('is-copy-success');
    copyFeedbackTimers.delete(field);
  }, 800));
}

function flashBlockedBOAction(triggeredAt, missingTab, blockedField) {
  if (!enabled || !popup || document.visibilityState !== 'visible' ||
      getComputedStyle(popup).visibility !== 'visible' ||
      !Number.isFinite(triggeredAt) || Date.now() - triggeredAt > 500) return;
  const launchButton = missingTab ? popup.querySelector('#th-btn-bo-reset') : null;
  const shownAccountsRow = popup.querySelector('#th-accounts-row');
  const accountsRow = missingTab && !historyViewOpen &&
    shownAccountsRow?.querySelector('.th-val')?.textContent === 'Atribuir BO'
    ? shownAccountsRow : null;
  const warningRow = !historyViewOpen && ['email', 'doc'].includes(blockedField)
    ? popup.querySelector(`#th-${blockedField}-row`) : null;
  for (const [key, element] of [['bo-missing-launch', launchButton],
    ['bo-missing-accounts', accountsRow], [`bo-blocked-${blockedField}`, warningRow]]) {
    if (!element) continue;
    clearTimeout(copyFeedbackTimers.get(key));
    element.classList.remove('is-copy-success', 'is-bo-missing');
    if (element !== launchButton) setCopyFlashWidth(element, element.querySelector('.th-val'));
    element.classList.add('is-bo-missing');
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation.animationName === 'th-bo-missing-flash') {
        animation.currentTime = 0;
        animation.play();
      }
    }
    copyFeedbackTimers.set(key, setTimeout(() => {
      element.classList.remove('is-bo-missing');
      copyFeedbackTimers.delete(key);
    }, 800));
  }
}

function flashHistoryRow(row, copiedAt) {
  if (!row?.isConnected || !popup || popup.style.display === 'none' ||
      document.visibilityState !== 'visible' ||
      !Number.isFinite(copiedAt) || Date.now() - copiedAt > 500) return;
  const idButton = row.querySelector('.th-history-id');
  if (!idButton) return;
  clearTimeout(copyFeedbackTimers.get(idButton));
  idButton.classList.add('is-copy-success');
  for (const animation of idButton.getAnimations({ subtree: true })) {
    if (animation.animationName === 'th-copy-success') {
      animation.currentTime = 0;
      animation.play();
    }
  }
  copyFeedbackTimers.set(idButton, setTimeout(() => {
    idButton.classList.remove('is-copy-success');
    copyFeedbackTimers.delete(idButton);
  }, 800));
}

function copyTextToClipboard(text) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    try {
      ta.select();
      return !!document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  };
  try {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(fallback);
    }
  } catch {}
  return Promise.resolve(fallback());
}


function injectStyles() {
  if (!window.TicketHelperPopupUI?.injectStyles) return;
  window.TicketHelperPopupUI.injectStyles(document, 'th-styles');
}

}
