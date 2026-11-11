const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IO = require('../js/geo-io.js');
const GM = require('../js/geo-model.js');

const S = (f) => path.join(__dirname, '..', 'samples', f);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);
const E0 = 330000, N0 = 6250000;
const s0 = (x, y) => 20 + 1.5 * Math.sin(x / 60) + 0.01 * y;
const s1 = (x, y) => s0(x, y) - 1.5;
const s2 = (x, y) => s0(x, y) - 6 - 2 * (x / 200);
const s3 = (x, y) => s2(x, y) - 5 + 1.5 * Math.cos(y / 40);
const s4 = (x, y) => s0(x, y) - 30;

const dxf = IO.parseDXF(fs.readFileSync(S('ground_model.dxf'), 'utf8'));
const volumes = Object.entries(dxf.layers).map(([name, tris], i) => ({ id: 'v' + i, name, index: GM.buildIndex(tris) }));

test('DXF: 3DFACE and polyface layers are read as triangle meshes', () => {
  assert.deepEqual(Object.keys(dxf.layers).sort(), ['Clay', 'Fill', 'Rock', 'Sand']);
  assert.ok(dxf.counts.polyfaces === 1);
  for (const t of Object.values(dxf.layers)) assert.equal(t.length % 9, 0);
  const bb = IO.bboxOf(dxf.layers.Fill);
  close(bb[0], E0, 1e-6);
  close(bb[4], N0 + 150, 1e-6);
});

test('Column at a point reproduces the stratigraphy (linear interpolation tolerance)', () => {
  const x = 37, y = 61;
  const col = GM.columnAt(volumes, E0 + x, N0 + y);
  assert.deepEqual(col.segments.map((s) => s.vol.name), ['Fill', 'Clay', 'Sand', 'Rock']);
  close(col.zTop, s0(x, y), 0.02, 'ground');
  close(col.segments[1].ztop, s1(x, y), 0.02, 'top clay');
  close(col.segments[2].ztop, s2(x, y), 0.02, 'top sand');
  close(col.segments[3].ztop, s3(x, y), 0.03, 'top rock');
  close(col.zBot, s4(x, y), 0.02, 'model base');
  assert.equal(col.warnings.length, 0);
});

test('Column on a mesh edge/vertex is not double counted', () => {
  const col = GM.columnAt(volumes, E0 + 50, N0 + 50);
  assert.equal(col.segments.length, 4);
});

test('Outside the model returns no segments', () => {
  assert.equal(GM.columnAt(volumes, E0 - 10, N0 + 10).segments.length, 0);
});

test('CSV collars: delimiter, header and column detection', () => {
  const csv = IO.parseCSV(fs.readFileSync(S('collars.csv'), 'utf8'));
  const g = IO.guessColumns(csv.headers);
  assert.deepEqual([g.id, g.x, g.y, g.z, g.G, g.Q], ['Pile_ID', 'Easting', 'Northing', 'RL', 'G', 'Q']);
  assert.equal(csv.rows.length, 91);
  const semi = IO.parseCSV('id;x;y;z\n"A ""1""";1;2;3\n');
  assert.equal(semi.rows[0].id, 'A "1"');
});

test('Zipped shapefile polygons with DBF attributes', async () => {
  const buf = fs.readFileSync(S('zones.zip'));
  const shp = await IO.readShapefileFiles([{ name: 'zones.zip', buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) }]);
  assert.equal(shp.shapeType, 'Polygon');
  assert.equal(shp.features.length, 2);
  assert.equal(shp.features[0].props.NAME, 'Heavy loads');
  assert.equal(shp.features[1].props.CASE, 'Sensitive');
  assert.ok(GM.pointInPolygon(E0 + 150, N0 + 40, shp.features[0].rings));
  assert.ok(!GM.pointInPolygon(E0 + 50, N0 + 40, shp.features[0].rings));
});

test('Groundwater from mesh and from points', () => {
  const gwd = IO.parseDXF(fs.readFileSync(S('groundwater.dxf'), 'utf8'));
  const at = GM.groundwaterModel({ kind: 'mesh', index: GM.buildIndex(gwd.layers.Groundwater) });
  close(at(E0 + 37, N0 + 61), s0(37, 61) - 3 - 0.37, 0.02);
  const pts = IO.parseCSV(fs.readFileSync(S('groundwater.csv'), 'utf8')).rows.flatMap((r) => [+r.X, +r.Y, +r.Z]);
  const idw = GM.groundwaterModel({ kind: 'points', points: pts });
  close(idw(E0 + 50, N0 + 50), s0(50, 50) - 3.5, 0.001, 'exact at data point');
  assert.equal(GM.groundwaterModel({ kind: 'rl', rl: 12 })(0, 0), 12);
});

const material = {
  Fill: { type: 'sand', gamma: 18, phi: 28, E: 10, nu: 0.3 },
  Clay: { type: 'clay', gamma: 19, su: 75, E: 30, nu: 0.3, fsMax: 100 },
  Sand: { type: 'sand', gamma: 20, phi: 36, E: 60, nu: 0.3, fsMax: 120, qbMax: 5000 },
  Rock: { type: 'rock', gamma: 22, qu: 2, E: 300, nu: 0.25, fsMax: 400, qbMax: 6000 },
};
const dcase = { id: 'c1', name: 'Default', pileType: 'bored', shape: 'circle', D: 0.6, Ep: 30000, G: 1200, Q: 450, psiS: 0.7, phiG: 0.52, settlementLimit: 15, ignoreTop: 1.0, minLength: 3, minEmbed: 0.5 };
const model = () => ({
  volumes,
  materials: Object.fromEntries(volumes.map((v) => [v.id, material[v.name]])),
  gwAt: GM.groundwaterModel({ kind: 'rl', rl: 15 }),
  cases: { c1: dcase, c2: { ...dcase, id: 'c2', name: 'Heavy', G: 2400, Q: 900 } },
  zones: [{ name: 'Heavy loads', caseId: 'c2', rings: [[[E0 + 120, N0], [E0 + 200, N0], [E0 + 200, N0 + 80], [E0 + 120, N0 + 80]]] }],
  defaultCaseId: 'c1',
});

test('Automated pile design matches the equivalent single-pile calculation', () => {
  const C = require('../js/calc.js');
  const m = model();
  const pile = { id: 'P1', x: E0 + 37, y: N0 + 61, z: s0(37, 61) - 0.5 };
  const r = GM.designPile(pile, m);
  assert.equal(r.status, 'ok');
  assert.equal(r.caseName, 'Default');
  const col = GM.columnAt(volumes, pile.x, pile.y);
  const { input } = GM.pileInput(pile, col, dcase, 15, m.materials);
  const full = C.design(input);
  close(r.length, full.requiredLength, 1e-9, 'same length as full search');
  close(r.toeRL, pile.z - r.length, 1e-9, 'toe RL');
  assert.ok(r.Rdg >= r.Ed);
  close(input.gwl, col.zTop - 15, 1e-9, 'groundwater depth below ground');
});

test('Zones assign design cases; per-pile loads override the case', () => {
  const m = model();
  const heavy = GM.designPile({ id: 'P2', x: E0 + 150, y: N0 + 40, z: s0(150, 40) - 0.5 }, m);
  assert.equal(heavy.caseName, 'Heavy');
  close(heavy.Ed, 1.2 * 2400 + 1.5 * 900, 1e-9);
  const light = GM.designPile({ id: 'P3', x: E0 + 150, y: N0 + 40, z: s0(150, 40) - 0.5, G: 100, Q: 50 }, m);
  close(light.Ed, 1.2 * 100 + 1.5 * 50, 1e-9);
  assert.ok(light.length < heavy.length);
  const out = GM.designPile({ id: 'P4', x: E0 - 50, y: N0, z: 20 }, m);
  assert.equal(out.status, 'outside');
});

test('Collar above the model top adds a void layer with no resistance', () => {
  const m = model();
  const pile = { id: 'P5', x: E0 + 37, y: N0 + 61, z: s0(37, 61) + 2 };
  const col = GM.columnAt(volumes, pile.x, pile.y);
  const { input, head } = GM.pileInput(pile, col, dcase, null, m.materials);
  assert.equal(head, 0);
  assert.equal(input.layers[0].name, 'Above model');
  close(input.layers[0].bottom, 2, 0.02);
  assert.equal(input.gwl, null);
});
