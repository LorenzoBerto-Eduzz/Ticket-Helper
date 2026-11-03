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
  assert.equal(await resolve(10, '123', 'customerFirstName'), 'Érica');
  assert.equal(await resolve(11, '123', 'customerFirstName'), null);
  context.sessionCache[10].name = '> Ticket sem nome';
  assert.equal(await resolve(10, '123', 'customerFirstName'), null);
});

test('support email comes from the selected invoice, without copying or switching tabs', async () => {
  let request;
  const { resolve } = makeResolver(async (_tabId, message) => {
    request = message;
    return { email: 'Support@Example.Invalid' };
  });
  assert.equal(await resolve(10, '123', 'supportEmail'), 'support@example.invalid');
  assert.equal(request.action, 'GET_SELECTED_FATURA_SUPPORT_EMAIL');
  assert.equal(request.invoiceId, '456');
});

test('missing selection and ownership changes never return a stale invoice email', async () => {
  let complete;
  const { context, resolve } = makeResolver(() => new Promise(resolve => { complete = resolve; }));
  assert.equal(await resolve(11, '123', 'supportEmail'), null);
  context.sessionCache[10].selectedFaturaId = null;
  assert.equal(await resolve(10, '123', 'supportEmail'), null);
  context.sessionCache[10].selectedFaturaId = '456';
  const pending = resolve(10, '123', 'supportEmail');
  await new Promise(resolve => setImmediate(resolve));
  context.currentTicketEpoch++;
  complete({ email: 'wrong@example.invalid' });
  assert.equal(await pending, null);
});
