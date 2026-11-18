(() => {
  'use strict';
  if (globalThis.TicketHelperMacroAutofillFinal) return;
  const core = globalThis.TicketHelperMacroAutofillCore;

  function visible(node) {
    return !!node?.isConnected && !!node.getClientRects().length &&
      !node.closest('[aria-hidden="true"]');
  }

  function waitFor(find, timeoutMs = 1500, watchFocus = false) {
    const current = find();
    if (current) return Promise.resolve(current);
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const value = find();
        if (!value) return;
        observer.disconnect();
        clearTimeout(timeout);
        resolve(value);
      });
      observer.observe(document.documentElement, {
        childList: true, characterData: true, attributes: true, subtree: true,
        attributeFilter: watchFocus
          ? ['aria-disabled', 'aria-activedescendant', 'class', 'disabled']
          : ['aria-disabled', 'disabled']
      });
      const timeout = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  function enabled(node) {
    return visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  }

  async function chooseDropdown(dialog, testId, optionValue, guard, fail = () => {}) {
    const fieldButton = () => dialog.querySelector(
      `[data-test-id="${testId}"] button[data-dropdown="true"]`);
    const ownedMenu = () => document.getElementById(
      fieldButton()?.getAttribute('aria-owns'));
    const searchInput = () => ownedMenu()?.querySelector('input[type="search"][role="combobox"]');
    const selected = () => {
      // HubSpot may replace the Select button after an option is clicked.
      // Read the live control instead of the button that opened the menu.
      const control = fieldButton();
      return control?.querySelector('[data-option-value]')?.getAttribute(
        'data-option-value')?.toLocaleLowerCase() === optionValue.toLocaleLowerCase() ||
        control?.textContent?.trim().toLocaleLowerCase() === optionValue.toLocaleLowerCase();
    };
    const button = await waitFor(() => {
      const control = fieldButton();
      return enabled(control) ? control : null;
    }, 2500);
    if (!guard() || !button) { fail('CAMPO_INDISPONIVEL'); return false; }
    if (selected()) return true;
    button.click();
    const search = await waitFor(() => {
      const input = searchInput();
      return enabled(input) ? input : null;
    }, 2500);
    if (!guard()) { fail('TICKET_MUDOU'); return false; }
    if (!search || !enterValue(search, optionValue)) {
      fail('BUSCA_INDISPONIVEL'); return false;
    }
    const matching = await waitFor(() => {
      const menu = ownedMenu();
      const input = searchInput();
      if (!menu || input?.value !== optionValue) return null;
      const options = [...menu.querySelectorAll('.Select-option [data-option-value]')];
      const focused = options.find(node => {
        const row = node.closest('.Select-option');
        return row?.classList.contains('is-focused') ||
          row?.id === input.getAttribute('aria-activedescendant');
      });
      return focused?.getAttribute('data-option-value')?.toLocaleLowerCase() ===
        optionValue.toLocaleLowerCase() ? input : null;
    }, 2500, true);
    if (!guard()) { fail('TICKET_MUDOU'); return false; }
    if (!matching) { fail('OPCAO_NAO_ENCONTRADA'); return false; }
    matching.focus();
    matching.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    matching.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    const confirmed = !!await waitFor(() => selected() ? fieldButton() : null, 2500);
    if (!confirmed) fail('SELECAO_NAO_CONFIRMADA');
    return confirmed;
  }

  function enterValue(field, value) {
    if (!enabled(field)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(
      field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value');
    if (!descriptor?.set) return false;
    field.focus();
    descriptor.set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field.value === value;
  }

  function confirmReturnDate(field) {
    field.focus();
    for (const type of ['keydown', 'keyup']) {
      field.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
    field.blur();
  }

  function returnDateMatches(field, formatted) {
    const actual = field?.value?.trim();
    if (actual === formatted) return true;
    // HubSpot may add its own relative-date hint to both format and value.
    // Require that exact hint so a different date cannot pass verification.
    const format = field?.getAttribute('data-format') || field?.placeholder || '';
    const hint = format.match(
      /^(?:MM\/DD\/YYYY|DD\/MM\/(?:YYYY|AAAA))\s+\[([^\]]+)\]$/i)?.[1];
    return !!hint && actual === `${formatted} ${hint}`;
  }

  async function enterReturnDate(dialog, action, guard, fail) {
    const selector = '[data-test-id="hs_pipeline_stage-return_date"] input';
    const diagnosis = expected => {
      const input = dialog.querySelector(selector);
      return { field: !!input, wrapper: !!dialog.querySelector(
        '[data-test-id="hs_pipeline_stage-return_date"]'),
      format: input?.getAttribute('data-format') || input?.placeholder || null,
      actual: input?.value ?? null, expected: expected ?? null,
      connected: !!input?.isConnected, visible: visible(input) };
    };
    const field = await waitFor(() => {
      const input = dialog.querySelector(selector);
      return enabled(input) ? input : null;
    }, 2500);
    if (!guard()) { fail('DATA_RETORNO_TICKET_MUDOU', diagnosis()); return null; }
    if (!field) { fail('DATA_RETORNO_CAMPO_INDISPONIVEL', diagnosis()); return null; }
    const formatted = core.formatReturnDate(core.returnDateForAction(action),
      field.getAttribute('data-format') || field.placeholder);
    if (!formatted) { fail('DATA_RETORNO_FORMATO_DESCONHECIDO', diagnosis()); return null; }

    // HubSpot can replace its controlled date input after the pending-type choice.
    // Confirm the live input after blur, then use browser text insertion if its
    // React/date-mask handler rejected a single programmatic input event.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = dialog.querySelector(selector);
      if (!guard()) { fail('DATA_RETORNO_TICKET_MUDOU', diagnosis(formatted)); return null; }
      if (!enabled(current)) {
        fail('DATA_RETORNO_CAMPO_INDISPONIVEL', diagnosis(formatted)); return null;
      }
      if (!returnDateMatches(current, formatted)) {
        if (attempt === 0) {
          enterValue(current, formatted);
        } else {
          current.focus();
          current.select();
          let inserted = false;
          try { inserted = !!document.execCommand?.('insertText', false, formatted); }
          catch { /* Fall back to the native setter below. */ }
          if (inserted) {
            current.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            enterValue(current, formatted);
          }
        }
      }
      confirmReturnDate(current);
      await new Promise(resolve => setTimeout(resolve, 80));
      if (returnDateMatches(dialog.querySelector(selector), formatted)) return formatted;
    }
    fail('DATA_RETORNO_VALOR_REJEITADO', diagnosis(formatted));
    return null;
  }

  async function fillDialog(dialog, action, guard, fail = () => {}, mode = 'send') {
    const config = core.FINAL_ACTIONS[action];
    const submitLabel = core.FINAL_SUBMIT_LABELS[mode];
    if (!config || !guard() || !visible(dialog)) {
      fail('PAINEL_INDISPONIVEL'); return false;
    }
    const status = await waitFor(() => {
      const stage = dialog.querySelector('[data-test-id="hs_pipeline_stage"]');
      return stage?.querySelector('button[data-dropdown="true"] [data-test-id="badge"]')
        ?.textContent?.trim() === config.status ? stage : null;
    }, 2500);
    if (!guard() || !status) {
      fail('STATUS_INCORRETO'); return false;
    }
    let expectedDate = null;
    if (config.solution) {
      if (!await chooseDropdown(dialog, 'hs_pipeline_stage-solution_type',
        config.solution, guard, reason => fail(`TIPO_SOLUCAO_${reason}`))) return false;
      const details = await waitFor(() => {
        const field = dialog.querySelector(
          '[data-test-id="hs_pipeline_stage-support_pending_item_information"] textarea');
        return enabled(field) ? field : null;
      }, 2500);
      if (!guard() || !enterValue(details, 'Ok')) {
        fail('INFORMACOES_PENDENCIA'); return false;
      }
      if (!await chooseDropdown(dialog, 'hs_pipeline_stage-support_pending_item_validation',
        'ok', guard, reason => fail(`VALIDACAO_PENDENCIA_${reason}`))) return false;
    } else {
      if (!await chooseDropdown(dialog, 'hs_pipeline_stage-pending_type',
        config.pendingType, guard, reason => fail(`TIPO_PENDENCIA_${reason}`))) return false;
      expectedDate = await enterReturnDate(dialog, action, guard, fail);
      if (!expectedDate) return false;
    }
    const apply = await waitFor(() => {
      const button = dialog.querySelector('button[type="submit"]');
      return enabled(button) && button.textContent.trim() === submitLabel ? button : null;
    });
    if (!guard() || !apply) { fail('APPLY_INDISPONIVEL'); return false; }
    const valueOf = testId => dialog.querySelector(
      `[data-test-id="${testId}"] button[data-dropdown="true"]`)?.textContent?.trim();
    if (status.querySelector('button[data-dropdown="true"] [data-test-id="badge"]')
      ?.textContent?.trim() !== config.status || (config.solution ?
      valueOf('hs_pipeline_stage-solution_type') !== config.solution ||
      dialog.querySelector('[data-test-id="hs_pipeline_stage-support_pending_item_information"] textarea')
        ?.value !== 'Ok' ||
      valueOf('hs_pipeline_stage-support_pending_item_validation') !== 'Ok' :
      valueOf('hs_pipeline_stage-pending_type') !== config.pendingType ||
      !returnDateMatches(dialog.querySelector(
        '[data-test-id="hs_pipeline_stage-return_date"] input'), expectedDate))) {
      fail('VALORES_NAO_CONFIRMADOS'); return false;
    }
    apply.focus();
    // HubSpot may restore focus to the opened menu after the fields settle.
    // Recheck the live submit control on the next paint before handing off to Enter.
    await new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
      else resolve();
    });
    const liveApply = dialog.querySelector('button[type="submit"]');
    if (!guard() || !enabled(liveApply) || liveApply.textContent.trim() !== submitLabel) {
      fail('FOCO_APPLY'); return false;
    }
    liveApply.focus();
    if (document.activeElement !== liveApply) { fail('FOCO_APPLY'); return false; }
    return true;
  }

  function reportFailure(action, code, detail = null, mode = 'send') {
    const submitLabel = core.FINAL_SUBMIT_LABELS[mode] || 'Apply';
    const labels = {
      MENU_INDISPONIVEL: 'botão de opções de envio indisponível',
      MENU_STATUS_INDISPONIVEL: 'menu de status do ticket indisponível',
      ETIQUETA_NAO_REMOVIDA: 'etiqueta não pôde ser removida do editor',
      OPCAO_ENVIO: 'opção de envio não encontrada',
      OPCAO_STATUS: 'status do ticket não encontrado no menu',
      PAINEL_INDISPONIVEL: 'painel de propriedades não abriu',
      STATUS_INCORRETO: 'status do painel diferente do esperado',
      INFORMACOES_PENDENCIA: 'não foi possível preencher Informações de pendência',
      DATA_RETORNO_CAMPO_INDISPONIVEL: 'campo Data de retorno indisponível',
      DATA_RETORNO_FORMATO_DESCONHECIDO: 'formato de Data de retorno desconhecido',
      DATA_RETORNO_TICKET_MUDOU: 'ticket mudou durante Data de retorno',
      DATA_RETORNO_VALOR_REJEITADO: 'HubSpot não aceitou Data de retorno',
      APPLY_INDISPONIVEL: `botão ${submitLabel} não ficou disponível`,
      VALORES_NAO_CONFIRMADOS: 'campos não mantiveram os valores escolhidos',
      FOCO_APPLY: `não foi possível focar ${submitLabel}`
    };
    const prefix = code.startsWith('TIPO_SOLUCAO_') ? 'Tipo de solução' :
      code.startsWith('VALIDACAO_PENDENCIA_') ? 'Validação de pendência' :
      code.startsWith('TIPO_PENDENCIA_') ? 'Tipo de pendência' : null;
    const reason = code.endsWith('OPCAO_NAO_ENCONTRADA') ? 'opção não encontrada' :
      code.endsWith('BUSCA_INDISPONIVEL') ? 'busca do menu indisponível' :
      code.endsWith('SELECAO_NAO_CONFIRMADA') ? 'seleção não confirmada' :
      code.endsWith('CAMPO_INDISPONIVEL') ? 'campo indisponível' :
      code.endsWith('OPCAO_DESABILITADA') ? 'opção desabilitada' :
      code.endsWith('TICKET_MUDOU') ? 'ticket mudou' : null;
    const displayDetail = prefix ? `${prefix}: ${reason || code}` : labels[code] || code;
    console.warn(`[TicketHelper] MacroAction ${action}: ${code}` +
      (detail ? ` ${JSON.stringify(detail)}` : ''));
    try {
      chrome.runtime.sendMessage({ action: 'SHOW_MACRO_FINAL_WARNING',
        code, text: `MacroAction: ${displayDetail}` })?.catch?.(() => {});
    } catch { /* Console warning remains available when the worker is unavailable. */ }
  }

  async function run(editor, action, guard, removeLabel, mode = 'send') {
    const config = core.FINAL_ACTIONS[action];
    const composer = editor?.closest('[data-test-id="dynamic-resizable-reply-wrapper"]');
    const statusOnly = mode === 'status';
    if (!config || !composer || !guard() ||
        !editor.matches('[contenteditable="true"], [contenteditable=""]')) {
      if (config && guard()) reportFailure(action, 'MENU_INDISPONIVEL', null, mode);
      return false;
    }
    // A new attachment preview can appear while its upload still disables Send.
    // In that send path, wait for More send options. An empty composer instead
    // uses the ticket header's status menu without sending a message.
    const menu = await waitFor(() => {
      if (!guard()) return null;
      if (statusOnly) {
        const buttons = [...document.querySelectorAll(
          '[data-test-id="ticket-header-stage-dropdown"] button[data-dropdown="true"]')]
          .filter(enabled);
        return buttons.length === 1 ? buttons[0] : null;
      }
      const button = composer.querySelector('button[data-test-id="reply-submit-more-options"]');
      return enabled(button) ? button : null;
    }, statusOnly ? 2500 : 5000);
    if (!menu || !guard()) {
      if (guard()) reportFailure(action,
        statusOnly ? 'MENU_STATUS_INDISPONIVEL' : 'MENU_INDISPONIVEL', null, mode);
      return false;
    }
    const restore = removeLabel();
    if (!restore) { reportFailure(action, 'ETIQUETA_NAO_REMOVIDA', null, mode); return false; }
    let dialog = null;
    let succeeded = false;
    let failedStep = statusOnly ? 'OPCAO_STATUS' : 'OPCAO_ENVIO';
    let failureDetail = null;
    try {
      if (!guard()) return false;
      if (!statusOnly || menu.getAttribute('data-dropdown-open') !== 'true') menu.click();
      const menuId = menu.getAttribute('aria-owns');
      if (statusOnly) {
        const search = await waitFor(() => {
          const input = document.getElementById(menuId)
            ?.querySelector('input[type="search"][role="combobox"]');
          return enabled(input) ? input : null;
        });
        if (!guard() || !search || !enterValue(search, config.status)) return false;
        const focused = await waitFor(() => {
          const owned = document.getElementById(menuId);
          if (!visible(owned) || search.value !== config.status) return null;
          const options = [...owned.querySelectorAll('.Select-option')]
            .filter(row => visible(row) &&
              row.querySelector('[data-test-id="badge"]')?.textContent?.trim() === config.status);
          return options.length === 1 &&
            (options[0].classList.contains('is-focused') ||
              options[0].id === search.getAttribute('aria-activedescendant')) ? search : null;
        }, 2500, true);
        if (!guard() || !focused) return false;
        focused.focus();
        for (const type of ['keydown', 'keyup']) {
          focused.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          }));
        }
      } else {
        const choice = await waitFor(() => {
          const owned = menuId && document.getElementById(menuId);
          if (!visible(owned)) return null;
          const options = [...owned.querySelectorAll('button[role="menuitem"]')]
            .filter(button => enabled(button) &&
              button.textContent.trim() === `Send and set to ${config.status}`);
          return options.length === 1 ? options[0] : null;
        });
        if (!guard() || !choice) return false;
        choice.click();
      }
      failedStep = 'PAINEL_INDISPONIVEL';
      dialog = await waitFor(() => [...document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]')]
        .find(node => visible(node) && node.querySelector('[data-test-id="hs_pipeline_stage"]')));
      if (!dialog || !guard()) return false;
      succeeded = await fillDialog(dialog, action, guard, (code, detail) => {
        failedStep = code;
        failureDetail = detail;
      }, mode);
      return succeeded;
    } catch {
      failedStep = 'FALHA_INESPERADA';
      return false;
    } finally {
      if (!succeeded) {
        dialog?.querySelector('[data-panel-close-button="true"]')?.click();
        if (!dialog && menu.getAttribute('data-dropdown-open') === 'true') menu.click();
        restore();
        if (guard()) reportFailure(action, failedStep, failureDetail, mode);
      }
    }
  }

  globalThis.TicketHelperMacroAutofillFinal = { run };
})();
