const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('const NOTICE_DURATION_MS =');
const end = source.indexOf('function clearRetiredProducerWarningsFromOpenBOTabs(', start);
assert.ok(start >= 0 && end > start);

test('notices stack newest first and follow the focused web tab', async () => {
  const calls = [];
  const messages = [];
  const timers = [];
  let focusedTabId = 11;
  let focusedUrl = 'https://example.invalid/';
  const context = {
    chrome: {
      runtime: {
        getURL: file => `chrome-extension://test/${file}`,
        sendMessage: async message => { messages.push(message); }
      },
      tabs: { query: async () => [{ id: focusedTabId, url: focusedUrl }] },
      scripting: { executeScript: async request => { calls.push(request); return []; } }
    },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {}
  };
  vm.createContext(context);
  const notices = vm.runInContext(`${source.slice(start, end)}\n({
    showTicketHelperNotice, renderNoticesOnFocusedTab
  })`, context);

  notices.showTicketHelperNotice('First', 'success');
  await notices.renderNoticesOnFocusedTab();
  notices.showTicketHelperNotice('Second', 'success');
  await notices.renderNoticesOnFocusedTab();
  const secondRender = calls.at(-1);
  assert.equal(secondRender.target.tabId, 11);
  assert.equal(JSON.stringify(secondRender.args[0].map(item => item.text)),
    JSON.stringify(['Second', 'First']));

  focusedTabId = 22;
  await notices.renderNoticesOnFocusedTab();
  assert.ok(calls.some(call => call.target.tabId === 11 && !call.args));
  assert.equal(calls.at(-1).target.tabId, 22);

  focusedTabId = 33;
  focusedUrl = 'chrome-extension://test/options.html';
  await notices.renderNoticesOnFocusedTab();
  assert.equal(messages.at(-1).tabId, 33);
  assert.equal(messages.at(-1).notices.length, 2);

  notices.showTicketHelperNotice('Failure', 'error', 'MANUAL_DELIVERY_TIMEOUT',
    'completed=1 total=3');
  await notices.renderNoticesOnFocusedTab();
  assert.throws(() => timers.at(-1)(), /TicketHelper MANUAL_DELIVERY_TIMEOUT: completed=1 total=3/);
});
