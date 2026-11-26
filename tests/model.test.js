// Unit tests for the web UI's calculation core.  Run:  node --test tests/model.test.js
// Reference numbers are the printed outputs of Wind_Solar_v24.ipynb.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const M = require('../docs/assets/model.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/assets/data.js'), 'utf8'), ctx);
const D = JSON.parse(JSON.stringify(ctx.window.SITE_DATA)); // re-home arrays in this realm
const wall = M.wallClock(D.meta);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('data set is a complete hourly year', () => {
  assert.equal(D.meta.n, 8760);
  for (const k of Object.keys(D.hourly)) assert.equal(D.hourly[k].length, 8760, k);
  assert.equal(D.geo.length, 31);
  assert.equal(D.tiltSensitivity.energyMwh.length * D.tiltSensitivity.energyMwh[0].length, 703);
  for (const k of Object.keys(D.hourly)) assert.ok(D.hourly[k].every(Number.isFinite), k + ' finite');
});

test('local calendar handles DST and month boundaries', () => {
  const st = M.groupStarts(wall, 'month');
  assert.deepEqual(Array.from(st), D.meta.monthStart);
  const hours = st.map((s, i) => (i + 1 < st.length ? st[i + 1] : 8760) - s);
  assert.deepEqual(hours, [744, 672, 743, 720, 744, 720, 744, 744, 720, 745, 720, 744]); // March -1 h, October +1 h
  assert.equal(M.groupStarts(wall, 'day').length, 365);
  assert.equal(new Date(wall[0]).toISOString(), '2023-01-01T00:00:00.000Z');
  assert.equal(new Date(wall[8759]).toISOString(), '2023-12-31T23:00:00.000Z');
});

test('baseline yields reproduce the notebook', () => {
  const sc = M.runScenario(D);
  // notebook monthly table sums to 209,892.51 MWh; its 209,917.96 annual figure also counts
  // the hour 2024-01-01 00:00 local, which falls outside the 2023 calendar year shown here
  close(sc.totals.wind, 209892.51, 1, 'wind MWh');
  close(sc.totals.solar / 582338.06, 1, 0.005, 'solar ratio');     // pvlib version drift < 0.5 %
  close(sc.totals.generation / 792256, 1, 0.005, 'generation ratio');
  close(sc.consHourly, 50.6, 1e-9, 'hourly demand');
});

test('monthly balance table matches the notebook', () => {
  const rows = M.monthlyTable(M.runScenario(D), wall);
  const nbWind = [23106.86, 17453.29, 18705.58, 17734.46, 17192.55, 9670.27, 17767.73, 11180.13, 11582.11, 22417.76, 19500.24, 23581.53];
  const nbCons = [37646.40, 34003.20, 37595.80, 36432.00, 37646.40, 36432.00, 37646.40, 37646.40, 36432.00, 37697.00, 36432.00, 37646.40];
  const nbSolar = [31219.73, 42024.04, 55373.43, 58374.72, 61568.39, 59091.36, 60530.94, 59361.41, 52775.35, 44637.29, 32855.66, 24525.75];
  rows.forEach((r, i) => {
    close(r.wind, nbWind[i], 1, 'wind ' + i);
    close(r.consumption, nbCons[i], 0.01, 'consumption ' + i);
    close(r.solar / nbSolar[i], 1, 0.01, 'solar ' + i);
    assert.ok(r.net > 0, 'every month in excess');
    close(r.generation - r.consumption, r.net, 1e-6);
  });
});

test('energy balance identities', () => {
  for (const basis of ['clear', 'allsky']) {
    const sc = M.runScenario(D, { solarBasis: basis, solarDcMw: 150, turbines: 35, electrolyzerMw: 80 });
    const t = sc.totals;
    close(t.exportMwh - t.importMwh, t.net, 1e-6, 'export - import = net');
    close(t.directUse + t.importMwh, t.consumption, 1e-6, 'direct + import = demand');
    close(t.directUse + t.exportMwh, t.generation, 1e-6, 'direct + export = generation');
    assert.ok(t.selfSufficiency >= 0 && t.selfSufficiency <= 1);
  }
});

test('scenario scales linearly and all-sky is below clear-sky', () => {
  const a = M.runScenario(D), b = M.runScenario(D, { solarDcMw: 608, turbines: 40 });
  close(b.totals.solar, 2 * a.totals.solar, 1e-6);
  close(b.totals.wind, 2 * a.totals.wind, 1e-6);
  const c = M.runScenario(D, { solarBasis: 'allsky' });
  assert.ok(c.totals.solar < 0.75 * a.totals.solar && c.totals.solar > 0.5 * a.totals.solar);
  const z = M.runScenario(D, { solarDcMw: 0, turbines: 0, electrolyzerMw: 0, methanolMw: 0 });
  assert.equal(z.totals.generation, 0); assert.equal(z.process.meohT, 0); assert.equal(z.totals.selfSufficiency, 0);
});

test('process stoichiometry closes the mass balance', () => {
  const p = M.runScenario(D).process;
  close(p.meohT, 44439, 150, 'methanol t/yr vs notebook 44,439');
  close(p.h2T + p.co2T, p.meohT + p.waterOutT, 1e-6 * p.meohT, 'synthesis mass balance');
  close(p.waterInT, p.h2T + p.o2T, 1e-6 * p.waterInT, 'electrolysis mass balance');
  close(p.co2T / p.meohT, 1.3735, 1e-3);
});

test('LCOM base case and tornado reproduce the notebook (1968.97 EUR/t)', () => {
  const base = M.lcom();
  close(base.lcom, 1968.97, 0.01);
  const b = base.breakdown;
  close(b.capex + b.opex + b.generation + b.gridImport + b.gridExport, base.lcom, 1e-9);
  const t = M.tornado();
  close(t.base, 1968.97, 0.01);
  assert.deepEqual(t.rows.map((r) => r.name).sort(), ['CAPEX', 'LCOE', 'OPEX', 'Production']);
  const lcoe = t.rows.find((r) => r.name === 'LCOE'), prod = t.rows.find((r) => r.name === 'Production');
  assert.ok(lcoe.low < t.base && lcoe.high > t.base);
  assert.ok(prod.low > t.base && prod.high < t.base); // more output -> cheaper methanol
  for (let i = 1; i < t.rows.length; i++) assert.ok(Math.abs(t.rows[i - 1].high - t.rows[i - 1].low) >= Math.abs(t.rows[i].high - t.rows[i].low));
});

test('Monte Carlo matches the notebook distribution', () => {
  const mc = M.monteCarlo(); // notebook: mean 1825.07, P5 1795.11, P50 1824.91, P95 1855.10
  assert.equal(mc.values.length, 5000);
  close(mc.mean, 1825.07, 2); close(mc.p5, 1795.11, 3); close(mc.p50, 1824.91, 2); close(mc.p95, 1855.10, 3);
  assert.deepEqual(M.monteCarlo().values, mc.values, 'seeded -> deterministic');
});

test('wind statistics', () => {
  const rose = M.windRose(D.hourly.windSpeedHub, D.hourly.windDirHub, [0, 5, 10, 15, 20], 16);
  close(rose.flat().reduce((a, b) => a + b, 0), 100, 1e-9, 'rose sums to 100 %');
  const dist = M.monthlyDistribution(D.hourly.wind, D.meta.monthStart, 6);
  dist.shares.forEach((s) => close(s.reduce((a, b) => a + b, 0), 100, 1e-9));
  let area = 0; for (let x = 0.005; x < 60; x += 0.01) area += M.weibullPdf(x, D.wind.weibull.k, D.wind.weibull.A) * 0.01;
  close(area, 1, 1e-3, 'Weibull pdf integrates to 1');
  const h = M.histogram(D.hourly.windSpeedHub, 30, 0, 30, true);
  close(h.reduce((a, b) => a + b.value * (b.x1 - b.x0), 0), 1, 1e-9);
  const dc = M.durationCurve(M.runScenario(D).net, 100);
  for (let i = 1; i < dc.length; i++) assert.ok(dc[i][1] <= dc[i - 1][1]);
});

test('site comparison and tilt study are consistent with the notebook', () => {
  const S = D.tiltSensitivity; let best = [0, 0, -1];
  S.energyMwh.forEach((r, ti) => r.forEach((v, ai) => { if (v > best[2]) best = [S.tilts[ti], S.azimuths[ai], v]; }));
  assert.deepEqual(best.slice(0, 2), [50, 180]);          // notebook optimum: tilt 50°, azimuth 180°
  close(best[2] / 581651.99, 1, 0.005, 'optimum yield');
  D.geo.forEach((g) => { assert.ok(g.solar > 3e5 && g.solar < 4.5e5, g.name); assert.ok(g.wind > 1.5e5 && g.wind < 3.5e5, g.name); });
  assert.ok(D.geo.some((g) => g.name === D.meta.site));
});
