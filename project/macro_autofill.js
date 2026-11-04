(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroAutofillCore;
  if (!core || globalThis.__ticketHelperMacroAutofillLoaded) return;
  globalThis.__ticketHelperMacroAutofillLoaded = true;

  let enabled = false;
  let rules = [];
  let rulesRevision = 0;
  let enabledChangedDuringLoad = false;
  let observer = null;
  const seen = new WeakSet();

  function ticketId() {
    if (location.hostname !== 'app.hubspot.com' ||
        !location.pathname.startsWith('/help-desk/')) return null;
    return location.pathname.match(/\/ticket\/(\d+)(?:\/|$)/)?.[1] || null;
  }

  function editorFor(snippet) {
    const editor = snippet.closest('[contenteditable="true"], [contenteditable=""]');
    return editor && !editor.closest('#ticket-helper-popup') ? editor : null;
  }

  function focusedTicketEditor(editor, ticketId, ownerEpoch) {
    const context = globalThis.TicketHelperMacroContext?.();
    return !!editor?.isConnected && document.visibilityState === 'visible' &&
      document.hasFocus() &&
      (document.activeElement === editor || editor.contains(document.activeElement)) &&
      context?.ready === true && context.ticketId === ticketId &&
      context.ownerEpoch === ownerEpoch;
  }

  function textPosition(root, offset, preferNextAtBoundary = false) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let cursor = 0;
    let boundary = null;
    while ((node = walker.nextNode())) {
      const end = cursor + node.textContent.length;
      if (offset < end || (offset === end && !preferNextAtBoundary))
        return { node, offset: offset - cursor };
      if (offset === end) boundary = { node, offset: node.textContent.length };
      cursor = end;
    }
    return offset === cursor ? boundary : null;
  }

  function textOffset(root, descendant) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let offset = 0;
    while ((node = walker.nextNode())) {
      if (descendant.contains(node)) return offset;
      offset += node.textContent.length;
    }
    return null;
  }

  function replaceAt(snippet, start, end, value) {
    const from = textPosition(snippet, start, true);
    const to = textPosition(snippet, end);
    if (!from || !to) return false;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    range.deleteContents();
    range.insertNode(document.createTextNode(value));
    return true;
  }

  function requestValue(action, expectedTicketId, expectedOwnerEpoch) {
    if (action === 'timeGreeting')
      return Promise.resolve(core.greetingForHour(new Date().getHours()));
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'RESOLVE_MACRO_AUTOFILL_VALUE',
          macroAction: action, ticketId: expectedTicketId,
          ownerEpoch: expectedOwnerEpoch }, response => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(typeof response?.value === 'string' ? response.value : null);
        });
      } catch { resolve(null); }
    });
  }

  async function processSnippet(snippet) {
    if (!enabled || !snippet.isConnected) return;
    const editor = editorFor(snippet);
    const context = globalThis.TicketHelperMacroContext?.();
    const ownerTicketId = context?.ticketId;
    const ownerEpoch = context?.ownerEpoch;
    if (!editor || !ownerTicketId || ticketId() !== ownerTicketId ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return;
    const originalText = snippet.textContent || '';
    const startOffset = textOffset(editor, snippet);
    const revision = rulesRevision;
    const matches = core.findMatches(originalText, rules);
    if (!matches.length || startOffset === null) return;
    const values = new Map();
    await Promise.all([...new Set(matches.map(match => match.action))].map(async action => {
      values.set(action, await requestValue(action, ownerTicketId, ownerEpoch));
    }));
    if (!enabled || rulesRevision !== revision || !editor.isConnected ||
        ticketId() !== ownerTicketId ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return;
    const markerRemains = snippet.isConnected && editorFor(snippet) === editor &&
      snippet.textContent === originalText;
    // HubSpot may replace ProKeys' span before the value comes back. In that
    // case, touch only the unchanged text at the span's original position.
    if (!markerRemains && (editor.textContent || '').slice(startOffset,
      startOffset + originalText.length) !== originalText) return;
    let changed = false;
    for (const match of matches.reverse()) {
      const value = values.get(match.action);
      if (value) changed = markerRemains
        ? replaceAt(snippet, match.start, match.end, value) || changed
        : replaceAt(editor, startOffset + match.start, startOffset + match.end, value) || changed;
    }
    if (changed) editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function inspect(node) {
    if (!(node instanceof Element)) return;
    const snippets = node.matches('.prokeys-snippet-text') ? [node] :
      node.querySelectorAll('.prokeys-snippet-text');
    for (const snippet of snippets) {
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      void processSnippet(snippet);
    }
  }

  function updateObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (!enabled || !rules.some(rule => rule.action)) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) inspect(node);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  // ProKeys fires a synthetic input event on its inserted span. Capture it
  // before HubSpot's editor can normalize or replace that span.
  document.addEventListener('input', event => {
    if (enabled && event.target instanceof Element) inspect(event.target);
  }, true);

  chrome.storage.local.get(['enabled', core.STORAGE_KEY]).then(state => {
    if (!enabledChangedDuringLoad) enabled = state.enabled === true;
    if (!rulesRevision) rules = core.validRules(state[core.STORAGE_KEY]);
    updateObserver();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      enabled = changes.enabled.newValue === true;
      enabledChangedDuringLoad = true;
    }
    if (changes[core.STORAGE_KEY]) {
      rules = core.validRules(changes[core.STORAGE_KEY].newValue);
      rulesRevision++;
    }
    if (changes.enabled || changes[core.STORAGE_KEY]) updateObserver();
  });
})();
