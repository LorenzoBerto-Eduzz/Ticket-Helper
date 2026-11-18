const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS, validRules, findMatches, greetingForHour, FINAL_ACTIONS,
  eligibleFinalMatch, returnDateForAction, formatReturnDate } =
  require('../project/macro_autofill_core.js');
const vm = require('node:vm');

const macroScript = fs.readFileSync(path.join(__dirname, '..', 'project', 'macro_autofill.js'), 'utf8');
const toolbarStart = macroScript.indexOf('let toolbarFinalRunning = false;');
const toolbarEnd = macroScript.indexOf('function textPosition(', toolbarStart);
assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
const positionStart = macroScript.indexOf('function textPosition(');
const positionEnd = macroScript.indexOf('function textOffset(', positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart);

test('toolbar final action waits for all macro labels and leaves Apply to the user', async () => {
  const editor = { isConnected: true, textContent: 'Olá XXclienteXX' };
  const send = { isConnected: true, disabled: false, ariaDisabled: 'false',
    getAttribute() { return this.ariaDisabled; } };
  const composer = { querySelector: selector =>
    selector.includes('composer-send-button') ? send : editor };
  const rules = [{ id: 'label_1', label: 'XXclienteXX', action: 'customerFirstName' }];
  let calls = 0;
  const context = {
    enabled: true, rules, rulesRevision: 0,
    core: require('../project/macro_autofill_core.js'),
    finalActions: { run: async (target, action, guard, removeLabel) => {
      calls++;
      assert.equal(target, editor);
      assert.equal(action, 'solveResolved');
      assert.equal(guard(), true);
      assert.equal(typeof removeLabel(), 'function');
      return true;
    } },
    globalThis: { TicketHelperMacroContext: () =>
      ({ ready: true, ticketId: 'ticket_123', ownerEpoch: 1 }) },
    document: { visibilityState: 'visible', hasFocus: () => true,
      addEventListener() {}, removeEventListener() {} },
    ticketId: () => 'ticket_123',
    sameTicketDuringFinalDialog: () => true
  };
  const api = vm.runInNewContext(
    `${macroScript.slice(toolbarStart, toolbarEnd)}\n({ canRunToolbarFinal, runToolbarFinal })`, context);
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
  assert.equal(await api.runToolbarFinal('solveResolved', composer), false);
  assert.equal(calls, 0);
  editor.textContent = 'Olá';
  send.ariaDisabled = 'true';
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
  assert.equal(await api.runToolbarFinal('solveResolved', composer), false);
  send.ariaDisabled = 'false';
  send.disabled = true;
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
  send.disabled = false;
  send.isConnected = false;
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
  send.isConnected = true;
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), true);
  assert.equal(await api.runToolbarFinal('solveResolved', composer), true);
  assert.equal(calls, 1);
  assert.equal(editor.textContent, 'Olá');
});

test('an early physical Enter on the final panel applies only after preparation succeeds', async () => {
  for (const prepared of [true, false]) {
    const editor = { isConnected: true, textContent: 'Olá' };
    const send = { isConnected: true, disabled: false,
      getAttribute: () => 'false' };
    const composer = { querySelector: selector =>
      selector.includes('composer-send-button') ? send : editor };
    let clicks = 0;
    let listener = null;
    const apply = { isConnected: true, disabled: false, textContent: 'Apply',
      getAttribute: () => 'false', click: () => { clicks++; } };
    const panel = { isConnected: true, getClientRects: () => [{}],
      querySelector: selector => selector.includes('hs_pipeline_stage') ? {} : apply };
    const document = { visibilityState: 'visible', hasFocus: () => true,
      querySelectorAll: () => [panel],
      addEventListener: (_type, handler) => { listener = handler; },
      removeEventListener: (_type, handler) => {
        assert.equal(listener, handler);
        listener = null;
      } };
    const context = { enabled: true, rules: [], rulesRevision: 0,
      core: require('../project/macro_autofill_core.js'), document,
      globalThis: { TicketHelperMacroContext: () =>
        ({ ready: true, ticketId: 'ticket_123', ownerEpoch: 1 }) },
      ticketId: () => 'ticket_123', sameTicketDuringFinalDialog: () => true,
      finalActions: { run: async () => {
        let stopped = 0;
        listener({ key: 'Enter', isTrusted: false, isComposing: false,
          preventDefault: () => { stopped++; }, stopImmediatePropagation() {} });
        assert.equal(stopped, 0);
        listener({ key: 'Enter', isTrusted: true, isComposing: false, repeat: false,
          preventDefault: () => { stopped++; }, stopImmediatePropagation() {} });
        assert.equal(stopped, 1);
        return prepared;
      } } };
    const api = vm.runInNewContext(
      `${macroScript.slice(toolbarStart, toolbarEnd)}\n({ runToolbarFinal })`, context);
    assert.equal(await api.runToolbarFinal('solveResolved', composer), prepared);
    assert.equal(clicks, Number(prepared));
    assert.equal(listener, null);
  }
});

test('a blank disabled Send button uses status mode without treating an upload as blank', async () => {
  const editor = { isConnected: true, textContent: '', querySelector: () => null };
  const send = { isConnected: true, disabled: true, getAttribute: () => 'true' };
  let attachment = null;
  const composer = { querySelector: selector =>
    selector.includes('composer-send-button') ? send :
    selector.includes('file-attachment-preview') ? attachment : editor };
  let mode = null;
  const context = { enabled: true, rules: [], rulesRevision: 0,
    core: require('../project/macro_autofill_core.js'),
    finalActions: { run: async (_editor, _action, _guard, _remove, selectedMode) => {
      mode = selectedMode;
      return true;
    } },
    globalThis: { TicketHelperMacroContext: () =>
      ({ ready: true, ticketId: 'ticket_123', ownerEpoch: 1 }) },
    document: { visibilityState: 'visible', hasFocus: () => true,
      querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    ticketId: () => 'ticket_123', sameTicketDuringFinalDialog: () => true };
  const api = vm.runInNewContext(`${macroScript.slice(toolbarStart, toolbarEnd)}\n` +
    '({ canRunToolbarFinal, runToolbarFinal })', context);
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), true);
  assert.equal(await api.runToolbarFinal('solveResolved', composer), true);
  assert.equal(mode, 'status');
  editor.textContent = 'Mensagem em preparo';
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
  editor.textContent = '';
  attachment = {};
  assert.equal(api.canRunToolbarFinal('solveResolved', composer), false);
});

test('an early Enter clicks Save for an empty-composer status action', async () => {
  const editor = { isConnected: true, textContent: '', querySelector: () => null };
  const send = { isConnected: true, disabled: true, getAttribute: () => 'true' };
  const composer = { querySelector: selector =>
    selector.includes('composer-send-button') ? send :
    selector.includes('file-attachment-preview') ? null : editor };
  let keydown;
  let clicks = 0;
  const save = { isConnected: true, disabled: false, textContent: 'Save',
    getAttribute: () => 'false', click: () => { clicks++; } };
  const panel = { isConnected: true, getClientRects: () => [{}],
    querySelector: selector => selector.includes('hs_pipeline_stage') ? {} : save };
  const context = { enabled: true, rules: [], rulesRevision: 0,
    core: require('../project/macro_autofill_core.js'),
    finalActions: { run: async (_editor, _action, _guard, _remove, mode) => {
      assert.equal(mode, 'status');
      keydown({ key: 'Enter', isTrusted: true, isComposing: false, repeat: false,
        preventDefault() {}, stopImmediatePropagation() {} });
      return true;
    } },
    globalThis: { TicketHelperMacroContext: () =>
      ({ ready: true, ticketId: 'ticket_123', ownerEpoch: 1 }) },
    document: { visibilityState: 'visible', hasFocus: () => true,
      querySelectorAll: () => [panel],
      addEventListener: (_type, handler) => { keydown = handler; },
      removeEventListener() {} },
    ticketId: () => 'ticket_123', sameTicketDuringFinalDialog: () => true };
  const api = vm.runInNewContext(`${macroScript.slice(toolbarStart, toolbarEnd)}\n` +
    '({ runToolbarFinal })', context);
  assert.equal(await api.runToolbarFinal('solveResolved', composer), true);
  assert.equal(clicks, 1);
});

test('next ticket waits for a final action and clicks its matching submit button', async () => {
  for (const mode of ['send', 'status']) for (const prepared of [true, false]) {
    let finishPreparation;
    let clicks = 0;
    const apply = { isConnected: true, disabled: false,
      textContent: mode === 'status' ? 'Save' : 'Apply',
      getAttribute: () => 'false', click: () => { clicks++; } };
    const panel = { isConnected: true, getClientRects: () => [{}],
      querySelector: selector => selector.includes('hs_pipeline_stage') ? {} : apply };
    const context = { core: require('../project/macro_autofill_core.js'),
      finalActions: { run: () => new Promise(resolve => { finishPreparation = resolve; }) },
      document: { visibilityState: 'visible', querySelectorAll: () => [panel] },
      globalThis: { TicketHelperMacroContext: () =>
        ({ ticketId: 'ticket_123', ownerEpoch: 4 }) } };
    const api = vm.runInNewContext(`${macroScript.slice(toolbarStart, toolbarEnd)}\n` +
      '({ runTrackedFinal, applyFinalBeforeNextTicket })', context);
    const run = api.runTrackedFinal({}, 'solveResolved', () => true,
      () => () => {}, mode);
    const next = api.applyFinalBeforeNextTicket({
      expectedTicketId: 'ticket_123', ownerEpoch: 4 });
    assert.equal(clicks, 0);
    finishPreparation(prepared);
    assert.equal(await run, prepared);
    assert.equal((await next).status, prepared ? 'applied' : 'blocked');
    assert.equal(clicks, Number(prepared));
  }
});

test('macro replacement keeps line breaks around a label in its own text node', () => {
  const before = { textContent: 'produtor:' };
  const label = { textContent: 'XXemailSuporteXX' };
  const after = { textContent: 'Obrigado' };
  const textPosition = vm.runInNewContext(
    `${macroScript.slice(positionStart, positionEnd)}\ntextPosition`, {
      document: { createTreeWalker: () => {
        const nodes = [before, label, after];
        let index = 0;
        return { nextNode: () => nodes[index++] || null };
      } },
      NodeFilter: { SHOW_TEXT: 4 }
    });
  const start = textPosition(null, before.textContent.length, true);
  assert.equal(start.node, label);
  assert.equal(start.offset, 0);
  const end = textPosition(null, before.textContent.length + label.textContent.length);
  assert.equal(end.node, label);
  assert.equal(end.offset, label.textContent.length);
});

test('multiline invoice macro value creates visible blank lines', () => {
  const start = macroScript.indexOf('function replaceAt(');
  const end = macroScript.indexOf('function requestValue(', start);
  let inserted;
  const context = {
    textPosition: () => ({ node: {}, offset: 0 }),
    document: {
      createRange: () => ({ setStart() {}, setEnd() {}, deleteContents() {},
        insertNode: node => { inserted = node; } }),
      createDocumentFragment: () => ({ children: [], appendChild(node) { this.children.push(node); } }),
      createElement: () => ({ kind: 'break' }),
      createTextNode: value => ({ kind: 'text', value })
    }
  };
  const replaceAt = vm.runInNewContext(`${macroScript.slice(start, end)}\nreplaceAt`, context);
  assert.equal(replaceAt({}, 0, 3, 'Fatura: 123\n\nValor: 10'), true);
  assert.deepEqual(Array.from(inserted.children, node => node.kind === 'break' ? '<br>' : node.value),
    ['Fatura: 123', '<br>', '<br>', 'Valor: 10']);
});

test('standalone Cc label removes its line and one blank line below', () => {
  const start = macroScript.indexOf('function removeStandaloneLabel(');
  const end = macroScript.indexOf('function composerFor(', start);
  const blankLine = { nodeName: 'BR', removed: false, remove() { this.removed = true; } };
  const lineEnd = { nodeName: 'BR', nextSibling: blankLine,
    removed: false, remove() { this.removed = true; } };
  const node = { textContent: 'XXcopiaXX', nextSibling: lineEnd, previousSibling: null };
  let replacement;
  const context = {
    textPosition: (_root, offset) => ({ node, offset }),
    replaceAt: (_root, _start, _end, value) => { replacement = value; return true; }
  };
  const remove = vm.runInNewContext(`${macroScript.slice(start, end)}\nremoveStandaloneLabel`, context);
  assert.equal(remove({}, 0, 9, 'XXcopiaXX'), true);
  assert.equal(replacement, '');
  assert.equal(lineEnd.removed, true);
  assert.equal(blankLine.removed, true);
});

test('standalone Cc label in newline text preserves the blank line above', () => {
  const start = macroScript.indexOf('function removeStandaloneLabel(');
  const end = macroScript.indexOf('function composerFor(', start);
  const original = 'Olá\n\nXXcopiaXX\n\nPróxima linha';
  const node = { textContent: original };
  let result;
  const context = {
    textPosition: (_root, offset) => ({ node, offset }),
    replaceAt: (_root, from, to, value) => {
      result = original.slice(0, from) + value + original.slice(to);
      return true;
    }
  };
  const remove = vm.runInNewContext(`${macroScript.slice(start, end)}\nremoveStandaloneLabel`, context);
  const labelStart = original.indexOf('XXcopiaXX');
  assert.equal(remove({}, labelStart, labelStart + 'XXcopiaXX'.length, 'XXcopiaXX'), true);
  assert.equal(result, 'Olá\n\nPróxima linha');
});

test('producer Cc opens compact recipients, then the Cc field before entering email', async () => {
  const start = macroScript.indexOf('function composerFor(');
  const end = macroScript.indexOf('function requestValue(', start);
  let compactOpened = false;
  let ccOpened = false;
  let chipCount = 0;
  const steps = [];
  class Input {
    constructor() { this._value = ''; this.isConnected = true; this.disabled = false; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    focus() {}
    dispatchEvent(event) {
      if (event.key === 'Enter') { steps.push('enter'); chipCount++; }
    }
  }
  class Event { constructor(type) { this.type = type; } }
  class KeyboardEvent extends Event { constructor(type, details) { super(type); this.key = details.key; } }
  const input = new Input();
  const section = {
    querySelector: () => input,
    querySelectorAll: () => Array.from({ length: chipCount }, () => ({}))
  };
  const compact = { click: () => { compactOpened = true; } };
  const show = { getAttribute: () => 'false', click: () => { ccOpened = true; } };
  const root = {
    parentElement: null,
    querySelectorAll: selector => {
      if (selector.includes('compact-header')) return compactOpened ? [] : [compact];
      if (selector.includes('show-cc')) return compactOpened && !ccOpened ? [show] : [];
      return ccOpened ? [section] : [];
    },
    querySelector: selector => {
      if (selector.includes('compact-header')) return compactOpened ? null : compact;
      if (selector.includes('show-cc')) return compactOpened && !ccOpened ? show : null;
      return ccOpened ? section : null;
    }
  };
  const editor = { parentElement: root, focus() { steps.push('editor-focus'); } };
  class MutationObserver { observe() {} disconnect() {} }
  const context = { sameTicketContext: () => true, document: { getSelection: () => null },
    HTMLInputElement: Input, Event, KeyboardEvent, MutationObserver,
    requestAnimationFrame: callback => callback(), setTimeout: callback => callback(),
    clearTimeout: () => {} };
  const addCc = vm.runInNewContext(`${macroScript.slice(start, end)}\naddProducerCc`, context);
  assert.equal(await addCc(editor, 'support@example.invalid', '123', 1), true);
  assert.equal(compactOpened, true);
  assert.equal(ccOpened, true);
  assert.deepEqual(steps, ['enter', 'editor-focus']);
});

test('producer Cc returns to the editor at 150 ms even when no new chip appears', async () => {
  const start = macroScript.indexOf('function composerFor(');
  const end = macroScript.indexOf('function requestValue(', start);
  class Input {
    constructor() { this._value = ''; this.isConnected = true; this.disabled = false; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    focus() {}
    dispatchEvent() {}
  }
  class Event { constructor(type) { this.type = type; } }
  class KeyboardEvent extends Event { constructor(type, details) { super(type); this.key = details.key; } }
  const input = new Input();
  const section = { querySelector: () => input, querySelectorAll: () => [{}] };
  const root = { parentElement: null,
    querySelectorAll: selector => selector.includes('metadata-cc') ? [section] : [],
    querySelector: selector => selector.includes('metadata-cc') ? section : null };
  let editorFocused = false;
  let enterPressed = false;
  let timeoutCallback;
  const editor = { parentElement: root, focus() { editorFocused = true; } };
  input.dispatchEvent = event => { if (event.key === 'Enter') enterPressed = true; };
  class MutationObserver { observe() {} disconnect() {} }
  const context = { sameTicketContext: () => true, document: { getSelection: () => null },
    HTMLInputElement: Input, Event, KeyboardEvent, MutationObserver,
    requestAnimationFrame: callback => callback(), setTimeout: (callback, delay) => {
      if (delay === 150) timeoutCallback = callback;
      else callback();
    }, clearTimeout: () => {} };
  const addCc = vm.runInNewContext(`${macroScript.slice(start, end)}\naddProducerCc`, context);
  const pending = addCc(editor, 'support@example.invalid', '123', 1);
  await Promise.resolve();
  assert.equal(enterPressed, true);
  assert.equal(editorFocused, false);
  assert.equal(typeof timeoutCallback, 'function');
  timeoutCallback();
  assert.equal(await pending, true);
  assert.equal(editorFocused, true);
});

test('producer Cc always waits 150 ms after Enter without inspecting chips', async () => {
  const start = macroScript.indexOf('function pressEnterAndWaitForCc(');
  const end = macroScript.indexOf('async function addProducerCc(', start);
  let pressed = false;
  let timeoutCallback;
  class KeyboardEvent { constructor(type, details) { this.key = details.key; } }
  const input = { dispatchEvent: event => { pressed = event.key === 'Enter'; } };
  const context = { KeyboardEvent,
    setTimeout: (callback, delay) => {
      assert.equal(delay, 150);
      timeoutCallback = callback;
    } };
  const wait = vm.runInNewContext(`${macroScript.slice(start, end)}\npressEnterAndWaitForCc`, context);
  const pending = wait(input);
  assert.equal(pressed, true);
  assert.equal(typeof timeoutCallback, 'function');
  timeoutCallback();
  await pending;
});

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const resolverStart = background.indexOf('async function resolveMacroAutofillValue(');
const resolverEnd = background.indexOf('const bo1ContratosRuns', resolverStart);
const maskedStart = background.indexOf('function maskEmailForBO2Copy(');
const maskedEnd = background.indexOf('async function copyMaskedBO2EmailsOrAssignTabs(', maskedStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
assert.ok(maskedStart >= 0 && maskedEnd > maskedStart);

function makeResolver(sendMessage) {
  const context = {
    ensureSessionStateReady: async () => true,
    isExtensionEnabled: () => true,
    lastTicketTabId: 10,
    currentTicketEpoch: 2,
    boTab1Id: 20,
    backOffice2TabIds: [30],
    processes: new Map(),
    hasCompletedBO2CustomerCount: value => /^.+ \| [1-4]$/.test(value),
    sessionCache: { 10: { id: '123', name: 'ÉRICA DOS SANTOS',
      selectedFaturaId: '456', selectedFaturaRowIndex: 1 } },
    pendingTicketFocusTabId: null,
    getExistingTab: async tabId => tabId === 10
      ? { url: 'https://app.hubspot.com/help-desk/1/view/2/ticket/123' }
      : { url: 'https://bo.eduzz.com/dashboard/reembolso' },
    extractHubSpotTicketIdFromUrl: url => url.match(/\/ticket\/(\d+)/)?.[1] || null,
    formatSelectedFaturaCopyValue: (_field, value) => value.toLocaleLowerCase('pt-BR')
      .replace(/(^|\s)(\p{L})/gu, (_match, before, letter) =>
        before + letter.toLocaleUpperCase('pt-BR')),
    chrome: { tabs: { sendMessage } },
    URL
  };
  return { context, resolve: vm.runInNewContext(
    `${background.slice(maskedStart, maskedEnd)}\n` +
    `${background.slice(resolverStart, resolverEnd)}\nresolveMacroAutofillValue`, context) };
}

test('macro labels ignore letter case in the newly inserted snippet', () => {
  const rules = [{ id: 'one', label: 'XXEmailXX', action: 'supportEmail' }];
  assert.deepEqual(findMatches('XXEmailXX xxemailxx XXEmailXX', rules), [
    { start: 0, end: 9, label: 'XXEmailXX', action: 'supportEmail' },
    { start: 10, end: 19, label: 'xxemailxx', action: 'supportEmail' },
    { start: 20, end: 29, label: 'XXEmailXX', action: 'supportEmail' }
  ]);
});

test('unassigned labels are inactive and overlapping labels use the longest match', () => {
  const rules = [
    { id: 'short', label: 'XX', action: 'supportEmail' },
    { id: 'long', label: 'XXEmailXX', action: 'supportEmail' },
    { id: 'unassigned', label: 'Pending', action: null }
  ];
  assert.deepEqual(findMatches('XXEmailXX Pending', rules), [
    { start: 0, end: 9, label: 'XXEmailXX', action: 'supportEmail' }
  ]);
  assert.deepEqual(findMatches('XXEmailXX Pending', rules, true), [
    { start: 0, end: 9, label: 'XXEmailXX', action: 'supportEmail' },
    { start: 10, end: 17, label: 'Pending', action: null }
  ]);
});

test('a final MacroAction waits for every other known label, including unassigned labels', () => {
  const rules = [{ label: 'XXfimXX', action: 'solveResolved' },
    { label: 'XXnomeXX', action: 'customerFirstName' },
    { label: 'XXmanualXX', action: null },
    { label: 'XXoutroFimXX', action: 'waitCustomerWeek' }];
  assert.equal(eligibleFinalMatch('Olá XXnomeXX\nXXfimXX', rules, 'solveResolved'), null);
  assert.equal(eligibleFinalMatch('Olá XXmanualXX\nXXfimXX', rules, 'solveResolved'), null);
  assert.equal(eligibleFinalMatch('XXoutroFimXX\nXXfimXX', rules, 'solveResolved'), null);
  assert.equal(eligibleFinalMatch('Olá\nXXfimXX', rules, 'solveResolved')?.action,
    'solveResolved');
  assert.equal(Object.keys(FINAL_ACTIONS).length, 8);
});

test('return dates count three weekdays or seven calendar days across a month', () => {
  const friday = new Date(2026, 10, 27);
  assert.equal(formatReturnDate(returnDateForAction('waitProducer3Business', friday),
    'DD/MM/AAAA'), '02/12/2026');
  assert.equal(formatReturnDate(returnDateForAction('waitCustomerWeek', friday),
    'MM/DD/YYYY'), '12/04/2026');
  assert.equal(formatReturnDate(returnDateForAction('waitCustomerWeek', friday),
    'MM/DD/YYYY [(7 days from now)]'), '12/04/2026');
  assert.equal(formatReturnDate(returnDateForAction('waitInternal3Business', friday),
    'MM/DD/YYYY'), '12/02/2026');
  assert.equal(formatReturnDate(returnDateForAction('waitInternal1Business', friday),
    'DD/MM/AAAA'), '30/11/2026');
  assert.equal(formatReturnDate(returnDateForAction('waitInternal1Business',
    new Date(2026, 10, 28)), 'MM/DD/YYYY'), '11/30/2026');
  assert.equal(formatReturnDate(friday, 'unknown'), null);
});

test('old internal-week assignments and exports become the one-day action', () => {
  assert.equal(validRules([{ id: 'legacy', label: 'XXinternoXX',
    action: 'waitInternalWeek' }])[0].action, 'waitInternal1Business');
  assert.equal(require('../project/macro_autofill_core.js').actionIdForName(
    'Aguardar interno até 1 semana'), 'waitInternal1Business');
});

test('plain HubSpot textarea fills data while leaving composer-only labels pending', async () => {
  const start = macroScript.indexOf('async function processPlainSpan(');
  const end = macroScript.indexOf('async function processTextSpan(', start);
  class TextArea {
    constructor(value) { this._value = value; this.tagName = 'TEXTAREA'; this.maxLength = -1;
      this.selectionStart = value.length; this.events = []; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    setSelectionRange(start) { this.selectionStart = start; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  class InputEvent { constructor(type) { this.type = type; } }
  const rules = [{ label: 'XXclienteXX', action: 'customerFirstName' },
    { label: 'XXfimXX', action: 'solveResolved' },
    { label: 'XXcopiaXX', action: 'ccProducer' }];
  const field = new TextArea('Olá XXclienteXX\nXXcopiaXX\nXXfimXX');
  let tracked = 0;
  const context = { enabled: true, rules, rulesRevision: 0, core: require('../project/macro_autofill_core.js'),
    plainField: () => true, ticketId: () => '123', focusedTicketEditor: () => true,
    globalThis: { TicketHelperMacroContext: () => ({ ticketId: '123', ownerEpoch: 1 }) },
    requestValue: async action => action === 'customerFirstName' ? 'Ana' : null,
    visuals: { track: () => { tracked++; } },
    HTMLTextAreaElement: TextArea, InputEvent };
  const process = vm.runInNewContext(`${macroScript.slice(start, end)}\nprocessPlainSpan`, context);
  await process(field, field.value, 0);
  assert.equal(field.value, 'Olá Ana\nXXcopiaXX\nXXfimXX');
  assert.deepEqual(field.events, ['input']);
  assert.equal(tracked, 1);
});

test('composer preparation enables email details once per ticket without toggling an enabled setting', async () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'project',
    'macro_autofill_visuals.js'), 'utf8');
  let shown = false;
  let settingClicks = 0;
  let checkboxClicks = 0;
  const checkbox = { checked: false, isConnected: true,
    click() { checkboxClicks++; this.checked = true; } };
  const settings = { isConnected: true, getAttribute: () => null,
    click() { settingClicks++; shown = !shown; } };
  const mode = { value: 'email' };
  const channel = { querySelector: selector =>
    selector.includes(`data-icon-name="${mode.value === 'email' ? 'Email' : 'Messages'}"`)
      ? {} : null };
  const composer = { isConnected: true,
    querySelector: selector => selector.includes('composer-compact-header')
      ? channel : settings, contains: () => false };
  const editor = { isConnected: true, closest: () => composer };
  const location = { hostname: 'app.hubspot.com',
    pathname: '/help-desk/1/view/2/ticket/123' };
  const document = { activeElement: null,
    querySelector: () => shown ? checkbox : null };
  const globalThis = {};
  vm.runInNewContext(script, { globalThis, location, document,
    WeakMap, WeakSet });
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  assert.equal(checkbox.checked, true);
  assert.equal(checkboxClicks, 1);
  assert.equal(settingClicks, 2);
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  assert.equal(settingClicks, 2);
  location.pathname = '/help-desk/1/view/2/ticket/456';
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  assert.equal(settingClicks, 4);
  assert.equal(checkboxClicks, 1);
  mode.value = 'chat';
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  assert.equal(settingClicks, 4);
  mode.value = 'email';
  await globalThis.TicketHelperMacroAutofillVisuals.prepareEditor(editor);
  assert.equal(settingClicks, 6);
  assert.equal(checkboxClicks, 1);
});

test('missing email checkbox does not reopen Settings on later editor updates', async () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'project',
    'macro_autofill_visuals.js'), 'utf8');
  const start = script.indexOf('async function prepareEditor(');
  const end = script.indexOf('globalThis.TicketHelperMacroAutofillVisuals', start);
  let settingsClicks = 0;
  const settings = { isConnected: true, getAttribute: () => null,
    click() { settingsClicks++; } };
  const channel = { querySelector: selector =>
    selector.includes('data-icon-name="Email"') ? {} : null };
  const composer = { isConnected: true, querySelector: selector =>
    selector.includes('composer-compact-header') ? channel : settings };
  const editor = { isConnected: true, closest: () => composer };
  const context = { prepared: new WeakMap(), preparing: new WeakSet(),
    routeTicketId: () => '123', waitForCheckbox: async () => null,
    document: { activeElement: null, querySelector: () => null } };
  const prepare = vm.runInNewContext(`${script.slice(start, end)}\nprepareEditor`, context);
  await prepare(editor);
  await prepare(editor);
  assert.equal(settingsClicks, 1);
});

test('pending labels stay marked until the last known label leaves the editor', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'project',
    'macro_autofill_visuals.js'), 'utf8');
  const highlights = new Map();
  const editor = { isConnected: true, textContent: 'XXclienteXX e XXcopiaXX',
    contains: node => node === textNode,
    getBoundingClientRect: () => ({ left: 100, right: 400, top: 100 }) };
  const textNode = { isConnected: true, nodeType: 3,
    get textContent() { return editor.textContent; } };
  const label = { style: {}, textContent: '',
    getBoundingClientRect: () => ({ width: 90, height: 25 }) };
  let removed = false;
  let mutation;
  let scheduled;
  const caret = { startContainer: textNode, startOffset: 3,
    cloneRange() { return this; }, setStart() {}, collapse() {},
    getBoundingClientRect: () => ({ left: 250, right: 250, top: 150,
      bottom: 167, width: 0, height: 17 }) };
  const document = {
    createElement: () => ({ attachShadow: () => ({
      innerHTML: '', querySelector: () => label }), remove() { removed = true; } }),
    documentElement: { appendChild() {} },
    addEventListener() {}, removeEventListener() {},
    getSelection: () => ({ rangeCount: 1, focusNode: textNode, focusOffset: 3,
      getRangeAt: () => caret }),
    createTreeWalker: () => { let visited = false; return {
      nextNode: () => { if (visited) return null; visited = true; return textNode; }
    }; },
    createRange: () => ({ setStart() {}, setEnd() {} })
  };
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe() {}
    disconnect() {}
  }
  class Highlight { constructor(...ranges) { this.ranges = ranges; } }
  const globalThis = { TicketHelperMacroAutofillCore: { findMatches } ,
    CSS: { highlights } };
  vm.runInNewContext(script, { globalThis, CSS: globalThis.CSS,
    location: { hostname: 'app.hubspot.com',
      pathname: '/help-desk/1/view/2/ticket/123' }, document,
    window: { addEventListener() {}, removeEventListener() {} },
    NodeFilter: { SHOW_TEXT: 4 }, Node: { TEXT_NODE: 3 }, MutationObserver, Highlight,
    innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame: callback => { scheduled = callback; return 1; },
    cancelAnimationFrame() {} });
  const visuals = globalThis.TicketHelperMacroAutofillVisuals;
  const rules = [
    { id: 'one', label: 'XXclienteXX', action: null },
    { id: 'two', label: 'XXcopiaXX', action: 'ccProducer' }
  ];
  visuals.track(editor, '123', rules);
  assert.equal(label.textContent, '2 Pendentes');
  assert.equal(label.style.left, '256px');
  assert.equal(label.style.top, '119px');
  assert.equal(highlights.get('ticket-helper-macro-pending').ranges.length, 2);
  editor.textContent = 'XXcopiaXX';
  mutation();
  scheduled();
  assert.equal(label.textContent, '1 Pendentes');
  editor.textContent = 'Tudo pronto';
  mutation();
  scheduled();
  assert.equal(removed, true);
  assert.equal(highlights.has('ticket-helper-macro-pending'), false);
});

test('duplicate and unknown saved rules cannot add extra replacements', () => {
  assert.deepEqual(validRules([
    { id: 'one', label: 'Tag', action: 'supportEmail' },
    { id: 'two', label: 'Tag', action: 'supportEmail' },
    { id: 'three', label: 'Other', action: 'unknown' }
  ]), [
    { id: 'one', label: 'Tag', action: 'supportEmail' },
    { id: 'three', label: 'Other', action: null }
  ]);
});

test('macro labels match any letter case and retain the actual matched text', () => {
  const rules = [{ id: 'data', label: 'XXdadosFaturaXX', action: 'invoiceData' }];
  assert.deepEqual(findMatches('XXdadosfaturaXX / xxdaDOSfaTuraxX', rules), [
    { start: 0, end: 15, label: 'XXdadosfaturaXX', action: 'invoiceData' },
    { start: 18, end: 33, label: 'xxdaDOSfaTuraxX', action: 'invoiceData' }
  ]);
  assert.equal(findMatches('XXdados FaturaXX', rules).length, 0);
});

test('labels differing only in letter case cannot create conflicting rules', () => {
  assert.deepEqual(validRules([
    { id: 'first', label: 'XXdadosFaturaXX', action: 'invoiceData' },
    { id: 'second', label: 'xxDADOSFATURAxx', action: 'supportEmail' }
  ]), [{ id: 'first', label: 'XXdadosFaturaXX', action: 'invoiceData' }]);
});

test('literal labels keep their configured surrounding spaces', () => {
  const rules = [{ id: 'spaced', label: ' XXEmailXX ', action: 'supportEmail' }];
  assert.equal(findMatches('XXEmailXX  XXEmailXX ', rules).length, 1);
  assert.equal(validRules(rules)[0].label, ' XXEmailXX ');
});

test('local-hour greeting switches at 04:00, 12:00, and 19:00', () => {
  assert.equal(greetingForHour(3), 'Boa noite');
  assert.equal(greetingForHour(4), 'Bom dia');
  assert.equal(greetingForHour(11), 'Bom dia');
  assert.equal(greetingForHour(12), 'Boa tarde');
  assert.equal(greetingForHour(18), 'Boa tarde');
  assert.equal(greetingForHour(19), 'Boa noite');
  assert.equal(greetingForHour(24), null);
});

test('customer-name macro uses the current ticket first name without an invoice', async () => {
  const { context, resolve } = makeResolver(async () => null);
  context.sessionCache[10].selectedFaturaId = null;
  context.boTab1Id = null;
  assert.equal(await resolve(10, '123', 2, 'customerFirstName'), 'Érica');
  assert.equal(await resolve(11, '123', 2, 'customerFirstName'), null);
  context.sessionCache[10].name = '> Ticket sem nome';
  assert.equal(await resolve(10, '123', 2, 'customerFirstName'), null);
});

test('customer-email macro uses only the active ticket email and needs no invoice', async () => {
  const { context, resolve } = makeResolver(async () => null);
  context.sessionCache[10].email = 'Customer@Example.Invalid';
  context.sessionCache[10].selectedFaturaId = null;
  context.boTab1Id = null;
  assert.equal(await resolve(10, '123', 2, 'customerEmail'), 'customer@example.invalid');
  assert.equal(await resolve(11, '123', 2, 'customerEmail'), null);
  assert.equal(await resolve(10, '999', 2, 'customerEmail'), null);
  context.sessionCache[10].email = '> Ticket sem email';
  assert.equal(await resolve(10, '123', 2, 'customerEmail'), null);
});

test('masked-email MacroAction uses the same completed Orbita list as copying', async () => {
  assert.ok(ACTIONS.some(action => action.id === 'maskedEmails' &&
    action.name === 'Colar emails censurados'));
  const { context, resolve } = makeResolver(async () => null);
  Object.assign(context.sessionCache[10], { selectedFaturaId: null,
    accounts: 'Cliente | 2', accountsSource: 'bo2_customer',
    maskedEmails: 'ab****@example.invalid\ncd****@example.invalid' });
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'),
    'ab****@example.invalid\ncd****@example.invalid');
  assert.equal(await resolve(11, '123', 2, 'maskedEmails'), null);
  assert.equal(await resolve(10, '123', 3, 'maskedEmails'), null);
  context.backOffice2TabIds[0] = null;
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'), null);
});

test('masked-email MacroAction handles no account but refuses incomplete searches', async () => {
  const { context, resolve } = makeResolver(async () => null);
  Object.assign(context.sessionCache[10], { email: 'template@email.com',
    selectedFaturaId: null, accounts: '> Nenhuma conta', accountsSource: 'bo2_customer' });
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'), 'te****ate@email.com');
  context.sessionCache[10].accounts = '-';
  context.sessionCache[10].accountsSource = null;
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'), null);
  context.sessionCache[10].doc = '> Email sem conta';
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'), 'te****ate@email.com');
  context.processes.set(10, { ticketId: '123', email: 'template@email.com',
    accounts: '-', accountsSource: 'bo2_customer', doc: '-' });
  context.sessionCache[10].doc = '-';
  assert.equal(await resolve(10, '123', 2, 'maskedEmails'), null);
});

test('email-shaped ticket name uses its local part in the macro', async () => {
  const { context, resolve } = makeResolver(async () => null);
  context.sessionCache[10].name = 'carljohn.crazy@example.invalid';
  assert.equal(await resolve(10, '123', 2, 'customerFirstName'), 'Carljohn.crazy');
});

test('invoice-ID macro uses the pinned invoice for the owning ticket', async () => {
  const { context, resolve } = makeResolver(async () => null);
  assert.equal(await resolve(10, '123', 2, 'invoiceId'), '456');
  context.sessionCache[10].selectedFaturaId = null;
  assert.equal(await resolve(10, '123', 2, 'invoiceId'), null);
});

test('support email comes from the selected invoice, without copying or switching tabs', async () => {
  let request;
  const { resolve } = makeResolver(async (_tabId, message) => {
    request = message;
    return { email: 'Support@Example.Invalid' };
  });
  assert.equal(await resolve(10, '123', 2, 'supportEmail'), 'support@example.invalid');
  assert.equal(request.action, 'GET_SELECTED_FATURA_SUPPORT_EMAIL');
  assert.equal(request.invoiceId, '456');
});

test('product-name macro reads only the selected invoice product', async () => {
  let request;
  const { resolve } = makeResolver(async (_tabId, message) => {
    request = message;
    return { product: 'PRODUTO EXEMPLO' };
  });
  assert.equal(await resolve(10, '123', 2, 'productName'), 'Produto Exemplo');
  assert.equal(request.action, 'GET_SELECTED_FATURA_PRODUCT_NAME');
  assert.equal(request.invoiceId, '456');
  assert.equal(request.rowIndex, 1);
});

test('producer Cc action resolves the selected invoice support email', async () => {
  const { resolve } = makeResolver(async (_tabId, message) => {
    assert.equal(message.action, 'GET_SELECTED_FATURA_SUPPORT_EMAIL');
    return { email: 'PRODUTOR@EXAMPLE.INVALID' };
  });
  assert.equal(await resolve(10, '123', 2, 'ccProducer'), 'produtor@example.invalid');
  assert.equal(validRules([{ id: 'cc', label: 'XXcopiaXX', action: 'ccProducer' }])[0].action,
    'ccProducer');
});

test('refund receipt macro requires the expected invoice before clicking its BO option', async () => {
  assert.ok(ACTIONS.some(action => action.id === 'refundReceiptUpload' &&
    action.name === 'Baixar comprovante do reembolso'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
  const start = source.indexOf('async function runMacroRefundReceipt(');
  const end = source.indexOf('const bo1ContratosRuns', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    resolveMacroAutofillValue: async () => '456',
    sessionCache: { 10: { selectedFaturaRowIndex: 2, selectedFaturaProductId: 'product_1' } },
    runSelectedFaturaAction: async (field, expected) => {
      calls.push({ field, expected });
      return true;
    }
  };
  const run = vm.runInNewContext(`${source.slice(start, end)}\nrunMacroRefundReceipt`, context);
  assert.equal(await run(10, '123', 2, '999'), false);
  assert.equal(calls.length, 0);
  assert.equal(await run(10, '123', 2, '456'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].field, 'refundReceipt');
  assert.equal(calls[0].expected.invoiceId, '456');
  assert.equal(calls[0].expected.rowIndex, 2);
  assert.equal(calls[0].expected.productId, 'product_1');
});

test('refund receipt macro waits for a new attachment card after file selection', async () => {
  const start = macroScript.indexOf('async function openRefundReceiptUpload(');
  const end = macroScript.indexOf('function requestValue(', start);
  assert.ok(start >= 0 && end > start);
  const clicks = [];
  let notifyMutation;
  let cards = 1;
  const listeners = new Map();
  const fileInput = { disabled: false, files: [{ name: 'receipt.pdf' }],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name) };
  const toolbar = { disabled: false, getClientRects: () => [{}],
    getAttribute: () => null, click: () => clicks.push('toolbar') };
  const upload = { getClientRects: () => [{}], closest: () => null,
    getAttribute: () => null,
    parentElement: { querySelector: () => fileInput },
    click() {
      clicks.push('upload');
      queueMicrotask(() => {
        listeners.get('change')();
        queueMicrotask(() => { cards++; notifyMutation(); });
      });
    } };
  const parent = { parentElement: null, querySelectorAll: () => [toolbar] };
  const composer = { isConnected: true,
    querySelectorAll: () => Array.from({ length: cards }, () => ({})) };
  const context = {
    sameTicketContext: () => true,
    sameTicketOwner: () => true,
    document: { querySelectorAll: () => [upload] },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { notifyMutation = this.callback; }
      disconnect() {}
    }, setTimeout, clearTimeout
  };
  const open = vm.runInNewContext(`${macroScript.slice(start, end)}\nopenRefundReceiptUpload`, context);
  const attached = await open({ parentElement: parent, closest: () => composer }, '123', 2);
  assert.equal(attached.composer, composer);
  assert.equal(attached.previousCount, 1);
  assert.deepEqual(clicks, ['toolbar', 'upload']);
  assert.equal(listeners.size, 0);
});

test('refund receipt remains pending when the file picker is canceled', async () => {
  const start = macroScript.indexOf('async function openRefundReceiptUpload(');
  const end = macroScript.indexOf('function requestValue(', start);
  const listeners = new Map();
  const fileInput = { disabled: false, files: [],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name) };
  const toolbar = { disabled: false, getClientRects: () => [{}],
    getAttribute: () => null, click() {} };
  const upload = { getClientRects: () => [{}], closest: () => null,
    getAttribute: () => null, parentElement: { querySelector: () => fileInput },
    click: () => queueMicrotask(() => listeners.get('cancel')()) };
  const context = { sameTicketContext: () => true, sameTicketOwner: () => true,
    document: { querySelectorAll: () => [upload] } };
  const open = vm.runInNewContext(`${macroScript.slice(start, end)}\nopenRefundReceiptUpload`, context);
  const editor = { closest: () => ({ querySelectorAll: () => [] }),
    parentElement: { parentElement: null, querySelectorAll: () => [toolbar] } };
  assert.equal(await open(editor, '123', 2), false);
  assert.equal(listeners.size, 0);
});

test('refund receipt stays pending if no new attachment card appears within 500 ms', async () => {
  const start = macroScript.indexOf('async function openRefundReceiptUpload(');
  const end = macroScript.indexOf('function requestValue(', start);
  const listeners = new Map();
  const fileInput = { disabled: false, files: [{ name: 'receipt.pdf' }],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name) };
  const toolbar = { disabled: false, getClientRects: () => [{}],
    getAttribute: () => null, click() {} };
  const upload = { getClientRects: () => [{}], closest: () => null,
    getAttribute: () => null, parentElement: { querySelector: () => fileInput },
    click: () => queueMicrotask(() => listeners.get('change')()) };
  let timeoutMs;
  const context = { sameTicketContext: () => true, sameTicketOwner: () => true,
    document: { querySelectorAll: () => [upload] },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback, ms) => { timeoutMs = ms; queueMicrotask(callback); return 1; },
    clearTimeout: () => {} };
  const open = vm.runInNewContext(`${macroScript.slice(start, end)}\nopenRefundReceiptUpload`, context);
  const editor = { closest: () => ({ isConnected: true, querySelectorAll: () => [] }),
    parentElement: { parentElement: null, querySelectorAll: () => [toolbar] } };
  assert.equal(await open(editor, '123', 2), false);
  assert.equal(timeoutMs, 500);
});

test('invoice data macro uses the selected invoice and refuses a changed selection', async () => {
  const { context, resolve } = makeResolver(async () => null);
  const summary = 'Fatura: 456\n\nConteúdo: Produto Exemplo';
  context.getSelectedFaturaData = async (_tabId, invoiceId, rowIndex, stillSelected) => {
    assert.equal(invoiceId, '456');
    assert.equal(rowIndex, 1);
    assert.equal(stillSelected(), true);
    return summary;
  };
  assert.equal(await resolve(10, '123', 2, 'invoiceData'), summary);
  context.sessionCache[10].selectedFaturaRowIndex = 2;
  context.getSelectedFaturaData = async () => {
    context.sessionCache[10].selectedFaturaRowIndex = 3;
    return summary;
  };
  assert.equal(await resolve(10, '123', 2, 'invoiceData'), null);
});

test('missing selection and ownership changes never return a stale invoice email', async () => {
  let complete;
  const { context, resolve } = makeResolver(() => new Promise(resolve => { complete = resolve; }));
  assert.equal(await resolve(11, '123', 2, 'supportEmail'), null);
  context.sessionCache[10].selectedFaturaId = null;
  assert.equal(await resolve(10, '123', 2, 'supportEmail'), null);
  context.sessionCache[10].selectedFaturaId = '456';
  const pending = resolve(10, '123', 2, 'supportEmail');
  await new Promise(resolve => setImmediate(resolve));
  context.currentTicketEpoch++;
  complete({ email: 'wrong@example.invalid' });
  assert.equal(await pending, null);
});

test('a previous ownership epoch cannot supply a macro value after A-B-A', async () => {
  const { context, resolve } = makeResolver(async () => ({ email: 'support@example.invalid' }));
  context.currentTicketEpoch = 4;
  assert.equal(await resolve(10, '123', 2, 'customerFirstName'), null);
  assert.equal(await resolve(10, '123', 2, 'supportEmail'), null);
  assert.equal(await resolve(10, '123', 4, 'customerFirstName'), 'Érica');
});

test('changing products within the same selected invoice rejects an in-flight email', async () => {
  let complete;
  const { context, resolve } = makeResolver(() => new Promise(resolve => { complete = resolve; }));
  const pending = resolve(10, '123', 2, 'supportEmail');
  await new Promise(resolve => setImmediate(resolve));
  context.sessionCache[10].selectedFaturaRowIndex = 2;
  complete({ email: 'support@example.invalid' });
  assert.equal(await pending, null);
});

const content = fs.readFileSync(path.join(__dirname, '..', 'project', 'content.js'), 'utf8');
const contextStart = content.indexOf('function getMacroAutofillContext(');
const contextEnd = content.indexOf('globalThis.TicketHelperMacroContext', contextStart);
assert.ok(contextStart >= 0 && contextEnd > contextStart);

test('macro page context rejects a mismatched visible ticket header or owner', () => {
  const route = 'https://app.hubspot.com/help-desk/1/view/2/ticket/123';
  const link = { href: 'https://app.hubspot.com/contacts/1/record/0-5/123' +
    '?eschref=%2Fhelp-desk%2F1%2Fview%2F2%2Fticket%2F123%2Fthread%2F999' };
  const extractText = url => url.match(/\/ticket\/(\d+)/)?.[1] || null;
  const hrefStart = content.indexOf('function extractHubSpotTicketIdFromHref(');
  const hrefEnd = content.indexOf('function extractHubSpotTicketIdFromDom(', hrefStart);
  const extractHref = vm.runInNewContext(
    `${content.slice(hrefStart, hrefEnd)}\nextractHubSpotTicketIdFromHref`, {
      extractHubSpotTicketIdFromText: extractText,
      location: { origin: 'https://app.hubspot.com' }, URL
    });
  const context = {
    location: { href: route },
    document: { querySelectorAll: () => [link] },
    extractHubSpotTicketIdFromText: extractText,
    extractHubSpotTicketIdFromHref: extractHref,
    getCurrentTicketTransitionState: () => ({ waitForDom: false, ticketId: '123' }),
    isElementVisible: () => true,
    isHubSpotTicketPage: () => true,
    enabled: true,
    currentTicketId: '123',
    popupThisTabId: 10,
    popupOwnerTabId: 10,
    popupOwnerTicketId: '123',
    popupOwnerEpoch: 2
  };
  const getContext = vm.runInNewContext(
    `${content.slice(contextStart, contextEnd)}\ngetMacroAutofillContext`, context);
  assert.equal(getContext().ready, true);
  link.href = 'https://app.hubspot.com/help-desk/1/view/2/ticket/456';
  assert.equal(getContext().ready, false);
  link.href = route;
  context.popupOwnerTabId = 11;
  assert.equal(getContext().ready, false);
});

const focusStart = macroScript.indexOf('function focusedTicketEditor(');
const focusEnd = macroScript.indexOf('function textPosition(', focusStart);
assert.ok(focusStart >= 0 && focusEnd > focusStart);

test('macro editor loses permission to fill as soon as focus or ownership changes', () => {
  const editor = { isConnected: true, contains: () => false };
  const context = { ready: true, ticketId: '123', ownerEpoch: 2 };
  const document = { visibilityState: 'visible', hasFocus: () => true,
    activeElement: editor };
  const focused = vm.runInNewContext(
    `${macroScript.slice(focusStart, focusEnd)}\nfocusedTicketEditor`, {
      document, globalThis: { TicketHelperMacroContext: () => context }
    });
  assert.equal(focused(editor, '123', 2), true);
  document.hasFocus = () => false;
  assert.equal(focused(editor, '123', 2), false);
  document.hasFocus = () => true;
  context.ownerEpoch = 3;
  assert.equal(focused(editor, '123', 2), false);
});

const faturas = fs.readFileSync(path.join(__dirname, '..', 'project', 'faturas_age_badge.js'), 'utf8');
const rowStart = faturas.indexOf('function selectedProductCell(');
const rowEnd = faturas.indexOf('function selectedProductLines(', rowStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart);

test('support-email lookup refuses a different product row sharing the invoice ID', () => {
  const cell = { textContent: 'support@example.invalid' };
  const row = { classList: { contains: () => true }, querySelector: selector =>
    selector === 'td' ? { textContent: 'Buyer A' } : cell };
  const popup = { textContent: 'Status da fatura:', getClientRects: () => [1] };
  const context = {
    enabled: true, selectedTicketId: '123', selectedInvoiceId: '456',
    selectedRowIndex: 1, selectedBuyerSignature: 'Buyer A', selectedRow: row,
    selectedProductId: 'product_a', productIdFromRow: () => 'product_a',
    document: { querySelectorAll: () => [popup] },
    getComputedStyle: () => ({ visibility: 'visible' }),
    visibleInvoiceRows: () => [row],
    invoiceIdFromRow: () => '456',
    MAX_SELECTABLE_ROWS: 100, SELECTED_ROW_CLASS: 'selected'
  };
  const selectedProductCell = vm.runInNewContext(
    `${faturas.slice(rowStart, rowEnd)}\nselectedProductCell`, context);
  assert.equal(selectedProductCell('123', '456', 1), cell);
  assert.equal(selectedProductCell('123', '456', 2), null);
  context.selectedRowIndex = 2;
  assert.equal(selectedProductCell('123', '456', 1), null);
  context.selectedRowIndex = 1;
  context.selectedBuyerSignature = 'Buyer B';
  assert.equal(selectedProductCell('123', '456', 1), null);
  context.selectedBuyerSignature = 'Buyer A';
  context.selectedProductId = 'product_b';
  assert.equal(selectedProductCell('123', '456', 1), null);
});
