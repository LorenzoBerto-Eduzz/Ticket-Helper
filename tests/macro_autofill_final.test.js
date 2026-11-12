const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../project/macro_autofill_core.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'project',
  'macro_autofill_final.js'), 'utf8');
const autofillSource = fs.readFileSync(path.join(__dirname, '..', 'project',
  'macro_autofill.js'), 'utf8');

test('all eight final actions retain their exact HubSpot choices and dates', () => {
  const expected = {
    solveResolved: { status: 'Solucionado', solution: 'Resolvido' },
    solveNoInteraction: { status: 'Solucionado', solution: 'Sem interação' },
    waitCustomer3Business: {
      status: 'Pendente', pendingType: 'Aguardando cliente', businessDays: 3
    },
    waitCustomerWeek: { status: 'Pendente', pendingType: 'Aguardando cliente', days: 7 },
    waitProducer3Business: {
      status: 'Pendente', pendingType: 'Aguardando produtor', businessDays: 3
    },
    waitProducerWeek: { status: 'Pendente', pendingType: 'Aguardando produtor', days: 7 },
    waitInternal3Business: {
      status: 'Pendente', pendingType: 'Aguardando tecnologia', businessDays: 3
    },
    waitInternalWeek: { status: 'Pendente', pendingType: 'Aguardando tecnologia', days: 7 }
  };
  assert.deepEqual(core.FINAL_ACTIONS, expected);
});

test('final dialog keeps its ticket guard after the modal takes focus', () => {
  const start = autofillSource.indexOf('function sameTicketDuringFinalDialog(');
  const end = autofillSource.indexOf('function textPosition(', start);
  const context = { document: { visibilityState: 'visible', hasFocus: () => false },
    ticketId: () => 'ticket_1',
    TicketHelperMacroContext: () => ({ ready: false, ticketId: 'ticket_1', ownerEpoch: 3 }) };
  context.globalThis = context;
  const guard = vm.runInNewContext(`${autofillSource.slice(start, end)}\n` +
    'sameTicketDuringFinalDialog', context);
  assert.equal(guard({ isConnected: true }, 'ticket_1', 3), true);
  assert.equal(guard({ isConnected: true }, 'ticket_2', 3), false);
  assert.equal(guard({ isConnected: true }, 'ticket_1', 4), false);
  context.document.visibilityState = 'hidden';
  assert.equal(guard({ isConnected: true }, 'ticket_1', 3), false);
});

test('a dropdown already displaying Ok satisfies the internal ok value', async () => {
  const start = source.indexOf('async function chooseDropdown(');
  const end = source.indexOf('function enterValue(', start);
  let clicks = 0;
  const button = { textContent: 'Ok', getAttribute: () => null,
    querySelector: () => ({ getAttribute: () => 'ok' }), click() { clicks++; } };
  const context = { enabled: () => true, visible: () => true,
    waitFor: async find => find(), document: { getElementById: () => null } };
  const choose = vm.runInNewContext(`${source.slice(start, end)}\nchooseDropdown`, context);
  assert.equal(await choose({ querySelector: () => button }, 'validation', 'ok', () => true), true);
  assert.equal(clicks, 0);
});

test('dependent dropdowns search their exact label and confirm it with Enter', async () => {
  const start = source.indexOf('async function chooseDropdown(');
  const end = source.indexOf('function enterValue(', start);
  const chooseSource = `${source.slice(start, end)}\nchooseDropdown`;
  for (const value of ['Resolvido', 'Sem interação', 'Ok', 'Aguardando produtor']) {
    let currentButton;
    let typed = '';
    const oldButton = { textContent: '', getAttribute: () => 'owned-menu',
      querySelector: () => null, click() {} };
    const newButton = { textContent: value, getAttribute: () => 'owned-menu',
      querySelector: () => ({ getAttribute: () => value }) };
    currentButton = oldButton;
    const search = { value: '', getAttribute: () => 'result-1', focus() {},
      dispatchEvent(event) {
        if (event.type === 'keydown' && event.key === 'Enter') currentButton = newButton;
      } };
    const option = { getAttribute: () => value,
      closest: () => ({ id: 'result-1', classList: { contains: () => true } }) };
    const owned = { querySelector: () => search,
      querySelectorAll: () => typed ? [option] : [] };
    const context = { enabled: () => true, waitFor: async find => find(),
      enterValue: (_input, text) => { typed = text; search.value = text; return true; },
      KeyboardEvent: class { constructor(type, options) { this.type = type; this.key = options.key; } },
      document: { getElementById: () => owned } };
    const choose = vm.runInNewContext(chooseSource, context);
    assert.equal(await choose({ querySelector: () => currentButton }, 'field', value,
      () => true), true, value);
    assert.equal(typed, value);
    assert.equal(currentButton, newButton);
  }
});

test('a missing solution choice reports the exact failed step', async () => {
  const start = source.indexOf('async function chooseDropdown(');
  const end = source.indexOf('function enterValue(', start);
  const button = { textContent: '', getAttribute: () => 'owned-menu',
    querySelector: () => null, click() {} };
  const reasons = [];
  const search = { value: '', focus() {} };
  const context = { enabled: () => true,
    enterValue: (_input, text) => { search.value = text; return true; },
    waitFor: async find => find(), document: {
      getElementById: () => ({ querySelector: () => search, querySelectorAll: () => [] })
    } };
  const choose = vm.runInNewContext(`${source.slice(start, end)}\nchooseDropdown`, context);
  assert.equal(await choose({ querySelector: () => button }, 'solution', 'Resolvido',
    () => true, reason => reasons.push(reason)), false);
  assert.deepEqual(reasons, ['OPCAO_NAO_ENCONTRADA']);
});

test('solved actions fill the exact solution and leave Apply for the user', async () => {
  const start = source.indexOf('async function fillDialog(');
  const end = source.indexOf('async function run(', start);
  const actions = [];
  const apply = { textContent: 'Apply', focus() { context.document.activeElement = this; } };
  const details = {};
  let statusReady = false;
  const stage = { querySelector: () => ({ textContent: statusReady ? 'Solucionado' : '' }) };
  const fields = {
    '[data-test-id="hs_pipeline_stage"]': stage,
    '[data-test-id="hs_pipeline_stage-support_pending_item_information"] textarea': details,
    '[data-test-id="hs_pipeline_stage-solution_type"] button[data-dropdown="true"]':
      { textContent: 'Sem interação' },
    '[data-test-id="hs_pipeline_stage-support_pending_item_validation"] button[data-dropdown="true"]':
      { textContent: 'Ok' },
    'button[type="submit"]': apply
  };
  const dialog = { querySelector: selector => fields[selector] || null };
  const context = { core, visible: () => true, enabled: () => true,
    document: { activeElement: null },
    chooseDropdown: async (_dialog, id, value) => { actions.push([id, value]); return true; },
    enterValue: (field, value) => { field.value = value; actions.push(['text', value]); return true; },
    waitFor: async find => {
      let result = find();
      if (!result) { statusReady = true; result = find(); }
      return result;
    } };
  const fill = vm.runInNewContext(`${source.slice(start, end)}\nfillDialog`, context);
  assert.equal(await fill(dialog, 'solveNoInteraction', () => true), true);
  assert.deepEqual(actions, [
    ['hs_pipeline_stage-solution_type', 'Sem interação'],
    ['text', 'Ok'],
    ['hs_pipeline_stage-support_pending_item_validation', 'ok']
  ]);
  assert.equal(context.document.activeElement, apply);
  assert.equal(statusReady, true);
});

test('pending actions choose the correct recipient and formatted return date', async () => {
  const start = source.indexOf('async function fillDialog(');
  const end = source.indexOf('async function run(', start);
  const actions = [];
  const field = { placeholder: 'DD/MM/AAAA',
    getAttribute: () => 'DD/MM/AAAA', blur() { actions.push('blur'); } };
  const apply = { textContent: 'Apply', focus() { context.document.activeElement = this; } };
  const fields = {
    '[data-test-id="hs_pipeline_stage"]':
      { querySelector: () => ({ textContent: 'Pendente' }) },
    '[data-test-id="hs_pipeline_stage-return_date"] input': field,
    '[data-test-id="hs_pipeline_stage-pending_type"] button[data-dropdown="true"]':
      { textContent: 'Aguardando tecnologia' },
    'button[type="submit"]': apply
  };
  const context = { core: { ...core,
    returnDateForAction: () => new Date(2026, 10, 18) },
    visible: () => true, enabled: () => true, document: { activeElement: null },
    chooseDropdown: async (_dialog, id, value) => { actions.push([id, value]); return true; },
    enterValue: (target, value) => { target.value = value; actions.push(['date', value]); return true; },
    waitFor: async find => find() };
  const fill = vm.runInNewContext(`${source.slice(start, end)}\nfillDialog`, context);
  assert.equal(await fill({ querySelector: selector => fields[selector] || null },
    'waitInternal3Business', () => true), true);
  assert.deepEqual(actions, [
    ['hs_pipeline_stage-pending_type', 'Aguardando tecnologia'],
    ['date', '18/11/2026'], 'blur'
  ]);
  assert.equal(context.document.activeElement, apply);
});

test('final action removes its label before opening send and restores it on panel failure', async () => {
  const start = source.indexOf('async function run(');
  const end = source.indexOf('globalThis.TicketHelperMacroAutofillFinal', start);
  const steps = [];
  const menu = { getAttribute: key => key === 'aria-owns' ? 'send-menu' : 'false',
    click() { steps.push('menu'); } };
  const owned = { querySelectorAll: () => [{ textContent: 'Send and set to Pendente',
    click() { steps.push('choice'); } }] };
  const editor = { matches: () => true, closest: () => ({ querySelector: () => menu }) };
  const context = { core, enabled: () => true, visible: () => true,
    document: { getElementById: () => owned, querySelectorAll: () => [] },
    waitFor: async find => find(), fillDialog: async () => false,
    reportFailure: (_action, code) => steps.push(`warning:${code}`) };
  const run = vm.runInNewContext(`${source.slice(start, end)}\nrun`, context);
  const result = await run(editor, 'waitCustomerWeek', () => true,
    () => { steps.push('remove'); return () => steps.push('restore'); });
  assert.equal(result, false);
  assert.deepEqual(steps, ['remove', 'menu', 'choice', 'restore',
    'warning:PAINEL_INDISPONIVEL']);
});

test('a prepared final action leaves the dependent panel open without pressing Apply', async () => {
  const start = source.indexOf('async function run(');
  const end = source.indexOf('globalThis.TicketHelperMacroAutofillFinal', start);
  const steps = [];
  const menu = { getAttribute: key => key === 'aria-owns' ? 'send-menu' : 'false',
    click() { steps.push('menu'); } };
  const owned = { querySelectorAll: () => [{ textContent: 'Send and set to Solucionado',
    click() { steps.push('choice'); } }] };
  const dialog = { querySelector: () => null };
  const editor = { matches: () => true, closest: () => ({ querySelector: () => menu }) };
  const context = { core, enabled: () => true, visible: () => true,
    document: { getElementById: () => owned, querySelectorAll: () => [dialog] },
    waitFor: async find => find(), fillDialog: async () => { steps.push('fill'); return true; } };
  dialog.querySelector = () => ({});
  const run = vm.runInNewContext(`${source.slice(start, end)}\nrun`, context);
  assert.equal(await run(editor, 'solveResolved', () => true,
    () => { steps.push('remove'); return () => steps.push('restore'); }), true);
  assert.deepEqual(steps, ['remove', 'menu', 'choice', 'fill']);
});
