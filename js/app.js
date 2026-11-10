/* UI for the pile design calculator. Depends on js/calc.js (global PileCalc). */
(function () {
  'use strict';
  const C = window.PileCalc;
  const STORAGE_KEY = 'pile-design-state-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const form = $('#inputs');

  const LAYER_FIELDS = {
    clay: ['su', 'E', 'nu', 'fsMax', 'qbMax'],
    sand: ['phi', 'E', 'nu', 'fsMax', 'qbMax'],
    rock: ['qu', 'E', 'nu', 'fsMax', 'qbMax'],
    user: ['fsUser', 'qbUser', 'E', 'nu', 'fsMax', 'qbMax'],
  };
  const LAYER_COLS = ['name', 'type', 'bottom', 'gamma', 'su', 'phi', 'qu', 'E', 'nu', 'fsUser', 'qbUser', 'fsMax', 'qbMax'];
  const TYPE_LABEL = { clay: 'Clay (undrained)', sand: 'Sand (drained)', rock: 'Rock', user: 'User-defined' };

  function example() {
    const ratings = {};
    C.RISK_FACTORS.forEach((f) => (ratings[f.id] = 3));
    ratings.investigation = 2;
    ratings.experience = 2;
    ratings.monitoring = 4;
    return {
      project: { name: 'Example building', job: 'J0001', ref: 'P1', designer: '' },
      pile: { type: 'bored', shape: 'circle', D: 0.6, Ep: 30000, wall: 0.012, head: 0.5, ignoreTop: 1.5, minLength: 3, minEmbed: 0.5, maxToe: '' },
      loads: { G: 1200, Q: 450, psiS: 0.7 },
      settlementLimit: 15,
      settlementMethod: 'max',
      gwl: 3,
      reduction: { ratings, redundancy: 'low', testing: { type: 'none', percent: 2, phiTf: 0.9 }, override: '' },
      method: methodDefaults('bored'),
      layers: [
        { name: 'Fill – clayey sand', type: 'sand', bottom: 1.5, gamma: 18, phi: 28, E: 10, nu: 0.3 },
        { name: 'Stiff silty clay', type: 'clay', bottom: 6, gamma: 19, su: 75, E: 30, nu: 0.3, fsMax: 100 },
        { name: 'Dense sand', type: 'sand', bottom: 11, gamma: 20, phi: 36, E: 60, nu: 0.3, fsMax: 120, qbMax: 5000 },
        { name: 'Class V shale / siltstone', type: 'rock', bottom: 20, gamma: 22, qu: 2, E: 300, nu: 0.25, fsMax: 400, qbMax: 6000 },
      ],
    };
  }

  function methodDefaults(type) {
    const t = C.PILE_TYPES[type];
    return { KK0: t.KK0, deltaPhi: t.deltaPhi, alphaMethod: t.alphaMethod, alpha: t.alpha, Nc: 9, rockShaftA: 0.45, Ms: 0.0015, Ke: 0.5 };
  }

  let state = load() || example();

  // ---------- persistence ----------
  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  // ---------- path helpers ----------
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  function setPath(o, p, v) {
    const ks = p.split('.');
    let cur = o;
    ks.slice(0, -1).forEach((k) => (cur = cur[k] = cur[k] || {}));
    cur[ks[ks.length - 1]] = v;
  }

  // ---------- build static controls ----------
  // Wrap label caption (text + <sub> etc.) in a span so the flex column layout keeps it on one line
  form.querySelectorAll('label').forEach((lab) => {
    const span = document.createElement('span');
    while (lab.firstChild && !(lab.firstChild.nodeType === 1 && /^(INPUT|SELECT)$/.test(lab.firstChild.tagName))) span.appendChild(lab.firstChild);
    lab.insertBefore(span, lab.firstChild);
  });
  const typeSel = $('#pile-type');
  Object.entries(C.PILE_TYPES).forEach(([k, t]) => typeSel.add(new Option(t.label, k)));

  function buildRiskTable() {
    const body = $('#risk-body');
    body.innerHTML = '';
    let group = '';
    C.RISK_FACTORS.forEach((f) => {
      if (f.group !== group) {
        group = f.group;
        body.insertAdjacentHTML('beforeend', `<tr class="grp"><td colspan="3">${group}</td></tr>`);
      }
      const opts = C.RISK_LEVELS.map((l, i) => `<option value="${i + 1}">${i + 1} – ${l}</option>`).join('');
      body.insertAdjacentHTML('beforeend', `<tr><td>${f.label}</td><td class="num">${f.w}</td><td><select name="reduction.ratings.${f.id}">${opts}</select></td></tr>`);
    });
  }
  buildRiskTable();

  function renderLayers() {
    const body = $('#layer-body');
    body.innerHTML = '';
    state.layers.forEach((l, i) => {
      const tr = document.createElement('tr');
      const active = LAYER_FIELDS[l.type] || [];
      tr.innerHTML = LAYER_COLS.map((c) => {
        if (c === 'type') {
          const o = Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}"${k === l.type ? ' selected' : ''}>${v}</option>`).join('');
          return `<td><select data-layer="${i}" data-field="type">${o}</select></td>`;
        }
        const isText = c === 'name';
        const dis = !isText && c !== 'bottom' && c !== 'gamma' && !active.includes(c) ? ' disabled' : '';
        const v = l[c] == null ? '' : l[c];
        return `<td><input data-layer="${i}" data-field="${c}" ${isText ? '' : 'type="number" step="any"'} value="${escapeHtml(String(v))}"${dis}></td>`;
      }).join('') + `<td><button type="button" class="icon" data-remove="${i}" title="Remove layer">✕</button></td>`;
      body.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function fillForm() {
    form.querySelectorAll('[name]').forEach((el) => {
      const v = getPath(state, el.name);
      el.value = v == null ? '' : v;
    });
    renderLayers();
    toggleVisibility();
  }

  function toggleVisibility() {
    form.querySelectorAll('[data-show]').forEach((el) => (el.style.display = el.dataset.show === state.pile.type ? '' : 'none'));
    const t = getPath(state, 'reduction.testing.type');
    form.querySelectorAll('[data-test]').forEach((el) => (el.style.display = t === 'none' ? 'none' : ''));
  }

  // ---------- events ----------
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  function onInput(e) {
    const el = e.target;
    if (el.dataset.layer != null) {
      const l = state.layers[Number(el.dataset.layer)];
      const f = el.dataset.field;
      l[f] = f === 'name' || f === 'type' ? el.value : el.value === '' ? '' : Number(el.value);
      if (f === 'type' && e.type === 'change') renderLayers();
    } else if (el.name) {
      const numeric = el.type === 'number' || /ratings\./.test(el.name);
      setPath(state, el.name, numeric ? (el.value === '' ? '' : Number(el.value)) : el.value);
      if (el.name === 'pile.type' && e.type === 'change') {
        state.method = methodDefaults(el.value);
        if (el.value === 'steelTube') state.pile.Ep = 200000;
        else if (Number(state.pile.Ep) >= 200000) state.pile.Ep = 30000;
        if (el.value === 'precast') state.pile.shape = 'square';
        fillForm();
      }
      toggleVisibility();
    }
    update();
  }

  $('#layer-body').addEventListener('click', (e) => {
    const i = e.target.dataset.remove;
    if (i == null) return;
    state.layers.splice(Number(i), 1);
    renderLayers();
    update();
  });
  $('#btn-add-layer').addEventListener('click', () => {
    const last = state.layers[state.layers.length - 1];
    state.layers.push({ name: 'New layer', type: 'clay', bottom: (last ? Number(last.bottom) : 0) + 5, gamma: 19, su: 100, E: 40, nu: 0.3 });
    renderLayers();
    update();
  });
  $('#btn-example').addEventListener('click', () => {
    if (!confirm('Replace current inputs with the example?')) return;
    state = example();
    fillForm();
    update();
  });
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pile-design-${(state.project.ref || 'pile').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!Array.isArray(s.layers) || !s.pile) throw new Error('Not a pile design file');
      state = { ...example(), ...s };
      fillForm();
      update();
    } catch (err) {
      alert('Could not import file: ' + err.message);
    }
    e.target.value = '';
  });
  $('#btn-print').addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', () => document.querySelectorAll('.results details').forEach((d) => (d.open = true)));

  // ---------- formatting ----------
  const f0 = (v) => (isFinite(v) ? Math.round(v).toLocaleString('en-AU') : '–');
  const f1 = (v) => (isFinite(v) ? v.toFixed(1) : '–');
  const f2 = (v) => (isFinite(v) ? v.toFixed(2) : '–');
  const pill = (ok, a = 'OK', b = 'FAIL') => `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? a : b}</span>`;

  // ---------- main update ----------
  function toInput() {
    const s = state;
    return {
      pile: s.pile,
      loads: s.loads,
      reduction: s.reduction,
      gwl: s.gwl === '' ? null : s.gwl,
      settlementLimit: s.settlementLimit,
      settlementMethod: s.settlementMethod,
      method: s.method,
      layers: s.layers,
    };
  }

  function update() {
    save();
    const res = C.design(toInput());
    const err = $('#error');
    if (res.error) {
      err.hidden = false;
      err.textContent = res.error;
      ['#kpis', '#warnings', '#chart-capacity', '#chart-settlement', '#detail', '#depth-table'].forEach((s) => ($(s).innerHTML = ''));
      return;
    }
    err.hidden = true;
    const { loads, phi } = res;
    $('#loads-summary').innerHTML = `E*<sub>d</sub> (ULS) = <b>${f0(loads.uls)} kN</b> (${loads.ulsCombo}) &nbsp;·&nbsp; Serviceability = <b>${f0(loads.sls)} kN</b> (${loads.slsCombo})`;
    $('#phi-summary').innerHTML =
      `ARR = <b>${f2(phi.arr)}</b> (${phi.category} risk) → φ<sub>gb</sub> = <b>${f2(phi.phiGb)}</b>` +
      (phi.K > 0 ? `; K = ${f2(phi.K)}, φ<sub>tf</sub> = ${f2(phi.phiTf)}` : '; K = 0') +
      ` → φ<sub>g</sub> = <b>${f2(phi.phiG)}</b>${phi.override ? ' (overridden)' : ''}`;
    renderKpis(res);
    $('#warnings').innerHTML = res.warnings.map((w) => `<div class="warn">⚠ ${escapeHtml(w)}</div>`).join('');
    renderCapacityChart(res);
    renderSettlementChart(res);
    renderDetail(res);
    renderDepthTable(res);
    renderPrintHead(res);
  }

  function renderKpis(res) {
    const d = res.detail;
    const k = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
    if (!d) {
      $('#kpis').innerHTML = k('Required pile length', 'Not found', 'within the soil profile', 'hero');
      return;
    }
    $('#kpis').innerHTML = [
      k('Required pile length', `${f2(res.requiredLength)} m`, `toe at ${f2(res.required)} m depth · ${d.governedBy}`, 'hero'),
      k('R<sub>d,ug</sub> ultimate', `${f0(d.Rdug)} kN`, `shaft ${f0(d.Rs)} + base ${f0(d.Rb)}`),
      k('R*<sub>d,g</sub> = φ<sub>g</sub>R<sub>d,ug</sub>', `${f0(d.Rdg)} kN`, `φ<sub>g</sub> = ${f2(res.phi.phiG)} · E*<sub>d</sub> = ${f0(res.loads.uls)} kN`),
      k('Utilisation E*<sub>d</sub>/R*<sub>d,g</sub>', f2(d.utilisation), pill(d.utilisation <= 1)),
      k('Settlement (SLS)', `${f1(d.settlement.governing)} mm`, `limit ${f1(res.settlementLimit)} mm ${pill(d.settlement.governing <= res.settlementLimit)}`),
    ].join('');
  }

  // ---------- SVG charts ----------
  function niceMax(v) {
    if (!(v > 0) || !isFinite(v)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function ticks(max, n = 5) {
    const step = niceMax(max / n);
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
    return out;
  }

  function renderCapacityChart(res) {
    const W = 640, H = 470, m = { l: 56, r: 30, t: 40, b: 20 };
    const rows = res.rows;
    const xMax = niceMax(Math.max(res.loads.uls * 1.15, ...rows.map((r) => r.Rdug)));
    const yMin = 0;
    const yMax = Math.ceil(res.profile[res.profile.length - 1].bottom);
    const x = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const y = (z) => m.t + ((z - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    const line = (key, color, dash = '') =>
      `<path d="${rows.map((r, i) => `${i ? 'L' : 'M'}${x(r[key]).toFixed(1)},${y(r.toe).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Capacity versus toe depth">`;
    // layer bands
    res.profile.forEach((l, i) => {
      svg += `<rect x="${m.l}" y="${y(l.top)}" width="${W - m.l - m.r}" height="${y(l.bottom) - y(l.top)}" fill="${i % 2 ? 'rgba(127,127,127,0.07)' : 'transparent'}"/>`;
      svg += `<text x="${W - m.r - 4}" y="${y(l.top) + 13}" text-anchor="end">${escapeHtml(l.name || l.type)}</text>`;
    });
    const gwl = state.gwl;
    if (gwl !== '' && gwl != null && gwl < yMax) svg += `<line x1="${m.l}" x2="${m.l + 40}" y1="${y(gwl)}" y2="${y(gwl)}" stroke="var(--c-rdug)" stroke-width="1.5"/><text x="${m.l + 44}" y="${y(gwl) + 4}">▽ GWL</text>`;
    svg += '<g class="grid">';
    ticks(xMax).forEach((t) => (svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${x(t)}" y="${m.t - 6}" text-anchor="middle">${f0(t)}</text>`));
    ticks(yMax, 8).forEach((t) => (svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`));
    svg += '</g>';
    svg += `<text x="${m.l - 42}" y="${(H) / 2}" transform="rotate(-90 ${m.l - 42} ${H / 2})" text-anchor="middle">Toe depth (m)</text>`;
    svg += line('Rs', 'var(--c-rs)') + line('Rb', 'var(--c-rb)') + line('Rdug', 'var(--c-rdug)') + line('Rdg', 'var(--c-rdg)');
    svg += `<line x1="${x(res.loads.uls)}" x2="${x(res.loads.uls)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--c-load)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    if (res.required !== null) {
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(res.required)}" y2="${y(res.required)}" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="3 3"/>`;
      svg += `<circle cx="${x(res.detail.Rdg)}" cy="${y(res.required)}" r="4.5" fill="var(--c-rdg)"/>`;
      svg += `<text x="${m.l + 4}" y="${y(res.required) - 5}" style="fill:var(--ink);font-weight:600">Required toe ${f2(res.required)} m</text>`;
    }
    svg += `<text x="${W / 2}" y="${12}" text-anchor="middle">Resistance (kN)</text>`;
    svg += '</svg>';
    const lg = (c, t, dash) => `<span><i style="background:${c}${dash ? ';background:repeating-linear-gradient(90deg,' + c + ' 0 5px,transparent 5px 8px)' : ''}"></i>${t}</span>`;
    $('#chart-capacity').innerHTML = svg + `<div class="legend">${lg('var(--c-rs)', 'Shaft R<sub>s</sub>')}${lg('var(--c-rb)', 'Base R<sub>b</sub>')}${lg('var(--c-rdug)', 'Ultimate R<sub>d,ug</sub>')}${lg('var(--c-rdg)', 'Design R*<sub>d,g</sub>')}${lg('var(--c-load)', 'E*<sub>d</sub>', true)}</div>`;
  }

  function renderSettlementChart(res) {
    const el = $('#chart-settlement');
    const d = res.detail;
    if (!d) {
      el.innerHTML = '<p class="hint">No design length found.</p>';
      return;
    }
    const W = 640, H = 350, m = { l: 56, r: 30, t: 40, b: 20 };
    const pts = d.curve.filter((p) => isFinite(p.fleming));
    const wCap = Math.max(res.settlementLimit * 2, d.settlement.governing * 2.5, 10);
    const yMax = niceMax(Math.min(wCap, Math.max(...pts.map((p) => p.fleming), ...pts.map((p) => p.rw))));
    const xMax = niceMax(d.Rdug);
    const x = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const y = (w) => m.t + (Math.min(w, yMax) / yMax) * (H - m.t - m.b);
    const path = (key, color, dash) => `<path d="${pts.filter((p) => p[key] <= yMax * 1.0001 || true).map((p, i) => `${i ? 'L' : 'M'}${x(p.P).toFixed(1)},${y(p[key]).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Load settlement curve"><g class="grid">`;
    ticks(xMax).forEach((t) => (svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${x(t)}" y="${m.t - 6}" text-anchor="middle">${f0(t)}</text>`));
    ticks(yMax, 6).forEach((t) => (svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${+t.toFixed(2)}</text>`));
    svg += '</g>';
    svg += `<text x="${W / 2}" y="12" text-anchor="middle">Pile head load (kN)</text>`;
    svg += `<text x="${m.l - 42}" y="${H / 2}" transform="rotate(-90 ${m.l - 42} ${H / 2})" text-anchor="middle">Settlement (mm)</text>`;
    svg += path('fleming', 'var(--c-rdug)') + path('rw', 'var(--c-rs)', '6 4');
    if (isFinite(res.settlementLimit) && res.settlementLimit <= yMax) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(res.settlementLimit)}" y2="${y(res.settlementLimit)}" stroke="var(--c-load)" stroke-dasharray="6 4"/><text x="${W - m.r - 4}" y="${y(res.settlementLimit) - 5}" text-anchor="end">limit ${res.settlementLimit} mm</text>`;
    svg += `<line x1="${x(res.loads.sls)}" x2="${x(res.loads.sls)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--c-rb)" stroke-width="1.5"/>`;
    svg += `<circle cx="${x(res.loads.sls)}" cy="${y(d.settlement.governing)}" r="4.5" fill="var(--c-rb)"/>`;
    svg += `<text x="${x(res.loads.sls) + 6}" y="${y(d.settlement.governing) + 16}" style="fill:var(--ink)">SLS ${f0(res.loads.sls)} kN → ${f1(d.settlement.governing)} mm</text>`;
    svg += '</svg>';
    el.innerHTML = svg + `<div class="legend"><span><i style="background:var(--c-rdug)"></i>Fleming (1992) non-linear</span><span><i style="background:var(--c-rs)"></i>Randolph &amp; Wroth (1978) elastic</span><span><i style="background:var(--c-rb)"></i>Serviceability load</span></div>`;
  }

  function renderDetail(res) {
    const d = res.detail;
    if (!d) {
      $('#detail').innerHTML = '<p class="hint">No design length found within the soil profile.</p>';
      return;
    }
    const g = res.geom;
    const rw = d.settlement.rwDetail;
    const shaftRows = d.shaftByLayer.map((s) => `<tr><td>${escapeHtml(s.name || s.type)}</td><td class="num">${f2(s.from)}–${f2(s.to)}</td><td class="num">${f1(s.fsMin)}${Math.abs(s.fsMax - s.fsMin) > 0.05 ? '–' + f1(s.fsMax) : ''}</td><td class="num">${f0(s.Rs)}</td></tr>`).join('');
    $('#detail').innerHTML = `
      <div class="detail-grid">
        <div>
          <h3>Geometry</h3>
          <table>
            <tr><td>Pile type</td><td>${C.PILE_TYPES[state.pile.type].label}</td></tr>
            <tr><td>Section</td><td>${state.pile.shape === 'square' ? 'Square' : 'Circular'} D = ${f2(g.D)} m</td></tr>
            <tr><td>Perimeter / base area</td><td>${f2(g.perimeter)} m / ${g.area.toFixed(3)} m²</td></tr>
            <tr><td>Head / toe depth</td><td>${f2(Number(state.pile.head) || 0)} m / ${f2(d.toe)} m</td></tr>
            <tr><td>Length L</td><td><b>${f2(d.length)} m</b></td></tr>
            <tr><td>Equivalent E<sub>p</sub></td><td>${f0(g.Ep / 1000)} MPa</td></tr>
          </table>
        </div>
        <div>
          <h3>Geotechnical strength (ULS)</h3>
          <table>
            <tr><td>Shaft R<sub>s</sub></td><td class="num">${f0(d.Rs)} kN</td></tr>
            <tr><td>Base R<sub>b</sub> = q<sub>b</sub>A<sub>b</sub></td><td class="num">${f0(d.qb)} × ${d.qb ? (d.Rb / d.qb).toFixed(3) : '–'} = ${f0(d.Rb)} kN</td></tr>
            <tr><td>Founding layer</td><td>${escapeHtml(d.baseLayer.name || d.baseLayer.type)} <span class="hint">(${escapeHtml(d.baseNote)})</span></td></tr>
            <tr><td>R<sub>d,ug</sub></td><td class="num">${f0(d.Rdug)} kN</td></tr>
            <tr><td>φ<sub>g</sub></td><td class="num">${f2(res.phi.phiG)}</td></tr>
            <tr><td>R*<sub>d,g</sub> = φ<sub>g</sub>R<sub>d,ug</sub></td><td class="num"><b>${f0(d.Rdg)} kN</b></td></tr>
            <tr><td>E*<sub>d</sub> (${res.loads.ulsCombo})</td><td class="num">${f0(res.loads.uls)} kN ${pill(d.Rdg >= res.loads.uls)}</td></tr>
          </table>
        </div>
        <div>
          <h3>Shaft resistance by layer</h3>
          <table>
            <thead><tr><th>Layer</th><th class="num">Depth (m)</th><th class="num">f<sub>s</sub> (kPa)</th><th class="num">R<sub>s</sub> (kN)</th></tr></thead>
            <tbody>${shaftRows || '<tr><td colspan="4">–</td></tr>'}</tbody>
          </table>
        </div>
        <div>
          <h3>Serviceability (SLS = ${f0(res.loads.sls)} kN)</h3>
          <table>
            <tr><td>Randolph &amp; Wroth</td><td class="num">${f1(d.settlement.rw)} mm</td></tr>
            <tr><td class="hint">G<sub>avg</sub>, G<sub>L</sub>, G<sub>b</sub> (MPa)</td><td class="num hint">${f1(rw.Gavg / 1000)}, ${f1(rw.GL / 1000)}, ${f1(rw.Gb / 1000)}</td></tr>
            <tr><td class="hint">λ = E<sub>p</sub>/G<sub>L</sub>, ζ, μL</td><td class="num hint">${f0(rw.lambda)}, ${f2(rw.zeta)}, ${f2(rw.muL)}</td></tr>
            <tr><td>Fleming</td><td class="num">${f1(d.settlement.fleming)} mm</td></tr>
            <tr><td>Adopted (${{ max: 'max', rw: 'R&amp;W', fleming: 'Fleming' }[res.settlementMethod]})</td><td class="num"><b>${f1(d.settlement.governing)} mm</b></td></tr>
            <tr><td>Limit</td><td class="num">${f1(res.settlementLimit)} mm ${pill(d.settlement.governing <= res.settlementLimit)}</td></tr>
          </table>
        </div>
      </div>
      <p class="hint">Length to satisfy ULS only: ${res.requiredULS !== null ? f2(res.requiredULS - (Number(state.pile.head) || 0)) + ' m' : 'not achieved'} · SLS only: ${res.requiredSLS !== null ? f2(res.requiredSLS - (Number(state.pile.head) || 0)) + ' m' : 'not achieved'} (minimum length ${f2(Number(state.pile.minLength) || 0)} m).</p>`;
  }

  function renderDepthTable(res) {
    const step = Math.max(1, Math.round(0.5 / 0.05));
    const rows = res.rows.filter((r, i) => i % step === 0 || r.toe === res.required);
    $('#depth-table').innerHTML = `<table>
      <thead><tr><th class="num">Toe (m)</th><th class="num">L (m)</th><th class="num">R<sub>s</sub></th><th class="num">R<sub>b</sub></th><th class="num">R<sub>d,ug</sub></th><th class="num">R*<sub>d,g</sub></th><th class="num">Settlement (mm)</th><th>ULS</th><th>SLS</th></tr></thead>
      <tbody>${rows.map((r) => `<tr${r.toe === res.required ? ' style="font-weight:650"' : ''}><td class="num">${f2(r.toe)}</td><td class="num">${f2(r.length)}</td><td class="num">${f0(r.Rs)}</td><td class="num">${f0(r.Rb)}</td><td class="num">${f0(r.Rdug)}</td><td class="num">${f0(r.Rdg)}</td><td class="num">${f1(r.settlement)}</td><td>${pill(r.okULS)}</td><td>${pill(r.okSLS)}</td></tr>`).join('')}</tbody>
    </table><p class="hint">Resistances in kN.</p>`;
  }

  function renderPrintHead(res) {
    const p = state.project || {};
    const layers = res.profile.map((l) => `<tr><td>${escapeHtml(l.name || '')}</td><td>${TYPE_LABEL[l.type]}</td><td class="num">${f2(l.top)}–${f2(l.bottom)}</td><td class="num">${l.gamma ?? ''}</td><td class="num">${l.type === 'clay' ? 'su ' + l.su + ' kPa' : l.type === 'sand' ? 'φ′ ' + l.phi + '°' : l.type === 'rock' ? 'qu ' + l.qu + ' MPa' : 'fs ' + (l.fsUser ?? '') + ', qb ' + (l.qbUser ?? '') + ' kPa'}</td><td class="num">${l.E ?? ''}</td></tr>`).join('');
    $('#print-head').innerHTML = `<div class="card">
      <h2>Pile design – AS 2159-2009</h2>
      <table><tr><td>Project: <b>${escapeHtml(p.name || '')}</b></td><td>Job: ${escapeHtml(p.job || '')}</td><td>Pile: ${escapeHtml(p.ref || '')}</td><td>Designer: ${escapeHtml(p.designer || '')}</td><td>Date: ${new Date().toLocaleDateString('en-AU')}</td></tr></table>
      <p>Loads: G = ${state.loads.G} kN, Q = ${state.loads.Q} kN → E*<sub>d</sub> = ${f0(res.loads.uls)} kN, SLS = ${f0(res.loads.sls)} kN. Groundwater ${state.gwl === '' ? 'not encountered' : 'at ' + state.gwl + ' m'}. ARR = ${f2(res.phi.arr)}, φ<sub>g</sub> = ${f2(res.phi.phiG)} (${state.reduction.redundancy} redundancy).</p>
      <table><thead><tr><th>Layer</th><th>Type</th><th class="num">Depth (m)</th><th class="num">γ</th><th class="num">Strength</th><th class="num">E (MPa)</th></tr></thead><tbody>${layers}</tbody></table>
    </div>`;
  }

  fillForm();
  update();
})();
