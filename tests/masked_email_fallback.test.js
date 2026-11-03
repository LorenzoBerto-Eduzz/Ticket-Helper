const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = background.indexOf('function maskEmailForBO2Copy(');
const end = background.indexOf('function performShortcutCopy(', start);
assert.ok(start >= 0 && end > start);

function makeCopyContext(snapshot) {
  let copiedValue = null;
  let feedbackField = null;
  const context = {
    ensureSessionStateReady: async () => true,
    isExtensionEnabled: () => true,
    lastTicketTabId: 10,
    currentTicketEpoch: 1,
    sessionCache: { 10: { id: '123', email: 'template@email.com', ...snapshot } },
    processes: new Map(),
    pendingTicketFocusTabId: null,
    backOffice2TabIds: [20],
    getExistingTab: async () => ({ url: 'https://app.hubspot.com/help-desk/1/ticket/123' }),
    extractHubSpotTicketIdFromUrl: url => url.match(/\/ticket\/(\d+)/)?.[1] || null,
    hasCompletedBO2CustomerCount: value => /^.+ \| [1-4]$/.test(value),
    copyValueViaOffscreen: (value, done) => { copiedValue = value; done(true); },
    copyValueInActiveTab: (_value, done) => done(false),
    notifyShortcutCopySuccess: (_tabId, field) => { feedbackField = field; }
  };
  const copy = vm.runInNewContext(
    `${background.slice(start, end)}\ncopyMaskedBO2EmailsOrAssignTabs`, context);
  return { context, copy, copied: () => copiedValue, feedback: () => feedbackField };
}

test('confirmed Orbita no-account result masks the ticket email and flashes Email', async () => {
  const state = makeCopyContext({ accounts: '> Nenhuma conta', accountsSource: 'bo2_customer' });
  assert.equal((await state.copy()).ok, true);
  assert.equal(state.copied(), 'te****ate@email.com');
  assert.equal(state.feedback(), 'email');
});

test('requester email with confirmed no account also masks its email', async () => {
  const state = makeCopyContext({ doc: '> Email sem conta', accounts: '-' });
  assert.equal((await state.copy()).ok, true);
  assert.equal(state.copied(), 'te****ate@email.com');
  assert.equal(state.feedback(), 'email');
});

test('ordinary Orbita results still copy their returned masked emails', async () => {
  const state = makeCopyContext({ accounts: 'Cliente | 2', accountsSource: 'bo2_customer',
    maskedEmails: 'ab****@email.com\ncd****@email.com' });
  assert.equal((await state.copy()).ok, true);
  assert.equal(state.copied(), 'ab****@email.com\ncd****@email.com');
  assert.equal(state.feedback(), 'accounts');
});

test('unconfirmed empty account state does not copy the ticket email', async () => {
  const state = makeCopyContext({ accounts: '-', accountsSource: null });
  assert.equal((await state.copy()).ok, false);
  assert.equal(state.copied(), null);
});
