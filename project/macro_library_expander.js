(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroCore;
  const html = globalThis.TicketHelperMacroHTML;
  if (!core || !html || globalThis.__ticketHelperMacroExpanderLoaded) return;
  globalThis.__ticketHelperMacroExpanderLoaded = true;
  let enabled = false;
  let shortcut = 'Shift+Space';
  let index = new Map();
  let prepared = new Map();
  let revision = 0;

  function message(action, extra = {}) {
    return chrome.runtime.sendMessage({ action, ...extra }).catch(() => null);
  }
  async function refresh() {
    const requestRevision = ++revision;
    const response = await message('TH_MACRO_GET_INDEX');
    if (requestRevision !== revision || !Array.isArray(response?.index)) return;
    index = new Map(response.index.filter(item => item.id === item.activeId)
      .map(item => [item.abbreviation.toLocaleLowerCase(), item]));
    prepared = new Map();
  }
  function editable(target) {
    if (!(target instanceof Element)) return null;
    const field = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
    if (!field || field.disabled || field.readOnly ||
        field.closest('#ticket-helper-popup, .macro-library-name') ||
        field.getAttribute('contenteditable') === 'false') return null;
    if (field instanceof HTMLInputElement && !['text','search','email','url','tel',''].includes(field.type)) return null;
    return field;
  }
  function tokenInInput(field) {
    const at = field.type === 'email' ? field.value.length : field.selectionStart;
    if (!Number.isInteger(at) || (field.type !== 'email' && at !== field.selectionEnd)) return null;
    const before = field.value.slice(0, at);
    const match = /(?:^|[ \r\n])([^ \r\n]+)$/.exec(before);
    if (!match) return null;
    return { value: match[1], start: at - match[1].length, end: at,
      snapshot: field.value };
  }
  function tokenInRich(field) {
    const selection = document.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return null;
    const caret = selection.getRangeAt(0);
    if (!field.contains(caret.startContainer)) return null;
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    let current = caret.startContainer.nodeType === Node.TEXT_NODE ?
      caret.startContainer : null;
    let offset = current ? caret.startOffset : 0;
    if (!current) {
      for (const candidate of nodes) {
        let comparison;
        try { comparison = caret.comparePoint(candidate, candidate.textContent.length); }
        catch { continue; }
        if (comparison <= 0) { current = candidate; offset = candidate.textContent.length; }
        else break;
      }
    }
    if (!current) return null;
    let i = nodes.indexOf(current);
    const block = element => element.parentElement?.closest('p,div,li,blockquote,pre') || field;
    const initialBlock = block(current);
    let value = '';
    let startNode = current;
    let startOffset = offset;
    while (i >= 0) {
      const candidate = nodes[i];
      if (block(candidate) !== initialBlock) break;
      const end = candidate === current ? offset : candidate.textContent.length;
      const segment = candidate.textContent.slice(0, end);
      const delimiter = Math.max(segment.lastIndexOf(' '), segment.lastIndexOf('\n'),
        segment.lastIndexOf('\r'));
      value = segment.slice(delimiter + 1) + value;
      startNode = candidate; startOffset = delimiter + 1;
      if (delimiter >= 0) break;
      const previous = nodes[i - 1];
      if (previous) {
        const between = document.createRange();
        between.setStart(previous, previous.textContent.length);
        between.setEnd(candidate, 0);
        if (between.cloneContents().querySelector?.('br')) break;
      }
      i--;
    }
    if (!value) return null;
    const replaceRange = document.createRange();
    replaceRange.setStart(startNode, startOffset);
    replaceRange.setEnd(caret.startContainer, caret.startOffset);
    return { value, range: replaceRange,
      caretNode: caret.startContainer, caretOffset: caret.startOffset };
  }
  function inlineRich(markup) {
    // The caller has already sanitized markup. Avoid a second full DOM walk on expansion.
    const box = document.createElement('div'); box.innerHTML = markup;
    const out = document.createElement('span'); out.className = 'th-macro-inserted';
    let blocks = 0;
    for (const node of [...box.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && ['P','DIV'].includes(node.tagName)) {
        if (blocks++) out.appendChild(document.createElement('br'));
        const holder = node.getAttribute('style') ? document.createElement('span') : out;
        if (holder !== out) holder.setAttribute('style', node.getAttribute('style'));
        const children = [...node.childNodes];
        const emptyBreaks = !node.textContent && children.every(child => child.nodeName === 'BR');
        children.forEach((child, index) => {
          if (!(emptyBreaks && index === 0)) holder.appendChild(child.cloneNode(true));
        });
        if (holder !== out) out.appendChild(holder);
      } else if (node.nodeType === Node.ELEMENT_NODE && ['OL','UL'].includes(node.tagName)) {
        let itemNumber = 0;
        for (const item of node.children) {
          if (item.tagName !== 'LI') continue;
          if (blocks++) out.appendChild(document.createElement('br'));
          out.appendChild(document.createTextNode(node.tagName === 'OL' ?
            `${++itemNumber}. ` : '• '));
          for (const child of [...item.childNodes]) out.appendChild(child.cloneNode(true));
        }
      } else out.appendChild(node.cloneNode(true));
    }
    return out.outerHTML;
  }
  function materialize(markup, images) {
    const box = document.createElement('div'); box.innerHTML = html.sanitize(markup);
    const map = new Map(images.map(asset => [asset.id, asset.data]));
    for (const img of box.querySelectorAll('img[data-th-image-id]')) {
      const data = map.get(img.dataset.thImageId);
      if (!data) return null;
      img.src = data;
    }
    return box.innerHTML;
  }
  function sameRichCaret(field, token) {
    const selection = document.getSelection();
    if (!field.isConnected || document.activeElement !== field ||
        !selection?.isCollapsed || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return range.startContainer === token.caretNode && range.startOffset === token.caretOffset;
  }
  function insertPlain(field, token, text) {
    if (!field.isConnected || document.activeElement !== field ||
        field.value !== token.snapshot ||
        (field.type !== 'email' && (field.selectionStart !== token.end ||
        field.selectionEnd !== token.end))) return false;
    const replacement = field instanceof HTMLInputElement ?
      text.replace(/\r?\n/g, ' ') : text;
    const result = token.snapshot.slice(0, token.start) + replacement +
      token.snapshot.slice(token.end);
    if (field.maxLength >= 0 && result.length > field.maxLength) return false;
    const descriptor = Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
    descriptor.set.call(field, result);
    const pos = token.start + replacement.length;
    if (field.type !== 'email') field.setSelectionRange(pos, pos);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
    return true;
  }
  function insertRich(field, token, richMarkup) {
    if (!sameRichCaret(field, token)) return false;
    const selection = document.getSelection();
    selection.removeAllRanges(); selection.addRange(token.range);
    const done = document.execCommand('insertHTML', false, richMarkup);
    if (!done) return false;
    const snippets = field.querySelectorAll('.th-macro-inserted');
    const inserted = snippets[snippets.length - 1];
    if (inserted) inserted.dispatchEvent(new Event('input', { bubbles: true }));
    else field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }
  async function expand(field, token, macro, requestRevision) {
    const hasImages = macro.html.includes('data-th-image-id=');
    let result = !hasImages ? prepared.get(macro.id) : null;
    if (!result) {
      const response = hasImages ?
        await message('TH_MACRO_GET_RECORD', { id: macro.id }) :
        { row: macro, images: [] };
      if (requestRevision !== revision || !response?.row) return;
      const markup = materialize(response.row.html, response.images || []);
      if (markup === null) return;
      result = { markup, rich: null, plain: null };
      if (!hasImages) prepared.set(macro.id, result);
    }
    if (requestRevision !== revision) return;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (result.plain === null) result.plain = html.plain(result.markup);
      insertPlain(field, token, result.plain);
    } else {
      if (result.rich === null) result.rich = inlineRich(result.markup);
      insertRich(field, token, result.rich);
    }
  }
  document.addEventListener('keydown', event => {
    if (!enabled || !shortcut || core.eventShortcut(event) !== shortcut) return;
    const field = editable(event.target);
    if (!field) return;
    const token = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ?
      tokenInInput(field) : tokenInRich(field);
    const macro = token && index.get(token.value.toLocaleLowerCase());
    if (!macro) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void expand(field, token, macro, revision);
  }, true);
  chrome.storage.local.get(['enabled','macroExpandShortcut']).then(state => {
    enabled = state.enabled === true;
    shortcut = Object.prototype.hasOwnProperty.call(state, 'macroExpandShortcut') ?
      core.normalizeShortcut(state.macroExpandShortcut) : 'Shift+Space';
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) enabled = changes.enabled.newValue === true;
    if (changes.macroExpandShortcut)
      shortcut = core.normalizeShortcut(changes.macroExpandShortcut.newValue);
    if (changes.macroLibraryRevision) void refresh();
  });
  void refresh();
})();
