(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroCore;
  const html = globalThis.TicketHelperMacroHTML;
  const expander = globalThis.TicketHelperMacroExpander;
  if (!core || !html || !expander || globalThis.__ticketHelperMacroPickerLoaded) return;
  globalThis.__ticketHelperMacroPickerLoaded = true;

  let enabled = false;
  let shortcut = 'Ctrl+Space';
  let current = null;
  const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  const searchable = rows => [...rows].sort((a, b) => b.id - a.id).map(row => ({ ...row,
    search: normalize(`${row.abbreviation} ${html.plain(row.html || '')}`) }));
  const send = (action, extra = {}) => chrome.runtime.sendMessage({ action, ...extra });
  async function loadIndex() {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await send('TH_MACRO_GET_INDEX');
        if (Array.isArray(response?.index)) return response.index;
        last = response?.error || response?.reason || 'Serviço de macros indisponível.';
      } catch (error) { last = error?.message || String(error); }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120));
    }
    throw new Error(last);
  }

  function preserveTextStyles(field, range, holder) {
    const original = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    const selected = [];
    let node;
    while ((node = original.nextNode())) {
      if (!node.textContent) continue;
      try { if (range.intersectsNode(node)) selected.push(node); } catch { /* Detached node. */ }
    }
    const cloned = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
    const copies = [];
    while ((node = cloned.nextNode())) if (node.textContent) copies.push(node);
    if (selected.length !== copies.length) return;
    for (let i = 0; i < copies.length; i++) {
      const style = getComputedStyle(selected[i].parentElement);
      const properties = ['color','background-color','font-size','font-family',
        'font-weight','font-style','text-decoration','line-height'];
      const values = properties.flatMap(name => {
        const value = style.getPropertyValue(name).trim();
        if (!value || value === 'normal' || value === 'none' || value === 'transparent' ||
            value === 'rgba(0, 0, 0, 0)') return [];
        return [`${name}: ${value}`];
      });
      if (!values.length) continue;
      const wrapper = document.createElement('span');
      wrapper.setAttribute('style', values.join('; '));
      copies[i].replaceWith(wrapper); wrapper.appendChild(copies[i]);
    }
  }

  function selectedContent(field) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      let start = field.value.length;
      let end = start;
      try {
        if (Number.isInteger(field.selectionStart)) {
          start = field.selectionStart; end = field.selectionEnd;
        }
      } catch { /* Some input types do not expose a selection. */ }
      const selected = field.value.slice(start, end) ||
        (field.type === 'email' ? document.getSelection()?.toString() || '' : '');
      return { selected: Boolean(selected), html: selected ? html.fromPlain(selected) : '',
        images: [], bookmark: { field, snapshot: field.value, start, end }, at: end };
    }
    const selection = document.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return null;
    const fragment = range.cloneContents();
    const holder = document.createElement('div'); holder.appendChild(fragment);
    // ProseMirror adds a source-less separator image and resize handles beside
    // a real image. They are editor UI, not part of the selected message.
    holder.querySelectorAll('img.ProseMirror-separator').forEach(node => node.remove());
    holder.querySelectorAll('.remirror-resizable-view').forEach(wrapper => {
      const image = wrapper.querySelector('img[src]');
      if (image) wrapper.replaceWith(image.cloneNode(true));
    });
    preserveTextStyles(field, range, holder);
    const images = [];
    let imageError = '';
    for (const img of holder.querySelectorAll('img')) {
      const existing = img.getAttribute('data-th-image-id');
      if (existing && /^[a-f0-9-]+$/i.test(existing)) {
        img.src = `th-image:${existing}`;
        continue;
      }
      const src = img.getAttribute('src');
      if (!src) { imageError = 'Uma imagem selecionada não pode ser salva.'; break; }
      const id = crypto.randomUUID();
      let url;
      try { url = new URL(src, document.baseURI).href; }
      catch { imageError = 'Uma imagem selecionada não pode ser salva.'; break; }
      images.push({ id, url });
      img.dataset.thImageId = id; img.src = `th-image:${id}`;
    }
    const markup = html.sanitize(holder.innerHTML);
    const selected = !range.collapsed && Boolean(html.plain(markup) || images.length || imageError ||
      holder.querySelector('img[data-th-image-id]'));
    const at = range.cloneRange();
    at.setStart(selection.focusNode, selection.focusOffset); at.collapse(true);
    const rect = at.getBoundingClientRect();
    const selectionRect = range.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const sourceNode = at.startContainer.nodeType === Node.TEXT_NODE ? at.startContainer : null;
    const bookmark = { field, snapshot: field.innerHTML, range: at,
      leaf: sourceNode?.textContent ?? '', offset: sourceNode ? at.startOffset : -1 };
    if (field.matches('[data-slate-editor="true"]')) {
      const detail = { leaf: bookmark.leaf, offset: bookmark.offset };
      field.dispatchEvent(new CustomEvent('tickethelper:discord-slate-picker-capture',
        { bubbles: true, detail }));
      bookmark.leaf = detail.leaf; bookmark.offset = detail.offset;
    }
    return { selected, html: markup, images, imageError, bookmark,
      selectedRange: selected ? range.cloneRange() : null,
      rect: rect.width || rect.height ? rect :
        selectionRect.width || selectionRect.height ? selectionRect :
          { left: fieldRect.left + 8, right: fieldRect.left + 8,
            top: fieldRect.top + 8, bottom: fieldRect.top + 26 } };
  }

  function inputCaretRect(field, at) {
    const bounds = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    const mirror = document.createElement('div');
    mirror.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
    for (const property of ['font','letterSpacing','lineHeight','padding','border','boxSizing',
      'whiteSpace','overflowWrap','wordBreak','textTransform','textIndent'])
      mirror.style[property] = style[property];
    mirror.style.width = `${bounds.width}px`;
    mirror.style.whiteSpace = field instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
    mirror.style.overflow = 'hidden';
    mirror.textContent = field.value.slice(0, at);
    const marker = document.createElement('span'); marker.textContent = '\u200b';
    mirror.appendChild(marker); document.documentElement.appendChild(mirror);
    const markerBounds = marker.getBoundingClientRect();
    const mirrorBounds = mirror.getBoundingClientRect();
    const x = bounds.left + markerBounds.left - mirrorBounds.left - field.scrollLeft;
    const y = bounds.top + markerBounds.top - mirrorBounds.top - field.scrollTop;
    mirror.remove();
    return { left: x, right: x, top: y, bottom: y + (parseFloat(style.lineHeight) || 18) };
  }

  async function prepareImages(capture) {
    const images = [];
    for (const asset of capture.images) {
      if (/^https?:\/\//i.test(asset.url) || /^data:image\//i.test(asset.url)) {
        images.push(/^data:/i.test(asset.url) ? { id: asset.id, data: asset.url } : asset);
        continue;
      }
      if (!/^blob:/i.test(asset.url)) throw new Error('Uma imagem selecionada não pode ser salva.');
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('Uma imagem selecionada não pode ser salva.');
      const blob = await response.blob();
      if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type))
        throw new Error('Formato de imagem selecionada não suportado.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      images.push({ id: asset.id, data });
    }
    return images;
  }

  function restoreSelection(capture) {
    const bookmark = capture.bookmark;
    if (!bookmark.field.isConnected) return;
    bookmark.field.focus();
    const range = capture.selectedRange?.startContainer.isConnected ?
      capture.selectedRange : bookmark.range;
    if (range?.startContainer.isConnected) {
      const selection = document.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    } else if (Number.isInteger(bookmark.start) && bookmark.field.type !== 'email') {
      bookmark.field.setSelectionRange(bookmark.start, bookmark.end);
    }
  }

  function close(restore = true) {
    const picker = current;
    if (!picker) return;
    current = null;
    if (picker.scrollFrame) cancelAnimationFrame(picker.scrollFrame);
    picker.host.remove();
    if (restore) restoreSelection(picker.capture);
  }

  function place(picker) {
    const { popup, capture } = picker;
    const live = capture.bookmark.range?.startContainer.isConnected ?
      capture.bookmark.range.getBoundingClientRect() : null;
    const anchor = live?.height || live?.width ? live :
      capture.rect || inputCaretRect(capture.bookmark.field, capture.at);
    const rect = popup.getBoundingClientRect();
    const pad = 6;
    const positions = [
      [anchor.right + pad, anchor.top - rect.height - pad],
      [anchor.right + pad, anchor.bottom + pad],
      [anchor.left - rect.width - pad, anchor.bottom + pad],
      [anchor.left - rect.width - pad, anchor.top - rect.height - pad]
    ];
    const chosen = positions.find(([x,y]) => x >= pad && y >= pad &&
      x + rect.width <= innerWidth - pad && y + rect.height <= innerHeight - pad) || positions[0];
    popup.style.left = `${Math.max(pad, Math.min(chosen[0], innerWidth - rect.width - pad))}px`;
    popup.style.top = `${Math.max(pad, Math.min(chosen[1], innerHeight - rect.height - pad))}px`;
  }

  function updateWidth(picker) {
    const context = document.createElement('canvas').getContext('2d');
    context.font = '13px "Segoe UI", system-ui, sans-serif';
    const words = ['Pesquisar macro',
      picker.input.value, ...picker.rows.map(row => row.abbreviation)];
    const longest = Math.max(...words.map(word => context.measureText(word).width));
    picker.popup.style.width = `${Math.min(Math.ceil(longest) + 14, innerWidth - 12)}px`;
  }

  function updateListFade(picker, recalculate = false) {
    const list = picker.list;
    if (recalculate) picker.maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const next = {
      'has-overflow': picker.maxScroll > 1,
      'at-top': picker.maxScroll <= 1 || list.scrollTop <= 1,
      'at-bottom': picker.maxScroll <= 1 || list.scrollTop >= picker.maxScroll - 1
    };
    for (const [name, value] of Object.entries(next)) {
      if (picker.fade[name] === value) continue;
      picker.fade[name] = value;
      picker.viewport.classList.toggle(name, value);
    }
  }

  function visibleRows(picker) {
    const query = normalize(picker.input.value).trim();
    const rows = query ? picker.rows.filter(row => row.search.includes(query)) : picker.rows;
    if (picker.mode === 'create' && query) {
      const exact = rows.findIndex(row => row.abbreviation.toLocaleLowerCase() ===
        picker.input.value.toLocaleLowerCase());
      if (exact > 0) rows.unshift(...rows.splice(exact, 1));
    }
    return rows;
  }

  function render(picker) {
    picker.visible = visibleRows(picker);
    const exact = picker.mode === 'create' && picker.visible.find(row =>
      row.abbreviation.toLocaleLowerCase() === picker.input.value.toLocaleLowerCase());
    if (exact) picker.activeId = exact.id;
    else if (!picker.visible.some(row => row.id === picker.activeId))
      picker.activeId = picker.mode === 'create' ? 0 : picker.visible[0]?.id || 0;
    picker.input.classList.toggle('is-selected', picker.mode === 'create' && picker.activeId === 0);
    const fragment = document.createDocumentFragment();
    for (const row of picker.visible) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'row';
      button.textContent = row.abbreviation;
      button.dataset.id = String(row.id);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(picker.activeId === row.id));
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => { picker.activeId = row.id; void choose(picker); });
      fragment.appendChild(button);
    }
    picker.list.replaceChildren(fragment);
    updateListFade(picker, true);
    updateWidth(picker); place(picker);
  }

  function move(picker, direction) {
    const ids = picker.mode === 'create' ? [0, ...picker.visible.map(row => row.id)] :
      picker.visible.map(row => row.id);
    if (!ids.length) return;
    const next = (ids.indexOf(picker.activeId) + direction + ids.length) % ids.length;
    picker.activeId = ids[next];
    picker.input.classList.toggle('is-selected', picker.mode === 'create' && picker.activeId === 0);
    for (const row of picker.list.children)
      row.setAttribute('aria-selected', String(Number(row.dataset.id) === picker.activeId));
    picker.list.querySelector(`[data-id="${picker.activeId}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  async function choose(picker) {
    if (current !== picker || picker.busy) return;
    picker.busy = true; picker.error.textContent = '';
    try {
      if (picker.mode === 'create') {
        if (picker.capture.imageError) throw new Error(picker.capture.imageError);
        const target = picker.visible.find(row => row.id === picker.activeId);
        const abbreviation = target?.abbreviation || picker.input.value;
        if (!core.validAbbreviation(abbreviation))
          throw new Error('Digite uma abreviação sem espaços (até 50 caracteres).');
        const images = await prepareImages(picker.capture);
        const result = await send('TH_MACRO_SAVE_CAPTURE', {
          id: target?.id || null, abbreviation, html: picker.capture.html, images
        });
        if (!result?.ok) throw new Error(result?.error || 'Não foi possível salvar a macro.');
        close();
        document.dispatchEvent(new Event('tickethelper:macro-picker-saved'));
      } else {
        const row = picker.visible.find(item => item.id === picker.activeId);
        if (!row) { picker.busy = false; return; }
        const inserted = await expander.insertFromPicker(picker.capture.bookmark, row.id);
        if (!inserted) throw new Error('O campo mudou antes da inserção. Tente novamente.');
        close(false);
      }
    } catch (error) {
      if (current === picker) {
        picker.error.textContent = error?.message || 'Não foi possível concluir a macro.';
        picker.input.focus();
      }
      else console.warn('TicketHelper macro picker', error);
    } finally { picker.busy = false; if (current === picker) place(picker); }
  }

  function makePopup(capture) {
    const host = document.createElement('div');
    host.id = 'ticket-helper-macro-picker';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483647; pointer-events: none; }
      .popup { position: fixed; box-sizing: border-box; max-width: calc(100vw - 12px);
        overflow: hidden; border: 1px solid #3b414b; border-radius: 8px;
        background: #252a33; color: #f1f5f9; box-shadow: 0 9px 24px #0008;
        font: 13px/1.35 'Segoe UI', system-ui, sans-serif; pointer-events: auto; }
      input { box-sizing: border-box; display: block; width: 100%; height: 26px; padding: 3px 6px;
        border: 0; border-bottom: 1px solid #3b414b; border-radius: 0;
        outline: none; background: #1b2029; color: #f1f5f9; font: inherit; }
      input::placeholder { color: #8290a0; opacity: 1; }
      input.is-selected { background: #365269; }
      .list-viewport { position: relative; }
      .list-viewport.has-overflow:not(.at-top)::before,
      .list-viewport.has-overflow:not(.at-bottom)::after {
        content: ''; position: absolute; z-index: 1; left: 0; right: 0;
        height: 6px; pointer-events: none;
      }
      .list-viewport.has-overflow:not(.at-top)::before {
        top: 0; background: linear-gradient(#252a33, transparent);
      }
      .list-viewport.has-overflow:not(.at-bottom)::after {
        bottom: 0; background: linear-gradient(transparent, #252a33);
      }
      .list { height: 138.6px; overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: none; }
      .list::-webkit-scrollbar { display: none; width: 0; height: 0; }
      .row { box-sizing: border-box; display: block; width: 100%; height: 18px;
        padding: 0 6px; border: 0; background: transparent; color: inherit;
        text-align: left; font: inherit; line-height: 18px; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row:hover, .row[aria-selected="true"] { background: #365269; }
      .error { color: #ffaaa9; padding: 4px 9px; font-size: 12px; }
      .error:empty { display: none; }
    </style><div class="popup" role="dialog" aria-label="${capture.selected ? 'Criar macro' : 'Pesquisar macro'}">
      <input type="text" maxlength="50" spellcheck="false" autocomplete="off"
        placeholder="${capture.selected ? 'Criar macro' : 'Pesquisar macro'}" aria-label="${capture.selected ? 'Criar macro' : 'Pesquisar macro'}">
      <div class="list-viewport"><div class="list" role="listbox"></div></div>
      <div class="error" role="alert"></div></div>`;
    document.documentElement.appendChild(host);
    const popup = root.querySelector('.popup');
    const input = root.querySelector('input');
    const list = root.querySelector('.list');
    const viewport = root.querySelector('.list-viewport');
    const error = root.querySelector('.error');
    const picker = { host, popup, input, list, viewport, error, capture,
      mode: capture.selected ? 'create' : 'search', rows: [], visible: [], activeId: 0,
      busy: false, maxScroll: 0, fade: {}, scrollFrame: 0 };
    list.addEventListener('scroll', () => {
      if (picker.scrollFrame) return;
      picker.scrollFrame = requestAnimationFrame(() => {
        picker.scrollFrame = 0;
        if (current === picker) updateListFade(picker);
      });
    }, { passive: true });
    input.addEventListener('input', () => {
      if (picker.mode === 'create') input.value = input.value.replace(/\s/gu, '');
      picker.activeId = picker.mode === 'create' ? 0 : null;
      render(picker);
    });
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); move(picker, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') { event.preventDefault(); void choose(picker); }
      else if (picker.mode === 'create' && event.key === ' ') event.preventDefault();
    });
    input.addEventListener('keyup', event => event.stopPropagation());
    render(picker); input.focus();
    return picker;
  }

  document.addEventListener('keydown', event => {
    if (!enabled || !shortcut || core.eventShortcut(event) !== shortcut) return;
    if (current) { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    const field = expander.editable(event.target);
    if (!field || field.closest('#ticket-helper-macro-picker')) return;
    const capture = selectedContent(field);
    if (!capture) return;
    event.preventDefault(); event.stopImmediatePropagation();
    current = makePopup(capture);
    if (capture.imageError) current.error.textContent = capture.imageError;
    const cached = expander.pickerIndex();
    if (cached.length) { current.rows = searchable(cached); render(current); }
    void loadIndex().then(index => {
      if (current?.capture !== capture) return;
      current.rows = searchable(index);
      render(current);
    }).catch(error => {
      if (current?.capture !== capture) return;
      if (!current.rows.length) current.error.textContent = error.message;
      else console.warn('TicketHelper macro index refresh', error);
    });
  }, true);
  document.addEventListener('pointerdown', event => {
    if (current && !event.composedPath().includes(current.host)) close(false);
  }, true);
  window.addEventListener('scroll', () => { if (current) place(current); }, { passive: true });
  window.addEventListener('resize', () => { if (current) place(current); });
  chrome.storage.local.get(['enabled','macroPickerShortcut']).then(state => {
    enabled = state.enabled === true;
    shortcut = Object.prototype.hasOwnProperty.call(state, 'macroPickerShortcut') ?
      core.normalizeShortcut(state.macroPickerShortcut) : 'Ctrl+Space';
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) { enabled = changes.enabled.newValue === true; if (!enabled) close(false); }
    if (changes.macroPickerShortcut)
      shortcut = core.normalizeShortcut(changes.macroPickerShortcut.newValue);
  });
})();
