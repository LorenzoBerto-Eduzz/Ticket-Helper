const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('async function selectHighlightedFatura(');
const end = source.indexOf('async function runSelectedFaturaMenuOption(', start);
assert.ok(start >= 0 && end > start);

function harness({ found = false, overrideId = null, visibleNormal = false } = {}) {
  const cache = { id: '123', email: 'customer@example.invalid', selectedFaturaId: '456',
    selectedFaturaRowIndex: 2, selectedFaturaProductId: '200',
    faturasSearchById: !!overrideId, faturasSearchInvoiceId: overrideId };
  const calls = [];
  const proc = { tabId: 7, ticketId: '123', processId: 'p1' };
  const context = {
    highlightedFaturaRequest: 0, lastTicketTabId: 7, currentTicketEpoch: 1,
    boTab1Id: 3, sessionCache: { 7: cache }, Number, Date, setTimeout,
    visibleResult: found,
    bo1FaturasAutoStarted: new Map(), bo1FaturasPreservedTargets: new Map(),
    bo1FaturasLastCompleted: new Map([[3, { ticketId: '123', mode: 'email',
      value: 'customer@example.invalid' }]]),
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/ticket/123' }),
    extractHubSpotTicketIdFromUrl: () => '123',
    currentFaturasProcess: async () => proc,
    resolveBO1FaturasTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }),
    resolveHubSpotBO2SearchTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }),
    readVerifiedBO1FaturasIds: async () => ['456', '789'],
    hasVisibleNormalFaturasResult: async () => visibleNormal,
    rememberBO1FaturasBaseIds: (_proc, _tabId, target, ids) => {
      cache.faturasBaseResult = { mode: target.mode, value: target.value, ids };
      calls.push('base-ids');
      return true;
    },
    invalidateBO1FaturasRun: () => calls.push('cancel'),
    startBO1FaturasSearchIfReady: (_proc, options) => calls.push(['search', options.force]),
    syncSessionCache: () => calls.push('sync'),
    sendToTab: (_tabId, message) => calls.push(message.action),
    chrome: { tabs: { sendMessage: async (_tabId, message) => {
      if (message.action === 'SELECT_FATURAS_ID_FOR_BUYER') {
        calls.push(['visible-check', cache.selectedFaturaId, message.targets,
          context.bo1FaturasPreservedTargets.has(7)]);
        const targetIndex = message.targets.findIndex(target => target.mode === 'email');
        return context.visibleResult
          ? { found: true, index: 3, productId: '300', targetIndex,
            ids: ['456', '456', '789'] } : { found: false };
      }
      return { found: true, index: 3, productId: '300' };
    } } }
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
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'visible-check' &&
    call[1] === '456'));
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('visible invoice wins over an incomplete cached base ID list', async () => {
  const { context, cache, calls } = harness({ found: true });
  cache.faturasBaseResult = { mode: 'email', value: 'customer@example.invalid', ids: ['456'] };
  assert.equal(await context.select('789', 7), true);
  assert.equal(cache.selectedFaturaRowIndex, 3);
  assert.ok(cache.faturasBaseResult.ids.includes('789'));
  assert.equal(calls.includes('cancel'), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('visible email result selects the invoice when completed and base caches are absent', async () => {
  const { context, cache, calls } = harness({ found: true });
  context.bo1FaturasLastCompleted.clear();
  assert.equal(await context.select('789', 7), true);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'visible-check'));
  assert.equal(cache.selectedFaturaId, '789');
  assert.ok(calls.includes('base-ids'));
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('visible selection ignores an old buyer target after the ticket search value changes', async () => {
  const { context, cache, calls } = harness({ found: true });
  context.bo1FaturasLastCompleted.set(3, { ticketId: '123', mode: 'email',
    value: 'old@example.invalid' });
  cache.faturasBaseResult = { mode: 'email', value: 'old@example.invalid', ids: ['789'] };
  assert.equal(await context.select('789', 7), true);
  const checkedTargets = calls.find(call => Array.isArray(call) &&
    call[0] === 'visible-check')?.[2];
  assert.deepEqual([...checkedTargets].map(target => target.value),
    ['customer@example.invalid']);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
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
    getClientRects: () => [1],
    querySelector: selector => selector === 'td'
      ? { get textContent() { return `Cliente exemplo ${buyerEmail} CPF/CNPJ: `; } }
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

test('Faturas result proof ignores stale hidden rows and normalizes the target', () => {
  const from = source.indexOf('function bo1FaturasResultProofScript(');
  const to = source.indexOf('async function readVerifiedBO1FaturasIds(', from);
  const popup = { textContent: 'Status da fatura:', querySelector: () => null };
  const row = (id, email, visible) => ({
    getClientRects: () => visible ? [1] : [],
    querySelector: selector => selector === 'td'
      ? { textContent: `Cliente ${email} CPF/CNPJ: ` }
      : selector === 'td:first-child p.css-1ypxnh [aria-label] span'
        ? { textContent: id } : null
  });
  const rows = [row('456', 'customer@example.invalid', true),
    row('999', 'old@example.invalid', false)];
  const table = { getClientRects: () => [1], closest: () => popup,
    querySelectorAll: () => rows };
  const context = { location: { origin: 'https://bo.eduzz.com' },
    document: { querySelectorAll: () => [table] } };
  const capture = vm.runInNewContext(`${source.slice(from, to)}\nbo1FaturasResultProofScript`, context);
  assert.deepEqual([...capture('CUSTOMER@example.invalid', 'email', null, true)], ['456']);
});

test('manual Faturas shortcut waits for the same ticket auto-search and reuses its popup', async () => {
  const from = source.indexOf('async function runManualBO1FaturasSearch(');
  const to = source.indexOf('async function selectCurrentTicketFaturasRow(', from);
  assert.ok(from >= 0 && to > from);
  let finishAuto;
  const entry = { key: 'doc:12345678901', pending: true,
    promise: new Promise(resolve => { finishAuto = resolve; }) };
  const calls = [];
  const proc = { processId: 'p1', ticketId: '123', tabId: 7, status: 'SIDEBAR_RESOLVED' };
  const target = { mode: 'doc', value: '12345678901' };
  const context = {
    bo1FaturasManualRequest: 0, bo1FaturasAutoStarted: new Map([['p1', entry]]),
    lastTicketTabId: 7, boTab1Id: 3, currentTicketEpoch: 1,
    sessionCache: { 7: { id: '123' } }, processes: new Map([[7, proc]]),
    ensureSessionStateReady: async () => true, isExtensionEnabled: () => true,
    getExistingTab: async id => id === 7
      ? { url: 'https://app.hubspot.com/help-desk/ticket/123' }
      : { id: 3, windowId: 9 },
    extractHubSpotTicketIdFromUrl: () => '123',
    isRequesterLookupPending: () => false,
    definedSearchValueForProcess: () => '',
    resolveBO1FaturasTarget: () => target,
    settleBOPageFocus: async () => {},
    reuseVisibleSelectedFatura: async () => false,
    hasVisibleBO1FaturasResult: async () => { calls.push('visible-proof'); return true; },
    readVerifiedBO1FaturasIds: async () => ['456'],
    rememberBO1FaturasBaseIds: () => true,
    restoreCurrentFaturasSelection: async () => true,
    focusBO1DashboardPage: async () => { throw Error('Should not focus the dashboard'); },
    runBO1FaturasSearch: async () => { throw Error('Should not submit a second search'); },
    chrome: { tabs: { update: async () => { calls.push('focused-tab'); } },
      windows: { update: async () => {} } }
  };
  vm.runInNewContext(`${source.slice(from, to)}\nthis.run = runManualBO1FaturasSearch;`, context);
  const manual = context.run();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['focused-tab']);
  entry.succeeded = true;
  entry.pending = false;
  finishAuto();
  assert.equal(await manual, true);
  assert.deepEqual(calls, ['focused-tab', 'visible-proof']);
});

test('visible Faturas popup verifies every buyer and selects the highlighted invoice atomically', () => {
  const faturas = fs.readFileSync(path.join(__dirname, '..', 'project',
    'faturas_age_badge.js'), 'utf8');
  const from = faturas.indexOf('function selectInvoiceForBuyer(');
  const to = faturas.indexOf('function selectedProductCell(', from);
  assert.ok(from >= 0 && to > from);
  let buyer = 'customer@example.invalid';
  let selected = 0;
  const rows = ['456', '789'].map(id => ({ id, getClientRects: () => [1],
    querySelector: () => ({ get textContent() {
      return `Cliente Exemplo ${buyer} CPF/CNPJ: `;
    } }) }));
  const popup = { textContent: 'Status da fatura:', getClientRects: () => [1],
    closest: () => null,
    querySelector: selector => selector.includes('MuiSelect-nativeInput')
      ? { value: '100' } : selector.includes('aria-busy') ? null : {},
    querySelectorAll: () => rows };
  const context = { enabled: true, MAX_SELECTABLE_ROWS: 100,
    document: { querySelectorAll: () => [popup] },
    getComputedStyle: () => ({ visibility: 'visible' }),
    visibleInvoiceRows: () => rows, invoiceIdFromRow: row => row.id,
    productIdFromRow: () => 'product_1',
    selectInvoiceRow: (_row, index) => { selected = index; return '789'; } };
  const select = vm.runInNewContext(`${faturas.slice(from, to)}\nselectInvoiceForBuyer`, context);
  const target = [{ mode: 'email', value: 'customer@example.invalid' }];
  const found = select('789', '123', target);
  assert.equal(found.index, 2);
  assert.equal(found.targetIndex, 0);
  assert.deepEqual([...found.ids], ['456', '789']);
  assert.equal(selected, 2);
  buyer = 'different@example.invalid';
  selected = 0;
  assert.equal(select('789', '123', target), null);
  assert.equal(selected, 0);
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
  context.visibleResult = true;
  entry.succeeded = true;
  entry.pending = false;
  assert.equal(await selecting, true);
  assert.equal(cache.selectedFaturaRowIndex, 3);
  assert.equal(calls.find(call => Array.isArray(call) &&
    call[0] === 'visible-check')?.[3], true);
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

test('clearing an invoice selected from the normal popup keeps that result open', async () => {
  const { context, cache, calls } = harness({ overrideId: '456', visibleNormal: true });
  assert.equal(await context.clear(), true);
  assert.equal(cache.selectedFaturaId, null);
  assert.ok(calls.includes('CLEAR_FATURAS_SELECTION'));
  assert.equal(calls.includes('cancel'), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'search'), false);
});

test('clearing an invoice-only popup restores the normal target', async () => {
  const { context, cache, calls } = harness({ overrideId: '456' });
  assert.equal(await context.clear(), true);
  assert.equal(cache.selectedFaturaId, null);
  assert.equal(cache.selectedFaturaProductId, null);
  assert.equal(cache.faturasSearchById, false);
  assert.equal(cache.faturasSearchInvoiceId, null);
  assert.ok(calls.includes('CLEAR_FATURAS_SELECTION'));
  assert.ok(calls.includes('cancel'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'search' && call[1]));
});

test('a visible buyer alone does not prove that the normal popup is open', async () => {
  const from = source.indexOf('async function hasVisibleNormalFaturasResult(');
  const to = source.indexOf('function rememberBO1FaturasBaseIds(', from);
  const proc = { tabId: 7, ticketId: '123' };
  const cache = { faturasBaseResult: { mode: 'email', value: 'customer@example.invalid',
    ids: ['456'] } };
  const completed = new Map([[3, { ticketId: '123', mode: 'invoice', value: '456' }]]);
  let reads = 0;
  const context = { Number, boTab1Id: 3, sessionCache: { 7: cache },
    bo1FaturasRuns: new Map(), bo1FaturasLastCompleted: completed,
    resolveHubSpotBO2SearchTarget: () => ({ mode: 'email', value: 'customer@example.invalid' }),
    readVerifiedBO1FaturasIds: async () => { reads++; return ['456']; },
    isCurrentTicketOwnerProcess: () => true };
  vm.runInNewContext(`${source.slice(from, to)}\nthis.prove = hasVisibleNormalFaturasResult;`, context);
  assert.equal(await context.prove(proc, 3), false);
  assert.equal(reads, 0);
  completed.set(3, { ticketId: '123', mode: 'email', value: 'customer@example.invalid' });
  assert.equal(await context.prove(proc, 3), true);
  assert.equal(reads, 1);
  completed.clear();
  assert.equal(await context.prove(proc, 3), false);
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
