const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'project', 'background.js'), 'utf8');
const start = source.indexOf('function isBO2CustomerDetailPage(');
const end = source.indexOf('async function runBO2CustomerCount(', start);
assert.ok(start >= 0 && end > start);

function navigationHarness({ hasLink }) {
  let now = 0;
  let clicked = 0;
  const tab = { id: 101, status: 'complete',
    url: 'https://bo2.eduzz.com/bo/customer/123456#thbo2tab1' };
  const page = {
    location: { origin: 'https://bo2.eduzz.com', pathname: '/bo/customer/123456' },
    document: { querySelectorAll: () => hasLink ? [{
      textContent: 'Voltar para Clientes',
      click() {
        clicked++;
        page.location.pathname = '/bo/customer';
        tab.url = 'https://bo2.eduzz.com/bo/customer#thbo2tab1';
      }
    }] : [] },
    Date: class extends Date { static now() { return now; } },
    setTimeout: callback => { now += 100; callback(); }
  };
  const context = {
    URL,
    Date: page.Date,
    setTimeout: page.setTimeout,
    getExistingTab: async () => tab,
    chrome: { scripting: { executeScript: async details => [{
      result: await vm.runInNewContext(`(${details.func.toString()})()`, page)
    }] } }
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.isDetail = isBO2CustomerDetailPage;' +
    '\nthis.clickBack = clickBO2CustomerBackLink;', context);
  return { context, tab, get clicked() { return clicked; } };
}

test('Orbita identifies only numeric customer detail routes', () => {
  const { context } = navigationHarness({ hasLink: true });
  assert.equal(context.isDetail('https://bo2.eduzz.com/bo/customer/123456#thbo2tab1'), true);
  assert.equal(context.isDetail('https://bo2.eduzz.com/bo/customer'), false);
  assert.equal(context.isDetail('https://bo2.eduzz.com/bo/customer/abc'), false);
  assert.equal(context.isDetail('https://example.invalid/bo/customer/123456'), false);
});

test('Orbita uses the native customer back link when present', async () => {
  const harness = navigationHarness({ hasLink: true });
  assert.equal(await harness.context.clickBack(101, () => true), true);
  assert.equal(harness.clicked, 1);
  assert.equal(harness.tab.url, 'https://bo2.eduzz.com/bo/customer#thbo2tab1');
});

test('Orbita leaves direct-navigation fallback available when the link is absent', async () => {
  const harness = navigationHarness({ hasLink: false });
  assert.equal(await harness.context.clickBack(101, () => true), false);
  assert.equal(harness.clicked, 0);
});
