/* UI for the pile design calculator. Depends on js/calc.js (PileCalc) and js/content.js (PileContent). */
(function () {
  'use strict';
  const C = window.PileCalc;
  const K = window.PileContent;
  const STORE_KEY = 'pile-design-store-v2';
  const OLD_KEY = 'pile-design-state-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const form = $('#inputs');
  const projectForm = $('#project-form');

  const LAYER_FIELDS = {
    clay: ['su', 'E', 'nu', 'fsMax', 'qbMax'],
    sand: ['phi', 'E', 'nu', 'fsMax', 'qbMax'],
    rock: ['qu', 'E', 'nu', 'fsMax', 'qbMax'],
    user: ['fsUser', 'qbUser', 'E', 'nu', 'fsMax', 'qbMax'],
  };
  const LAYER_COLS = ['name', 'type', 'bottom', 'gamma', 'su', 'phi', 'qu', 'E', 'nu', 'fsUser', 'qbUser', 'fsMax', 'qbMax'];
  const TYPE_LABEL = { clay: 'Clay (undrained)', sand: 'Sand (drained)', rock: 'Rock', user: 'User-defined' };
  const PROJECT_FIELDS = ['name', 'job', 'client', 'location', 'designer', 'checker', 'revision', 'date', 'geoReport', 'notes'];

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  function methodDefaults(type) {
    const t = C.PILE_TYPES[type] || C.PILE_TYPES.bored;
    return { KK0: t.KK0, deltaPhi: t.deltaPhi, alphaMethod: t.alphaMethod, alpha: t.alpha, Nc: 9, rockShaftA: 0.45, Ms: 0.0015, Ke: 0.5 };
  }

  function withFill(l, pattern, color) {
    const d = K.TYPE_DEFAULT_FILL[l.type] || K.TYPE_DEFAULT_FILL.user;
    return { ...l, pattern: pattern || d.pattern, color: color || d.color };
  }

  function exampleCalc(name) {
    const ratings = {};
    C.RISK_FACTORS.forEach((f) => (ratings[f.id] = 3));
    ratings.investigation = 2;
    ratings.experience = 2;
    ratings.monitoring = 4;
    return {
      id: uid(),
      name: name || 'Pile P1',
      pile: { type: 'bored', shape: 'circle', D: 0.6, Ep: 30000, wall: 0.012, head: 0.5, ignoreTop: 1.5, minLength: 3, minEmbed: 0.5, maxToe: '' },
      loads: { G: 1200, Q: 450, psiS: 0.7 },
      settlementLimit: 15,
      settlementMethod: 'max',
      gwl: 3,
      reduction: { ratings, redundancy: 'low', testing: { type: 'none', percent: 2, phiTf: 0.9 }, override: '' },
      method: methodDefaults('bored'),
      layers: [
        withFill({ name: 'Fill – clayey sand', type: 'sand', bottom: 1.5, gamma: 18, phi: 28, E: 10, nu: 0.3 }, 'crosshatch', '#c9b8a0'),
        withFill({ name: 'Stiff silty clay', type: 'clay', bottom: 6, gamma: 19, su: 75, E: 30, nu: 0.3, fsMax: 100 }),
        withFill({ name: 'Dense sand', type: 'sand', bottom: 11, gamma: 20, phi: 36, E: 60, nu: 0.3, fsMax: 120, qbMax: 5000 }),
        withFill({ name: 'Class V shale / siltstone', type: 'rock', bottom: 20, gamma: 22, qu: 2, E: 300, nu: 0.25, fsMax: 400, qbMax: 6000 }),
      ],
    };
  }

  function newProject(name, calcs) {
    const c = calcs || [exampleCalc()];
    return {
      id: uid(),
      details: { name: name || 'New project', job: '', client: '', location: '', designer: '', checker: '', revision: 'A', date: new Date().toISOString().slice(0, 10), geoReport: '', notes: '' },
      calcs: c,
      activeCalcId: c[0].id,
    };
  }

  /** Make sure every calc sheet has all fields (older files / imports). */
  function normaliseCalc(c) {
    const base = exampleCalc(c.name);
    const out = { ...base, ...c, id: c.id || uid() };
    out.pile = { ...base.pile, ...(c.pile || {}) };
    out.loads = { ...base.loads, ...(c.loads || {}) };
    out.reduction = { ...base.reduction, ...(c.reduction || {}) };
    out.reduction.testing = { ...base.reduction.testing, ...((c.reduction || {}).testing || {}) };
    out.reduction.ratings = { ...base.reduction.ratings, ...((c.reduction || {}).ratings || {}) };
    out.method = { ...methodDefaults(out.pile.type), ...(c.method || {}) };
    out.layers = (c.layers || base.layers).map((l) => withFill(l, l.pattern, l.color));
    return out;
  }
  function normaliseProject(p) {
    const calcs = (p.calcs && p.calcs.length ? p.calcs : [exampleCalc()]).map(normaliseCalc);
    const proj = { ...newProject('', calcs), ...p, calcs };
    proj.id = p.id || uid();
    proj.details = { ...newProject().details, ...(p.details || {}) };
    if (!calcs.some((c) => c.id === proj.activeCalcId)) proj.activeCalcId = calcs[0].id;
    return proj;
  }

  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------
  function loadStore() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) {
        const st = JSON.parse(s);
        if (Array.isArray(st.projects) && st.projects.length) {
          st.projects = st.projects.map(normaliseProject);
          if (!st.projects.some((p) => p.id === st.activeProjectId)) st.activeProjectId = st.projects[0].id;
          st.ui = st.ui || {};
          return st;
        }
      }
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        // migrate single-sheet v1 state
        const o = JSON.parse(old);
        const proj = normaliseProject(newProject((o.project && o.project.name) || 'Migrated project', [normaliseCalc({ ...o, name: (o.project && o.project.ref) || 'Pile P1' })]));
        if (o.project) Object.assign(proj.details, { job: o.project.job || '', designer: o.project.designer || '' });
        return { activeProjectId: proj.id, projects: [proj], ui: {} };
      }
    } catch (e) { /* fall through */ }
    const p = newProject('Example project');
    p.details.job = 'J0001';
    p.details.location = 'Example site';
    return { activeProjectId: p.id, projects: [p], ui: {} };
  }
  let store = loadStore();
  let saveTimer = null;
  window.addEventListener('pagehide', () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* ignore */ }
  });
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (e) { /* ignore */ }
    }, 150);
  }

  const project = () => store.projects.find((p) => p.id === store.activeProjectId);
  const calc = () => {
    const p = project();
    return p.calcs.find((c) => c.id === p.activeCalcId) || p.calcs[0];
  };
  let state = calc();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  function setPath(o, p, v) {
    const ks = p.split('.');
    let cur = o;
    ks.slice(0, -1).forEach((k) => (cur = cur[k] = cur[k] || {}));
    cur[ks[ks.length - 1]] = v;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const f0 = (v) => (isFinite(v) ? Math.round(v).toLocaleString('en-AU') : '–');
  const f1 = (v) => (isFinite(v) ? v.toFixed(1) : '–');
  const f2 = (v) => (isFinite(v) ? v.toFixed(2) : '–');
  const pill = (ok, a = 'OK', b = 'FAIL') => `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? a : b}</span>`;

  function toInput(s) {
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

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function showTab(tab) {
    store.ui.tab = tab;
    $$('.main-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + tab));
    if (tab === 'project') renderSheetSummary();
    if (tab === 'calc') update();
    save();
    document.dispatchEvent(new CustomEvent('pile:tab', { detail: tab }));
  }
  function showSubtab(sub) {
    store.ui.subtab = sub;
    $$('.sub-tabs [data-subtab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.subtab === sub));
    $$('.sub-panel').forEach((p) => (p.hidden = p.id !== 'sub-' + sub));
    save();
  }
  $$('.main-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.sub-tabs [data-subtab]').forEach((b) => b.addEventListener('click', () => showSubtab(b.dataset.subtab)));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto],[data-goto-tab]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.gotoTab) showTab(a.dataset.gotoTab);
    else {
      showTab('info');
      showSubtab(a.dataset.goto);
    }
    window.scrollTo(0, 0);
  });

  // ---------------------------------------------------------------------------
  // Project switcher and menu
  // ---------------------------------------------------------------------------
  const projectSelect = $('#project-select');
  function renderProjectSelect() {
    projectSelect.innerHTML = '';
    store.projects.forEach((p) => {
      const label = (p.details.name || 'Untitled project') + (p.details.job ? ` (${p.details.job})` : '');
      projectSelect.add(new Option(label, p.id, false, p.id === store.activeProjectId));
    });
  }
  function switchProject(id) {
    store.activeProjectId = id;
    state = calc();
    renderProjectSelect();
    fillProjectForm();
    renderSheetTabs();
    fillForm();
    renderSheetSummary();
    update();
    document.dispatchEvent(new CustomEvent('pile:project'));
  }
  projectSelect.addEventListener('change', () => switchProject(projectSelect.value));

  const menuBtn = $('#btn-project-menu');
  const menu = $('#project-menu');
  const closeMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.menu')) closeMenu();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  menu.addEventListener('click', (e) => {
    const act = e.target.dataset.action;
    if (!act) return;
    closeMenu();
    const p = project();
    if (act === 'new-project') {
      const name = prompt('New project name', 'New project');
      if (name === null) return;
      const np = newProject(name || 'New project');
      store.projects.push(np);
      switchProject(np.id);
      showTab('project');
    } else if (act === 'duplicate-project') {
      const np = clone(p);
      np.id = uid();
      np.details.name = (p.details.name || 'Project') + ' (copy)';
      np.calcs.forEach((c) => (c.id = uid()));
      np.activeCalcId = np.calcs[0].id;
      store.projects.push(np);
      switchProject(np.id);
    } else if (act === 'delete-project') {
      if (!confirm(`Delete project "${p.details.name}" and all ${p.calcs.length} calculation sheet(s)? This cannot be undone. Export it first if you need a copy.`)) return;
      store.projects = store.projects.filter((x) => x.id !== p.id);
      if (!store.projects.length) store.projects.push(newProject('New project'));
      switchProject(store.projects[0].id);
      document.dispatchEvent(new CustomEvent('pile:projects-changed'));
    } else if (act === 'export-project') {
      (async () => {
        const geometry = window.PileAuto ? await window.PileAuto.collectGeometry(p) : undefined;
        const blob = new Blob([JSON.stringify({ app: 'pile-design', version: K.VERSION, project: p, geometry })], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(p.details.name || 'project').replace(/[^\w-]+/g, '_')}.pile.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      })();
    } else if (act === 'print') {
      window.print();
    }
    save();
  });
  $('#file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    closeMenu();
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      let proj;
      if (data.project && Array.isArray(data.project.calcs)) proj = normaliseProject(data.project);
      else if (data.pile && Array.isArray(data.layers)) proj = normaliseProject(newProject((data.project && data.project.name) || f.name.replace(/\.json$/, ''), [normaliseCalc({ ...data, name: (data.project && data.project.ref) || 'Pile P1' })]));
      else throw new Error('Not a pile design file');
      proj.id = uid();
      proj.calcs.forEach((c) => (c.id = uid()));
      proj.activeCalcId = proj.calcs[0].id;
      if (data.geometry && window.PileAuto) await window.PileAuto.storeGeometry(data.geometry);
      store.projects.push(proj);
      switchProject(proj.id);
      save();
    } catch (err) {
      alert('Could not import file: ' + err.message);
    }
    e.target.value = '';
  });

  // ---------------------------------------------------------------------------
  // Project details
  // ---------------------------------------------------------------------------
  function fillProjectForm() {
    const d = project().details;
    PROJECT_FIELDS.forEach((k) => {
      const el = projectForm.elements[k];
      if (el) el.value = d[k] == null ? '' : d[k];
    });
  }
  projectForm.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.name) return;
    project().details[el.name] = el.value;
    if (el.name === 'name' || el.name === 'job') renderProjectSelect();
    save();
  });

  function renderSheetSummary() {
    const p = project();
    const rows = p.calcs.map((c) => {
      const r = C.design(toInput(c));
      const ok = !r.error && r.required !== null;
      const d = r.detail;
      return `<tr data-open-sheet="${c.id}" class="clickable">
        <td><a href="#" data-open-sheet="${c.id}">${escapeHtml(c.name)}</a></td>
        <td>${escapeHtml(C.PILE_TYPES[c.pile.type] ? C.PILE_TYPES[c.pile.type].label : '')}</td>
        <td class="num">${f2(Number(c.pile.D))}</td>
        <td class="num">${r.error ? '–' : f0(r.loads.uls)}</td>
        <td class="num">${r.error ? '–' : f0(r.loads.sls)}</td>
        <td class="num"><b>${ok ? f2(r.requiredLength) : '–'}</b></td>
        <td class="num">${ok ? f2(r.required) : '–'}</td>
        <td class="num">${d ? f0(d.Rdg) : '–'}</td>
        <td class="num">${d ? f1(d.settlement.governing) : '–'}</td>
        <td>${r.error ? `<span class="pill bad">Error</span>` : pill(ok, 'OK', 'No solution')}</td>
      </tr>`;
    }).join('');
    $('#sheet-summary').innerHTML = `<table class="data">
      <thead><tr><th>Sheet</th><th>Pile type</th><th class="num">D (m)</th><th class="num">E*<sub>d</sub> (kN)</th><th class="num">SLS (kN)</th><th class="num">Length (m)</th><th class="num">Toe (m)</th><th class="num">R*<sub>d,g</sub> (kN)</th><th class="num">Settl. (mm)</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  $('#sheet-summary').addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-sheet]');
    if (!t) return;
    e.preventDefault();
    openSheet(t.dataset.openSheet);
    showTab('calc');
  });

  // ---------------------------------------------------------------------------
  // Calculation sheets (sub-tabs)
  // ---------------------------------------------------------------------------
  function renderSheetTabs() {
    const p = project();
    $('#sheet-tabs').innerHTML = p.calcs
      .map((c) => `<button type="button" role="tab" data-sheet="${c.id}" aria-selected="${c.id === p.activeCalcId}" title="Double-click to rename">${escapeHtml(c.name)}</button>`)
      .join('');
  }
  function openSheet(id) {
    project().activeCalcId = id;
    state = calc();
    renderSheetTabs();
    fillForm();
    update();
  }
  $('#sheet-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sheet]');
    if (b) openSheet(b.dataset.sheet);
  });
  $('#sheet-tabs').addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-sheet]')) renameSheet();
  });
  function nextSheetName() {
    const n = project().calcs.length + 1;
    return `Pile P${n}`;
  }
  function newSheet() {
    const name = prompt('Name of the new calculation sheet', nextSheetName());
    if (name === null) return;
    // New sheet starts from the current sheet's ground profile and risk ratings, with default pile and loads
    const c = exampleCalc(name || nextSheetName());
    c.layers = clone(state.layers);
    c.gwl = state.gwl;
    c.reduction = clone(state.reduction);
    project().calcs.push(c);
    openSheet(c.id);
    save();
  }
  function renameSheet() {
    const name = prompt('Rename calculation sheet', state.name);
    if (!name) return;
    state.name = name;
    renderSheetTabs();
    save();
  }
  $('#btn-new-sheet').addEventListener('click', newSheet);
  $('#btn-new-sheet-2').addEventListener('click', () => {
    showTab('calc');
    newSheet();
  });
  $('#btn-dup-sheet').addEventListener('click', () => {
    const c = clone(state);
    c.id = uid();
    c.name = state.name + ' (copy)';
    const p = project();
    p.calcs.splice(p.calcs.indexOf(state) + 1, 0, c);
    openSheet(c.id);
    save();
  });
  $('#btn-rename-sheet').addEventListener('click', renameSheet);
  $('#btn-delete-sheet').addEventListener('click', () => {
    const p = project();
    if (p.calcs.length <= 1) {
      alert('A project needs at least one calculation sheet.');
      return;
    }
    if (!confirm(`Delete calculation sheet "${state.name}"?`)) return;
    const i = p.calcs.indexOf(state);
    p.calcs.splice(i, 1);
    openSheet(p.calcs[Math.max(0, i - 1)].id);
    save();
  });

  // ---------------------------------------------------------------------------
  // Calculation sheet form
  // ---------------------------------------------------------------------------
  const typeSel = $('#pile-type');
  Object.entries(C.PILE_TYPES).forEach(([k, t]) => typeSel.add(new Option(t.label, k)));

  // Wrap label captions (text + <sub>) in a span so the flex column layout keeps them on one line
  $$('label', document).forEach((lab) => {
    if (lab.classList.contains('menu-btn')) return;
    const span = document.createElement('span');
    while (lab.firstChild && !(lab.firstChild.nodeType === 1 && /^(INPUT|SELECT|TEXTAREA)$/.test(lab.firstChild.tagName))) span.appendChild(lab.firstChild);
    lab.insertBefore(span, lab.firstChild);
  });

  (function buildRiskTable() {
    const body = $('#risk-body');
    let group = '';
    C.RISK_FACTORS.forEach((f) => {
      if (f.group !== group) {
        group = f.group;
        body.insertAdjacentHTML('beforeend', `<tr class="grp"><td colspan="3">${group}</td></tr>`);
      }
      const opts = C.RISK_LEVELS.map((l, i) => `<option value="${i + 1}">${i + 1} – ${l}</option>`).join('');
      body.insertAdjacentHTML('beforeend', `<tr><td>${f.label}</td><td class="num">${f.w}</td><td><select name="reduction.ratings.${f.id}">${opts}</select></td></tr>`);
    });
  })();

  const patternOptions = (sel) => Object.entries(K.PATTERNS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');

  function renderLayers() {
    const body = $('#layer-body');
    body.innerHTML = '';
    state.layers.forEach((l, i) => {
      const tr = document.createElement('tr');
      const active = LAYER_FIELDS[l.type] || [];
      const fill = `<td class="fill-cell"><div class="fill-ctl"><span class="sw" data-swatch="${i}">${K.swatch(l.pattern, l.color)}</span>
        <select data-layer="${i}" data-field="pattern" aria-label="Fill pattern">${patternOptions(l.pattern)}</select>
        <input type="color" data-layer="${i}" data-field="color" value="${escapeHtml(l.color || '#cccccc')}" aria-label="Fill colour"></div></td>`;
      tr.innerHTML = fill + LAYER_COLS.map((c) => {
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

  function fillForm() {
    $$('[name]', form).forEach((el) => {
      const v = getPath(state, el.name);
      el.value = v == null ? '' : v;
    });
    renderLayers();
    toggleVisibility();
  }

  function toggleVisibility() {
    $$('[data-show]', form).forEach((el) => (el.style.display = el.dataset.show === state.pile.type ? '' : 'none'));
    const t = getPath(state, 'reduction.testing.type');
    $$('[data-test]', form).forEach((el) => (el.style.display = t === 'none' ? 'none' : ''));
  }

  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  function onInput(e) {
    const el = e.target;
    if (el.dataset.layer != null) {
      const i = Number(el.dataset.layer);
      const l = state.layers[i];
      const f = el.dataset.field;
      l[f] = ['name', 'type', 'pattern', 'color'].includes(f) ? el.value : el.value === '' ? '' : Number(el.value);
      if (f === 'pattern' || f === 'color') {
        l.fillCustom = true;
        $(`[data-swatch="${i}"]`).innerHTML = K.swatch(l.pattern, l.color);
      }
      if (f === 'type' && e.type === 'change') {
        if (!l.fillCustom) Object.assign(l, withFill({ type: l.type }));
        renderLayers();
      }
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
    state.layers.push(withFill({ name: 'New layer', type: 'clay', bottom: (last ? Number(last.bottom) : 0) + 5, gamma: 19, su: 100, E: 40, nu: 0.3 }));
    renderLayers();
    update();
  });
  $('#btn-method-defaults').addEventListener('click', () => {
    state.method = methodDefaults(state.pile.type);
    fillForm();
    update();
  });
  window.addEventListener('beforeprint', () => $$('.results details').forEach((d) => (d.open = true)));

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  function update() {
    save();
    const res = C.design(toInput(state));
    const err = $('#error');
    if (res.error) {
      err.hidden = false;
      err.textContent = res.error;
      ['#kpis', '#warnings', '#chart-profile', '#chart-settlement', '#detail', '#depth-table'].forEach((s) => ($(s).innerHTML = ''));
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
    renderProfileChart(res);
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

  function niceMax(v) {
    if (!(v > 0) || !isFinite(v)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function ticks(max, n = 5) {
    const step = niceMax(max / n);
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  const kfmt = (v) => (v >= 1000 ? (v / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1 }) + 'k' : String(Math.round(v)));

  /** Pile and ground profile with unit shaft, unit base and capacity plots against depth. */
  function renderProfileChart(res) {
    const W = 980, H = 600, top = 62, bot = 16;
    const zMax = Math.ceil(res.profile[res.profile.length - 1].bottom);
    const Y = (z) => top + (z / zMax) * (H - top - bot);
    const panels = {
      soil: [52, 300],
      fs: [330, 515],
      qb: [545, 730],
      cap: [760, 965],
    };
    const d = res.detail;
    const toe = res.required !== null ? res.required : null;
    const head = res.head;
    const shaftStart = res.shaftStart;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pile and ground profile with resistance plots against depth" style="color:var(--ink)">`;
    s += '<defs>' + res.profile.map((l, i) => K.patternDef('lp' + i, l.pattern || 'none', l.color || '#ccc')).join('');
    s += `<pattern id="lp-ignore" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e6e6e6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9a9a9a" stroke-width="2"/></pattern>`;
    s += `<marker id="pah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--c-load)"/></marker></defs>`;

    // depth grid and axis
    const dt = ticks(zMax, 10);
    s += '<g class="grid">';
    Object.values(panels).forEach(([a, b]) => dt.forEach((t) => (s += `<line x1="${a}" x2="${b}" y1="${Y(t)}" y2="${Y(t)}"/>`)));
    s += '</g>';
    dt.forEach((t) => (s += `<text x="${panels.soil[0] - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`));
    s += `<text x="14" y="${(top + H) / 2}" transform="rotate(-90 14 ${(top + H) / 2})" text-anchor="middle" class="axis-title">Depth below ground (m)</text>`;

    // ---- soil column
    const [sx0, sx1] = panels.soil;
    res.profile.forEach((l, i) => {
      s += `<rect x="${sx0}" y="${Y(l.top)}" width="${sx1 - sx0}" height="${Y(l.bottom) - Y(l.top)}" fill="url(#lp${i})" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
    });
    res.profile.forEach((l) => {
      const h = Y(l.bottom) - Y(l.top);
      if (h > 14) s += `<text x="${sx1 - 6}" y="${Y(l.top) + 14}" text-anchor="end" class="halo">${escapeHtml(l.name || TYPE_LABEL[l.type])}</text>`;
    });
    s += `<line x1="${sx0}" x2="${sx1}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink)" stroke-width="2.5"/>`;
    for (let x = sx0 + 4; x < sx1; x += 12) s += `<line x1="${x}" y1="${Y(0)}" x2="${x - 5}" y2="${Y(0) - 5}" stroke="var(--ink)" stroke-width="1"/>`;
    // groundwater
    const gwl = state.gwl;
    if (gwl !== '' && gwl != null && Number(gwl) < zMax) {
      const yw = Y(Number(gwl));
      s += `<line x1="${sx0}" x2="${sx1}" y1="${yw}" y2="${yw}" stroke="#1f6fd1" stroke-width="1.6" stroke-dasharray="7 3"/>`;
      s += `<path d="M${sx0 + 10} ${yw - 9} h12 l-6 8 z" fill="#1f6fd1"/><text x="${sx0 + 26}" y="${yw - 3}" class="halo" style="fill:#1f6fd1">GWL ${f1(Number(gwl))} m</text>`;
    }
    // pile
    const px = sx0 + (sx1 - sx0) * 0.38;
    const pw = Math.max(14, Math.min(46, res.geom.D * 34));
    const pToe = toe !== null ? toe : zMax;
    s += `<rect x="${px - pw / 2}" y="${Y(head)}" width="${pw}" height="${Y(pToe) - Y(head)}" fill="#cfd2d6" stroke="#3b3f45" stroke-width="1.5"/>`;
    if (shaftStart > head) s += `<rect x="${px - pw / 2}" y="${Y(head)}" width="${pw}" height="${Y(Math.min(shaftStart, pToe)) - Y(head)}" fill="url(#lp-ignore)" stroke="#3b3f45" stroke-width="1.5"/>`;
    s += `<rect x="${px - pw / 2 - 10}" y="${Y(head) - 8}" width="${pw + 20}" height="8" fill="#9aa0a8" stroke="#3b3f45"/>`;
    s += `<line x1="${px}" x2="${px}" y1="${top - 24}" y2="${Y(head) - 10}" stroke="var(--c-load)" stroke-width="3" marker-end="url(#pah)"/>`;
    s += `<text x="${px + 8}" y="${top - 10}" class="halo" style="fill:var(--c-load);font-weight:600">E*<tspan baseline-shift="sub" font-size="8">d</tspan> = ${f0(res.loads.uls)} kN</text>`;
    if (shaftStart > head) s += `<text x="${px + pw / 2 + 6}" y="${(Y(head) + Y(Math.min(shaftStart, pToe))) / 2 + 4}" class="halo" style="font-size:10px">no shaft friction</text>`;
    if (toe !== null) {
      s += `<text x="${px + pw / 2 + 6}" y="${Y(toe) + 14}" class="halo" style="font-weight:600;fill:var(--ink)">Toe ${f2(toe)} m · L = ${f2(res.requiredLength)} m</text>`;
    } else {
      s += `<text x="${px + pw / 2 + 6}" y="${Y(zMax) - 6}" class="halo" style="fill:var(--c-load);font-weight:600">No solution in profile</text>`;
    }
    s += `<text x="${(sx0 + sx1) / 2}" y="14" text-anchor="middle" class="panel-title">Pile &amp; ground profile</text>`;
    s += `<text x="${(sx0 + sx1) / 2}" y="28" text-anchor="middle">${escapeHtml(C.PILE_TYPES[state.pile.type].label)}, D = ${f2(res.geom.D)} m</text>`;

    // ---- helper for x-panels
    const up = res.unitProfile;
    const panel = (key, title, unit, xMax, body) => {
      const [a, b] = panels[key];
      const X = (v) => a + (Math.min(v, xMax) / xMax) * (b - a);
      let g = `<rect x="${a}" y="${top}" width="${b - a}" height="${H - top - bot}" fill="none" stroke="var(--line)"/>`;
      g += '<g class="grid">';
      ticks(xMax, 3).forEach((t) => (g += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - bot}"/><text x="${X(t)}" y="${top - 6}" text-anchor="middle">${kfmt(t)}</text>`));
      g += '</g>';
      g += `<text x="${(a + b) / 2}" y="14" text-anchor="middle" class="panel-title">${title}</text><text x="${(a + b) / 2}" y="28" text-anchor="middle">${unit}</text>`;
      // layer boundaries
      res.profile.forEach((l) => l.top > 0 && (g += `<line x1="${a}" x2="${b}" y1="${Y(l.top)}" y2="${Y(l.top)}" stroke="var(--muted)" stroke-opacity="0.35"/>`));
      return g + body(X);
    };
    const pathOf = (pts, X) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`).join('');

    // ---- unit shaft resistance
    const fsMax = niceMax(Math.max(10, ...up.map((p) => p.fs)) * 1.05);
    s += panel('fs', 'Unit shaft resistance f<tspan baseline-shift="sub" font-size="8">s</tspan>', 'kPa (ultimate)', fsMax, (X) => {
      const all = up.map((p) => ({ x: p.fs, z: p.z }));
      let g = `<path d="${pathOf(all, X)}" fill="none" stroke="var(--c-rs)" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      const zEnd = toe !== null ? toe : zMax;
      const shaft = up.filter((p) => p.z >= shaftStart && p.z <= zEnd).map((p) => ({ x: p.fs, z: p.z }));
      if (shaft.length) {
        const poly = `M${X(0)},${Y(shaft[0].z)} ` + shaft.map((p) => `L${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ') + ` L${X(0)},${Y(shaft[shaft.length - 1].z)} Z`;
        g += `<path d="${poly}" fill="var(--c-rs)" fill-opacity="0.22" stroke="none"/><path d="${pathOf(shaft, X)}" fill="none" stroke="var(--c-rs)" stroke-width="2.2"/>`;
      }
      if (d) g += `<text x="${X(fsMax) - 4}" y="${H - bot - 8}" text-anchor="end" class="halo" style="fill:var(--c-rs);font-weight:600">R<tspan baseline-shift="sub" font-size="8">s</tspan> = ${f0(d.Rs)} kN</text>`;
      return g;
    });

    // ---- unit base resistance
    const qbMax = niceMax(Math.max(10, ...up.map((p) => p.qb)) * 1.05);
    s += panel('qb', 'Unit base resistance q<tspan baseline-shift="sub" font-size="8">b</tspan>', 'kPa (ultimate)', qbMax, (X) => {
      const all = up.filter((p) => p.z > 0).map((p) => ({ x: p.qb, z: p.z }));
      let g = `<path d="${pathOf(all, X)}" fill="none" stroke="var(--c-rb)" stroke-width="2.2"/>`;
      if (d) {
        g += `<circle cx="${X(d.qb)}" cy="${Y(toe)}" r="5" fill="var(--c-rb)" stroke="var(--card)" stroke-width="1.5"/>`;
        g += `<text x="${X(qbMax) - 4}" y="${H - bot - 8}" text-anchor="end" class="halo" style="fill:var(--c-rb);font-weight:600">R<tspan baseline-shift="sub" font-size="8">b</tspan> = ${f0(d.Rb)} kN</text>`;
      }
      return g;
    });

    // ---- capacity vs toe depth
    const rows = res.rows;
    const capMax = niceMax(Math.max(res.loads.uls * 1.15, ...rows.map((r) => r.Rdug)));
    s += panel('cap', 'Capacity vs toe depth', 'kN', capMax, (X) => {
      const ln = (key, color, w = 2) => `<path d="${rows.map((r, i) => `${i ? 'L' : 'M'}${X(r[key]).toFixed(1)},${Y(r.toe).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
      let g = ln('Rs', 'var(--c-rs)', 1.5) + ln('Rb', 'var(--c-rb)', 1.5) + ln('Rdug', 'var(--c-rdug)') + ln('Rdg', 'var(--c-rdg)', 2.5);
      g += `<line x1="${X(res.loads.uls)}" x2="${X(res.loads.uls)}" y1="${top}" y2="${H - bot}" stroke="var(--c-load)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
      g += `<text x="${X(res.loads.uls) + 4}" y="${top + 14}" class="halo" style="fill:var(--c-load)">E*<tspan baseline-shift="sub" font-size="8">d</tspan></text>`;
      if (d) g += `<circle cx="${X(d.Rdg)}" cy="${Y(toe)}" r="5" fill="var(--c-rdg)" stroke="var(--card)" stroke-width="1.5"/>`;
      return g;
    });

    // toe line across all panels
    if (toe !== null) s += `<line x1="${panels.soil[0]}" x2="${panels.cap[1]}" y1="${Y(toe)}" y2="${Y(toe)}" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    s += '</svg>';

    const lg = (c, t, dash) => `<span><i style="background:${dash ? `repeating-linear-gradient(90deg,${c} 0 5px,transparent 5px 8px)` : c}"></i>${t}</span>`;
    const layerLegend = res.profile.map((l) => `<span class="lg-layer">${K.swatch(l.pattern, l.color, 22, 14)}${escapeHtml(l.name || TYPE_LABEL[l.type])}</span>`).join('');
    $('#chart-profile').innerHTML = `<div class="chart-scroll">${s}</div>
      <div class="legend">${lg('var(--c-rs)', 'Shaft f<sub>s</sub> / R<sub>s</sub>')}${lg('var(--c-rb)', 'Base q<sub>b</sub> / R<sub>b</sub>')}${lg('var(--c-rdug)', 'Ultimate R<sub>d,ug</sub>')}${lg('var(--c-rdg)', 'Design R*<sub>d,g</sub>')}${lg('var(--c-load)', 'E*<sub>d</sub>', true)}</div>
      <div class="legend">${layerLegend}</div>
      <p class="hint">Shaded f<sub>s</sub> is mobilised along the pile shaft; the dashed line shows the potential value at other depths. The q<sub>b</sub> profile shows the base resistance if the toe were at that depth (before the minimum-embedment rule).</p>`;
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
    const yMax = niceMax(Math.min(isFinite(wCap) ? wCap : 50, Math.max(...pts.map((p) => p.fleming), ...pts.map((p) => p.rw))));
    const xMax = niceMax(d.Rdug);
    const x = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const y = (w) => m.t + (Math.min(w, yMax) / yMax) * (H - m.t - m.b);
    const path = (key, color, dash) => `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.P).toFixed(1)},${y(p[key]).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Load settlement curve"><g class="grid">`;
    ticks(xMax).forEach((t) => (svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${x(t)}" y="${m.t - 6}" text-anchor="middle">${f0(t)}</text>`));
    ticks(yMax, 6).forEach((t) => (svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${+t.toFixed(2)}</text>`));
    svg += '</g>';
    svg += `<text x="${W / 2}" y="12" text-anchor="middle" class="axis-title">Pile head load (kN)</text>`;
    svg += `<text x="${m.l - 42}" y="${H / 2}" transform="rotate(-90 ${m.l - 42} ${H / 2})" text-anchor="middle" class="axis-title">Settlement (mm)</text>`;
    svg += path('fleming', 'var(--c-rdug)') + path('rw', 'var(--c-rs)', '6 4');
    if (isFinite(res.settlementLimit) && res.settlementLimit <= yMax) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(res.settlementLimit)}" y2="${y(res.settlementLimit)}" stroke="var(--c-load)" stroke-dasharray="6 4"/><text x="${W - m.r - 4}" y="${y(res.settlementLimit) - 5}" text-anchor="end">limit ${res.settlementLimit} mm</text>`;
    svg += `<line x1="${x(res.loads.sls)}" x2="${x(res.loads.sls)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--c-rb)" stroke-width="1.5"/>`;
    svg += `<circle cx="${x(res.loads.sls)}" cy="${y(d.settlement.governing)}" r="4.5" fill="var(--c-rb)"/>`;
    svg += `<text x="${x(res.loads.sls) + 6}" y="${y(d.settlement.governing) + 16}" class="halo" style="fill:var(--ink)">SLS ${f0(res.loads.sls)} kN → ${f1(d.settlement.governing)} mm</text>`;
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
    const head = Number(state.pile.head) || 0;
    $('#detail').innerHTML = `
      <div class="detail-grid">
        <div>
          <h3>Geometry</h3>
          <table>
            <tr><td>Pile type</td><td>${C.PILE_TYPES[state.pile.type].label}</td></tr>
            <tr><td>Section</td><td>${state.pile.shape === 'square' ? 'Square' : 'Circular'} D = ${f2(g.D)} m</td></tr>
            <tr><td>Perimeter / base area</td><td>${f2(g.perimeter)} m / ${g.area.toFixed(3)} m²</td></tr>
            <tr><td>Head / toe depth</td><td>${f2(head)} m / ${f2(d.toe)} m</td></tr>
            <tr><td>Length L</td><td><b>${f2(d.length)} m</b></td></tr>
            <tr><td>Equivalent E<sub>p</sub></td><td>${f0(g.Ep / 1000)} MPa</td></tr>
          </table>
        </div>
        <div>
          <h3>Geotechnical strength (ULS)</h3>
          <table>
            <tr><td>Shaft R<sub>s</sub></td><td class="num">${f0(d.Rs)} kN</td></tr>
            <tr><td>Base R<sub>b</sub> = q<sub>b</sub>A<sub>b</sub></td><td class="num">${f0(d.qb)} × ${g.area.toFixed(3)} = ${f0(d.Rb)} kN</td></tr>
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
      <p class="hint">Length to satisfy ULS only: ${res.requiredULS !== null ? f2(res.requiredULS - head) + ' m' : 'not achieved'} · SLS only: ${res.requiredSLS !== null ? f2(res.requiredSLS - head) + ' m' : 'not achieved'} (minimum length ${f2(Number(state.pile.minLength) || 0)} m).</p>`;
  }

  function renderDepthTable(res) {
    const step = 10;
    const rows = res.rows.filter((r, i) => i % step === 0 || r.toe === res.required);
    $('#depth-table').innerHTML = `<table>
      <thead><tr><th class="num">Toe (m)</th><th class="num">L (m)</th><th class="num">R<sub>s</sub></th><th class="num">R<sub>b</sub></th><th class="num">R<sub>d,ug</sub></th><th class="num">R*<sub>d,g</sub></th><th class="num">Settlement (mm)</th><th>ULS</th><th>SLS</th></tr></thead>
      <tbody>${rows.map((r) => `<tr${r.toe === res.required ? ' style="font-weight:650"' : ''}><td class="num">${f2(r.toe)}</td><td class="num">${f2(r.length)}</td><td class="num">${f0(r.Rs)}</td><td class="num">${f0(r.Rb)}</td><td class="num">${f0(r.Rdug)}</td><td class="num">${f0(r.Rdg)}</td><td class="num">${f1(r.settlement)}</td><td>${pill(r.okULS)}</td><td>${pill(r.okSLS)}</td></tr>`).join('')}</tbody>
    </table><p class="hint">Resistances in kN.</p>`;
  }

  function renderPrintHead(res) {
    const p = project().details;
    const layers = res.profile.map((l) => `<tr><td>${K.swatch(l.pattern, l.color, 22, 14)}</td><td>${escapeHtml(l.name || '')}</td><td>${TYPE_LABEL[l.type]}</td><td class="num">${f2(l.top)}–${f2(l.bottom)}</td><td class="num">${l.gamma ?? ''}</td><td class="num">${l.type === 'clay' ? 'su ' + l.su + ' kPa' : l.type === 'sand' ? 'φ′ ' + l.phi + '°' : l.type === 'rock' ? 'qu ' + l.qu + ' MPa' : 'fs ' + (l.fsUser ?? '') + ', qb ' + (l.qbUser ?? '') + ' kPa'}</td><td class="num">${l.E ?? ''}</td></tr>`).join('');
    $('#print-head').innerHTML = `<div class="card">
      <h2>Pile design – AS 2159-2009 · ${escapeHtml(state.name)}</h2>
      <table><tr><td>Project: <b>${escapeHtml(p.name || '')}</b></td><td>Job: ${escapeHtml(p.job || '')}</td><td>Client: ${escapeHtml(p.client || '')}</td><td>Site: ${escapeHtml(p.location || '')}</td></tr>
      <tr><td>Designer: ${escapeHtml(p.designer || '')}</td><td>Checker: ${escapeHtml(p.checker || '')}</td><td>Rev: ${escapeHtml(p.revision || '')}</td><td>Date: ${escapeHtml(p.date || new Date().toLocaleDateString('en-AU'))}</td></tr></table>
      <p>Pile: ${C.PILE_TYPES[state.pile.type].label}, D = ${state.pile.D} m. Loads: G = ${state.loads.G} kN, Q = ${state.loads.Q} kN → E*<sub>d</sub> = ${f0(res.loads.uls)} kN, SLS = ${f0(res.loads.sls)} kN. Groundwater ${state.gwl === '' ? 'not encountered' : 'at ' + state.gwl + ' m'}. ARR = ${f2(res.phi.arr)}, φ<sub>g</sub> = ${f2(res.phi.phiG)} (${state.reduction.redundancy} redundancy).</p>
      <table><thead><tr><th></th><th>Layer</th><th>Type</th><th class="num">Depth (m)</th><th class="num">γ</th><th class="num">Strength</th><th class="num">E (MPa)</th></tr></thead><tbody>${layers}</tbody></table>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Static content
  // ---------------------------------------------------------------------------
  function renderContent() {
    $('#app-version').textContent = 'v' + K.VERSION;
    const labels = ['≤ 1.5', '1.5 – 2.0', '2.0 – 2.5', '2.5 – 3.0', '3.0 – 3.5', '3.5 – 4.0', '4.0 – 4.5', '> 4.5'];
    $('#phigb-table').innerHTML = C.PHI_GB_TABLE.map((r, i) => `<tr><td>${labels[i]}</td><td>${r.category}</td><td class="num">${r.low.toFixed(2)}</td><td class="num">${r.high.toFixed(2)}</td></tr>`).join('');
    $('#ref-list').innerHTML = K.REFERENCES.map((r) => `<li>${r.text} <span class="ref-use">Used for: ${r.use}</span> <a href="${K.scholar(r.q)}" target="_blank" rel="noopener">Find ↗</a></li>`).join('');
    $('#ref-further').innerHTML = K.FURTHER.map((r) => `<li>${r.text} <a href="${K.scholar(r.q)}" target="_blank" rel="noopener">Find ↗</a></li>`).join('');
    $('#version-list').innerHTML = K.VERSIONS.map((v) => `<section class="version"><h3>v${v.version} <span class="ref">${v.date}</span></h3><ul>${v.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></section>`).join('');
    K.renderFigures(document);
  }

  // ---------------------------------------------------------------------------
  // API for the automated calculation module
  // ---------------------------------------------------------------------------
  window.PileApp = {
    project,
    projects: () => store.projects,
    save,
    uid,
    clone,
    escapeHtml,
    methodDefaults,
    withFill,
    exampleCalc,
    TYPE_LABEL,
    LAYER_FIELDS,
    sheetPhiG: (c) => C.design(toInput(c)).phi,
    currentSheet: () => state,
    addSheet(c) {
      project().calcs.push(normaliseCalc(c));
      renderSheetSummary();
      openSheet(project().calcs[project().calcs.length - 1].id);
      showTab('calc');
      save();
    },
    showTab,
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  renderContent();
  renderProjectSelect();
  fillProjectForm();
  renderSheetTabs();
  fillForm();
  showSubtab(store.ui.subtab || 'methods');
  showTab(store.ui.tab || 'calc');
})();
