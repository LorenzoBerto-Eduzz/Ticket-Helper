const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = background.indexOf('async function runVerifyBounce(');
const end = background.indexOf('async function runManualBOSearchWithTabFeedback(', start);
assert.ok(start >= 0 && end > start);

function setup(results) {
  const calls = [];
  const context = {
    bounceActionPromise: null,
    ensureSessionStateReady: async () => true,
    isExtensionEnabled: () => true,
    boTab1Id: 1,
    backOffice2TabIds: [2],
    lastTicketTabId: 3,
    currentTicketEpoch: 4,
    sessionCache: { 3: { id: '123', email: 'buyer@example.invalid' } },
    getExistingTab: async id => id === 3
      ? { url: 'https://app.hubspot.com/help-desk/1/view/2/ticket/123' }
      : { id, url: 'https://bo2.eduzz.com/contact-center-2/sent-emails?thbo2tab3' },
    extractHubSpotTicketIdFromUrl: url => url.match(/\/ticket\/(\d+)/)?.[1] || null,
    ensureBounceTabBesideOrbita: async () => ({ id: 5, windowId: 6 }),
    settleBOPageFocus: async () => {},
    runBounceSearchOnce: async () => { calls.push('search'); return results.shift(); },
    isBounceTabUrl: url => url.includes('sent-emails?thbo2tab3'),
    chrome: {
      tabs: {
        update: async (id, changes) => ({ id, windowId: 6, ...changes }),
        reload: async () => { calls.push('reload'); }
      },
      windows: { update: async () => {} }
    }
  };
  return { calls, context, run: vm.runInNewContext(
    `${background.slice(start, end)}\nrunVerifyBounce`, context) };
}

test('Bounce rows need no reload', async () => {
  const { calls, run } = setup(['rows']);
  await run();
  assert.deepEqual(calls, ['search']);
});

test('empty Bounce result reloads its tab and searches exactly once more', async () => {
  const { calls, run } = setup(['empty', 'empty']);
  await run();
  assert.deepEqual(calls, ['search', 'reload', 'search']);
});

test('ticket ownership change prevents Bounce recovery', async () => {
  const state = setup(['empty']);
  state.context.runBounceSearchOnce = async () => {
    state.calls.push('search');
    state.context.currentTicketEpoch++;
    return 'empty';
  };
  await state.run();
  assert.deepEqual(state.calls, ['search']);
});

test('an existing Bounce tab keeps its user-chosen window and position', async () => {
  const from = background.indexOf('function ensureBounceTabBesideOrbita(');
  const to = background.indexOf('async function submitBounceSearchOnPage(', from);
  const existing = { id: 5, windowId: 8, index: 12, url: 'https://bo2.eduzz.com/contact-center-2/sent-emails?thbo2tab3' };
  const calls = [];
  const context = {
    bounceTabSetupPromise: null, backOffice2TabIds: [2],
    getExistingTab: async () => ({ id: 2, windowId: 6, index: 1 }),
    isBounceTabUrl: url => url.includes('thbo2tab3'),
    chrome: { tabs: {
      query: async () => [existing],
      move: async () => { calls.push('move'); return existing; },
      create: async () => { calls.push('create'); return existing; }
    } }
  };
  vm.runInNewContext(`${background.slice(from, to)}\nthis.ensure = ensureBounceTabBesideOrbita;`, context);
  assert.equal(await context.ensure(), existing);
  assert.deepEqual(calls, []);
});
