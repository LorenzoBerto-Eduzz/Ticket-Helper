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
});
