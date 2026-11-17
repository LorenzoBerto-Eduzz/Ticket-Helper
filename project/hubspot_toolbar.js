(() => {
  if (globalThis.__ticketHelperComposerToolbarLoaded) return;
  globalThis.__ticketHelperComposerToolbarLoaded = true;

  const BUTTONS = [
    'toolbar-insert',
    'formatting-tray',
    'toolbar-emoji',
    'toolbar-link',
    'toolbar-image',
    'toolbar-file',
    'toolbar-ai',
    'toolbar-settings'
  ];
  const VISIBLE_IN_TICKET_HELPER = new Set(['toolbar-file', 'toolbar-settings']);
  const FINAL_BUTTONS = [
    ['SI', 'solveNoInteraction', 'Solucionar como sem interação'],
    ['SR', 'solveResolved', 'Solucionar como resolvido'],
    ['I3', 'waitInternal3Business', 'Aguardar interno até 3 dias úteis'],
    ['I1', 'waitInternal1Business', 'Aguardar interno até 1 dia útil'],
    ['P7', 'waitProducerWeek', 'Aguardar produtor até 1 semana'],
    ['P3', 'waitProducer3Business', 'Aguardar produtor até 3 dias úteis'],
    ['C7', 'waitCustomerWeek', 'Aguardar cliente até 1 semana'],
    ['C3', 'waitCustomer3Business', 'Aguardar cliente até 3 dias úteis']
  ];
  let mode = 'ticket-helper';
  let ticketPath = location.pathname;
  let scheduled = false;

  function findToolbar() {
    const settings = document.querySelector('[data-test-id="toolbar-settings"]');
    const left = settings?.closest('[data-onboarding="hd-composer-modernization-settings-dropdown"]')?.parentElement;
    const group = left?.parentElement;
    if (!left || !group || !group.querySelector('[data-test-id="macros-menu-dropdown"]') ||
        !group.querySelector('[data-test-id="composer-send-button"]')) return null;
    return { left, group, actions: group.querySelector('[data-test-id="macros-menu-dropdown"]').parentElement, settings };
  }

  function makeToggle(settings) {
    const nativeButton = settings.querySelector('button');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${nativeButton?.className || ''} th-composer-toolbar-toggle`;
    button.setAttribute('data-ticket-helper-toolbar-toggle', '');
    button.setAttribute('data-fnd-button', 't');
    button.setAttribute('data-button-use', 'transparent');
    button.setAttribute('data-transitional-component', 'IconButton');
    const contents = nativeButton?.firstElementChild?.cloneNode(false) || document.createElement('span');
    const icon = nativeButton?.querySelector('svg')?.cloneNode(false) || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.removeAttribute('data-icon-name');
    icon.setAttribute('viewBox', '0 0 32 32');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<rect x="2" y="8" width="28" height="16" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="21" cy="16" r="5" fill="currentColor"/>';
    contents.append(icon);
    button.append(contents);
    button.addEventListener('click', () => {
      mode = mode === 'ticket-helper' ? 'original' : 'ticket-helper';
      apply();
    });
    return button;
  }

  function makeFinalButton(settings, label, action, description, position) {
    const nativeButton = settings.querySelector('button');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${nativeButton?.className || ''} th-composer-toolbar-final`;
    button.setAttribute('data-ticket-helper-final-action', action);
    button.setAttribute('data-fnd-button', 't');
    button.setAttribute('data-button-use', 'transparent');
    button.setAttribute('aria-label', description);
    button.title = description;
    button.style.order = String(position);
    const contents = nativeButton?.firstElementChild?.cloneNode(false) || document.createElement('span');
    const text = document.createElement('span');
    text.className = 'th-composer-toolbar-final-text';
    text.textContent = label;
    contents.append(text);
    button.append(contents);
    button.addEventListener('click', () => {
      const composer = button.closest('[data-test-id="dynamic-resizable-reply-wrapper"]');
      const api = globalThis.TicketHelperMacroAutofillToolbar;
      if (api?.canRun(action, composer)) void api.run(action, composer);
    });
    return button;
  }

  function apply() {
    if (location.pathname !== ticketPath) {
      ticketPath = location.pathname;
      mode = 'ticket-helper';
    }
    const toolbar = findToolbar();
    if (!toolbar) return;
    const { left, group, actions, settings } = toolbar;

    group.classList.add('th-composer-toolbar-shell');
    left.classList.add('th-composer-toolbar');
    actions.classList.add('th-composer-toolbar-actions');
    for (const name of BUTTONS) {
      const control = left.querySelector(`[data-test-id="${name}"]`);
      const wrapper = control && [...left.children].find(child => child.contains(control));
      if (wrapper) {
        wrapper.classList.toggle('th-composer-toolbar-hidden', !VISIBLE_IN_TICKET_HELPER.has(name));
        wrapper.classList.toggle('th-composer-toolbar-settings', name === 'toolbar-settings');
        wrapper.classList.toggle('th-composer-toolbar-file', name === 'toolbar-file');
      }
    }

    let toggle = left.querySelector(':scope > [data-ticket-helper-toolbar-toggle]');
    if (!toggle) {
      toggle = makeToggle(settings);
      left.prepend(toggle);
    }
    for (const [index, [label, action, description]] of FINAL_BUTTONS.entries()) {
      if (left.querySelector(`:scope > [data-ticket-helper-final-action="${action}"]`)) continue;
      left.append(makeFinalButton(settings, label, action, description, index));
    }
    const custom = mode === 'ticket-helper';
    group.classList.toggle('th-composer-toolbar-custom', custom);
    left.classList.toggle('th-composer-toolbar-custom', custom);
    toggle.setAttribute('aria-pressed', String(custom));
    toggle.setAttribute('aria-label', custom ? 'Mostrar barra original' : 'Mostrar barra TicketHelper');
    toggle.title = custom ? 'Mostrar barra original' : 'Mostrar barra TicketHelper';
    toggle.querySelector('circle')?.setAttribute('cx', custom ? '21' : '11');
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  const observer = new MutationObserver(records => {
    if (location.pathname !== ticketPath || records.some(record => [...record.addedNodes].some(node =>
      node.nodeType === 1 && (
        node.matches?.('[data-test-id="toolbar-settings"], [data-test-id="macros-menu-dropdown"], [data-ticket-helper-toolbar-toggle], [data-test-id="dynamic-resizable-reply-wrapper"]') ||
        node.querySelector?.('[data-test-id="toolbar-settings"], [data-test-id="macros-menu-dropdown"]')
      )
    ))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  schedule();
})();
