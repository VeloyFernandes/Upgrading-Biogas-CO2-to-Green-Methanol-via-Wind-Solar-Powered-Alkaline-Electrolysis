// Browser test of the site.  Run:  node tests/e2e.js [screenshot-dir]
// Serves docs/ under a sub-path (as GitHub Pages does) and drives it with Playwright.
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'docs');
const BASE = '/Upgrading-Biogas-CO2-to-Green-Methanol-via-Wind-Solar-Powered-Alkaline-Electrolysis/';
const SHOTS = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end('not found'); }
  let f = path.join(ROOT, url.slice(BASE.length) || 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const num = (s) => parseFloat(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-'));
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  };
  const shot = async (page, name, opts) => { if (SHOTS) await page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png') }, opts)); };
  const settle = (page) => page.waitForTimeout(700);
  const allCharts = async (page) => {
    await page.evaluate(() => window.__app.renderAll());
    await settle(page);
    return page.evaluate(() => window.__app.registry.map((r) => ({ id: r.id, ok: !!r.inst && r.el.querySelector('canvas') !== null && r.inst.getOption().series.length > 0 })));
  };

  try {
    // ---------------------------------------------------------- desktop, light
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true });
    const page = await ctx.newPage(); watch(page);
    await page.goto(url, { waitUntil: 'load' });

    await step('page loads with baseline KPIs', async () => {
      assert.match(await page.title(), /Green Methanol/);
      assert.ok(Math.abs(num(await page.textContent('#hk-gen')) - 791.4) < 1.5, 'generation GWh');
      assert.ok(Math.abs(num(await page.textContent('#hk-wind')) - 209.9) < 0.2, 'wind GWh');
      assert.equal(num(await page.textContent('#hk-lcom')), 1969);
      assert.ok(Math.abs(num(await page.textContent('#hk-cons')) - 443.3) < 0.2, 'demand GWh');
      assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    });

    await step('all 18 charts render', async () => {
      const charts = await allCharts(page);
      assert.equal(charts.length, 18);
      charts.forEach((c) => assert.ok(c.ok, c.id + ' rendered'));
    });

    await step('monthly table has 12 months and a total row', async () => {
      assert.equal(await page.locator('#monthlyTable tbody tr').count(), 12);
      assert.match(await page.textContent('#monthlyTable tbody tr:first-child'), /January 2023.*23,107.*37,646.*Excess/);
      assert.match(await page.textContent('#monthlyTable tfoot'), /Year/);
    });

    await step('scenario sliders recompute the balance', async () => {
      const before = num(await page.textContent('#k-gen'));
      await page.locator('#c-solarDcMw').fill('152');
      const after = num(await page.textContent('#k-gen'));
      const sc = await page.evaluate(() => ({ p: window.__app.scenario.params.solarDcMw, s: window.__app.scenario.totals.solar }));
      assert.equal(sc.p, 152);
      assert.ok(Math.abs((before - after) - sc.s / 1000) < 0.2, 'halving solar removes half the solar yield');
      assert.match(await page.textContent('#o-solarDcMw'), /152 MW DC/);
      await page.locator('#c-electrolyzerMw').fill('100');
      assert.match(await page.textContent('#fl-el'), /100/);
      assert.match(await page.textContent('#k-net-n'), /deficit/);
      assert.match(await page.textContent('#monthlyTable'), /Deficit/);
    });

    await step('all-sky basis lowers solar yield; reset restores baseline', async () => {
      await page.click('#resetScenario');
      const clear = num(await page.textContent('#fl-solar'));
      await page.locator('input[name=solarBasis][value=allsky]').check({ force: true });
      const all = num(await page.textContent('#fl-solar'));
      assert.ok(all < clear * 0.75 && all > clear * 0.5, `all-sky ${all} vs clear ${clear}`);
      assert.match(await page.textContent('#basisHint'), /NASA POWER/);
      await page.click('#resetScenario');
      assert.equal(num(await page.textContent('#fl-solar')), clear);
      assert.equal(await page.inputValue('#c-turbines'), '20');
    });

    await step('resolution toggles redraw balance and wind charts', async () => {
      for (const [res, n] of [['hour', 8760], ['week', 53], ['month', 12], ['day', 365]]) {
        await page.locator(`input[name=balanceRes][value=${res}]`).check({ force: true });
        const len = await page.evaluate(() => window.__app.registry.find((r) => r.id === 'ch-balance').inst.getOption().series[0].data.length);
        assert.equal(len, n, 'balance ' + res);
      }
      await page.locator('input[name=windRes][value=month]').check({ force: true });
      assert.equal(await page.evaluate(() => window.__app.registry.find((r) => r.id === 'ch-wind').inst.getOption().series.length), 3);
    });

    await step('site map switches between solar, wind and combined', async () => {
      const solarSub = await page.textContent('#mapSub');
      await page.locator('input[name=geoMode][value=wind]').check({ force: true });
      assert.match(await page.textContent('#mapTitle'), /Wind farm yield/);
      assert.notEqual(await page.textContent('#mapSub'), solarSub);
      const pts = await page.evaluate(() => window.__app.registry.find((r) => r.id === 'ch-map').inst.getOption().series[0].data.length);
      assert.equal(pts, 31);
      await page.locator('input[name=geoMode][value=solar]').check({ force: true });
    });

    await step('LCOM inputs recompute; scenario link and reset work', async () => {
      assert.equal(num(await page.textContent('#e-base')), 1969);
      assert.ok(Math.abs(num(await page.textContent('#e-mean')) - 1825) <= 2);
      await page.fill('#l-capex', '300'); await page.locator('#l-capex').blur();
      const lower = num(await page.textContent('#e-base'));
      assert.ok(lower < 1969 && lower > 1500, 'lower CAPEX lowers LCOM: ' + lower);
      await page.click('#useScenario');
      assert.match(await page.textContent('#lcomHint'), /Linked to the current scenario/);
      const g = await page.inputValue('#l-generationMwh');
      assert.ok(Math.abs(parseFloat(g) - 791.4) < 1.5, 'generation pulled from scenario: ' + g);
      await page.fill('#l-years', 'abc').catch(() => {});
      await page.click('#resetLcom');
      assert.equal(num(await page.textContent('#e-base')), 1969);
      assert.equal(await page.inputValue('#l-capex'), '444.21');
    });

    await step('CSV download contains the hourly balance', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadCsv')]);
      const text = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
      assert.equal(text.length, 8761);
      assert.equal(text[0], 'timestamp_local,solar_mwh,wind_mwh,generation_mwh,consumption_mwh,net_mwh,grid_interaction');
      assert.match(text[2], /^2023-01-01 01:00,0\.00,50\.29,50\.29,50\.60,-0\.31,Deficit$/); // notebook row 2
      assert.match(text[8760], /^2023-12-31 23:00,/);
    });

    await step('theme toggle switches to dark and persists', async () => {
      await page.click('#themeToggle');
      assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
      await page.reload({ waitUntil: 'load' });
      assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
      const charts = await allCharts(page);
      charts.forEach((c) => assert.ok(c.ok, c.id + ' rendered (dark)'));
      await shot(page, 'desktop-dark-full', { fullPage: true });
      await page.click('#themeToggle');
      assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
      await settle(page);
      await shot(page, 'desktop-light-full', { fullPage: true });
    });

    await step('navigation anchors resolve and no horizontal overflow', async () => {
      const hrefs = await page.$$eval('.nav a', (as) => as.map((a) => a.getAttribute('href')));
      assert.equal(hrefs.length, 8);
      for (const h of hrefs) assert.equal(await page.locator(h).count(), 1, h);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no overflow at 1440');
    });
    await ctx.close();

    // ---------------------------------------------------------- phone
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage(); watch(m);
    await m.goto(url, { waitUntil: 'load' });
    await step('phone layout: charts render without horizontal page scroll', async () => {
      const charts = await allCharts(m);
      charts.forEach((c) => assert.ok(c.ok, c.id + ' rendered (phone)'));
      const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, 'page overflows by ' + over + 'px');
      await shot(m, 'phone-full', { fullPage: true });
    });
    await mctx.close();

    // ---------------------------------------------------------- tablet
    const tctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
    const t = await tctx.newPage(); watch(t);
    await t.goto(url, { waitUntil: 'load' });
    await step('tablet layout has no overflow', async () => {
      await allCharts(t);
      assert.ok(await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await shot(t, 'tablet-full', { fullPage: true });
    });
    await tctx.close();

    await step('no console errors, warnings or failed requests', async () => {
      assert.deepEqual(errors, []);
    });
    console.log(`\n${passed} browser checks passed`);
  } catch (e) {
    console.error('\nFAILED: ' + (e.message || e));
    if (errors.length) console.error('console/network issues:\n  ' + errors.join('\n  '));
    process.exitCode = 1;
  } finally {
    await browser.close(); server.close();
  }
})();
