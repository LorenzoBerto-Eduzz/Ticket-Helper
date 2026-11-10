const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'content.js'), 'utf8');
const start = source.indexOf('function readHubSpotRequester(');
const end = source.indexOf('function readHubSpotAccountTile(', start);
assert.ok(start >= 0 && end > start);

test('Solicitante full title supplies the name when no account is found', () => {
  const tile = { querySelector(selector) {
    if (selector === '[data-test-id="0-1-Solicitante"]') return {};
    if (selector === '[data-test-id="contact-chicklet-email"] a[href^="mailto:"]')
      return { textContent: 'template@email.com' };
    if (selector === '[data-test-id="contact-chicklet-title-link"]')
      return { textContent: 'Cliente Exemplo' };
    return null;
  } };
  const card = {
    querySelector: () => null,
    querySelectorAll: () => [tile]
  };
  const context = { getHubSpotRequesterShell: () => ({ card, count: 1 }) };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.read = readHubSpotRequester;`, context);
  const result = context.read({});
  assert.equal(result.kind, 'requester');
  assert.equal(result.name, 'Cliente Exemplo');
  assert.equal(result.email, 'template@email.com');
});

test('Solicitante name remains available when its email is missing', () => {
  const tile = { querySelector(selector) {
    if (selector === '[data-test-id="0-1-Solicitante"]') return {};
    if (selector === '[data-test-id="contact-chicklet-title-link"]')
      return { textContent: 'Cliente Exemplo' };
    return null;
  } };
  const context = { getHubSpotRequesterShell: () => ({
    card: { querySelector: () => null, querySelectorAll: () => [tile] }, count: 1
  }) };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.read = readHubSpotRequester;`, context);
  const result = context.read({});
  assert.equal(result.kind, 'no_email');
  assert.equal(result.name, 'Cliente Exemplo');
});

function nameHelpers() {
  const firstStart = source.indexOf('function firstCopyableTicketName(');
  const firstEnd = source.indexOf('\n}', firstStart) + 2;
  const helperStart = source.indexOf('function capitalizeNameWords(');
  const helperEnd = source.indexOf('function findHubSpotEduzzAccountsCard(', helperStart);
  assert.ok(firstStart >= 0 && firstEnd > firstStart && helperStart >= 0 && helperEnd > helperStart);
  const context = {};
  vm.runInNewContext(`${source.slice(firstStart, firstEnd)}\n${source.slice(helperStart, helperEnd)}\n` +
    'this.choose = preferredHubSpotCustomerName; this.display = displayHubSpotCustomerName;', context);
  return context;
}

test('ordinary Solicitante name wins over a matching account name', () => {
  const { choose, display } = nameHelpers();
  const requester = { name: 'Cliente Exemplo', email: 'template@email.com' };
  const account = { name: 'Razão Social Exemplo', email: 'template@email.com' };
  assert.equal(display(choose(requester, account)), 'Cliente Exemplo');
});

test('email-shaped Solicitante name uses only a matching account name', () => {
  const { choose, display } = nameHelpers();
  const requester = { name: 'lujob1@gmail.com', email: 'lujob1@gmail.com' };
  const account = { name: 'Cliente da Conta', email: 'lujob1@gmail.com' };
  assert.equal(display(choose(requester, account)), 'Cliente Da Conta');
  assert.equal(display(choose(requester, { ...account, email: 'other@example.invalid' })), 'Lujob1');
});

test('email-shaped name falls back to its local part when account name is unavailable', () => {
  const { choose, display } = nameHelpers();
  const requester = { name: 'lujob1@gmail.com', email: 'lujob1@gmail.com' };
  assert.equal(display(choose(requester, { name: '-', email: requester.email })), 'Lujob1');
  assert.equal(display('carljohn.crazy@example.invalid'), 'Carljohn.crazy');
});
