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
    querySelector: (selector) => selector === '[data-test-id="member-header"]'
      ? { textContent: `Ticket #${top}` } : ({
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
  assert.equal(open(pathname, 'preview').nextPosition, 255);
  assert.deepEqual(list.clicked, [170]);
});

test('preview layout starts at first row without selection and steps back at the end', () => {
  const pathname = '/help-desk/123/view/456';
  const first = previewList([0, 85], null, 170);
  assert.equal(navigationWith(first.document, pathname).open(pathname, 'preview').nextPosition, 85);
  assert.deepEqual(first.clicked, [0]);
  const last = previewList([0, 85], 85, 170);
  assert.equal(navigationWith(last.document, pathname).open(pathname, 'preview').nextPosition, 85);
  assert.deepEqual(last.clicked, [0]);
  const only = previewList([0], 0, 85);
  assert.equal(navigationWith(only.document, pathname).open(pathname, 'preview'), false);
  assert.deepEqual(only.clicked, []);
});

test('preview cursor continues when HubSpot removes the selected row', () => {
  const pathname = '/help-desk/123/view/456/ticket/789';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const first = navigationWith(list.document, pathname).open(pathname, 'preview');
  list.wrappers.splice(1, 1);
  const second = navigationWith(list.document, pathname).open(pathname, 'preview',
    { mode: 'preview', ...first });
  assert.equal(second.targetId, '255');
  assert.deepEqual(list.clicked, [170, 255]);
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
  assert.equal((await open(pathname, 'preview')).nextPosition, 85);
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
  assert.equal(navigationWith(document, pathname).open(pathname, 'list').nextId, '100');
  assert.deepEqual(clicked, [1]);
  const lastPathname = '/help-desk/123/view/456/list-view/ticket/101/thread/1';
  assert.equal(navigationWith(document, lastPathname).open(lastPathname, 'list').nextId, '101');
  assert.deepEqual(clicked, [1, 0]);
  total.textContent = '106 tickets';
  assert.equal(navigationWith(document, lastPathname).open(lastPathname, 'list'), false);
  assert.deepEqual(clicked, [1, 0]);
});

test('list-view cursor continues without the prior row in the result', () => {
  const clicked = [];
  const rows = [0, 1, 2].map(index => ({
    getAttribute: key => key === 'data-fdt-index' ? String(index) : `row-${100 + index}`,
    querySelector: selector => selector.includes('subject-link')
      ? { getAttribute: () => `/help-desk/123/view/456/ticket/${100 + index}` }
      : { getAttribute: () => null, disabled: false, click: () => clicked.push(index) }
  }));
  const list = { querySelectorAll: () => rows };
  const document = { querySelector: selector => selector.includes('total-count')
    ? { textContent: '3 tickets' } : list };
  const pathname = '/help-desk/123/view/456/list-view/ticket/100';
  const first = navigationWith(document, pathname).open(pathname, 'list');
  rows.shift();
  const second = navigationWith(document, pathname).open(pathname, 'list',
    { mode: 'list', ...first });
  assert.equal(second.targetId, '102');
  assert.deepEqual(clicked, [1, 2]);
});

test('shortcut keeps the first eligible tab and focuses it from another tab', async () => {
  const calls = [];
  const tabs = new Map([[77, { id: 77, active: true, windowId: 3,
    url: 'https://app.hubspot.com/help-desk/123/view/456/ticket/789/thread/1' }],
    [88, { id: 88, active: true, windowId: 3,
      url: 'https://app.hubspot.com/help-desk/123/view/456/ticket/900' }]]);
  const session = {};
  const context = {
    URL,
    Number,
    nextTicketCommandLocks: new Set(),
    NEXT_TICKET_SESSION_KEY: 'nextTicketNavigation',
    isExtensionEnabled: () => true,
    chrome: {
      scripting: { executeScript: async details => { calls.push(details);
        return [{ result: { nextId: '790', nextPosition: 170 } }]; } },
      storage: { session: { get: async key => ({ [key]: session[key] }),
        set: async value => Object.assign(session, value) } },
      tabs: { get: async id => tabs.get(id),
        update: async (id, patch) => { calls.push({ activated: id }); Object.assign(tabs.get(id), patch); } },
      windows: { update: async id => { calls.push({ focused: id }); } }
    }
  };
  vm.runInNewContext(`${navigationSource}\n${source.slice(end,
    source.indexOf('function handleCopyCommand(', end))}\nthis.run = runOpenNextTicket;`, context);
  await context.run(tabs.get(77));
  assert.equal(session.nextTicketNavigation.tabId, 77);
  tabs.get(77).active = false;
  await context.run(tabs.get(88));
  const injected = calls.filter(call => call.target);
  assert.equal(injected.length, 2);
  assert.equal(injected[1].target.tabId, 77);
  assert.equal(injected[1].args[2].nextId, '790');
  assert.ok(calls.some(call => call.activated === 77));
  tabs.delete(77);
  await context.run(tabs.get(88));
  assert.equal(calls.filter(call => call.target).at(-1).target.tabId, 88);
  assert.equal(session.nextTicketNavigation.tabId, 88);
});
