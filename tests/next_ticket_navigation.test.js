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

test('closing the pinned preview preserves its next ticket in session', async () => {
  const rememberStart = source.indexOf('async function rememberFocusedNextTicketTab(');
  const session = { nextTicketNavigation: {
    tabId: 77, base: 'https://app.hubspot.com/help-desk/123/view/456',
    mode: 'preview', sourceId: '101', nextId: '102', nextPosition: 170
  } };
  const context = { URL, Number, focusedTabId: 77, nextTicketRouteWatch: new Map(),
    nextTicketCommandLocks: new Set(),
    NEXT_TICKET_SESSION_KEY: 'nextTicketNavigation',
    chrome: { tabs: { get: async () => ({
      url: 'https://app.hubspot.com/help-desk/123/view/456'
    }) }, storage: { session: {
      get: async key => ({ [key]: session[key] }),
      set: async value => Object.assign(session, value)
    } } } };
  vm.runInNewContext(`${source.slice(rememberStart, end)}\nthis.remember = rememberFocusedNextTicketTab;`, context);
  await context.remember({ id: 77,
    url: 'https://app.hubspot.com/help-desk/123/view/456' });
  assert.equal(session.nextTicketNavigation.sourceId, null);
  assert.equal(session.nextTicketNavigation.nextId, '102');
  assert.equal(session.nextTicketNavigation.nextPosition, 170);
});

test('a route event during the shortcut cannot clear the next ticket it just computed', async () => {
  const rememberStart = source.indexOf('async function rememberFocusedNextTicketTab(');
  const session = { nextTicketNavigation: {
    tabId: 77, base: 'https://app.hubspot.com/help-desk/123/view/456',
    mode: 'preview', sourceId: '85', nextId: '170', nextPosition: 170
  } };
  const context = { URL, Number, focusedTabId: 77, nextTicketRouteWatch: new Map(),
    nextTicketCommandLocks: new Set(['command']),
    NEXT_TICKET_SESSION_KEY: 'nextTicketNavigation',
    chrome: { storage: { session: {
      get: async key => ({ [key]: session[key] }),
      set: async value => Object.assign(session, value)
    } } } };
  vm.runInNewContext(`${source.slice(rememberStart, end)}\nthis.remember = rememberFocusedNextTicketTab;`, context);
  await context.remember({ id: 77,
    url: 'https://app.hubspot.com/help-desk/123/view/456/ticket/170' });
  assert.equal(session.nextTicketNavigation.sourceId, '85');
  assert.equal(session.nextTicketNavigation.nextId, '170');
});

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
  return { document: { querySelector: selector => selector === '[data-test-id="HelpDeskPreviewCardList"]'
    ? list : null }, clicked, grid, wrappers };
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
  const pathname = '/help-desk/123/view/456/ticket/85/thread/1';
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

test('closing a preview keeps its saved next row even if HubSpot leaves stale selection styling', () => {
  const pathname = '/help-desk/123/view/456';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const cursor = { mode: 'preview', sourceId: null, nextId: '170', nextPosition: 170 };
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', cursor);
  assert.equal(result.targetId, '170');
  assert.deepEqual(list.clicked, [170]);
});

test('a shortcut immediately after closing the preview can use the cursor before storage catches up', () => {
  const pathname = '/help-desk/123/view/456';
  const list = previewList([0, 85, 170], 85, 255);
  const cursor = { mode: 'preview', sourceId: '85', nextId: '170', nextPosition: 170 };
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', cursor);
  assert.equal(result.targetId, '170');
  assert.deepEqual(list.clicked, [170]);
});

test('closing a preview retains the next ticket ID when its row is not rendered', () => {
  const pathname = '/help-desk/123/view/456';
  const list = previewList([0, 85], null, 340);
  const cursor = { mode: 'preview', sourceId: null, nextId: '170', nextPosition: 170 };
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', cursor);
  assert.equal(result.fallbackId, '170');
  assert.deepEqual(list.clicked, []);
});

test('preview cursor continues when HubSpot removes the selected row', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const first = navigationWith(list.document, pathname).open(pathname, 'preview');
  list.wrappers.splice(1, 1);
  const nextPathname = '/help-desk/123/view/456/ticket/170';
  const second = navigationWith(list.document, nextPathname).open(nextPathname, 'preview',
    { mode: 'preview', ...first });
  assert.equal(second.targetId, '255');
  assert.deepEqual(list.clicked, [170, 255]);
});

test('next ticket is captured before a Todo click synchronously removes the prior row', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const rowgroup = list.grid.querySelector();
  const target = list.wrappers[2];
  const original = target.querySelector;
  target.querySelector = selector => selector === '[data-test-id="member-header"]'
    ? original(selector) : {
      getAttribute: () => 'false',
      querySelector: () => ({ click: () => {
        list.clicked.push(170);
        list.wrappers.splice(1, 1);
        for (const wrapper of list.wrappers) {
          const top = Number.parseInt(wrapper.style.top, 10);
          if (top > 85) wrapper.style.top = `${top - 85}px`;
        }
        rowgroup.scrollHeight = 255;
      } })
    };
  const first = navigationWith(list.document, pathname).open(pathname, 'preview');
  assert.equal(first.targetId, '170');
  assert.equal(first.nextId, '255');
  assert.equal(first.nextPosition, 255);
  const nextPathname = '/help-desk/123/view/456/ticket/170';
  const second = navigationWith(list.document, nextPathname).open(nextPathname, 'preview',
    { mode: 'preview', ...first });
  assert.equal(second.targetId, '255');
  assert.deepEqual(list.clicked, [170, 255]);
});

test('a saved next ID follows its moved Todo row instead of the old row position', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 170, 255], null, 255);
  list.wrappers[1].style.top = '85px';
  list.wrappers[2].style.top = '170px';
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', {
    mode: 'preview', sourceId: '85', nextId: '170', nextPosition: 170
  });
  assert.equal(result.targetId, '170');
  assert.equal(result.nextId, '255');
  assert.deepEqual(list.clicked, [170]);
});

test('closing the second Todo ticket still opens the third after earlier rows disappear', () => {
  const list = previewList([0, 85, 170], 0, 255);
  const rowgroup = list.grid.querySelector();
  const second = list.wrappers[1];
  const original = second.querySelector;
  second.querySelector = selector => selector === '[data-test-id="member-header"]'
    ? original(selector) : {
      getAttribute: () => 'false',
      querySelector: () => ({ click: () => {
        list.clicked.push(85);
        list.wrappers.shift();
        for (const wrapper of list.wrappers) {
          wrapper.style.top = `${Number.parseInt(wrapper.style.top, 10) - 85}px`;
        }
        rowgroup.scrollHeight = 170;
      } })
    };
  const firstPath = '/help-desk/123/view/456/ticket/0';
  const first = navigationWith(list.document, firstPath).open(firstPath, 'preview');
  assert.equal(first.targetId, '85');
  assert.equal(first.nextId, '170');
  list.wrappers.shift();
  list.wrappers[0].style.top = '0px';
  rowgroup.scrollHeight = 85;
  const listPath = '/help-desk/123/view/456';
  const continuation = navigationWith(list.document, listPath).open(listPath, 'preview', {
    mode: 'preview', sourceId: null, nextId: first.nextId,
    nextPosition: first.nextPosition
  });
  assert.equal(continuation.targetId, '170');
  assert.deepEqual(list.clicked, [85, 170]);
});

test('manual preview navigation replaces the prior ticket cursor', () => {
  const initialPath = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170, 255], 85, 340);
  const first = navigationWith(list.document, initialPath).open(initialPath, 'preview');
  const manualPath = '/help-desk/123/view/456/ticket/255';
  const selected = list.wrappers.map(wrapper => wrapper.style.top === '255px');
  list.wrappers.forEach((wrapper, index) => {
    const original = wrapper.querySelector;
    wrapper.querySelector = selector => selector === '[data-test-id="member-header"]'
      ? original(selector) : {
        getAttribute: key => key === 'data-selected' || key === 'aria-selected'
          ? String(selected[index]) : null,
        querySelector: key => key === '[data-test-id="member-body"]'
          ? { click: () => list.clicked.push(Number.parseInt(wrapper.style.top, 10)) } : null
      };
  });
  const next = navigationWith(list.document, manualPath).open(manualPath, 'preview',
    { mode: 'preview', ...first });
  assert.equal(next.targetId, '170');
  assert.deepEqual(list.clicked, [170, 170]);
});

test('read-only inspection saves the next row without navigating', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170], 85, 255);
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', null, true);
  assert.equal(result.sourceId, '85');
  assert.equal(result.targetId, '170');
  assert.equal(result.targetPosition, 170);
  assert.deepEqual(list.clicked, []);
});

test('a ticket route with no matching row waits instead of jumping to the first row', () => {
  const pathname = '/help-desk/123/view/456/ticket/255';
  const list = previewList([0, 85, 170], null, 255);
  const result = navigationWith(list.document, pathname).open(pathname, 'preview',
    { mode: 'preview', sourceId: '85', nextId: '170', nextPosition: 170 });
  assert.equal(result, false);
  assert.deepEqual(list.clicked, []);
});

test('an empty cursor for a newly opened ticket cannot send navigation to the first row', () => {
  const pathname = '/help-desk/123/view/456/ticket/255';
  const list = previewList([0, 85, 170], null, 255);
  const cursor = { mode: 'preview', sourceId: '255', nextId: null, nextPosition: null };
  assert.equal(navigationWith(list.document, pathname).open(pathname, 'preview', cursor), false);
  assert.deepEqual(list.clicked, []);
});

test('a ticket route uses its row ID before HubSpot marks the row selected', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170], null, 255);
  const result = navigationWith(list.document, pathname).open(pathname, 'preview', null, true);
  assert.equal(result.targetId, '170');
  assert.deepEqual(list.clicked, []);
});

test('a stale selected style cannot redirect a ticket route to another row', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 85, 170], 0, 255);
  const result = navigationWith(list.document, pathname).open(pathname, 'preview');
  assert.equal(result.targetId, '170');
  assert.deepEqual(list.clicked, [170]);
});

test('a saved next ticket remains available when refreshed preview rows omit it', () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([0, 170], null, 255);
  const result = navigationWith(list.document, pathname).open(pathname, 'preview',
    { mode: 'preview', sourceId: '85', nextId: '255', nextPosition: 255 });
  assert.equal(result.fallbackId, '255');
  assert.deepEqual(list.clicked, []);
});

test('a changed ticket route cannot click a stale row', () => {
  const list = previewList([0, 85], 0, 170);
  const { open } = navigationWith(list.document, '/help-desk/123/view/456/ticket/222');
  assert.equal(open('/help-desk/123/view/456/ticket/111', 'preview'), false);
  assert.deepEqual(list.clicked, []);
});

test('virtualized preview row is clicked after HubSpot renders it', async () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
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

test('virtualized preview uses its known next ticket instead of waiting for a missing row', async () => {
  const pathname = '/help-desk/123/view/456/ticket/85';
  const list = previewList([85], 85, 255);
  list.grid.scrollTop = 0;
  class MutationObserverMock {
    observe() {}
    disconnect() {}
  }
  const { open } = navigationWith(list.document, pathname, {
    MutationObserver: MutationObserverMock, setTimeout, clearTimeout,
    requestAnimationFrame: callback => callback()
  });
  const result = await open(pathname, 'preview', {
    mode: 'preview', sourceId: '85', nextId: '170', nextPosition: 170
  });
  assert.equal(result.fallbackId, '170');
  assert.deepEqual(list.clicked, []);
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

test('ticket table on a preview route opens the next row', () => {
  const clicked = [];
  const rows = [0, 1, 2].map(index => ({
    getAttribute: key => key === 'data-fdt-index' ? String(index)
      : key === 'data-test-id' ? `row-${100 + index}`
      : key === 'aria-selected' ? String(index === 0) : null,
    querySelector: selector => selector.includes('subject-link')
      ? { getAttribute: () => `/help-desk/123/view/456/ticket/${100 + index}` }
      : { getAttribute: () => 'false', disabled: false, click: () => clicked.push(index) }
  }));
  const table = { querySelectorAll: () => rows };
  const document = { querySelector: selector => selector.includes('total-count')
    ? { textContent: '3 tickets' }
    : selector.includes('HelpDeskViewMemberTable') ? table : null };
  const pathname = '/help-desk/123/view/456/ticket/100/thread/1';
  const first = navigationWith(document, pathname).open(pathname, 'preview');
  assert.equal(first.targetId, '101');
  assert.equal(first.nextId, '102');
  assert.deepEqual(clicked, [1]);
  const second = navigationWith(document, '/help-desk/123/view/456/ticket/101').open(
    '/help-desk/123/view/456/ticket/101', 'preview', { mode: 'preview', ...first });
  assert.equal(second.targetId, '102');
  assert.deepEqual(clicked, [1, 2]);
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
  const nextPathname = '/help-desk/123/view/456/list-view/ticket/101';
  const second = navigationWith(document, nextPathname).open(nextPathname, 'list',
    { mode: 'list', ...first });
  assert.equal(second.targetId, '102');
  assert.deepEqual(clicked, [1, 2]);
});

test('closing a list-view ticket keeps its saved next row', () => {
  const clicked = [];
  const rows = [0, 1, 2].map(index => ({
    getAttribute: key => key === 'data-fdt-index' ? String(index)
      : key === 'data-test-id' ? `row-${100 + index}`
      : key === 'aria-selected' ? String(index === 1) : null,
    querySelector: selector => selector.includes('subject-link')
      ? { getAttribute: () => `/help-desk/123/view/456/ticket/${100 + index}` }
      : { getAttribute: () => null, disabled: false, click: () => clicked.push(index) }
  }));
  const document = { querySelector: selector => selector.includes('total-count')
    ? { textContent: '3 tickets' }
    : { querySelectorAll: () => rows } };
  const pathname = '/help-desk/123/view/456/list-view';
  const cursor = { mode: 'list', sourceId: null, nextId: '102', nextPosition: 2 };
  const result = navigationWith(document, pathname).open(pathname, 'list', cursor);
  assert.equal(result.targetId, '102');
  assert.deepEqual(clicked, [2]);
});

test('list-view ticket without its row or a next cursor does not open the first row', () => {
  const clicked = [];
  const rows = [0, 1].map(index => ({
    getAttribute: key => key === 'data-fdt-index' ? String(index)
      : key === 'data-test-id' ? `row-${100 + index}` : null,
    querySelector: selector => selector.includes('subject-link')
      ? { getAttribute: () => `/help-desk/123/view/456/ticket/${100 + index}` }
      : { getAttribute: () => null, disabled: false, click: () => clicked.push(index) }
  }));
  const document = { querySelector: selector => selector.includes('total-count')
    ? { textContent: '3 tickets' }
    : { querySelectorAll: () => rows } };
  const pathname = '/help-desk/123/view/456/list-view/ticket/102';
  const cursor = { mode: 'list', sourceId: '102', nextId: null, nextPosition: null };
  assert.equal(navigationWith(document, pathname).open(pathname, 'list', cursor), false);
  assert.deepEqual(clicked, []);
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

test('saved next ID opens in the pinned preview tab when its row is unavailable', async () => {
  const tab = { id: 77, active: true, windowId: 3,
    url: 'https://app.hubspot.com/help-desk/123/view/456/ticket/85' };
  const session = { nextTicketNavigation: { tabId: 77,
    base: 'https://app.hubspot.com/help-desk/123/view/456', mode: 'preview',
    sourceId: '85', nextId: '255', nextPosition: 255 } };
  const context = { URL, Number, nextTicketCommandLocks: new Set(),
    NEXT_TICKET_SESSION_KEY: 'nextTicketNavigation', isExtensionEnabled: () => true,
    chrome: {
      scripting: { executeScript: async () => [{ result: { fallbackId: '255', sourceId: '85' } }] },
      storage: { session: { get: async key => ({ [key]: session[key] }),
        set: async value => Object.assign(session, value) } },
      tabs: { get: async () => tab, update: async (_id, patch) => Object.assign(tab, patch) },
      windows: { update: async () => {} }
    } };
  vm.runInNewContext(`${navigationSource}\n${source.slice(end,
    source.indexOf('function handleCopyCommand(', end))}\nthis.run = runOpenNextTicket;`, context);
  await context.run(tab);
  assert.equal(tab.url, 'https://app.hubspot.com/help-desk/123/view/456/ticket/255');
  assert.equal(session.nextTicketNavigation.sourceId, '255');
});
