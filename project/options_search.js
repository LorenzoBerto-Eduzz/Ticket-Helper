(() => {
  'use strict';
  const search = globalThis.TicketHelperSearchFilterCore;
  if (!search) return;

  for (const listId of ['macro-library-list', 'macro-autofill-list', 'producer-notes-list']) {
    const list = document.getElementById(listId);
    const card = list?.closest('.card');
    const control = card?.querySelector(`.section-search[data-search-list="${listId}"]`);
    if (!list || !control) continue;
    const input = control.querySelector('.section-search-input');
    const button = control.querySelector('.section-search-button');
    const title = card.querySelector('h2');
    let applied = '';
    let available = 36;

    function measureWidth() {
      const titleText = document.createRange();
      titleText.selectNodeContents(title);
      available = Math.max(36,
        Math.floor(button.getBoundingClientRect().left - titleText.getBoundingClientRect().right - 12));
      updateWidth();
    }

    function updateWidth() {
      input.style.maxWidth = `${available}px`;
      input.style.width = `calc(${Math.max(12, [...input.value].length)}ch + 14px)`;
    }

    function values(row) {
      return [...row.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]')]
        .map(field => field.isContentEditable ? field.innerText : field.value);
    }

    function filterRows(resetScroll = false) {
      for (const row of list.children) row.hidden = !search.matches(applied, values(row));
      if (resetScroll) list.scrollTop = 0;
      list.dispatchEvent(new Event('tickethelper:filter-changed'));
    }

    function submit() {
      applied = input.value.trim();
      control.classList.toggle('is-active', !!applied);
      filterRows(true);
      updateWidth();
    }

    input.addEventListener('input', updateWidth);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() !== applied) submit();
    });
    button.addEventListener('click', () => {
      if (input.value.trim() !== applied) submit();
      input.focus();
    });
    card.querySelector('.section-add-row')?.addEventListener('click', () => {
      if (!applied) return;
      applied = '';
      input.value = '';
      control.classList.remove('is-active');
      filterRows();
      updateWidth();
    }, true);
    new MutationObserver(() => filterRows()).observe(list, { childList: true });
    window.addEventListener('resize', measureWidth);
    measureWidth();
  }
})();
