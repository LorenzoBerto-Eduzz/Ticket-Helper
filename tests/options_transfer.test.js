const assert = require('node:assert/strict');
const test = require('node:test');
const transfer = require('../project/options_transfer.js');

test('export filenames end with the local ddmmyy date', () => {
  const date = new Date(2026, 10, 6);
  assert.equal(transfer.exportFilename('macros', date),
    'TicketHelper-AutopreenchimentoDeMacros-061126.txt');
  assert.equal(transfer.exportFilename('producers', date),
    'TicketHelper-AvisosDeProdutores-061126.txt');
});

test('macro export and import preserve exact labels, named actions, and blank actions', () => {
  const pairs = [
    ['XXprodutorCopiaXX', 'Colocar produtor em cópia'],
    ['XXclienteXX', 'Colar nome do cliente'],
    ['XXpendenteXX', '']
  ];
  const text = transfer.serialize('macros', pairs);
  assert.ok(text.startsWith('1 Autopreenchimento de Macros\n\n'));
  assert.deepEqual(transfer.parse('macros', text), pairs);
  assert.deepEqual(transfer.parse('macros', `\uFEFF${text.replaceAll('\n', '\r\n')}`), pairs);
});

test('producer export and import preserve blank notices and UTF-8 text', () => {
  const pairs = [['Julho Souza', 'falar com Pedro Silva'], ['Universidade do Inglês', '']];
  const text = transfer.serialize('producers', pairs);
  assert.ok(text.startsWith('2 Avisos de Produtores\n\n'));
  assert.deepEqual(transfer.parse('producers', text), pairs);
  assert.deepEqual(transfer.parse('producers', transfer.serialize('producers', [])), []);
});

test('wrong section and incomplete items fail before any import mutation', () => {
  assert.throws(() => transfer.parse('macros',
    transfer.serialize('producers', [['Name', 'Note']])), /não pertence/);
  assert.throws(() => transfer.parse('macros',
    '1 Autopreenchimento de Macros\n\nXXkeyXX'), /incompleto/);
  assert.throws(() => transfer.parse('macros',
    '1 Autopreenchimento de Macros\n\nXXkeyXX\nAction\nother'), /linha vazia/);
  assert.throws(() => transfer.serialize('producers', [['Name', 'line one\nline two']]),
    /não cabe/);
});
