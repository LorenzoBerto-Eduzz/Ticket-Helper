(() => {
  'use strict';

  const PREFIX = 'producerNote:';
  const transfer = globalThis.TicketHelperOptionsTransfer;
  const list = document.getElementById('producer-notes-list');
  const addButton = document.getElementById('producer-note-add');
  const importButton = document.getElementById('producer-note-import');
  const exportButton = document.getElementById('producer-note-export');
  const fileInput = document.getElementById('producer-note-file');
  if (!transfer || !list || !addButton || !importButton || !exportButton ||
      !fileInput) return;

  const notes = new Map();
  const changedDuringLoad = new Set();
  let initialLoadPending = true;
  let pendingSaves = 0;
  let saveQueue = Promise.resolve();
  let refreshPending = false;
  let importing = false;
  importButton.disabled = true;
  exportButton.disabled = true;

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function capitalizeName(value) {
    return clean(value).toLocaleLowerCase('pt-BR')
      .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_match, boundary, letter) =>
        `${boundary}${letter.toLocaleUpperCase('pt-BR')}`);
  }

  function keyFor(name) {
    return PREFIX + clean(name).normalize('NFC').toLocaleLowerCase('pt-BR');
  }

  function unpack(key, value) {
    const fallbackName = key.slice(PREFIX.length);
    if (typeof value === 'string') return { name: fallbackName, note: value };
    if (value && typeof value === 'object') {
      return { name: clean(value.name) || fallbackName, note: clean(value.note) };
    }
    return null;
  }

  function field(label, value, placeholder) {
    const cell = document.createElement('div');
    cell.className = 'producer-note-cell';
    const input = document.createElement('textarea');
    input.rows = 1;
    input.spellcheck = false;
    input.className = 'producer-note-field';
    input.setAttribute('aria-label', label);
    input.placeholder = placeholder;
    input.value = value;
    input.title = value;
    input.addEventListener('input', () => { input.title = input.value; });
    const overflow = document.createElement('span');
    overflow.className = 'producer-note-overflow';
    overflow.setAttribute('aria-hidden', 'true');
    overflow.textContent = '…';
    cell.append(input, overflow);
    return input;
  }

  function sizeEntry(entry) {
    const fields = [...entry.querySelectorAll('.producer-note-field')];
    if (fields.length !== 2) return;
    const naturalHeights = fields.map(input => {
      input.style.height = '24px';
      return input.scrollHeight + 2;
    });
    const height = Math.max(24, Math.min(42, Math.max(...naturalHeights)));
    fields.forEach((input, index) => {
      input.style.height = `${height}px`;
      input.parentElement.classList.toggle('is-truncated', naturalHeights[index] > 42);
    });
  }

  function makeEntry(key, data = { name: '', note: '' }) {
    const entry = document.createElement('div');
    entry.className = 'producer-note-entry';
    if (key) entry.dataset.key = key;
    const name = field('Nome do produtor', capitalizeName(data.name), 'Nome completo do produtor');
    name.classList.add('producer-note-name');
    name.parentElement.classList.add('producer-note-name-cell');
    const note = field('Aviso do produtor', data.note, 'Aviso');
    for (const input of [name, note]) {
      input.addEventListener('input', () => {
        entry.dataset.dirty = 'true';
        sizeEntry(entry);
      });
    }
    entry.append(name.parentElement, note.parentElement);
    entry.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.target.blur();
    });
    entry.addEventListener('focusout', () => {
      pendingSaves++;
      setTimeout(() => {
        saveQueue = saveQueue.then(() => saveEntry(entry, name, note))
          .then(changed => { if (changed) refreshPending = true; })
          .finally(() => {
            pendingSaves--;
            if (!pendingSaves && refreshPending) render();
          });
      }, 0);
    });
    return entry;
  }

  function render() {
    updateExportAvailability();
    if (importing || pendingSaves || list.contains(document.activeElement)) {
      refreshPending = true;
      return;
    }
    refreshPending = false;
    const drafts = [...list.children].filter(entry =>
      !entry.dataset.key && entry.dataset.dirty === 'true');
    list.replaceChildren(...[...notes]
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
      .map(([key, data]) => makeEntry(key, data)), ...drafts);
    [...list.children].forEach(sizeEntry);
  }

  function updateExportAvailability() {
    exportButton.disabled = initialLoadPending || !notes.size;
  }

  async function saveEntry(entry, nameInput, noteInput) {
    if (!entry.isConnected || entry.dataset.dirty !== 'true') return;
    const name = capitalizeName(nameInput.value);
    const note = clean(noteInput.value);
    const oldKey = entry.dataset.key || '';
    if (!name) {
      if (oldKey) {
        try {
          await chrome.storage.local.remove(oldKey);
          notes.delete(oldKey);
        } catch (error) {
          console.error('Could not remove producer note:', error);
          nameInput.setCustomValidity('Não foi possível remover. Tente novamente.');
          nameInput.reportValidity();
          nameInput.focus();
          return;
        }
      }
      entry.remove();
      return true;
    }
    const newKey = keyFor(name);
    noteInput.setCustomValidity('');
    if (newKey !== oldKey && notes.has(newKey)) {
      nameInput.setCustomValidity('Este produtor já tem um aviso. Edite o aviso existente.');
      nameInput.reportValidity();
      nameInput.focus();
      return;
    }
    nameInput.setCustomValidity('');
    if (oldKey === newKey && notes.get(oldKey)?.name === name && notes.get(oldKey)?.note === note) return;
    try {
      await chrome.storage.local.set({ [newKey]: { name, note } });
      if (oldKey && oldKey !== newKey) await chrome.storage.local.remove(oldKey);
      if (oldKey && oldKey !== newKey) notes.delete(oldKey);
      notes.set(newKey, { name, note });
      entry.dataset.key = newKey;
      delete entry.dataset.dirty;
    } catch (error) {
      console.error('Could not save producer note:', error);
      noteInput.setCustomValidity('Não foi possível salvar. Tente novamente.');
      noteInput.reportValidity();
      noteInput.focus();
      return;
    }
    return true;
  }

  addButton.addEventListener('click', () => {
    const entry = makeEntry('');
    entry.dataset.dirty = 'true';
    list.appendChild(entry);
    sizeEntry(entry);
    entry.querySelector('.producer-note-name').focus();
  });

  importButton.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    importButton.disabled = true;
    exportButton.disabled = true;
    try {
      const pairs = transfer.parse('producers', await transfer.readFile(file));
      const imported = new Map();
      for (const [rawName, rawNote] of pairs) {
        const name = capitalizeName(rawName);
        const key = keyFor(name);
        if (imported.has(key)) throw new Error('O arquivo contém produtores repetidos.');
        imported.set(key, { name, note: clean(rawNote) });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      await saveQueue;
      const stored = await chrome.storage.local.get(null);
      const previous = Object.fromEntries(Object.entries(stored)
        .filter(([key]) => key.startsWith(PREFIX)));
      const next = Object.fromEntries(imported);
      const removedKeys = Object.keys(previous).filter(key => !(key in next));
      importing = true;
      try {
        if (Object.keys(next).length) await chrome.storage.local.set(next);
        if (removedKeys.length) await chrome.storage.local.remove(removedKeys);
        notes.clear();
        for (const [key, value] of imported) notes.set(key, value);
      } catch (error) {
        try {
          if (Object.keys(previous).length) await chrome.storage.local.set(previous);
          const newKeys = Object.keys(next).filter(key => !(key in previous));
          if (newKeys.length) await chrome.storage.local.remove(newKeys);
          notes.clear();
          for (const [key, value] of Object.entries(previous)) {
            const data = unpack(key, value);
            if (data) notes.set(key, data);
          }
        } catch (rollbackError) {
          console.error('Could not restore producer notes after failed import:', rollbackError);
        }
        throw error;
      } finally {
        importing = false;
        render();
      }
    } catch (error) {
      window.alert(error.message || 'Não foi possível importar o arquivo.');
    } finally {
      importButton.disabled = false;
      updateExportAvailability();
    }
  });

  exportButton.addEventListener('click', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      await saveQueue;
      const stored = await chrome.storage.local.get(null);
      const pairs = Object.entries(stored)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([key, value]) => unpack(key, value))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map(({ name, note }) => [name, note]);
      if (!pairs.length) { updateExportAvailability(); return; }
      const filename = transfer.exportFilename('producers');
      transfer.download(filename, transfer.serialize('producers', pairs));
    } catch (error) {
      window.alert(error.message || 'Não foi possível exportar os avisos.');
    }
  });

  window.addEventListener('resize', () => [...list.children].forEach(sizeEntry));

  list.addEventListener('focusout', () => {
    setTimeout(() => { if (refreshPending) render(); }, 0);
  });

  chrome.storage.local.get(null).then(values => {
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(PREFIX) || changedDuringLoad.has(key)) continue;
      const data = unpack(key, value);
      if (data) notes.set(key, data);
    }
    initialLoadPending = false;
    changedDuringLoad.clear();
    render();
    importButton.disabled = false;
    updateExportAvailability();
  }).catch(error => console.error('Could not load producer notes:', error));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      if (initialLoadPending) changedDuringLoad.add(key);
      const data = unpack(key, change.newValue);
      if (data) notes.set(key, data);
      else notes.delete(key);
      changed = true;
    }
    if (changed) render();
  });
})();
