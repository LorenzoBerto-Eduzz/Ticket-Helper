(() => {
  const BADGE_CLASS = 'th-faturas-age-badge';
  const ANCHOR_CLASS = 'th-faturas-age-anchor';
  const AGE_CONTROLS_CLASS = 'th-faturas-age-controls';
  const EXCLUSION_BUTTON_CLASS = 'th-faturas-exclusion-button';
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
    const fullText = line?.querySelector('[aria-label]')?.getAttribute('aria-label');
    const text = (fullText || line?.textContent || '').replace(/\s+/g, ' ').trim();
    return text && !/(?:\.{3}|…)$/.test(text) ? text : null;
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
    const tone = days <= 7 ? 'th-faturas-age-green' : 'th-faturas-age-red';
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
      badge.classList.remove('th-faturas-age-green', 'th-faturas-age-red');
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
      }
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

  chrome.storage.local.get('enabled').then(state => setEnabled(state.enabled)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) setEnabled(changes.enabled.newValue);
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
