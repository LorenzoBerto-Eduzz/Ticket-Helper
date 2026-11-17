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
const toolbarSource = fs.readFileSync(path.join(__dirname, '..', 'project',
  'hubspot_toolbar.js'), 'utf8');

test('direct final buttons keep the requested order and action mapping', () => {
  const start = toolbarSource.indexOf('const FINAL_BUTTONS = [');
  const end = toolbarSource.indexOf('let mode =', start);
  const buttons = vm.runInNewContext(`${toolbarSource.slice(start, end)}\nFINAL_BUTTONS`, {});
  assert.deepEqual(JSON.parse(JSON.stringify(buttons.map(([label, action]) => [label, action]))), [
    ['SI', 'solveNoInteraction'], ['SR', 'solveResolved'],
    ['I3', 'waitInternal3Business'], ['I1', 'waitInternal1Business'],
    ['P7', 'waitProducerWeek'], ['P3', 'waitProducer3Business'],
    ['C7', 'waitCustomerWeek'], ['C3', 'waitCustomer3Business']
  ]);
  assert.deepEqual(core.ACTIONS.filter(action => action.id.startsWith('waitInternal'))
    .map(action => action.id), ['waitInternal3Business', 'waitInternal1Business']);
});

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
    waitInternal1Business: {
      status: 'Pendente', pendingType: 'Aguardando aprovação', businessDays: 1
    },
    waitInternal3Business: {
      status: 'Pendente', pendingType: 'Aguardando aprovação', businessDays: 3
    }
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
    requestAnimationFrame: callback => { context.document.activeElement = null; callback(); },
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
    getAttribute: () => 'DD/MM/AAAA [(3 days from now)]',
    blur() { actions.push('blur'); } };
  const apply = { textContent: 'Apply', focus() { context.document.activeElement = this; } };
  const fields = {
    '[data-test-id="hs_pipeline_stage"]':
      { querySelector: () => ({ textContent: 'Pendente' }) },
    '[data-test-id="hs_pipeline_stage-return_date"] input': field,
    '[data-test-id="hs_pipeline_stage-pending_type"] button[data-dropdown="true"]':
      { textContent: 'Aguardando aprovação' },
    'button[type="submit"]': apply
  };
  const context = { core: { ...core,
    returnDateForAction: () => new Date(2026, 10, 18) },
    visible: () => true, enabled: () => true, document: { activeElement: null },
    requestAnimationFrame: callback => { context.document.activeElement = null; callback(); },
    chooseDropdown: async (_dialog, id, value) => { actions.push([id, value]); return true; },
    enterReturnDate: async (_dialog, action) => {
      assert.equal(action, 'waitInternal3Business');
      const value = core.formatReturnDate(new Date(2026, 10, 18), 'DD/MM/AAAA');
      field.value = `${value} (3 days from now)`;
      actions.push(['date', value], 'blur');
      return value;
    },
    returnDateMatches: vm.runInNewContext(source.slice(
      source.indexOf('function returnDateMatches('),
      source.indexOf('async function enterReturnDate(')) + '\nreturnDateMatches', {}),
    waitFor: async find => find() };
  const fill = vm.runInNewContext(`${source.slice(start, end)}\nfillDialog`, context);
  assert.equal(await fill({ querySelector: selector => fields[selector] || null },
    'waitInternal3Business', () => true), true);
  assert.deepEqual(actions, [
    ['hs_pipeline_stage-pending_type', 'Aguardando aprovação'],
    ['date', '18/11/2026'], 'blur'
  ]);
  assert.equal(context.document.activeElement, apply);
});

test('return date accepts only HubSpot’s exact matching relative-date hint', () => {
  const start = source.indexOf('function returnDateMatches(');
  const end = source.indexOf('async function enterReturnDate(', start);
  const matches = vm.runInNewContext(
    `${source.slice(start, end)}\nreturnDateMatches`, {});
  const field = { value: '11/23/2026 (7 days from now)',
    getAttribute: () => 'MM/DD/YYYY [(7 days from now)]' };
  assert.equal(matches(field, '11/23/2026'), true);
  assert.equal(matches(field, '11/24/2026'), false);
  field.getAttribute = () => 'MM/DD/YYYY [(6 days from now)]';
  assert.equal(matches(field, '11/23/2026'), false);
  field.value = '11/23/2026';
  assert.equal(matches(field, '11/23/2026'), true);
});

test('HubSpot’s relative-date display completes without retrying the valid date', async () => {
  const start = source.indexOf('function confirmReturnDate(');
  const end = source.indexOf('async function fillDialog(', start);
  let format = 'MM/DD/YYYY';
  let writes = 0;
  const field = { value: '', placeholder: 'MM/DD/YYYY',
    getAttribute: () => format, focus() {}, blur() {},
    dispatchEvent(event) {
      if (event.type === 'keydown') {
        format = 'MM/DD/YYYY [(7 days from now)]';
        this.value += ' (7 days from now)';
      }
    } };
  const context = { core: { ...core,
    returnDateForAction: () => new Date(2026, 10, 23) },
    enabled: () => true, visible: () => true, waitFor: async find => find(),
    enterValue: (_field, value) => { writes++; field.value = value; return true; },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    document: { execCommand: () => { throw Error('unexpected retry'); } },
    setTimeout: callback => callback() };
  const enter = vm.runInNewContext(`${source.slice(start, end)}\nenterReturnDate`, context);
  assert.equal(await enter({ querySelector: () => field }, 'waitProducerWeek',
    () => true), '11/23/2026');
  assert.equal(writes, 1);
});

test('return date retries a replaced controlled input with browser text insertion', async () => {
  const start = source.indexOf('function confirmReturnDate(');
  const end = source.indexOf('async function fillDialog(', start);
  const first = { value: '', placeholder: 'MM/DD/YYYY',
    getAttribute: () => 'MM/DD/YYYY', focus() {}, blur() {}, dispatchEvent() {} };
  const replacement = { value: '', placeholder: 'MM/DD/YYYY',
    getAttribute: () => 'MM/DD/YYYY', focus() {}, select() {}, blur() {},
    dispatchEvent(event) { if (event.type === 'keydown') enterCount++; } };
  let live = first;
  let inserted = '';
  let enterCount = 0;
  const context = { core: { ...core,
    returnDateForAction: () => new Date(2026, 10, 23) },
    enabled: () => true, visible: () => true, waitFor: async find => find(),
    enterValue: () => { live = replacement; return false; },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    document: { execCommand: (_command, _showUi, value) => {
      inserted = value;
      replacement.value = value;
      return true;
    } }, Event: class {}, setTimeout: callback => callback() };
  const enter = vm.runInNewContext(`${source.slice(start, end)}\nenterReturnDate`, context);
  const dialog = { querySelector: () => live };
  assert.equal(await enter(dialog, 'waitProducerWeek', () => true), '11/23/2026');
  assert.equal(inserted, '11/23/2026');
  assert.equal(enterCount, 1);
});

test('return date identifies a rejected value instead of a generic failure', async () => {
  const start = source.indexOf('function confirmReturnDate(');
  const end = source.indexOf('async function fillDialog(', start);
  const field = { value: '', placeholder: 'MM/DD/YYYY',
    getAttribute: () => 'MM/DD/YYYY', focus() {}, select() {}, blur() {},
    dispatchEvent() {} };
  const reasons = [];
  const context = { core: { ...core,
    returnDateForAction: () => new Date(2026, 10, 23) },
    enabled: () => true, visible: () => true, waitFor: async find => find(),
    enterValue: () => false,
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    document: { execCommand: () => false },
    setTimeout: callback => callback() };
  const enter = vm.runInNewContext(`${source.slice(start, end)}\nenterReturnDate`, context);
  assert.equal(await enter({ querySelector: () => field }, 'waitProducerWeek',
    () => true, (reason, detail) => reasons.push({ reason, detail })), null);
  assert.deepEqual(JSON.parse(JSON.stringify(reasons)), [{ reason: 'DATA_RETORNO_VALOR_REJEITADO',
    detail: { field: true, wrapper: true, format: 'MM/DD/YYYY', actual: '',
      expected: '11/23/2026', connected: false, visible: true } }]);
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

test('final action waits up to five seconds for Send to unlock after an attachment', async () => {
  const start = source.indexOf('async function run(');
  const end = source.indexOf('globalThis.TicketHelperMacroAutofillFinal', start);
  const steps = [];
  let unlocked = false;
  const menu = { getAttribute: key => key === 'aria-owns' ? 'send-menu' : 'false',
    click: () => steps.push('menu') };
  const owned = { querySelectorAll: () => [{ textContent: 'Send and set to Solucionado',
    click: () => steps.push('choice') }] };
  const dialog = { querySelector: () => ({}) };
  const editor = { matches: () => true, closest: () => ({ querySelector: () => menu }) };
  const context = { core, enabled: () => unlocked, visible: () => true,
    document: { getElementById: () => owned, querySelectorAll: () => [dialog] },
    waitFor: async (find, timeout) => {
      if (timeout === 5000) {
        assert.deepEqual(steps, []);
        unlocked = true;
      }
      return find();
    }, fillDialog: async () => { steps.push('fill'); return true; } };
  const run = vm.runInNewContext(`${source.slice(start, end)}\nrun`, context);
  assert.equal(await run(editor, 'solveResolved', () => true,
    () => { steps.push('remove'); return () => steps.push('restore'); }), true);
  assert.deepEqual(steps, ['remove', 'menu', 'choice', 'fill']);

  unlocked = false;
  steps.length = 0;
  context.waitFor = async (find, timeout) => {
    assert.equal(timeout, 5000);
    assert.equal(find(), null);
    return null;
  };
  context.reportFailure = (_action, code) => steps.push(`warning:${code}`);
  assert.equal(await run(editor, 'solveResolved', () => true,
    () => { steps.push('remove'); return () => steps.push('restore'); }), false);
  assert.deepEqual(steps, ['warning:MENU_INDISPONIVEL']);
});
