(() => {
  'use strict';
  if (globalThis.TicketHelperMacroAutofillVisuals) return;
  const core = globalThis.TicketHelperMacroAutofillCore;
  const HIGHLIGHT = 'ticket-helper-macro-pending';
  const prepared = new WeakMap();
  const preparing = new WeakSet();
  let pending = null;
  let frame = 0;

  function routeTicketId() {
    return location.hostname === 'app.hubspot.com'
      ? location.pathname.match(/\/ticket\/(\d+)(?:\/|$)/)?.[1] || null : null;
  }

  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    globalThis.CSS?.highlights?.delete(HIGHLIGHT);
    if (!pending) return;
    pending.observer.disconnect();
    pending.host.remove();
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('selectionchange', schedule);
    pending = null;
  }

  function caretRectForRange(range) {
    if (!range?.startContainer?.isConnected) return null;
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
    const client = [...range.getClientRects()].find(part => part.width || part.height);
    if (client) return client;
    const node = range.startContainer;
    if (node?.nodeType !== Node.TEXT_NODE || !node.textContent?.length) return null;
    const offset = range.startOffset;
    const before = offset > 0;
    if (!before && offset >= node.textContent.length) return null;
    const neighbor = range.cloneRange();
    neighbor.setStart(node, before ? offset - 1 : offset);
    neighbor.setEnd(node, before ? offset : offset + 1);
    const nearby = neighbor.getBoundingClientRect();
    if (!nearby.width && !nearby.height) return null;
    const x = before ? nearby.right : nearby.left;
    return { left: x, right: x, top: nearby.top, bottom: nearby.bottom,
      width: 0, height: nearby.height };
  }

  function currentCaretRange(editor) {
    const selection = document.getSelection?.();
    if (!selection?.rangeCount || !selection.focusNode ||
        !editor.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    return range;
  }

  function lastTextCaretRect(editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let last = null;
    let node;
    while ((node = walker.nextNode())) if (node.textContent) last = node;
    if (!last) return null;
    const range = document.createRange();
    range.setStart(last, last.textContent.length);
    range.collapse(true);
    return caretRectForRange(range);
  }

  function place() {
    if (!pending) return;
    const current = currentCaretRange(pending.editor);
    if (current) pending.caretRange = current;
    const rect = caretRectForRange(pending.caretRange) || pending.caretRect ||
      lastTextCaretRect(pending.editor) || pending.editor.getBoundingClientRect();
    pending.caretRect = rect;
    const box = pending.label.getBoundingClientRect();
    const pad = 6;
    const positions = [
      [rect.right + pad, rect.top - box.height - pad],
      [rect.right + pad, rect.bottom + pad],
      [rect.left - box.width - pad, rect.bottom + pad],
      [rect.left - box.width - pad, rect.top - box.height - pad]
    ];
    const chosen = positions.find(([x, y]) => x >= pad && y >= pad &&
      x + box.width <= innerWidth - pad && y + box.height <= innerHeight - pad) || positions[0];
    pending.label.style.left = `${Math.max(pad, Math.min(chosen[0], innerWidth - box.width - pad))}px`;
    pending.label.style.top = `${Math.max(pad, Math.min(chosen[1], innerHeight - box.height - pad))}px`;
  }

  function textPoint(root, offset, preferNext = false) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let position = 0;
    let boundary = null;
    while ((node = walker.nextNode())) {
      const end = position + node.textContent.length;
      if (offset < end || (offset === end && !preferNext))
        return { node, offset: offset - position };
      if (offset === end) boundary = { node, offset: node.textContent.length };
      position = end;
    }
    return offset === position ? boundary : null;
  }

  function update() {
    frame = 0;
    if (!pending) return;
    const { editor, ticketId, rules } = pending;
    if (!editor.isConnected || routeTicketId() !== ticketId) { clear(); return; }
    const matches = core.findMatches(editor.textContent || '', rules, true);
    if (!matches.length) { clear(); return; }
    const ranges = [];
    for (const match of matches) {
      const from = textPoint(editor, match.start, true);
      const to = textPoint(editor, match.end);
      if (!from || !to) continue;
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      ranges.push(range);
    }
    if (typeof Highlight === 'function' && globalThis.CSS?.highlights) {
      CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    }
    pending.label.textContent = `${matches.length} Pendentes`;
    place();
  }

  function schedule() {
    if (pending && !frame) frame = requestAnimationFrame(update);
  }

  function track(editor, ticketId, rules) {
    if (!core || !editor?.isConnected || !ticketId) return;
    if (pending && pending.editor !== editor) clear();
    if (pending) {
      pending.rules = rules;
      schedule();
      return;
    }
    const host = document.createElement('div');
    host.id = 'ticket-helper-macro-pending';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483646; pointer-events: none; }
      .label { position: fixed; padding: 4px 8px; border: 1px solid #b95a60;
        border-radius: 7px; background: #252a33; color: #ffaaa9;
        box-shadow: 0 6px 18px #0006; white-space: nowrap;
        font: 13px/1.35 'Segoe UI', system-ui, sans-serif; }
    </style><div class="label" role="status"></div>`;
    document.documentElement.appendChild(host);
    const observer = new MutationObserver(schedule);
    observer.observe(editor, { childList: true, characterData: true, subtree: true });
    pending = { editor, ticketId, rules, host, label: shadow.querySelector('.label'), observer,
      caretRange: null, caretRect: null };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('selectionchange', schedule);
    update();
  }

  function refresh(rules) {
    if (!pending) return;
    pending.rules = rules;
    schedule();
  }

  function waitForCheckbox() {
    const selector = '[data-test-id="always-show-email-details-toggle"] input[type="checkbox"]';
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const checkbox = document.querySelector(selector);
        if (!checkbox) return;
        observer.disconnect();
        clearTimeout(timeout);
        resolve(checkbox);
      });
      observer.observe(document, { childList: true, subtree: true });
      const timeout = setTimeout(() => { observer.disconnect(); resolve(null); }, 600);
    });
  }

  async function prepareEditor(editor) {
    if (!editor?.isConnected || !routeTicketId()) return;
    const composer = editor.closest('[data-test-id="dynamic-resizable-reply-wrapper"]');
    const ticketId = routeTicketId();
    if (!composer || prepared.get(composer) === ticketId || preparing.has(composer)) return;
    const settings = composer.querySelector('[data-test-id="toolbar-settings"] button[aria-label="Settings"]');
    if (!settings || settings.getAttribute('aria-disabled') === 'true') return;
    preparing.add(composer);
    const hadFocus = document.activeElement === editor;
    const selected = hadFocus && document.getSelection()?.rangeCount
      ? document.getSelection().getRangeAt(0).cloneRange() : null;
    let opened = false;
    try {
      let checkbox = document.querySelector(
        '[data-test-id="always-show-email-details-toggle"] input[type="checkbox"]');
      if (!checkbox) {
        settings.click();
        opened = true;
        checkbox = await waitForCheckbox();
      }
      if (!checkbox || !editor.isConnected || !composer.isConnected ||
          routeTicketId() !== ticketId) return;
      if (!checkbox.checked) checkbox.click();
      if (checkbox.checked) prepared.set(composer, ticketId);
    } finally {
      preparing.delete(composer);
      if (opened && settings.isConnected &&
          document.querySelector('[data-test-id="always-show-email-details-toggle"]'))
        settings.click();
      if (hadFocus && editor.isConnected &&
          (!document.activeElement || document.activeElement === document.body ||
            composer.contains(document.activeElement))) {
        editor.focus();
        if (selected?.startContainer.isConnected) {
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(selected);
        }
      }
    }
  }

  globalThis.TicketHelperMacroAutofillVisuals = { track, refresh, clear, prepareEditor };
})();
