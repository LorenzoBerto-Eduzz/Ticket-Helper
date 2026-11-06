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
