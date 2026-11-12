const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('async function selectHighlightedFatura(');
const end = source.indexOf('async function runSelectedFaturaMenuOption(', start);
assert.ok(start >= 0 && end > start);

test('empty highlight copies the pinned invoice without changing its search state', async () => {
  const cache = { id: '123', selectedFaturaId: '456', selectedFaturaRowIndex: 2,
    faturasSearchById: true };
  const messages = [];
  const copied = [];
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: 3, sessionCache: { 7: cache }, Number, Date,
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    readHighlightedTextFromTab: async () => '',
    copyValueViaOffscreen: (value, done) => { copied.push(value); done(true); },
    copyValueInActiveTab: () => { throw Error('Unneeded clipboard fallback'); },
    syncSessionCache: () => { throw Error('Copy must not mutate ticket cache'); },
    currentFaturasProcess: () => { throw Error('Copy must not search Faturas'); },
    sendToTab: (_tabId, message) => messages.push(message)
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.select = selectHighlightedFatura;`, context);
  assert.equal(await context.select(undefined, 7), true);
  assert.deepEqual(copied, ['456']);
  assert.equal(cache.selectedFaturaId, '456');
  assert.equal(cache.faturasSearchById, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'FLASH_SELECTED_FATURA_COPY');
  assert.equal(messages[0].invoiceId, '456');
});

test('non-numeric highlight copies the pin and never clears it', async () => {
  const cache = { id: '123', selectedFaturaId: '456', selectedFaturaRowIndex: 2,
    faturasSearchById: true };
  const copied = [];
  const messages = [];
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: 3, sessionCache: { 7: cache }, Number, Date,
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    copyValueViaOffscreen: (value, done) => { copied.push(value); done(true); },
    copyValueInActiveTab: () => { throw Error('Unneeded clipboard fallback'); },
    syncSessionCache: () => { throw Error('Copy must not mutate ticket cache'); },
    currentFaturasProcess: () => { throw Error('Copy must not search Faturas'); },
    sendToTab: (_tabId, message) => messages.push(message)
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.select = selectHighlightedFatura;`, context);
  assert.equal(await context.select('Invoice ABC 999', 7), true);
  assert.deepEqual(copied, ['456']);
  assert.equal(cache.selectedFaturaId, '456');
  assert.equal(cache.faturasSearchById, true);
  assert.equal(messages[0].action, 'FLASH_SELECTED_FATURA_COPY');
});

test('non-numeric highlight without a pin leaves selection untouched', async () => {
  const cache = { id: '123', selectedFaturaId: null, selectedFaturaRowIndex: null,
    faturasSearchById: false };
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: 3, sessionCache: { 7: cache }, Number,
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    syncSessionCache: () => { throw Error('Invalid highlight must not change cache'); },
    currentFaturasProcess: () => { throw Error('Invalid highlight must not search'); },
    sendToTab: () => { throw Error('Invalid highlight must not notify'); }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.select = selectHighlightedFatura;`, context);
  assert.equal(await context.select('invoice ABC', 7), false);
  assert.equal(cache.selectedFaturaId, null);
});

test('digits-only highlight still selects a new invoice', async () => {
  const cache = { id: '123', selectedFaturaId: '456', selectedFaturaRowIndex: 2,
    faturasSearchById: false };
  const messages = [];
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: null, sessionCache: { 7: cache }, Number,
    bo1FaturasLastCompleted: new Map(), bo1FaturasPreservedTargets: new Map(),
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    syncSessionCache: () => {},
    currentFaturasProcess: async () => null,
    resolveHubSpotBO2SearchTarget: () => null,
    invalidateBO1FaturasRun: () => {},
    sendToTab: (_tabId, message) => messages.push(message)
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.select = selectHighlightedFatura;`, context);
  assert.equal(await context.select(' 9 8 7 ', 7), true);
  assert.equal(cache.selectedFaturaId, '987');
  assert.equal(cache.faturasSearchById, true);
  assert.equal(messages[0].action, 'SELECTED_FATURA_CHANGED');
});
