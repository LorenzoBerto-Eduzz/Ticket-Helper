const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('function hubspotNextTicketRoute(');
const end = source.indexOf('async function runOpenNextTicket(', start);
assert.ok(start >= 0 && end > start);
const navigationSource = source.slice(start, end);

function navigationWith(document, pathname, extras = {}) {
  const context = { URL, document, location: { pathname }, Number, Promise, ...extras };
  vm.runInNewContext(`${navigationSource}\nthis.route = hubspotNextTicketRoute; this.open = openHubspotNextTicket;`, context);
  return context;
}

function previewList(tops, selectedTop, totalHeight) {
  const clicked = [];
  const wrappers = tops.map((top) => ({
    style: { top: `${top}px`, height: '85px' },
    querySelector: () => ({
      getAttribute: (key) => key === 'data-selected' || key === 'aria-selected'
        ? String(top === selectedTop) : null,
      querySelector: (selector) => selector === '[data-test-id="member-body"]'
        ? { click: () => clicked.push(top) } : null,
      click: () => {}
    })
  }));
  const rowgroup = { scrollHeight: totalHeight, querySelectorAll: () => wrappers };
  const grid = { clientHeight: 340, querySelector: () => rowgroup };
  const list = { querySelector: () => grid };
  return { document: { querySelector: () => list }, clicked, grid, wrappers };
}

test('next-ticket routes accept both HubSpot layouts and reject other pages', () => {
  const { route } = navigationWith({}, '/');
  const base = 'https://app.hubspot.com/help-desk/123/view/456';
  assert.equal(route(`${base}/list-view/ticket/789/thread/1`)?.mode, 'list');
  assert.equal(route(`${base}/ticket/789/thread/1`)?.mode, 'preview');
  assert.equal(route(`${base}/ticket/789/thread/1`)?.ticketId, '789');
  assert.equal(route(`${base}/settings`), null);
  assert.equal(route('https://example.invalid/help-desk/123/view/456'), null);
});

test('preview layout clicks the row immediately below the selected one', () => {
  const pathname = '/help-desk/123/view/456/ticket/789/thread/1';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const { open } = navigationWith(list.document, pathname);
  assert.equal(open(pathname, 'preview'), true);
  assert.deepEqual(list.clicked, [170]);
});

test('preview layout starts at first row without selection and steps back at the end', () => {
  const pathname = '/help-desk/123/view/456';
  const first = previewList([0, 85], null, 170);
  assert.equal(navigationWith(first.document, pathname).open(pathname, 'preview'), true);
  assert.deepEqual(first.clicked, [0]);
  const last = previewList([0, 85], 85, 170);
  assert.equal(navigationWith(last.document, pathname).open(pathname, 'preview'), true);
  assert.deepEqual(last.clicked, [0]);
  const only = previewList([0], 0, 85);
  assert.equal(navigationWith(only.document, pathname).open(pathname, 'preview'), false);
  assert.deepEqual(only.clicked, []);
});

test('a changed ticket route cannot click a stale row', () => {
  const list = previewList([0, 85], 0, 170);
  const { open } = navigationWith(list.document, '/help-desk/123/view/456/ticket/222');
  assert.equal(open('/help-desk/123/view/456/ticket/111', 'preview'), false);
  assert.deepEqual(list.clicked, []);
});

test('virtualized preview row is clicked after HubSpot renders it', async () => {
  const pathname = '/help-desk/123/view/456/ticket/789';
  const list = previewList([85], 85, 255);
  let notifyMutation;
  Object.defineProperty(list.grid, 'scrollTop', { set() {
    setTimeout(() => {
      list.wrappers.push({
        style: { top: '170px', height: '85px' },
        querySelector: () => ({ getAttribute: () => 'false', click: () => {},
          querySelector: () => ({ click: () => list.clicked.push(170) }) })
      });
      notifyMutation();
    }, 0);
  } });
  class MutationObserverMock {
    constructor(callback) { notifyMutation = callback; }
    observe() {}
    disconnect() {}
  }
  const { open } = navigationWith(list.document, pathname, {
    MutationObserver: MutationObserverMock, setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0)
  });
  assert.equal(await open(pathname, 'preview'), true);
  assert.deepEqual(list.clicked, [170]);
});

test('list-view still clicks the next row native preview button', () => {
  const clicked = [];
  const rows = [0, 1].map((index) => ({
    getAttribute: (key) => key === 'data-fdt-index' ? String(index) : `row-${100 + index}`,
    querySelector: (selector) => selector.includes('subject-link')
      ? { getAttribute: () => `/help-desk/123/view/456/ticket/${100 + index}` }
      : { getAttribute: () => null, disabled: false, click: () => clicked.push(index) }
  }));
  const list = { querySelectorAll: () => rows };
  const total = { textContent: '2 tickets' };
  const document = { querySelector: selector => selector.includes('total-count') ? total : list };
  const pathname = '/help-desk/123/view/456/list-view/ticket/100/thread/1';
  assert.equal(navigationWith(document, pathname).open(pathname, 'list'), true);
  assert.deepEqual(clicked, [1]);
  const lastPathname = '/help-desk/123/view/456/list-view/ticket/101/thread/1';
  assert.equal(navigationWith(document, lastPathname).open(lastPathname, 'list'), true);
  assert.deepEqual(clicked, [1, 0]);
  total.textContent = '106 tickets';
  assert.equal(navigationWith(document, lastPathname).open(lastPathname, 'list'), false);
  assert.deepEqual(clicked, [1, 0]);
});

test('shortcut injects directly into Chrome supplied active tab', async () => {
  const calls = [];
  const context = {
    URL,
    Number,
    nextTicketCommandLocks: new Set(),
    isExtensionEnabled: () => true,
    chrome: {
      scripting: { executeScript: async details => { calls.push(details); } },
      tabs: { get: () => { throw Error('unnecessary tab lookup'); },
        query: () => { throw Error('unnecessary tab query'); } },
      windows: { get: () => { throw Error('unnecessary window lookup'); } }
    }
  };
  vm.runInNewContext(`${navigationSource}\n${source.slice(end,
    source.indexOf('function handleCopyCommand(', end))}\nthis.run = runOpenNextTicket;`, context);
  await context.run({ id: 77, active: true,
    url: 'https://app.hubspot.com/help-desk/123/view/456/ticket/789/thread/1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target.tabId, 77);
  assert.equal(calls[0].args[0], '/help-desk/123/view/456/ticket/789/thread/1');
  assert.equal(calls[0].args[1], 'preview');
});
