const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../project/macro_library_core.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'project',
  'macro_library_background.js'), 'utf8');

function setup(fetchImage = async () => { throw new Error('Image unavailable'); }) {
  let listener;
  let saved;
  const rows = [{ id: 1, abbreviation: 'Rcp', html: '<p>Old</p>' }];
  const store = {
    list: async () => rows,
    activeIndex: core.activeIndex,
    image: async () => null,
    saveCaptured: async value => { saved = value; return value.id || 2; }
  };
  const context = {
    TicketHelperMacroStore: store, TicketHelperMacroCore: core, Blob, atob, btoa,
    fetch: fetchImage, console, Date,
    chrome: { runtime: { onMessage: { addListener: callback => { listener = callback; } } },
      storage: { local: { set: async () => {} } } }
  };
  vm.runInNewContext(source, context);
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  return { send, get saved() { return saved; } };
}

test('captured selection replaces an exact abbreviation without creating another ID', async () => {
  const state = setup();
  const result = await state.send({ action: 'TH_MACRO_SAVE_CAPTURE',
    abbreviation: 'rcp', html: '<p>New text</p>', images: [] });
  assert.equal(result.ok, true);
  assert.equal(result.id, 1);
  assert.equal(state.saved.id, 1);
  assert.equal(state.saved.html, '<p>New text</p>');
});

test('the existing macro index supplies bodies for picker searches', async () => {
  const state = setup();
  const result = await state.send({ action: 'TH_MACRO_GET_INDEX' });
  assert.equal(result.index.length, 1);
  assert.equal(result.index[0].abbreviation, 'Rcp');
  assert.equal(result.index[0].html, '<p>Old</p>');
});

test('an inaccessible selected image prevents the macro write', async () => {
  const state = setup();
  const result = await state.send({ action: 'TH_MACRO_SAVE_CAPTURE',
    abbreviation: 'new', html: '<img src="th-image:abc" data-th-image-id="abc">',
    images: [{ id: 'abc', url: 'https://example.com/unavailable.png' }] });
  assert.match(result.error, /Image unavailable/);
  assert.equal(state.saved, undefined);
});

test('selected image bytes are included in the saved macro', async () => {
  const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const state = setup(async () => new Response(image, { status: 200 }));
  const result = await state.send({ action: 'TH_MACRO_SAVE_CAPTURE',
    abbreviation: 'photo', html: '<img src="th-image:abc" data-th-image-id="abc">',
    images: [{ id: 'abc', url: 'https://example.com/image.png' }] });
  assert.equal(result.ok, true);
  assert.equal(state.saved.images.length, 1);
  assert.equal(state.saved.images[0].id, 'abc');
  assert.equal(state.saved.images[0].blob.type, 'image/png');
});

test('macro picker derives the caret from adjacent text when its collapsed rect is empty', () => {
  const picker = fs.readFileSync(path.join(__dirname, '..', 'project',
    'macro_library_picker.js'), 'utf8');
  const start = picker.indexOf('function caretRectForRange(');
  const end = picker.indexOf('function selectedContent(', start);
  assert.ok(start >= 0 && end > start);
  const node = { nodeType: 3, textContent: 'macro' };
  const range = { startContainer: node, startOffset: 3,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    getClientRects: () => [],
    cloneRange: () => ({ setStart() {}, setEnd() {},
      getBoundingClientRect: () => ({ left: 40, right: 49, top: 20,
        bottom: 38, width: 9, height: 18 }) }) };
  const caret = vm.runInNewContext(
    `${picker.slice(start, end)}\ncaretRectForRange`, { Node: { TEXT_NODE: 3 } });
  assert.deepEqual({ left: caret(range).left, top: caret(range).top },
    { left: 49, top: 20 });
});
