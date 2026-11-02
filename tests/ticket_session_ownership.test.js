const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = background.indexOf('function claimTicketOwner(');
const end = background.indexOf('function noteFocusedTab(', start);
assert.ok(start >= 0 && end > start);
const claimSource = background.slice(start, end);

test('A-B-A keeps each open ticket snapshot and retires old work', () => {
  const oldAProcess = { processId: 'old_a', ticketId: '101', status: 'COMPLETED' };
  const processes = new Map([[1, oldAProcess]]);
  const cache = {
    1: { id: '101', name: 'Example A', selectedFaturaId: '10001', faturasSearchById: true },
    2: { id: '202', name: 'Example B', selectedFaturaId: '20002', faturasSearchById: false }
  };
  const context = {
    Number, String, Promise, processes, sessionCache: cache,
    lastTicketTabId: 1, currentTicketEpoch: 0, activeHistoryCandidate: null,
    activeProcessId: 'old_a', pendingTicketFocusTabId: null,
    lastTicketWindowId: 1,
    updateActiveHistoryCandidateFromProcess() {}, finalizeActiveHistoryCandidate() {},
    syncTicketHistorySession() {}, syncSessionCache() {}, retireTicketBoundWork() {},
    sendToTab() {}, persistLastTicketTabId(tabId) { context.lastTicketTabId = tabId; },
    notifyTicketOwnerChanged() {}, getExistingTab: async () => ({ windowId: 1 }),
    scheduleBOWindowLayoutCapture() {}, boTab1Id: null
  };
  vm.runInNewContext(`${claimSource}\nthis.claimTicketOwner = claimTicketOwner;`, context);

  assert.equal(context.claimTicketOwner(2, '202'), true);
  assert.equal(oldAProcess.status, 'ABORTED');
  assert.equal(processes.size, 0);
  assert.equal(cache[1].selectedFaturaId, '10001');
  assert.equal(cache[2].selectedFaturaId, '20002');

  assert.equal(context.claimTicketOwner(1, '101'), true);
  assert.equal(context.lastTicketTabId, 1);
  assert.equal(context.currentTicketEpoch, 2);
  assert.equal(cache[1].faturasSearchById, true);
  assert.equal(cache[2].name, 'Example B');

  context.claimTicketOwner(1, '303');
  assert.equal(cache[1], undefined);
  assert.equal(cache[2].selectedFaturaId, '20002');
});

test('restoring a completed ticket keeps its invoice pin and search mode', () => {
  const restoreStart = background.indexOf('function restoreProcessFromTicketCache(');
  const restoreEnd = background.indexOf('function updateCacheFromProcess(', restoreStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  const cache = {
    1: {
      id: '101', name: 'Example A', email: 'a@example.invalid', doc: '12345678901',
      accounts: 'Cliente Final | 1', accountsSource: 'bo2_customer',
      accountType: 'Cliente Final', selectedFaturaId: '10001', faturasSearchById: true
    }
  };
  const processes = new Map();
  const context = {
    String, processes, sessionCache: cache,
    uid: () => 'restored_a',
    normalizeSearchableField: value => String(value || '').trim(),
    hasCompletedBO2CustomerCount: value => !!value && value !== '...',
    hasValidDocLength: value => /^\d{11}$|^\d{14}$/.test(value),
    isPendingProcessField: value => value == null || value === '...',
    isFinalRequesterLookupDoc: () => false,
    setActiveHistoryCandidate() {}
  };
  vm.runInNewContext(`${background.slice(restoreStart, restoreEnd)}\nthis.restore = restoreProcessFromTicketCache;`, context);
  const restored = context.restore(1, '101');
  assert.equal(restored.status, 'COMPLETED');
  assert.equal(restored.email, 'a@example.invalid');
  assert.equal(cache[1].selectedFaturaId, '10001');
  assert.equal(cache[1].faturasSearchById, true);
  assert.equal(context.restore(1, '202'), null);
});

test('leaving a background ticket deletes only its snapshot and paused reference', () => {
  const clearStart = background.indexOf('function clearCurrentTicketForTab(');
  const clearEnd = background.indexOf('function clearNeutralHubSpotTab(', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const cache = { 1: { id: '101' }, 2: { id: '202' } };
  const context = {
    Number, processes: new Map(), sessionCache: cache,
    lastTicketTabId: 2, currentTicketEpoch: 0,
    pausedTicketSnapshot: { tabId: 1, ticketId: '101' },
    persistPausedTicketSnapshot(value) { context.pausedTicketSnapshot = value; return Promise.resolve(); },
    finalizeActiveHistoryCandidateForProcess() {}, syncSessionCache() {},
    persistLastTicketTabId(value) { context.lastTicketTabId = value; },
    sendToTab() {}, retireTicketBoundWork() {}, notifyTicketOwnerChanged() {},
    boTab1Id: null, activeBOContextProcessId: null,
    activeBOContextTicketId: null, persistBOContextState() {}
  };
  vm.runInNewContext(`${background.slice(clearStart, clearEnd)}\nthis.clear = clearCurrentTicketForTab;`, context);

  context.clear(1);
  assert.equal(cache[1], undefined);
  assert.equal(cache[2].id, '202');
  assert.equal(context.lastTicketTabId, 2);
  assert.equal(context.pausedTicketSnapshot, null);

  context.clear(2);
  assert.equal(cache[2], undefined);
  assert.equal(context.lastTicketTabId, null);
  assert.equal(context.currentTicketEpoch, 1);
});
