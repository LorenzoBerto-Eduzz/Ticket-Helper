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

  function sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch) {
    const context = globalThis.TicketHelperMacroContext?.();
    return !!editor?.isConnected && document.visibilityState === 'visible' &&
      document.hasFocus() && ticketId() === expectedTicketId &&
      context?.ready === true && context.ticketId === expectedTicketId &&
      context.ownerEpoch === expectedOwnerEpoch;
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
    if (/\r?\n/.test(value)) {
      const lines = String(value).split(/\r?\n/);
      const fragment = document.createDocumentFragment();
      lines.forEach((line, index) => {
        if (index) fragment.appendChild(document.createElement('br'));
        if (line) fragment.appendChild(document.createTextNode(line));
      });
      range.insertNode(fragment);
    } else {
      range.insertNode(document.createTextNode(value));
    }
    return true;
  }

  function removeStandaloneLabel(root, start, end, label) {
    const from = textPosition(root, start, true);
    const to = textPosition(root, end);
    if (!from || !to || from.node !== to.node) return replaceAt(root, start, end, '');
    const node = from.node;
    const text = node.textContent;
    const lineStart = text.lastIndexOf('\n', from.offset - 1) + 1;
    const lineBreak = text.indexOf('\n', to.offset);
    if (lineBreak >= 0 && !text.slice(lineStart, from.offset).trim() &&
        !text.slice(to.offset, lineBreak).trim()) {
      let after = lineBreak + 1;
      const nextBreak = text.indexOf('\n', after);
      if (nextBreak >= 0 && !text.slice(after, nextBreak).trim()) after = nextBreak + 1;
      return replaceAt(root, start - (from.offset - lineStart),
        end + (after - to.offset), '');
    }
    if ((node.textContent.slice(0, from.offset) +
        node.textContent.slice(to.offset)).trim()) return replaceAt(root, start, end, '');
    // A dedicated paragraph can be removed without disturbing adjacent lines.
    const block = node.parentElement?.closest('p, div');
    if (block && block !== root && block !== editorFor(root) &&
        block.textContent.trim() === label.trim() &&
        (root.contains(block) || block.contains(root))) {
      const following = block.nextElementSibling;
      if (following?.matches('p, div') && !following.textContent.trim())
        following.remove();
      block.remove();
      return true;
    }
    // ProKeys also represents a standalone line as text between <br> nodes.
    const next = node.nextSibling;
    const previous = node.previousSibling;
    if (next?.nodeName === 'BR') {
      const blankBelow = next.nextSibling?.nodeName === 'BR' ? next.nextSibling : null;
      if (!replaceAt(root, start, end, '')) return false;
      next.remove();
      blankBelow?.remove();
      return true;
    }
    if (previous?.nodeName === 'BR') {
      if (!replaceAt(root, start, end, '')) return false;
      previous.remove();
      return true;
    }
    return replaceAt(root, start, end, '');
  }

  function composerFor(editor) {
    for (let parent = editor.parentElement; parent; parent = parent.parentElement) {
      const showCount = parent.querySelectorAll('[data-selenium-test="show-cc-button"]').length;
      const ccCount = parent.querySelectorAll('[data-selenium-test="metadata-cc-input"]').length;
      const compactCount = parent.querySelectorAll('[data-test-id="compact-header-recipients"]').length;
      if (showCount > 1 || ccCount > 1 || compactCount > 1) return null;
      if (showCount || ccCount || compactCount) return parent;
    }
    return null;
  }

  function pressEnterAndWaitForCcTag(section, input) {
    const selector = '[data-component-name="UITag"]';
    const previousCount = section.querySelectorAll(selector).length;
    return new Promise(resolve => {
      let timer;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (section.querySelectorAll(selector).length > previousCount) finish();
      };
      const observer = new MutationObserver(check);
      observer.observe(section, { childList: true, subtree: true });
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter',
        keyCode: 13, which: 13, bubbles: true }));
      check();
      if (!done) timer = setTimeout(finish, 200);
    });
  }

  async function addProducerCc(editor, email, expectedTicketId, expectedOwnerEpoch) {
    if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
    let composer = composerFor(editor);
    if (!composer) return false;
    let section = composer.querySelector('[data-selenium-test="metadata-cc-input"]');
    if (!section) {
      let show = composer.querySelector('[data-selenium-test="show-cc-button"]');
      if (!show) {
        const compact = composer.querySelector('[data-test-id="compact-header-recipients"]');
        if (!compact) return false;
        compact.click();
        for (let attempt = 0; attempt < 40 && !show && !section; attempt++) {
          if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
          composer = composerFor(editor) || composer;
          section = composer.querySelector('[data-selenium-test="metadata-cc-input"]');
          show = composer.querySelector('[data-selenium-test="show-cc-button"]');
          if (!show && !section) await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (!section) {
        if (!show || show.getAttribute('aria-disabled') === 'true') return false;
        show.click();
        for (let attempt = 0; attempt < 40 && !section; attempt++) {
          if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
          composer = composerFor(editor) || composer;
          section = composer.querySelector('[data-selenium-test="metadata-cc-input"]');
          if (!section) await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
    }
    if (!section || !sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
    const input = section.querySelector('.Select-input input[role="combobox"]');
    if (!input || input.disabled) return false;
    if (input.value.trim() && input.value.trim().toLowerCase() !== email.toLowerCase()) return false;
    const selection = document.getSelection();
    const caret = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    const clearUncommittedEmail = () => {
      if (!input.isConnected || input.value.trim().toLowerCase() !== email.toLowerCase()) return;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setter.call(input, email);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch) || !input.isConnected) {
      clearUncommittedEmail();
      return false;
    }
    await pressEnterAndWaitForCcTag(section, input);
    if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
    editor.focus();
    if (caret && caret.startContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
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
    if (!enabled || rulesRevision !== revision ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return;
    const markerStillRemains = snippet.isConnected && editorFor(snippet) === editor &&
      snippet.textContent === originalText;
    if (!markerStillRemains && (editor.textContent || '').slice(startOffset,
      startOffset + originalText.length) !== originalText) return;
    let changed = false;
    for (const match of matches.reverse()) {
      const value = values.get(match.action);
      if (!value) continue;
      const root = markerStillRemains ? snippet : editor;
      const start = markerStillRemains ? match.start : startOffset + match.start;
      const end = markerStillRemains ? match.end : startOffset + match.end;
      changed = (match.action === 'ccProducer'
        ? removeStandaloneLabel(root, start, end, match.label)
        : replaceAt(root, start, end, value)) || changed;
    }
    if (changed) editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (matches.some(match => match.action === 'ccProducer') && values.get('ccProducer')) {
      await addProducerCc(editor, values.get('ccProducer'), ownerTicketId, ownerEpoch);
    }
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
