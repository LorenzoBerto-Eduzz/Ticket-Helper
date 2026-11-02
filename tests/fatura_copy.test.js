const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = background.indexOf('function capitalizeFaturaCopiedWords(');
const end = background.indexOf('async function runSelectedFaturaAction(', start);
assert.ok(start >= 0 && end > start);
const copyText = vm.runInNewContext(
  `${background.slice(start, end)}\nformatSelectedFaturaCopyValue`
);

test('support email copies in lowercase without title casing the address', () => {
  assert.equal(copyText('email', 'AgencySupport@Example.Invalid'), 'agencysupport@example.invalid');
});

test('producer names retain title casing and invoice data remains unchanged', () => {
  assert.equal(copyText('name', 'EXAMPLE PRODUCER'), 'Example Producer');
  assert.equal(copyText('data', 'Invoice: 123\nBuyer: EXAMPLE'), 'Invoice: 123\nBuyer: EXAMPLE');
});
