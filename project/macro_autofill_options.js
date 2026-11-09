(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroAutofillCore;
  const transfer = globalThis.TicketHelperOptionsTransfer;
  const list = document.getElementById('macro-autofill-list');
  const addButton = document.getElementById('macro-autofill-add');
  const importButton = document.getElementById('macro-autofill-import');
  const exportButton = document.getElementById('macro-autofill-export');
  const fileInput = document.getElementById('macro-autofill-file');
  if (!core || !transfer || !list || !addButton || !importButton || !exportButton ||
      !fileInput) return;

  let rules = [];
  let saveQueue = Promise.resolve();
  let externalUpdate = null;
  let loaded = false;
  let changeDuringLoad = null;
  addButton.disabled = true;
  importButton.disabled = true;
  exportButton.disabled = true;
  const measure = document.createElement('canvas').getContext('2d');

  function actionName(id) {
    return core.ACTIONS.find(action => action.id === id)?.name || '';
  }

  function searchable(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
  }
  function positionMenu(menu, action) {
    const rect = action.getBoundingClientRect();
    const width = Number.parseFloat(menu.style.width) || menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${menuHeight && rect.bottom + menuHeight + 8 > window.innerHeight &&
      rect.top >= menuHeight + 8 ? rect.top - menuHeight - 3 : rect.bottom + 3}px`;
  }

  function persist() {
    const snapshot = core.validRules(rules);
    saveQueue = saveQueue.catch(() => {}).then(() =>
      chrome.storage.local.set({ [core.STORAGE_KEY]: snapshot }))
      .catch(error => console.error('Could not save macro labels:', error));
  }

  function sizeRows() {
    const entries = [...list.querySelectorAll('.macro-autofill-entry')];
    if (!list.clientWidth || !measure) return;
    const available = list.clientWidth - 8;
    let keyWidth = available * 0.38;
    for (const row of entries) {
      const label = row.querySelector('.macro-autofill-label');
      const style = getComputedStyle(label);
      measure.font = `${style.fontSize} ${style.fontFamily}`;
      const text = label.value || label.placeholder;
      keyWidth = Math.max(keyWidth, Math.ceil(measure.measureText(text).width + 16));
    }
    keyWidth = Math.min(keyWidth, available * 0.58);
    list.parentElement.style.setProperty('--macro-key-width', `${keyWidth}px`);
    for (const row of entries) {
      const label = row.querySelector('.macro-autofill-label');
      const style = getComputedStyle(label);
      measure.font = `${style.fontSize} ${style.fontFamily}`;
      label.style.width = `${Math.min(keyWidth, Math.ceil(measure.measureText(label.value || label.placeholder).width + 16))}px`;
      const action = row.querySelector('.macro-autofill-action');
      const actionStyle = getComputedStyle(action);
      measure.font = `${actionStyle.fontSize} ${actionStyle.fontFamily}`;
      const actionWidth = Math.min(action.parentElement.clientWidth,
        Math.ceil(measure.measureText(action.value || action.placeholder).width + 10));
      action.style.width = `${actionWidth}px`;
      const menu = row.querySelector('.macro-autofill-menu');
      const longestOption = Math.max(...core.ACTIONS.map(item => measure.measureText(item.name).width));
      const menuWidth = Math.min(window.innerWidth - 16,
        Math.max(actionWidth, Math.ceil(longestOption + 24)));
      menu.style.width = `${menuWidth}px`;
      positionMenu(menu, action);
    }
  }

  function render() {
    list.replaceChildren();
    for (const rule of rules) {
      const row = document.createElement('div');
      row.className = 'macro-autofill-entry';

      const label = document.createElement('input');
      label.type = 'text';
      label.spellcheck = false;
      label.className = 'macro-autofill-label';
      label.setAttribute('aria-label', 'Etiqueta da macro');
      label.placeholder = 'Etiqueta da macro';
      label.value = rule.label;
      label.title = rule.label;
      label.addEventListener('input', () => {
        rule.label = label.value;
        label.title = label.value;
        label.setCustomValidity('');
        sizeRows();
      });
      label.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); label.blur(); }
      });
      label.addEventListener('blur', () => {
        const exactLabel = label.value;
        if (!exactLabel.trim()) {
          rules = rules.filter(item => item !== rule);
          row.remove();
          sizeRows();
          persist();
          updateExportAvailability();
          return;
        }
        if (rules.some(item => item !== rule && item.label === exactLabel)) {
          label.setCustomValidity('Esta etiqueta já existe.');
          label.reportValidity();
          label.focus();
          return;
        }
        rule.label = exactLabel;
        label.value = exactLabel;
        label.title = exactLabel;
        persist();
        updateExportAvailability();
      });

      const actionCell = document.createElement('div');
      actionCell.className = 'macro-autofill-action-cell';
      const actionInput = document.createElement('input');
      actionInput.type = 'text';
      actionInput.spellcheck = false;
      actionInput.className = 'macro-autofill-action';
      actionInput.setAttribute('role', 'combobox');
      actionInput.setAttribute('aria-label', 'Ação da etiqueta');
      actionInput.setAttribute('aria-autocomplete', 'list');
      actionInput.setAttribute('aria-expanded', 'false');
      actionInput.placeholder = 'Escolher ação';
      actionInput.value = actionName(rule.action);
      const menu = document.createElement('div');
      menu.className = 'macro-autofill-menu';
      menu.id = `macro-autofill-menu-${rule.id}`;
      menu.setAttribute('role', 'listbox');
      actionInput.setAttribute('aria-controls', menu.id);
      menu.hidden = true;
      let visible = [];
      let activeIndex = 0;

      function closeMenu() {
        menu.hidden = true;
        actionInput.setAttribute('aria-expanded', 'false');
      }

      function choose(id) {
        rule.action = id;
        actionInput.value = actionName(id);
        closeMenu();
        persist();
        sizeRows();
      }

      function showMenu() {
        const term = searchable(actionInput.value.trim());
        visible = core.ACTIONS.filter(action => searchable(action.name).includes(term));
        activeIndex = 0;
        menu.replaceChildren();
        for (const action of visible) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'macro-autofill-menu-item';
          item.setAttribute('role', 'option');
          item.textContent = action.name;
          item.addEventListener('pointerdown', event => event.preventDefault());
          item.addEventListener('click', () => choose(action.id));
          menu.appendChild(item);
        }
        menu.hidden = !visible.length;
        actionInput.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) positionMenu(menu, actionInput);
        markActive();
      }

      function markActive() {
        [...menu.children].forEach((item, index) => {
          item.classList.toggle('active', index === activeIndex);
          item.setAttribute('aria-selected', String(index === activeIndex));
        });
      }

      actionInput.addEventListener('focus', () => {
        actionInput.value = '';
        sizeRows();
        showMenu();
      });
      actionInput.addEventListener('input', () => { sizeRows(); showMenu(); });
      actionInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          actionInput.value = actionName(rule.action);
          closeMenu();
          actionInput.blur();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (menu.hidden) showMenu();
          if (visible.length)
            activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
          markActive();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (visible[activeIndex]) choose(visible[activeIndex].id);
          actionInput.blur();
        }
      });
      actionInput.addEventListener('blur', () => {
        actionInput.value = actionName(rule.action);
        closeMenu();
        sizeRows();
      });

      actionCell.append(actionInput, menu);
      row.append(label, actionCell);
      list.appendChild(row);
    }
    sizeRows();
    updateExportAvailability();
  }

  function updateExportAvailability() {
    exportButton.disabled = !loaded || !core.validRules(rules).length;
  }

  window.addEventListener('resize', sizeRows);
  list.addEventListener('scroll', () => {
    for (const menu of list.querySelectorAll('.macro-autofill-menu:not([hidden])'))
      positionMenu(menu, menu.parentElement.querySelector('.macro-autofill-action'));
  }, { passive: true });
  window.addEventListener('scroll', () => {
    for (const menu of list.querySelectorAll('.macro-autofill-menu:not([hidden])'))
      positionMenu(menu, menu.parentElement.querySelector('.macro-autofill-action'));
  }, { passive: true });

  addButton.addEventListener('click', () => {
    const rule = { id: crypto.randomUUID(), label: '', action: null };
    rules.push(rule);
    render();
    list.lastElementChild?.querySelector('.macro-autofill-label')?.focus();
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
      const pairs = transfer.parse('macros', await transfer.readFile(file));
      const seen = new Set();
      const imported = pairs.map(([label, name]) => {
        if (seen.has(label)) throw new Error('O arquivo contém etiquetas repetidas.');
        seen.add(label);
        const action = name ? core.ACTIONS.find(item => item.name === name) : null;
        if (name && !action) throw new Error(`Ação desconhecida: ${name}`);
        return { id: crypto.randomUUID(), label, action: action?.id || null };
      });
      await saveQueue;
      await chrome.storage.local.set({ [core.STORAGE_KEY]: imported });
      rules = imported;
      externalUpdate = null;
      render();
    } catch (error) {
      window.alert(error.message || 'Não foi possível importar o arquivo.');
    } finally {
      importButton.disabled = false;
      updateExportAvailability();
    }
  });

  exportButton.addEventListener('click', async () => {
    try {
      await saveQueue;
      const saved = await chrome.storage.local.get(core.STORAGE_KEY);
      const pairs = core.validRules(saved[core.STORAGE_KEY])
        .map(rule => [rule.label, actionName(rule.action)]);
      if (!pairs.length) { updateExportAvailability(); return; }
      const filename = transfer.exportFilename('macros');
      transfer.download(filename, transfer.serialize('macros', pairs));
    } catch (error) {
      window.alert(error.message || 'Não foi possível exportar as etiquetas.');
    }
  });

  list.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!list.contains(document.activeElement) && externalUpdate) {
        rules = core.validRules(externalUpdate);
        externalUpdate = null;
        render();
      }
    }, 0);
  });

  chrome.storage.local.get(core.STORAGE_KEY).then(state => {
    rules = core.validRules(changeDuringLoad ?? state[core.STORAGE_KEY]);
    loaded = true;
    render();
    addButton.disabled = false;
    importButton.disabled = false;
    updateExportAvailability();
  }).catch(error => console.error('Could not load macro labels:', error));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[core.STORAGE_KEY]) return;
    const incoming = core.validRules(changes[core.STORAGE_KEY].newValue);
    if (!loaded) { changeDuringLoad = incoming; return; }
    if (JSON.stringify(incoming) === JSON.stringify(core.validRules(rules))) return;
    if (list.contains(document.activeElement)) externalUpdate = incoming;
    else { rules = incoming; render(); }
  });
})();
