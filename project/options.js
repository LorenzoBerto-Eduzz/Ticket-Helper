'use strict';













const toggle = document.getElementById('toggle-enabled');
const toggleSwitch = toggle.closest('.switch');
let optionsPopup = document.getElementById('ticket-helper-popup');

const versionCurrentEl = document.getElementById('version-current');
const versionLatestEl = document.getElementById('version-latest');
const downloadUpdateBtn = document.getElementById('btn-download-update');
const refreshExtensionLink = document.getElementById('link-refresh-extension');
const producerWarningListEl = document.getElementById('producer-warning-list');
const addProducerWarningBtn = document.getElementById('btn-add-producer-warning');
const internalShortcutAlt5Select = document.getElementById('internal-shortcut-alt5');

const RELEASE_REPO_SLUGS = [
  'LorenzoBerto-Eduzz/TicketHelper',
  'LorenzoBerto-Eduzz/Ticket-Helper'
];
const LATEST_RELEASE_CACHE_KEY = 'latestReleaseInfoCache';
const EXTENSIONS_PAGE_URL = 'chrome://extensions';
const SHORTCUTS_PAGE_URL = 'chrome://extensions/shortcuts';
const OPTIONS_POPUP_POS_KEY = 'popupPosition_options';
const PRODUCER_WARNINGS_KEY = 'producerWarningRules';
const INTERNAL_SHORTCUTS_KEY = 'internalShortcuts';
const DEFAULT_INTERNAL_SHORTCUTS = {
  'Alt+5': 'open-options'
};
const INTERNAL_SHORTCUT_ACTIONS = new Set(['open-options', 'disabled']);
const DEFAULT_PRODUCER_NAME = 'Produtor';
const DEFAULT_PRODUCER_MESSAGE = 'Texto de aviso';

let latestReleaseInfo = null;
let producerWarningRules = [];
let producerWarningSuppressRenderUntil = 0;
let internalShortcuts = { ...DEFAULT_INTERNAL_SHORTCUTS };
let optionsBoTabState = {
  boTab1Assigned: false,
  boTab2Assigned: false,
  armedSlot: null,
  armedAction: null,
  actionTabs: { faturas: false, nutror: false, contratos: false }
};
let optionsBoHintDismissed = false;
let optionsBoActionHintDismissed = false;

const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
const ADD_SHORTCUT_BUTTON_HTML = '<span class="sc-add-wrap"><span class="sc-add-warning" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 21h22L12 3zm1 13h-2v-5h2v5zm0 3h-2v-2h2v2z"/></svg></span><button type="button" class="sc-add-btn"><span class="sc-add-label">Adicionar</span></button></span>';

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
    rules.push({ producer, message });
  }

  return rules;
}

function normalizeInternalShortcuts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = { ...DEFAULT_INTERNAL_SHORTCUTS };
  for (const key of Object.keys(DEFAULT_INTERNAL_SHORTCUTS)) {
    const action = String(source[key] ?? DEFAULT_INTERNAL_SHORTCUTS[key]).trim();
    normalized[key] = INTERNAL_SHORTCUT_ACTIONS.has(action) ? action : DEFAULT_INTERNAL_SHORTCUTS[key];
  }
  return normalized;
}

function renderInternalShortcuts() {
  if (!internalShortcutAlt5Select) return;
  internalShortcutAlt5Select.value = internalShortcuts['Alt+5'] || DEFAULT_INTERNAL_SHORTCUTS['Alt+5'];
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
  if (!internalShortcutAlt5Select) return;
  internalShortcutAlt5Select.addEventListener('change', () => {
    internalShortcuts['Alt+5'] = internalShortcutAlt5Select.value;
    saveInternalShortcuts();
  });
}

function getUniqueProducerName(baseName, indexToIgnore = -1) {
  const base = String(baseName || DEFAULT_PRODUCER_NAME).trim() || DEFAULT_PRODUCER_NAME;
  const used = new Set(
    producerWarningRules
      .map((rule, index) => index === indexToIgnore ? null : normalizeProducerWarningText(rule.producer))
      .filter(Boolean)
  );

  if (!used.has(normalizeProducerWarningText(base))) return base;

  let counter = 2;
  while (used.has(normalizeProducerWarningText(`${base} ${counter}`))) counter++;
  return `${base} ${counter}`;
}

function adjustProducerNameWidth(input) {
  const textLength = Math.max(10, String(input.value || input.placeholder || '').length);
  const width = Math.min(Math.max(118, textLength * 8 + 42), 520);
  input.style.setProperty('--producer-name-width', `${width}px`);
}

function autoGrowProducerMessage(textarea) {
  if (!textarea) return;
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(32, textarea.scrollHeight)}px`;
  };
  if (textarea.isConnected) resize();
  else requestAnimationFrame(resize);
}

function markProducerDefaults(input) {
  const isDefault = input.dataset.defaultValue && input.value === input.dataset.defaultValue;
  input.classList.toggle('is-default', !!isDefault);
}

function saveProducerWarnings() {
  producerWarningRules = normalizeProducerWarningRules(producerWarningRules);
  producerWarningSuppressRenderUntil = Date.now() + 600;
  safeSetLocal({ [PRODUCER_WARNINGS_KEY]: producerWarningRules });
}

function renderProducerWarnings() {
  if (!producerWarningListEl) return;
  producerWarningListEl.innerHTML = '';

  producerWarningRules.forEach((rule, index) => {
    const item = document.createElement('div');
    item.className = 'producer-warning-item';
    item.dataset.index = String(index);

    const nameRow = document.createElement('div');
    nameRow.className = 'producer-warning-name-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'producer-warning-name';
    nameInput.type = 'text';
    nameInput.value = rule.producer;
    nameInput.dataset.field = 'producer';
    if (rule.producer === DEFAULT_PRODUCER_NAME || /^Produtor \d+$/.test(rule.producer)) {
      nameInput.dataset.defaultValue = rule.producer;
    }
    markProducerDefaults(nameInput);
    adjustProducerNameWidth(nameInput);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'producer-warning-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = 'x';
    removeBtn.title = 'Remover produtor';

    const messageInput = document.createElement('textarea');
    messageInput.className = 'producer-warning-message';
    messageInput.rows = 1;
    messageInput.value = rule.message;
    messageInput.dataset.field = 'message';
    if (rule.message === DEFAULT_PRODUCER_MESSAGE) {
      messageInput.dataset.defaultValue = DEFAULT_PRODUCER_MESSAGE;
    }
    markProducerDefaults(messageInput);

    nameRow.append(nameInput, removeBtn);
    item.append(nameRow, messageInput);
    producerWarningListEl.appendChild(item);
    autoGrowProducerMessage(messageInput);
  });
}

function updateProducerRuleFromInput(input, { rerender = false } = {}) {
  const item = input.closest('.producer-warning-item');
  const index = Number.parseInt(item?.dataset.index || '-1', 10);
  if (!Number.isInteger(index) || index < 0 || !producerWarningRules[index]) return;

  const field = input.dataset.field;
  const defaultValue = input.dataset.defaultValue || '';
  let value = String(input.value || '').trim();
  if (!value) value = defaultValue || (field === 'producer' ? getUniqueProducerName(DEFAULT_PRODUCER_NAME, index) : DEFAULT_PRODUCER_MESSAGE);

  if (field === 'producer') {
    value = getUniqueProducerName(value, index);
    producerWarningRules[index].producer = value;
  } else if (field === 'message') {
    producerWarningRules[index].message = value;
  }

  input.value = value;
  markProducerDefaults(input);
  if (field === 'producer') adjustProducerNameWidth(input);
  if (field === 'message') autoGrowProducerMessage(input);
  saveProducerWarnings();
  if (rerender) renderProducerWarnings();
}

function addProducerWarningRule() {
  producerWarningRules.push({
    producer: getUniqueProducerName(DEFAULT_PRODUCER_NAME),
    message: DEFAULT_PRODUCER_MESSAGE
  });
  saveProducerWarnings();
  renderProducerWarnings();
  const lastNameInput = producerWarningListEl?.querySelector('.producer-warning-item:last-child .producer-warning-name');
  lastNameInput?.focus();
}

function removeProducerWarningRule(index) {
  if (!Number.isInteger(index) || index < 0) return;
  producerWarningRules.splice(index, 1);
  saveProducerWarnings();
  renderProducerWarnings();
}

function loadProducerWarnings() {
  chrome.storage.local.get(PRODUCER_WARNINGS_KEY, (data) => {
    producerWarningRules = normalizeProducerWarningRules(data?.[PRODUCER_WARNINGS_KEY]);
    renderProducerWarnings();
  });
}

function bindProducerWarnings() {
  if (!producerWarningListEl || !addProducerWarningBtn) return;

  addProducerWarningBtn.addEventListener('click', addProducerWarningRule);

  producerWarningListEl.addEventListener('focusin', (event) => {
    const input = event.target.closest('.producer-warning-name, .producer-warning-message');
    if (!input) return;
    if (input.dataset.defaultValue && input.value === input.dataset.defaultValue) {
      input.value = '';
      input.classList.remove('is-default');
      if (input.classList.contains('producer-warning-name')) adjustProducerNameWidth(input);
      if (input.classList.contains('producer-warning-message')) autoGrowProducerMessage(input);
    }
  });

  producerWarningListEl.addEventListener('input', (event) => {
    const input = event.target.closest('.producer-warning-name, .producer-warning-message');
    if (!input) return;
    input.classList.remove('is-default');
    if (input.classList.contains('producer-warning-name')) adjustProducerNameWidth(input);
    if (input.classList.contains('producer-warning-message')) autoGrowProducerMessage(input);
  });

  producerWarningListEl.addEventListener('focusout', (event) => {
    const input = event.target.closest('.producer-warning-name, .producer-warning-message');
    if (!input) return;
    updateProducerRuleFromInput(input, { rerender: false });
  });

  producerWarningListEl.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.producer-warning-remove');
    if (!removeBtn) return;
    const item = removeBtn.closest('.producer-warning-item');
    const index = Number.parseInt(item?.dataset.index || '-1', 10);
    removeProducerWarningRule(index);
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
  const width = optionsPopup.offsetWidth || 330;
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

  const boTab1Btn = optionsPopup.querySelector('#th-btn-botab1');
  if (boTab1Btn) {
    boTab1Btn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 1 });
      applyOptionsBoTabState(resp?.state);
    });
  }

  const boTab2Btn = optionsPopup.querySelector('#th-btn-botab2');
  if (boTab2Btn) {
    boTab2Btn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 2 });
      applyOptionsBoTabState(resp?.state);
    });
  }

  const boResetBtn = optionsPopup.querySelector('#th-btn-bo-reset');
  if (boResetBtn) {
    boResetBtn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'RESET_BO_TABS' });
      optionsBoHintDismissed = false;
      optionsBoActionHintDismissed = false;
      applyOptionsBoTabState(resp?.state);
    });
  }

  const actionButtons = [
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
        await sendMessageToBackground({ action: 'FOCUS_ACTION_TAB', actionKey: actionItem.key });
      });
    }

    button.addEventListener('click', async () => {
      const hasSpecificTab = !!optionsBoTabState.actionTabs?.[actionItem.key];
      const hasTargetTab = hasSpecificTab || !!optionsBoTabState.boTab2Assigned;
      if (!hasTargetTab) {
        const resp = await sendMessageToBackground({ action: 'ARM_ACTION_TAB', actionKey: actionItem.key });
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

  const bo1Btn = optionsPopup.querySelector('#th-btn-botab1');
  const bo2Btn = optionsPopup.querySelector('#th-btn-botab2');
  if (!bo1Btn || !bo2Btn) return;

  const setVisual = (btn, slot, assigned) => {
    btn.classList.toggle('is-assigned', !!assigned);
    btn.classList.toggle('is-armed', optionsBoTabState.armedSlot === slot);
    btn.title = assigned ? `Ver aba BO ${slot}` : `Definir aba BO ${slot}`;
  };

  setVisual(bo1Btn, 1, optionsBoTabState.boTab1Assigned);
  setVisual(bo2Btn, 2, optionsBoTabState.boTab2Assigned);
  updateOptionsBOTabsHint();
  updateOptionsActionButtonsState();
  updateOptionsActionTabsHint();
}

function updateOptionsActionButtonsState() {
  if (!optionsPopup) return;
  const actionButtons = [
    { key: 'faturas', selector: '#th-action-faturas' },
    { key: 'nutror', selector: '#th-action-nutror' },
    { key: 'contratos', selector: '#th-action-contratos' }
  ];

  for (const actionItem of actionButtons) {
    const button = optionsPopup.querySelector(actionItem.selector);
    if (!button) continue;

    const hasSpecificTab = !!optionsBoTabState.actionTabs?.[actionItem.key];
    const hasTargetTab = hasSpecificTab || !!optionsBoTabState.boTab2Assigned;
    const isArmedAction = optionsBoTabState.armedAction === actionItem.key;
    const canArmAction = !hasTargetTab;

    button.classList.remove('is-available');
    button.classList.add('is-unavailable');
    button.classList.toggle('is-armable', canArmAction);
    button.classList.toggle('is-armed', isArmedAction && canArmAction);
    button.classList.toggle('has-action-tab', hasSpecificTab);
  }
}

function updateOptionsBOTabsHint() {
  if (!optionsPopup) return;
  const hint = optionsPopup.querySelector('#th-bo-hint');
  const hintText = optionsPopup.querySelector('#th-bo-hint-text');
  if (!hint || !hintText) return;

  const missingBO1 = !optionsBoTabState.boTab1Assigned;
  const missingBO2 = !optionsBoTabState.boTab2Assigned;
  let message = '';

  if (missingBO1 && missingBO2) message = 'sem BO1 e BO2 definidas';
  else if (missingBO1) message = 'sem BO1 definida';
  else if (missingBO2) message = 'sem BO2 definida';

  if (optionsBoHintDismissed || !message) {
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
  if (key === 'faturas' || key === 'nutror' || key === 'contratos') return key;
  return null;
}

function applyOptionsBoTabState(state) {
  if (!state) return;
  const armedAction = normalizeActionKey(state.armedAction);
  const actionTabs = state.actionTabs || {};
  optionsBoTabState = {
    boTab1Assigned: !!state.boTab1Assigned,
    boTab2Assigned: !!state.boTab2Assigned,
    armedSlot: state.armedSlot ?? null,
    armedAction,
    actionTabs: {
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

chrome.storage.local.get('enabled', ({ enabled }) => {
  const isEnabled = !!enabled;
  toggle.checked = isEnabled;
  setOptionsPopupVisible(isEnabled);
  toggleSwitch.classList.add('is-ready');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove('no-toggle-anim');
    });
  });
});

toggle.addEventListener('change', () => {
  setOptionsPopupVisible(toggle.checked);
  chrome.storage.local.set({ enabled: toggle.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (PRODUCER_WARNINGS_KEY in changes) {
    producerWarningRules = normalizeProducerWarningRules(changes[PRODUCER_WARNINGS_KEY].newValue);
    if (Date.now() > producerWarningSuppressRenderUntil) renderProducerWarnings();
  }

  if (INTERNAL_SHORTCUTS_KEY in changes) {
    internalShortcuts = normalizeInternalShortcuts(changes[INTERNAL_SHORTCUTS_KEY].newValue);
    renderInternalShortcuts();
  }

  if (!('enabled' in changes)) return;
  const enabled = !!changes.enabled.newValue;
  toggle.checked = enabled;
  setOptionsPopupVisible(enabled);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'BO_TAB_STATE') return;
  applyOptionsBoTabState(message.state);
});

document.getElementById('btn-edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: SHORTCUTS_PAGE_URL });
});

document.getElementById('sc-list').addEventListener('click', (event) => {
  if (!event.target.closest('.sc-add-btn')) return;
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
  '_execute_action': 'sc-toggle',
  'copy-id': 'sc-copy-id',
  'copy-name': 'sc-copy-name',
  'copy-email': 'sc-copy-email',
  'copy-doc': 'sc-copy-doc'
};

function renderShortcut(elId, shortcut) {
  const el = document.getElementById(elId);
  if (!el) return;

  if (!shortcut) {
    el.innerHTML = ADD_SHORTCUT_BUTTON_HTML;
    return;
  }

  const parts = shortcut.split('+');
  el.innerHTML = parts
    .map((part, index) => `<kbd>${part}</kbd>${index < parts.length - 1 ? '<span class="plus">+</span>' : ''}`)
    .join('');
}

chrome.commands.getAll((commands) => {
  for (const cmd of commands) {
    const elId = DISPLAY_MAP[cmd.name];
    if (elId) renderShortcut(elId, cmd.shortcut);
  }
});

window.addEventListener('resize', () => clampOptionsPopup());
bindInternalShortcuts();
loadInternalShortcuts();
bindProducerWarnings();
loadProducerWarnings();
initOptionsPopup();
checkVersionAndUpdateState();
