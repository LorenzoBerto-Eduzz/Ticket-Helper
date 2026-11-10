(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroCore;
  const store = globalThis.TicketHelperMacroStore;
  const html = globalThis.TicketHelperMacroHTML;
  const list = document.getElementById('macro-library-list');
  if (!core || !store || !html || !list) return;
  const addButton = document.getElementById('macro-library-add');
  const importButton = document.getElementById('macro-library-import');
  const exportButton = document.getElementById('macro-library-export');
  const fileInput = document.getElementById('macro-library-file');
  const shortcutPlace = document.getElementById('sc-expand-macro');
  const pickerShortcutPlace = document.getElementById('sc-find-macro');
  let rows = [];
  const newestFirst = saved => [...saved].sort((a, b) => b.id - a.id);
  let openRow = null;
  let scrollAnchorVersion = 0;
  let shortcut = store.DEFAULT_SHORTCUT;
  let pickerShortcut = store.DEFAULT_PICKER_SHORTCUT;
  let capturing = '';
  let captureHint = 'Pressione o atalho';
  const imageUrls = new Set();
  const bodyObserver = new ResizeObserver(() => updateListHeight());
  let hasOverflow = false;
  let lastScroll = 0;
  let scrollQueued = false;
  list.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; updateListFadePosition(); });
  }, { passive: true });
  list.addEventListener('tickethelper:filter-changed', updateListHeight);

  function activeRows() { return core.activeIndex(rows.filter(row => row.id)); }
  function updateListFadePosition() {
    const viewport = list.parentElement;
    const top = list.scrollTop;
    viewport.classList.toggle('at-top', !hasOverflow || top <= 1);
    viewport.classList.toggle('at-bottom', !hasOverflow || top >= lastScroll - 1);
  }
  function updateListFade() {
    const viewport = list.parentElement;
    hasOverflow = list.classList.contains('is-scrollable') &&
      list.scrollHeight > list.clientHeight + 1;
    lastScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    viewport.classList.toggle('has-overflow', hasOverflow);
    updateListFadePosition();
  }
  function updateListHeight() {
    const visibleRows = rows.filter(row => row.element?.isConnected && !row.element.hidden);
    const first = visibleRows.slice(0, 8);
    list.classList.toggle('is-scrollable', visibleRows.length > 8);
    const base = first.reduce((height, row) =>
      height + row.element.querySelector('.macro-library-header').offsetHeight, 0) +
      Math.max(0, first.length - 1) * 2;
    const body = openRow?.element?.querySelector('.macro-library-body');
    const header = openRow?.element?.querySelector('.macro-library-header');
    const extra = body && !body.hidden && !openRow.element.hidden ? body.offsetHeight + 20 +
      (first.includes(openRow) ? 0 : Math.max(0, header.offsetHeight - 28)) : 0;
    list.style.setProperty('--macro-base-height', `${base}px`);
    list.style.setProperty('--macro-open-extra', `${extra}px`);
    updateListFade();
  }
  function sizeName(row) {
    const name = row.element.querySelector('.macro-library-name');
    const header = row.element.querySelector('.macro-library-header');
    const canvas = sizeName.canvas || (sizeName.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    context.font = getComputedStyle(name).font;
    const desired = Math.ceil(context.measureText(name.value || name.placeholder).width) + 16;
    name.style.width = `${Math.min(Math.max(28, desired), Math.max(28, header.clientWidth - 38))}px`;
    name.style.height = '28px';
    name.style.height = `${Math.max(28, name.scrollHeight)}px`;
    const height = `${Math.max(28, name.offsetHeight)}px`;
    header.style.minHeight = height;
    row.element.querySelector('.macro-library-toggle').style.minHeight = height;
    if (row === openRow) updateListHeight();
  }
  function notifyChange() {
    chrome.runtime.sendMessage({ action: 'TH_MACRO_LIBRARY_CHANGED' }).catch(() => {});
  }
  function updateWarnings() {
    const index = new Map(activeRows().map(row => [row.id, row.activeId]));
    for (const row of rows) {
      if (!row.element) continue;
      row.element.querySelector('.macro-library-header-text').textContent = row.abbreviation || 'Nova macro';
      const existing = row.element.querySelector('.macro-library-conflict');
      existing?.remove();
      const winner = index.get(row.id);
      if (winner && winner !== row.id) {
        const icon = document.createElement('span');
        icon.className = 'macro-library-conflict';
        icon.textContent = '⚠';
        icon.title = `Esta abreviação é usada pela macro #${winner}. Clique para abrir.`;
        icon.setAttribute('aria-label', icon.title);
        icon.addEventListener('click', event => {
          event.stopPropagation();
          const target = rows.find(item => item.id === winner);
          if (target) { toggleRow(target, true); target.element.scrollIntoView({ block: 'center' }); }
        });
        const toggle = row.element.querySelector('.macro-library-toggle');
        toggle.insertBefore(icon, toggle.querySelector('.macro-library-row-icon'));
      }
    }
    exportButton.disabled = !rows.some(row => row.id);
  }
  async function showImages(editor) {
    for (const img of editor.querySelectorAll('img[data-th-image-id]')) {
      const asset = await store.image(img.dataset.thImageId);
      if (!asset?.blob || !img.isConnected) continue;
      const url = URL.createObjectURL(asset.blob);
      imageUrls.add(url);
      img.src = url;
    }
  }
  function closeOthers(row) {
    if (openRow && openRow !== row) {
      bodyObserver.disconnect();
      openRow.element.classList.remove('is-open');
      openRow.element.querySelector('.macro-library-body').hidden = true;
      const oldName = openRow.element.querySelector('.macro-library-name');
      oldName.readOnly = true; oldName.tabIndex = -1;
      void persist(openRow);
    }
    openRow = row;
  }
  function keepHeaderVisible(row, previousTop) {
    const header = row.element.querySelector('.macro-library-header');
    list.scrollTop += header.getBoundingClientRect().top - previousTop;
    const listBounds = list.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    if (headerBounds.top < listBounds.top) list.scrollTop -= listBounds.top - headerBounds.top;
    else if (headerBounds.bottom > listBounds.bottom)
      list.scrollTop += headerBounds.bottom - listBounds.bottom;
    updateListFade();
  }
  function settleHeaderPosition(row, previousTop) {
    const version = ++scrollAnchorVersion;
    keepHeaderVisible(row, previousTop);
    requestAnimationFrame(() => {
      if (version === scrollAnchorVersion && row.element.isConnected)
        keepHeaderVisible(row, previousTop);
    });
  }
  function toggleRow(row, forceOpen = false) {
    const body = row.element.querySelector('.macro-library-body');
    const previousTop = row.element.querySelector('.macro-library-header').getBoundingClientRect().top;
    if (openRow === row && !body.hidden && !forceOpen) {
      bodyObserver.disconnect();
      body.hidden = true;
      row.element.classList.remove('is-open');
      const name = row.element.querySelector('.macro-library-name');
      name.readOnly = true; name.tabIndex = -1;
      openRow = null;
      updateListHeight();
      settleHeaderPosition(row, previousTop);
      void persist(row).then(() => store.pruneImages());
      return;
    }
    closeOthers(row);
    body.hidden = false;
    row.element.classList.add('is-open');
    const name = row.element.querySelector('.macro-library-name');
    name.readOnly = false; name.tabIndex = 0;
    sizeName(row);
    bodyObserver.observe(body);
    updateListHeight();
    settleHeaderPosition(row, previousTop);
    if (!row.imagesShown) { row.imagesShown = true; void showImages(row.element.querySelector('.macro-library-editor')); }
  }
  function persist(row) {
    row.dirty = true;
    if (row.pending) return row.pending;
    row.pending = (async () => {
      while (row.dirty) {
      row.dirty = false;
      const abbreviation = row.element.querySelector('.macro-library-name').value.trim();
      const editor = row.element.querySelector('.macro-library-editor');
      for (const img of editor.querySelectorAll('img:not([data-th-image-id])')) {
        const src = img.getAttribute('src') || '';
        let blob;
        if (src.startsWith('data:image/')) blob = dataToBlob(src);
        else if (/^https?:\/\//i.test(src)) {
          const response = await fetch(src);
          if (!response.ok) throw new Error('Não foi possível guardar uma imagem da macro.');
          blob = await response.blob();
        } else throw new Error('Imagem da macro inválida.');
        const id = await store.putImage(blob);
        img.dataset.thImageId = id;
        const url = URL.createObjectURL(blob); imageUrls.add(url); img.src = url;
      }
      const content = html.sanitize(editor.innerHTML);
      if (!core.validAbbreviation(abbreviation)) continue;
      if (!row.id && !html.plain(content).trim() && !/data-th-image-id/.test(content)) continue;
      if (row.id && row.abbreviation === abbreviation && row.html === content) continue;
      row.id = await store.save({ id: row.id, abbreviation, html: content });
      row.abbreviation = abbreviation;
      row.html = content;
      updateWarnings();
      notifyChange();
      }
    })().catch(error => { console.error('TicketHelper macro save', error); alert('Não foi possível salvar a macro.'); })
      .finally(() => { row.pending = null; if (row.dirty) void persist(row); });
    return row.pending;
  }
  function toggleEditorList(editor, ordered) {
    const selection = document.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return false;
    const topChild = node => {
      if (node === editor) return editor.childNodes[Math.min(range.startOffset, editor.childNodes.length - 1)] || null;
      while (node?.parentNode && node.parentNode !== editor) node = node.parentNode;
      return node?.parentNode === editor ? node : null;
    };
    const selected = range.collapsed ? [topChild(range.startContainer)].filter(Boolean) :
      [...editor.childNodes].filter(node => range.intersectsNode(node));
    if (!selected.length) return false;
    const tag = ordered ? 'OL' : 'UL';
    const existing = selected.length === 1 && selected[0].nodeType === Node.ELEMENT_NODE &&
      ['OL', 'UL'].includes(selected[0].tagName) ? selected[0] : null;
    let caretTarget;
    if (existing?.tagName === tag) {
      const fragment = document.createDocumentFragment();
      for (const item of [...existing.children]) {
        const paragraph = document.createElement('p');
        paragraph.innerHTML = item.innerHTML || '<br>';
        if (!caretTarget) caretTarget = paragraph;
        fragment.appendChild(paragraph);
      }
      existing.replaceWith(fragment);
    } else if (existing) {
      const replacement = document.createElement(tag.toLowerCase());
      while (existing.firstChild) replacement.appendChild(existing.firstChild);
      existing.replaceWith(replacement);
      caretTarget = replacement.firstElementChild || replacement;
    } else {
      const replacement = document.createElement(tag.toLowerCase());
      for (const node of selected) {
        const item = document.createElement('li');
        if (node.nodeType === Node.ELEMENT_NODE && ['P', 'DIV'].includes(node.tagName))
          item.innerHTML = node.innerHTML || '<br>';
        else item.appendChild(node.cloneNode(true));
        replacement.appendChild(item);
        if (!caretTarget) caretTarget = item;
      }
      selected[0].before(replacement);
      for (const node of selected) node.remove();
    }
    if (caretTarget) {
      const caret = document.createRange();
      caret.selectNodeContents(caretTarget); caret.collapse(false);
      selection.removeAllRanges(); selection.addRange(caret);
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function toolbar(editor, row) {
    const bar = document.createElement('div');
    bar.className = 'macro-library-toolbar';
    let savedRange = null;
    const rememberSelection = () => {
      const selection = document.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode))
        savedRange = selection.getRangeAt(0).cloneRange();
    };
    const restoreSelection = () => {
      editor.focus();
      const selection = document.getSelection();
      if (savedRange && savedRange.startContainer.isConnected) {
        selection.removeAllRanges(); selection.addRange(savedRange);
      } else if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
        const caret = document.createRange();
        caret.selectNodeContents(editor); caret.collapse(false);
        selection.removeAllRanges(); selection.addRange(caret);
      }
    };
    editor.addEventListener('mouseup', rememberSelection);
    editor.addEventListener('keyup', rememberSelection);
    bar.addEventListener('mousedown', rememberSelection, true);
    const glyph = (letter, style = '') => `<span class="macro-tool-letter ${style}">${letter}</span>`;
    const icon = path => `<svg class="macro-tool-icon" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    const group = () => {
      const element = document.createElement('span');
      element.className = 'macro-tool-group';
      bar.appendChild(element);
      return element;
    };
    const buttons = [
      ['bold', glyph('B'), 'Negrito', 0],
      ['italic', glyph('I', 'macro-tool-italic'), 'Itálico', 0],
      ['underline', glyph('U', 'macro-tool-underline'), 'Sublinhado', 0],
      ['strikeThrough', glyph('S', 'macro-tool-strike'), 'Riscado', 0],
      ['insertOrderedList', icon('<path d="M9 7h11M9 17h11"/><text x="2" y="11">1</text><text x="2" y="21">2</text>'), 'Lista numerada', 1],
      ['insertUnorderedList', icon('<path d="M9 7h11M9 17h11"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="17" r="1"/>'), 'Lista com marcadores', 1],
      ['justifyLeft', icon('<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>'), 'Alinhar à esquerda', 2],
      ['justifyCenter', icon('<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>'), 'Centralizar', 2],
      ['justifyRight', icon('<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>'), 'Alinhar à direita', 2]
    ];
    const buttonGroups = [group(), group(), group()];
    for (const [command, image, title, groupIndex] of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
      button.innerHTML = image;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        restoreSelection();
        if (command === 'insertOrderedList' || command === 'insertUnorderedList')
          toggleEditorList(editor, command === 'insertOrderedList');
        else document.execCommand(command, false);
        rememberSelection(); void persist(row);
      });
      buttonGroups[groupIndex].appendChild(button);
    }
    const sizeGroup = group();
    const size = document.createElement('select');
    size.title = 'Tamanho da fonte';
    for (const [value, label] of [['2','Pequeno'],['3','Normal'],['4','Médio'],['5','Grande'],['6','Muito grande']]) {
      const option = new Option(label, value); size.add(option);
    }
    size.value = '3';
    size.addEventListener('change', () => { restoreSelection(); document.execCommand('fontSize', false, size.value); rememberSelection(); void persist(row); });
    sizeGroup.appendChild(size);
    const colorGroup = group();
    for (const [command, title, image] of [
      ['foreColor','Cor do texto', glyph('A')],
      ['hiliteColor','Cor de fundo', icon('<path d="m5 15 9-9a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3l-9 9H5zM12 8l4 4"/>')]
    ]) {
      const control = document.createElement('span'); control.className = 'macro-color-control';
      if (command === 'hiliteColor') control.classList.add('is-highlight');
      const trigger = document.createElement('button'); trigger.type = 'button';
      trigger.title = title; trigger.setAttribute('aria-label', title); trigger.innerHTML = image;
      const color = document.createElement('input'); color.type = 'color'; color.title = title;
      color.value = command === 'foreColor' ? '#000000' : '#ffff00';
      trigger.addEventListener('mousedown', event => event.preventDefault());
      trigger.addEventListener('click', () => color.click());
      color.addEventListener('change', () => {
        control.style.setProperty('--macro-swatch', color.value);
        restoreSelection(); document.execCommand(command, false, color.value);
        rememberSelection(); void persist(row);
      });
      control.append(trigger, color); colorGroup.appendChild(control);
    }
    const linkGroup = group();
    const link = document.createElement('button');
    link.type = 'button'; link.title = 'Link'; link.setAttribute('aria-label', 'Link');
    link.innerHTML = icon('<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"/>');
    link.addEventListener('mousedown', event => event.preventDefault());
    link.addEventListener('click', () => {
      const url = prompt('Endereço do link (https:// ou mailto:)');
      if (url && /^(https?:\/\/|mailto:)/i.test(url)) {
        restoreSelection(); document.execCommand('createLink', false, url); rememberSelection(); void persist(row);
      }
    });
    linkGroup.appendChild(link);
    return bar;
  }
  function makeRow(row) {
    const outer = document.createElement('div'); outer.className = 'macro-library-row';
    const header = document.createElement('div'); header.className = 'macro-library-header';
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'macro-library-toggle';
    toggle.innerHTML = '<span class="macro-library-header-text"></span>' +
      '<span class="macro-library-row-icon macro-library-edit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m4 16 11-11 4 4-11 11H4zM13 7l4 4"/></svg></span>' +
      '<span class="macro-library-row-icon macro-library-check-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></svg></span>';
    const body = document.createElement('div'); body.className = 'macro-library-body'; body.hidden = true;
    const name = document.createElement('textarea'); name.rows = 1; name.maxLength = 50;
    name.className = 'macro-library-name'; name.placeholder = 'Abreviação';
    name.setAttribute('aria-label', 'Abreviação da macro'); name.spellcheck = false;
    name.readOnly = true; name.tabIndex = -1;
    name.value = row.abbreviation || '';
    const shell = document.createElement('div'); shell.className = 'macro-library-editor-shell';
    const editor = document.createElement('div'); editor.className = 'macro-library-editor';
    editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true'); editor.setAttribute('aria-label', 'Texto expandido da macro');
    editor.spellcheck = false; editor.innerHTML = html.sanitize(row.html || '<p><br></p>');
    shell.append(toolbar(editor, row), editor);
    header.append(toggle, name); body.append(shell); outer.append(header, body); row.element = outer;
    toggle.addEventListener('click', event => {
      const bounds = name.getBoundingClientRect();
      const editName = body.hidden && event.detail > 0 &&
        event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      toggleRow(row);
      if (editName) { name.focus(); name.select(); }
    });
    name.addEventListener('input', () => {
      const clean = name.value.replace(/\s/g, '').slice(0, 50);
      if (name.value !== clean) name.value = clean;
      sizeName(row);
      const text = name.value.trim();
      if (text && !/[\r\n ]/.test(text)) void persist(row);
    });
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault(); row.element.querySelector('.macro-library-editor').focus();
      }
    });
    name.addEventListener('blur', async () => {
      if (!name.value.trim()) {
        await row.pending;
        if (row.id) await store.remove(row.id);
        else await store.pruneImages();
        rows = rows.filter(item => item !== row);
        if (openRow === row) { bodyObserver.disconnect(); openRow = null; }
        outer.remove(); updateWarnings(); notifyChange();
        updateListHeight();
      } else void persist(row);
    });
    editor.addEventListener('input', () => {
      html.normalizeEditorBreaks(editor);
      void persist(row);
    });
    editor.addEventListener('blur', () => { void persist(row).then(() => store.pruneImages()); });
    editor.addEventListener('paste', async event => {
      const imageItem = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
      if (!imageItem) return;
      event.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const selection = document.getSelection();
      const caret = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const id = await store.putImage(blob);
      const url = URL.createObjectURL(blob); imageUrls.add(url);
      editor.focus();
      if (caret?.startContainer.isConnected) {
        selection.removeAllRanges(); selection.addRange(caret);
      }
      document.execCommand('insertHTML', false,
        `<img src="${url}" data-th-image-id="${id}" alt="Imagem da macro">`);
      void persist(row);
    });
    return outer;
  }
  function render() {
    bodyObserver.disconnect();
    for (const url of imageUrls) URL.revokeObjectURL(url);
    imageUrls.clear(); list.replaceChildren(); openRow = null;
    for (const row of rows) { list.appendChild(makeRow(row)); sizeName(row); }
    updateWarnings();
    updateListHeight();
  }
  async function blobToData(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
    });
  }
  function dataToBlob(value) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
    if (!match) throw new Error('Imagem inválida no arquivo.');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
  }
  async function exportFile() {
    await Promise.all(rows.map(row => row.pending).filter(Boolean));
    const saved = await store.list();
    if (!saved.length) return;
    const imageIds = new Set(saved.flatMap(row =>
      [...row.html.matchAll(/data-th-image-id="([a-f0-9-]+)"/gi)].map(match => match[1])));
    const images = [];
    for (const id of imageIds) {
      const asset = await store.image(id);
      if (!asset?.blob) throw new Error('Uma imagem da macro não está disponível.');
      images.push({ id, data: await blobToData(asset.blob) });
    }
    const date = new Date();
    const stamp = [date.getDate(), date.getMonth()+1, date.getFullYear()%100]
      .map(value => String(value).padStart(2, '0')).join('');
    const file = new Blob([JSON.stringify({ format: core.FORMAT, macros: saved, images })],
      { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url;
    link.download = `TicketHelper-Macros-${stamp}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function proKeysImageBlob(src) {
    if (src.startsWith('data:image/')) return dataToBlob(src);
    if (!/^https?:\/\//i.test(src)) throw new Error('Imagem ProKeys inválida.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error('Imagem ProKeys indisponível.');
      return await response.blob();
    } finally { clearTimeout(timeout); }
  }
  async function stageProKeys(data) {
    const parsed = core.prepareProKeysNames(core.parseProKeys(data));
    const staged = [];
    const images = [];
    const renames = [];
    const missingImages = [];
    let unsupported = 0;
    for (const [index, source] of parsed.entries()) {
      const abbreviation = source.abbreviation;
      if (abbreviation !== source.originalAbbreviation)
        renames.push({ before: source.originalAbbreviation, after: abbreviation });
      if (/\[\[%[^\]]+\]\]/.test(source.body)) unsupported++;
      const raw = /<\/?[a-z][^>]*>/i.test(source.body) ? source.body : html.fromPlain(source.body);
      const template = document.createElement('template'); template.innerHTML = raw;
      for (const img of template.content.querySelectorAll('img')) {
        try {
          const blob = await proKeysImageBlob(img.getAttribute('src') || '');
          if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type))
            throw new Error('Formato de imagem ProKeys não suportado.');
          const id = crypto.randomUUID();
          images.push({ id, blob });
          img.dataset.thImageId = id; img.src = `th-image:${id}`;
        } catch (_) {
          img.replaceWith(document.createTextNode('%imagem%'));
          missingImages.push(abbreviation);
        }
      }
      staged.push({ id: index + 1, abbreviation, html: html.sanitize(template.innerHTML) });
    }
    return { macros: staged, images, renames, missingImages, unsupported };
  }
  async function stageTicketHelper(data) {
    const parsed = JSON.parse(data.replace(/^\uFEFF/, ''));
    if (parsed?.format !== core.FORMAT || !Array.isArray(parsed.macros) ||
        !Array.isArray(parsed.images)) throw new Error('Arquivo de macros inválido.');
    const ids = new Set();
    const macros = parsed.macros.map(row => {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) ||
          typeof row.abbreviation !== 'string' || !row.abbreviation.trim() ||
          row.abbreviation.length > 50 ||
          /\s/u.test(row.abbreviation) || typeof row.html !== 'string')
        throw new Error('Arquivo contém macro inválida.');
      ids.add(row.id);
      return { id: row.id, abbreviation: row.abbreviation, html: html.sanitize(row.html) };
    });
    const imageIds = new Set();
    const images = parsed.images.map(asset => {
      if (!/^[a-f0-9-]+$/i.test(asset?.id) || imageIds.has(asset.id))
        throw new Error('Arquivo contém imagens duplicadas ou inválidas.');
      imageIds.add(asset.id);
      return { id: asset.id, blob: dataToBlob(asset.data) };
    });
    for (const row of macros) for (const match of row.html.matchAll(/data-th-image-id="([a-f0-9-]+)"/gi))
      if (!imageIds.has(match[1])) throw new Error('Arquivo não contém todas as imagens.');
    for (const row of macros) if (/<img[^>]+src="https?:\/\//i.test(row.html))
      throw new Error('Uma imagem externa impede a importação completa.');
    return { macros, images };
  }
  function confirmMacroImport(previousCount, staged, warning) {
    if (!staged.renames?.length && !staged.missingImages?.length)
      return Promise.resolve(confirm(
        `Substituir ${previousCount} macro(s) por ${staged.macros.length} macro(s)?${warning}`));
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'macro-import-dialog';
      const title = document.createElement('h2');
      title.textContent = 'Importar macros';
      const summary = document.createElement('p');
      summary.textContent = `Substituir ${previousCount} macro(s) por ${staged.macros.length} macro(s)?`;
      dialog.append(title, summary);
      if (staged.renames?.length) {
        const heading = document.createElement('p');
        heading.textContent = `${staged.renames.length} abreviação(ões) terão os espaços removidos:`;
        const mappings = document.createElement('div');
        mappings.className = 'macro-import-mappings';
        for (const { before, after } of staged.renames) {
          const line = document.createElement('div');
          line.textContent = `${before} → ${after}`;
          mappings.appendChild(line);
        }
        dialog.append(heading, mappings);
      }
      if (staged.missingImages?.length) {
        const note = document.createElement('p');
        note.textContent = `Imagem indisponível em ${[...new Set(staged.missingImages)].join(', ')}. ` +
          'Será substituída por %imagem%.';
        dialog.appendChild(note);
      }
      if (warning) {
        const note = document.createElement('p');
        note.textContent = warning.trim();
        dialog.appendChild(note);
      }
      const actions = document.createElement('div');
      actions.className = 'macro-import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.textContent = 'Cancelar';
      const accept = document.createElement('button');
      accept.type = 'button'; accept.textContent = 'Importar';
      actions.append(cancel, accept);
      dialog.appendChild(actions);
      document.body.appendChild(dialog);
      const finish = accepted => { dialog.close(); dialog.remove(); resolve(accepted); };
      cancel.addEventListener('click', () => finish(false), { once: true });
      accept.addEventListener('click', () => finish(true), { once: true });
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); }, { once: true });
      dialog.showModal();
    });
  }
  async function importFile(file) {
    if (!file || file.size > core.MAX_IMPORT_BYTES) throw new Error('Arquivo muito grande ou inválido.');
    await Promise.all(rows.map(row => row.pending).filter(Boolean));
    const text = await file.text();
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    const staged = parsed?.format === core.FORMAT ? await stageTicketHelper(text) : await stageProKeys(text);
    const previous = await store.list();
    const warning = staged.unsupported ?
      `\n${staged.unsupported} macro(s) usam comandos próprios do ProKeys; eles ficarão como texto.` : '';
    if (!await confirmMacroImport(previous.length, staged, warning)) return;
    await store.replaceAll(staged.macros, staged.images);
    rows = newestFirst(await store.list()); render(); notifyChange();
    if (staged.missingImages?.length) {
      const names = [...new Set(staged.missingImages)];
      chrome.runtime.sendMessage({ action: 'SHOW_MACRO_IMPORT_WARNING',
        text: `Imagem não importada em: ${names.join(', ')}. %imagem% foi inserido no lugar.` })
        .catch(error => console.warn('TicketHelper import warning', error));
    }
  }
  function renderShortcut(place, value, defaultValue, kind, label) {
    const control = place.closest('.sc-shortcut-control');
    control?.querySelector('.sc-suggestion')?.remove();
    if (control && value !== defaultValue) {
      const suggestion = document.createElement('span');
      suggestion.className = 'sc-suggestion';
      suggestion.textContent = `(${defaultValue})`;
      control.insertBefore(suggestion, place);
    }
    place.innerHTML = `<button type="button" class="sc-key-btn${value ? '' : ' is-empty'}" aria-label="Editar atalho de ${label}">${capturing === kind ?
      `<span class="sc-capture-field">${captureHint}<span class="sc-capture-caret"></span></span>` :
      value ? value.split('+').map((part, i, all) => `<kbd>${part}</kbd>${i < all.length-1 ? '<span class="plus">+</span>' : ''}`).join('') :
        '<span class="sc-add-label">Adicionar</span>'}</button>`;
    place.firstElementChild.addEventListener('click', event => {
      event.stopPropagation();
      capturing = kind; captureHint = 'Pressione o atalho';
      renderShortcuts(); place.firstElementChild.focus();
    });
  }
  function renderShortcuts() {
    renderShortcut(shortcutPlace, shortcut, store.DEFAULT_SHORTCUT, 'expand', 'Expandir Macro');
    renderShortcut(pickerShortcutPlace, pickerShortcut, store.DEFAULT_PICKER_SHORTCUT,
      'picker', 'Pesquisar Macro / Criar Macro');
  }
  async function setShortcut(value) {
    const kind = capturing;
    if (kind === 'picker') pickerShortcut = value;
    else shortcut = value;
    capturing = ''; captureHint = 'Pressione o atalho';
    await chrome.storage.local.set({ [kind === 'picker' ? 'macroPickerShortcut' : 'macroExpandShortcut']: value });
    renderShortcuts();
  }
  document.addEventListener('keydown', event => {
    if (!capturing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { capturing = ''; renderShortcuts(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { void setShortcut(''); return; }
    const candidate = core.eventShortcut(event);
    if (!candidate) return;
    if (candidate === (capturing === 'picker' ? shortcut : pickerShortcut)) {
      captureHint = 'Atalho já em uso';
      const place = capturing === 'picker' ? pickerShortcutPlace : shortcutPlace;
      renderShortcuts(); place.firstElementChild.focus();
      return;
    }
    void setShortcut(candidate);
  }, true);
  addButton.addEventListener('click', () => {
    const row = { id: null, abbreviation: '', html: '' };
    rows.unshift(row); list.prepend(makeRow(row)); toggleRow(row, true);
    row.element.querySelector('.macro-library-name').focus();
  });
  exportButton.addEventListener('click', () => { void exportFile().catch(error => alert(error.message)); });
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void importFile(fileInput.files?.[0]).catch(error => alert(error.message)).finally(() => { fileInput.value = ''; });
  });
  const saveOpenMacro = () => { if (openRow?.element?.isConnected) void persist(openRow); };
  window.addEventListener('blur', saveOpenMacro);
  window.addEventListener('pagehide', saveOpenMacro);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveOpenMacro();
  });
  document.addEventListener('tickethelper:macro-picker-saved', () => {
    void Promise.all(rows.map(row => row.pending).filter(Boolean)).then(async () => {
      rows = newestFirst(await store.list()); render();
    });
  });
  Promise.all([store.list(), chrome.storage.local.get(['macroExpandShortcut','macroPickerShortcut'])]).then(([saved, settings]) => {
    rows = newestFirst(saved); shortcut = Object.prototype.hasOwnProperty.call(settings, 'macroExpandShortcut') ?
      core.normalizeShortcut(settings.macroExpandShortcut) : store.DEFAULT_SHORTCUT;
    pickerShortcut = Object.prototype.hasOwnProperty.call(settings, 'macroPickerShortcut') ?
      core.normalizeShortcut(settings.macroPickerShortcut) : store.DEFAULT_PICKER_SHORTCUT;
    render(); renderShortcuts();
  }).catch(error => console.error('TicketHelper macro library', error));
})();
