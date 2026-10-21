'use strict';













const toggle = document.getElementById('toggle-enabled');
const toggleSwitch = toggle.closest('.switch');
let optionsPopup = document.getElementById('ticket-helper-popup');

const versionCurrentEl = document.getElementById('version-current');
const versionLatestEl = document.getElementById('version-latest');
const downloadUpdateBtn = document.getElementById('btn-download-update');
const refreshExtensionLink = document.getElementById('link-refresh-extension');

const RELEASE_REPO_SLUGS = [
  'LorenzoBerto-Eduzz/TicketHelper',
  'LorenzoBerto-Eduzz/Ticket-Helper'
];
const LATEST_RELEASE_CACHE_KEY = 'latestReleaseInfoCache';
const EXTENSIONS_PAGE_URL = 'chrome://extensions';
const SHORTCUTS_PAGE_URL = 'chrome://extensions/shortcuts';
const OPTIONS_POPUP_POS_KEY = 'popupPosition_options';
const INTERNAL_SHORTCUTS_KEY = 'internalShortcuts';
const INTERNAL_SHORTCUT_ACTIONS = { 'copy-bo1-masked-emails': '' };

let latestReleaseInfo = null;
let internalShortcuts = { ...INTERNAL_SHORTCUT_ACTIONS };
let capturingInternalShortcut = null;
let capturingInternalShortcutDraft = '';
let captureInternalShortcutNextFocusout = false;
let capturingInternalShortcutFirstCode = '';
let capturingInternalShortcutPressedCodes = new Set();
let optionsBoTabState = {
  boTab1Assigned: false,
  boTab2Assigned: false,
  backOffice2TabsAssigned: [false, false],
  requiredTabsAssigned: false,
  requiredTabsReady: false,
  armedSlot: null,
  armedAction: null,
  actionTabs: { orbita: false, faturas: false, nutror: false, contratos: false }
};
let optionsBoHintDismissed = false;
let optionsBoActionHintDismissed = false;

const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
const SHORTCUT_WARNING_ICON_HTML = '<span class="sc-add-warning" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 21h22L12 3zm1 13h-2v-5h2v5zm0 3h-2v-2h2v2z"/></svg></span>';

function hasAnyOptionsAssignedBOTab() {
  return !!(
    optionsBoTabState.boTab1Assigned ||
    optionsBoTabState.boTab2Assigned ||
    optionsBoTabState.actionTabs?.orbita ||
    optionsBoTabState.actionTabs?.faturas ||
    optionsBoTabState.actionTabs?.nutror ||
    optionsBoTabState.actionTabs?.contratos
  );
}

function ensureOptionsPopupPreview() {
  
  if (optionsPopup && optionsPopup.isConnected) return;

  const existingPopup = document.getElementById('ticket-helper-popup');
  if (existingPopup) existingPopup.remove();

  if (!window.TicketHelperPopupUI?.getMarkup) return;
  window.TicketHelperPopupUI.injectStyles?.(document, 'th-styles');

  const popupEl = document.createElement('div');
  popupEl.id = 'ticket-helper-popup';
  popupEl.setAttribute('aria-hidden', 'true');
  popupEl.innerHTML = window.TicketHelperPopupUI.getMarkup();
  document.body.appendChild(popupEl);
  optionsPopup = popupEl;
}

function setUpdateButtonState({ text, disabled, icon }) {
  const iconMarkup = icon === 'download' ? DOWNLOAD_ICON : icon === 'search' ? SEARCH_ICON : CHECK_ICON;
  downloadUpdateBtn.innerHTML = `${iconMarkup}<span>${text}</span>`;
  downloadUpdateBtn.disabled = disabled;
}

function safeSetLocal(data) {
  try {
    if (!chrome?.storage?.local?.set) return;
    chrome.storage.local.set(data, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    
  }
}

function normalizeInternalShortcuts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const action of Object.keys(INTERNAL_SHORTCUT_ACTIONS)) {
    const rawShortcut = Object.prototype.hasOwnProperty.call(source, action)
      ? source[action]
      : INTERNAL_SHORTCUT_ACTIONS[action];
    normalized[action] = normalizeShortcutCombo(rawShortcut);
  }
  return normalized;
}

function normalizeShortcutCombo(value) {
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

function shortcutKeyFromKeyboardEvent(event) {
  const codeMatch = String(event.code || '').match(/^(?:Digit|Numpad)(\d)$/);
  if (codeMatch) return codeMatch[1];
  if (/^[a-z0-9]$/i.test(String(event.key || ''))) return String(event.key).toUpperCase();
  return '';
}

function shortcutComboFromKeyboardEvent(event) {
  if (!event || event.metaKey) return '';
  const key = shortcutKeyFromKeyboardEvent(event);
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (key) parts.push(key);
  return parts.join('+');
}

function formatShortcutDraft(combo) {
  return String(combo || '').split('+').map(part => part.trim()).filter(Boolean).join(' + ');
}

function finishInternalShortcutCapture() {
  capturingInternalShortcut = null;
  capturingInternalShortcutDraft = '';
  captureInternalShortcutNextFocusout = false;
  capturingInternalShortcutFirstCode = '';
  capturingInternalShortcutPressedCodes = new Set();
  renderInternalShortcuts();
}

function saveCapturedInternalShortcut(action, shortcut) {
  internalShortcuts[action] = shortcut;
  capturingInternalShortcut = null;
  capturingInternalShortcutDraft = '';
  captureInternalShortcutNextFocusout = false;
  capturingInternalShortcutFirstCode = '';
  capturingInternalShortcutPressedCodes = new Set();
  saveInternalShortcuts();
}

function renderShortcutButton(elId, shortcut, { kind = 'chrome', warn = false, action = '' } = {}) {
  const el = document.getElementById(elId);
  if (!el) return;

  const normalized = kind === 'internal'
    ? normalizeShortcutCombo(shortcut)
    : String(shortcut || '').trim();
  const isCapturing = kind === 'internal' && capturingInternalShortcut === action;
  if (isCapturing) {
    const draftText = capturingInternalShortcutDraft
      ? formatShortcutDraft(capturingInternalShortcutDraft)
      : '<span class="sc-capture-placeholder">&nbsp;</span>';
    el.innerHTML = `<button type="button" class="sc-key-btn is-capturing" data-shortcut-kind="${kind}" data-shortcut-action="${action}"><span class="sc-capture-field">${draftText}<span class="sc-capture-caret" aria-hidden="true"></span></span></button>`;
    el.querySelector('button')?.focus();
    return;
  }

  const warning = warn && !normalized ? SHORTCUT_WARNING_ICON_HTML : '';
  const content = normalized
    ? normalized.split('+').map((part, index, parts) => `<kbd>${part.trim()}</kbd>${index < parts.length - 1 ? '<span class="plus">+</span>' : ''}`).join('')
    : '<span class="sc-add-label">Adicionar</span>';
  const emptyClass = normalized ? '' : ' is-empty';
  el.innerHTML = `${warning}<button type="button" class="sc-key-btn${emptyClass}" data-shortcut-kind="${kind}" data-shortcut-action="${action}">${content}</button>`;
}

function renderInternalShortcuts() {
  renderShortcutButton('sc-internal-copy-bo1-masked-emails', internalShortcuts['copy-bo1-masked-emails'], {
    kind: 'internal',
    action: 'copy-bo1-masked-emails'
  });
}

function saveInternalShortcuts() {
  internalShortcuts = normalizeInternalShortcuts(internalShortcuts);
  safeSetLocal({ [INTERNAL_SHORTCUTS_KEY]: internalShortcuts });
  renderInternalShortcuts();
}

function loadInternalShortcuts() {
  chrome.storage.local.get(INTERNAL_SHORTCUTS_KEY, (data) => {
    internalShortcuts = normalizeInternalShortcuts(data?.[INTERNAL_SHORTCUTS_KEY]);
    renderInternalShortcuts();
  });
}

function bindInternalShortcuts() {
  const list = document.getElementById('sc-list');
  if (!list) return;

  const handleCaptureKey = (event) => {
    if (!capturingInternalShortcut) return;
    const action = capturingInternalShortcut;
    if (event.key === 'Escape') {
      event.preventDefault();
      finishInternalShortcutCapture();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      saveCapturedInternalShortcut(action, '');
      return;
    }
    const code = String(event.code || event.key || '');
    if (event.type === 'keydown') {
      event.preventDefault();
      if (!capturingInternalShortcutFirstCode) capturingInternalShortcutFirstCode = code;
      capturingInternalShortcutPressedCodes.add(code);
      const shortcut = normalizeShortcutCombo(shortcutComboFromKeyboardEvent(event));
      capturingInternalShortcutDraft = shortcut || shortcutComboFromKeyboardEvent(event);
      renderInternalShortcuts();
      return;
    }

    if (event.type === 'keyup' && code === capturingInternalShortcutFirstCode) {
      event.preventDefault();
      const shortcut = normalizeShortcutCombo(capturingInternalShortcutDraft);
      if (shortcut) {
        saveCapturedInternalShortcut(action, shortcut);
        return;
      }
      finishInternalShortcutCapture();
      return;
    }

    if (event.type === 'keyup') capturingInternalShortcutPressedCodes.delete(code);
  };

  document.addEventListener('keydown', handleCaptureKey, true);
  document.addEventListener('keyup', handleCaptureKey, true);

  list.addEventListener('focusout', () => {
    if (!capturingInternalShortcut) return;
    if (captureInternalShortcutNextFocusout) {
      captureInternalShortcutNextFocusout = false;
      return;
    }
    setTimeout(() => {
      if (!capturingInternalShortcut) return;
      const activeButton = document.activeElement?.closest?.('.sc-key-btn.is-capturing');
      if (activeButton?.dataset.shortcutAction === capturingInternalShortcut) return;
      if (capturingInternalShortcutDraft) {
        saveCapturedInternalShortcut(capturingInternalShortcut, capturingInternalShortcutDraft);
        return;
      }
      finishInternalShortcutCapture();
    }, 0);
  });
}

function setOptionsPopupVisible(enabled) {
  ensureOptionsPopupPreview();
  if (!optionsPopup) return;
  optionsPopup.style.display = enabled ? 'flex' : 'none';
}

function clampOptionsPopup(save = false) {
  ensureOptionsPopupPreview();
  if (!optionsPopup) return;

  const left = parseFloat(optionsPopup.style.left) || 0;
  const top = parseFloat(optionsPopup.style.top) || 0;
  const width = optionsPopup.offsetWidth;
  const height = optionsPopup.offsetHeight;
  const margin = 10;

  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

  if (clampedLeft !== left || clampedTop !== top) {
    optionsPopup.style.left = `${clampedLeft}px`;
    optionsPopup.style.top = `${clampedTop}px`;
  }

  optionsPopup.style.right = 'auto';
  optionsPopup.style.bottom = 'auto';

  if (save) {
    safeSetLocal({ [OPTIONS_POPUP_POS_KEY]: { left: clampedLeft, top: clampedTop } });
  }
}

function placeOptionsPopupBottomRight() {
  ensureOptionsPopupPreview();
  if (!optionsPopup) return;
  const margin = 10;
  const width = optionsPopup.offsetWidth || 356;
  const height = optionsPopup.offsetHeight || 160;
  optionsPopup.style.left = `${Math.max(margin, window.innerWidth - width - margin)}px`;
  optionsPopup.style.top = `${Math.max(margin, window.innerHeight - height - margin)}px`;
  optionsPopup.style.right = 'auto';
  optionsPopup.style.bottom = 'auto';
}

function bindOptionsPopupDragging() {
  
  if (!optionsPopup) return;
  const handle = optionsPopup.querySelector('.th-drag-handle');
  if (!handle) return;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    dragging = true;
    const rect = optionsPopup.getBoundingClientRect();
    optionsPopup.style.left = `${rect.left}px`;
    optionsPopup.style.top = `${rect.top}px`;
    optionsPopup.style.right = 'auto';
    optionsPopup.style.bottom = 'auto';
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    optionsPopup.style.left = `${event.clientX - offsetX}px`;
    optionsPopup.style.top = `${event.clientY - offsetY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    clampOptionsPopup(true);
  });
}

function bindOptionsPopupButtons() {
  
  if (!optionsPopup) return;

  const closeBtn = optionsPopup.querySelector('#th-btn-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toggle.checked = false;
      setOptionsPopupVisible(false);
      chrome.storage.local.set({ enabled: false });
    });
  }

  const boHint = optionsPopup.querySelector('#th-bo-hint');
  if (boHint) {
    boHint.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      optionsBoHintDismissed = true;
      optionsBoActionHintDismissed = true;
      updateOptionsBOTabsHint();
    });
  }

  const actionHint = optionsPopup.querySelector('#th-action-hint');
  if (actionHint) {
    actionHint.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      optionsBoActionHintDismissed = true;
      optionsBoHintDismissed = true;
      updateOptionsBOTabsHint();
    });
  }

  const boResetBtn = optionsPopup.querySelector('#th-btn-bo-reset');
  if (boResetBtn) {
    boResetBtn.addEventListener('click', async () => {
      const shouldLaunch = !optionsBoTabState.requiredTabsAssigned;
      const resp = await sendMessageToBackground({
        action: shouldLaunch ? 'LAUNCH_DEFINED_BO_TABS' : 'RESET_BO_TABS',
        screenBounds: shouldLaunch ? {
          left: window.screen.availLeft,
          top: window.screen.availTop,
          width: window.screen.availWidth,
          height: window.screen.availHeight
        } : undefined
      });
      optionsBoHintDismissed = false;
      optionsBoActionHintDismissed = false;
      applyOptionsBoTabState(resp?.state);
    });
  }

  const actionButtons = [
    { key: 'orbita', selector: '#th-action-orbita' },
    { key: 'faturas', selector: '#th-action-faturas' },
    { key: 'nutror', selector: '#th-action-nutror' },
    { key: 'contratos', selector: '#th-action-contratos' }
  ];

  for (const actionItem of actionButtons) {
    const button = optionsPopup.querySelector(actionItem.selector);
    if (!button) continue;

    const corner = button.querySelector('.th-action-corner');
    if (corner) {
      corner.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (optionsBoTabState.actionTabs?.[actionItem.key]) {
          await sendMessageToBackground({ action: 'FOCUS_ACTION_TAB', actionKey: actionItem.key });
          return;
        }
        const resp = await sendMessageToBackground({ action: 'ARM_ACTION_TAB', actionKey: actionItem.key });
        applyOptionsBoTabState(resp?.state);
      });
    }

    button.addEventListener('click', async () => {
      const hasSpecificTab = !!optionsBoTabState.actionTabs?.[actionItem.key];
      const usesBO1Fallback = actionItem.key === 'orbita' && !hasSpecificTab;
      const hasTargetTab = usesBO1Fallback
        ? !!optionsBoTabState.boTab1Assigned
        : hasSpecificTab || !!optionsBoTabState.boTab2Assigned;
      if (!hasTargetTab) {
        const resp = await sendMessageToBackground({ action: 'ARM_ACTION_TAB', actionKey: actionItem.key });
        applyOptionsBoTabState(resp?.state);
        return;
      }

      if (usesBO1Fallback) {
        if (!optionsBoTabState.boTab1Assigned) return;
        const resp = await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 1 });
        applyOptionsBoTabState(resp?.state);
        return;
      }

      if (hasSpecificTab) {
        await sendMessageToBackground({ action: 'FOCUS_ACTION_TAB', actionKey: actionItem.key });
        return;
      }

      await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 2 });
    });
  }
}

function initOptionsPopup() {
  ensureOptionsPopupPreview();
  if (!optionsPopup) return;

  bindOptionsPopupDragging();
  bindOptionsPopupButtons();
  renderOptionsBoTabButtons();
  requestOptionsBoTabState();

  chrome.storage.local.get(OPTIONS_POPUP_POS_KEY, (data) => {
    const pos = data[OPTIONS_POPUP_POS_KEY];

    if (pos?.left != null && pos?.top != null) {
      optionsPopup.style.left = `${pos.left}px`;
      optionsPopup.style.top = `${pos.top}px`;
    } else {
      placeOptionsPopupBottomRight();
    }

    optionsPopup.style.visibility = 'visible';
    clampOptionsPopup();
  });
}

function sendMessageToBackground(message) {
  
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id) {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function renderOptionsBoTabButtons() {
  if (!optionsPopup) return;

  const resetBtn = optionsPopup.querySelector('#th-btn-bo-reset');
  if (!resetBtn) return;

  const launchMode = !optionsBoTabState.requiredTabsAssigned;
  resetBtn.classList.toggle('is-launch-mode', launchMode);
  resetBtn.title = launchMode ? 'Lançar abas definidas' : 'Limpar abas BO';
  resetBtn.setAttribute('aria-label', launchMode ? 'Lançar abas definidas' : 'Limpar abas BO');
  updateOptionsBOTabsHint();
  updateOptionsActionButtonsState();
  updateOptionsActionTabsHint();
}

function updateOptionsActionButtonsState() {
  if (!optionsPopup) return;
  const actionButtons = [
    { key: 'orbita', selector: '#th-action-orbita' },
    { key: 'faturas', selector: '#th-action-faturas' },
    { key: 'nutror', selector: '#th-action-nutror' },
    { key: 'contratos', selector: '#th-action-contratos' }
  ];

  for (const actionItem of actionButtons) {
    const button = optionsPopup.querySelector(actionItem.selector);
    if (!button) continue;

    const hasSpecificTab = !!optionsBoTabState.actionTabs?.[actionItem.key];
    const usesBO1Fallback = actionItem.key === 'orbita' && !hasSpecificTab;
    const hasTargetTab = usesBO1Fallback
      ? !!optionsBoTabState.boTab1Assigned
      : hasSpecificTab || !!optionsBoTabState.boTab2Assigned;
    const isArmedAction = optionsBoTabState.armedAction === actionItem.key;
    const canArmAction = !hasTargetTab;

    button.classList.remove('is-available');
    button.classList.add('is-unavailable');
    button.classList.toggle('is-armable', canArmAction);
    button.classList.toggle('is-armed', isArmedAction && canArmAction);
    button.classList.toggle('has-action-tab', hasSpecificTab);
    button.classList.toggle('can-assign-action-tab', actionItem.key === 'orbita' && !hasSpecificTab);
  }
}

function updateOptionsBOTabsHint() {
  if (!optionsPopup) return;
  const hint = optionsPopup.querySelector('#th-bo-hint');
  const hintText = optionsPopup.querySelector('#th-bo-hint-text');
  if (!hint || !hintText) return;

  let message = '';
  let requiredTabsUnavailable = false;

  if (!optionsBoTabState.requiredTabsAssigned) {
    message = 'atribua as quatro abas BO1 e BO2';
    requiredTabsUnavailable = true;
  } else if (!optionsBoTabState.requiredTabsReady) {
    message = 'retorne as abas aos sites BO1 e BO2';
    requiredTabsUnavailable = true;
  }

  if ((!requiredTabsUnavailable && optionsBoHintDismissed) || !message) {
    hint.classList.remove('is-visible');
    updateOptionsActionTabsHint();
    return;
  }

  hintText.textContent = message;
  hint.classList.add('is-visible');
  updateOptionsActionTabsHint();
}

function updateOptionsActionTabsHint() {
  if (!optionsPopup) return;
  const hint = optionsPopup.querySelector('#th-action-hint');
  const hintText = optionsPopup.querySelector('#th-action-hint-text');
  if (!hint || !hintText) return;

  const hasSpecificActionTab = !!(
    optionsBoTabState.actionTabs?.orbita ||
    optionsBoTabState.actionTabs?.faturas ||
    optionsBoTabState.actionTabs?.nutror ||
    optionsBoTabState.actionTabs?.contratos
  );
  const shouldShow = !optionsBoActionHintDismissed && !optionsBoTabState.boTab2Assigned && !hasSpecificActionTab;

  if (!shouldShow) {
    hint.classList.remove('is-visible');
    return;
  }

  hintText.textContent = 'ou defina abas específicas';
  hint.classList.add('is-visible');
}

function normalizeActionKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'orbita' || key === 'faturas' || key === 'nutror' || key === 'contratos') return key;
  return null;
}

function applyOptionsBoTabState(state) {
  if (!state) return;
  const armedAction = normalizeActionKey(state.armedAction);
  const actionTabs = state.actionTabs || {};
  optionsBoTabState = {
    boTab1Assigned: !!state.boTab1Assigned,
    boTab2Assigned: !!state.boTab2Assigned,
    backOffice2TabsAssigned: [0, 1].map((index) =>
      !!state.backOffice2TabsAssigned?.[index]),
    requiredTabsAssigned: !!state.requiredTabsAssigned,
    requiredTabsReady: !!state.requiredTabsReady,
    armedSlot: state.armedSlot ?? null,
    armedAction,
    actionTabs: {
      orbita: !!actionTabs.orbita,
      faturas: !!actionTabs.faturas,
      nutror: !!actionTabs.nutror,
      contratos: !!actionTabs.contratos
    }
  };
  renderOptionsBoTabButtons();
}

async function requestOptionsBoTabState() {
  const response = await sendMessageToBackground({ action: 'GET_BO_TAB_STATE' });
  applyOptionsBoTabState(response?.state);
}

function closeOptionsTab() {
  
  chrome.tabs.getCurrent((tab) => {
    if (tab && typeof tab.id === 'number') {
      chrome.tabs.remove(tab.id);
      return;
    }
    window.close();
  });
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const aParts = normalizeVersion(a).split('.').map(part => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b).split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

function findZipAsset(assets) {
  if (!Array.isArray(assets)) return null;

  const exact = assets.find((asset) => String(asset.name || '').toLowerCase() === 'tickethelper.zip');
  if (exact) return exact;

  const ticketHelperZip = assets.find((asset) => {
    const name = String(asset.name || '').toLowerCase();
    return name.includes('tickethelper') && name.endsWith('.zip');
  });
  if (ticketHelperZip) return ticketHelperZip;

  return assets.find((asset) => String(asset.name || '').toLowerCase().endsWith('.zip')) || null;
}

function parseReleasePayload(payload) {
  const zipAsset = findZipAsset(payload?.assets);

  return {
    version: normalizeVersion(payload?.tag_name),
    assetUrl: zipAsset ? zipAsset.browser_download_url : '',
    assetName: zipAsset ? zipAsset.name : 'TicketHelper.zip',
    releasePageUrl: payload?.html_url || 'https://github.com/LorenzoBerto-Eduzz/TicketHelper/releases'
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed release check (${response.status})`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLatestReleaseFromRepo(repoSlug) {
  try {
    const latestPayload = await fetchJsonWithTimeout(`https://api.github.com/repos/${repoSlug}/releases/latest`);
    return parseReleasePayload(latestPayload);
  } catch (latestError) {
    const listPayload = await fetchJsonWithTimeout(`https://api.github.com/repos/${repoSlug}/releases?per_page=1`);
    const release = Array.isArray(listPayload) ? listPayload[0] : null;
    if (!release) throw latestError;
    return parseReleasePayload(release);
  }
}

async function fetchLatestRelease() {
  return Promise.any(RELEASE_REPO_SLUGS.map(repoSlug => fetchLatestReleaseFromRepo(repoSlug)));
}

function getLocalValue(key) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(key, data => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(data?.[key] || null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function loadCachedLatestRelease() {
  const cached = await getLocalValue(LATEST_RELEASE_CACHE_KEY);
  if (!cached?.version) return null;
  return cached;
}

function rememberLatestRelease(info) {
  if (!info?.version) return;
  safeSetLocal({ [LATEST_RELEASE_CACHE_KEY]: { ...info, cachedAt: Date.now() } });
}

function applyVersionState(currentVersion, releaseInfo, { fromCache = false } = {}) {
  latestReleaseInfo = releaseInfo;
  versionLatestEl.textContent = releaseInfo.version || 'Indispon\u00edvel';

  if (!releaseInfo.version) {
    setUpdateButtonState({ text: 'N\u00e3o foi poss\u00edvel verificar vers\u00f5es', disabled: true, icon: 'search' });
    return;
  }

  const versionComparison = compareVersions(currentVersion, releaseInfo.version);
  if (versionComparison === 0) {
    setUpdateButtonState({ text: fromCache ? 'Confirmando vers\u00e3o...' : 'Vers\u00e3o mais recente em uso', disabled: true, icon: 'check' });
    return;
  }

  if (!releaseInfo.assetUrl) {
    setUpdateButtonState({ text: 'Vers\u00e3o encontrada sem pacote', disabled: true, icon: 'search' });
    return;
  }

  setUpdateButtonState({ text: fromCache ? 'verificando vers\u00e3o mais recente' : 'Baixar vers\u00e3o mais recente no Github', disabled: !!fromCache, icon: fromCache ? 'search' : 'download' });
}

async function checkVersionAndUpdateState() {
  const currentVersion = normalizeVersion(chrome.runtime.getManifest().version);

  versionCurrentEl.textContent = currentVersion;
  versionLatestEl.textContent = 'Verificando...';
  setUpdateButtonState({ text: 'Pesquisando versoes', disabled: true, icon: 'search' });

  const cachedRelease = await loadCachedLatestRelease();
  if (cachedRelease?.version) {
    applyVersionState(currentVersion, cachedRelease, { fromCache: true });
  }

  try {
    const releaseInfo = await fetchLatestRelease();
    rememberLatestRelease(releaseInfo);
    applyVersionState(currentVersion, releaseInfo);
  } catch (error) {
    console.error('Version check failed:', error);
    if (latestReleaseInfo?.version) {
      applyVersionState(currentVersion, latestReleaseInfo);
      return;
    }
    versionLatestEl.textContent = 'Indisponivel';
    setUpdateButtonState({ text: 'Nao foi possivel verificar versoes', disabled: true, icon: 'search' });
  }
}

function isOptionsPageVisible() {
  return document.visibilityState === 'visible';
}

function applyEnabledState(enabled, animate = true) {
  if (animate && isOptionsPageVisible()) {
    document.body.classList.remove('no-toggle-anim');
  } else {
    document.body.classList.add('no-toggle-anim');
  }
  toggle.checked = enabled;
  setOptionsPopupVisible(enabled);
}

function enableToggleAnimationWhenVisible() {
  if (!isOptionsPageVisible()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isOptionsPageVisible()) document.body.classList.remove('no-toggle-anim');
    });
  });
}

chrome.storage.local.get('enabled', ({ enabled }) => {
  const isEnabled = enabled === true;
  applyEnabledState(isEnabled, false);
  toggleSwitch.classList.add('is-ready');
  enableToggleAnimationWhenVisible();
});

document.addEventListener('visibilitychange', enableToggleAnimationWhenVisible);

toggle.addEventListener('change', () => {
  setOptionsPopupVisible(toggle.checked);
  chrome.storage.local.set({ enabled: toggle.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (!('enabled' in changes)) return;
  const enabled = !!changes.enabled.newValue;
  applyEnabledState(enabled);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'BO_TAB_STATE') return;
  applyOptionsBoTabState(message.state);
});

document.getElementById('sc-list').addEventListener('click', (event) => {
  const shortcutButton = event.target.closest('.sc-key-btn, .sc-add-btn');
  if (!shortcutButton) return;

    const kind = shortcutButton.dataset.shortcutKind || 'chrome';
    if (kind === 'internal') {
      const action = shortcutButton.dataset.shortcutAction;
    if (!Object.prototype.hasOwnProperty.call(INTERNAL_SHORTCUT_ACTIONS, action)) return;
    event.preventDefault();
    captureInternalShortcutNextFocusout = true;
    capturingInternalShortcut = action;
    capturingInternalShortcutDraft = '';
    capturingInternalShortcutFirstCode = '';
    capturingInternalShortcutPressedCodes = new Set();
    renderInternalShortcuts();
    return;
  }

  chrome.tabs.create({ url: SHORTCUTS_PAGE_URL });
});

refreshExtensionLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });
});

downloadUpdateBtn.addEventListener('click', () => {
  if (!latestReleaseInfo || !latestReleaseInfo.assetUrl) return;

  setUpdateButtonState({ text: 'Baixando vers\u00e3o mais recente...', disabled: true, icon: 'download' });

  chrome.downloads.download(
    {
      url: latestReleaseInfo.assetUrl,
      filename: latestReleaseInfo.assetName || 'TicketHelper.zip',
      saveAs: false,
      conflictAction: 'uniquify'
    },
    (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        console.error('Download failed:', chrome.runtime.lastError);
        setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente no Github', disabled: false, icon: 'download' });
        return;
      }

      chrome.downloads.show(downloadId);
      chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });

      setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente no Github', disabled: false, icon: 'download' });
      closeOptionsTab();
    }
  );
});

const DISPLAY_MAP = {
  '_execute_action': { elId: 'sc-toggle', warn: true },
  '02-copy-id': { elId: 'sc-copy-id', warn: false },
  '03-copy-name': { elId: 'sc-copy-name', warn: false },
  '04-copy-email': { elId: 'sc-copy-email', warn: false },
  '05-copy-doc': { elId: 'sc-copy-doc', warn: false },
  '06-copy-bo1-masked-emails': { elId: 'sc-internal-copy-bo1-masked-emails', warn: false },
  '08-orbita-search': { elId: 'sc-orbita-search', warn: false },
  '07-nutror-search': { elId: 'sc-nutror-search', warn: false },
  '09-faturas-search': { elId: 'sc-faturas-search', warn: false },
  '10-contratos-search': { elId: 'sc-contratos-search', warn: false }
};

let shortcutRefreshTimer = null;

function renderChromeShortcut(config, shortcut) {
  if (!config) return;
  renderShortcutButton(config.elId, shortcut, {
    kind: 'chrome',
    warn: !!config.warn
  });
}

function refreshChromeShortcuts() {
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError || !Array.isArray(commands)) return;
    for (const cmd of commands) {
      renderChromeShortcut(DISPLAY_MAP[cmd.name], cmd.shortcut);
    }
  });
}

function scheduleChromeShortcutRefresh(delay = 120) {
  clearTimeout(shortcutRefreshTimer);
  shortcutRefreshTimer = setTimeout(refreshChromeShortcuts, delay);
}

refreshChromeShortcuts();
window.addEventListener('focus', () => scheduleChromeShortcutRefresh());
window.addEventListener('pageshow', () => scheduleChromeShortcutRefresh());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleChromeShortcutRefresh();
});

window.addEventListener('resize', () => clampOptionsPopup());
initOptionsPopup();
checkVersionAndUpdateState();
