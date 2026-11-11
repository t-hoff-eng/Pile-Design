const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);

const baseInput = () => ({
  pile: { type: 'bored', shape: 'circle', D: 0.6, Ep: 30000, head: 0, ignoreTop: 0, minLength: 2, minEmbed: 0 },
  loads: { G: 800, Q: 300, psiS: 0.7 },
  reduction: { ratings: {}, redundancy: 'low', testing: { type: 'none' } },
  gwl: 100,
  settlementLimit: 1000,
  layers: [{ name: 'Clay', type: 'clay', bottom: 30, gamma: 18, su: 100, E: 40, nu: 0.3 }],
});

test('ARR of all-moderate ratings is 3 and phi_gb = 0.52 (low redundancy)', () => {
  const r = C.geotechnicalReductionFactor({ ratings: {}, redundancy: 'low' });
  close(r.arr, 3, 1e-9);
  assert.equal(r.phiGb, 0.52);
  assert.equal(r.phiG, 0.52);
  assert.equal(C.geotechnicalReductionFactor({ ratings: {}, redundancy: 'high' }).phiGb, 0.6);
});

test('ARR uses Table 4.3.2(A) weights', () => {
  const ratings = Object.fromEntries(C.RISK_FACTORS.map((f) => [f.id, 1]));
  ratings.monitoring = 5; // weight 0.5
  close(C.averageRiskRating(ratings), (14.5 - 0.5 + 2.5) / 14.5, 1e-9);
});

test('Static load testing increases phi_g via K = 1.33p/(p+3.3)', () => {
  const r = C.geotechnicalReductionFactor({ ratings: {}, redundancy: 'low', testing: { type: 'static', percent: 3, phiTf: 0.9 } });
  const K = (1.33 * 3) / 6.3;
  close(r.K, K, 1e-9);
  close(r.phiG, 0.52 + (0.9 - 0.52) * K, 1e-9);
});

test('Load combinations per AS/NZS 1170.0', () => {
  const l = C.designLoads({ G: 800, Q: 300, psiS: 0.7 });
  close(l.uls, 1410, 1e-9);
  close(l.sls, 1010, 1e-9);
  close(C.designLoads({ G: 1000, Q: 0 }).uls, 1350, 1e-9);
});

test('Clay capacity: alpha*su shaft and 9su base (hand check)', () => {
  const inp = baseInput();
  const ctx = C.makeContext(inp);
  const cap = C.capacityAt(ctx, 10);
  close(cap.Rs, 0.45 * 100 * Math.PI * 0.6 * 10, 0.5, 'Rs');
  close(cap.Rb, 9 * 100 * Math.PI * 0.36 / 4, 0.5, 'Rb');
});

test('Effective stress with groundwater', () => {
  const p = C.buildProfile([{ bottom: 10, gamma: 20 }]);
  close(C.sigmaV(p, 5, 2), 100 - 3 * 9.81, 1e-9);
  close(C.sigmaV(p, 1, 2), 20, 1e-9);
});

test('Randolph & Wroth: very stiff pile approaches rigid solution', () => {
  const inp = baseInput();
  inp.pile.Ep = 1e9;
  const ctx = C.makeContext(inp);
  const r = C.randolphWroth(ctx, 20, 1000);
  const G = 40000 / 2.6;
  const r0 = 0.3;
  const L = 20;
  const nu = 0.3;
  const rm = (0.25 + 1 * (2.5 * 1 * (1 - nu) - 0.25)) * L;
  const zeta = Math.log(rm / r0);
  const ratio = 4 / (1 - nu) + (2 * Math.PI / zeta) * (L / r0);
  close(r.w, (1000 / (ratio * G * r0)) * 1000, 0.01);
});

test('Fleming settlement increases monotonically with load', () => {
  const ctx = C.makeContext(baseInput());
  const cap = C.capacityAt(ctx, 15);
  const fl = C.flemingModel(ctx, cap);
  let prev = 0;
  for (let f = 0.1; f < 0.95; f += 0.1) {
    const w = fl.settlement(f * cap.Rdug);
    assert.ok(w > prev);
    prev = w;
  }
  assert.equal(fl.settlement(cap.Rdug * 1.01), Infinity);
});

test('Design finds shortest length satisfying R*d,g >= E*d', () => {
  const res = C.design(baseInput());
  assert.ok(res.required !== null);
  const d = res.detail;
  assert.ok(d.Rdg >= res.loads.uls);
  const prev = C.capacityAt(C.makeContext(baseInput()), res.required - 0.05);
  assert.ok(res.phi.phiG * prev.Rdug < res.loads.uls);
  // hand check: L = (Ed/phi - 9su*A) / (alpha su perimeter)
  const Lh = (1410 / 0.52 - 9 * 100 * Math.PI * 0.09) / (0.45 * 100 * Math.PI * 0.6);
  close(res.required, Lh, 0.06);
});

test('Settlement limit can govern the length', () => {
  const inp = baseInput();
  inp.layers[0].su = 200;
  const loose = C.design(inp);
  inp.settlementLimit = 3.2;
  const tight = C.design(inp);
  assert.ok(tight.required > loose.required);
  assert.ok(tight.detail.settlement.governing <= 3.2);
  assert.equal(tight.detail.governedBy, 'Settlement (SLS)');
});

test('Sand and rock layers produce positive resistance', () => {
  const inp = baseInput();
  inp.gwl = 2;
  inp.layers = [
    { name: 'Sand', type: 'sand', bottom: 8, gamma: 19, phi: 34, E: 50, nu: 0.3 },
    { name: 'Rock', type: 'rock', bottom: 20, gamma: 23, qu: 10, E: 1000, nu: 0.25 },
  ];
  const ctx = C.makeContext(inp);
  const cap = C.capacityAt(ctx, 10);
  const rockShaft = cap.shaftByLayer.find((l) => l.type === 'rock');
  close(rockShaft.Rs, 0.45 * Math.sqrt(10) * 1000 * Math.PI * 0.6 * 2, 1, 'rock shaft');
  close(cap.qb, 4.83 * Math.pow(10, 0.51) * 1000, 1, 'rock base');
});

test('Unit resistance profile reports fs and qb with depth', () => {
  const res = C.design(baseInput());
  const at = res.unitProfile.find((p) => Math.abs(p.z - 5) < 1e-6);
  close(at.fs, 45, 1e-6, 'fs = alpha su');
  close(at.qb, 900, 1e-6, 'qb = 9 su');
  assert.ok(res.unitProfile.every((p, i, a) => i === 0 || p.z > a[i - 1].z));
});
