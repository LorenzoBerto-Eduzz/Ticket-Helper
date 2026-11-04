const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const recoveryStart = background.indexOf('function ensureAssignedFaturasVisuals(');
const recoveryEnd = background.indexOf('function rememberBOTabWindow(', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);

function makeRecovery({ ping, injectFails = false } = {}) {
  const calls = [];
  const context = {
    boTab1Id: 10,
    isExtensionEnabled: () => true,
    faturasVisualRecovery: new Map(),
    faturasVisualReloadedTabs: new Set(),
    getExistingTab: async () => ({ status: 'complete', url: 'https://bo.eduzz.com/dashboard/reembolso' }),
    isBackOfficeTabUrl: () => true,
    chrome: {
      tabs: {
        sendMessage: async () => { calls.push('ping'); return ping?.() ?? null; },
        reload: async () => { calls.push('reload'); }
      },
      scripting: {
        insertCSS: async () => { calls.push('css'); if (injectFails) throw Error('cannot inject'); },
        executeScript: async () => { calls.push('script'); }
      }
    }
  };
  const ensure = vm.runInNewContext(
    `${background.slice(recoveryStart, recoveryEnd)}\nensureAssignedFaturasVisuals`, context);
  return { ensure, calls };
}

test('a recovered Faturas tab with live visuals is reused without reloading', async () => {
  const { ensure, calls } = makeRecovery({ ping: () => ({ ready: true }) });
  assert.equal(await ensure(10), true);
  assert.deepEqual(calls, ['ping']);
});

test('a marked tab missing the current content script gets CSS and visuals restored', async () => {
  let pings = 0;
  const { ensure, calls } = makeRecovery({ ping: () =>
    ({ ready: ++pings > 1 }) });
  assert.equal(await ensure(10), true);
  assert.deepEqual(calls, ['ping', 'css', 'script', 'ping']);
});

test('failed Faturas reinjection reloads the marked tab at most once', async () => {
  const { ensure, calls } = makeRecovery({ injectFails: true });
  assert.equal(await ensure(10), false);
  assert.equal(await ensure(10), false);
  assert.deepEqual(calls, ['ping', 'css', 'reload', 'ping', 'css']);
});

const focusStart = background.indexOf('async function settleBOPageFocus(');
const focusEnd = background.indexOf('function focusBOTab(', focusStart);
assert.ok(focusStart >= 0 && focusEnd > focusStart);

test('extension-driven focus leaves a focused page alone and clears stale address focus', async () => {
  let focused = false;
  let focusCalls = 0;
  let tabIndex = null;
  const document = {
    visibilityState: 'visible',
    hasFocus: () => focused,
    body: {
      getAttribute: () => tabIndex,
      setAttribute: (_key, value) => { tabIndex = value; },
      removeAttribute: () => { tabIndex = null; },
      focus: () => { focusCalls++; focused = true; }
    }
  };
  const context = { document, chrome: { scripting: { executeScript: async ({ func }) => func() } } };
  const settle = vm.runInNewContext(
    `${background.slice(focusStart, focusEnd)}\nsettleBOPageFocus`, context);
  await settle(10);
  assert.equal(focusCalls, 1);
  assert.equal(tabIndex, null);
  await settle(10);
  assert.equal(focusCalls, 1);
});

const faturas = fs.readFileSync(path.join(__dirname, '..', 'project', 'faturas_age_badge.js'), 'utf8');
const visualsStart = faturas.indexOf('function faturasVisualsReady(');
const visualsEnd = faturas.indexOf('function scheduleRefresh(', visualsStart);
assert.ok(visualsStart >= 0 && visualsEnd > visualsStart);

test('a live Faturas script still rejects missing selection-marker styling', () => {
  const cell = { dataset: { thFaturasRowNumber: '1' } };
  const row = { classList: { contains: () => true }, querySelector: () => cell };
  const popup = { textContent: 'Status da fatura:', getClientRects: () => [1] };
  let markerContent = '"1"';
  const context = {
    document: { querySelectorAll: () => [popup] },
    getComputedStyle: (_node, pseudo) => pseudo
      ? { content: markerContent } : { visibility: 'visible' },
    visibleInvoiceRows: () => [row],
    STAGED_ROW_CLASS: 'staged'
  };
  const visualsReady = vm.runInNewContext(
    `${faturas.slice(visualsStart, visualsEnd)}\nfaturasVisualsReady`, context);
  assert.equal(visualsReady(), true);
  markerContent = 'none';
  assert.equal(visualsReady(), false);
});
