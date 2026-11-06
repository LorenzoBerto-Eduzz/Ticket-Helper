const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const content = fs.readFileSync(path.join(__dirname, '..', 'project', 'content.js'), 'utf8');
const start = content.indexOf('function updateActionButtonsState(');
const end = content.indexOf('function requestPopupOwnerState(', start);
assert.ok(start >= 0 && end > start);

test('the invoice row shows a dash when only a defined search value exists', () => {
  const actionRow = { hidden: true };
  const invoiceRow = { hidden: true };
  const definedRow = { hidden: true };
  let repositioned = 0;
  const popup = {
    style: { display: 'block' },
    querySelector(selector) {
      if (selector === '.th-search-actions') return actionRow;
      if (selector === '.th-selected-fatura-row') return invoiceRow;
      if (selector === '.th-defined-search-row') return definedRow;
      return null;
    },
    querySelectorAll: () => []
  };
  const context = {
    popup, boTabStateResolved: true, hasAnyAssignedBOTab: () => true,
    localData: { id: 'ticket_123456' }, selectedFaturaId: null,
    definedSearchValue: null,
    popupPositionReady: true,
    restoreOrClampPopupPosition: () => { repositioned++; },
    boTabState: { backOffice2TabsAssigned: [true, true],
      boTab1Assigned: true, boTab2Assigned: true }
  };
  const update = vm.runInNewContext(`${content.slice(start, end)}\nupdateActionButtonsState`, context);
  update();
  assert.equal(actionRow.hidden, false);
  assert.equal(invoiceRow.hidden, true);
  assert.equal(definedRow.hidden, true);

  context.selectedFaturaId = '456';
  update();
  assert.equal(invoiceRow.hidden, false);

  context.selectedFaturaId = null;
  update();
  assert.equal(invoiceRow.hidden, true);
  context.definedSearchValue = 'manual value';
  update();
  assert.equal(invoiceRow.hidden, false);
  assert.equal(definedRow.hidden, false);
  assert.equal(repositioned, 4);
});
