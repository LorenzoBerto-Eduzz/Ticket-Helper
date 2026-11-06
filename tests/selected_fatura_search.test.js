const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('async function selectHighlightedFatura(');
const end = source.indexOf('async function runSelectedFaturaMenuOption(', start);
assert.ok(start >= 0 && end > start);

function harness({ found = false, overrideId = null } = {}) {
  const cache = { id: '123', email: 'customer@example.invalid', selectedFaturaId: '456',
    selectedFaturaRowIndex: 2, selectedFaturaProductId: '200',
    faturasSearchById: !!overrideId, faturasSearchInvoiceId: overrideId };
  const calls = [];
  const proc = { tabId: 7, ticketId: '123', processId: 'p1' };
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: 3, sessionCache: { 7: cache }, Number, Date,
    bo1FaturasLastCompleted: new Map([[3, { ticketId: '123', mode: 'email',
      value: 'customer@example.invalid' }]]),
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    currentFaturasProcess: async () => proc,
    resolveHubSpotBO2SearchTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }),
    findVisibleBO1FaturasInvoiceIndex: async () => found ? 3 : 0,
    invalidateBO1FaturasRun: () => calls.push('cancel'),
    startBO1FaturasSearchIfReady: (_proc, options) => calls.push(['search', options.force]),
    syncSessionCache: () => calls.push('sync'),
    sendToTab: (_tabId, message) => calls.push(message.action),
    chrome: { tabs: { sendMessage: async () => ({ found: true, index: 3, productId: '300' }) } }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.select = selectHighlightedFatura;
    this.clear = clearSelectedFatura;`, context);
  return { context, cache, calls };
}

test('highlighted invoice in verified normal results selects without a new search', async () => {
  const { context, cache, calls } = harness({ found: true });
  assert.equal(await context.select('789', 7), true);
  assert.equal(cache.selectedFaturaId, '789');
  assert.equal(cache.selectedFaturaProductId, '300');
  assert.equal(cache.faturasSearchById, true);
  assert.equal(cache.faturasSearchInvoiceId, '789');
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('missing highlighted invoice cancels prior search and targets its ID', async () => {
  const { context, cache, calls } = harness({ found: false });
  assert.equal(await context.select('789', 7), true);
  assert.equal(cache.selectedFaturaId, '789');
  assert.equal(cache.selectedFaturaProductId, null);
  assert.equal(cache.faturasSearchById, true);
  assert.equal(cache.faturasSearchInvoiceId, '789');
  assert.ok(calls.includes('cancel'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search' && call[1]));
});

test('clearing an invoice-only search restores the normal target', async () => {
  const { context, cache, calls } = harness({ overrideId: '456' });
  assert.equal(await context.clear(), true);
  assert.equal(cache.selectedFaturaId, null);
  assert.equal(cache.selectedFaturaProductId, null);
  assert.equal(cache.faturasSearchById, false);
  assert.equal(cache.faturasSearchInvoiceId, null);
  assert.ok(calls.includes('CLEAR_FATURAS_SELECTION'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search' && call[1]));
});

test('Order Bump restoration chooses the stored product, not another same-ID row', () => {
  const faturas = fs.readFileSync(path.join(__dirname, '..', 'project',
    'faturas_age_badge.js'), 'utf8');
  const from = faturas.indexOf('function selectInvoiceById(');
  const to = faturas.indexOf('function selectedProductCell(', from);
  const rows = [{ invoiceId: '456', productId: '200' },
    { invoiceId: '456', productId: '300' }];
  let chosen = 0;
  const popup = { textContent: 'Status da fatura:', rows,
    getClientRects: () => [1] };
  const context = { enabled: true, MAX_SELECTABLE_ROWS: 100, String,
    document: { querySelectorAll: () => [popup] },
    getComputedStyle: () => ({ visibility: 'visible' }),
    visibleInvoiceRows: value => value.rows,
    invoiceIdFromRow: row => row.invoiceId,
    productIdFromRow: row => row.productId,
    selectInvoice: index => { chosen = index; return '456'; } };
  vm.runInNewContext(`${faturas.slice(from, to)}\nthis.selectById = selectInvoiceById;`, context);
  const selected = context.selectById('456', '123', '300');
  assert.equal(chosen, 2);
  assert.equal(selected.productId, '300');
});

test('clicking a visible invoice pins its ID without rerunning the current results', async () => {
  const from = source.indexOf('async function selectCurrentTicketFaturasRow(');
  const to = source.indexOf('let highlightedFaturaRequest = 0;', from);
  const cached = { id: '123' };
  const calls = [];
  const context = {
    lastTicketTabId: 7, currentTicketEpoch: 1, boTab1Id: 3,
    sessionCache: { 7: cached },
    ensureSessionStateReady: async () => true,
    isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    syncSessionCache: () => calls.push('sync'),
    sendToTab: (_id, message) => calls.push(message.action),
    chrome: { tabs: { sendMessage: async () => ({ ok: true,
      invoiceId: '456', productId: '789' }) } }
  };
  vm.runInNewContext(`${source.slice(from, to)}\nthis.select = selectCurrentTicketFaturasRow;`, context);
  assert.equal(await context.select(2), true);
  assert.equal(cached.selectedFaturaId, '456');
  assert.equal(cached.selectedFaturaProductId, '789');
  assert.equal(cached.faturasSearchInvoiceId, '456');
  assert.equal(cached.faturasSearchById, true);
  assert.deepEqual(calls, ['sync', 'SELECTED_FATURA_CHANGED']);
});

test('selected invoice takes priority over an older invoice search target', () => {
  const from = source.indexOf('function resolveBO1FaturasTarget(');
  const to = source.indexOf('function invalidateBO1FaturasRun(', from);
  const cache = { id: '123', selectedFaturaId: '999', faturasSearchById: true,
    faturasSearchInvoiceId: '456' };
  const context = { sessionCache: { 7: cache },
    resolveHubSpotBO2SearchTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }) };
  const resolve = vm.runInNewContext(`${source.slice(from, to)}\nresolveBO1FaturasTarget`, context);
  const target = resolve({ tabId: 7, ticketId: '123' });
  assert.equal(target.mode, 'invoice');
  assert.equal(target.value, '999');
});
