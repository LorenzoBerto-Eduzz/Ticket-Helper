const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'discord_slate_adapter.js'), 'utf8');

function setup(abbreviation = 'rcp') {
  const listeners = new Map();
  class Element {
    constructor() { this.parentElement = null; }
    getAttribute(name) { return name === 'data-slate-editor' ? 'true' : null; }
  }
  class DataTransfer {
    setData(type, value) { this[type] = value; }
  }
  const field = new Element();
  const leaf = { text: abbreviation };
  const editor = {
    children: [{ children: [leaf] }],
    selection: { anchor: { path: [0, 0], offset: abbreviation.length },
      focus: { path: [0, 0], offset: abbreviation.length } },
    deleteBackward() {
      leaf.text = leaf.text.slice(0, -1);
      this.selection.anchor.offset--;
      this.selection.focus.offset--;
    },
    insertData(transfer) { leaf.text += transfer['text/plain']; }
  };
  field.__reactFiber$test = { memoizedProps: { editor }, return: null };
  const context = { Element, DataTransfer, document: {
    activeElement: field,
    addEventListener: (name, callback) => { listeners.set(name, callback); }
  }, console };
  vm.runInNewContext(source, context);
  function fire(name, text) {
    let handled = false;
    listeners.get('tickethelper:discord-slate-insert')({ target: field, detail: { abbreviation: name, text },
      preventDefault() { handled = true; } });
    return handled;
  }
  function firePicker(text, expectedLeaf = abbreviation, offset = abbreviation.length) {
    let handled = false;
    listeners.get('tickethelper:discord-slate-picker-insert')({ target: field,
      detail: { text, leaf: expectedLeaf, offset },
      preventDefault() { handled = true; } });
    return handled;
  }
  return { leaf, fire, firePicker };
}

test('Discord macro uses Slate operations so the message model receives its text', () => {
  const state = setup();
  assert.equal(state.fire('rcp', 'Olá\n\nMensagem'), true);
  assert.equal(state.leaf.text, 'Olá\n\nMensagem');
});

test('Discord adapter leaves the editor untouched if the abbreviation differs', () => {
  const state = setup();
  assert.equal(state.fire('other', 'Mensagem'), false);
  assert.equal(state.leaf.text, 'rcp');
});

test('picker insertion updates the Slate model only at the original caret', () => {
  const state = setup();
  assert.equal(state.firePicker('Mensagem', 'outro'), false);
  assert.equal(state.leaf.text, 'rcp');
  assert.equal(state.firePicker('Mensagem'), true);
  assert.equal(state.leaf.text, 'rcpMensagem');
});
