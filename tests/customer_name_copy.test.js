const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['background.js', 'content.js']) {
  test(`${file} copies the email local part as the customer name`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'project', file), 'utf8');
    const start = source.indexOf('function firstCopyableTicketName(');
    const end = source.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start);
    const first = vm.runInNewContext(`${source.slice(start, end)}\nfirstCopyableTicketName`);
    assert.equal(first('carljohn.crazy@example.invalid'), 'Carljohn.crazy');
    assert.equal(first('Érica Exemplo'), 'Érica');
  });
}
