(() => {
  'use strict';
  if (globalThis.__ticketHelperDiscordSlateAdapter) return;
  globalThis.__ticketHelperDiscordSlateAdapter = true;

  const isEditor = value => value && Array.isArray(value.children) &&
    value.selection && typeof value.deleteBackward === 'function' &&
    typeof value.insertData === 'function';

  function findEditor(field) {
    for (let element = field; element; element = element.parentElement) {
      const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
      if (!key) continue;
      for (let fiber = element[key], depth = 0; fiber && depth < 100; fiber = fiber.return, depth++) {
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          if (isEditor(props?.editor)) return props.editor;
        }
        for (let hook = fiber.memoizedState, count = 0;
          hook && count < 30; hook = hook.next, count++) {
          if (isEditor(hook.memoizedState)) return hook.memoizedState;
          if (isEditor(hook.memoizedState?.editor)) return hook.memoizedState.editor;
        }
      }
    }
    return null;
  }

  function selectedLeaf(editor, abbreviation) {
    const { anchor, focus } = editor.selection || {};
    if (!anchor || !focus || !Array.isArray(anchor.path) || !Array.isArray(focus.path) ||
        anchor.offset < abbreviation.length || anchor.offset !== focus.offset ||
        anchor.path.join(',') !== focus.path.join(',')) return false;
    let node = editor;
    for (const index of anchor.path) node = node?.children?.[index];
    return typeof node?.text === 'string' &&
      node.text.slice(anchor.offset - abbreviation.length, anchor.offset) === abbreviation;
  }

  document.addEventListener('tickethelper:discord-slate-insert', event => {
    const field = event.target;
    const { abbreviation, text } = event.detail || {};
    if (!(field instanceof Element) || field.getAttribute('data-slate-editor') !== 'true' ||
        document.activeElement !== field || typeof abbreviation !== 'string' ||
        !abbreviation || abbreviation.length > 50 || typeof text !== 'string' || !text) return;
    const editor = findEditor(field);
    if (!editor || !selectedLeaf(editor, abbreviation)) return;
    try {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      for (const _character of Array.from(abbreviation))
        editor.deleteBackward({ unit: 'character' });
      editor.insertData(transfer);
      event.preventDefault();
    } catch (error) {
      // The editor's own operations must succeed; never fall back to DOM-only
      // insertion, which can leave visible but unsendable text behind.
      console.warn('TicketHelper: Discord macro insertion failed', error);
    }
  }, true);
})();
