if (window.__ticketHelperLoaded) {
  
} else {
window.__ticketHelperLoaded = true;




















let enabled        = false;
let popup          = null;
let lastUrl        = location.href;

let currentProcessId = null;
let currentTicketId  = null;


let localData = { id: null, name: null, email: null, doc: null, accounts: null };
let boTabState = {
  boTab1Assigned: false,
  boTab2Assigned: false,
  armedSlot: null,
  armedAction: null,
  actionTabs: { orbita: false, faturas: false, nutror: false, contratos: false }
};
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
let checkmarkTimers  = {};
let routeEventHandler = null;
let hyperflowListClickHandler = null;
let hubspotTicketClickHandler = null;
let historyHooksInstalled = false;
let lastFaturasRefreshTicketId = null;
let pendingHubSpotTicketId = null;
let pendingHubSpotTicketStartedAt = 0;
let ticketTransitionRetryTimers = [];
let ticketExtractionNudgeTimer = null;
let trustedHubSpotUrlTicketId = null;
let trustedHubSpotUrlTicketUntil = 0;
let producerWarningRules = [];
let producerWarningObserver = null;
let producerWarningScanTimer = null;
let producerWarningSafetyTimer = null;
let producerWarningScrollHandler = null;
let internalShortcuts = {};
let internalShortcutKeydownHandler = null;
let historyViewOpen = false;
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
  return !!text && text !== '-' && text !== '...' && !text.startsWith('>');
}

function waitForBody(cb) {
  if (document.body) cb();
  else document.addEventListener('DOMContentLoaded', cb, { once: true });
}

function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}





const PRODUCER_WARNINGS_KEY = 'producerWarningRules';
const INTERNAL_SHORTCUTS_KEY = 'internalShortcuts';
const INTERNAL_SHORTCUT_ACTIONS = {
  'copy-bo1-masked-emails': ''
};

function isHubSpot()     { return location.hostname.includes('hubspot.com'); }
function isHyperflow()   { return location.hostname === 'conversas.hyperflow.global'; }
function isBackOffice()  { return location.hostname === 'bo.eduzz.com'; }
function isValidDomain() { return isHubSpot() || isHyperflow(); }

function normalizeInternalShortcutCombo(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const parts = text.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const modifiers = new Set();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') modifiers.add('Ctrl');
    else if (lower === 'alt') modifiers.add('Alt');
    else if (lower === 'shift') modifiers.add('Shift');
    else key = part;
  }
  if (!modifiers.size || !/^[a-z0-9]$/i.test(key)) return '';
  return [...['Ctrl', 'Alt', 'Shift'].filter(mod => modifiers.has(mod)), key.toUpperCase()].join('+');
}

function normalizeInternalShortcuts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const action of Object.keys(INTERNAL_SHORTCUT_ACTIONS)) {
    const rawShortcut = Object.prototype.hasOwnProperty.call(source, action)
      ? source[action]
      : INTERNAL_SHORTCUT_ACTIONS[action];
    normalized[action] = normalizeInternalShortcutCombo(rawShortcut);
  }
  return normalized;
}

function getInternalShortcutComboFromEvent(event) {
  if (!event || event.metaKey || event.repeat) return null;
  const codeMatch = String(event.code || '').match(/^(?:Digit|Numpad)(\d)$/);
  const key = codeMatch
    ? codeMatch[1]
    : /^[a-z0-9]$/i.test(String(event.key || '')) ? String(event.key).toUpperCase() : '';
  if (!key) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (!parts.length) return null;
  parts.push(key);
  return parts.join('+');
}

function executeInternalShortcutAction(action) {
  if (action === 'copy-bo1-masked-emails') {
    msgBg({ action: 'COPY_BO1_MASKED_EMAILS' });
  }
}

function startInternalShortcutHandler() {
  if (internalShortcutKeydownHandler) return;
  internalShortcutKeydownHandler = (event) => {
    if (!enabled) return;
    if (!isBackOffice() && !isValidDomain()) return;

    const shortcutCombo = getInternalShortcutComboFromEvent(event);
    if (!shortcutCombo) return;
    const action = Object.keys(internalShortcuts)
      .find(actionKey => internalShortcuts[actionKey] === shortcutCombo && Object.prototype.hasOwnProperty.call(INTERNAL_SHORTCUT_ACTIONS, actionKey));
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();
    executeInternalShortcutAction(action);
  };
  document.addEventListener('keydown', internalShortcutKeydownHandler, true);
}

function stopInternalShortcutHandler() {
  if (!internalShortcutKeydownHandler) return;
  document.removeEventListener('keydown', internalShortcutKeydownHandler, true);
  internalShortcutKeydownHandler = null;
}

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
  if (!isHubSpot()) return false;

  
  if (/\/ticket\/\d+/.test(location.href)) return true;

  
  if (!/\/help-desk\//.test(location.href)) return false;
  if (!/\/thread\//.test(location.href)) return false;

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
    return { ticketId: fromDom, waitForDom: false };
  }

  if (fromUrl && fromDom && fromDom !== fromUrl && fromUrl === currentTicketId && !currentProcessId) {
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





chrome.storage.local.get(['enabled', INTERNAL_SHORTCUTS_KEY], (data) => {
  internalShortcuts = normalizeInternalShortcuts(data?.[INTERNAL_SHORTCUTS_KEY]);
  const e = data?.enabled;
  enabled = !!e;
  if (enabled) init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (INTERNAL_SHORTCUTS_KEY in changes) {
    internalShortcuts = normalizeInternalShortcuts(changes[INTERNAL_SHORTCUTS_KEY].newValue);
  }

  if (PRODUCER_WARNINGS_KEY in changes) {
    producerWarningRules = normalizeProducerWarningRules(changes[PRODUCER_WARNINGS_KEY].newValue);
    if (isBackOffice() && enabled) scheduleProducerWarningScan(0);
  }

  if (!('enabled' in changes)) return;
  enabled = !!changes.enabled.newValue;
  if (enabled) init();
  else teardown();
});

function init() {
  
  startInternalShortcutHandler();

  if (isBackOffice()) {
    waitForBody(() => startProducerWarningWatcher());
    return;
  }

  if (!isValidDomain()) return;
  waitForBody(() => {
    
    
    document.querySelectorAll('#ticket-helper-popup').forEach((el) => el.remove());
    injectStyles();
    if (!popup) createPopup();
    startUrlObserver();
    if (isHyperflow()) startHyperflowListClickObserver();
    if (isHubSpot()) startHubSpotTicketClickObserver();
    
    onFocusGained(true);
  });
}

function teardown() {
  
  stopInternalShortcutHandler();
  stopProducerWarningWatcher();
  popup?.remove();
  popup = null;
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
    if (!enabled || !popup) return;

    let changed = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      changed = true;
    }

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
    if (routeCheckTimer) clearTimeout(routeCheckTimer);
    routeCheckTimer = setTimeout(checkRouteChange, delay);
  };

  if (!historyHooksInstalled) {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };

    historyHooksInstalled = true;
  }

  routeEventHandler = () => scheduleRouteCheck(0);
  window.addEventListener('popstate', routeEventHandler);
  window.addEventListener('hashchange', routeEventHandler);
  window.addEventListener('ticket-helper-route-change', routeEventHandler);

  urlObserver = new MutationObserver(() => scheduleRouteCheck(120));
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
  setTimeout(onFocusGained, 150);
});

document.addEventListener('visibilitychange', () => {
  if (!enabled || !popup) return;
  if (document.visibilityState === 'hidden') {
    return;
  }
  if (document.visibilityState === 'visible') setTimeout(onFocusGained, 150);
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(clampPopup, 120);
});

function primeTicketSwitch(ticketId) {
  if (!ticketId) return;
  if (ticketId === currentTicketId && currentProcessId) return;

  resetProcess();
  currentTicketId = ticketId;
  localData.id = ticketId;
  renderPopup();
  scheduleTicketExtractionNudge(ticketId);
}

function hasPendingGatherFields() {
  return localData.name === null || localData.email === null || localData.doc === null || localData.accounts === null;
}






function onPageChange() {
  
  if (!popup) return;
  if (!isTicketPage()) { leaveTicket(); return; }
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
  if (!isTicketPage()) { leaveTicket(); return; }
  const { ticketId, waitForDom } = getCurrentTicketTransitionState();
  if (!ticketId) { leaveTicket(); return; }
  if (waitForDom) {
    primeTicketSwitch(ticketId);
    scheduleTicketTransitionRetry();
    return;
  }
  if (force || ticketId !== currentTicketId || !currentProcessId) {
    primeTicketSwitch(ticketId);
  }
  enterTicket(ticketId, force);
}

function leaveTicket() {
  clearTimeout(extractionTimer);
  clearPendingHubSpotTicket();
  if (!currentTicketId) return; 
  resetProcess();
  renderPopup();
  msgBg({ action: 'TICKET_EXITED' });
}





async function enterTicket(ticketId, force = false) {
  
  
  
  if (force || ticketId !== currentTicketId || !currentProcessId) {
    clearTimeout(extractionTimer);
  }

  const resp = await msgBg({ action: 'TICKET_DETECTED', ticketId, forceNew: force });
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

    currentTicketId  = ticketId;
    currentProcessId = resp.processId;
    clearTicketExtractionNudgeTimer();
    
    if (resp.data) {
      localData = {
        id:       resp.data.id       ?? ticketId,
        name:     resp.data.name     ?? null,
        email:    resp.data.email    ?? null,
        doc:      resp.data.doc      ?? null,
        accounts: resp.data.accounts ?? null
      };
      renderPopup();
    }
    requestAutoFaturasRefreshOnTicketSwitch(ticketId, resp.processId);
    if (hasPendingGatherFields()) {
      if (isHubSpot()) extractHubSpot(resp.processId, ticketId, true);
      if (isHyperflow()) extractHyperflow(resp.processId, ticketId);
    }
    return;
  }

  
  const keepTrustedHubSpotUrl =
    isHubSpot() &&
    isTrustedHubSpotUrlTicket(ticketId) &&
    extractHubSpotTicketIdFromText(location.href) === ticketId;

  resetProcess();
  if (keepTrustedHubSpotUrl) markTrustedHubSpotUrlTicket(ticketId);
  currentTicketId  = ticketId;
  localData.id     = ticketId;
  currentProcessId = resp.processId;
  clearTicketExtractionNudgeTimer();
  lastFaturasRefreshTicketId = ticketId;
  renderPopup();

  
  
  const buffered = pendingPopupUpdates[currentProcessId];
  if (buffered?.length) {
    for (const fields of buffered) Object.assign(localData, fields);
    renderPopup();
  }
  delete pendingPopupUpdates[currentProcessId];

  if (isHubSpot())   extractHubSpot(resp.processId, ticketId, force);
  if (isHyperflow()) extractHyperflow(resp.processId, ticketId);
}

function requestAutoFaturasRefreshOnTicketSwitch(ticketId, processId) {
  if (!ticketId) return;
  if (lastFaturasRefreshTicketId === ticketId) return;
  lastFaturasRefreshTicketId = ticketId;
  msgBg({ action: 'SYNC_ACTIVE_TICKET_CONTEXT', processId });
}


















function extractHubSpot(processId, ticketId, isForcedStart = false) {
  
  const TAG_ROOT_SEL = '.EmailTagDisplayBar__StyledDiv-bJtzuP [data-component-name="UITag"]';
  const TAG_CONTAINER_SEL = '.EmailTagDisplayBar__StyledDiv-bJtzuP';
  const CONTACT_SEL = '#contact-select [data-option-text="true"]';
  const CHICKLET_SEL = 'a[data-test-id="contact-chicklet-email"][href^="mailto:"], a[data-selenium-test="contact-chicklet-email"][href^="mailto:"]';

  let extractionWatchdog = null;
  let tagWaitTimer = null;
  let tagObserver = null;
  let matchedLabelProbeCleanup = null;
  let noEmailRetryUsed = false;
  let noEmailRetryRunning = false;

  function isCurrent() {
    return currentProcessId === processId;
  }

  function cleanupExtractionTimers() {
    clearTimeout(extractionWatchdog);
    stopMatchedLabelProbe();
    if (tagWaitTimer) {
      clearTimeout(tagWaitTimer);
      tagWaitTimer = null;
    }
    if (tagObserver) {
      tagObserver.disconnect();
      tagObserver = null;
    }
  }

  function sendEmail(email) {
    if (emailSent) return;
    if (!isCurrent()) return;
    const observedTicketId = extractTicketId();
    const urlTicketId = isHubSpot() ? extractHubSpotTicketIdFromText(location.href) : null;
    if ((!observedTicketId || observedTicketId !== ticketId) && urlTicketId !== ticketId) {
      setTimeout(() => { if (enabled && popup) onPageChange(); }, 90);
      return;
    }
    cleanupExtractionTimers();
    emailSent = true;
    localData.email = email;
    renderPopup();
    msgBg({ action: 'DATA_EXTRACTED', processId, email });
  }

  function setNameIfNeeded(text) {
    
    
    return;
  }

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9@._+\-\s]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getHubSpotExtractionRoot() {
    const candidates = [];
    const addRoot = (root) => {
      if (!root || candidates.includes(root)) return;
      candidates.push(root);
    };

    document.querySelectorAll('[data-test-id="ticket-panel-close-button"], [data-test-id="ticket-panel-enlarge-button"]').forEach(el => {
      addRoot(el.closest('[data-component-name="Panel"]'));
      addRoot(el.closest('[data-layer-for="Panel"]'));
    });

    document.querySelectorAll('[data-component-name="Panel"][data-open-complete="true"], [data-component-name="Panel"]').forEach(addRoot);

    const activeHeader =
      document.querySelector('[data-test-id="ticket-header-name-link"]') ||
      document.querySelector('[data-test-id="ticket-header-contact-detail-link"]');
    if (activeHeader) {
      addRoot(activeHeader.closest('[data-component-name="Panel"]'));
      addRoot(activeHeader.closest('[data-layer-for="Panel"]'));
      addRoot(activeHeader.closest('main'));
    }

    const rootBelongsToCurrentTicket = (root) => {
      if (!root || !document.contains(root)) return false;
      const links = Array.from(root.querySelectorAll?.('a[href]') || []);
      if (links.some(link => extractHubSpotTicketIdFromHref(link.href || link.getAttribute('href') || '') === ticketId)) {
        return true;
      }
      return (root.textContent || '').includes(ticketId);
    };

    const ticketScoped = candidates.find(rootBelongsToCurrentTicket);

    return ticketScoped || candidates.find(root => root && document.contains(root)) || document;
  }

  function queryInTicketRoot(selector) {
    const root = getHubSpotExtractionRoot();
    const scoped = root.querySelector?.(selector) || null;
    if (scoped || (root && root !== document && root !== document.documentElement && root !== document.body)) return scoped;
    return document.querySelector(selector);
  }

  function queryAllInTicketRoot(selector) {
    const root = getHubSpotExtractionRoot();
    const scoped = Array.from(root.querySelectorAll?.(selector) || []);
    if (scoped.length) return scoped;
    if (root && root !== document && root !== document.documentElement && root !== document.body) return [];
    return Array.from(document.querySelectorAll(selector));
  }

  function getTicketOpenerLabel() {
    const el =
      queryInTicketRoot('[data-test-id="ticket-header-contact-detail-link"] [data-content="true"]') ||
      queryInTicketRoot('[data-test-id="ticket-header-contact-detail-link"] a') ||
      queryInTicketRoot('[role="heading"] [data-test-id="ticket-header-contact-detail-link"]');
    return el?.innerText?.trim() || null;
  }

  function dispatchHover(target) {
    if (!target || !document.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const fallbackX = Math.min(Math.max(window.innerWidth / 2, 1), Math.max(window.innerWidth - 2, 1));
    const fallbackY = Math.min(Math.max(window.innerHeight / 2, 1), Math.max(window.innerHeight - 2, 1));
    const clientX = rect.width > 0 ? rect.left + Math.max(1, rect.width / 2) : fallbackX;
    const clientY = rect.height > 0 ? rect.top + Math.max(1, rect.height / 2) : fallbackY;
    const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, relatedTarget: null };
    target.dispatchEvent(new MouseEvent('mouseenter', eventInit));
    target.dispatchEvent(new MouseEvent('mouseover', eventInit));
    target.dispatchEvent(new MouseEvent('mousemove', eventInit));
    if (typeof PointerEvent === 'function') {
      const pointerInit = { ...eventInit, pointerType: 'mouse', isPrimary: true };
      target.dispatchEvent(new PointerEvent('pointerenter', pointerInit));
      target.dispatchEvent(new PointerEvent('pointerover', pointerInit));
      target.dispatchEvent(new PointerEvent('pointermove', pointerInit));
    }
  }

  function dispatchNonScrollActivation(target) {
    if (!target || !document.contains(target)) return;
    try { target.focus?.({ preventScroll: true }); } catch (_) {}
    dispatchHover(target);
    target.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true, composed: true }));
    target.dispatchEvent(new Event('mouseenter', { bubbles: true, cancelable: true, composed: true }));
    target.dispatchEvent(new Event('mouseover', { bubbles: true, cancelable: true, composed: true }));
  }

  function pokeLazyRequesterMount(sectionRoot, header = null) {
    const targets = [
      header,
      header?.querySelector?.('[role="button"][aria-expanded]'),
      sectionRoot,
      sectionRoot?.querySelector?.('[role="button"][aria-expanded]')
    ].filter((el, index, arr) => el && document.contains(el) && arr.indexOf(el) === index);

    for (const target of targets) dispatchNonScrollActivation(target);

    const scrollRoots = [
      sectionRoot?.closest?.('[style*="overflow"]'),
      sectionRoot?.closest?.('[class*="PanelBody"]'),
      sectionRoot?.closest?.('[data-component-name="Panel"]'),
      document.scrollingElement,
      document.documentElement,
      window
    ].filter((el, index, arr) => el && arr.indexOf(el) === index);

    for (const root of scrollRoots) {
      try {
        root.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
      } catch (_) {}
    }

    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  }

  function getScrollableRequesterRoots(sectionRoot) {
    const roots = [];
    const addRoot = (root) => {
      if (!root || roots.includes(root)) return;
      if (root === window) return;
      if (!root.scrollTo && typeof root.scrollTop !== 'number') return;
      if ((root.scrollHeight || 0) <= (root.clientHeight || 0) + 2) return;
      roots.push(root);
    };

    let el = sectionRoot?.parentElement || null;
    while (el && el !== document.body && el !== document.documentElement) {
      try {
        const style = window.getComputedStyle(el);
        const overflow = `${style.overflowY} ${style.overflow}`;
        if (/(auto|scroll|overlay)/i.test(overflow)) addRoot(el);
      } catch (_) {}
      el = el.parentElement;
    }

    addRoot(sectionRoot?.closest?.('[class*="PanelBody"]'));
    addRoot(sectionRoot?.closest?.('[data-component-name="Panel"]')?.querySelector?.('[class*="PanelBody"]'));
    addRoot(document.scrollingElement || document.documentElement);
    return roots;
  }

  function setScrollTopFast(root, top) {
    if (!root) return;
    try {
      const previousBehavior = root.style?.scrollBehavior || '';
      if (root.style) root.style.scrollBehavior = 'auto';
      root.scrollTop = Math.max(0, top);
      root.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
      if (root.style) root.style.scrollBehavior = previousBehavior;
    } catch (_) {}
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function waitForMountedRequesterRead(read, sectionRoot, maxMs = 120) {
    const immediate = read();
    if (immediate) return Promise.resolve(immediate);

    return new Promise(resolve => {
      let done = false;
      let interval = null;
      let timeout = null;
      let observer = null;
      let raf = null;

      const finish = (email = null) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        if (raf) cancelAnimationFrame(raf);
        resolve(email);
      };

      const check = () => {
        if (!isCurrent() || emailSent || !document.contains(sectionRoot)) {
          finish(null);
          return;
        }

        const email = read();
        if (email) finish(email);
      };

      observer = new MutationObserver(check);
      observer.observe(sectionRoot, { childList: true, subtree: true, characterData: true, attributes: true });
      interval = setInterval(check, 8);
      raf = requestAnimationFrame(check);
      timeout = setTimeout(() => finish(null), maxMs);
      check();
    });
  }

  async function temporarilyMountRequesterContent(sectionRoot, ownerRaw = null, header = null, maxMs = 90) {
    if (!sectionRoot || !document.contains(sectionRoot)) return null;

    const read = () => (
      getRequesterOwnerEmail(sectionRoot, ownerRaw) ||
      (!ownerRaw ? findEmailInNode(sectionRoot) : null) ||
      (!ownerRaw ? findEmailInNode(header?.parentElement || header) : null)
    );

    const immediate = read();
    if (immediate) return immediate;

    const scrollRoots = getScrollableRequesterRoots(sectionRoot);
    const started = Date.now();

    for (const scrollRoot of scrollRoots) {
      if (!isCurrent() || emailSent || Date.now() - started >= maxMs) return null;
      if (!document.contains(scrollRoot) && scrollRoot !== document.scrollingElement) continue;

      const bottom = Math.max(0, (scrollRoot.scrollHeight || 0) - (scrollRoot.clientHeight || 0));
      setScrollTopFast(scrollRoot, bottom);
      pokeLazyRequesterMount(sectionRoot, header);

      await nextFrame();
      if (!isCurrent() || emailSent) {
        setScrollTopFast(scrollRoot, 0);
        return null;
      }

      const remainingMs = Math.max(18, Math.min(55, maxMs - (Date.now() - started)));
      const mountedEmail = await waitForMountedRequesterRead(read, sectionRoot, remainingMs);
      setScrollTopFast(scrollRoot, 0);
      if (mountedEmail) return mountedEmail;
    }

    return null;
  }

  function revealForExtraction(target) {
    // Email gathering should never scroll the ticket UI. Some HubSpot sections
    // can still be opened/read while off-screen, so this intentionally no-ops.
    void target;
  }

  function getTagHoverTarget(tag) {
    if (!tag) return null;
    return tag.rootEl || tag.labelEl || null;
  }

  function stopMatchedLabelProbe() {
    if (!matchedLabelProbeCleanup) return;
    matchedLabelProbeCleanup();
    matchedLabelProbeCleanup = null;
  }

  function getTagEntries() {
    return queryAllInTicketRoot(TAG_ROOT_SEL)
      .map(rootEl => {
        const contentEl =
          rootEl.querySelector('[data-content="true"]') ||
          rootEl.querySelector('span[tabindex]') ||
          rootEl;
        const text = contentEl?.innerText?.trim() || rootEl.innerText?.trim() || '';
        return {
          rootEl,
          labelEl: contentEl,
          text,
          email: extractEmail(text),
          norm: normalizeText(text)
        };
      })
      .filter(t => t.text);
  }

  function hasMoreContactsIndicator() {
    const container = queryInTicketRoot(TAG_CONTAINER_SEL);
    if (!container) return false;

    const controls = Array.from(container.querySelectorAll('button, [role="button"], i18n-string'));
    return controls.some(el => /^\+\s*\d+\s*(more|mais)\b/i.test((el.innerText || '').trim()));
  }

  function getSingleVisibleTag(existingTags = null) {
    const tags = Array.isArray(existingTags) ? existingTags : getTagEntries();
    if (tags.length !== 1) return null;
    if (hasMoreContactsIndicator()) return null;
    return tags[0];
  }

  function findEmailInNode(root) {
    if (!root) return null;

    const mailto = root.querySelector('a[href^="mailto:"]');
    if (mailto) {
      const hrefEmail = extractEmail((mailto.getAttribute('href') || '').replace('mailto:', ''));
      if (hrefEmail) return hrefEmail;
      const txtEmail = extractEmail(mailto.innerText || '');
      if (txtEmail) return txtEmail;
    }

    const candidates = root.querySelectorAll('a, span, div, td, p');
    for (const el of candidates) {
      const email = extractEmail(el.innerText || '');
      if (email) return email;
    }

    return extractEmail(root.innerText || '');
  }

  function isRequesterTitle(text) {
    const n = normalizeText(text || '');
    if (!n) return false;
    return n.includes('requerente') || n.includes('requester') || n.includes('applicant');
  }

  function isAddContactText(text) {
    const n = normalizeText(text || '');
    return !!n && (
      n.includes('add contact') ||
      n.includes('adicionar contato') ||
      n.includes('associar contato')
    );
  }

  function hasRequesterZeroMarker() {
    const titleEls = queryAllInTicketRoot('[data-selenium-test="crm-card-title"], h2, [role="heading"]');
    return titleEls.some(el => {
      const text = el.innerText || el.textContent || '';
      if (!isRequesterTitle(text)) return false;
      const countMatch = text.match(/\((\d+)\)/);
      return countMatch ? Number(countMatch[1]) === 0 : false;
    });
  }

  function hasHubSpotNoContactMarker() {
    const openerRaw = getTicketOpenerLabel();
    if (isAddContactText(openerRaw)) return true;
    return hasRequesterZeroMarker();
  }

  function isNameMatch(ownerNorm, candidateNorm) {
    if (!ownerNorm || !candidateNorm) return false;
    if (ownerNorm === candidateNorm) return true;
    if (ownerNorm.length >= 6 && candidateNorm.includes(ownerNorm)) return true;
    if (candidateNorm.length >= 6 && ownerNorm.includes(candidateNorm)) return true;
    return false;
  }

  function getRequesterOwnerEmail(sectionRoot, ownerRaw) {
    if (!sectionRoot) return null;
    const ownerNorm = normalizeText(ownerRaw || '');
    if (!ownerNorm) return null;

    const tiles = Array.from(sectionRoot.querySelectorAll(
      '[data-test-id^="chiclet-0-1-"], [data-test-id^="chicklet-"], [data-selenium-test="chicklet"]'
    ));

    for (const tile of tiles) {
      const nameNode =
        tile.querySelector('[data-selenium-test="contact-chicklet-title-link"]') ||
        tile.querySelector('[data-test-id="contact-chicklet-title-link"]') ||
        tile.querySelector('[data-test-id="contact-chicklet-title"]') ||
        tile.querySelector('a[href*="/record/0-1/"]');
      const contactNameNorm = normalizeText(nameNode?.innerText || '');
      if (!isNameMatch(ownerNorm, contactNameNorm)) continue;

      const emailNode =
        tile.querySelector('a[data-test-id="contact-chicklet-email"][href^="mailto:"]') ||
        tile.querySelector('a[href^="mailto:"]');
      const byHref = extractEmail((emailNode?.getAttribute('href') || '').replace('mailto:', ''));
      if (byHref) return byHref;

      const byText = extractEmail(emailNode?.innerText || '');
      if (byText) return byText;

      const byNode = findEmailInNode(tile);
      if (byNode) return byNode;
    }

    
    if (tiles.length === 1) {
      const onlyEmail = findEmailInNode(tiles[0]);
      if (onlyEmail) return onlyEmail;
    }

    return null;
  }

  function getRequesterSectionRoot() {
    return (
      queryInTicketRoot('[data-sidebar-key="Requerente"]') ||
      queryInTicketRoot('[data-sidebar-key="Requester"]') ||
      queryInTicketRoot('[data-sidebar-card-association-object-type-id="0-1"]') ||
      queryInTicketRoot('[data-test-id="card-wrapper-ASSOCIATION_V3/0-1"]') ||
      null
    );
  }

  function findRequesterSectionFromTitle() {
    const titleEls = queryAllInTicketRoot('[data-selenium-test="crm-card-title"], h2, [role="heading"]');
    const requesterTitleEl = titleEls.find(el => isRequesterTitle(el.innerText || ''));
    if (!requesterTitleEl) return { sectionRoot: null, header: null };

    const header =
      requesterTitleEl.closest('[class*="ExpandableSection__ExpandableHeader"]') ||
      requesterTitleEl.closest('.ExpandableSection__ExpandableHeader-hBFtMA') ||
      requesterTitleEl.closest('div');

    const sectionRoot =
      requesterTitleEl.closest('[class*="ExpandableSection"]') ||
      header?.parentElement ||
      requesterTitleEl.parentElement ||
      null;

    return { sectionRoot, header };
  }

  function getRequesterSectionParts() {
    const directRoot = getRequesterSectionRoot();
    if (directRoot) {
      return {
        sectionRoot: directRoot,
        header:
          directRoot.querySelector('[class*="ExpandableSection__ExpandableHeader"]') ||
          directRoot.querySelector('.ExpandableSection__ExpandableHeader-hBFtMA') ||
          directRoot
      };
    }

    return findRequesterSectionFromTitle();
  }

  async function ensureRequesterSectionExpanded(maxMs = 500, reveal = false) {
    const started = Date.now();

    while (Date.now() - started < maxMs) {
      if (!isCurrent() || emailSent) return null;

      const { sectionRoot, header } = getRequesterSectionParts();
      if (sectionRoot) {
        if (reveal) revealForExtraction(header || sectionRoot);

        const toggle =
          header?.querySelector('[role="button"][aria-expanded]') ||
          sectionRoot.querySelector('[role="button"][aria-expanded]');

        if (toggle?.getAttribute('aria-expanded') === 'false') {
          toggle.click();
          await new Promise(r => setTimeout(r, 40));
        }

        pokeLazyRequesterMount(sectionRoot, header);

        return sectionRoot;
      }

      await new Promise(r => setTimeout(r, 35));
    }

    return null;
  }

  function waitForRequesterEmailMount(sectionRoot, ownerRaw = null, header = null, maxMs = 450) {
    if (!sectionRoot || !document.contains(sectionRoot)) return Promise.resolve(null);

    const read = () => (
      getRequesterOwnerEmail(sectionRoot, ownerRaw) ||
      (!ownerRaw ? findEmailInNode(sectionRoot) : null) ||
      (!ownerRaw ? findEmailInNode(header?.parentElement || header) : null)
    );

    const immediate = read();
    if (immediate) return Promise.resolve(immediate);

    return new Promise(resolve => {
      let done = false;
      let interval = null;
      let timeout = null;
      let observer = null;
      const started = Date.now();

      const finish = (email = null) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        resolve(email);
      };

      const check = () => {
        if (!isCurrent() || emailSent || !document.contains(sectionRoot)) {
          finish(null);
          return;
        }

        pokeLazyRequesterMount(sectionRoot, header);
        const email = read();
        if (email) {
          finish(email);
          return;
        }

        if (Date.now() - started >= maxMs) finish(null);
      };

      observer = new MutationObserver(check);
      observer.observe(sectionRoot, { childList: true, subtree: true, characterData: true, attributes: true });
      interval = setInterval(check, 35);
      timeout = setTimeout(() => finish(null), maxMs);
      check();
    });
  }

  async function resolveEmailFromRequesterSection(ownerRaw = null, maxMs = 750, reveal = false) {
    const started = Date.now();

    while (Date.now() - started < maxMs) {
      if (!isCurrent() || emailSent) return null;

      const { sectionRoot, header } = getRequesterSectionParts();

      if (sectionRoot) {
        if (reveal) revealForExtraction(header || sectionRoot);

        const toggle =
          header?.querySelector('[role="button"][aria-expanded]') ||
          sectionRoot.querySelector('[role="button"][aria-expanded]');

        if (toggle?.getAttribute('aria-expanded') === 'false') {
          toggle.click();
          await new Promise(r => setTimeout(r, 40));
          if (!isCurrent() || emailSent) return null;
        }

        pokeLazyRequesterMount(sectionRoot, header);

        const ownerMatchedEmail = getRequesterOwnerEmail(sectionRoot, ownerRaw);
        if (ownerMatchedEmail) return ownerMatchedEmail;

        if (!ownerRaw) {
          const emailInSection = findEmailInNode(sectionRoot);
          if (emailInSection) return emailInSection;

          const emailNearHeader = findEmailInNode(header?.parentElement || header);
          if (emailNearHeader) return emailNearHeader;
        }

        const remainingMs = maxMs - (Date.now() - started);
        if (remainingMs > 0) {
          const mountedEmail = await waitForRequesterEmailMount(
            sectionRoot,
            ownerRaw,
            header,
            Math.min(140, Math.max(60, remainingMs))
          );
          if (mountedEmail) return mountedEmail;
        }

        const silentMountedEmail = await temporarilyMountRequesterContent(
          sectionRoot,
          ownerRaw,
          header,
          Math.min(130, Math.max(60, maxMs - (Date.now() - started)))
        );
        if (silentMountedEmail) return silentMountedEmail;
      }

      await new Promise(r => setTimeout(r, 55));
    }

    return null;
  }

  async function waitForTicketOpenerLabel(maxMs = 450) {
    const immediate = getTicketOpenerLabel();
    if (immediate) return immediate;

    return new Promise(resolve => {
      let done = false;
      let observer = null;
      let interval = null;
      let timeout = null;

      const finish = (label) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        resolve(label || null);
      };

      const check = () => {
        if (!isCurrent() || emailSent) {
          finish(null);
          return;
        }

        const label = getTicketOpenerLabel();
        if (label) finish(label);
      };

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      interval = setInterval(check, 5);
      timeout = setTimeout(() => finish(null), maxMs);
      check();
    });
  }

  function findMatchingContactTag(ownerNorm) {
    if (!ownerNorm) return null;

    const tags = getTagEntries();
    return tags.find(tag => !extractEmail(tag.text || '') && isNameMatch(ownerNorm, tag.norm)) || null;
  }

  async function waitForMatchingContactTag(ownerRaw, maxMs = 500) {
    const ownerNorm = normalizeText(ownerRaw || '');
    if (!ownerNorm) return null;

    const immediate = findMatchingContactTag(ownerNorm);
    if (immediate) return immediate;

    return new Promise(resolve => {
      let done = false;
      let observer = null;
      let interval = null;
      let timeout = null;

      const finish = (tag) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        resolve(tag || null);
      };

      const check = () => {
        if (!isCurrent() || emailSent) {
          finish(null);
          return;
        }

        const match = findMatchingContactTag(ownerNorm);
        if (match) finish(match);
      };

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      interval = setInterval(check, 5);
      timeout = setTimeout(() => finish(null), maxMs);
      check();
    });
  }

  function startMatchedLabelHoverProbe(ownerRaw, maxMs = 1200) {
    if (!isCurrent() || emailSent) return false;
    const ownerNorm = normalizeText(ownerRaw || '');
    if (!ownerNorm || extractEmail(ownerRaw || '')) return false;

    stopMatchedLabelProbe();

    let done = false;
    let observer = null;
    let interval = null;
    let timeout = null;
    let hoverRunning = false;

    const finish = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      if (matchedLabelProbeCleanup === finish) matchedLabelProbeCleanup = null;
    };

    const startHover = (tag) => {
      if (!tag || hoverRunning || done || !isCurrent() || emailSent) return;
      const target = getTagHoverTarget(tag);
      if (!target) return;

      hoverRunning = true;
      const immediateTargets = [
        target,
        tag.labelEl,
        tag.rootEl,
        tag.rootEl?.querySelector?.('[data-content="true"]'),
        tag.rootEl?.querySelector?.('span[tabindex]')
      ].filter((el, index, arr) => el && document.contains(el) && arr.indexOf(el) === index);

      for (const hoverTarget of immediateTargets) dispatchHover(hoverTarget);

      hoverTagForEmail(target, 1000).then(email => {
        hoverRunning = false;
        if (email && isCurrent() && !emailSent) sendEmail(email);
        finish();
      });
    };

    const check = () => {
      if (done) return;
      if (!isCurrent() || emailSent) {
        finish();
        return;
      }

      const match = findMatchingContactTag(ownerNorm);
      if (match) startHover(match);
    };

    matchedLabelProbeCleanup = finish;
    check();
    if (done) return true;

    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    interval = setInterval(check, 5);
    timeout = setTimeout(finish, maxMs);
    return true;
  }

  async function resolveMatchedContactLabelEmail(ownerRaw, opts = {}) {
    if (!isCurrent() || emailSent) return false;

    const waitMs = Number(opts.waitMs ?? 650);
    const hoverAttempts = Array.isArray(opts.hoverAttempts) ? opts.hoverAttempts : [520, 760];
    const reveal = !!opts.reveal;
    const ownerNorm = normalizeText(ownerRaw || '');
    if (!ownerNorm) return false;

    const currentTags = getTagEntries();
    const immediateMatch = findMatchingContactTag(ownerNorm);
    const hasTransitioningEmailLabel = currentTags.some(tag => !!tag.email);
    if (!immediateMatch) {
      if (!currentTags.length) return false;
      if (!hasTransitioningEmailLabel) return false;
    }

    startMatchedLabelHoverProbe(ownerRaw, Math.max(Math.min(waitMs, 160) + 140, 240));
    const matchedTag = immediateMatch || await waitForMatchingContactTag(
      ownerRaw,
      hasTransitioningEmailLabel ? Math.min(waitMs, 160) : 0
    );

    if (!isCurrent() || emailSent || !matchedTag) return false;

    if (matchedTag.email) {
      sendEmail(matchedTag.email);
      return true;
    }

    const target = getTagHoverTarget(matchedTag);
    if (reveal) {
      revealForExtraction(target);
      if (!isCurrent() || emailSent) return false;
    }

    const hoveredEmail = await hoverWithRetry(target, hoverAttempts);
    if (hoveredEmail) {
      sendEmail(hoveredEmail);
      return true;
    }

    return false;
  }

  async function resolveHubSpotOrderedEmailPath(opts = {}) {
    if (!isCurrent() || emailSent) return false;

    // Keep the fast ticket path deterministic: header email, matched label hover,
    // then Requerente/Requester card as the final visible fallback.
    const ownerRaw = await waitForTicketOpenerLabel(Number(opts.ownerWaitMs ?? 360));
    if (!isCurrent() || emailSent) return false;

    if (hasHubSpotNoContactMarker()) {
      finalizeNoEmailFound();
      return true;
    }

    const ownerEmail = extractEmail(ownerRaw || '');
    if (ownerEmail) {
      sendEmail(ownerEmail);
      return true;
    }

    void ensureRequesterSectionExpanded(220, false);

    if (ownerRaw && await resolveMatchedContactLabelEmail(ownerRaw, {
      waitMs: Number(opts.labelWaitMs ?? 900),
      hoverAttempts: opts.hoverAttempts || [160, 280, 450, 700],
      reveal: !!opts.revealMatchedLabel
    })) return true;

    const requesterEmail = ownerRaw ? await resolveEmailFromRequesterSection(
      ownerRaw,
      Number(opts.requesterWaitMs ?? 950),
      false
    ) : null;

    if (requesterEmail) {
      sendEmail(requesterEmail);
      return true;
    }

    return false;
  }

  async function resolveHubSpotFastEmailPath() {
    if (!isCurrent() || emailSent) return false;

    return resolveHubSpotOrderedEmailPath({
      ownerWaitMs: 450,
      labelWaitMs: 900,
      hoverAttempts: [420, 700, 950],
      requesterWaitMs: 850
    });
  }

  function tryOpenerEmail() {
    if (!isCurrent() || emailSent) return false;
    const openerRaw = getTicketOpenerLabel();
    const openerEmail = extractEmail(openerRaw || '');
    if (!openerEmail) return false;
    sendEmail(openerEmail);
    return true;
  }

  function tryRequesterStaticSource(ownerRaw = null, preferredEmail = null) {
    if (!isCurrent() || emailSent) return false;

    const sectionRoot = getRequesterSectionRoot();
    if (!sectionRoot) return false;

    const effectiveOwnerRaw = ownerRaw || getTicketOpenerLabel();
    const requesterEmail =
      getRequesterOwnerEmail(sectionRoot, effectiveOwnerRaw) ||
      (!effectiveOwnerRaw ? findEmailInNode(sectionRoot) : null);

    if (requesterEmail && (!preferredEmail || requesterEmail === preferredEmail)) {
      sendEmail(requesterEmail);
      return true;
    }

    return false;
  }

  function tryImmediateKnownEmailSources(preferredEmail = null, ownerRaw = null) {
    if (!isCurrent() || emailSent) return false;
    if (tryOpenerEmail()) return true;
    if (tryStaticSources(preferredEmail, ownerRaw)) return true;
    if (tryRequesterStaticSource(ownerRaw, preferredEmail)) return true;
    return false;
  }

  async function trySingleTagFlashEmail(existingTags = null, maxMs = 420) {
    if (!isCurrent() || emailSent) return null;
    const initialSingle = getSingleVisibleTag(existingTags);
    if (!initialSingle) return null;

    const immediate = extractEmail(initialSingle.text || '');
    if (immediate) return immediate;

    const started = Date.now();
    const container = queryInTicketRoot(TAG_CONTAINER_SEL) || initialSingle.rootEl;
    if (!container) return null;

    return new Promise(resolve => {
      let timer = null;
      const observer = new MutationObserver(() => {
        if (!isCurrent() || emailSent) {
          cleanup();
          resolve(null);
          return;
        }
        const freshSingle = getSingleVisibleTag();
        if (!freshSingle) return;
        const flashed = extractEmail(freshSingle.text || '');
        if (flashed) {
          cleanup();
          resolve(flashed);
        }
      });

      function cleanup() {
        observer.disconnect();
        if (timer) clearInterval(timer);
      }

      observer.observe(container, { childList: true, subtree: true, characterData: true });

      timer = setInterval(() => {
        if (Date.now() - started >= maxMs || !isCurrent() || emailSent) {
          cleanup();
          resolve(null);
          return;
        }
        const freshSingle = getSingleVisibleTag();
        if (!freshSingle) return;
        const flashed = extractEmail(freshSingle.text || '');
        if (flashed) {
          cleanup();
          resolve(flashed);
        }
      }, 30);
    });
  }

  async function resolveHeaderOwnerThenRequester(maxMs = 450) {
    if (!isCurrent() || emailSent) return false;
    if (tryOpenerEmail()) return true;

    
    
    
    const singleTag = getSingleVisibleTag();
    if (singleTag) {
      if (singleTag.email) {
        sendEmail(singleTag.email);
        return true;
      }

      setNameIfNeeded(singleTag.text);
    }

    const openerRaw = getTicketOpenerLabel();
    if (tryStaticSources(null, openerRaw)) return true;

    if (openerRaw) {
      const requesterEmail = await resolveEmailFromRequesterSection(openerRaw, maxMs);
      if (requesterEmail) {
        sendEmail(requesterEmail);
        return true;
      }
    }

    if (!singleTag) return false;
    if (!isCurrent() || emailSent) return false;

    const quickHoveredEmail = await hoverWithRetry(singleTag.labelEl || singleTag.rootEl, [180, 300, 420]);
    if (quickHoveredEmail) {
      sendEmail(quickHoveredEmail);
      return true;
    }

    return false;
  }

  function tryStaticSources(preferredEmail = null, ownerRaw = null) {
    if (!isCurrent() || emailSent) return false;

    const contactTxt = queryInTicketRoot(CONTACT_SEL)?.innerText?.trim();
    if (contactTxt) {
      const e = extractEmail(contactTxt);
      if (e && (!preferredEmail || e === preferredEmail)) {
        sendEmail(e);
        return true;
      }
    }

    const chickletEls = queryAllInTicketRoot(CHICKLET_SEL);
    for (const chickletEl of chickletEls) {
      const href = (chickletEl.getAttribute('href') || '').replace('mailto:', '');
      const e = extractEmail(href) || extractEmail(chickletEl.innerText?.trim() || '');
      if (e && (!preferredEmail || e === preferredEmail)) {
        sendEmail(e);
        return true;
      }
    }

    if (tryRequesterStaticSource(ownerRaw, preferredEmail)) return true;

    return false;
  }

  function finalizeNoEmailFound() {
    if (emailSent) return;
    if (!isCurrent()) return;
    cleanupExtractionTimers();
    localData.name = localData.name || '-';
    localData.email = '> Ticket sem email';
    localData.doc = '-';
    localData.accounts = '-';
    renderPopup();
    msgBg({ action: 'EMAIL_UNAVAILABLE', processId });
  }

  function hoverTagForEmail(tagEl, timeoutMs = 2000) {
    return new Promise(resolve => {
      if (!tagEl || !document.contains(tagEl)) {
        resolve(null);
        return;
      }

      const targets = [tagEl];
      const tagRoot = tagEl.closest('[data-component-name="UITag"]');
      const textTarget =
        tagEl.querySelector?.('[data-content="true"]') ||
        tagEl.querySelector?.('span[tabindex]') ||
        tagRoot?.querySelector?.('[data-content="true"]') ||
        tagRoot?.querySelector?.('span[tabindex]') ||
        null;
      const innerTextTarget =
        textTarget?.querySelector?.('span[tabindex], span span, span') ||
        tagRoot?.querySelector?.('.TruncateString__TruncateStringInner-gODLZE span') ||
        null;

      if (tagRoot && !targets.includes(tagRoot)) targets.unshift(tagRoot);
      if (textTarget && !targets.includes(textTarget)) targets.push(textTarget);
      if (innerTextTarget && !targets.includes(innerTextTarget)) targets.push(innerTextTarget);

      for (const target of targets) {
        try { target.focus?.({ preventScroll: true }); } catch (_) {}
        dispatchHover(target);
      }

      const started = Date.now();
      const readTooltipEmail = () => {
        const popoverText =
          document.querySelector('[data-component-name="UIPopover"]')?.innerText ||
          document.querySelector('[role="tooltip"]')?.innerText ||
          '';
        return extractEmail(popoverText);
      };

      const immediateEmail = readTooltipEmail();
      if (immediateEmail) {
        resolve(immediateEmail);
        return;
      }

      const poll = setInterval(() => {
        if (!isCurrent() || emailSent) {
          clearInterval(poll);
          resolve(null);
          return;
        }

        
        for (const target of targets) {
          try { target.focus?.({ preventScroll: true }); } catch (_) {}
          dispatchHover(target);
        }

        const email = readTooltipEmail();
        if (email) {
          clearInterval(poll);
          resolve(email);
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          clearInterval(poll);
          resolve(null);
        }
      }, 10);
    });
  }

  async function hoverWithRetry(tagEl, attempts = [800, 1200]) {
    for (let i = 0; i < attempts.length; i++) {
      if (!isCurrent() || emailSent) return null;
      const email = await hoverTagForEmail(tagEl, attempts[i]);
      if (email) return email;
      if (i < attempts.length - 1) {
        await new Promise(r => setTimeout(r, 25));
      }
    }
    return null;
  }

  async function resolveSingleContact(tag) {
    if (!tag) return false;

    if (tag.email) {
      sendEmail(tag.email);
      return true;
    }

    setNameIfNeeded(tag.text);
    const hoveredEmail = await hoverWithRetry(tag.labelEl || tag.rootEl, [420, 750, 1100]);
    if (hoveredEmail) {
      sendEmail(hoveredEmail);
      return true;
    }

    return false;
  }

  async function resolveMultipleContacts(tags, openerRaw = null) {
    if (!tags.length) return false;

    const openerValue = openerRaw || getTicketOpenerLabel();
    if (!openerValue) return false;

    
    const openerEmail = extractEmail(openerValue);
    if (openerEmail) {
      sendEmail(openerEmail);
      return true;
    }

    const openerNorm = normalizeText(openerValue);
    if (!openerNorm) return false;

    const match =
      tags.find(t => !t.email && t.norm === openerNorm) ||
      tags.find(t => !t.email && (t.norm.includes(openerNorm) || openerNorm.includes(t.norm))) ||
      tags.find(t => t.norm === openerNorm) ||
      null;

    if (!match) return false;

    if (match.email) {
      sendEmail(match.email);
      return true;
    }

    setNameIfNeeded(match.text);
    const hoveredEmail = await hoverWithRetry(match.labelEl || match.rootEl, [450, 800, 1200]);
    if (hoveredEmail) {
      sendEmail(hoveredEmail);
      return true;
    }

    return false;
  }

  async function resolveMultipleOwnerEmail(tags) {
    const openerRaw = getTicketOpenerLabel();

    
    const requesterEmail = await resolveEmailFromRequesterSection(openerRaw, 750);
    if (requesterEmail) {
      sendEmail(requesterEmail);
      return true;
    }

    return resolveMultipleContacts(tags, openerRaw);
  }

  async function waitForTagEntries(maxMs = 2800) {
    return new Promise(resolve => {
      const finish = (tags) => {
        if (tagWaitTimer) {
          clearTimeout(tagWaitTimer);
          tagWaitTimer = null;
        }
        if (tagObserver) {
          tagObserver.disconnect();
          tagObserver = null;
        }
        resolve(tags);
      };

      const checkNow = () => {
        if (!isCurrent() || emailSent) {
          finish([]);
          return;
        }

        const tags = getTagEntries();
        if (tags.length) {
          finish(tags);
          return;
        }
      };

      checkNow();
      if (emailSent) return;

      tagObserver = new MutationObserver(checkNow);
      tagObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

      tagWaitTimer = setTimeout(() => finish([]), maxMs);
    });
  }

  async function retryBeforeNoEmailFound() {
    if (noEmailRetryUsed || noEmailRetryRunning) return false;
    noEmailRetryUsed = true;
    noEmailRetryRunning = true;

    try {
      if (!isCurrent() || emailSent) return true;

      
      await new Promise(r => setTimeout(r, 260));
      if (!isCurrent() || emailSent) return true;

      let tags = getTagEntries();
      if (tryImmediateKnownEmailSources()) return true;

      if (!tags.length) {
        tags = await waitForTagEntries(700);
      }

      if (!isCurrent() || emailSent) return true;

      const quickSingleEmail = await trySingleTagFlashEmail(tags, 420);
      if (quickSingleEmail) {
        sendEmail(quickSingleEmail);
        return true;
      }

      const openerRaw = getTicketOpenerLabel();
      if (openerRaw && await resolveMatchedContactLabelEmail(openerRaw, {
        waitMs: 850,
        hoverAttempts: [650, 950, 1250],
        reveal: true
      })) return true;

      if (await resolveHeaderOwnerThenRequester(750)) return true;
      if (tryStaticSources()) return true;

      const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
      if (multiOrHidden) {
        const ok = await resolveMultipleOwnerEmail(tags);
        if (ok || emailSent) return true;
        return false;
      }

      if (tags.length === 1) {
        const tag = tags[0];
        const ok = await resolveSingleContact(tag);
        if (ok || emailSent) return true;

        const finalHoverEmail = await hoverWithRetry(tag.labelEl || tag.rootEl, [700, 1100]);
        if (finalHoverEmail) {
          sendEmail(finalHoverEmail);
          return true;
        }
      }

      if (openerRaw && await resolveMatchedContactLabelEmail(openerRaw, {
        waitMs: 500,
        hoverAttempts: [900, 1300],
        reveal: true
      })) return true;

      if (tryStaticSources()) return true;
      return false;
    } finally {
      noEmailRetryRunning = false;
    }
  }

  function noEmailFound() {
    if (emailSent) return;
    if (!isCurrent()) return;
    if (noEmailRetryRunning) return;

    if (!noEmailRetryUsed) {
      retryBeforeNoEmailFound().then(ok => {
        if (ok || emailSent || !isCurrent()) return;
        finalizeNoEmailFound();
      });
      return;
    }

    finalizeNoEmailFound();
  }

  function armExtractionWatchdog() {
    clearTimeout(extractionWatchdog);
    extractionWatchdog = setTimeout(async () => {
      if (!isCurrent() || emailSent) return;

      if (await resolveHubSpotFastEmailPath()) return;

      const tags = getTagEntries();
      if (tryImmediateKnownEmailSources()) return;

      const openerRaw = getTicketOpenerLabel();
      if (openerRaw && await resolveMatchedContactLabelEmail(openerRaw, {
        waitMs: 700,
        hoverAttempts: [650, 950, 1250],
        reveal: true
      })) return;

      const quickSingleEmail = await trySingleTagFlashEmail(tags, 420);
      if (quickSingleEmail) {
        sendEmail(quickSingleEmail);
        return;
      }

      if (await resolveHeaderOwnerThenRequester(750)) return;
      if (tryStaticSources()) return;

      const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
      if (multiOrHidden) {
        
        const ok = await resolveMultipleOwnerEmail(tags);
        if (!ok && !emailSent && isCurrent()) noEmailFound();
        return;
      }

      if (tags.length === 1) {
        const ok = await resolveSingleContact(tags[0]);
        if (ok || emailSent || !isCurrent()) return;
        if (tryStaticSources()) return;
        goHover(processId, noEmailFound, tags[0].labelEl || tags[0].rootEl);
        return;
      }

      if (tryStaticSources()) return;
      goHover(processId, noEmailFound);
    }, 1800);
  }

  armExtractionWatchdog();

  (async () => {
    if (!isCurrent() || emailSent) return;

    if (hasHubSpotNoContactMarker()) {
      finalizeNoEmailFound();
      return;
    }

    const initialOpenerRaw = getTicketOpenerLabel();
    const initialOpenerEmail = extractEmail(initialOpenerRaw || '');
    if (initialOpenerEmail) {
      sendEmail(initialOpenerEmail);
      return;
    }
    if (initialOpenerRaw) {
      startMatchedLabelHoverProbe(initialOpenerRaw, 1500);
    }

    if (await resolveHubSpotFastEmailPath()) return;

    if (tryImmediateKnownEmailSources()) return;

    const openerRaw = getTicketOpenerLabel();
    if (openerRaw && await resolveMatchedContactLabelEmail(openerRaw, {
      waitMs: 700,
      hoverAttempts: [600, 900, 1200],
      reveal: false
    })) return;

    
    
    if (isForcedStart) {
      let forcedTags = getTagEntries();
      if (tryImmediateKnownEmailSources()) return;

      if (!forcedTags.length) {
        forcedTags = await waitForTagEntries(700);
      }

      if (!isCurrent() || emailSent) return;

      const forcedOpenerRaw = getTicketOpenerLabel();
      if (forcedOpenerRaw && await resolveMatchedContactLabelEmail(forcedOpenerRaw, {
        waitMs: 650,
        hoverAttempts: [650, 950, 1250],
        reveal: true
      })) return;

      const forcedSingleEmail = await trySingleTagFlashEmail(forcedTags, 160);
      if (forcedSingleEmail) {
        sendEmail(forcedSingleEmail);
        return;
      }

      if (await resolveHeaderOwnerThenRequester(750)) return;
      if (tryStaticSources()) return;
    }

    let tags = getTagEntries();
    if (tryImmediateKnownEmailSources()) return;

    const immediateSingleEmail = await trySingleTagFlashEmail(tags, 160);
    if (immediateSingleEmail) {
      sendEmail(immediateSingleEmail);
      return;
    }

    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;

    const lateOpenerRaw = getTicketOpenerLabel();
    if (lateOpenerRaw && await resolveMatchedContactLabelEmail(lateOpenerRaw, {
      waitMs: 650,
      hoverAttempts: [700, 1000, 1300],
      reveal: true
    })) return;

    if (!tags.length) {
      tags = await waitForTagEntries(900);
    }

    if (!isCurrent() || emailSent) return;

    if (tryImmediateKnownEmailSources()) return;

    const quickSingleEmail = await trySingleTagFlashEmail(tags, 240);
    if (quickSingleEmail) {
      sendEmail(quickSingleEmail);
      return;
    }

    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;

    const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
    if (multiOrHidden) {
      const ok = await resolveMultipleOwnerEmail(tags);
      if (!ok && !emailSent && isCurrent()) noEmailFound();
      return;
    }

    if (tags.length === 1) {
      const ok = await resolveSingleContact(tags[0]);
      if (ok || emailSent || !isCurrent()) return;

      if (await resolveHeaderOwnerThenRequester(700)) return;
      if (tryStaticSources()) return;
      goHover(processId, noEmailFound, tags[0].labelEl || tags[0].rootEl);
      return;
    }

    
    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;
    goHover(processId, noEmailFound);
  })();
}
function goHover(processId, noEmailFound, preferredTagEl = null) {
  if (currentProcessId !== processId || emailSent) return;
  hoverAttempted = true;
  getEmailFromHoverTooltip(processId, noEmailFound, preferredTagEl);
}


function watchTagForName(tagEl, processId) {
  
  return;
}


function getEmailFromHoverTooltip(processId, noEmailFound, preferredTagEl = null) {
  const allTagSelector = '.EmailTagDisplayBar__StyledDiv-bJtzuP [data-component-name="UITag"]';
  const allTags = Array.from(document.querySelectorAll(allTagSelector));

  const orderedTags = [];
  if (preferredTagEl && document.contains(preferredTagEl)) orderedTags.push(preferredTagEl);
  for (const t of allTags) {
    if (!orderedTags.includes(t)) orderedTags.push(t);
  }

  if (!orderedTags.length) {
    if (!emailSent) noEmailFound?.();
    return;
  }

  const tryTagAt = (index) => {
    if (currentProcessId !== processId || emailSent) return;
    if (index >= orderedTags.length) {
      if (!emailSent) noEmailFound?.();
      return;
    }

    const tagEl = orderedTags[index];
    if (!tagEl || !document.contains(tagEl)) {
      tryTagAt(index + 1);
      return;
    }

    const dispatchHoverTargets = () => {
      const targets = [tagEl];
      const textTarget = tagEl.querySelector('[data-content="true"]') || tagEl.querySelector('span[tabindex]');
      if (textTarget && !targets.includes(textTarget)) targets.push(textTarget);
      for (const target of targets) {
        if (!target || !document.contains(target)) continue;
        const rect = target.getBoundingClientRect();
        const fallbackX = Math.min(Math.max(window.innerWidth / 2, 1), Math.max(window.innerWidth - 2, 1));
        const fallbackY = Math.min(Math.max(window.innerHeight / 2, 1), Math.max(window.innerHeight - 2, 1));
        const clientX = rect.width > 0 ? rect.left + Math.max(1, rect.width / 2) : fallbackX;
        const clientY = rect.height > 0 ? rect.top + Math.max(1, rect.height / 2) : fallbackY;
        const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, relatedTarget: null };
        target.dispatchEvent(new MouseEvent('mouseenter', eventInit));
        target.dispatchEvent(new MouseEvent('mouseover', eventInit));
        target.dispatchEvent(new MouseEvent('mousemove', eventInit));
        if (typeof PointerEvent === 'function') {
          const pointerInit = { ...eventInit, pointerType: 'mouse', isPrimary: true };
          target.dispatchEvent(new PointerEvent('pointerenter', pointerInit));
          target.dispatchEvent(new PointerEvent('pointerover', pointerInit));
          target.dispatchEvent(new PointerEvent('pointermove', pointerInit));
        }
      }
    };

    dispatchHoverTargets();

    let tries = 0;
    const poll = setInterval(() => {
      tries++;

      if (currentProcessId !== processId) {
        clearInterval(poll);
        return;
      }

      dispatchHoverTargets();

      const tooltipText =
        document.querySelector('[data-component-name="UIPopover"]')?.innerText ||
        document.querySelector('[role="tooltip"]')?.innerText ||
        '';
      const email = extractEmail(tooltipText);
      if (email && !emailSent) {
        clearInterval(poll);
        emailSent = true;
        localData.email = email;
        renderPopup();
        msgBg({ action: 'DATA_EXTRACTED', processId, email });
        return;
      }

      if (tries > 18) {
        clearInterval(poll);
        tryTagAt(index + 1);
      }
    }, 40);
  };

  tryTagAt(0);
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
  if (msg.action === 'RESTART_TICKET_PROCESS') {
    if (!enabled || !popup || !isTicketPage()) return;
    const ticketId = extractTicketId() || currentTicketId;
    if (!ticketId) return;
    primeTicketSwitch(ticketId);
    enterTicket(ticketId, true);
    return;
  }

  if (msg.action === 'GET_CURRENT_DATA') {
    sendResponse({
      data: {
        id: localData.id ?? null,
        name: localData.name ?? null,
        email: localData.email ?? null,
        doc: localData.doc ?? null,
        accounts: localData.accounts ?? null
      },
      currentTicketId,
      currentProcessId,
      isTicketPage: isTicketPage()
    });
    return;
  }

  if (msg.action === 'UPDATE_POPUP') {
    if (!msg.processId) return;
    
    if (msg.processId === currentProcessId) {
      if (msg.fields) { Object.assign(localData, msg.fields); renderPopup(); }
      return;
    }
    
    if (!pendingPopupUpdates[msg.processId]) pendingPopupUpdates[msg.processId] = [];
    if (msg.fields) pendingPopupUpdates[msg.processId].push(msg.fields);
  }
  if (msg.action === 'SHOW_CHECKMARK') {
    showCheckmark(msg.type);
  }

  if (msg.action === 'BO_TAB_STATE') {
    if (msg.state) {
      applyBOTabState(msg.state);
      renderBOTabButtons();
    }
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

  const historyItems = Array.isArray(items) ? items : [];
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

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'th-history-row';
    row.dataset.historyId = id;
    row.dataset.historyKind = item?.kind === 'hubspot' || item?.kind === 'hyperflow'
      ? item.kind
      : '';

    const idEl = document.createElement('span');
    idEl.className = 'th-history-id';
    idEl.textContent = id;

    const nameEl = document.createElement('span');
    nameEl.className = 'th-history-name';
    nameEl.textContent = String(item?.name || '-');

    row.append(idEl, nameEl);
    historyView.appendChild(row);
  }
}

async function refreshHistoryView() {
  if (!historyViewOpen) return;
  const resp = await msgBg({ action: 'GET_TICKET_HISTORY' });
  if (!historyViewOpen) return;
  renderHistoryRows(resp?.history || []);
}

function setHistoryViewOpen(open) {
  if (!popup) return;
  historyViewOpen = !!open;

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




function renderPopup() {
  
  if (!popup) return;

  const idEl       = popup.querySelector('#th-id-val');
  const nameEl     = popup.querySelector('#th-name-val');
  const emailEl    = popup.querySelector('#th-email-val');
  const docEl      = popup.querySelector('#th-doc-val');
  const accountsEl = popup.querySelector('#th-accounts-val');
  if (!idEl) return;

  const { id, name, email, doc, accounts } = localData;

  if (!id) {
    idEl.textContent       = '-';
    nameEl.textContent     = '-';
    emailEl.textContent    = '-';
    docEl.textContent      = '-';
    accountsEl.textContent = '-';
    updateActionButtonsState();
    return;
  }

  idEl.textContent       = id;
  nameEl.textContent     = name     === null ? '...' : (name     || '-');
  emailEl.textContent    = email    === null ? '...' : (email    || '-');
  docEl.textContent      = doc      === null ? '...' : (doc      || '-');
  accountsEl.textContent = accounts === null ? '...' : (accounts || '-');
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
    const canUseAction = hasTargetTab && hasSearchValue;
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





function createPopup() {
  
  if (popup || !document.body) return;
  const existingPopup = document.getElementById('ticket-helper-popup');
  if (existingPopup) existingPopup.remove();

  popup = document.createElement('div');
  popup.id = 'ticket-helper-popup';
  historyViewOpen = false;
  const sharedMarkup = window.TicketHelperPopupUI?.getMarkup?.();
  if (!sharedMarkup) {
    popup = null;
    return;
  }
  popup.innerHTML = sharedMarkup;

  document.body.appendChild(popup);
  shieldPopupFromPageClicks();
  const actionsGrid = popup.querySelector('.th-actions-grid');
  if (actionsGrid) {
    while (actionsGrid.children.length > 4) {
      actionsGrid.lastElementChild?.remove();
    }
  }

  
  const posKey = isHubSpot() ? 'popupPosition_hubspot' : 'popupPosition_hyperflow';

  chrome.storage.local.get(posKey, (data) => {
    const pos = data[posKey];
    if (pos?.left != null && pos?.top != null) {
      popup.style.left = pos.left + 'px';
      popup.style.top  = pos.top  + 'px';
    } else {
      popup.style.left = (window.innerWidth  - 376) + 'px';
      popup.style.top  = (window.innerHeight - 160) + 'px';
    }
    popup.style.visibility = 'visible';
    clampPopup();
  });

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
  let dragging = false, ox = 0, oy = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
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
    if (!dragging) return;
    popup.style.left = (e.clientX - ox) + 'px';
    popup.style.top  = (e.clientY - oy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    clampPopup(true);
  });
}





function clampPopup(save = false) {
  if (!popup) return;
  
  const left   = parseFloat(popup.style.left) || 0;
  const top    = parseFloat(popup.style.top)  || 0;
  const width  = popup.offsetWidth;
  const height = popup.offsetHeight;
  const margin = 10;

  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth  - width  - margin));
  const clampedTop  = Math.max(margin, Math.min(top,  window.innerHeight - height - margin));

  
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





function bindButtons() {
  
  popup.querySelector('#th-btn-close').addEventListener('click', () => msgBg({ action: 'FORCE_DISABLE' }));
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
      const row = event.target instanceof Element
        ? event.target.closest('.th-history-row')
        : null;
      if (!row) return;

      event.preventDefault();
      event.stopPropagation();
      const id = row.dataset.historyId;
      if (!id) return;
      setHistoryViewOpen(false);
      await msgBg({ action: 'OPEN_HISTORY_ITEM', id, kind: row.dataset.historyKind || '' });
    });
  }
  popup.addEventListener('click', (event) => {
    if (!historyViewOpen) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('#th-btn-history, .th-history-row')) return;
    setHistoryViewOpen(false);
  });

  const boHint = popup.querySelector('#th-bo-hint');
  const actionHint = popup.querySelector('#th-action-hint');
  if (boHint) {
    boHint.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      boTabsHintDismissed = true;
      boActionHintDismissed = true;
      updateBOTabsHint();
    });
  }
  if (actionHint) {
    actionHint.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      boActionHintDismissed = true;
      boTabsHintDismissed = true;
      updateBOTabsHint();
    });
  }
  popup.querySelector('#th-btn-bo-reset').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'RESET_BO_TABS' });
    if (resp?.state) {
      applyBOTabState(resp.state);
      renderBOTabButtons();
    }
  });
  popup.querySelector('#th-btn-botab1').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'ARM_BO_TAB', slot: 1 });
    if (resp?.state) {
      applyBOTabState(resp.state);
      renderBOTabButtons();
    }
  });
  popup.querySelector('#th-btn-botab2').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'ARM_BO_TAB', slot: 2 });
    if (resp?.state) {
      applyBOTabState(resp.state);
      renderBOTabButtons();
    }
  });

  const actionButtons = [
    { key: 'orbita', selector: '#th-action-orbita' },
    { key: 'faturas', selector: '#th-action-faturas' },
    { key: 'nutror', selector: '#th-action-nutror' },
    { key: 'contratos', selector: '#th-action-contratos' }
  ];

  async function armActionTab(key) {
    const resp = await msgBg({ action: 'ARM_ACTION_TAB', actionKey: key });
    if (resp?.state) {
      applyBOTabState(resp.state);
      renderBOTabButtons();
    }
  }

  async function runActionSearch(key) {
    if (key === 'orbita') {
      await msgBg({
        action: 'RUN_ORBITA_SEARCH',
        processId: currentProcessId,
        ticketId: localData.id,
        doc: localData.doc,
        email: localData.email,
        accounts: localData.accounts,
        source: 'button'
      });
      return;
    }
    if (key === 'faturas') {
      await msgBg({
        action: 'RUN_FATURAS_SEARCH',
        processId: currentProcessId,
        ticketId: localData.id,
        doc: localData.doc,
        email: localData.email,
        accounts: localData.accounts,
        source: 'button'
      });
      return;
    }
    if (key === 'nutror') {
      await msgBg({
        action: 'RUN_NUTROR_SEARCH',
        processId: currentProcessId,
        ticketId: localData.id,
        doc: localData.doc,
        email: localData.email,
        accounts: localData.accounts,
        source: 'button'
      });
      return;
    }
    if (key === 'contratos') {
      await msgBg({
        action: 'RUN_CONTRATOS_SEARCH',
        processId: currentProcessId,
        ticketId: localData.id,
        doc: localData.doc,
        email: localData.email,
        accounts: localData.accounts,
        source: 'button'
      });
    }
  }

  function resolveActionTarget(key) {
    if (key === 'orbita') return resolveOrbitaActionTarget(localData);
    if (key === 'faturas') return resolveFaturasActionTarget(localData);
    if (key === 'nutror') return resolveNutrorActionTarget(localData);
    if (key === 'contratos') return resolveContratosActionTarget(localData);
    return null;
  }

  for (const actionItem of actionButtons) {
    const btn = popup.querySelector(actionItem.selector);
    if (!btn) continue;

    const corner = btn.querySelector('.th-action-corner');
    if (corner) {
      corner.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (boTabState.actionTabs?.[actionItem.key]) {
          await msgBg({ action: 'FOCUS_ACTION_TAB', actionKey: actionItem.key });
          return;
        }
        await armActionTab(actionItem.key);
      });
    }

    btn.addEventListener('click', async () => {
      const hasSpecificTab = !!boTabState.actionTabs?.[actionItem.key];
      const usesBO1Fallback = actionItem.key === 'orbita' && !hasSpecificTab;
      const hasTargetTab = usesBO1Fallback
        ? !!boTabState.boTab1Assigned
        : hasSpecificTab || !!boTabState.boTab2Assigned;
      const hasSearchValue = !!resolveActionTarget(actionItem.key)?.value;

      if (!hasSearchValue) {
        if (!hasTargetTab) {
          await armActionTab(actionItem.key);
        }
        return;
      }

      if (!hasTargetTab) {
        await armActionTab(actionItem.key);
        return;
      }

      if (usesBO1Fallback) {
        if (!boTabState.boTab1Assigned) return;
        const resp = await msgBg({ action: 'ARM_BO_TAB', slot: 1 });
        if (resp?.state) {
          applyBOTabState(resp.state);
          renderBOTabButtons();
        }
        return;
      }

      if (!hasTargetTab) {
        await armActionTab(actionItem.key);
        return;
      }

      void runActionSearch(actionItem.key);
    });
  }
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
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14;
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
    armedSlot: state?.armedSlot ?? null,
    armedAction,
    actionTabs: {
      orbita: !!actionTabs.orbita,
      faturas: !!actionTabs.faturas,
      nutror: !!actionTabs.nutror,
      contratos: !!actionTabs.contratos
    }
  };
}

function resolveContratosActionTarget({ doc, email, accounts }) {
  return resolveNutrorActionTarget({ doc, email, accounts });
}

function renderBOTabButtons() {
  if (!popup) return;
  const bo1Btn = popup.querySelector('#th-btn-botab1');
  const bo2Btn = popup.querySelector('#th-btn-botab2');
  if (!bo1Btn || !bo2Btn) return;

  const setVisual = (btn, slot, assigned) => {
    btn.classList.toggle('is-assigned', assigned);
    btn.classList.toggle('is-armed', boTabState.armedSlot === slot);
    btn.title = assigned ? `Ver aba BO ${slot}` : `Definir aba BO ${slot}`;
  };

  setVisual(bo1Btn, 1, !!boTabState.boTab1Assigned);
  setVisual(bo2Btn, 2, !!boTabState.boTab2Assigned);
  updateBOTabsHint();
  updateActionButtonsState();
}

function updateBOTabsHint() {
  if (!popup) return;
  const hint = popup.querySelector('#th-bo-hint');
  const hintText = popup.querySelector('#th-bo-hint-text');
  if (!hint || !hintText) return;

  const missingBO1 = !boTabState.boTab1Assigned;
  const bo2FallbackActionsCovered = !!(
    boTabState.actionTabs?.faturas &&
    boTabState.actionTabs?.nutror &&
    boTabState.actionTabs?.contratos
  );
  const missingBO2 = !boTabState.boTab2Assigned && !bo2FallbackActionsCovered;
  let message = '';

  if (missingBO1 && missingBO2) {
    message = 'sem BO1 e BO2 definidas';
  } else if (missingBO1) {
    message = 'sem BO1 definida';
  } else if (missingBO2) {
    message = 'sem BO2 definida';
  }

  if (boTabsHintDismissed || !message) {
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
    copyAndMark(String(localData.id), 'id');
  });

  popup.querySelector('#th-name-row').addEventListener('click', () => {
    const v = localData.name;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v.includes('@') ? v : v.split(' ')[0], 'name');
  });

  popup.querySelector('#th-email-row').addEventListener('click', () => {
    const v = localData.email;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v, 'email');
  });

  popup.querySelector('#th-doc-row').addEventListener('click', () => {
    const v = localData.doc;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v, 'doc');
  });
}

function copyAndMark(text, type) {
  navigator.clipboard.writeText(text)
    .then(() => showCheckmark(type))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showCheckmark(type);
    });
}

function showCheckmark(type) {
  
  ['id', 'name', 'email', 'doc'].forEach(t => {
    if (t === type) return;
    const other = popup?.querySelector(`#th-check-${t}`);
    if (other) {
      other.classList.remove('th-check-visible');
      clearTimeout(checkmarkTimers[t]);
    }
  });

  const el = popup?.querySelector(`#th-check-${type}`);
  if (!el) return;
  el.classList.add('th-check-visible');
  clearTimeout(checkmarkTimers[type]);
  checkmarkTimers[type] = setTimeout(() => el.classList.remove('th-check-visible'), 2000);
}





function normalizeProducerWarningText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProducerWarningRules(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const rules = [];

  for (const item of source) {
    const producer = String(item?.producer ?? '').trim();
    const message = String(item?.message ?? '').trim();
    const key = normalizeProducerWarningText(producer);
    if (!producer || !message || !key || seen.has(key)) continue;
    seen.add(key);
    rules.push({ producer, message, key });
  }

  return rules;
}

function injectProducerWarningStyles() {
  if (document.getElementById('ticket-helper-producer-warning-styles')) return;
  const style = document.createElement('style');
  style.id = 'ticket-helper-producer-warning-styles';
  style.textContent = `
    .ticket-helper-producer-warning {
      position: fixed;
      z-index: var(--ticket-helper-warning-z-index, 2);
      display: block;
      width: fit-content;
      max-width: 358px;
      padding: 4px 8px;
      border: 1px solid rgba(220, 38, 38, 0.52);
      border-radius: 6px;
      background: #fecaca;
      color: #991b1b;
      font-size: 16px;
      line-height: 1.25;
      font-weight: 600;
      white-space: normal;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(127, 29, 29, 0.15);
      pointer-events: auto;
      cursor: text;
      user-select: text;
      -webkit-user-select: text;
    }

    .ticket-helper-producer-warning-text {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
      user-select: text;
      -webkit-user-select: text;
    }

    .ticket-helper-producer-warning:hover {
      z-index: var(--ticket-helper-warning-z-index, 2);
      overflow: visible;
    }

    .ticket-helper-producer-warning:hover .ticket-helper-producer-warning-text {
      display: block;
      -webkit-line-clamp: unset;
      overflow: visible;
    }

    .ticket-helper-faturas-age-warning {
      min-width: 18px;
      text-align: center;
    }

    .ticket-helper-faturas-age-warning.is-age-recent {
      border-color: rgba(34, 197, 94, 0.45);
      background: #dcfce7;
      color: #15803d;
      box-shadow: 0 4px 12px rgba(20, 83, 45, 0.12);
    }

    .ticket-helper-faturas-age-warning.is-age-critical {
      border-color: rgba(220, 38, 38, 0.52);
      background: #fecaca;
      color: #991b1b;
      box-shadow: 0 4px 12px rgba(127, 29, 29, 0.15);
    }
  `;
  document.documentElement.appendChild(style);
}

function getTextForProducerWarnings(el) {
  return String(el?.innerText || el?.textContent || '').trim();
}

function isFaturasPopupRoot(root) {
  if (!root) return false;
  const text = getTextForProducerWarnings(root);
  if (!/status\s+da\s+fatura\s*:/i.test(text)) return false;

  const headers = Array.from(root.querySelectorAll('th, thead span'))
    .map(el => normalizeProducerWarningText(getTextForProducerWarnings(el)))
    .filter(Boolean);
  return headers.includes('fatura') && headers.includes('produto') && headers.includes('valor');
}

function findFaturasPopupRootsForWarnings() {
  const roots = new Set();
  const tables = Array.from(document.querySelectorAll('.__houston-table, .MuiTableContainer-root table, table'));

  for (const table of tables) {
    let root = table.closest('[tabindex="-1"]') || table.closest('.MuiTableContainer-root')?.parentElement || table.parentElement;
    while (root && root !== document.body && !isFaturasPopupRoot(root)) {
      root = root.parentElement;
    }
    if (isFaturasPopupRoot(root)) roots.add(root);
  }

  return Array.from(roots);
}

function getFaturasSellerElements(row) {
  const cells = Array.from(row.querySelectorAll(':scope > td'));
  const productCell = cells[1];
  if (!productCell) return null;

  const paragraphs = Array.from(productCell.querySelectorAll('p')).filter(el => getTextForProducerWarnings(el));
  if (!paragraphs.length) return null;

  const emailIndex = paragraphs.findIndex(el => !!extractEmail(getTextForProducerWarnings(el)));
  const sellerEl = emailIndex > 0
    ? paragraphs[emailIndex - 1]
    : paragraphs.find((el, index) => index >= 2 && !extractEmail(getTextForProducerWarnings(el))) || null;
  const emailEl = emailIndex >= 0 ? paragraphs[emailIndex] : sellerEl;

  if (!sellerEl) return null;
  return { sellerEl, emailEl: emailEl || sellerEl };
}

function getFaturasValueCell(row) {
  const cells = Array.from(row.querySelectorAll(':scope > td'));
  return cells[2] || null;
}

function getFaturasValueLineElement(row, pattern) {
  const valueCell = getFaturasValueCell(row);
  if (!valueCell) return null;

  const candidates = [
    ...Array.from(valueCell.querySelectorAll('p')),
    ...Array.from(valueCell.querySelectorAll('span, div'))
  ].filter(el => getTextForProducerWarnings(el));

  const directCandidate = candidates.find(el => pattern.test(getTextForProducerWarnings(el)));
  if (directCandidate) return directCandidate;

  return pattern.test(getTextForProducerWarnings(valueCell)) ? valueCell : null;
}

function getFaturasReceiptElement(row) {
  return getFaturasValueLineElement(row, /recebimento\s*:\s*\d{2}\/\d{2}\/\d{4}/i);
}

function getFaturasRefundLimitElement(row) {
  return getFaturasValueLineElement(row, /reembolso\s+at[ée]\s*:\s*\d{2}\/\d{2}\/\d{4}/i);
}

function clearProducerWarnings(root = document) {
  root.querySelectorAll?.('.ticket-helper-producer-warning').forEach(el => el.remove());
  root.querySelectorAll?.('[data-tickethelper-producer-warning]').forEach(el => {
    el.removeAttribute('data-tickethelper-producer-warning');
    el.removeAttribute('data-tickethelper-producer-warning-id');
  });
  root.querySelectorAll?.('[data-tickethelper-faturas-age-warning-id]').forEach(el => {
    el.removeAttribute('data-tickethelper-faturas-age-warning-id');
  });
}

function findProducerWarningRuleForSeller(sellerText) {
  const key = normalizeProducerWarningText(sellerText);
  if (!key) return null;
  return producerWarningRules.find(rule => rule.key === key) || null;
}

function applyWarningStackLevel(warning, popupRoot) {
  if (!warning) return;
  if (popupRoot && warning.parentElement !== popupRoot) {
    popupRoot.appendChild(warning);
  }
  warning.style.setProperty('--ticket-helper-warning-z-index', '2');
}

function positionProducerWarning(warning, anchorEl, popupRoot) {
  if (!warning || !anchorEl) return;
  applyWarningStackLevel(warning, popupRoot);
  const anchorRect = anchorEl.getBoundingClientRect();
  warning.style.left = `${Math.max(6, anchorRect.left)}px`;
  warning.style.top = `${Math.max(6, anchorRect.bottom - 2)}px`;
}

function positionWarningAtRect(warning, rect, popupRoot) {
  if (!warning || !rect) return;
  applyWarningStackLevel(warning, popupRoot);
  warning.style.left = `${Math.max(6, rect.left)}px`;
  warning.style.top = `${Math.max(6, rect.bottom - 2)}px`;
}

function getTextRangeRectForSubstring(el, substring) {
  if (!el || !substring) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    const index = text.indexOf(substring);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + substring.length);
      const rect = range.getBoundingClientRect();
      range.detach?.();
      if (rect && rect.width && rect.height) return rect;
    }
    node = walker.nextNode();
  }
  return null;
}

function isProducerWarningSelectionActive(warning) {
  const selection = window.getSelection?.();
  if (!warning || !selection || selection.isCollapsed) return false;
  const nodes = [selection.anchorNode, selection.focusNode].filter(Boolean);
  return nodes.some(node => warning.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement));
}

function setProducerWarningMessage(warning, message) {
  if (!warning) return;
  let textEl = warning.querySelector('.ticket-helper-producer-warning-text');
  if (!textEl) {
    warning.textContent = '';
    textEl = document.createElement('span');
    textEl.className = 'ticket-helper-producer-warning-text';
    warning.appendChild(textEl);
  }
  if (textEl.textContent !== message) textEl.textContent = message;
}

function parseBrazilDate(value) {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, text: match[1] + '/' + match[2] + '/' + match[3] };
}

function getFaturasAgeWarningInfo(receiptText) {
  const parsed = parseBrazilDate(receiptText);
  if (!parsed) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const receiptStart = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate());
  const days = Math.floor((todayStart.getTime() - receiptStart.getTime()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return { text: 'Hoje', tone: 'recent' };
  if (days > 60) return { text: '61+ dias', tone: 'critical' };
  return {
    text: `${days} ${days === 1 ? 'dia' : 'dias'}`,
    tone: days <= 7 ? 'recent' : 'standard'
  };
}

function applyFaturasAgeWarningTone(warning, tone) {
  if (!warning) return;
  warning.classList.toggle('is-age-recent', tone === 'recent');
  warning.classList.toggle('is-age-critical', tone === 'critical');
}

function applyFaturasAgeWarning(row, activeWarningIds, popupRoot) {
  const receiptEl = getFaturasReceiptElement(row);
  if (!receiptEl) return;
  const receiptText = getTextForProducerWarnings(receiptEl);
  const ageInfo = getFaturasAgeWarningInfo(receiptText);
  const warningId = receiptEl.getAttribute('data-tickethelper-faturas-age-warning-id') ||
    `th-age-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const existingWarning = document.querySelector(`.ticket-helper-producer-warning[data-warning-id="${warningId}"]`);

  if (!ageInfo) {
    existingWarning?.remove();
    receiptEl.removeAttribute('data-tickethelper-faturas-age-warning-id');
    return;
  }

  receiptEl.setAttribute('data-tickethelper-faturas-age-warning-id', warningId);
  activeWarningIds.add(warningId);
  const parsed = parseBrazilDate(receiptText);
  const receiptDateRect = getTextRangeRectForSubstring(receiptEl, parsed?.text) || receiptEl.getBoundingClientRect();
  const refundEl = getFaturasRefundLimitElement(row);
  const verticalAnchorRect = refundEl?.getBoundingClientRect?.() || receiptDateRect;
  const warningRect = {
    left: receiptDateRect.left,
    bottom: verticalAnchorRect.bottom
  };

  if (existingWarning) {
    if (!isProducerWarningSelectionActive(existingWarning)) {
      setProducerWarningMessage(existingWarning, ageInfo.text);
      applyFaturasAgeWarningTone(existingWarning, ageInfo.tone);
      positionWarningAtRect(existingWarning, warningRect, popupRoot);
    }
    return;
  }

  const warning = document.createElement('div');
  warning.className = 'ticket-helper-producer-warning ticket-helper-faturas-age-warning';
  warning.dataset.warningId = warningId;
  setProducerWarningMessage(warning, ageInfo.text);
  applyFaturasAgeWarningTone(warning, ageInfo.tone);
  warning.addEventListener('mousedown', event => event.stopPropagation());
  popupRoot?.appendChild(warning) || document.body.appendChild(warning);
  positionWarningAtRect(warning, warningRect, popupRoot);
}

function applyProducerWarningsToFaturasPopup(root) {
  const rows = Array.from(root.querySelectorAll('.__houston-table tbody tr, .MuiTableContainer-root table tbody tr, table tbody tr'));
  const activeWarningIds = new Set();

  for (const row of rows) {
    applyFaturasAgeWarning(row, activeWarningIds, root);

    const sellerParts = getFaturasSellerElements(row);
    if (!sellerParts) continue;

    const { sellerEl, emailEl } = sellerParts;
    const rule = findProducerWarningRuleForSeller(getTextForProducerWarnings(sellerEl));
    const warningId = sellerEl.getAttribute('data-tickethelper-producer-warning-id') || `th-pw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const existingWarning = document.querySelector(`.ticket-helper-producer-warning[data-warning-id="${warningId}"]`);

    if (!rule) {
      existingWarning?.remove();
      sellerEl.removeAttribute('data-tickethelper-producer-warning');
      sellerEl.removeAttribute('data-tickethelper-producer-warning-id');
      continue;
    }

    sellerEl.setAttribute('data-tickethelper-producer-warning', rule.key);
    sellerEl.setAttribute('data-tickethelper-producer-warning-id', warningId);
    activeWarningIds.add(warningId);
    if (existingWarning) {
      if (!isProducerWarningSelectionActive(existingWarning)) {
        setProducerWarningMessage(existingWarning, rule.message);
        positionProducerWarning(existingWarning, emailEl, root);
      }
      continue;
    }

    const warning = document.createElement('div');
    warning.className = 'ticket-helper-producer-warning';
    warning.dataset.warningId = warningId;
    setProducerWarningMessage(warning, rule.message);
    warning.addEventListener('mousedown', event => event.stopPropagation());
    root?.appendChild(warning) || document.body.appendChild(warning);
    positionProducerWarning(warning, emailEl, root);
  }

  return activeWarningIds;
}

function scanProducerWarnings() {
  producerWarningScanTimer = null;
  if (!isBackOffice() || !enabled) {
    clearProducerWarningSafetyTimer();
    clearProducerWarnings(document);
    return;
  }

  injectProducerWarningStyles();
  const popups = findFaturasPopupRootsForWarnings();
  if (!popups.length) {
    clearProducerWarningSafetyTimer();
    clearProducerWarnings(document);
    return;
  }

  const activeWarningIds = new Set();
  for (const popupRoot of popups) {
    const popupWarningIds = applyProducerWarningsToFaturasPopup(popupRoot);
    popupWarningIds?.forEach(id => activeWarningIds.add(id));
  }

  document.querySelectorAll('.ticket-helper-producer-warning').forEach(warning => {
    if (!activeWarningIds.has(warning.dataset.warningId || '')) warning.remove();
  });

  scheduleProducerWarningSafetyScan();
}

function scheduleProducerWarningScan(delayMs = 100) {
  if (producerWarningScanTimer) clearTimeout(producerWarningScanTimer);
  producerWarningScanTimer = setTimeout(scanProducerWarnings, delayMs);
}

function clearProducerWarningSafetyTimer() {
  if (!producerWarningSafetyTimer) return;
  clearTimeout(producerWarningSafetyTimer);
  producerWarningSafetyTimer = null;
}

function scheduleProducerWarningSafetyScan(delayMs = 1000) {
  if (producerWarningSafetyTimer) return;
  producerWarningSafetyTimer = setTimeout(() => {
    producerWarningSafetyTimer = null;
    scheduleProducerWarningScan(0);
  }, delayMs);
}

function startProducerWarningWatcher() {
  if (!isBackOffice()) return;
  if (producerWarningObserver) return;

  chrome.storage.local.get(PRODUCER_WARNINGS_KEY, (data) => {
    producerWarningRules = normalizeProducerWarningRules(data?.[PRODUCER_WARNINGS_KEY]);
    scheduleProducerWarningScan(0);
  });

  producerWarningObserver = new MutationObserver(() => scheduleProducerWarningScan(100));
  producerWarningObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  producerWarningScrollHandler = () => scheduleProducerWarningScan(30);
  document.addEventListener('scroll', producerWarningScrollHandler, true);
  window.addEventListener('resize', producerWarningScrollHandler);
}

function stopProducerWarningWatcher() {
  if (producerWarningObserver) {
    producerWarningObserver.disconnect();
    producerWarningObserver = null;
  }
  if (producerWarningScanTimer) {
    clearTimeout(producerWarningScanTimer);
    producerWarningScanTimer = null;
  }
  clearProducerWarningSafetyTimer();
  if (producerWarningScrollHandler) {
    document.removeEventListener('scroll', producerWarningScrollHandler, true);
    window.removeEventListener('resize', producerWarningScrollHandler);
    producerWarningScrollHandler = null;
  }
  clearProducerWarnings(document);
}

function injectStyles() {
  if (!window.TicketHelperPopupUI?.injectStyles) return;
  window.TicketHelperPopupUI.injectStyles(document, 'th-styles');
}

} 
