const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../project/search_filter_core.js');

test('options searches match key or body without case or accent differences', () => {
  assert.equal(search.matches('preparacao', ['abc', 'Preparação para o cliente']), true);
  assert.equal(search.matches('PRODUTOR', ['XXprodutorXX', 'Colocar em cópia']), true);
  assert.equal(search.matches('reembolso', ['abc', 'Entrega manual']), false);
});

test('an empty submitted search shows all items', () => {
  assert.equal(search.matches('  ', ['Qualquer valor']), true);
});
