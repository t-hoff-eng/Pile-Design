/* Automated pile design over a 3D ground model.
 * Depends on PileCalc, PileContent, PileApp (app.js), GeoIO, GeoModel and THREE (vendor/three).
 */
(function () {
  'use strict';
  const C = window.PileCalc;
  const K = window.PileContent;
  const A = window.PileApp;
  const IO = window.GeoIO;
  const GM = window.GeoModel;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = A.escapeHtml;
  const f0 = (v) => (v != null && isFinite(v) ? Math.round(v).toLocaleString('en-AU') : '–');
  const f1 = (v) => (v != null && isFinite(v) ? v.toFixed(1) : '–');
  const f2 = (v) => (v != null && isFinite(v) ? v.toFixed(2) : '–');
  const f3 = (v) => (v != null && isFinite(v) ? v.toFixed(3) : '–');

  const CASE_COLORS = ['#1f5fa8', '#d9822b', '#2a9d8f', '#9b4dca', '#c0392b', '#7f8c2d', '#e84393', '#16a085'];
  const STATUS = {
    ok: { label: 'Designed', color: '#2e9e5b' },
    nosolution: { label: 'No solution', color: '#d33a2c' },
    outside: { label: 'Outside model', color: '#8a8f98' },
    error: { label: 'Error', color: '#e08a00' },
    pending: { label: 'Not calculated', color: '#5d7fa8' },
  };
  const MAT_DEFAULTS = {
    clay: { type: 'clay', gamma: 19, su: 75, E: 30, nu: 0.3 },
    sand: { type: 'sand', gamma: 19, phi: 32, E: 30, nu: 0.3 },
    rock: { type: 'rock', gamma: 23, qu: 5, E: 500, nu: 0.25 },
    user: { type: 'user', gamma: 19, fsUser: 50, qbUser: 1000, E: 30, nu: 0.3 },
  };
  const VOL_COLS = ['type', 'gamma', 'su', 'phi', 'qu', 'E', 'nu', 'fsUser', 'qbUser', 'fsMax', 'qbMax'];

  // ---------------------------------------------------------------------------
  // Geometry storage (IndexedDB) and runtime cache
  // ---------------------------------------------------------------------------
  const cache = new Map(); // id -> { data: Float64Array, index? }
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
        const r = indexedDB.open('pile-design-geometry', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('geom');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function idb(mode, fn) {
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const tx = d.transaction('geom', mode);
        const req = fn(tx.objectStore('geom'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {
      console.warn('Geometry storage unavailable:', e);
      return undefined;
    }
  }
  async function putGeom(id, data) {
    cache.set(id, { data });
    await idb('readwrite', (s) => s.put(data, id));
  }
  async function getGeom(id) {
    if (cache.has(id)) return cache.get(id);
    const data = await idb('readonly', (s) => s.get(id));
    if (!data) return null;
    const e = { data: data instanceof Float64Array ? data : Float64Array.from(data) };
    cache.set(id, e);
    return e;
  }
  async function indexOf(id) {
    const g = await getGeom(id);
    if (!g) return null;
    if (!g.index) g.index = GM.buildIndex(g.data);
    return g.index;
  }
  function referencedIds() {
    const ids = new Set();
    A.projects().forEach((p) => {
      const a = p.auto;
      if (!a) return;
      (a.volumes || []).forEach((v) => ids.add(v.geomId));
      if (a.gw && a.gw.geomId) ids.add(a.gw.geomId);
    });
    return ids;
  }
  async function gcGeometry() {
    const keep = referencedIds();
    const keys = (await idb('readonly', (s) => s.getAllKeys())) || [];
    for (const k of keys) {
      if (!keep.has(k)) {
        cache.delete(k);
        await idb('readwrite', (s) => s.delete(k));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Project data
  // ---------------------------------------------------------------------------
  function newCase(name, i = 0) {
    return {
      id: A.uid(), name: name || 'Default', color: CASE_COLORS[i % CASE_COLORS.length],
      pileType: 'bored', shape: 'circle', D: 0.6, Ep: 30000, wall: 0.012,
      G: 1000, Q: 400, psiS: 0.7, phiG: 0.52,
      settlementLimit: 15, settlementMethod: 'max', ignoreTop: 1, minLength: 3, maxLength: '', minEmbed: 0.5,
    };
  }
  function auto() {
    const p = A.project();
    if (!p.auto) {
      const c = newCase('Default');
      p.auto = { volumes: [], gw: { mode: 'none', rl: '', geomId: null, kind: null, name: '' }, collars: [], collarSource: '', cases: [c], defaultCaseId: c.id, zones: [], results: null, view: { mode: 'plan', colorBy: 'status' } };
    }
    const a = p.auto;
    a.view = a.view || { mode: 'plan', colorBy: 'status' };
    if (!a.cases.length) a.cases.push(newCase('Default'));
    if (!a.cases.some((c) => c.id === a.defaultCaseId)) a.defaultCaseId = a.cases[0].id;
    return a;
  }
  function signature() {
    const a = auto();
    return JSON.stringify([a.volumes.map((v) => [v.geomId, v.material]), a.gw, a.collars.length, a.collars.slice(0, 3), a.collars.slice(-3), a.cases, a.defaultCaseId, a.zones.map((z) => [z.caseId, z.rings])]);
  }
  function changed(opts = {}) {
    A.save();
    renderStale();
    if (!opts.noDraw) redraw();
  }

  // ---------------------------------------------------------------------------
  // 1. Ground model volumes
  // ---------------------------------------------------------------------------
  function guessMaterial(name) {
    const sheet = A.currentSheet();
    const match = sheet && sheet.layers.find((l) => (l.name || '').trim().toLowerCase() === name.trim().toLowerCase());
    if (match) {
      const m = {};
      ['type', 'gamma', 'su', 'phi', 'qu', 'E', 'nu', 'fsUser', 'qbUser', 'fsMax', 'qbMax', 'pattern', 'color'].forEach((k) => match[k] !== undefined && (m[k] = match[k]));
      return { material: m, matched: true };
    }
    const n = name.toLowerCase();
    let type = 'clay';
    if (/rock|stone|shale|granite|basalt|weathered|tuff|bedrock|siltst|mudst|claystone|sandstone|greywacke|schist/.test(n)) type = 'rock';
    else if (/sand|gravel|fill|alluv|gw|sp|sw/.test(n)) type = 'sand';
    const fill = K.TYPE_DEFAULT_FILL[type];
    let pattern = fill.pattern, color = fill.color;
    if (/fill/.test(n)) pattern = 'crosshatch';
    if (/gravel/.test(n)) pattern = 'circles';
    if (/silt(?!st)/.test(n)) pattern = 'dashdot';
    if (/peat|organic/.test(n)) pattern = 'peat';
    return { material: { ...MAT_DEFAULTS[type], pattern, color }, matched: false };
  }

  $('#auto-dxf').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    const st = $('#auto-dxf-status');
    const a = auto();
    let added = 0, matched = 0;
    const notes = [];
    for (const f of files) {
      st.textContent = `Reading ${f.name}…`;
      await tick();
      try {
        const r = IO.parseDXF(await f.text());
        const names = Object.keys(r.layers);
        if (!names.length) notes.push(`${f.name}: no 3DFACE or polyface meshes found${Object.keys(r.skipped).length ? ` (unsupported: ${Object.keys(r.skipped).join(', ')})` : ''}`);
        for (const name of names) {
          const tris = r.layers[name];
          const geomId = A.uid();
          await putGeom(geomId, tris);
          const g = guessMaterial(name);
          if (g.matched) matched++;
          const existing = a.volumes.find((v) => v.name === name);
          const vol = { id: existing ? existing.id : A.uid(), name, file: f.name, geomId, triCount: tris.length / 9, bbox: IO.bboxOf(tris), hull: GM.hullOfXYZ(tris), visible: true, material: existing ? existing.material : g.material };
          if (existing) a.volumes[a.volumes.indexOf(existing)] = vol;
          else a.volumes.push(vol);
          added++;
        }
      } catch (err) {
        notes.push(`${f.name}: ${err.message}`);
      }
    }
    st.textContent = `${added} volume(s) imported${matched ? `, ${matched} matched to sheet layers` : ''}. ${notes.join(' ')}`;
    renderVolumes();
    changed();
    gcGeometry();
    fitView();
  });

  function renderVolumes() {
    const a = auto();
    const body = $('#vol-body');
    if (!a.volumes.length) {
      body.innerHTML = `<tr><td colspan="16" class="hint">No volumes imported. Try <code>samples/ground_model.dxf</code>.</td></tr>`;
      return;
    }
    const patternOptions = (sel) => Object.entries(K.PATTERNS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
    body.innerHTML = a.volumes.map((v, i) => {
      const m = v.material;
      const active = A.LAYER_FIELDS[m.type] || [];
      const cell = (c) => {
        if (c === 'type') return `<td><select data-vol="${i}" data-f="type">${Object.entries(A.TYPE_LABEL).map(([k, t]) => `<option value="${k}"${k === m.type ? ' selected' : ''}>${t}</option>`).join('')}</select></td>`;
        const dis = c !== 'gamma' && !active.includes(c) ? ' disabled' : '';
        return `<td><input type="number" step="any" data-vol="${i}" data-f="${c}" value="${m[c] == null ? '' : esc(m[c])}"${dis}></td>`;
      };
      return `<tr>
        <td><input type="checkbox" data-vol="${i}" data-f="visible"${v.visible !== false ? ' checked' : ''} aria-label="Show ${esc(v.name)}"></td>
        <td class="fill-cell"><div class="fill-ctl"><span class="sw">${K.swatch(m.pattern, m.color)}</span><select data-vol="${i}" data-f="pattern">${patternOptions(m.pattern)}</select><input type="color" data-vol="${i}" data-f="color" value="${esc(m.color || '#cccccc')}"></div></td>
        <td title="${esc(v.file)}"><b>${esc(v.name)}</b></td>
        <td class="num">${f0(v.triCount)}</td>
        ${VOL_COLS.map(cell).join('')}
        <td><button type="button" class="icon" data-del-vol="${i}" title="Remove volume">✕</button></td></tr>`;
    }).join('');
  }
  $('#vol-body').addEventListener('change', onVolInput);
  $('#vol-body').addEventListener('input', (e) => e.target.type === 'number' && onVolInput(e));
  function onVolInput(e) {
    const el = e.target;
    if (el.dataset.vol == null) return;
    const v = auto().volumes[Number(el.dataset.vol)];
    const f = el.dataset.f;
    if (f === 'visible') v.visible = el.checked;
    else if (f === 'type' || f === 'pattern' || f === 'color') v.material[f] = el.value;
    else v.material[f] = el.value === '' ? '' : Number(el.value);
    if (f === 'type') {
      v.material = { ...MAT_DEFAULTS[el.value], ...pick(v.material, ['gamma', 'E', 'nu', 'fsMax', 'qbMax', 'pattern', 'color']), type: el.value };
      renderVolumes();
    }
    if (f === 'pattern' || f === 'color') renderVolumes();
    changed({ noDraw: f !== 'visible' && f !== 'pattern' && f !== 'color' });
    if (f === 'visible' || f === 'color') rebuild3D();
  }
  $('#vol-body').addEventListener('click', (e) => {
    const i = e.target.dataset.delVol;
    if (i == null) return;
    const a = auto();
    if (!confirm(`Remove volume "${a.volumes[i].name}"?`)) return;
    a.volumes.splice(Number(i), 1);
    renderVolumes();
    changed();
    rebuild3D();
    gcGeometry();
  });
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------------------------------------------------------------------------
  // 2. Groundwater
  // ---------------------------------------------------------------------------
  function renderGW() {
    const g = auto().gw;
    $('#gw-mode').value = g.mode;
    $('#gw-rl').value = g.rl;
    $$('[data-gw]').forEach((el) => (el.hidden = !el.dataset.gw.split(' ').includes(g.mode)));
    $('#gw-status').textContent = g.geomId ? `${g.name}: ${g.kind === 'mesh' ? f0(g.count) + ' triangles' : f0(g.count) + ' points'}` : 'No surface imported.';
  }
  $('#gw-mode').addEventListener('change', (e) => {
    auto().gw.mode = e.target.value;
    renderGW();
    changed();
    rebuild3D();
  });
  $('#gw-rl').addEventListener('input', (e) => {
    auto().gw.rl = e.target.value === '' ? '' : Number(e.target.value);
    changed({ noDraw: true });
  });
  $('#auto-gw').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const g = auto().gw;
    try {
      const text = await f.text();
      let data, kind, count;
      if (/\.dxf$/i.test(f.name)) {
        const r = IO.parseDXF(text);
        const all = Object.values(r.layers);
        if (!all.length) throw new Error('no triangulated surface found');
        data = new Float64Array(all.reduce((n, a) => n + a.length, 0));
        let o = 0;
        all.forEach((a) => {
          data.set(a, o);
          o += a.length;
        });
        kind = 'mesh';
        count = data.length / 9;
      } else {
        const csv = IO.parseCSV(text);
        const gc = IO.guessColumns(csv.headers);
        const [hx, hy, hz] = [gc.x || csv.headers[0], gc.y || csv.headers[1], gc.z || csv.headers[2]];
        const pts = [];
        csv.rows.forEach((r) => {
          const x = Number(r[hx]), y = Number(r[hy]), z = Number(r[hz]);
          if ([x, y, z].every(isFinite)) pts.push(x, y, z);
        });
        if (pts.length < 9) throw new Error('need at least 3 x,y,z points');
        data = Float64Array.from(pts);
        kind = 'points';
        count = pts.length / 3;
      }
      const geomId = A.uid();
      await putGeom(geomId, data);
      Object.assign(g, { mode: 'surface', geomId, kind, count, name: f.name, hull: GM.hullOfXYZ(data), bbox: IO.bboxOf(data) });
      renderGW();
      changed();
      rebuild3D();
      gcGeometry();
    } catch (err) {
      $('#gw-status').textContent = `Could not read ${f.name}: ${err.message}`;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Collars
  // ---------------------------------------------------------------------------
  let collarSource = null; // { headers, rows } kept in memory for re-mapping
  $('#auto-collars').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    const st = $('#collar-status');
    try {
      let headers, rows, mapping;
      if (files.some((f) => /\.(zip|shp|dbf)$/i.test(f.name))) {
        const shp = await IO.readShapefileFiles(await Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))));
        const pts = shp.features.filter((f) => f.kind === 'point');
        if (!pts.length) throw new Error(`no point features (shape type ${shp.shapeType})`);
        headers = ['Shape X', 'Shape Y', 'Shape Z', ...shp.fields.map((f) => f.name)];
        rows = pts.map((f) => ({ 'Shape X': f.coords[0], 'Shape Y': f.coords[1], 'Shape Z': f.coords[2], ...f.props }));
        const g = IO.guessColumns(shp.fields.map((f) => f.name));
        mapping = { id: g.id, x: 'Shape X', y: 'Shape Y', z: pts[0].coords[2] != null ? 'Shape Z' : g.z, G: g.G, Q: g.Q };
      } else {
        const csv = IO.parseCSV(await files[0].text());
        headers = csv.headers;
        rows = csv.rows;
        mapping = IO.guessColumns(headers);
      }
      collarSource = { headers, rows, name: files.map((f) => f.name).join(', ') };
      renderCollarMap(mapping);
      applyCollarMap();
      fitView();
    } catch (err) {
      st.textContent = 'Could not read collars: ' + err.message;
    }
  });
  function renderCollarMap(mapping) {
    const box = $('#collar-map');
    box.hidden = !collarSource;
    if (!collarSource) return;
    $$('select[data-map]', box).forEach((sel) => {
      const k = sel.dataset.map;
      const optional = k === 'G' || k === 'Q' || k === 'id';
      sel.innerHTML = (optional ? '<option value="">(none)</option>' : '<option value="">– select –</option>') + collarSource.headers.map((h) => `<option${h === mapping[k] ? ' selected' : ''}>${esc(h)}</option>`).join('');
    });
  }
  $('#collar-map').addEventListener('change', applyCollarMap);
  function applyCollarMap() {
    if (!collarSource) return;
    const m = {};
    $$('#collar-map select[data-map]').forEach((s) => (m[s.dataset.map] = s.value));
    const st = $('#collar-status');
    if (!m.x || !m.y || !m.z) {
      st.textContent = 'Select the X, Y and Z columns.';
      return;
    }
    const num = (v) => (v === '' || v == null ? undefined : Number(v));
    const collars = [];
    let bad = 0;
    collarSource.rows.forEach((r, i) => {
      const c = { id: m.id && r[m.id] !== '' ? String(r[m.id]) : `P${i + 1}`, x: num(r[m.x]), y: num(r[m.y]), z: num(r[m.z]) };
      if (m.G) c.G = num(r[m.G]);
      if (m.Q) c.Q = num(r[m.Q]);
      if ([c.x, c.y, c.z].every((v) => v !== undefined && isFinite(v))) collars.push(c);
      else bad++;
    });
    const a = auto();
    a.collars = collars;
    a.collarSource = collarSource.name;
    st.textContent = `${collars.length} piles from ${collarSource.name}${bad ? ` (${bad} rows skipped – missing coordinates)` : ''}.`;
    selected = null;
    changed();
    rebuild3D();
  }

  // ---------------------------------------------------------------------------
  // 4. Design cases
  // ---------------------------------------------------------------------------
  const CASE_NUM = ['D', 'Ep', 'wall', 'G', 'Q', 'psiS', 'phiG', 'settlementLimit', 'ignoreTop', 'minLength', 'maxLength', 'minEmbed'];
  function renderCases() {
    const a = auto();
    const sheets = A.project().calcs;
    const n = (c, k, step) => `<td><input type="number" step="${step || 'any'}" data-case="${c.id}" data-f="${k}" value="${c[k] == null ? '' : esc(c[k])}"${k === 'wall' && c.pileType !== 'steelTube' ? ' disabled' : ''}></td>`;
    $('#case-body').innerHTML = a.cases.map((c) => `<tr>
      <td><input type="color" data-case="${c.id}" data-f="color" value="${esc(c.color)}"></td>
      <td><input data-case="${c.id}" data-f="name" value="${esc(c.name)}"></td>
      <td><select data-case="${c.id}" data-f="pileType">${Object.entries(C.PILE_TYPES).map(([k, t]) => `<option value="${k}"${k === c.pileType ? ' selected' : ''}>${t.label}</option>`).join('')}</select></td>
      <td><select data-case="${c.id}" data-f="shape"><option value="circle"${c.shape === 'circle' ? ' selected' : ''}>Circular</option><option value="square"${c.shape === 'square' ? ' selected' : ''}>Square</option></select></td>
      ${n(c, 'D', 0.05)}${n(c, 'Ep', 1000)}${n(c, 'wall', 0.001)}${n(c, 'G', 10)}${n(c, 'Q', 10)}${n(c, 'psiS', 0.1)}${n(c, 'phiG', 0.01)}
      <td><select data-case="${c.id}" data-f="phiFrom"><option value="">–</option>${sheets.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></td>
      ${n(c, 'settlementLimit', 1)}
      <td><select data-case="${c.id}" data-f="settlementMethod"><option value="max"${c.settlementMethod === 'max' ? ' selected' : ''}>Max</option><option value="rw"${c.settlementMethod === 'rw' ? ' selected' : ''}>R&amp;W</option><option value="fleming"${c.settlementMethod === 'fleming' ? ' selected' : ''}>Fleming</option></select></td>
      ${n(c, 'ignoreTop', 0.1)}${n(c, 'minLength', 0.5)}${n(c, 'maxLength', 0.5)}${n(c, 'minEmbed', 0.1)}
      <td><button type="button" class="icon" data-del-case="${c.id}" title="Delete case"${a.cases.length < 2 ? ' disabled' : ''}>✕</button></td></tr>`).join('');
    const opts = a.cases.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('#default-case').innerHTML = opts;
    $('#default-case').value = a.defaultCaseId;
    const zi = $('#zone-import-case');
    const prev = zi.value;
    zi.innerHTML = opts;
    if (a.cases.some((c) => c.id === prev)) zi.value = prev;
  }
  $('#case-body').addEventListener('change', onCaseInput);
  $('#case-body').addEventListener('input', (e) => (e.target.type === 'number' || e.target.dataset.f === 'name') && onCaseInput(e));
  function onCaseInput(e) {
    const el = e.target;
    const c = auto().cases.find((x) => x.id === el.dataset.case);
    if (!c) return;
    const f = el.dataset.f;
    if (f === 'phiFrom') {
      if (!el.value) return;
      const sheet = A.project().calcs.find((s) => s.id === el.value);
      const phi = A.sheetPhiG(sheet);
      c.phiG = Math.round(phi.phiG * 1000) / 1000;
      el.value = '';
      renderCases();
      $('#run-status').textContent = `φg = ${c.phiG} copied to "${c.name}" from sheet "${sheet.name}" (ARR ${phi.arr.toFixed(2)}${phi.K ? `, K ${phi.K.toFixed(2)}` : ''}).`;
    } else if (CASE_NUM.includes(f)) c[f] = el.value === '' ? '' : Number(el.value);
    else c[f] = el.value;
    if (f === 'pileType' && e.type === 'change') {
      if (el.value === 'steelTube') c.Ep = 200000;
      else if (Number(c.Ep) >= 200000) c.Ep = 30000;
      if (el.value === 'precast') c.shape = 'square';
      renderCases();
    }
    if (f === 'name' && e.type === 'change') {
      renderCases();
      renderZones();
    }
    changed({ noDraw: !(f === 'color' || (f === 'name' && e.type === 'change')) });
    if (f === 'color') rebuild3D();
  }
  $('#case-body').addEventListener('click', (e) => {
    const id = e.target.dataset.delCase;
    if (!id) return;
    const a = auto();
    const c = a.cases.find((x) => x.id === id);
    const used = a.zones.filter((z) => z.caseId === id).length;
    if (!confirm(`Delete design case "${c.name}"?${used ? ` ${used} zone(s) using it will switch to the default case.` : ''}`)) return;
    a.cases = a.cases.filter((x) => x.id !== id);
    if (a.defaultCaseId === id) a.defaultCaseId = a.cases[0].id;
    a.zones.forEach((z) => z.caseId === id && (z.caseId = a.defaultCaseId));
    renderCases();
    renderZones();
    changed();
  });
  $('#btn-add-case').addEventListener('click', () => {
    const a = auto();
    const base = a.cases[a.cases.length - 1];
    const c = { ...A.clone(base), id: A.uid(), name: `Case ${a.cases.length + 1}`, color: CASE_COLORS[a.cases.length % CASE_COLORS.length] };
    a.cases.push(c);
    renderCases();
    changed({ noDraw: true });
  });
  $('#default-case').addEventListener('change', (e) => {
    auto().defaultCaseId = e.target.value;
    changed();
  });

  // ---------------------------------------------------------------------------
  // 5. Zones
  // ---------------------------------------------------------------------------
  function ringArea(r) {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return Math.abs(s / 2);
  }
  function renderZones() {
    const a = auto();
    const body = $('#zone-body');
    if (!a.zones.length) {
      body.innerHTML = '<tr><td colspan="6" class="hint">No zones. All piles use the default case.</td></tr>';
      return;
    }
    const counts = new Map();
    a.collars.forEach((p) => {
      const r = GM.caseAt(p.x, p.y, a.zones, a.defaultCaseId);
      if (r.zone) counts.set(r.zone.id, (counts.get(r.zone.id) || 0) + 1);
    });
    body.innerHTML = a.zones.map((z, i) => `<tr>
      <td><input data-zone="${i}" data-f="name" value="${esc(z.name)}"></td>
      <td><select data-zone="${i}" data-f="caseId">${a.cases.map((c) => `<option value="${c.id}"${c.id === z.caseId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
      <td class="num">${z.rings.reduce((n, r) => n + r.length, 0)}</td>
      <td class="num">${f0(z.rings.reduce((s, r) => s + ringArea(r), 0))}</td>
      <td class="num">${counts.get(z.id) || 0}</td>
      <td><button type="button" class="icon" data-del-zone="${i}" title="Delete zone">✕</button></td></tr>`).join('');
  }
  $('#zone-body').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.zone == null) return;
    auto().zones[Number(el.dataset.zone)][el.dataset.f] = el.value;
    renderZones();
    changed();
    rebuild3D();
  });
  $('#zone-body').addEventListener('click', (e) => {
    const i = e.target.dataset.delZone;
    if (i == null) return;
    auto().zones.splice(Number(i), 1);
    renderZones();
    changed();
    rebuild3D();
  });
  $('#auto-zones').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    try {
      const shp = await IO.readShapefileFiles(await Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))));
      const polys = shp.features.filter((f) => f.kind === 'polygon');
      if (!polys.length) throw new Error(`no polygon features (shape type ${shp.shapeType})`);
      const a = auto();
      const fallback = $('#zone-import-case').value || a.defaultCaseId;
      let matched = 0;
      polys.forEach((f, i) => {
        const vals = Object.values(f.props || {}).map((v) => String(v).trim().toLowerCase());
        const c = a.cases.find((cs) => vals.includes(cs.name.trim().toLowerCase()));
        if (c) matched++;
        const nameKey = Object.keys(f.props || {}).find((k) => /^(name|zone|label|id)$/i.test(k));
        a.zones.push({ id: A.uid(), name: (nameKey && f.props[nameKey]) || `Zone ${a.zones.length + 1}`, caseId: c ? c.id : fallback, rings: f.rings.map((r) => r.map((p) => [p[0], p[1]])), source: 'shapefile' });
      });
      $('#run-status').textContent = `${polys.length} zone(s) imported; ${matched} matched a case by attribute.`;
      renderZones();
      changed();
      rebuild3D();
    } catch (err) {
      alert('Could not import zones: ' + err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Run
  // ---------------------------------------------------------------------------
  let running = null;
  async function buildModel() {
    const a = auto();
    const volumes = [];
    for (const v of a.volumes) volumes.push({ id: v.id, name: v.name, index: await indexOf(v.geomId) });
    const materials = Object.fromEntries(a.volumes.map((v) => [v.id, v.material]));
    let gwAt = () => null;
    const g = a.gw;
    if (g.mode === 'rl') gwAt = GM.groundwaterModel({ kind: 'rl', rl: g.rl });
    else if (g.mode === 'surface' && g.geomId) {
      const geo = await getGeom(g.geomId);
      const fn = g.kind === 'mesh' ? GM.groundwaterModel({ kind: 'mesh', index: await indexOf(g.geomId) }) : GM.groundwaterModel({ kind: 'points', points: geo.data });
      const fb = g.rl === '' || g.rl == null ? null : Number(g.rl);
      gwAt = (x, y) => {
        const z = fn(x, y);
        return z == null ? fb : z;
      };
    }
    return { volumes, materials, gwAt, cases: Object.fromEntries(a.cases.map((c) => [c.id, c])), zones: a.zones, defaultCaseId: a.defaultCaseId };
  }
  $('#btn-run-auto').addEventListener('click', async () => {
    const a = auto();
    const st = $('#run-status');
    if (!a.volumes.length) return (st.textContent = 'Import the ground model volumes first.');
    if (!a.collars.length) return (st.textContent = 'Import pile collars first.');
    const prog = $('#run-progress');
    const token = (running = { cancel: false });
    $('#btn-run-auto').disabled = true;
    $('#btn-cancel-auto').hidden = false;
    prog.hidden = false;
    st.textContent = 'Preparing ground model…';
    await tick();
    const model = await buildModel();
    if (model.volumes.some((v) => !v.index)) {
      st.textContent = 'Volume geometry is missing from this browser – re-import the DXF.';
      finish();
      return;
    }
    const rows = [];
    const t0 = performance.now();
    for (let i = 0; i < a.collars.length; i++) {
      if (token.cancel) break;
      rows.push(GM.designPile(a.collars[i], model));
      if (i % 5 === 4 || i === a.collars.length - 1) {
        prog.value = (i + 1) / a.collars.length;
        st.textContent = `Calculating pile ${i + 1} of ${a.collars.length}…`;
        await tick();
      }
    }
    if (!token.cancel) {
      rows.forEach((r) => {
        delete r.column; // keep stored results compact; recomputed on demand
      });
      a.results = { rows, signature: signature(), at: new Date().toISOString(), seconds: (performance.now() - t0) / 1000 };
      st.textContent = `Calculated ${rows.length} piles in ${a.results.seconds.toFixed(1)} s.`;
      A.save();
    } else st.textContent = 'Cancelled.';
    finish();
    function finish() {
      running = null;
      $('#btn-run-auto').disabled = false;
      $('#btn-cancel-auto').hidden = true;
      prog.hidden = true;
      renderStale();
      renderResults();
      redraw();
      rebuild3D();
    }
  });
  $('#btn-cancel-auto').addEventListener('click', () => running && (running.cancel = true));

  function renderStale() {
    const a = auto();
    $('#auto-stale').hidden = !(a.results && a.results.signature !== signature());
  }
  function resultMap() {
    const a = auto();
    const m = new Map();
    if (a.results) a.results.rows.forEach((r) => m.set(r.id, r));
    return m;
  }

  // ---------------------------------------------------------------------------
  // Results: KPIs and table
  // ---------------------------------------------------------------------------
  let sortKey = 'id', sortDir = 1;
  const COLS = [
    ['id', 'Pile'], ['x', 'Easting', 2], ['y', 'Northing', 2], ['z', 'Collar RL', 2], ['caseName', 'Case'], ['zoneName', 'Zone'],
    ['zGround', 'Ground RL', 2], ['gwRL', 'GWL RL', 2], ['length', 'Length (m)', 2], ['toeRL', 'Toe RL', 2], ['baseLayer', 'Founding unit'],
    ['Ed', 'E*d (kN)', 0], ['Rdg', 'R*d,g (kN)', 0], ['utilisation', 'Util.', 2], ['settlement', 'Settl. (mm)', 1], ['governedBy', 'Governs'], ['status', 'Status'],
  ];
  function renderResults() {
    const a = auto();
    const res = a.results;
    const kp = $('#auto-kpis');
    const tbl = $('#auto-table');
    if (!res) {
      kp.innerHTML = `<div class="kpi"><div class="k">Piles</div><div class="v">${a.collars.length}</div><div class="s">not yet calculated</div></div>`;
      tbl.innerHTML = '<p class="hint">Run the calculation to see the required length at each pile.</p>';
      return;
    }
    const rows = res.rows;
    const ok = rows.filter((r) => r.status === 'ok');
    const L = ok.map((r) => r.length);
    const total = L.reduce((s, v) => s + v, 0);
    const vol = ok.reduce((s, r) => s + (r.D ? (Math.PI * r.D * r.D) / 4 : 0) * r.length, 0);
    const k = (label, v, s, cls = '') => `<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    kp.innerHTML = [
      k('Piles designed', `${ok.length} / ${rows.length}`, rows.length - ok.length ? `<span class="pill bad">${rows.length - ok.length} not designed</span>` : '<span class="pill ok">all OK</span>', 'hero'),
      k('Length range', L.length ? `${f1(Math.min(...L))}–${f1(Math.max(...L))} m` : '–', `mean ${L.length ? f2(total / L.length) : '–'} m`),
      k('Total pile length', `${f0(total)} m`, `${f1(vol)} m³ (circular-equivalent volume)`),
      k('Calculated', new Date(res.at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' }), `${f1(res.seconds)} s`),
    ].join('');
    const filter = $('#result-filter').value;
    let list = rows.filter((r) => filter === 'all' || (filter === 'ok' ? r.status === 'ok' : r.status !== 'ok'));
    list = list.slice().sort((p, q) => {
      const a1 = p[sortKey], b1 = q[sortKey];
      if (a1 == null) return 1;
      if (b1 == null) return -1;
      return (typeof a1 === 'number' ? a1 - b1 : String(a1).localeCompare(String(b1), undefined, { numeric: true })) * sortDir;
    });
    const cell = (r, [key, , dp]) => {
      if (key === 'status') return `<td><span class="pill" style="background:${STATUS[r.status].color}22;color:${STATUS[r.status].color}">${STATUS[r.status].label}</span>${r.message ? ` <span class="hint">${esc(r.message)}</span>` : ''}${r.warnings && r.warnings.length ? ` <span title="${esc(r.warnings.join('\n'))}">⚠</span>` : ''}</td>`;
      const v = r[key];
      if (dp !== undefined) return `<td class="num">${dp === 0 ? f0(v) : dp === 1 ? f1(v) : f2(v)}</td>`;
      return `<td>${v == null ? '' : esc(v)}</td>`;
    };
    tbl.innerHTML = `<table class="data summary"><thead><tr>${COLS.map(([key, label, dp]) => `<th class="${dp !== undefined ? 'num' : ''} sortable" data-sort="${key}">${label}${sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.map((r) => `<tr data-pile="${esc(r.id)}" class="clickable${selected === r.id ? ' sel' : ''}">${COLS.map((c) => cell(r, c)).join('')}</tr>`).join('')}</tbody></table>`;
  }
  $('#auto-table').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (th) {
      const k2 = th.dataset.sort;
      sortDir = sortKey === k2 ? -sortDir : 1;
      sortKey = k2;
      renderResults();
      return;
    }
    const tr = e.target.closest('[data-pile]');
    if (tr) selectPile(tr.dataset.pile, true);
  });
  $('#result-filter').addEventListener('change', renderResults);
  $('#btn-export-results').addEventListener('click', () => {
    const a = auto();
    if (!a.results) return alert('Run the calculation first.');
    const keys = ['id', 'x', 'y', 'z', 'caseName', 'zoneName', 'D', 'zGround', 'gwRL', 'length', 'toeRL', 'toeDepth', 'baseLayer', 'Ed', 'Psls', 'phiG', 'Rs', 'Rb', 'Rdug', 'Rdg', 'utilisation', 'settlement', 'governedBy', 'status', 'message'];
    const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : typeof v === 'number' ? +v.toFixed(4) : v);
    const csv = [keys.join(',')].concat(a.results.rows.map((r) => keys.map((k2) => q(r[k2])).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `${(A.project().details.name || 'project').replace(/[^\w-]+/g, '_')}_pile_lengths.csv`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  });

  // ---------------------------------------------------------------------------
  // Selection and pile info
  // ---------------------------------------------------------------------------
  let selected = null;
  function selectPile(id, centre) {
    selected = id;
    const a = auto();
    const p = a.collars.find((c) => c.id === id);
    const r = resultMap().get(id);
    const box = $('#pile-info');
    if (!p) {
      box.hidden = true;
      return;
    }
    const dcase = a.cases.find((c) => c.id === (r ? r.caseId : GM.caseAt(p.x, p.y, a.zones, a.defaultCaseId).caseId));
    box.hidden = false;
    box.innerHTML = `<button type="button" class="icon close" data-close-info>✕</button>
      <b>${esc(id)}</b> <span class="hint">${dcase ? esc(dcase.name) : ''}</span><br>
      E ${f2(p.x)} · N ${f2(p.y)} · collar RL ${f2(p.z)}<br>
      ${r ? (r.status === 'ok' ? `<b>L = ${f2(r.length)} m</b>, toe RL ${f2(r.toeRL)} in ${esc(r.baseLayer)}<br>R*<sub>d,g</sub> ${f0(r.Rdg)} ≥ E*<sub>d</sub> ${f0(r.Ed)} kN · ${f1(r.settlement)} mm` : `<span style="color:${STATUS[r.status].color}">${STATUS[r.status].label}</span> ${esc(r.message || '')}`) : 'Not calculated'}
      <div class="info-actions"><button type="button" data-open-sheet-pile="${esc(id)}">Open as calculation sheet</button></div>`;
    if (centre && view.mode === 'plan') {
      plan.cx = p.x;
      plan.cy = p.y;
    }
    renderResults();
    redraw();
    highlight3D();
  }
  $('#pile-info').addEventListener('click', async (e) => {
    if (e.target.dataset.closeInfo != null) {
      $('#pile-info').hidden = true;
      selected = null;
      redraw();
      highlight3D();
      return;
    }
    const id = e.target.dataset.openSheetPile;
    if (!id) return;
    const a = auto();
    const p = a.collars.find((c) => c.id === id);
    const model = await buildModel();
    const column = GM.columnAt(model.volumes, p.x, p.y);
    if (!column.segments.length) return alert('This pile is outside the ground model.');
    const { caseId } = GM.caseAt(p.x, p.y, a.zones, a.defaultCaseId);
    const dc = model.cases[caseId];
    const { input } = GM.pileInput(p, column, dc, model.gwAt(p.x, p.y), model.materials);
    const calc = A.exampleCalc(`${id} (auto)`);
    calc.pile = { ...input.pile };
    calc.loads = input.loads;
    calc.gwl = input.gwl == null ? '' : Math.round(input.gwl * 100) / 100;
    calc.settlementLimit = isFinite(input.settlementLimit) ? input.settlementLimit : '';
    calc.settlementMethod = input.settlementMethod;
    calc.method = A.methodDefaults(dc.pileType);
    calc.reduction.override = dc.phiG;
    calc.layers = input.layers.map((l) => A.withFill({ ...l, bottom: Math.round(l.bottom * 1000) / 1000 }, l.pattern, l.color));
    A.addSheet(calc);
  });

  // ---------------------------------------------------------------------------
  // Viewer: mode, colours
  // ---------------------------------------------------------------------------
  const view = { mode: 'plan' };
  $$('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.view)));
  function setMode(mode) {
    view.mode = mode;
    auto().view.mode = mode;
    $$('.seg [data-view]').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === mode));
    $('#plan').style.display = mode === 'plan' ? '' : 'none';
    $('#view3d').hidden = mode !== '3d';
    $('#v3d-bar').hidden = mode !== '3d';
    if (mode === '3d') {
      if (!init3D()) {
        setMode('plan');
        return;
      }
      rebuild3D();
    } else redraw();
    A.save();
  }
  $('#color-by').addEventListener('change', (e) => {
    auto().view.colorBy = e.target.value;
    redraw();
    rebuild3D();
    A.save();
  });
  $('#btn-fit').addEventListener('click', () => (view.mode === 'plan' ? fitView() : fit3D()));

  function colorFn() {
    const a = auto();
    const by = a.view.colorBy || 'status';
    const rm = resultMap();
    const cases = new Map(a.cases.map((c) => [c.id, c]));
    if (by === 'case') {
      return (p) => {
        const r = rm.get(p.id);
        const cid = r ? r.caseId : GM.caseAt(p.x, p.y, a.zones, a.defaultCaseId).caseId;
        return (cases.get(cid) || a.cases[0]).color;
      };
    }
    if (by === 'length' || by === 'toe') {
      const key = by === 'length' ? 'length' : 'toeRL';
      const vals = Array.from(rm.values()).filter((r) => r.status === 'ok').map((r) => r[key]);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return (p) => {
        const r = rm.get(p.id);
        if (!r || r.status !== 'ok') return STATUS[r ? r.status : 'pending'].color;
        const t = hi > lo ? (r[key] - lo) / (hi - lo) : 0.5;
        return ramp(by === 'toe' ? 1 - t : t);
      };
    }
    return (p) => {
      const r = rm.get(p.id);
      return STATUS[r ? r.status : 'pending'].color;
    };
  }
  // perceptually ordered blue -> yellow ramp (viridis-like stops)
  const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const s = t * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(s));
    const u = s - i;
    const c0 = hex(RAMP[i]), c1 = hex(RAMP[i + 1]);
    return '#' + c0.map((v, k) => Math.round(v + (c1[k] - v) * u).toString(16).padStart(2, '0')).join('');
  }
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  function renderLegend() {
    const a = auto();
    const by = a.view.colorBy || 'status';
    const lg = $('#auto-legend');
    let html = '';
    if (by === 'status') html = Object.values(STATUS).map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join('');
    else if (by === 'case') html = a.cases.map((c) => `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('');
    else {
      const key = by === 'length' ? 'length' : 'toeRL';
      const vals = a.results ? a.results.rows.filter((r) => r.status === 'ok').map((r) => r[key]) : [];
      const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
      const grad = `linear-gradient(90deg, ${(by === 'toe' ? RAMP.slice().reverse() : RAMP).join(',')})`;
      html = vals.length ? `<span>${by === 'length' ? 'Length' : 'Toe RL'}: ${f1(by === 'toe' ? hi : lo)} m</span><span class="ramp" style="background:${grad}"></span><span>${f1(by === 'toe' ? lo : hi)} m</span>` : '<span class="hint">Run the calculation to colour by result.</span>';
    }
    html += a.volumes.map((v) => `<span class="lg-layer">${K.swatch(v.material.pattern, v.material.color, 22, 14)}${esc(v.name)}</span>`).join('');
    if (a.gw.mode === 'surface' && a.gw.geomId) html += `<span><i style="background:#1f6fd1"></i>Groundwater</span>`;
    lg.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // 2D plan (SVG): pan, zoom, select, draw zones
  // ---------------------------------------------------------------------------
  const svg = $('#plan');
  const plan = { cx: 0, cy: 0, s: 1, W: 800, H: 540 };
  let drawing = null; // array of [x,y]
  let hover = null;

  function extents() {
    const a = auto();
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    };
    a.volumes.forEach((v) => {
      add(v.bbox[0], v.bbox[1]);
      add(v.bbox[3], v.bbox[4]);
    });
    a.collars.forEach((p) => add(p.x, p.y));
    a.zones.forEach((z) => z.rings.forEach((r) => r.forEach((p) => add(p[0], p[1]))));
    if (!isFinite(b[0])) return [0, 0, 100, 100];
    return b;
  }
  function fitView() {
    const b = extents();
    measure();
    plan.cx = (b[0] + b[2]) / 2;
    plan.cy = (b[1] + b[3]) / 2;
    plan.s = Math.min((plan.W - 60) / Math.max(b[2] - b[0], 1), (plan.H - 60) / Math.max(b[3] - b[1], 1));
    redraw();
  }
  function measure() {
    const r = svg.getBoundingClientRect();
    plan.W = Math.max(200, r.width || 800);
    plan.H = Math.max(200, r.height || 540);
  }
  const sx = (x) => (x - plan.cx) * plan.s + plan.W / 2;
  const sy = (y) => plan.H / 2 - (y - plan.cy) * plan.s;
  const wx = (px) => (px - plan.W / 2) / plan.s + plan.cx;
  const wy = (py) => plan.cy - (py - plan.H / 2) / plan.s;
  const ptsAttr = (ring) => ring.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');

  function niceStep(span, n) {
    const raw = span / n;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  function redraw() {
    if ($('#tab-auto').hidden) return;
    renderLegend();
    if (view.mode !== 'plan') return;
    measure();
    const a = auto();
    const W = plan.W, H = plan.H;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let s = '<defs>' + a.volumes.map((v, i) => K.patternDef('pv' + i, v.material.pattern, v.material.color)).join('') + '</defs>';
    // grid
    const step = niceStep((W / plan.s), 6);
    const gx0 = Math.ceil(wx(0) / step) * step, gy0 = Math.ceil(wy(H) / step) * step;
    s += '<g class="grid">';
    for (let x = gx0; x <= wx(W); x += step) s += `<line x1="${sx(x)}" x2="${sx(x)}" y1="0" y2="${H}"/><text x="${sx(x) + 3}" y="${H - 6}">${Math.round(x).toLocaleString('en-AU')}</text>`;
    for (let y = gy0; y <= wy(0); y += step) s += `<line x1="0" x2="${W}" y1="${sy(y)}" y2="${sy(y)}"/><text x="4" y="${sy(y) - 3}">${Math.round(y).toLocaleString('en-AU')}</text>`;
    s += '</g>';
    // model footprints (convex hulls), top-most unit drawn last
    a.volumes.filter((v) => v.visible !== false).slice().sort((p, q) => p.bbox[5] - q.bbox[5]).forEach((v) => {
      const i = a.volumes.indexOf(v);
      s += `<polygon points="${ptsAttr(v.hull)}" fill="url(#pv${i})" fill-opacity="0.55" stroke="${v.material.color}" stroke-width="1.5"><title>${esc(v.name)} – footprint (convex hull)</title></polygon>`;
    });
    if (a.gw.mode === 'surface' && a.gw.hull) s += `<polygon points="${ptsAttr(a.gw.hull)}" fill="none" stroke="#1f6fd1" stroke-width="1.5" stroke-dasharray="6 4"><title>Groundwater surface extent</title></polygon>`;
    // zones
    const cases = new Map(a.cases.map((c) => [c.id, c]));
    a.zones.forEach((z) => {
      const c = cases.get(z.caseId) || a.cases[0];
      const d = z.rings.map((r) => 'M' + r.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('L') + 'Z').join('');
      s += `<path d="${d}" fill="${c.color}" fill-opacity="0.18" fill-rule="evenodd" stroke="${c.color}" stroke-width="2"><title>${esc(z.name)} → ${esc(c.name)}</title></path>`;
      const r0 = z.rings[0];
      if (r0 && r0.length) {
        const cx = r0.reduce((t, p) => t + p[0], 0) / r0.length, cy = r0.reduce((t, p) => t + p[1], 0) / r0.length;
        s += `<text x="${sx(cx)}" y="${sy(cy)}" text-anchor="middle" class="halo zone-label" style="fill:${c.color}">${esc(z.name)}</text>`;
      }
    });
    // piles
    const col = colorFn();
    const rm = resultMap();
    const showLabels = a.collars.length < 400 && plan.s > 4;
    const rad = Math.max(3, Math.min(8, plan.s * 0.6));
    a.collars.forEach((p) => {
      const X = sx(p.x), Y = sy(p.y);
      if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) return;
      const r = rm.get(p.id);
      const sel = p.id === selected;
      s += `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${sel ? rad + 3 : rad}" fill="${col(p)}" stroke="${sel ? 'var(--ink)' : 'var(--card)'}" stroke-width="${sel ? 2.5 : 1}"/>`;
      if (showLabels) s += `<text x="${X + rad + 2}" y="${Y - rad}" class="halo pile-label">${esc(p.id)}${r && r.status === 'ok' ? ` · ${r.length.toFixed(1)}` : ''}</text>`;
    });
    // drawing in progress
    if (drawing && drawing.length) {
      const pts = drawing.concat(hover ? [hover] : []);
      s += `<polyline points="${ptsAttr(pts)}" fill="rgba(31,95,168,0.12)" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 3"/>`;
      drawing.forEach((p) => (s += `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="4" fill="var(--accent)"/>`));
    }
    // north arrow and scale bar
    const sb = niceStep(W / plan.s, 4);
    s += `<g transform="translate(${W - 36},34)"><path d="M0 -18 L7 6 L0 1 L-7 6 Z" fill="var(--ink)"/><text x="0" y="20" text-anchor="middle" style="fill:var(--ink);font-weight:700">N</text></g>`;
    s += `<g transform="translate(16,${H - 44})"><rect width="${sb * plan.s}" height="5" fill="var(--ink)"/><text x="${(sb * plan.s) / 2}" y="-4" text-anchor="middle" style="fill:var(--ink)">${sb >= 1000 ? sb / 1000 + ' km' : sb + ' m'}</text></g>`;
    if (!a.volumes.length && !a.collars.length) s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="fill:var(--muted);font-size:14px">Import a ground model and pile collars to begin</text>`;
    svg.innerHTML = s;
    svg.classList.toggle('drawing', !!drawing);
  }

  // pointer interaction
  let drag = null;
  const local = (e) => {
    const r = svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e);
    const x = wx(px), y = wy(py);
    plan.s *= Math.exp(-e.deltaY * 0.0015);
    plan.cx = x - (px - plan.W / 2) / plan.s;
    plan.cy = y + (py - plan.H / 2) / plan.s;
    redraw();
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    const [px, py] = local(e);
    drag = { px, py, cx: plan.cx, cy: plan.cy, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (drawing) {
      hover = [wx(px), wy(py)];
      if (!drag) return redraw();
    }
    if (!drag) return;
    const dx = px - drag.px, dy = py - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      plan.cx = drag.cx - dx / plan.s;
      plan.cy = drag.cy + dy / plan.s;
      redraw();
    }
  });
  svg.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved) return;
    const [px, py] = local(e);
    if (drawing) {
      const pt = [wx(px), wy(py)];
      const last = drawing[drawing.length - 1];
      if (!last || Math.hypot(sx(last[0]) - px, sy(last[1]) - py) > 3) drawing.push(pt);
      redraw();
      return;
    }
    // select nearest pile within 10 px
    let best = null, bd = 100;
    auto().collars.forEach((p) => {
      const dd = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2;
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    });
    if (best) selectPile(best.id);
  });
  svg.addEventListener('dblclick', (e) => {
    if (!drawing) return;
    e.preventDefault();
    finishZone();
  });
  document.addEventListener('keydown', (e) => {
    if (!drawing) return;
    if (e.key === 'Escape') cancelZone();
    else if (e.key === 'Enter') finishZone();
    else if (e.key === 'Backspace' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      drawing.pop();
      redraw();
    }
  });
  $('#btn-draw-zone').addEventListener('click', () => {
    if (drawing) return finishZone();
    setMode('plan');
    drawing = [];
    $('#btn-draw-zone').textContent = '✔ Finish zone';
    $('#draw-hint').hidden = false;
    if (!auto().volumes.length && !auto().collars.length) fitView();
    $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    redraw();
  });
  function cancelZone() {
    drawing = null;
    hover = null;
    $('#btn-draw-zone').textContent = '✎ Draw zone on plan';
    $('#draw-hint').hidden = true;
    redraw();
  }
  function finishZone() {
    const pts = (drawing || []).filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 1e-6);
    if (pts.length >= 3) {
      const a = auto();
      const caseId = $('#zone-import-case').value || a.defaultCaseId;
      a.zones.push({ id: A.uid(), name: `Zone ${a.zones.length + 1}`, caseId, rings: [pts], source: 'drawn' });
      renderZones();
      changed({ noDraw: true });
      rebuild3D();
    }
    cancelZone();
  }

  // ---------------------------------------------------------------------------
  // 3D viewer (three.js)
  // ---------------------------------------------------------------------------
  const v3 = { ready: false };
  function init3D() {
    if (v3.ready) return true;
    if (!window.THREE || !THREE.OrbitControls) {
      alert('The 3D viewer library could not be loaded.');
      return false;
    }
    const host = $('#view3d');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      alert('WebGL is not available in this browser, so the 3D view cannot be shown.');
      return false;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1e6);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(0.4, 1, 0.6);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    Object.assign(v3, { ready: true, renderer, scene, camera, controls, group, host, raycaster: new THREE.Raycaster() });
    controls.addEventListener('change', render3D);
    new ResizeObserver(() => resize3D()).observe(host);
    // picking
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      v3.raycaster.setFromCamera(m, camera);
      const targets = [v3.piles, v3.collarsMesh].filter(Boolean);
      const hit = v3.raycaster.intersectObjects(targets, false)[0];
      if (hit && hit.instanceId != null) selectPile(hit.object.userData.ids[hit.instanceId]);
    });
    const bg = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff';
    renderer.setClearColor(new THREE.Color(bg));
    return true;
  }
  function resize3D() {
    if (!v3.ready) return;
    const w = v3.host.clientWidth || 800, h = v3.host.clientHeight || 540;
    v3.renderer.setSize(w, h, false);
    v3.camera.aspect = w / h;
    v3.camera.updateProjectionMatrix();
    render3D();
  }
  function render3D() {
    if (v3.ready) v3.renderer.render(v3.scene, v3.camera);
  }
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    while (g.children.length) g.remove(g.children[0]);
  }
  function origin() {
    const a = auto();
    const b = extents();
    let zmin = Infinity, zmax = -Infinity;
    a.volumes.forEach((v) => {
      zmin = Math.min(zmin, v.bbox[2]);
      zmax = Math.max(zmax, v.bbox[5]);
    });
    a.collars.forEach((p) => {
      zmin = Math.min(zmin, p.z);
      zmax = Math.max(zmax, p.z);
    });
    if (!isFinite(zmin)) zmin = zmax = 0;
    return { ox: (b[0] + b[2]) / 2, oy: (b[1] + b[3]) / 2, oz: (zmin + zmax) / 2, size: Math.max(b[2] - b[0], b[3] - b[1], zmax - zmin, 10), zmax };
  }
  let rebuildToken = 0;
  async function rebuild3D() {
    if (!v3.ready || view.mode !== '3d' || $('#tab-auto').hidden) return;
    const token = ++rebuildToken;
    const a = auto();
    const o = (v3.o = origin());
    const ve = Number($('#v3d-ve').value) || 1;
    const opacity = Number($('#v3d-opacity').value);
    const pileScale = Number($('#v3d-pile').value) || 1;
    const P = (x, y, z) => [x - o.ox, (z - o.oz) * ve, -(y - o.oy)];
    const meshes = [];
    if ($('#v3d-vol').checked) {
      for (const v of a.volumes) {
        if (v.visible === false) continue;
        const g = await getGeom(v.geomId);
        if (token !== rebuildToken) return;
        if (!g) continue;
        meshes.push({ data: g.data, color: v.material.color, opacity, name: v.name });
      }
    }
    let gwObj = null;
    if ($('#v3d-gw').checked && a.gw.mode === 'surface' && a.gw.geomId) {
      const g = await getGeom(a.gw.geomId);
      if (token !== rebuildToken) return;
      if (g) gwObj = { data: g.data, kind: a.gw.kind };
    }
    disposeGroup(v3.group);
    const toPos = (d) => {
      const pos = new Float32Array(d.length);
      for (let i = 0; i < d.length; i += 3) pos.set(P(d[i], d[i + 1], d[i + 2]), i);
      return pos;
    };
    meshes.forEach((m) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(toPos(m.data), 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(m.color), transparent: m.opacity < 0.99, opacity: m.opacity, side: THREE.DoubleSide, depthWrite: m.opacity >= 0.99, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      v3.group.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color: new THREE.Color(m.color).multiplyScalar(0.6), transparent: true, opacity: Math.min(1, m.opacity + 0.3) }));
      v3.group.add(edges);
    });
    if (gwObj) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(toPos(gwObj.data), 3));
      if (gwObj.kind === 'mesh') {
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x1f6fd1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        mesh.renderOrder = 2;
        v3.group.add(mesh);
      } else v3.group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x1f6fd1, size: Math.max(1, o.size / 150) })));
    }
    // piles
    const rm = resultMap();
    const col = colorFn();
    const cases = new Map(a.cases.map((c) => [c.id, c]));
    const designed = a.collars.filter((p) => rm.get(p.id) && rm.get(p.id).status === 'ok');
    if (designed.length) {
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
      const im = new THREE.InstancedMesh(cyl, new THREE.MeshLambertMaterial({ color: 0xffffff }), designed.length);
      const m4 = new THREE.Matrix4();
      designed.forEach((p, i) => {
        const r = rm.get(p.id);
        const D = r.D || (cases.get(r.caseId) || {}).D || 0.6;
        const rad = (D / 2) * pileScale;
        const len = r.length * ve;
        const top = P(p.x, p.y, p.z);
        m4.compose(new THREE.Vector3(top[0], top[1] - len / 2, top[2]), new THREE.Quaternion(), new THREE.Vector3(rad, len, rad));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, new THREE.Color(col(p)));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.userData.ids = designed.map((p) => p.id);
      im.renderOrder = 3;
      v3.group.add(im);
      v3.piles = im;
    } else v3.piles = null;
    // collar markers for every pile (shows undesigned piles too)
    if (a.collars.length) {
      const sph = new THREE.SphereGeometry(1, 12, 8);
      const cm = new THREE.InstancedMesh(sph, new THREE.MeshLambertMaterial({ color: 0xffffff }), a.collars.length);
      const m4 = new THREE.Matrix4();
      const rr = Math.max(0.35, o.size / 400) * Math.max(1, pileScale / 2);
      a.collars.forEach((p, i) => {
        const t = P(p.x, p.y, p.z);
        m4.compose(new THREE.Vector3(...t), new THREE.Quaternion(), new THREE.Vector3(rr, rr, rr));
        cm.setMatrixAt(i, m4);
        cm.setColorAt(i, new THREE.Color(col(p)));
      });
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
      cm.userData.ids = a.collars.map((p) => p.id);
      v3.group.add(cm);
      v3.collarsMesh = cm;
    } else v3.collarsMesh = null;
    // zones draped at the top of the model
    if ($('#v3d-zones').checked) {
      a.zones.forEach((z) => {
        const c = cases.get(z.caseId) || a.cases[0];
        z.rings.forEach((r) => {
          const pts = r.map((p) => new THREE.Vector3(...P(p[0], p[1], o.zmax + 0.5)));
          v3.group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(c.color) })));
        });
      });
    }
    // selection marker
    v3.sel = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff3366 }));
    v3.sel.rotation.x = Math.PI / 2;
    v3.sel.visible = false;
    v3.group.add(v3.sel);
    // bounding box
    const bb = new THREE.Box3().setFromObject(v3.group);
    if (!bb.isEmpty()) v3.group.add(new THREE.Box3Helper(bb, new THREE.Color(0x999999)));
    if (!v3.fitted) fit3D();
    highlight3D();
    resize3D();
  }
  function fit3D() {
    if (!v3.ready || !v3.o) return;
    const s = v3.o.size;
    const ve = Number($('#v3d-ve').value) || 1;
    v3.camera.near = s / 2000;
    v3.camera.far = s * 50;
    v3.camera.updateProjectionMatrix();
    v3.camera.position.set(s * 0.9, s * 0.7 * Math.max(1, ve / 2), s * 1.1);
    v3.controls.target.set(0, 0, 0);
    v3.controls.update();
    v3.fitted = true;
    render3D();
  }
  function highlight3D() {
    if (!v3.ready || !v3.sel || !v3.o) return;
    const p = selected && auto().collars.find((c) => c.id === selected);
    v3.sel.visible = !!p;
    if (p) {
      const ve = Number($('#v3d-ve').value) || 1;
      const s = Math.max(1, v3.o.size / 120);
      v3.sel.position.set(p.x - v3.o.ox, (p.z - v3.o.oz) * ve + 0.2, -(p.y - v3.o.oy));
      v3.sel.scale.set(s, s, s);
    }
    render3D();
  }
  $('#v3d-ve').addEventListener('input', (e) => {
    $('#v3d-ve-out').textContent = e.target.value + '×';
    rebuild3D();
  });
  $('#v3d-pile').addEventListener('input', (e) => {
    $('#v3d-pile-out').textContent = e.target.value + '×';
    rebuild3D();
  });
  ['#v3d-opacity', '#v3d-vol', '#v3d-gw', '#v3d-zones'].forEach((s) => $(s).addEventListener('change', rebuild3D));

  // ---------------------------------------------------------------------------
  // Export / import geometry with the project, lifecycle
  // ---------------------------------------------------------------------------
  async function collectGeometry(p) {
    const ids = new Set();
    if (p.auto) {
      p.auto.volumes.forEach((v) => ids.add(v.geomId));
      if (p.auto.gw && p.auto.gw.geomId) ids.add(p.auto.gw.geomId);
    }
    const out = {};
    for (const id of ids) {
      const g = await getGeom(id);
      if (g) out[id] = Array.from(g.data, (v) => Math.round(v * 1000) / 1000);
    }
    return Object.keys(out).length ? out : undefined;
  }
  async function storeGeometry(geom) {
    for (const [id, arr] of Object.entries(geom || {})) await putGeom(id, Float64Array.from(arr));
  }
  window.PileAuto = { collectGeometry, storeGeometry };

  function renderAll() {
    const a = auto();
    renderVolumes();
    renderGW();
    renderCases();
    renderZones();
    $('#collar-status').textContent = a.collars.length ? `${a.collars.length} piles${a.collarSource ? ' from ' + a.collarSource : ''}.` : 'No collars imported. Try samples/collars.csv.';
    $('#collar-map').hidden = !collarSource;
    $('#color-by').value = a.view.colorBy || 'status';
    renderStale();
    renderResults();
  }
  let shown = false;
  function onShow() {
    renderAll();
    if (!shown) {
      shown = true;
      setMode(auto().view.mode === '3d' ? '3d' : 'plan');
      fitView();
    } else if (view.mode === '3d') rebuild3D();
    else redraw();
  }
  document.addEventListener('pile:tab', (e) => e.detail === 'auto' && onShow());
  document.addEventListener('pile:project', () => {
    collarSource = null;
    selected = null;
    $('#pile-info').hidden = true;
    v3.fitted = false;
    if (!$('#tab-auto').hidden) {
      renderAll();
      fitView();
      rebuild3D();
    }
  });
  document.addEventListener('pile:projects-changed', gcGeometry);
  window.addEventListener('resize', () => view.mode === 'plan' && redraw());
  if (!$('#tab-auto').hidden) onShow();
})();
