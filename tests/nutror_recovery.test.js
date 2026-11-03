const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('async function reloadAssignedBO2Tabs(');
const end = source.indexOf('async function runBO2NutrorSearch(', start);
assert.ok(start >= 0 && end > start);
const orbitaGuardStart = source.indexOf('function shouldReloadBO2AfterOrbitaEmpty(');
const orbitaGuardEnd = source.indexOf('function normalizeHubSpotAccountType(', orbitaGuardStart);
assert.ok(orbitaGuardStart >= 0 && orbitaGuardEnd > orbitaGuardStart);

const searchStart = source.indexOf('func: async (expectedValue, mode, runToken) => {', end);
const searchEnd = source.indexOf('\n      }\n    });', searchStart);
assert.ok(searchStart > end && searchEnd > searchStart);
const searchFunction = source.slice(searchStart + 'func: '.length,
  searchEnd + '\n      }'.length);

async function simulatedNutrorSearch(errorAppearsAt) {
  let elapsed = 0;
  class Input {
    constructor() { this._value = ''; this.disabled = false; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    dispatchEvent() {}
  }
  const input = new Input();
  const row = {
    getAttribute: () => 'row_1',
    querySelectorAll: () => [null, null, null, { textContent: '12345678901' }]
  };
  const table = {
    querySelectorAll: () => [row],
    querySelector: () => null
  };
  const query = {
    textContent: 'Resultado para: 12345678901',
    querySelector: () => ({ textContent: '12345678901' })
  };
  const error = {
    getClientRects: () => [1],
    querySelector: () => ({ textContent: 'Erro ao buscar cliente' })
  };
  const context = {
    Date: class extends Date { static now() { return elapsed; } },
    Event: class {}, KeyboardEvent: class {}, HTMLInputElement: Input,
    location: { origin: 'https://bo2.eduzz.com', pathname: '/nutror/clientes' },
    document: {
      querySelector: selector => selector === '#client-list-search' ? input : table,
      querySelectorAll: selector => selector === 'span.ant-typography-secondary' ? [query] :
        selector === '.ant-result.ant-result-error' && elapsed >= errorAppearsAt ? [error] : []
    },
    setTimeout: (callback, ms) => { elapsed += ms; callback(); }
  };
  vm.createContext(context);
  const search = vm.runInContext(`(${searchFunction})`, context);
  const result = await search('12345678901', 'doc', 'run_1');
  return { result: JSON.parse(JSON.stringify(result)), elapsed };
}

test('a Nutror error appearing after matching rows wins over the transient result', async () => {
  const { result, elapsed } = await simulatedNutrorSearch(1000);
  assert.deepEqual(result, { error: 'CLIENT_SEARCH_ERROR' });
  assert.equal(elapsed, 1000);
});

test('matching Nutror rows settle when no error appears', async () => {
  const { result, elapsed } = await simulatedNutrorSearch(Infinity);
  assert.deepEqual(result, { keys: ['row_1'] });
  assert.ok(elapsed >= 1200);
});

test('Nutror recovery reloads only the two assigned BO2 tabs once for a live ticket', async () => {
  const reloaded = [];
  const context = {
    bo2RecoveryKeys: new Set(),
    backOffice2TabIds: [101, 102],
    bo2CustomerRuns: new Map(),
    bo2OrbitaEmailCompleted: new Map(),
    sessionCache: {},
    syncSessionCache() {},
    chrome: { tabs: { reload: async tabId => { reloaded.push(tabId); } } },
    getExistingTab: async tabId => ({ id: tabId, status: 'complete' }),
    setTimeout: callback => callback()
  };
  vm.createContext(context);
  const recover = vm.runInContext(`${source.slice(orbitaGuardStart, orbitaGuardEnd)}\n${source.slice(start, end)}\nreloadBO2TabsAfterNutrorError`, context);
  const proc = { processId: 'process_1' };
  const target = { mode: 'email', value: 'template@email.com' };

  assert.equal(await recover(proc, target, () => false), false);
  assert.deepEqual(reloaded, []);
  assert.equal(await recover(proc, target, () => true), true);
  assert.deepEqual(reloaded, [101, 102]);
  assert.equal(await recover(proc, target, () => true), false);
  assert.deepEqual(reloaded, [101, 102]);
});

test('Orbita empty result refreshes only when HubSpot had an account card', async () => {
  const reloaded = [];
  const context = {
    bo2RecoveryKeys: new Set(),
    backOffice2TabIds: [101, 102],
    sessionCache: { 7: { id: 'ticket_123', hubspotAccountCardPresent: true } },
    syncSessionCache() {},
    invalidateBO2NutrorRun() {},
    chrome: { tabs: {
      query: async () => [{ id: 103, url: 'https://bo2.eduzz.com/contact-center-2/sent-emails?thbo2tab3' }],
      reload: async tabId => { reloaded.push(tabId); }
    } },
    isBounceTabUrl: url => String(url).includes('thbo2tab3'),
    getExistingTab: async tabId => ({ id: tabId, status: 'complete',
      url: tabId === 103 ? 'https://bo2.eduzz.com/contact-center-2/sent-emails?thbo2tab3' : '' }),
    setTimeout: callback => callback()
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(orbitaGuardStart, orbitaGuardEnd)}\n${source.slice(start, end)}`, context);
  const proc = { processId: 'process_1', ticketId: 'ticket_123', tabId: 7 };
  const target = { mode: 'doc', value: '12345678901' };
  assert.equal(context.shouldReloadBO2AfterOrbitaEmpty(proc, target, { kind: 'found' }), false);
  assert.equal(context.shouldReloadBO2AfterOrbitaEmpty(proc, target, { kind: 'none' }), true);
  assert.equal(await context.reloadBO2TabsAfterOrbitaEmpty(proc, target, () => true), true);
  assert.deepEqual(reloaded, [101, 102, 103]);
  assert.equal(context.shouldReloadBO2AfterOrbitaEmpty(proc, target, { kind: 'none' }), false);
  assert.equal(await context.reloadBO2TabsAfterOrbitaEmpty(proc, target, () => true), false);
  assert.deepEqual(reloaded, [101, 102, 103]);
  const other = { processId: 'process_2', ticketId: 'ticket_456', tabId: 8 };
  context.sessionCache[8] = { id: 'ticket_456', hubspotAccountCardPresent: false };
  assert.equal(context.shouldReloadBO2AfterOrbitaEmpty(other, target, { kind: 'none' }), false);
});
