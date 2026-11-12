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
          ? ['aria-disabled', 'aria-activedescendant', 'class'] : ['aria-disabled']
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

  async function fillDialog(dialog, action, guard, fail = () => {}) {
    const config = core.FINAL_ACTIONS[action];
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
      const field = await waitFor(() => {
        const input = dialog.querySelector('[data-test-id="hs_pipeline_stage-return_date"] input');
        return enabled(input) ? input : null;
      }, 2500);
      const date = core.returnDateForAction(action);
      const formatted = core.formatReturnDate(date,
        field?.getAttribute('data-format') || field?.placeholder);
      if (!formatted || !guard() || !enterValue(field, formatted)) {
        fail('DATA_RETORNO'); return false;
      }
      expectedDate = formatted;
      field.blur();
    }
    const apply = await waitFor(() => {
      const button = dialog.querySelector('button[type="submit"]');
      return enabled(button) && button.textContent.trim() === 'Apply' ? button : null;
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
      dialog.querySelector('[data-test-id="hs_pipeline_stage-return_date"] input')
        ?.value !== expectedDate)) { fail('VALORES_NAO_CONFIRMADOS'); return false; }
    apply.focus();
    if (document.activeElement !== apply) { fail('FOCO_APPLY'); return false; }
    return true;
  }

  function reportFailure(action, code) {
    const labels = {
      MENU_INDISPONIVEL: 'botão de opções de envio indisponível',
      ETIQUETA_NAO_REMOVIDA: 'etiqueta não pôde ser removida do editor',
      OPCAO_ENVIO: 'opção de envio não encontrada',
      PAINEL_INDISPONIVEL: 'painel de propriedades não abriu',
      STATUS_INCORRETO: 'status do painel diferente do esperado',
      INFORMACOES_PENDENCIA: 'não foi possível preencher Informações de pendência',
      DATA_RETORNO: 'não foi possível preencher Data de retorno',
      APPLY_INDISPONIVEL: 'botão Apply não ficou disponível',
      VALORES_NAO_CONFIRMADOS: 'campos não mantiveram os valores escolhidos',
      FOCO_APPLY: 'não foi possível focar Apply'
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
    const detail = prefix ? `${prefix}: ${reason || code}` : labels[code] || code;
    console.warn(`[TicketHelper] MacroAction ${action}: ${code}`);
    try {
      chrome.runtime.sendMessage({ action: 'SHOW_MACRO_FINAL_WARNING',
        code, text: `MacroAction: ${detail}` })?.catch?.(() => {});
    } catch { /* Console warning remains available when the worker is unavailable. */ }
  }

  async function run(editor, action, guard, removeLabel) {
    const config = core.FINAL_ACTIONS[action];
    const composer = editor?.closest('[data-test-id="dynamic-resizable-reply-wrapper"]');
    const menu = composer?.querySelector('button[data-test-id="reply-submit-more-options"]');
    if (!config || !composer || !guard() || !enabled(menu) ||
        !editor.matches('[contenteditable="true"], [contenteditable=""]')) {
      if (config && guard()) reportFailure(action, 'MENU_INDISPONIVEL');
      return false;
    }
    const restore = removeLabel();
    if (!restore) { reportFailure(action, 'ETIQUETA_NAO_REMOVIDA'); return false; }
    let dialog = null;
    let succeeded = false;
    let failedStep = 'OPCAO_ENVIO';
    try {
      if (!guard()) return false;
      menu.click();
      const menuId = menu.getAttribute('aria-owns');
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
      failedStep = 'PAINEL_INDISPONIVEL';
      dialog = await waitFor(() => [...document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]')]
        .find(node => visible(node) && node.querySelector('[data-test-id="hs_pipeline_stage"]')));
      if (!dialog || !guard()) return false;
      succeeded = await fillDialog(dialog, action, guard, code => { failedStep = code; });
      return succeeded;
    } catch {
      failedStep = 'FALHA_INESPERADA';
      return false;
    } finally {
      if (!succeeded) {
        dialog?.querySelector('[data-panel-close-button="true"]')?.click();
        if (!dialog && menu.getAttribute('data-dropdown-open') === 'true') menu.click();
        restore();
        if (guard()) reportFailure(action, failedStep);
      }
    }
  }

  globalThis.TicketHelperMacroAutofillFinal = { run };
})();
