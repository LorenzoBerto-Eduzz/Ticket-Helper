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
const formatData = vm.runInNewContext(
  `${background.slice(start, end)}\nformatSelectedFaturaData`
);

test('support email copies in lowercase without title casing the address', () => {
  assert.equal(copyText('email', 'AgencySupport@Example.Invalid'), 'agencysupport@example.invalid');
});

test('producer names retain title casing and invoice data remains unchanged', () => {
  assert.equal(copyText('name', 'EXAMPLE PRODUCER'), 'Example Producer');
  assert.equal(copyText('data', 'Invoice: 123\nBuyer: EXAMPLE'), 'Invoice: 123\nBuyer: EXAMPLE');
});

test('invoice summary keeps only five fields and puts selected product first', () => {
  const native = [
    'Fatura: 123456', 'Valor: 250.00', 'Valor pago: 250.00 ( 1 x R$ 250,00 )',
    'Conteúdo: Produto Selecionado', 'Cliente: Pessoa Exemplo',
    'E-mail: template@email.com', 'DOC: 00000000000',
    'Produtor: Produtor Exemplo', 'Email de suporte: suporte@email.com',
    'Data da compra: 01/01/2026'
  ].join('\n\n');
  const result = formatData(native, '123456', ['Produto Selecionado', 'Outro Produto', 'Terceiro']);
  assert.equal(result, [
    'Fatura: 123456', 'Valor: 250.00', 'Valor pago: 250.00 ( 1 x R$ 250,00 )',
    'Conteúdo: Produto Selecionado,\nOutro Produto,\nTerceiro',
    'Data da compra: 01/01/2026'
  ].join('\n\n'));
  assert.equal(formatData(native, '999999', ['Produto Selecionado']), null);
  assert.equal(formatData(native, '123456', ['Outro Produto']), null);
});

test('Order Bump product names start with the selected row, then follow list order', async () => {
  const names = ['Primeiro Produto', 'Produto Selecionado', 'Terceiro Produto', 'Quarto Produto'];
  const rows = names.map((name, index) => ({
    getClientRects: () => [1],
    classList: { contains: value => value === 'th-faturas-selected-row' && index === 1 },
    querySelector: selector => {
      if (selector.startsWith('td:first-child')) return { textContent: '123456' };
      if (selector === '.badges [aria-label="Order Bump"]') return {};
      if (selector === 'td:nth-child(2)') return {
        querySelector: key => key === ':scope > p.css-1ypxnh'
          ? { textContent: String(100 + index) } : {
            textContent: name.slice(0, 8) + '...',
            querySelector: child => child === '[aria-label]'
              ? { getAttribute: () => name } : null
          }
      };
      return null;
    }
  }));
  const popup = { textContent: 'Status da fatura:', getClientRects: () => [1],
    querySelectorAll: () => rows };
  const context = { document: { querySelectorAll: () => [popup] },
    getComputedStyle: () => ({ visibility: 'visible' }),
    chrome: { scripting: { executeScript: async details =>
      [{ result: details.func(...details.args) }] } } };
  const helperStart = background.indexOf('async function readSelectedFaturaProductGroup(');
  const helperEnd = background.indexOf('async function getSelectedFaturaData(', helperStart);
  const read = vm.runInNewContext(`${background.slice(helperStart, helperEnd)}\nreadSelectedFaturaProductGroup`,
    context);
  const products = await read(20, '123456', 2);
  assert.deepEqual(Array.from(products, product => product.name),
    ['Produto Selecionado', 'Primeiro Produto', 'Terceiro Produto', 'Quarto Produto']);
});
