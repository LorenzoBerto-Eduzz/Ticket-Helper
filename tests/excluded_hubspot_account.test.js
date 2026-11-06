const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const content = fs.readFileSync(path.join(__dirname, '..', 'project', 'content.js'), 'utf8');

test('a sole excluded account uses the Solicitante name and email', () => {
  const requesterStart = content.indexOf('function readHubSpotRequester(');
  const requesterEnd = content.indexOf('function readHubSpotAccountTile(', requesterStart);
  const excludedStart = content.indexOf('function isExcludedUncachedHubSpotAccountDoc(');
  const watchEnd = content.indexOf('function extractHubSpot(', excludedStart);
  assert.ok(requesterStart >= 0 && requesterEnd > requesterStart);
  assert.ok(excludedStart >= 0 && watchEnd > excludedStart);

  const requesterTile = { querySelector(selector) {
    if (selector === '[data-test-id="0-1-Solicitante"]') return {};
    if (selector === '[data-test-id="contact-chicklet-email"] a[href^="mailto:"]')
      return { textContent: 'template@email.com' };
    if (selector === '[data-test-id="contact-chicklet-title-link"]')
      return { textContent: 'Cliente Exemplo' };
    return null;
  } };
  const requesterCard = {
    querySelector: () => null,
    querySelectorAll: () => [requesterTile]
  };
  const accountTile = { querySelector: selector =>
    selector === '[data-test-id="formatted-property-cpf_cnpj"]'
      ? { textContent: '00000000000' } : null };
  const accountCard = {
    querySelector: selector => selector === '[data-selenium-test="chicklet"]'
      ? accountTile : null
  };
  const sidebar = { querySelector: () => ({ getAttribute: () => 'true' }) };
  let result;
  const context = {
    enabled: true, currentTicketId: 'ticket_123456', localTicketGeneration: 1,
    hubSpotAccountResult: null, hubSpotAccountWatch: null,
    location: { href: 'https://app.hubspot.com/help-desk/1/ticket/ticket_123456' },
    document: { visibilityState: 'visible' },
    extractHubSpotTicketIdFromText: () => 'ticket_123456',
    stopHubSpotAccountWatch: () => {},
    getVisibleHubSpotSidebar: () => sidebar,
    findMatchingHubSpotHeader: () => ({}),
    isHubSpotDetailsContentReady: () => true,
    findHubSpotEduzzAccountsCard: () => ({ count: 1, card: accountCard }),
    getHubSpotRequesterShell: () => ({ count: 1, card: requesterCard }),
    resolveHubSpotAccountResult: (_id, _generation, data) => { result = data; },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, setTimeout: () => 1, queueMicrotask: () => {}
  };
  vm.runInNewContext(`${content.slice(requesterStart, requesterEnd)}\n` +
    `${content.slice(excludedStart, watchEnd)}\nstartHubSpotAccountWatch('ticket_123456')`, context);
  assert.equal(result.kind, 'requester');
  assert.equal(result.name, 'Cliente Exemplo');
  assert.equal(result.email, 'template@email.com');
});

test('Faturas page-size failure uses the red notice without toolbar badge', async () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
  const start = background.indexOf('async function showBO1FaturasPageSizeStatus(');
  const end = background.indexOf('async function visibleBO1FaturasPageSize(', start);
  assert.ok(start >= 0 && end > start);
  const badge = [];
  const notices = [];
  const context = {
    chrome: { action: {
      setBadgeText: async data => badge.push(data.text),
      setTitle: async () => {}
    } },
    showTicketHelperNotice: (...args) => notices.push(args)
  };
  const show = vm.runInNewContext(`${background.slice(start, end)}\nshowBO1FaturasPageSizeStatus`, context);
  await show(1, false, true, 'sample diagnostic');
  assert.deepEqual(badge, ['']);
  assert.equal(notices.length, 1);
  assert.equal(notices[0][1], 'error');
  assert.equal(notices[0][2], 'FATURAS_PAGE_SIZE');
});
