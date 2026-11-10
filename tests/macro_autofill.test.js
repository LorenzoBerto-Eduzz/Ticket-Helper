const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validRules, findMatches, greetingForHour } = require('../project/macro_autofill_core.js');
const vm = require('node:vm');

const macroScript = fs.readFileSync(path.join(__dirname, '..', 'project', 'macro_autofill.js'), 'utf8');
const positionStart = macroScript.indexOf('function textPosition(');
const positionEnd = macroScript.indexOf('function textOffset(', positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart);

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

test('producer Cc returns to the editor at 200 ms when no new chip appears', async () => {
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
      if (delay === 200) timeoutCallback = callback;
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

test('producer Cc wait ends when a new chip appears before 200 ms', async () => {
  const start = macroScript.indexOf('function pressEnterAndWaitForCcTag(');
  const end = macroScript.indexOf('async function addProducerCc(', start);
  let count = 1;
  let onMutation;
  let disconnected = false;
  let timeoutCallback;
  let cancelled = false;
  class MutationObserver {
    constructor(callback) { onMutation = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  class KeyboardEvent { constructor(type, details) { this.key = details.key; } }
  const section = { querySelectorAll: () => Array.from({ length: count }, () => ({})) };
  const input = { dispatchEvent: () => {} };
  const context = { MutationObserver, KeyboardEvent,
    setTimeout: callback => { timeoutCallback = callback; return 1; },
    clearTimeout: () => { cancelled = true; } };
  const wait = vm.runInNewContext(`${macroScript.slice(start, end)}\npressEnterAndWaitForCcTag`, context);
  const pending = wait(section, input);
  assert.equal(typeof timeoutCallback, 'function');
  count++;
  onMutation();
  await pending;
  assert.equal(disconnected, true);
  assert.equal(cancelled, true);
});

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const resolverStart = background.indexOf('async function resolveMacroAutofillValue(');
const resolverEnd = background.indexOf('const bo1ContratosRuns', resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);

function makeResolver(sendMessage) {
  const context = {
    ensureSessionStateReady: async () => true,
    isExtensionEnabled: () => true,
    lastTicketTabId: 10,
    currentTicketEpoch: 2,
    boTab1Id: 20,
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
    `${background.slice(resolverStart, resolverEnd)}\nresolveMacroAutofillValue`, context) };
}

test('macro labels match exact text and case in the newly inserted snippet', () => {
  const rules = [{ id: 'one', label: 'XXEmailXX', action: 'supportEmail' }];
  assert.deepEqual(findMatches('XXEmailXX xxemailxx XXEmailXX', rules), [
    { start: 0, end: 9, label: 'XXEmailXX', action: 'supportEmail' },
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
