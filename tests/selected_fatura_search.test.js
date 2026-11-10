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
    boTab1Id: 3, sessionCache: { 7: cache }, Number, Date, setTimeout,
    bo1FaturasAutoStarted: new Map(), bo1FaturasPreservedTargets: new Map(),
    bo1FaturasLastCompleted: new Map([[3, { ticketId: '123', mode: 'email',
      value: 'customer@example.invalid' }]]),
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    currentFaturasProcess: async () => proc,
    resolveBO1FaturasTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }),
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

test('a proven base ID list avoids probing for an invoice known to be absent', async () => {
  const { context, cache, calls } = harness();
  cache.faturasBaseResult = { mode: 'email', value: 'customer@example.invalid', ids: ['456'] };
  context.findVisibleBO1FaturasInvoiceIndex = async () => {
    throw new Error('An absent ID must not be probed in the old result.');
  };
  assert.equal(await context.select('789', 7), true);
  assert.ok(calls.includes('cancel'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search'));
});

test('base invoice IDs stay attached to the current ticket only', () => {
  const from = source.indexOf('function rememberBO1FaturasBaseIds(');
  const to = source.indexOf('async function hasVisibleBO1FaturasResult(', from);
  const cache = { id: '123' };
  let writes = 0;
  const context = { sessionCache: { 7: cache }, boTab1Id: 3,
    isCurrentTicketOwnerProcess: proc => proc.ticketId === '123',
    syncSessionCache: () => { writes++; } };
  vm.runInNewContext(`${source.slice(from, to)}\nthis.remember = rememberBO1FaturasBaseIds;`, context);
  const target = { mode: 'email', value: 'customer@example.invalid' };
  assert.equal(context.remember({ tabId: 7, ticketId: '123' }, 3, target, ['456', '456', '789']), true);
  assert.equal(cache.faturasBaseResult.ids.length, 3);
  assert.equal(writes, 1);
  assert.equal(context.remember({ tabId: 7, ticketId: 'different' }, 3, target, ['999']), false);
  assert.equal(cache.faturasBaseResult.ids.length, 3);
});

test('Faturas base-result capture requires matching buyers and records every loaded row ID', () => {
  const from = source.indexOf('function bo1FaturasResultProofScript(');
  const to = source.indexOf('async function readVerifiedBO1FaturasIds(', from);
  const popup = { textContent: 'Status da fatura:', querySelector: () => null };
  let buyerEmail = 'customer@example.invalid';
  const rows = ['456', '456', '789'].map(id => ({
    querySelector: selector => selector === 'td'
      ? { querySelectorAll: () => [{ textContent: buyerEmail }] }
      : selector === 'td:first-child p.css-1ypxnh [aria-label] span'
        ? { textContent: id } : null
  }));
  const table = { getClientRects: () => [1], closest: () => popup,
    querySelectorAll: () => rows };
  const context = { location: { origin: 'https://bo.eduzz.com' },
    document: { querySelectorAll: () => [table] } };
  const capture = vm.runInNewContext(`${source.slice(from, to)}\nbo1FaturasResultProofScript`, context);
  assert.deepEqual([...capture('customer@example.invalid', 'email', null, true)],
    ['456', '456', '789']);
  buyerEmail = 'someone-else@example.invalid';
  assert.equal(capture('customer@example.invalid', 'email', null, true), null);
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

test('highlighted invoice waits for a running normal search before deciding on ID search', async () => {
  const { context, cache, calls } = harness({ found: false });
  const entry = { key: 'email:customer@example.invalid', pending: true };
  context.bo1FaturasAutoStarted.set('p1', entry);
  const selecting = context.select('789', 7);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cache.selectedFaturaId, '789');
  assert.equal(context.bo1FaturasPreservedTargets.get(7)?.target.mode, 'email');
  assert.equal(calls.includes('cancel'), false);
  context.findVisibleBO1FaturasInvoiceIndex = async () => 3;
  entry.succeeded = true;
  entry.pending = false;
  assert.equal(await selecting, true);
  assert.equal(cache.selectedFaturaRowIndex, 3);
  assert.equal(calls.includes('cancel'), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('a completed normal search without the highlighted invoice starts the ID search', async () => {
  const { context, cache, calls } = harness({ found: false });
  const entry = { key: 'email:customer@example.invalid', pending: true };
  context.bo1FaturasAutoStarted.set('p1', entry);
  const selecting = context.select('789', 7);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.includes('cancel'), false);
  entry.succeeded = true;
  entry.pending = false;
  assert.equal(await selecting, true);
  assert.equal(cache.selectedFaturaId, '789');
  assert.ok(calls.includes('cancel'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search' && call[1]));
});

test('a failed normal search cannot reuse an older base result for the highlighted ID', async () => {
  const { context, cache, calls } = harness({ found: true });
  cache.faturasBaseResult = { mode: 'email', value: 'customer@example.invalid', ids: ['789'] };
  const entry = { key: 'email:customer@example.invalid', pending: true };
  context.bo1FaturasAutoStarted.set('p1', entry);
  const selecting = context.select('789', 7);
  await new Promise(resolve => setTimeout(resolve, 20));
  entry.succeeded = false;
  entry.pending = false;
  assert.equal(await selecting, true);
  assert.ok(calls.includes('cancel'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search'));
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

test('returning to a ticket reuses its visible invoice result and exact product', async () => {
  const from = source.indexOf('async function reuseVisibleSelectedFatura(');
  const to = source.indexOf('function startBO1FaturasSearchIfReady(', from);
  const completed = { ticketId: '123', mode: 'email', value: 'customer@example.invalid' };
  const cached = { id: '123', selectedFaturaId: '456', selectedFaturaProductId: '200' };
  const calls = [];
  let visibleFallback = false;
  const context = {
    sessionCache: { 7: cached }, bo1FaturasLastCompleted: new Map([[3, completed]]),
    bo1FaturasRuns: new Map(), boTab1Id: 3,
    isCurrentTicketOwnerProcess: () => true,
    findVisibleBO1FaturasInvoiceIndex: async (_tab, target, invoice) => {
      calls.push(['proof', target.mode, target.value, invoice]); return 2;
    },
    findVisibleSelectedFaturaRow: async (_tab, invoice, product) => {
      calls.push(['selected-proof', invoice, product]); return visibleFallback ? 2 : 0;
    },
    restoreCurrentFaturasSelection: async () => { calls.push('restore-product'); return true; }
  };
  vm.runInNewContext(`${source.slice(from, to)}\nthis.reuse = reuseVisibleSelectedFatura;`, context);
  const proc = { tabId: 7, ticketId: '123' };
  assert.equal(await context.reuse(proc, 3), true);
  assert.deepEqual(calls, [['proof', 'email', 'customer@example.invalid', '456'], 'restore-product']);
  completed.ticketId = 'other-ticket';
  assert.equal(await context.reuse(proc, 3), false);
  assert.deepEqual(calls.at(-1), ['selected-proof', '456', '200']);
  visibleFallback = true;
  assert.equal(await context.reuse(proc, 3), true);
  assert.equal(calls.at(-1), 'restore-product');
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
  const context = { sessionCache: { 7: cache }, bo1FaturasPreservedTargets: new Map(),
    resolveHubSpotBO2SearchTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }) };
  const resolve = vm.runInNewContext(`${source.slice(from, to)}\nresolveBO1FaturasTarget`, context);
  const target = resolve({ tabId: 7, ticketId: '123' });
  assert.equal(target.mode, 'invoice');
  assert.equal(target.value, '999');
});
