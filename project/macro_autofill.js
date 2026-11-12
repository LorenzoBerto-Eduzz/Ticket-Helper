(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroAutofillCore;
  const visuals = globalThis.TicketHelperMacroAutofillVisuals;
  const finalActions = globalThis.TicketHelperMacroAutofillFinal;
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

  function plainField(node) {
    return node?.tagName === 'TEXTAREA' ||
      (node?.tagName === 'INPUT' &&
        ['text', 'search', 'email', 'tel', 'url'].includes(node.type));
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

  function sameTicketOwner(editor, expectedTicketId, expectedOwnerEpoch) {
    const context = globalThis.TicketHelperMacroContext?.();
    return !!editor?.isConnected && ticketId() === expectedTicketId &&
      context?.ready === true && context.ticketId === expectedTicketId &&
      context.ownerEpoch === expectedOwnerEpoch;
  }

  function sameTicketDuringFinalDialog(editor, expectedTicketId, expectedOwnerEpoch) {
    const context = globalThis.TicketHelperMacroContext?.();
    // The modal can move focus and temporarily hide the ticket header used
    // by context.ready. The route and owner epoch still identify the ticket.
    return !!editor?.isConnected && document.visibilityState === 'visible' &&
      ticketId() === expectedTicketId && context?.ticketId === expectedTicketId &&
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

  function pressEnterAndWaitForCc(input) {
    return new Promise(resolve => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter',
        keyCode: 13, which: 13, bubbles: true }));
      setTimeout(resolve, 150);
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
    await pressEnterAndWaitForCc(input);
    if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
    editor.focus();
    if (caret && caret.startContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    return true;
  }

  function requestRefundReceipt(invoiceId, expectedTicketId, expectedOwnerEpoch) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'RUN_MACRO_REFUND_RECEIPT',
          invoiceId, ticketId: expectedTicketId, ownerEpoch: expectedOwnerEpoch }, response => {
          resolve(!chrome.runtime.lastError && response?.ok === true);
        });
      } catch { resolve(false); }
    });
  }

  async function openRefundReceiptUpload(editor, expectedTicketId, expectedOwnerEpoch) {
    if (!sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch)) return false;
    let toolbar = null;
    for (let parent = editor.parentElement; parent; parent = parent.parentElement) {
      const candidates = [...parent.querySelectorAll(
        '[data-test-id="toolbar-file"] button[aria-label="Attach file"]')]
        .filter(button => button.getClientRects().length);
      if (candidates.length > 1) return false;
      if (candidates.length === 1) { toolbar = candidates[0]; break; }
    }
    if (!toolbar || toolbar.disabled || toolbar.getAttribute('aria-disabled') === 'true')
      return false;
    toolbar.click();
    const upload = await new Promise(resolve => {
      const find = () => {
        const choices = [...document.querySelectorAll(
          '[data-component-name="UIPopover"] [data-test-id="attach-file-input"]')]
          .filter(choice => choice.getClientRects().length &&
            !choice.closest('[aria-hidden="true"]'));
        return choices.length === 1 ? choices[0] : null;
      };
      const immediate = find();
      if (immediate) { resolve(immediate); return; }
      const observer = new MutationObserver(() => {
        const choice = find();
        if (!choice) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(choice);
      });
      const timeout = setTimeout(() => { observer.disconnect(); resolve(null); }, 1000);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
    if (!upload || !sameTicketContext(editor, expectedTicketId, expectedOwnerEpoch) ||
        upload.getAttribute('aria-disabled') === 'true') return false;
    upload.click();
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

  async function processPlainSpan(field, originalText, startOffset) {
    if (!enabled || !plainField(field) || !originalText || startOffset < 0) return;
    const context = globalThis.TicketHelperMacroContext?.();
    const ownerTicketId = context?.ticketId;
    const ownerEpoch = context?.ownerEpoch;
    if (!ownerTicketId || ticketId() !== ownerTicketId ||
        !focusedTicketEditor(field, ownerTicketId, ownerEpoch)) return;
    const matches = core.findMatches(originalText, rules, true);
    if (!matches.length) return;
    const snapshot = field.value;
    if (snapshot.slice(startOffset, startOffset + originalText.length) !== originalText) return;
    const revision = rulesRevision;
    const values = new Map();
    await Promise.all([...new Set(matches.map(match => match.action))]
      .filter(action => action && !core.FINAL_ACTIONS[action] &&
        action !== 'ccProducer' && action !== 'refundReceiptUpload')
      .map(async action => values.set(action,
        await requestValue(action, ownerTicketId, ownerEpoch))));
    if (!enabled || rulesRevision !== revision || field.value !== snapshot ||
        !focusedTicketEditor(field, ownerTicketId, ownerEpoch)) return;
    let inserted = originalText;
    for (const match of matches.reverse()) {
      const value = values.get(match.action);
      if (!value) continue;
      const replacement = field.tagName === 'INPUT' ? value.replace(/\r?\n/g, ' ') : value;
      inserted = inserted.slice(0, match.start) + replacement + inserted.slice(match.end);
    }
    if (inserted !== originalText) {
      const result = snapshot.slice(0, startOffset) + inserted +
        snapshot.slice(startOffset + originalText.length);
      if (field.maxLength >= 0 && result.length > field.maxLength) return;
      const setter = Object.getOwnPropertyDescriptor(
        field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value')?.set;
      if (!setter) return;
      const caret = field.selectionStart;
      setter.call(field, result);
      const shift = inserted.length - originalText.length;
      if (Number.isInteger(caret)) {
        const nextCaret = Math.max(0, Math.min(result.length,
          caret >= startOffset + originalText.length ? caret + shift : caret));
        field.setSelectionRange(nextCaret, nextCaret);
      }
      field.dispatchEvent(new InputEvent('input', { bubbles: true,
        inputType: 'insertReplacementText' }));
    }
    visuals?.track(field, ownerTicketId, rules);
  }

  async function processTextSpan(editor, originalText, startOffset, snippet = null) {
    if (!enabled || !editor?.isConnected) return;
    const context = globalThis.TicketHelperMacroContext?.();
    const ownerTicketId = context?.ticketId;
    const ownerEpoch = context?.ownerEpoch;
    if (!editor || !ownerTicketId || ticketId() !== ownerTicketId ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return;
    const revision = rulesRevision;
    const allMatches = core.findMatches(originalText, rules, true);
    if (!allMatches.length || startOffset === null) return;
    const matches = allMatches.filter(match => match.action && !core.FINAL_ACTIONS[match.action]);
    const endingMatches = allMatches.filter(match => core.FINAL_ACTIONS[match.action]);
    if (!matches.length && !endingMatches.length) {
      visuals?.track(editor, ownerTicketId, rules);
      return;
    }
    const values = new Map();
    await Promise.all([...new Set(matches.map(match => match.action))].map(async action => {
      values.set(action, await requestValue(action, ownerTicketId, ownerEpoch));
    }));
    if (!enabled || rulesRevision !== revision || !editor.isConnected ||
        ticketId() !== ownerTicketId ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) {
      if (enabled && ticketId() === ownerTicketId)
        visuals?.track(editor, ownerTicketId, rules);
      return;
    }
    const markerRemains = snippet?.isConnected && editorFor(snippet) === editor &&
      snippet.textContent === originalText;
    // HubSpot may replace ProKeys' span before the value comes back. In that
    // case, touch only the unchanged text at the span's original position.
    if (!markerRemains && (editor.textContent || '').slice(startOffset,
      startOffset + originalText.length) !== originalText) {
      visuals?.track(editor, ownerTicketId, rules);
      return;
    }
    if (!enabled || rulesRevision !== revision ||
        !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return;
    const markerStillRemains = snippet?.isConnected && editorFor(snippet) === editor &&
      snippet.textContent === originalText;
    if (!markerStillRemains && (editor.textContent || '').slice(startOffset,
      startOffset + originalText.length) !== originalText) {
      visuals?.track(editor, ownerTicketId, rules);
      return;
    }
    let changed = false;
    const receiptLabels = [];
    for (const match of matches.reverse()) {
      const value = values.get(match.action);
      if (!value) continue;
      if (match.action === 'refundReceiptUpload') {
        const liveSnippet = snippet?.isConnected && editorFor(snippet) === editor;
        const root = liveSnippet ? snippet : editor;
        const start = liveSnippet ? match.start : startOffset + match.start;
        const end = liveSnippet ? match.end : startOffset + match.end;
        if ((root.textContent || '').slice(start, end).toLowerCase() !==
            match.label.toLowerCase()) continue;
        const from = textPosition(root, start, true);
        const to = textPosition(root, end);
        if (!from || !to) continue;
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        receiptLabels.push({ root, range, label: match.label, invoiceId: value });
        continue;
      }
      if (match.action === 'ccProducer' &&
          !await addProducerCc(editor, value, ownerTicketId, ownerEpoch)) continue;
      if (!enabled || rulesRevision !== revision ||
          !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) break;
      const liveSnippet = snippet?.isConnected && editorFor(snippet) === editor;
      const root = liveSnippet ? snippet : editor;
      const start = liveSnippet ? match.start : startOffset + match.start;
      const end = liveSnippet ? match.end : startOffset + match.end;
      if ((root.textContent || '').slice(start, end).toLowerCase() !==
          match.label.toLowerCase()) continue;
      changed = (match.action === 'ccProducer'
        ? removeStandaloneLabel(root, start, end, match.label)
        : replaceAt(root, start, end, value)) || changed;
    }
    if (receiptLabels.length &&
        sameTicketContext(editor, ownerTicketId, ownerEpoch)) {
      const invoiceId = receiptLabels[0].invoiceId;
      const downloaded = await requestRefundReceipt(invoiceId, ownerTicketId, ownerEpoch);
      const uploadOpened = downloaded &&
        await openRefundReceiptUpload(editor, ownerTicketId, ownerEpoch);
      if (uploadOpened && sameTicketOwner(editor, ownerTicketId, ownerEpoch)) {
        for (const { root, range, label } of receiptLabels) {
          if (!root.isConnected || !root.contains(range.startContainer) ||
              !root.contains(range.endContainer) ||
              range.toString().toLowerCase() !== label.toLowerCase()) continue;
          const start = textOffset(root, range.startContainer) + range.startOffset;
          const end = start + label.length;
          changed = removeStandaloneLabel(root, start, end, label) || changed;
        }
      }
    }
    if (changed) editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (endingMatches.length === 1 && finalActions &&
        focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) {
      const ending = endingMatches[0];
      const live = core.eligibleFinalMatch(editor.textContent || '', rules, ending.action);
      if (live && live.label.toLowerCase() === ending.label.toLowerCase()) {
        const removeLabel = () => {
          if (!focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return null;
          const current = core.eligibleFinalMatch(editor.textContent || '', rules,
            ending.action);
          if (!current) return null;
          const beforeHtml = editor.innerHTML;
          if (!removeStandaloneLabel(editor, current.start, current.end,
            current.label)) return null;
          const afterText = editor.textContent;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          return () => {
            if (!editor.isConnected || editor.textContent !== afterText) return;
            editor.innerHTML = beforeHtml;
            for (const marker of editor.querySelectorAll(
              '.prokeys-snippet-text, .th-macro-inserted')) seen.add(marker);
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          };
        };
        await finalActions.run(editor, ending.action,
          () => enabled && rulesRevision === revision &&
            sameTicketDuringFinalDialog(editor, ownerTicketId, ownerEpoch), removeLabel);
      }
    }
    if (ticketId() === ownerTicketId) visuals?.track(editor, ownerTicketId, rules);
  }

  function processSnippet(snippet) {
    if (!enabled || !snippet.isConnected) return;
    const editor = editorFor(snippet);
    if (!editor) return;
    void processTextSpan(editor, snippet.textContent || '', textOffset(editor, snippet), snippet);
  }

  function selectionTextOffset(editor, node, offset) {
    if (!editor.contains(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(editor);
    try { range.setEnd(node, offset); }
    catch { return null; }
    return range.cloneContents().textContent.length;
  }

  document.addEventListener('paste', event => {
    if (!enabled || !rules.length) return;
    if (plainField(event.target)) {
      const field = event.target;
      const pasted = event.clipboardData?.getData('text/plain') || '';
      if (!core.findMatches(pasted, rules, true).length ||
          !Number.isInteger(field.selectionStart)) return;
      const start = field.selectionStart;
      const prefix = field.value.slice(0, start);
      const suffix = field.value.slice(field.selectionEnd);
      const context = globalThis.TicketHelperMacroContext?.();
      const revision = rulesRevision;
      const inspectPaste = () => {
        if (!enabled || rulesRevision !== revision ||
            !focusedTicketEditor(field, context?.ticketId, context?.ownerEpoch)) return false;
        const after = field.value;
        if (!after.startsWith(prefix) || !after.endsWith(suffix)) return false;
        const inserted = after.slice(prefix.length, after.length - suffix.length);
        if (!core.findMatches(inserted, rules, true).length) return false;
        void processPlainSpan(field, inserted, prefix.length);
        return true;
      };
      setTimeout(() => { if (!inspectPaste()) requestAnimationFrame(inspectPaste); }, 0);
      return;
    }
    const editor = event.target instanceof Element ?
      event.target.closest('[contenteditable="true"], [contenteditable=""]') : null;
    const pastedText = event.clipboardData?.getData('text/plain') || '';
    if (!editor || !core.findMatches(pastedText, rules, true).length || !ticketId() ||
        !globalThis.TicketHelperMacroContext?.()?.ready) return;
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const selected = selection.getRangeAt(0);
    const start = selectionTextOffset(editor, selected.startContainer, selected.startOffset);
    const end = selectionTextOffset(editor, selected.endContainer, selected.endOffset);
    if (start === null || end === null) return;
    const before = editor.textContent || '';
    const prefix = before.slice(0, start);
    const suffix = before.slice(end);
    const context = globalThis.TicketHelperMacroContext?.();
    const ownerTicketId = context?.ticketId;
    const ownerEpoch = context?.ownerEpoch;
    const revision = rulesRevision;
    const inspectPaste = () => {
      if (!enabled || revision !== rulesRevision ||
          !focusedTicketEditor(editor, ownerTicketId, ownerEpoch)) return false;
      const after = editor.textContent || '';
      if (!after.startsWith(prefix) || !after.endsWith(suffix)) return false;
      const inserted = after.slice(prefix.length, after.length - suffix.length);
      if (!core.findMatches(inserted, rules, true).length) return false;
      void processTextSpan(editor, inserted, prefix.length);
      return true;
    };
    // Let the host editor perform its real paste first; inspect only the newly
    // inserted range once its document model has updated.
    setTimeout(() => { if (!inspectPaste()) requestAnimationFrame(inspectPaste); }, 0);
  }, true);

  function inspect(node, prepare = true) {
    if (!(node instanceof Element)) return;
    const editorSelector = '[data-test-id="composer-editor"] [contenteditable="true"]';
    const editors = node.matches(editorSelector) ? [node] :
      node.querySelectorAll(editorSelector);
    if (prepare) for (const editor of editors) void visuals?.prepareEditor(editor);
    const composer = node.closest('[data-test-id="dynamic-resizable-reply-wrapper"]');
    if (prepare && composer && !editors.length) {
      const editor = composer.querySelector(editorSelector);
      if (editor) void visuals?.prepareEditor(editor);
    }
    const selector = '.prokeys-snippet-text, .th-macro-inserted';
    const snippets = node.matches(selector) ? [node] : node.querySelectorAll(selector);
    for (const snippet of snippets) {
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      void processSnippet(snippet);
    }
  }

  function updateObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (!enabled) { visuals?.clear(); return; }
    observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) inspect(node);
      }
      visuals?.refresh(rules);
    });
    observer.observe(document, { childList: true, subtree: true });
    for (const editor of document.querySelectorAll(
      '[data-test-id="composer-editor"] [contenteditable="true"]'))
      void visuals?.prepareEditor(editor);
  }

  // ProKeys fires a synthetic input event on its inserted span. Capture it
  // before HubSpot's editor can normalize or replace that span.
  document.addEventListener('input', event => {
    if (enabled && plainField(event.target) && typeof event.data === 'string' &&
        core.findMatches(event.data, rules, true).length &&
        Number.isInteger(event.target.selectionStart)) {
      const start = event.target.selectionStart - event.data.length;
      if (start >= 0) void processPlainSpan(event.target, event.data, start);
    }
    if (enabled && event.target instanceof Element) inspect(event.target, false);
    if (enabled) visuals?.refresh(rules);
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
      visuals?.refresh(rules);
    }
    if (changes.enabled || changes[core.STORAGE_KEY]) updateObserver();
  });
})();
