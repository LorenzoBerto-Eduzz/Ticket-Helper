(() => {
  const BADGE_CLASS = 'th-faturas-age-badge';
  const ANCHOR_CLASS = 'th-faturas-age-anchor';
  let enabled = false;
  let scheduled = false;
  let midnightTimer = null;

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

  function removeBadge(anchor) {
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
      days >= 150 ? '150+' : `${days} dias`;
    const tone = days <= 7 ? 'th-faturas-age-green' : 'th-faturas-age-red';
    let badge = refund.querySelector(`:scope > .${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement('span');
      badge.classList.add(BADGE_CLASS);
      refund.classList.add(ANCHOR_CLASS);
      refund.appendChild(badge);
    }
    if (badge.textContent !== label) badge.textContent = label;
    if (!badge.classList.contains(tone)) {
      badge.classList.remove('th-faturas-age-green', 'th-faturas-age-red');
      badge.classList.add(tone);
    }
  }

  function refresh() {
    if (!enabled || location.origin !== 'https://bo.eduzz.com' ||
        location.pathname.replace(/\/$/, '') !== '/dashboard/reembolso') return;
    for (const popup of document.querySelectorAll('[role="presentation"] > [tabindex="-1"]')) {
      if (!popup.textContent?.includes('Status da fatura:')) continue;
      for (const row of popup.querySelectorAll('.MuiTableContainer-root tbody tr.houston-table-row-has-action')) {
        updateRow(row);
      }
    }
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

  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) {
      for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) {
        const anchor = badge.parentElement;
        badge.remove();
        anchor?.classList.remove(ANCHOR_CLASS);
      }
    } else scheduleRefresh();
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

  chrome.storage.local.get('enabled').then(state => setEnabled(state.enabled)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) setEnabled(changes.enabled.newValue);
  });
})();
