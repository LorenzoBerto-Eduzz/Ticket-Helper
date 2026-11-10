const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../project/macro_library_core.js');

test('internal shortcut accepts Shift+Space and modifier letters', () => {
  assert.equal(core.normalizeShortcut('shift+space'), 'Shift+Space');
  assert.equal(core.eventShortcut({ code: 'Space', shiftKey: true }), 'Shift+Space');
  assert.equal(core.normalizeShortcut('ctrl+shift+q'), 'Ctrl+Shift+Q');
  assert.equal(core.normalizeShortcut('ctrl+shift+space'), 'Ctrl+Shift+Space');
  assert.equal(core.normalizeShortcut('Space'), '');
});

test('macro abbreviations cannot contain whitespace', () => {
  assert.equal(core.validAbbreviation('rcp'), true);
  assert.equal(core.validAbbreviation('rc p'), false);
  assert.equal(core.validAbbreviation('rc\tp'), false);
  assert.equal(core.validAbbreviation('rc\np'), false);
  assert.equal(core.validAbbreviation('r'.repeat(51)), false);
});

test('ProKeys settings export flattens folders and preserves rich and plain bodies', () => {
  const data = { hotKey: ['shiftKey', ' '], snippets: ['Snippets', 1,
    { name: 'first', body: '<p><strong>Text</strong></p>', timestamp: 2 },
    ['Folder', 3, { name: 'second', body: 'Line 1\nLine 2', timestamp: 4 }]] };
  assert.deepEqual(core.parseProKeys(JSON.stringify(data)), [
    { abbreviation: 'first', body: '<p><strong>Text</strong></p>' },
    { abbreviation: 'second', body: 'Line 1\nLine 2' }
  ]);
});

test('ProKeys migration removes abbreviation spaces without changing normal macro rules', () => {
  const prepared = core.prepareProKeysNames([
    { abbreviation: 'first reply', body: 'Text' },
    { abbreviation: 'second\tresponse', body: '<p>Text</p>' }
  ]);
  assert.deepEqual(prepared.map(row => [row.originalAbbreviation, row.abbreviation]), [
    ['first reply', 'firstreply'], ['second\tresponse', 'secondresponse']
  ]);
  assert.equal(core.validAbbreviation('first reply'), false);
  assert.throws(() => core.prepareProKeysNames([
    { abbreviation: 'a b', body: 'One' }, { abbreviation: 'ab', body: 'Two' }
  ]), /itens 1 e 2/);
});

test('lowest nonempty ID owns case-insensitive duplicate abbreviation', () => {
  assert.deepEqual(core.activeIndex([
    { id: 4, abbreviation: 'Rcp', html: 'Later' },
    { id: 1, abbreviation: 'rcp', html: 'Earlier' },
    { id: 2, abbreviation: 'RCP', html: 'Middle' }
  ]).map(row => [row.id, row.activeId]), [[1, 1], [2, 1], [4, 1]]);
});

test('invalid ProKeys files are refused', () => {
  assert.throws(() => core.parseProKeys('{"snippets":[]}'));
  assert.throws(() => core.parseProKeys('{"snippets":["Snippets",1,{}]}'));
});
