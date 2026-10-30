(() => {
  const BADGE_CLASS = 'th-faturas-age-badge';
  const ANCHOR_CLASS = 'th-faturas-age-anchor';
  const AGE_CONTROLS_CLASS = 'th-faturas-age-controls';
  const EXCLUSION_BUTTON_CLASS = 'th-faturas-exclusion-button';
  const PRODUCER_NOTE_CLASS = 'th-faturas-producer-note';
  const PRODUCER_NOTE_KEY_PREFIX = 'producerNote:';
  const STAGED_ROW_CLASS = 'th-faturas-staged-row';
  const SELECTED_ROW_CLASS = 'th-faturas-selected-row';
  const RELATED_ROW_CLASS = 'th-faturas-related-row';
  const NUMBER_GUTTER_CLASS = 'th-faturas-number-gutter';
  let enabled = false;
  let scheduled = false;
  let midnightTimer = null;
  let selectedRow = null;
  let selectedTicketId = null;
  let selectedBuyerSignature = null;
  let selectedInvoiceId = null;
  let selectedRowIndex = null;
  const producerNotes = new Map();
  const loadingProducerNotes = new Set();
  const noteMeasureContext = document.createElement('canvas').getContext('2d');
  let activeProducerNoteEditor = null;

  function clearSelection() {
    selectedRow?.classList.remove(SELECTED_ROW_CLASS);
    selectedRow = null;
    selectedTicketId = null;
    selectedBuyerSignature = null;
    selectedInvoiceId = null;
    selectedRowIndex = null;
  }

  function invoiceIdFromRow(row) {
    const firstCell = row?.querySelector('td:first-child');
    const status = firstCell?.querySelector('p.css-1ypxnh [aria-label] span');
    const value = status?.textContent?.trim() || '';
    return /^\d+$/.test(value) ? value : null;
  }

  function visibleInvoiceRows(popup) {
    return [...popup.querySelectorAll('.MuiTableContainer-root tbody tr.houston-table-row-has-action')]
      .filter(row => row.getClientRects().length > 0);
  }

  function selectInvoice(index, ticketId) {
    if (!enabled || !Number.isInteger(index) || index < 1 || index > 4 ||
        !ticketId) return null;
    for (const popup of document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')) {
      if (!popup.textContent?.includes('Status da fatura:') || !popup.getClientRects().length ||
          getComputedStyle(popup).visibility === 'hidden') continue;
      const rows = visibleInvoiceRows(popup).slice(0, 4);
      const row = rows[index - 1];
      if (!row) continue;
      const invoiceId = invoiceIdFromRow(row);
      if (!invoiceId) return null;
      if (selectedTicketId === ticketId && selectedInvoiceId === invoiceId) {
        selectedRow = row;
        selectedBuyerSignature = row.querySelector('td')?.textContent?.trim() || '';
        selectedRowIndex = index;
        refresh();
        return invoiceId;
      }
      clearSelection();
      selectedRow = row;
      selectedTicketId = ticketId;
      selectedInvoiceId = invoiceId;
      selectedRowIndex = index;
      selectedBuyerSignature = row.querySelector('td')?.textContent?.trim() || '';
      refresh();
      return invoiceId;
    }
    return null;
  }

  function selectInvoiceById(invoiceId, ticketId) {
    if (!enabled || !ticketId || !/^\d+$/.test(String(invoiceId || ''))) return null;
    for (const popup of document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')) {
      if (!popup.textContent?.includes('Status da fatura:') || !popup.getClientRects().length ||
          getComputedStyle(popup).visibility === 'hidden') continue;
      const rows = visibleInvoiceRows(popup).slice(0, 4);
      const index = rows.findIndex(row => invoiceIdFromRow(row) === String(invoiceId));
      if (index < 0) continue;
      return { invoiceId: selectInvoice(index + 1, ticketId), index: index + 1 };
    }
    clearSelection();
    selectedTicketId = ticketId;
    selectedInvoiceId = String(invoiceId);
    refresh();
    return null;
  }

  function selectedProductCell(ticketId, invoiceId, rowIndex) {
    if (!enabled || selectedTicketId !== ticketId || selectedInvoiceId !== invoiceId) return null;
    for (const popup of document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')) {
      if (!popup.textContent?.includes('Status da fatura:') || !popup.getClientRects().length ||
          getComputedStyle(popup).visibility === 'hidden') continue;
      const rows = visibleInvoiceRows(popup).slice(0, 4);
      const indexedRow = Number.isInteger(rowIndex) ? rows[rowIndex - 1] : null;
      const row = [...rows.filter(item => item.classList.contains(SELECTED_ROW_CLASS)),
        indexedRow, selectedRow]
        .find(item => rows.includes(item) && invoiceIdFromRow(item) === invoiceId);
      if (row) return row.querySelector('td:nth-child(2)');
    }
    return null;
  }

  function selectedProductLines(ticketId, invoiceId, rowIndex) {
    return selectedProductCell(ticketId, invoiceId, rowIndex)
      ?.querySelectorAll(':scope > p.css-glxfbm');
  }

  function fullProductLineText(line) {
    const fullText = [...(line?.querySelectorAll('[aria-label]') || [])]
      .find(node => !node.closest(`.${PRODUCER_NOTE_CLASS}`))?.getAttribute('aria-label');
    const plainText = [...(line?.childNodes || [])]
      .filter(node => !(node instanceof Element && node.classList.contains(PRODUCER_NOTE_CLASS)))
      .map(node => node.textContent || '').join('');
    const text = (fullText || plainText).replace(/\s+/g, ' ').trim();
    return text && !/(?:\.{3}|…)$/.test(text) ? text : null;
  }

  function producerNoteKey(row) {
    const name = producerNameFromRow(row);
    return name ? PRODUCER_NOTE_KEY_PREFIX + name.normalize('NFC').toLocaleLowerCase('pt-BR') : null;
  }

  function producerNameFromRow(row) {
    const lines = row.querySelector('td:nth-child(2)')
      ?.querySelectorAll(':scope > p.css-glxfbm');
    const name = fullProductLineText(lines?.[1]);
    return name && name !== '--' && !name.includes('@') ? name : null;
  }

  function noteText(value) {
    return typeof value === 'string' ? value :
      (value && typeof value.note === 'string' ? value.note : '');
  }

  function loadProducerNotes(keys) {
    const missing = [...new Set(keys)].filter(key =>
      key && !producerNotes.has(key) && !loadingProducerNotes.has(key));
    if (!missing.length) return;
    missing.forEach(key => loadingProducerNotes.add(key));
    chrome.storage.local.get(missing).then(values => {
      for (const key of missing) {
        // A cross-tab edit can arrive before this read resolves; keep the newer value.
        if (!producerNotes.has(key)) {
          producerNotes.set(key, noteText(values[key]));
        }
      }
      scheduleRefresh();
    }).catch(() => {}).finally(() => {
      missing.forEach(key => loadingProducerNotes.delete(key));
    });
  }

  function updateProducerNote(row, missingKeys) {
    const productCell = row.querySelector('td:nth-child(2)');
    if (!productCell) return;
    const lines = productCell.querySelectorAll(':scope > p.css-glxfbm');
    const supportLine = lines[lines.length - 1];
    const key = producerNoteKey(row);
    let holder = supportLine?.querySelector(`:scope > .${PRODUCER_NOTE_CLASS}`);
    if (!key || !supportLine) {
      holder?.remove();
      supportLine?.classList.remove('th-faturas-producer-note-anchor');
      return;
    }
    supportLine.classList.add('th-faturas-producer-note-anchor');
    if (!producerNotes.has(key)) missingKeys.add(key);
    if (holder?.dataset.producerNoteKey !== key) {
      holder?.remove();
      holder = null;
    }
    if (!holder) {
      holder = document.createElement('div');
      holder.className = PRODUCER_NOTE_CLASS;
      holder.dataset.producerNoteKey = key;
      supportLine.appendChild(holder);
    }
    const ageControls = row.querySelector(`td:nth-child(3) .${AGE_CONTROLS_CLASS}`);
    const supportBottom = supportLine.getBoundingClientRect().bottom;
    const ageTop = ageControls?.getBoundingClientRect().top;
    const downwardOffset = Number.isFinite(ageTop) && Number.isFinite(supportBottom)
      ? Math.max(0, Math.round(ageTop - (supportBottom - 4))) : 0;
    const top = downwardOffset ? `calc(100% - 4px + ${downwardOffset}px)` : '';
    if (holder.style.top !== top) holder.style.top = top;
    let button = holder.querySelector('button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'th-faturas-producer-note-button';
      const label = document.createElement('span');
      button.appendChild(label);
      holder.appendChild(button);
    }
    const isLoaded = producerNotes.has(key);
    const note = producerNotes.get(key) || '';
    const label = button.firstElementChild;
    const display = note || '+ Aviso';
    if (label.textContent !== display) label.textContent = display;
    button.classList.toggle('has-note', !!note);
    if (noteMeasureContext) noteMeasureContext.font = '600 17px Calibri';
    const compactNote = !!note && (!supportLine.clientWidth ||
      (noteMeasureContext?.measureText(note).width || note.length * 9) >
        Math.max(0, supportLine.clientWidth - 20));
    button.classList.toggle('compact-note', compactNote);
    button.hidden = !isLoaded;
    button.disabled = !isLoaded;
    button.title = note || 'Adicionar aviso para este produtor';
    button.setAttribute('aria-label', note ? `Editar aviso: ${note}` :
      'Adicionar aviso para este produtor');
  }

  function editProducerNote(button) {
    const holder = button.closest(`.${PRODUCER_NOTE_CLASS}`);
    const key = holder?.dataset.producerNoteKey;
    if (!key) return;
    if (activeProducerNoteEditor?.button === button) {
      activeProducerNoteEditor.editor.focus();
      return;
    }
    activeProducerNoteEditor?.editor.blur();
    const buttonRect = button.getBoundingClientRect();
    const cellRect = button.closest('td')?.getBoundingClientRect();
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'th-faturas-producer-note-editor';
    editor.value = producerNotes.get(key) || '';
    editor.setAttribute('aria-label', 'Aviso do produtor');
    editor.dataset.producerNoteKey = key;
    editor.style.left = `${Math.max(4, buttonRect.left)}px`;
    editor.style.top = `${Math.max(4, Math.min(buttonRect.top, innerHeight - 32))}px`;
    editor.style.width = `${Math.max(80, Math.min((cellRect?.right || buttonRect.right) - buttonRect.left - 4,
      innerWidth - Math.max(4, buttonRect.left) - 8))}px`;
    document.body.appendChild(editor);
    activeProducerNoteEditor = { editor, button, key };
    editor.focus();
    editor.select();
  }

  async function saveProducerNote(editor) {
    const active = activeProducerNoteEditor;
    if (!active || active.editor !== editor || editor.dataset.saving) return;
    editor.dataset.saving = 'true';
    const note = editor.value.replace(/\s+/g, ' ').trim();
    try {
      const name = producerNameFromRow(active.button.closest('tr'));
      await chrome.storage.local.set({ [active.key]: {
        name: name || active.key.slice(PRODUCER_NOTE_KEY_PREFIX.length), note
      } });
      producerNotes.set(active.key, note);
      editor.remove();
      if (activeProducerNoteEditor === active) activeProducerNoteEditor = null;
      scheduleRefresh();
    } catch {
      delete editor.dataset.saving;
      editor.title = 'Não foi possível salvar o aviso. Tente novamente.';
      editor.classList.add('save-error');
      editor.focus();
    }
  }

  function selectedProductName(ticketId, invoiceId, rowIndex) {
    const name = fullProductLineText(selectedProductLines(ticketId, invoiceId, rowIndex)?.[0]);
    return name && name !== '--' && !name.includes('@') ? name : null;
  }

  function selectedProducerName(ticketId, invoiceId, rowIndex) {
    const name = fullProductLineText(selectedProductLines(ticketId, invoiceId, rowIndex)?.[1]);
    return name && name !== '--' && !name.includes('@') ? name : null;
  }

  function selectedSupportEmail(ticketId, invoiceId, rowIndex) {
    const lines = selectedProductLines(ticketId, invoiceId, rowIndex);
    const email = fullProductLineText(lines?.[lines.length - 1]) || '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }

  function readDate(text) {
    const match = String(text || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const stamp = Date.UTC(year, month - 1, day);
    const date = new Date(stamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day ? stamp : null;
  }

  function daysSince(stamp) {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - stamp) / 86400000);
  }

  function installmentCountForRow(row) {
    const badges = row.querySelector('td:first-child .badges');
    const installment = [...(badges?.children || [])]
      .map(node => node.textContent?.trim().match(/^(\d+)\s*x$/i))
      .find(Boolean);
    const count = Number(installment?.[1]);
    return Number.isSafeInteger(count) && count > 1 ? count : null;
  }

  function exclusionDateForRow(row) {
    const valueCell = [...row.querySelectorAll('td')].find(cell =>
      cell.querySelector('.houston-table-label-mobile')?.textContent?.trim() === 'Valor');
    const payment = [...(valueCell?.querySelectorAll('p') || [])].find(node =>
      /^Recebimento\s*:/i.test(node.textContent?.trim() || ''));
    const stamp = readDate(payment?.textContent);
    const count = installmentCountForRow(row);
    if (stamp === null || !count) return null;
    const result = new Date(stamp + ((count - 1) * 30 + 180) * 86400000);
    if (!Number.isFinite(result.getTime())) return null;
    const day = String(result.getUTCDate()).padStart(2, '0');
    const month = String(result.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${result.getUTCFullYear()}`;
  }

  function copyExclusionDate(button) {
    const row = button.closest('tr.houston-table-row-has-action');
    const source = button.dataset.exclusionSource;
    const date = row && exclusionDateForRow(row);
    if (!date) return;
    chrome.runtime.sendMessage({ action: 'COPY_FATURA_EXCLUSION_DATE', date })
      .then(response => {
        if (!response?.ok || !button.isConnected ||
            button.dataset.exclusionSource !== source ||
            exclusionDateForRow(row) !== date) return;
        button.textContent = date;
        button.setAttribute('aria-label', `Copiar data de exclusão ${date}`);
      })
      .catch(() => {});
  }

  function removeBadge(anchor) {
    anchor.querySelector(`:scope > .${AGE_CONTROLS_CLASS}`)?.remove();
    anchor.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
    anchor.classList.remove(ANCHOR_CLASS);
  }

  function updateRow(row) {
    const valueCell = [...row.querySelectorAll('td')].find(cell =>
      cell.querySelector('.houston-table-label-mobile')?.textContent?.trim() === 'Valor');
    if (!valueCell) return;
    const paragraphs = [...valueCell.querySelectorAll('p')];
    const payment = paragraphs.find(node => /^Recebimento\s*:/i.test(node.textContent?.trim() || ''));
    const refund = paragraphs.find(node => /^Reembolso até\s*:/i.test(node.textContent?.trim() || ''));
    if (!refund) return;
    const stamp = readDate(payment?.textContent);
    const days = stamp === null ? -1 : daysSince(stamp);
    if (days < 0) {
      removeBadge(refund);
      return;
    }
    const label = days === 0 ? 'Hoje' : days === 1 ? '1 dia' :
      days >= 180 ? '180+' : `${days} dias`;
    const tone = days <= 7 ? 'th-faturas-age-green' :
      days <= 150 ? 'th-faturas-age-yellow' : 'th-faturas-age-red';
    let controls = refund.querySelector(`:scope > .${AGE_CONTROLS_CLASS}`);
    if (!controls) {
      controls = document.createElement('span');
      controls.classList.add(AGE_CONTROLS_CLASS);
      refund.classList.add(ANCHOR_CLASS);
      refund.appendChild(controls);
    }
    let badge = controls.querySelector(`:scope > .${BADGE_CLASS}`);
    if (!badge) {
      badge = refund.querySelector(`:scope > .${BADGE_CLASS}`) || document.createElement('span');
      badge.classList.add(BADGE_CLASS);
      controls.prepend(badge);
    }
    badge.removeAttribute('role');
    badge.removeAttribute('tabindex');
    badge.removeAttribute('aria-label');
    if (badge.textContent !== label) badge.textContent = label;
    if (!badge.classList.contains(tone)) {
      badge.classList.remove('th-faturas-age-green', 'th-faturas-age-yellow',
        'th-faturas-age-red');
      badge.classList.add(tone);
    }
    const count = installmentCountForRow(row);
    let button = controls.querySelector(`:scope > .${EXCLUSION_BUTTON_CLASS}`);
    if (!count) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.classList.add(EXCLUSION_BUTTON_CLASS);
      controls.appendChild(button);
    }
    const source = `${invoiceIdFromRow(row) || ''}:${stamp}:${count}`;
    if (button.dataset.exclusionSource !== source) {
      button.dataset.exclusionSource = source;
      button.textContent = 'Calcular Exclusão';
      button.setAttribute('aria-label', 'Calcular e copiar data de exclusão');
    }
  }

  function refresh() {
    if (!enabled || location.origin !== 'https://bo.eduzz.com') return;
    const showAgeBadges = location.pathname.replace(/\/$/, '') === '/dashboard/reembolso';
    let selectedStillStaged = false;
    const missingProducerNoteKeys = new Set();
    for (const popup of document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')) {
      if (!popup.textContent?.includes('Status da fatura:')) continue;
      const rows = [...popup.querySelectorAll('.MuiTableContainer-root tbody tr.houston-table-row-has-action')];
      const stagedRows = rows.filter(row => row.getClientRects().length > 0).slice(0, 4);
      popup.querySelector('.MuiTableContainer-root')?.classList.toggle(NUMBER_GUTTER_CLASS, stagedRows.length > 0);
      if (stagedRows.includes(selectedRow) &&
          invoiceIdFromRow(selectedRow) === selectedInvoiceId &&
          selectedRow.querySelector('td')?.textContent?.trim() === selectedBuyerSignature) {
        selectedStillStaged = true;
      } else if (selectedInvoiceId) {
        const preferred = Number.isInteger(selectedRowIndex) ? stagedRows[selectedRowIndex - 1] : null;
        const matching = preferred && invoiceIdFromRow(preferred) === selectedInvoiceId
          ? preferred : stagedRows.find(row => invoiceIdFromRow(row) === selectedInvoiceId);
        if (matching) {
          selectedRow = matching;
          selectedRowIndex = stagedRows.indexOf(matching) + 1;
          selectedBuyerSignature = matching.querySelector('td')?.textContent?.trim() || '';
          selectedStillStaged = true;
        }
      }
      rows.forEach((row) => {
        const stagedIndex = stagedRows.indexOf(row);
        const number = stagedIndex < 0 ? 0 : stagedIndex + 1;
        row.classList.toggle(STAGED_ROW_CLASS, number > 0);
        row.classList.toggle(SELECTED_ROW_CLASS, row === selectedRow && selectedStillStaged);
        row.classList.toggle(RELATED_ROW_CLASS, number > 0 && selectedStillStaged &&
          row !== selectedRow && invoiceIdFromRow(row) === selectedInvoiceId);
        const firstCell = row.querySelector('td');
        if (firstCell) {
          if (number) firstCell.dataset.thFaturasRowNumber = String(number);
          else delete firstCell.dataset.thFaturasRowNumber;
        }
      });
      for (const row of rows) {
        if (showAgeBadges) updateRow(row);
        updateProducerNote(row, missingProducerNoteKeys);
      }
    }
    loadProducerNotes([...missingProducerNoteKeys]);
    if (activeProducerNoteEditor && !activeProducerNoteEditor.button.isConnected) {
      activeProducerNoteEditor.editor.blur();
    }
    if (!selectedStillStaged) selectedRow = null;
  }

  function scheduleRefresh() {
    if (!enabled || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  }

  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    if (!enabled) return;
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(() => {
      scheduleRefresh();
      scheduleMidnight();
    }, tomorrow - now + 250);
  }

  function restoreSelectedInvoice() {
    chrome.runtime.sendMessage({ action: 'GET_SELECTED_FATURA_STATE' }).then(state => {
      if (enabled && !selectedInvoiceId && state?.ticketId &&
          /^\d+$/.test(String(state.invoiceId || ''))) {
        selectedTicketId = String(state.ticketId);
        selectedInvoiceId = String(state.invoiceId);
        selectedRowIndex = Number.isInteger(state.rowIndex) ? state.rowIndex : null;
        scheduleRefresh();
      }
    }).catch(() => {});
  }

  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) {
      activeProducerNoteEditor?.editor.blur();
      clearSelection();
      for (const row of document.querySelectorAll(`.${STAGED_ROW_CLASS}`)) {
        row.classList.remove(STAGED_ROW_CLASS, RELATED_ROW_CLASS, SELECTED_ROW_CLASS);
        row.querySelector('td')?.removeAttribute('data-th-faturas-row-number');
      }
      document.querySelectorAll(`.${NUMBER_GUTTER_CLASS}`).forEach(container =>
        container.classList.remove(NUMBER_GUTTER_CLASS));
      for (const anchor of document.querySelectorAll(`.${ANCHOR_CLASS}`)) {
        removeBadge(anchor);
      }
      document.querySelectorAll(`.${PRODUCER_NOTE_CLASS}`).forEach(holder => holder.remove());
      document.querySelectorAll('.th-faturas-producer-note-anchor').forEach(line =>
        line.classList.remove('th-faturas-producer-note-anchor'));
    } else {
      scheduleRefresh();
      restoreSelectedInvoice();
    }
    scheduleMidnight();
  }

  function isPopupMutation(record) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('[role="presentation"]')) return true;
    return [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches('[role="presentation"]') ||
        node.querySelector('[role="presentation"]')));
  }

  new MutationObserver(records => {
    if (records.some(isPopupMutation)) scheduleRefresh();
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (!enabled || event.button !== 0 || !(event.target instanceof Element)) return;
    const noteButton = event.target.closest('.th-faturas-producer-note-button');
    if (noteButton) {
      event.preventDefault();
      event.stopPropagation();
      if (!noteButton.disabled) editProducerNote(noteButton);
      return;
    }
    const exclusionButton = event.target.closest(`.${EXCLUSION_BUTTON_CLASS}`);
    if (exclusionButton) {
      event.preventDefault();
      event.stopPropagation();
      copyExclusionDate(exclusionButton);
      return;
    }
    if (event.target.closest(`.${BADGE_CLASS}`)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const popup = event.target.closest('[role="presentation"] > [tabindex="-1"]');
    if (!popup?.textContent?.includes('Status da fatura:')) return;
    const rows = visibleInvoiceRows(popup).slice(0, 4);
    for (const [index, row] of rows.entries()) {
      if (!row.classList.contains(STAGED_ROW_CLASS)) continue;
      const rect = row.querySelector('td')?.getBoundingClientRect();
      if (!rect || event.clientX < rect.left - 22 || event.clientX >= rect.left - 2 ||
          event.clientY < rect.top || event.clientY >= rect.bottom) continue;
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ action: 'SELECT_FATURAS_ROW_FROM_CLICK', index: index + 1 })
        .catch(() => {});
      return;
    }
  }, true);

  document.addEventListener('keydown', event => {
    const editor = event.target;
    if (!(editor instanceof HTMLInputElement) ||
        !editor.classList.contains('th-faturas-producer-note-editor')) return;
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      editor.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (activeProducerNoteEditor?.editor === editor) activeProducerNoteEditor = null;
      editor.remove();
    }
  }, true);

  document.addEventListener('blur', event => {
    const editor = event.target;
    if (editor instanceof HTMLInputElement &&
        editor.classList.contains('th-faturas-producer-note-editor')) {
      void saveProducerNote(editor);
    }
  }, true);

  chrome.storage.local.get('enabled').then(state => setEnabled(state.enabled)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) setEnabled(changes.enabled.newValue);
    if (area === 'local') {
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(PRODUCER_NOTE_KEY_PREFIX)) continue;
        producerNotes.set(key, noteText(change.newValue));
        scheduleRefresh();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'CLEAR_FATURAS_SELECTION') {
      if (!message.ownerTicketId || selectedTicketId !== message.ownerTicketId) {
        clearSelection();
        refresh();
      }
      sendResponse({ ok: true });
    } else if (message?.action === 'SELECT_FATURAS_ROW') {
      const invoiceId = selectInvoice(message.index, message.ticketId);
      sendResponse({ ok: !!invoiceId, invoiceId });
    } else if (message?.action === 'SELECT_FATURAS_ID') {
      const found = selectInvoiceById(message.invoiceId, message.ticketId);
      sendResponse({ found: !!found, index: found?.index || null });
    } else if (message?.action === 'GET_SELECTED_FATURA_PRODUCER_NAME') {
      sendResponse({ name: selectedProducerName(message.ticketId, message.invoiceId,
        message.rowIndex) });
    } else if (message?.action === 'GET_SELECTED_FATURA_PRODUCT_NAME') {
      sendResponse({ product: selectedProductName(message.ticketId, message.invoiceId,
        message.rowIndex) });
    } else if (message?.action === 'GET_SELECTED_FATURA_SUPPORT_EMAIL') {
      sendResponse({ email: selectedSupportEmail(message.ticketId, message.invoiceId,
        message.rowIndex) });
    }
  });
})();
