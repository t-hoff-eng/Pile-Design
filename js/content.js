/* Static content, fill patterns and learning figures. Depends on js/calc.js (global PileCalc). */
(function (root) {
  'use strict';
  const C = root.PileCalc;

  const VERSION = '2.0.0';

  const VERSIONS = [
    {
      version: '2.0.0',
      date: '2026-11-10',
      changes: [
        'Tabbed interface: Methods & information (Methods, Learning, Inputs explained, References, Version history), Limitations, Project details and Calculations.',
        'Multiple projects stored in the browser, with a project switcher in the top-right corner; new, duplicate, delete, export and import projects.',
        'Multiple calculation sheets per project as sub-tabs; new, duplicate, rename and delete sheets. Project details page lists every sheet with its result.',
        'Pile and ground profile graphic: soil column with the pile, groundwater and layers, alongside unit shaft resistance, unit base resistance and capacity plots against depth.',
        'Selectable hatch pattern and colour for each ground profile layer.',
        'Learning diagrams for each concept; equations and input guidance pages; references with links.',
        'Existing single-sheet data is migrated automatically into a project.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-11-10',
      changes: [
        'Initial release: required pile length from shaft and end bearing to AS 2159-2009 with φg from the Average Risk Rating and load testing.',
        'Clay (α), sand (β, Nq), rock (Rowe & Armitage, Zhang & Einstein) and user-defined layers with limiting values.',
        'Settlement by Randolph & Wroth (1978) and Fleming (1992); load–settlement chart; printable report; JSON import/export; unit tests.',
      ],
    },
  ];

  const scholar = (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;
  const REFERENCES = [
    { text: 'Randolph, M.F. & Wroth, C.P. (1978). Analysis of deformation of vertically loaded piles. <i>Journal of the Geotechnical Engineering Division</i>, ASCE, 104(GT12), 1465–1488.', use: 'Elastic settlement', q: 'Randolph Wroth 1978 Analysis of deformation of vertically loaded piles' },
    { text: 'Fleming, W.G.K. (1992). A new method for single pile settlement prediction and analysis. <i>Géotechnique</i>, 42(3), 411–425.', use: 'Non-linear settlement', q: 'Fleming 1992 A new method for single pile settlement prediction and analysis Geotechnique' },
    { text: 'Kulhawy, F.H. (1984). Limiting tip and side resistance: fact or fallacy? <i>Analysis and Design of Pile Foundations</i>, ASCE, 80–98.', use: 'K/K₀ and δ/φ′ (β-method)', q: 'Kulhawy 1984 Limiting tip and side resistance fact or fallacy' },
    { text: 'American Petroleum Institute (2000). <i>RP 2A-WSD</i>, 21st ed., Section 6.4 – Pile foundations: axial capacity in cohesive soils.', use: 'API α method', q: 'API RP 2A-WSD axial pile capacity cohesive soils alpha' },
    { text: 'Skempton, A.W. (1951). The bearing capacity of clays. <i>Proceedings of the Building Research Congress</i>, London, Division 1, 180–189.', use: 'N<sub>c</sub> = 9', q: 'Skempton 1951 The bearing capacity of clays Building Research Congress' },
    { text: 'Skempton, A.W. (1959). Cast in-situ bored piles in London Clay. <i>Géotechnique</i>, 9(4), 153–173.', use: 'Bored pile α ≈ 0.45', q: 'Skempton 1959 Cast in-situ bored piles in London Clay' },
    { text: 'Hansen, J.B. (1970). A revised and extended formula for bearing capacity. <i>Danish Geotechnical Institute Bulletin</i> No. 28, 5–11.', use: 'N<sub>q</sub> and depth factor d<sub>q</sub>', q: 'Brinch Hansen 1970 A revised and extended formula for bearing capacity' },
    { text: 'Rowe, R.K. & Armitage, H.H. (1987). A design method for drilled piers in soft rock. <i>Canadian Geotechnical Journal</i>, 24(1), 126–142.', use: 'Rock socket shaft resistance', q: 'Rowe Armitage 1987 A design method for drilled piers in soft rock' },
    { text: 'Zhang, L. & Einstein, H.H. (1998). End bearing capacity of drilled shafts in rock. <i>Journal of Geotechnical and Geoenvironmental Engineering</i>, ASCE, 124(7), 574–584.', use: 'Rock end bearing', q: 'Zhang Einstein 1998 End bearing capacity of drilled shafts in rock' },
  ];
  const FURTHER = [
    { text: 'Poulos, H.G. & Davis, E.H. (1980). <i>Pile Foundation Analysis and Design</i>. Wiley, New York.', q: 'Poulos Davis 1980 Pile Foundation Analysis and Design' },
    { text: 'Fleming, K., Weltman, A., Randolph, M. & Elson, K. (2009). <i>Piling Engineering</i>, 3rd ed. Taylor & Francis.', q: 'Fleming Weltman Randolph Elson Piling Engineering 3rd edition' },
    { text: 'Tomlinson, M. & Woodward, J. (2014). <i>Pile Design and Construction Practice</i>, 6th ed. CRC Press.', q: 'Tomlinson Woodward Pile Design and Construction Practice 6th edition' },
    { text: 'Pells, P.J.N., Mostyn, G. & Walker, B.F. (1998). Foundations on sandstone and shale in the Sydney region. <i>Australian Geomechanics</i>, 33(3), 17–29.', q: 'Pells Mostyn Walker 1998 Foundations on sandstone and shale in the Sydney region' },
    { text: 'Kulhawy, F.H. & Mayne, P.W. (1990). <i>Manual on Estimating Soil Properties for Foundation Design</i>. EPRI EL-6800, Electric Power Research Institute.', q: 'Kulhawy Mayne 1990 Manual on estimating soil properties for foundation design' },
    { text: 'Stroud, M.A. (1974). The standard penetration test in insensitive clays and soft rocks. <i>Proc. European Symposium on Penetration Testing</i>, Stockholm, 2(2), 367–375.', q: 'Stroud 1974 standard penetration test in insensitive clays and soft rocks' },
    { text: 'Robertson, P.K. & Cabal, K.L. (2015). <i>Guide to Cone Penetration Testing for Geotechnical Engineering</i>, 6th ed. Gregg Drilling.', q: 'Robertson Cabal Guide to Cone Penetration Testing' },
    { text: 'Bustamante, M. & Gianeselli, L. (1982). Pile bearing capacity prediction by means of static penetrometer CPT. <i>Proc. 2nd European Symposium on Penetration Testing</i>, Amsterdam, 493–500.', q: 'Bustamante Gianeselli 1982 Pile bearing capacity prediction by means of static penetrometer CPT' },
    { text: 'Randolph, M.F. (2003). Science and empiricism in pile foundation design. <i>Géotechnique</i>, 53(10), 847–875.', q: 'Randolph 2003 Science and empiricism in pile foundation design' },
  ];

  // ---------------------------------------------------------------------------
  // Fill patterns for ground layers
  // ---------------------------------------------------------------------------
  const PATTERNS = {
    none: 'Solid',
    dashes: 'Clay (dashes)',
    dashdot: 'Silt (dash-dot)',
    dots: 'Sand (dots)',
    circles: 'Gravel (circles)',
    crosshatch: 'Fill (cross-hatch)',
    brick: 'Rock (brick)',
    diagonal: 'Diagonal',
    peat: 'Organic / peat',
  };
  const TYPE_DEFAULT_FILL = {
    clay: { pattern: 'dashes', color: '#c8a27c' },
    sand: { pattern: 'dots', color: '#ecd98c' },
    rock: { pattern: 'brick', color: '#a7aab0' },
    user: { pattern: 'diagonal', color: '#b7c9a8' },
  };

  /** SVG <pattern> definition for a layer fill. */
  function patternDef(id, pattern, color) {
    const s = 'stroke="rgba(30,30,30,0.55)" stroke-width="1" fill="none"';
    const f = 'fill="rgba(30,30,30,0.55)"';
    let inner = '';
    switch (pattern) {
      case 'dashes': inner = `<path d="M1 4h6M7 10h6" ${s}/>`; break;
      case 'dashdot': inner = `<path d="M0 4h6M6 10h6" ${s}/><circle cx="9.5" cy="4" r="0.9" ${f}/><circle cx="2.5" cy="10" r="0.9" ${f}/>`; break;
      case 'dots': inner = `<circle cx="3" cy="3" r="1" ${f}/><circle cx="9" cy="9" r="1" ${f}/><circle cx="9" cy="3.5" r="0.6" ${f}/><circle cx="3" cy="9.5" r="0.6" ${f}/>`; break;
      case 'circles': inner = `<circle cx="3.5" cy="3.5" r="2.3" ${s}/><circle cx="9.5" cy="9" r="1.8" ${s}/>`; break;
      case 'crosshatch': inner = `<path d="M0 0L12 12M12 0L0 12" ${s}/>`; break;
      case 'brick': inner = `<path d="M0 0.5h12M0 6.5h12M0.5 0.5v6M6.5 6.5v6" ${s}/>`; break;
      case 'diagonal': inner = `<path d="M0 12L12 0M-3 3L3 -3M9 15L15 9" ${s}/>`; break;
      case 'peat': inner = `<path d="M1 5q2 -3 4 0t4 0M4 11q2 -3 4 0" ${s}/><path d="M10 2v3M3 8v3" ${s}/>`; break;
      default: inner = '';
    }
    return `<pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${color}"/>${inner}</pattern>`;
  }

  function swatch(pattern, color, w = 34, h = 20) {
    const id = 'sw' + Math.random().toString(36).slice(2, 9);
    return `<svg class="swatch" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs>${patternDef(id, pattern, color)}</defs><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" fill="url(#${id})" stroke="rgba(0,0,0,0.3)"/></svg>`;
  }

  // ---------------------------------------------------------------------------
  // Generic small chart helper
  // ---------------------------------------------------------------------------
  function niceStep(range, n) {
    const raw = range / n;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  function plot(o) {
    const W = o.W || 420, H = o.H || 300;
    const m = { l: 52, r: 16, t: o.depthDown ? 34 : 14, b: o.depthDown ? 14 : 40 };
    const [x0, x1] = o.x, [y0, y1] = o.y;
    const lx = (v) => (o.logX ? Math.log10(v) : v);
    const X = (v) => m.l + ((lx(v) - lx(x0)) / (lx(x1) - lx(x0))) * (W - m.l - m.r);
    const Y = o.depthDown ? (v) => m.t + ((v - y0) / (y1 - y0)) * (H - m.t - m.b) : (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
    let g = '<g class="grid">';
    const xt = o.xTicks || (() => { const st = niceStep(x1 - x0, 5); const a = []; for (let v = x0; v <= x1 + 1e-9; v += st) a.push(+v.toFixed(6)); return a; })();
    const yt = o.yTicks || (() => { const st = niceStep(y1 - y0, 5); const a = []; for (let v = y0; v <= y1 + 1e-9; v += st) a.push(+v.toFixed(6)); return a; })();
    const xLabY = o.depthDown ? m.t - 6 : H - m.b + 14;
    xt.forEach((t) => (g += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${X(t)}" y="${xLabY}" text-anchor="middle">${t}</text>`));
    yt.forEach((t) => (g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`));
    g += '</g>';
    g += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="none" stroke="var(--line)"/>`;
    const xl = o.depthDown ? 11 : H - 6;
    g += `<text x="${(m.l + W - m.r) / 2}" y="${xl}" text-anchor="middle" class="axis-title">${o.xlabel}</text>`;
    g += `<text x="14" y="${(m.t + H - m.b) / 2}" transform="rotate(-90 14 ${(m.t + H - m.b) / 2})" text-anchor="middle" class="axis-title">${o.ylabel}</text>`;
    (o.series || []).forEach((s) => {
      const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
      if (s.label) {
        const p = s.labelAt || s.pts[s.pts.length - 1];
        g += `<text x="${X(p[0]) + (s.dx || 4)}" y="${Y(p[1]) + (s.dy || -4)}" style="fill:${s.color};font-weight:600" text-anchor="${s.anchor || 'start'}">${s.label}</text>`;
      }
    });
    if (o.extra) g += o.extra(X, Y);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria || ''}">${g}</svg>`;
  }

  // ---------------------------------------------------------------------------
  // Learning figures
  // ---------------------------------------------------------------------------
  const arrowDefs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;

  function figLoadTransfer() {
    const ids = { s: 'lt-s', c: 'lt-c' };
    let g = `<svg viewBox="0 0 440 320" role="img" aria-label="Load transfer from a pile to the ground" style="color:var(--ink)">${arrowDefs}`;
    g += `<defs>${patternDef(ids.s, 'dashes', '#c8a27c')}${patternDef(ids.c, 'dots', '#ecd98c')}</defs>`;
    g += `<rect x="10" y="50" width="230" height="170" fill="url(#${ids.s})"/><rect x="10" y="220" width="230" height="90" fill="url(#${ids.c})"/>`;
    g += `<line x1="10" y1="50" x2="240" y2="50" stroke="var(--ink)" stroke-width="2"/>`;
    g += `<rect x="105" y="40" width="40" height="210" fill="#d9d9d9" stroke="#555"/>`;
    g += `<line x1="125" y1="0" x2="125" y2="36" stroke="var(--c-load)" stroke-width="3" marker-end="url(#ah)" style="color:var(--c-load)"/><text x="133" y="20" style="fill:var(--c-load);font-weight:600">P</text>`;
    for (let y = 70; y <= 230; y += 26) {
      g += `<line x1="98" y1="${y + 10}" x2="98" y2="${y - 6}" stroke="var(--c-rs)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rs)"/>`;
      g += `<line x1="152" y1="${y + 10}" x2="152" y2="${y - 6}" stroke="var(--c-rs)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rs)"/>`;
    }
    for (let x = 109; x <= 141; x += 8) g += `<line x1="${x}" y1="272" x2="${x}" y2="254" stroke="var(--c-rb)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rb)"/>`;
    g += `<text x="20" y="140" style="fill:var(--c-rs);font-weight:600">f<tspan baseline-shift="sub" font-size="8">s</tspan> shaft</text><text x="20" y="155" style="fill:#333">friction R<tspan baseline-shift="sub" font-size="8">s</tspan></text>`;
    g += `<text x="152" y="290" style="fill:#333;font-weight:600">q<tspan baseline-shift="sub" font-size="8">b</tspan> base → R<tspan baseline-shift="sub" font-size="8">b</tspan></text>`;
    // load in pile vs depth
    g += `<text x="340" y="30" text-anchor="middle">Axial load in pile</text>`;
    g += `<line x1="270" y1="40" x2="420" y2="40" stroke="var(--line)"/><line x1="270" y1="40" x2="270" y2="260" stroke="var(--line)"/>`;
    g += `<path d="M410 40 C 380 120, 330 190, 300 250" fill="none" stroke="var(--c-rdug)" stroke-width="2.5"/>`;
    g += `<line x1="270" y1="250" x2="300" y2="250" stroke="var(--c-rb)" stroke-width="2"/><text x="304" y="262">R<tspan baseline-shift="sub" font-size="8">b</tspan> at toe</text>`;
    g += `<text x="404" y="56" text-anchor="end">P at head</text><text x="350" y="140" style="fill:var(--c-rs)">shed by friction</text>`;
    return g + '</svg>';
  }

  function figPhiG() {
    const rows = C.PHI_GB_TABLE;
    const labels = ['≤1.5', '1.5–2', '2–2.5', '2.5–3', '3–3.5', '3.5–4', '4–4.5', '>4.5'];
    const W = 440, H = 300, m = { l: 44, r: 10, t: 16, b: 52 };
    const bw = (W - m.l - m.r) / rows.length;
    const Y = (v) => H - m.b - ((v - 0.3) / 0.6) * (H - m.t - m.b);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="phi gb versus average risk rating"><g class="grid">`;
    [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach((t) => (g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t.toFixed(1)}</text>`));
    g += '</g>';
    rows.forEach((r, i) => {
      const x = m.l + i * bw;
      g += `<rect x="${x + 4}" y="${Y(r.low)}" width="${bw / 2 - 4}" height="${Y(0.3) - Y(r.low)}" fill="var(--c-rdg)"/>`;
      g += `<rect x="${x + bw / 2}" y="${Y(r.high)}" width="${bw / 2 - 4}" height="${Y(0.3) - Y(r.high)}" fill="var(--c-rs)"/>`;
      g += `<text x="${x + bw / 2}" y="${H - m.b + 14}" text-anchor="middle">${labels[i]}</text>`;
    });
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0.9)}" y2="${Y(0.9)}" stroke="var(--c-load)" stroke-dasharray="5 4"/><text x="${W - m.r - 4}" y="${Y(0.9) - 4}" text-anchor="end" style="fill:var(--c-load)">φ<tspan baseline-shift="sub" font-size="8">tf</tspan> static testing (upper limit)</text>`;
    g += `<text x="${(W + m.l) / 2}" y="${H - 22}" text-anchor="middle" class="axis-title">Average Risk Rating (ARR) →  higher risk</text>`;
    g += `<rect x="${m.l + 10}" y="${H - 14}" width="10" height="10" fill="var(--c-rdg)"/><text x="${m.l + 24}" y="${H - 5}">Low redundancy</text><rect x="${m.l + 130}" y="${H - 14}" width="10" height="10" fill="var(--c-rs)"/><text x="${m.l + 144}" y="${H - 5}">High redundancy</text>`;
    g += `<text x="12" y="${(H - m.b + m.t) / 2}" transform="rotate(-90 12 ${(H - m.b + m.t) / 2})" text-anchor="middle" class="axis-title">φ<tspan baseline-shift="sub" font-size="8">gb</tspan></text>`;
    return g + '</svg>';
  }

  function figStress() {
    const gamma = 19, zw = 3, zmax = 15;
    const tot = [], eff = [], u = [];
    for (let z = 0; z <= zmax; z += 0.5) {
      const s = gamma * z;
      const uu = z > zw ? 9.81 * (z - zw) : 0;
      tot.push([s, z]); u.push([uu, z]); eff.push([s - uu, z]);
    }
    return plot({
      x: [0, 300], y: [0, zmax], depthDown: true, xlabel: 'Stress (kPa)', ylabel: 'Depth (m)', aria: 'Effective stress with depth',
      series: [
        { pts: tot, color: 'var(--muted)', dash: '5 4', label: 'σ<tspan baseline-shift="sub" font-size="8">v</tspan> total', labelAt: [tot[20][0], tot[20][1]], dx: 6 },
        { pts: u, color: 'var(--c-rdug)', dash: '2 3', label: 'u', labelAt: [u[26][0], u[26][1]], dx: 6 },
        { pts: eff, color: 'var(--c-rdg)', width: 2.5, label: 'σ′<tspan baseline-shift="sub" font-size="8">v</tspan>', labelAt: eff[30], dx: 6 },
      ],
      extra: (X, Y) => `<line x1="${X(0)}" x2="${X(300)}" y1="${Y(zw)}" y2="${Y(zw)}" stroke="var(--c-rdug)"/><text x="${X(240)}" y="${Y(zw) - 4}" style="fill:var(--c-rdug)">▽ groundwater</text>`,
    });
  }

  function figAlpha() {
    const pts = [];
    for (let lp = -1; lp <= 0.7001; lp += 0.02) {
      const psi = Math.pow(10, lp);
      pts.push([psi, C.apiAlpha(psi, 1)]);
    }
    return plot({
      x: [0.1, 5], y: [0, 1.1], logX: true, xTicks: [0.1, 0.2, 0.5, 1, 2, 5], yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1],
      xlabel: 'ψ = s<tspan baseline-shift="sub" font-size="8">u</tspan>/σ′<tspan baseline-shift="sub" font-size="8">v</tspan>', ylabel: 'α', aria: 'API alpha versus su over sigma v',
      series: [
        { pts, color: 'var(--c-rdug)', width: 2.5, label: 'API RP2A (driven)', labelAt: [1.2, 0.48], dy: -10 },
        { pts: [[0.1, 0.45], [5, 0.45]], color: 'var(--c-rb)', dash: '6 4', label: 'Bored, α = 0.45', labelAt: [0.11, 0.45], dy: 14 },
      ],
      extra: (X, Y) => `<text x="${X(0.12)}" y="${Y(1.03)}">soft, NC clay</text><text x="${X(4.8)}" y="${Y(0.18)}" text-anchor="end">stiff, OC clay</text>`,
    });
  }

  function figBeta() {
    const phi = 34, zmax = 20, gp = 10;
    const fs = (kk0, dphi) => {
      const p = (phi * Math.PI) / 180;
      const pts = [];
      for (let z = 0; z <= zmax; z += 1) pts.push([kk0 * (1 - Math.sin(p)) * gp * z * Math.tan(dphi * p), z]);
      return pts;
    };
    const driven = fs(1.5, 0.8), bored = fs(0.9, 1.0);
    return plot({
      x: [0, 120], y: [0, zmax], depthDown: true, xlabel: 'Unit shaft resistance f<tspan baseline-shift="sub" font-size="8">s</tspan> (kPa), φ′ = 34°, γ′ = 10', ylabel: 'Depth (m)', aria: 'Beta method shaft friction with depth',
      series: [
        { pts: driven, color: 'var(--c-rdug)', width: 2.5, label: 'Driven K/K₀=1.5, δ=0.8φ′', labelAt: driven[11], dx: 6 },
        { pts: bored, color: 'var(--c-rs)', width: 2.5, label: 'Bored K/K₀=0.9, δ=φ′', labelAt: bored[17], dx: 6 },
        { pts: [[80, 0], [80, zmax]], color: 'var(--c-load)', dash: '6 4', label: 'f<tspan baseline-shift="sub" font-size="8">s,max</tspan> cap', labelAt: [80, 2], dx: 4 },
      ],
    });
  }

  function figNq() {
    const nq = [], nqd = [];
    for (let p = 25; p <= 42.001; p += 0.5) {
      const r = (p * Math.PI) / 180;
      const Nq = Math.exp(Math.PI * Math.tan(r)) * Math.pow(Math.tan(Math.PI / 4 + r / 2), 2);
      const dq = 1 + 2 * Math.tan(r) * Math.pow(1 - Math.sin(r), 2) * Math.atan(20);
      nq.push([p, Nq]); nqd.push([p, Nq * dq]);
    }
    return plot({
      x: [25, 42], y: [0, 160], xlabel: 'Friction angle φ′ (°)', ylabel: 'Bearing factor', aria: 'Nq versus friction angle',
      series: [
        { pts: nq, color: 'var(--c-rs)', width: 2.5, label: 'N<tspan baseline-shift="sub" font-size="8">q</tspan>', labelAt: nq[nq.length - 1], dx: -24, dy: 14 },
        { pts: nqd, color: 'var(--c-rdug)', width: 2.5, label: 'N<tspan baseline-shift="sub" font-size="8">q</tspan>·d<tspan baseline-shift="sub" font-size="8">q</tspan> (L/D = 20)', labelAt: [36, nqd[22][1]], dx: -120, dy: -6 },
      ],
    });
  }

  function figSocket() {
    const id = 'sk-r', id2 = 'sk-s';
    let g = `<svg viewBox="0 0 440 300" role="img" aria-label="Rock socket" style="color:var(--ink)">${arrowDefs}<defs>${patternDef(id, 'brick', '#a7aab0')}${patternDef(id2, 'dashes', '#c8a27c')}</defs>`;
    g += `<rect x="10" y="20" width="420" height="90" fill="url(#${id2})"/><rect x="10" y="110" width="420" height="185" fill="url(#${id})"/>`;
    // rough socket wall
    let left = 'M170 110', right = 'M270 110';
    for (let y = 110; y < 240; y += 10) {
      left += ` L${y % 20 ? 166 : 172} ${y + 10}`;
      right += ` L${y % 20 ? 274 : 268} ${y + 10}`;
    }
    g += `<rect x="172" y="10" width="96" height="230" fill="#d9d9d9"/>`;
    g += `<path d="${left}" stroke="#333" stroke-width="1.5" fill="none"/><path d="${right}" stroke="#333" stroke-width="1.5" fill="none"/>`;
    g += `<line x1="172" y1="10" x2="172" y2="110" stroke="#555"/><line x1="268" y1="10" x2="268" y2="110" stroke="#555"/><line x1="170" y1="240" x2="270" y2="240" stroke="#333" stroke-width="1.5"/>`;
    for (let y = 130; y <= 220; y += 30) g += `<line x1="160" y1="${y + 10}" x2="160" y2="${y - 8}" stroke="var(--c-rs)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rs)"/><line x1="282" y1="${y + 10}" x2="282" y2="${y - 8}" stroke="var(--c-rs)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rs)"/>`;
    for (let x = 182; x <= 258; x += 12) g += `<line x1="${x}" y1="268" x2="${x}" y2="246" stroke="var(--c-rb)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rb)"/>`;
    g += `<text x="20" y="40" style="fill:#222">soil (shaft often ignored or low)</text>`;
    g += `<text x="20" y="160" style="fill:#111;font-weight:600">f<tspan baseline-shift="sub" font-size="8">s</tspan> = a√q<tspan baseline-shift="sub" font-size="8">u</tspan></text><text x="20" y="176" style="fill:#111">rough wall interlock</text>`;
    g += `<text x="290" y="284" style="fill:#111;font-weight:600">q<tspan baseline-shift="sub" font-size="8">b</tspan> = 4.83 q<tspan baseline-shift="sub" font-size="8">u</tspan><tspan baseline-shift="super" font-size="8">0.51</tspan></text><text x="290" y="268" style="fill:#111">clean base essential</text>`;
    g += `<text x="300" y="180" style="fill:#111">socket length</text><line x1="296" y1="110" x2="296" y2="240" stroke="#111" marker-start="url(#ah)" marker-end="url(#ah)" style="color:#111"/>`;
    return g + '</svg>';
  }

  function figMobilisation() {
    const Ms = 0.002, cb = 0.03;
    const shaft = [], base = [];
    for (let x = 0; x <= 0.985; x += 0.005) {
      shaft.push([((Ms * x) / (1 - x)) * 100, x]);
      base.push([((cb * x) / (1 - x)) * 100, x]);
    }
    return plot({
      x: [0, 10], y: [0, 1], xlabel: 'Pile settlement / diameter (%)', ylabel: 'Mobilised / ultimate resistance', aria: 'Shaft and base mobilisation',
      series: [
        { pts: shaft.filter((p) => p[0] <= 10), color: 'var(--c-rs)', width: 2.5, label: 'Shaft (M<tspan baseline-shift="sub" font-size="8">s</tspan> = 0.002)', labelAt: [1.2, 0.9], dy: 0 },
        { pts: base.filter((p) => p[0] <= 10), color: 'var(--c-rb)', width: 2.5, label: 'Base', labelAt: [6, 0.62], dy: 18 },
      ],
      extra: (X, Y) => `<rect x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" fill="var(--c-rs)" opacity="0.08"/><text x="${X(0.1)}" y="${Y(0.05)}">typical working range</text>`,
    });
  }

  function figRW() {
    let g = `<svg viewBox="0 0 440 300" role="img" aria-label="Randolph and Wroth concentric cylinder model" style="color:var(--ink)">${arrowDefs}`;
    g += `<line x1="10" y1="40" x2="430" y2="40" stroke="var(--ink)" stroke-width="2"/>`;
    g += `<rect x="40" y="40" width="30" height="190" fill="#d9d9d9" stroke="#555"/>`;
    // concentric shear rings
    [90, 130, 190, 270, 380].forEach((x, i) => (g += `<line x1="${x}" y1="40" x2="${x}" y2="230" stroke="var(--line)" stroke-dasharray="${i === 4 ? '6 3' : '2 3'}"/>`));
    g += `<text x="384" y="60">r<tspan baseline-shift="sub" font-size="8">m</tspan></text>`;
    // settlement trough (logarithmic)
    let d = '';
    for (let x = 70; x <= 380; x += 5) {
      const w = 60 * Math.log(310 / Math.max(1, x - 70 + 15)) / Math.log(310 / 15);
      d += `${x === 70 ? 'M' : 'L'}${x},${40 + Math.max(0, w)}`;
    }
    g += `<path d="${d}" fill="none" stroke="var(--c-rdug)" stroke-width="2.5"/><text x="150" y="80" style="fill:var(--c-rdug)">w(r) ∝ ln(r<tspan baseline-shift="sub" font-size="8">m</tspan>/r)</text>`;
    g += `<text x="96" y="150">τ(r) = τ<tspan baseline-shift="sub" font-size="8">0</tspan>r<tspan baseline-shift="sub" font-size="8">0</tspan>/r</text>`;
    for (let i = 0; i < 4; i++) g += `<line x1="${76 + i * 0}" y1="${200 - i * 40}" x2="${76}" y2="${184 - i * 40}" stroke="var(--c-rs)" stroke-width="2" marker-end="url(#ah)" style="color:var(--c-rs)"/>`;
    g += `<path d="M40 230 q15 30 30 0" fill="var(--c-rb)" opacity="0.35"/><text x="80" y="258">base: rigid punch, G<tspan baseline-shift="sub" font-size="8">b</tspan></text>`;
    g += `<text x="20" y="290">pile r<tspan baseline-shift="sub" font-size="8">0</tspan>, E<tspan baseline-shift="sub" font-size="8">p</tspan>; soil G<tspan baseline-shift="sub" font-size="8">avg</tspan> along shaft, G<tspan baseline-shift="sub" font-size="8">L</tspan> at toe</text>`;
    return g + '</svg>';
  }

  const FIGURES = {
    'fig-load-transfer': [figLoadTransfer, 'Load is shed from the shaft by friction; the remainder is carried in end bearing.'],
    'fig-phig': [figPhiG, 'Basic geotechnical reduction factor φgb against Average Risk Rating (AS 2159 Cl. 4.3.2).'],
    'fig-stress': [figStress, 'Total stress, pore pressure and effective stress (γ = 19 kN/m³, groundwater at 3 m).'],
    'fig-alpha': [figAlpha, 'API RP2A adhesion factor α against s_u/σ′v compared with a fixed bored pile α.'],
    'fig-beta': [figBeta, 'β-method shaft resistance increases linearly with depth; a limiting value is applied in practice.'],
    'fig-nq': [figNq, 'Bearing capacity factor Nq and Nq·dq against φ′ – note the steep sensitivity to φ′.'],
    'fig-socket': [figSocket, 'Rock socket: shaft resistance from wall roughness and rock strength; base from rock UCS.'],
    'fig-mobilisation': [figMobilisation, 'Fleming hyperbolic mobilisation – the shaft mobilises at far smaller movement than the base.'],
    'fig-rw': [figRW, 'Randolph & Wroth: shear stress and settlement decay with radius around the shaft out to rm.'],
  };

  function renderFigures(doc) {
    Object.entries(FIGURES).forEach(([id, [fn, cap]]) => {
      const el = doc.getElementById(id);
      if (el) el.innerHTML = fn() + `<figcaption>${cap}</figcaption>`;
    });
  }

  root.PileContent = { VERSION, VERSIONS, REFERENCES, FURTHER, PATTERNS, TYPE_DEFAULT_FILL, patternDef, swatch, scholar, renderFigures };
})(typeof self !== 'undefined' ? self : this);
