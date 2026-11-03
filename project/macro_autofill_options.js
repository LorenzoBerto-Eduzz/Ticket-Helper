(() => {
  'use strict';
  const core = globalThis.TicketHelperMacroAutofillCore;
  const list = document.getElementById('macro-autofill-list');
  const addButton = document.getElementById('macro-autofill-add');
  if (!core || !list || !addButton) return;

  let rules = [];
  let saveQueue = Promise.resolve();
  let externalUpdate = null;
  let loaded = false;
  let changeDuringLoad = null;
  addButton.disabled = true;
  const measure = document.createElement('canvas').getContext('2d');

  function actionName(id) {
    return core.ACTIONS.find(action => action.id === id)?.name || '';
  }

  function searchable(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
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
      const cellLeft = action.parentElement.getBoundingClientRect().left;
      menu.style.width = `${menuWidth}px`;
      menu.style.left = `${Math.max(8 - cellLeft,
        Math.min(0, window.innerWidth - 8 - cellLeft - menuWidth))}px`;
    }
  }

  function render() {
    list.replaceChildren();
    for (const rule of rules) {
      const row = document.createElement('div');
      row.className = 'macro-autofill-entry';

      const label = document.createElement('input');
      label.type = 'text';
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
      });

      const actionCell = document.createElement('div');
      actionCell.className = 'macro-autofill-action-cell';
      const actionInput = document.createElement('input');
      actionInput.type = 'text';
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
  }

  window.addEventListener('resize', sizeRows);

  addButton.addEventListener('click', () => {
    const rule = { id: crypto.randomUUID(), label: '', action: null };
    rules.push(rule);
    render();
    list.lastElementChild?.querySelector('.macro-autofill-label')?.focus();
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
