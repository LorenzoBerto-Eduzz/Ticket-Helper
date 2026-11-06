const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('function placeInvoiceActionsFirstInPage(');
const end = source.indexOf('function capitalizeFaturaCopiedWords(', start);
assert.ok(start >= 0 && end > start);

test('invoice actions heading and its button table become the first two DOM elements', () => {
  const left = { children: [] };
  Object.defineProperties(left, {
    firstChild: { get: () => left.children[0] || null },
    firstElementChild: { get: () => left.children[0] || null },
    lastElementChild: { get: () => left.children.at(-1) || null }
  });
  left.insertBefore = (node, reference) => {
    left.children.splice(left.children.indexOf(node), 1);
    const index = reference ? left.children.indexOf(reference) : left.children.length;
    left.children.splice(index, 0, node);
  };
  const node = (label, className = '') => {
    const element = { textContent: label, matches: selector => selector === 'h3.invoice-table-title' &&
      className === 'title', classList: { contains: value => value === className } };
    Object.defineProperty(element, 'nextElementSibling', { get: () =>
      left.children[left.children.indexOf(element) + 1] || null });
    Object.defineProperty(element, 'nextSibling', { get: () =>
      left.children[left.children.indexOf(element) + 1] || null });
    return element;
  };
  const detailsHeading = node('Detalhes da fatura', 'title');
  const detailsTable = node('', 'invoice-table');
  const actionsHeading = node('Ações', 'title');
  const actionsTable = node('', 'invoice-table');
  const loading = node('', 'loading');
  loading.querySelector = selector => selector === 'svg.content-loader > title'
    ? { textContent: 'Loading...' } : null;
  left.children.push(detailsHeading, detailsTable, loading);
  const root = { querySelector: selector => selector === '.header > h3'
    ? { textContent: 'Detalhe da Fatura' } : left, getClientRects: () => [1] };
  let observe;
  class Observer {
    constructor(callback) { observe = callback; }
    observe() {}
    disconnect() {}
  }
  const context = { document: { documentElement: {}, querySelectorAll: () => [root] },
    MutationObserver: Observer, setTimeout: () => {}, clearTimeout: () => {} };
  vm.runInNewContext(`${source.slice(start, end)}\nplaceInvoiceActionsFirstInPage();`, context);
  assert.deepEqual(left.children, [loading, detailsHeading, detailsTable]);
  left.children.splice(0, 3, detailsHeading, detailsTable, actionsHeading, loading);
  observe();
  assert.deepEqual(left.children, [actionsHeading, loading, detailsHeading, detailsTable]);
  left.children.splice(0, 4, detailsHeading, detailsTable, actionsHeading, actionsTable);
  observe();
  assert.deepEqual(left.children, [actionsHeading, actionsTable, detailsHeading, detailsTable]);
  left.children.splice(0, 4, detailsHeading, detailsTable, actionsHeading, actionsTable);
  observe();
  assert.deepEqual(left.children, [actionsHeading, actionsTable, detailsHeading, detailsTable]);
});
