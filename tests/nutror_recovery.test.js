const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('async function reloadBO2TabsAfterNutrorError(');
const end = source.indexOf('async function runBO2NutrorSearch(', start);
assert.ok(start >= 0 && end > start);

test('Nutror recovery reloads only the two assigned BO2 tabs once for a live ticket', async () => {
  const reloaded = [];
  const context = {
    bo2NutrorRecoveryKeys: new Set(),
    backOffice2TabIds: [101, 102],
    bo2CustomerRuns: new Map(),
    bo2OrbitaEmailCompleted: new Map(),
    chrome: { tabs: { reload: async tabId => { reloaded.push(tabId); } } },
    getExistingTab: async tabId => ({ id: tabId, status: 'complete' }),
    setTimeout: callback => callback()
  };
  vm.createContext(context);
  const recover = vm.runInContext(`${source.slice(start, end)}\nreloadBO2TabsAfterNutrorError`, context);
  const proc = { processId: 'process_1' };
  const target = { mode: 'email', value: 'template@email.com' };

  assert.equal(await recover(proc, target, () => false), false);
  assert.deepEqual(reloaded, []);
  assert.equal(await recover(proc, target, () => true), true);
  assert.deepEqual(reloaded, [101, 102]);
  assert.equal(await recover(proc, target, () => true), false);
  assert.deepEqual(reloaded, [101, 102]);
});
