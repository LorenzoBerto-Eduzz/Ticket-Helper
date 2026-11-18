const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');

test('foreign or invalid document uses the email across Faturas entry points', () => {
  const helpersFrom = source.indexOf('function normalizeDocForFaturasSearch(');
  const helpersTo = source.indexOf('let boSearchBusy', helpersFrom);
  const targetFrom = source.indexOf('function definedSearchValueForProcess(');
  const targetTo = source.indexOf('function isRequesterLookupPending(', targetFrom);
  const content = fs.readFileSync(path.join(__dirname, '..', 'project', 'content.js'), 'utf8');
  const contentFrom = content.indexOf('function normalizeDocForAction(');
  const contentTo = content.indexOf('function resolveOrbitaActionTarget(', contentFrom);
  const context = { sessionCache: { 7: { id: 'ticket_123456' } } };
  vm.runInNewContext(`${source.slice(helpersFrom, helpersTo)}\n${source.slice(targetFrom, targetTo)}
    ${content.slice(contentFrom, contentTo)}
    this.normal = resolveHubSpotBO2SearchTarget;
    this.legacy = resolveFaturasSearchValue;
    this.popup = resolveFaturasActionTarget;`, context);
  const data = { tabId: 7, ticketId: 'ticket_123456', status: 'SIDEBAR_RESOLVED',
    doc: '> Doc. Estrang./Inválido', accounts: '-', email: 'customer@example.invalid' };
  for (const target of [context.normal(data), context.legacy(data), context.popup(data)]) {
    assert.equal(target.mode, 'email');
    assert.equal(target.value, 'customer@example.invalid');
  }
  assert.equal(context.normal({ ...data, doc: '12345678901' }).mode, 'doc');
  assert.equal(context.normal({ ...data, doc: '> Conta sem doc' }).mode, 'email');
});

test('action recovery retains the foreign-document status after a worker restart', () => {
  const helpersFrom = source.indexOf('function normalizeDocForFaturasSearch(');
  const helpersTo = source.indexOf('let boSearchBusy', helpersFrom);
  const snapshotFrom = source.indexOf('function normalizeActionProcessSnapshotField(');
  const snapshotTo = source.indexOf('// MV3 service workers can restart', snapshotFrom);
  const context = { normalizeSearchableField: value => String(value || '').trim() };
  vm.runInNewContext(`${source.slice(helpersFrom, helpersTo)}
    ${source.slice(snapshotFrom, snapshotTo)}
    this.snapshot = buildActionProcessSnapshot;`, context);
  const result = context.snapshot({ doc: '> Doc. Estrang./Inválido',
    email: 'customer@example.invalid' }, {}, 'ticket_123456');
  assert.equal(result.doc, '> Doc. Estrang./Inválido');
});

test('manual value overrides normal searches while the selected invoice owns Faturas', () => {
  const from = source.indexOf('function definedSearchValueForProcess(');
  const to = source.indexOf('function isRequesterLookupPending(', from);
  const invoiceFrom = source.indexOf('function resolveBO1FaturasTarget(');
  const invoiceTo = source.indexOf('function invalidateBO1FaturasRun(', invoiceFrom);
  const cache = { id: 'ticket_123456', definedSearchValue: '  any search value  ' };
  const context = {
    sessionCache: { 7: cache },
    bo1FaturasPreservedTargets: new Map(),
    hasValidDocLength: value => /^\d{11}$/.test(value),
    normalizeDocForFaturasSearch: value => value,
    normalizeEmailForFaturasSearch: value => value,
    isNoDocStatus: () => false,
    isForeignOrInvalidDocStatus: () => false
  };
  vm.runInNewContext(`${source.slice(from, to)}\n${source.slice(invoiceFrom, invoiceTo)}
    this.normal = resolveHubSpotBO2SearchTarget;
    this.faturas = resolveBO1FaturasTarget;`, context);
  const proc = { tabId: 7, ticketId: 'ticket_123456', status: 'SIDEBAR_RESOLVED',
    email: 'original@example.invalid', doc: '12345678901' };
  assert.equal(context.normal(proc).value, 'any search value');
  assert.equal(context.faturas(proc).value, 'any search value');
  cache.selectedFaturaId = '987654';
  assert.equal(context.faturas(proc).value, '987654');
  assert.equal(context.normal(proc).value, 'any search value');
  cache.selectedFaturaId = null;
  assert.equal(context.faturas(proc).value, 'any search value');
  cache.definedSearchValue = null;
  assert.equal(context.normal(proc).value, '12345678901');
});

test('defining and clearing a value keeps it on the owning ticket only', async () => {
  const from = source.indexOf('let definedSearchValueRequest = 0;');
  const to = source.indexOf('async function runSelectedFaturaMenuOption(', from);
  const cache = { id: '123', definedSearchValue: null };
  const calls = [];
  const proc = { tabId: 7, ticketId: '123', status: 'SIDEBAR_RESOLVED' };
  let makeSessionReady;
  const sessionStateReadyPromise = new Promise(resolve => { makeSessionReady = resolve; });
  const context = {
    lastTicketTabId: 7, currentTicketEpoch: 1, sessionCache: { 7: cache },
    sessionStateReadyPromise, isExtensionEnabled: () => true,
    getExistingTab: async id => ({ url: id === 7
      ? 'https://app.hubspot.com/help-desk/ticket/123'
      : 'https://app.hubspot.com/help-desk/ticket/999' }),
    extractHubSpotTicketIdFromUrl: url => url.match(/ticket\/(\d+)/)?.[1] || null,
    currentFaturasProcess: async () => proc,
    restartDefinedValueSearches: () => calls.push('search'),
    syncSessionCache: () => calls.push('sync'),
    sendToTab: (_id, message) => calls.push(message.action),
    chrome: { tabs: { query: async () => [{ id: 7 }] } }
  };
  vm.runInNewContext(`${source.slice(from, to)}
    this.define = defineOrCopySearchValue; this.clear = clearDefinedSearchValue;`, context);
  // The function in the slice uses its own restart helper, so supply the
  // dependent search functions as no-op counters.
  for (const name of ['invalidateBO2CustomerRun', 'invalidateBO2NutrorRun',
    'invalidateBO1ContratosRun', 'invalidateBO1FaturasRun',
    'startBO2NutrorSearchIfReady', 'startBO1ContratosSearchIfReady',
    'startBO1FaturasSearchIfReady', 'runBO2CustomerCount']) context[name] = () => calls.push(name);
  context.bo2CustomerRuns = new Map();
  context.bo2OrbitaEmailCompleted = new Map();
  context.isCurrentTicketOwnerProcess = () => true;
  const delayedDefinition = context.define('  selected phrase  ', 7);
  await Promise.resolve();
  assert.equal(cache.definedSearchValue, null);
  makeSessionReady(true);
  assert.equal(await delayedDefinition, true);
  assert.equal(cache.definedSearchValue, 'selected phrase');
  assert.ok(calls.includes('startBO1FaturasSearchIfReady'));
  assert.equal(await context.define('wrong ticket', 8), false);
  assert.equal(cache.definedSearchValue, 'selected phrase');
  assert.equal(await context.clear(), true);
  assert.equal(cache.definedSearchValue, null);
  assert.ok(calls.includes('DEFINED_SEARCH_VALUE_CHANGED'));
});
