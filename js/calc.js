/*
 * Pile design calculation engine
 * ------------------------------
 * Axial (compression) geotechnical design of single piles in accordance with
 * AS 2159-2009 "Piling - Design and installation", with load combinations from
 * AS/NZS 1170.0.
 *
 *   R*d,g = phi_g x Rd,ug >= E*d                       (AS 2159 Cl. 4.3.1)
 *   phi_g = phi_gb + (phi_tf - phi_gb) K >= phi_gb     (AS 2159 Cl. 4.3.1)
 *   phi_gb from the Average Risk Rating (ARR)          (AS 2159 Cl. 4.3.2)
 *
 * Ultimate geotechnical strength Rd,ug = shaft + base, computed layer by layer
 * using established static methods (AS 2159 does not prescribe a method):
 *   Clay  : shaft alpha*su (API RP2A alpha or fixed alpha), base Nc*su
 *   Sand  : shaft beta method  K*sigma'v*tan(delta)  (Kulhawy K/K0, delta/phi')
 *           base  Nq*dq*sigma'v  (Hansen/Vesic Nq with depth factor)
 *   Rock  : shaft a*sqrt(qu)    (Rowe & Armitage 1987, qu in MPa)
 *           base  4.83*qu^0.51  (Zhang & Einstein 1998, qu in MPa)
 *   User  : directly specified ultimate fs and qb
 *
 * Serviceability (settlement, AS 2159 Cl. 4.4):
 *   - Randolph & Wroth (1978) elastic solution for a compressible pile
 *   - Fleming (1992) hyperbolic non-linear load-settlement method
 *
 * Units: length m, force kN, stress kPa. Moduli are input in MPa and qu in MPa.
 * Works in the browser (global `PileCalc`) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PileCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GAMMA_W = 9.81; // kN/m3
  const DZ = 0.05; // integration / search step (m)
  const EPS = 1e-6;
  const rad = (d) => (d * Math.PI) / 180;

  // ---------------------------------------------------------------------------
  // AS 2159-2009 Cl. 4.3.2 - geotechnical strength reduction factor
  // ---------------------------------------------------------------------------

  /** Risk factors and weighting factors (wi), AS 2159-2009 Table 4.3.2(A). */
  const RISK_FACTORS = [
    { id: 'geoComplexity', group: 'Site', w: 2, label: 'Geological complexity of site' },
    { id: 'investigation', group: 'Site', w: 2, label: 'Extent of ground investigation' },
    { id: 'dataQuality', group: 'Site', w: 2, label: 'Amount and quality of geotechnical data' },
    { id: 'experience', group: 'Design', w: 1, label: 'Experience with similar foundations in similar geological conditions' },
    { id: 'paramMethod', group: 'Design', w: 2, label: 'Method of assessment of geotechnical parameters for design' },
    { id: 'designMethod', group: 'Design', w: 1, label: 'Design method adopted' },
    { id: 'testUse', group: 'Design', w: 2, label: 'Method of utilizing results of in situ test data and installation data' },
    { id: 'constructionControl', group: 'Installation', w: 2, label: 'Level of construction control' },
    { id: 'monitoring', group: 'Installation', w: 0.5, label: 'Level of performance monitoring of the supported structure during and after construction' },
  ];

  /** Individual risk rating (IRR) descriptors, 1 = very low risk ... 5 = very high risk. */
  const RISK_LEVELS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];

  /** Basic geotechnical strength reduction factor phi_gb vs ARR (AS 2159-2009 Cl. 4.3.2). */
  const PHI_GB_TABLE = [
    { maxARR: 1.5, category: 'Very low', low: 0.67, high: 0.76 },
    { maxARR: 2.0, category: 'Very low to low', low: 0.61, high: 0.7 },
    { maxARR: 2.5, category: 'Low', low: 0.56, high: 0.64 },
    { maxARR: 3.0, category: 'Low to moderate', low: 0.52, high: 0.6 },
    { maxARR: 3.5, category: 'Moderate', low: 0.48, high: 0.56 },
    { maxARR: 4.0, category: 'Moderate to high', low: 0.45, high: 0.53 },
    { maxARR: 4.5, category: 'High', low: 0.42, high: 0.5 },
    { maxARR: Infinity, category: 'Very high', low: 0.4, high: 0.47 },
  ];

  /** Average Risk Rating, ARR = sum(wi * IRRi) / sum(wi). */
  function averageRiskRating(ratings) {
    let sw = 0;
    let swr = 0;
    for (const f of RISK_FACTORS) {
      const r = Number(ratings && ratings[f.id]);
      const irr = r >= 1 && r <= 5 ? r : 3;
      sw += f.w;
      swr += f.w * irr;
    }
    return swr / sw;
  }

  function phiGb(arr, redundancy) {
    const row = PHI_GB_TABLE.find((r) => arr <= r.maxARR + EPS);
    return { value: redundancy === 'high' ? row.high : row.low, category: row.category };
  }

  /**
   * Geotechnical strength reduction factor phi_g (AS 2159-2009 Cl. 4.3.1).
   * testing: { type: 'none' | 'static' | 'dynamic', percent, phiTf }
   */
  function geotechnicalReductionFactor(opts) {
    const arr = averageRiskRating(opts.ratings);
    const gb = phiGb(arr, opts.redundancy);
    const t = opts.testing || { type: 'none' };
    let K = 0;
    let phiTf = 0;
    if (t.type === 'static' || t.type === 'dynamic') {
      const p = Math.max(0, Number(t.percent) || 0);
      const c = t.type === 'static' ? 1.33 : 1.13;
      K = Math.min(1, (c * p) / (p + 3.3));
      phiTf = Number(t.phiTf) || (t.type === 'static' ? 0.9 : 0.8);
    }
    let phi = gb.value;
    if (K > 0) phi = Math.max(gb.value, gb.value + (phiTf - gb.value) * K);
    let override = false;
    if (opts.override && Number(opts.override) > 0) {
      phi = Number(opts.override);
      override = true;
    }
    return { arr, phiGb: gb.value, category: gb.category, K, phiTf, phiG: phi, override };
  }

  // ---------------------------------------------------------------------------
  // Loads - AS/NZS 1170.0
  // ---------------------------------------------------------------------------

  function designLoads(loads) {
    const G = Number(loads.G) || 0;
    const Q = Number(loads.Q) || 0;
    const psiS = loads.psiS != null ? Number(loads.psiS) : 0.7;
    const combos = [
      { name: '1.35G', value: 1.35 * G },
      { name: '1.2G + 1.5Q', value: 1.2 * G + 1.5 * Q },
    ];
    const gov = combos.reduce((a, b) => (b.value > a.value ? b : a));
    return { uls: gov.value, ulsCombo: gov.name, combos, sls: G + psiS * Q, slsCombo: `G + ${psiS}Q` };
  }

  // ---------------------------------------------------------------------------
  // Pile types and geometry
  // ---------------------------------------------------------------------------

  /** Default method parameters by pile type (Kulhawy 1984 K/K0 and delta/phi'). */
  const PILE_TYPES = {
    bored: { label: 'Bored cast-in-place concrete', KK0: 0.9, deltaPhi: 1.0, alphaMethod: 'fixed', alpha: 0.45, displacement: false },
    cfa: { label: 'CFA (continuous flight auger)', KK0: 0.9, deltaPhi: 1.0, alphaMethod: 'fixed', alpha: 0.5, displacement: false },
    precast: { label: 'Driven precast concrete', KK0: 1.5, deltaPhi: 0.8, alphaMethod: 'api', alpha: 0.5, displacement: true },
    steelTube: { label: 'Driven steel tube (closed end)', KK0: 1.5, deltaPhi: 0.7, alphaMethod: 'api', alpha: 0.5, displacement: true },
  };

  function geometry(pile) {
    const D = Number(pile.D);
    const square = pile.shape === 'square';
    const perimeter = square ? 4 * D : Math.PI * D;
    const area = square ? D * D : (Math.PI * D * D) / 4;
    const r0 = square ? D / Math.sqrt(Math.PI) : D / 2; // area-equivalent radius
    // Equivalent Young's modulus of a solid section (kPa)
    let Ep = Number(pile.Ep) * 1000;
    if (pile.type === 'steelTube' && Number(pile.wall) > 0 && !square) {
      const t = Math.min(Number(pile.wall), D / 2);
      const As = (Math.PI * (D * D - (D - 2 * t) * (D - 2 * t))) / 4;
      Ep = (Ep * As) / area;
    }
    return { D, perimeter, area, r0, Ep, Deq: 2 * r0 };
  }

  // ---------------------------------------------------------------------------
  // Soil profile
  // ---------------------------------------------------------------------------

  /** Normalise layers: sort, assign tops from previous bottom. */
  function buildProfile(layers) {
    const ls = layers
      .filter((l) => Number(l.bottom) > 0)
      .map((l) => ({ ...l, bottom: Number(l.bottom) }))
      .sort((a, b) => a.bottom - b.bottom);
    let top = 0;
    for (const l of ls) {
      l.top = top;
      top = l.bottom;
    }
    return ls;
  }

  function layerAt(profile, z) {
    for (const l of profile) if (z >= l.top - EPS && z < l.bottom - EPS) return l;
    return profile[profile.length - 1];
  }

  /** Vertical effective stress at depth z (kPa). */
  function sigmaV(profile, z, gwl) {
    let s = 0;
    for (const l of profile) {
      if (z <= l.top) break;
      const h = Math.min(z, l.bottom) - l.top;
      s += (Number(l.gamma) || 18) * h;
    }
    const last = profile[profile.length - 1];
    if (last && z > last.bottom) s += (Number(last.gamma) || 18) * (z - last.bottom);
    const u = gwl != null && gwl !== '' && z > Number(gwl) ? GAMMA_W * (z - Number(gwl)) : 0;
    return Math.max(0, s - u);
  }

  // ---------------------------------------------------------------------------
  // Unit resistances
  // ---------------------------------------------------------------------------

  function apiAlpha(su, sv) {
    if (sv <= 0) return 1;
    const psi = su / sv;
    const a = psi <= 1 ? 0.5 * Math.pow(psi, -0.5) : 0.5 * Math.pow(psi, -0.25);
    return Math.min(1, a);
  }

  function capped(v, max) {
    const m = Number(max);
    return m > 0 ? Math.min(v, m) : v;
  }

  /** Ultimate unit shaft resistance fs (kPa) at depth z. */
  function unitShaft(layer, z, ctx) {
    const sv = sigmaV(ctx.profile, z, ctx.gwl);
    const m = ctx.method;
    let fs = 0;
    let note = '';
    switch (layer.type) {
      case 'clay': {
        const su = Number(layer.su) || 0;
        const alpha = m.alphaMethod === 'api' ? apiAlpha(su, sv) : Number(m.alpha);
        fs = alpha * su;
        note = `α=${alpha.toFixed(2)}`;
        break;
      }
      case 'sand': {
        const phi = rad(Number(layer.phi) || 0);
        const K0 = 1 - Math.sin(phi);
        const K = Number(m.KK0) * K0;
        const delta = Number(m.deltaPhi) * phi;
        fs = K * sv * Math.tan(delta);
        note = `K=${K.toFixed(2)}, δ=${((delta * 180) / Math.PI).toFixed(1)}°`;
        break;
      }
      case 'rock': {
        const qu = Number(layer.qu) || 0; // MPa
        fs = Number(m.rockShaftA) * Math.sqrt(qu) * 1000;
        note = `${m.rockShaftA}√qu`;
        break;
      }
      default:
        fs = Number(layer.fsUser) || 0;
        note = 'user';
    }
    return { fs: capped(fs, layer.fsMax), sv, note };
  }

  /** Ultimate unit base resistance qb (kPa) for a layer at toe depth z. */
  function unitBase(layer, z, ctx) {
    const sv = sigmaV(ctx.profile, z, ctx.gwl);
    const m = ctx.method;
    let qb = 0;
    let note = '';
    switch (layer.type) {
      case 'clay':
        qb = Number(m.Nc) * (Number(layer.su) || 0);
        note = `Nc=${m.Nc}`;
        break;
      case 'sand': {
        const phiDeg = Number(layer.phi) || 0;
        const phi = rad(phiDeg);
        const Nq = Math.exp(Math.PI * Math.tan(phi)) * Math.pow(Math.tan(rad(45 + phiDeg / 2)), 2);
        const LB = ctx.embedLength / ctx.geom.Deq;
        const k = LB <= 1 ? LB : Math.atan(LB);
        const dq = 1 + 2 * Math.tan(phi) * Math.pow(1 - Math.sin(phi), 2) * k;
        qb = Nq * dq * sv;
        note = `Nq=${Nq.toFixed(1)}, dq=${dq.toFixed(2)}`;
        break;
      }
      case 'rock': {
        const qu = Number(layer.qu) || 0;
        qb = 4.83 * Math.pow(qu, 0.51) * 1000;
        note = '4.83qu^0.51';
        break;
      }
      default:
        qb = Number(layer.qbUser) || 0;
        note = 'user';
    }
    return { qb: capped(qb, layer.qbMax), sv, note };
  }

  // ---------------------------------------------------------------------------
  // Capacity of a pile with toe at depth `toe`
  // ---------------------------------------------------------------------------

  function makeContext(input) {
    const profile = buildProfile(input.layers);
    const typeDefaults = PILE_TYPES[input.pile.type] || PILE_TYPES.bored;
    const method = { ...typeDefaults, Nc: 9, rockShaftA: 0.45, Ms: 0.0015, Ke: 0.5, ...(input.method || {}) };
    return {
      profile,
      method,
      gwl: input.gwl,
      geom: geometry(input.pile),
      head: Number(input.pile.head) || 0,
      ignoreTop: Number(input.pile.ignoreTop) || 0,
      minEmbed: Number(input.pile.minEmbed) || 0,
    };
  }

  function capacityAt(ctx, toe) {
    const { geom, profile } = ctx;
    const head = ctx.head;
    const shaftStart = Math.max(head, ctx.ignoreTop);
    ctx.embedLength = toe; // embedment below ground for depth factor
    // Shaft: integrate with midpoint rule, aggregate by layer
    const perLayer = new Map();
    let Rs = 0;
    const n = Math.max(0, Math.round((toe - shaftStart) / DZ));
    const dz = n > 0 ? (toe - shaftStart) / n : 0;
    for (let i = 0; i < n; i++) {
      const z = shaftStart + (i + 0.5) * dz;
      const layer = layerAt(profile, z);
      const { fs } = unitShaft(layer, z, ctx);
      const dR = fs * geom.perimeter * dz;
      Rs += dR;
      const e = perLayer.get(layer) || { layer, from: z - dz / 2, to: 0, Rs: 0, fsMax: 0, fsMin: Infinity };
      e.to = z + dz / 2;
      e.Rs += dR;
      e.fsMax = Math.max(e.fsMax, fs);
      e.fsMin = Math.min(e.fsMin, fs);
      perLayer.set(layer, e);
    }
    // Base: layer the toe is founded in (layer containing the point just above the toe)
    const baseLayer = layerAt(profile, Math.max(0, toe - EPS * 10));
    let base = unitBase(baseLayer, toe, ctx);
    let baseNote = base.note;
    const embedInBase = toe - Math.max(baseLayer.top, head);
    if (ctx.minEmbed > 0 && embedInBase < ctx.minEmbed - EPS) {
      const idx = profile.indexOf(baseLayer);
      if (idx > 0) {
        const above = unitBase(profile[idx - 1], toe, ctx);
        if (above.qb < base.qb) {
          base = above;
          baseNote = `embedment ${embedInBase.toFixed(2)} m < ${ctx.minEmbed} m: overlying layer used`;
        }
      }
    }
    const Rb = base.qb * geom.area;
    return {
      toe,
      length: toe - head,
      Rs,
      Rb,
      Rdug: Rs + Rb,
      qb: base.qb,
      baseLayer,
      baseNote,
      shaftByLayer: Array.from(perLayer.values()).map((e) => ({
        name: e.layer.name,
        type: e.layer.type,
        from: e.from,
        to: e.to,
        Rs: e.Rs,
        fsMin: e.fsMin,
        fsMax: e.fsMax,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  function shearModulus(layer) {
    const E = (Number(layer.E) || 0) * 1000;
    const nu = layer.nu != null && layer.nu !== '' ? Number(layer.nu) : 0.3;
    return { G: E / (2 * (1 + nu)), E, nu };
  }

  /**
   * Randolph & Wroth (1978) elastic settlement of a single compressible pile.
   * Returns head settlement (mm) at load P (kN) and the stiffness parameters.
   */
  function randolphWroth(ctx, toe, P) {
    const { geom, profile } = ctx;
    const L = toe - ctx.head;
    if (L <= 0) return { w: Infinity };
    const n = Math.max(1, Math.round(L / DZ));
    const dz = L / n;
    let sumG = 0;
    let sumNu = 0;
    for (let i = 0; i < n; i++) {
      const s = shearModulus(layerAt(profile, ctx.head + (i + 0.5) * dz));
      sumG += s.G;
      sumNu += s.nu;
    }
    const Gavg = sumG / n;
    const nu = sumNu / n;
    const GL = shearModulus(layerAt(profile, toe - EPS * 10)).G;
    const Gb = shearModulus(layerAt(profile, toe + EPS * 10)).G;
    if (!(GL > 0 && Gb > 0 && Gavg > 0)) return { w: NaN };
    const r0 = geom.r0;
    const eta = 1;
    const xi = GL / Gb;
    const rho = Gavg / GL;
    const lambda = geom.Ep / GL;
    const rm = (0.25 + xi * (2.5 * rho * (1 - nu) - 0.25)) * L;
    const zeta = Math.log(Math.max(rm / r0, 1.0001));
    const muL = Math.sqrt(2 / (zeta * lambda)) * (L / r0);
    const th = Math.tanh(muL) / muL;
    const baseTerm = (4 * eta) / ((1 - nu) * xi);
    const num = baseTerm + ((2 * Math.PI * rho) / zeta) * th * (L / r0);
    const den = 1 + (1 / (Math.PI * lambda)) * baseTerm * th * (L / r0);
    const ratio = num / den; // Pt / (wt GL r0)
    const k = ratio * GL * r0; // head stiffness kN/m
    return { w: (P / k) * 1000, stiffness: k, Gavg, GL, Gb, nu, xi, rho, lambda, zeta, muL };
  }

  /**
   * Fleming (1992) hyperbolic load-settlement of a single pile.
   * Us, Ub: ultimate (unfactored) shaft and base resistance (kN).
   */
  function flemingModel(ctx, cap) {
    const { geom, method, profile } = ctx;
    const Us = cap.Rs;
    const Ub = cap.Rb;
    const Ds = geom.Deq;
    const Db = geom.Deq;
    const Eb = shearModulus(layerAt(profile, cap.toe + EPS * 10)).E; // below base, kPa
    const Ms = Number(method.Ms);
    const Ke = Number(method.Ke);
    const L0 = Math.max(0, Math.min(cap.length, ctx.ignoreTop - ctx.head));
    const L1 = cap.length - L0;
    const Ec = geom.Ep;
    const bCoef = Eb > 0 ? (0.6 * Ub) / (Db * Eb) : Infinity;
    const loadAt = (w) => {
      const Ps = Us > 0 ? (Us * w) / (Ms * Ds + w) : 0;
      const Pb = Ub > 0 && Eb > 0 ? (Ub * w) / (bCoef + w) : 0;
      return Ps + Pb;
    };
    const rigid = (P) => {
      if (P <= 0) return 0;
      if (P >= Us + Ub) return Infinity;
      let lo = 0;
      let hi = 1;
      while (loadAt(hi) < P && hi < 1e6) hi *= 2;
      for (let i = 0; i < 100; i++) {
        const mid = 0.5 * (lo + hi);
        if (loadAt(mid) < P) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };
    const elastic = (P) => {
      const c = 4 / (Math.PI * Ds * Ds * Ec);
      if (P <= Us) return c * P * (L0 + Ke * L1);
      return c * (P * (L0 + L1) - L1 * Us * (1 - Ke));
    };
    const settlement = (P) => {
      const wr = rigid(P);
      return wr === Infinity ? Infinity : (wr + elastic(P)) * 1000; // mm
    };
    return { settlement, Us, Ub, Eb, Ms, Ke, L0, L1 };
  }

  function loadSettlementCurve(ctx, cap, points) {
    const fl = flemingModel(ctx, cap);
    const rw = randolphWroth(ctx, cap.toe, 1);
    const N = points || 40;
    const Pult = cap.Rdug;
    const out = [];
    for (let i = 0; i <= N; i++) {
      const P = (Pult * 0.98 * i) / N;
      out.push({ P, fleming: fl.settlement(P), rw: rw.w * P });
    }
    return out;
  }

  function settlementAt(ctx, cap, P, method) {
    const rw = randolphWroth(ctx, cap.toe, P);
    const fl = flemingModel(ctx, cap).settlement(P);
    let gov;
    if (method === 'rw') gov = rw.w;
    else if (method === 'fleming') gov = fl;
    else gov = Math.max(isNaN(rw.w) ? 0 : rw.w, fl);
    return { rw: rw.w, fleming: fl, governing: gov, rwDetail: rw };
  }

  // ---------------------------------------------------------------------------
  // Design: search for the minimum pile length
  // ---------------------------------------------------------------------------

  function design(input) {
    const warnings = [];
    const ctx = makeContext(input);
    const { profile, geom } = ctx;
    if (!profile.length) return { error: 'Define at least one soil layer.' };
    if (!(geom.D > 0)) return { error: 'Pile diameter/width must be greater than zero.' };
    if (!(geom.Ep > 0)) return { error: "Pile Young's modulus must be greater than zero." };

    const phi = geotechnicalReductionFactor(input.reduction || {});
    const loads = designLoads(input.loads || {});
    const sLimit = Number(input.settlementLimit) || Infinity;
    const sMethod = input.settlementMethod || 'max';

    const profileBottom = profile[profile.length - 1].bottom;
    const maxToe = Math.min(Number(input.pile.maxToe) || profileBottom, profileBottom);
    const minLen = Math.max(Number(input.pile.minLength) || 0, DZ);
    const startToe = ctx.head + minLen;
    if (startToe > maxToe) return { error: 'Minimum pile length extends below the maximum toe depth / base of soil profile.' };

    const rows = [];
    let reqULS = null;
    let reqSLS = null;
    let req = null;
    const steps = Math.round((maxToe - startToe) / DZ);
    for (let i = 0; i <= steps; i++) {
      const toe = Math.round((startToe + i * DZ) * 1000) / 1000;
      const cap = capacityAt(ctx, toe);
      const Rdg = phi.phiG * cap.Rdug;
      const st = settlementAt(ctx, cap, loads.sls, sMethod);
      const okULS = Rdg >= loads.uls;
      const okSLS = st.governing <= sLimit;
      rows.push({ toe, length: cap.length, Rs: cap.Rs, Rb: cap.Rb, Rdug: cap.Rdug, Rdg, settlement: st.governing, rw: st.rw, fleming: st.fleming, okULS, okSLS });
      if (okULS && reqULS === null) reqULS = toe;
      if (okSLS && reqSLS === null) reqSLS = toe;
      if (okULS && okSLS && req === null) req = toe;
      if (input.fast && req !== null) break;
    }

    let detail = null;
    if (req !== null) {
      const cap = capacityAt(ctx, req);
      const st = settlementAt(ctx, cap, loads.sls, sMethod);
      detail = {
        ...cap,
        Rdg: phi.phiG * cap.Rdug,
        utilisation: loads.uls / (phi.phiG * cap.Rdug),
        settlement: st,
        curve: loadSettlementCurve(ctx, cap, 50),
        governedBy: reqULS !== null && reqSLS !== null ? (reqULS >= reqSLS ? 'Geotechnical strength (ULS)' : 'Settlement (SLS)') : '',
      };
      // Check for weaker layer within 3 diameters below the toe (punching)
      const below = profile.filter((l) => l.top > req - EPS && l.top < req + 3 * geom.Deq);
      for (const l of below) {
        const qbBelow = unitBase(l, l.top, ctx).qb;
        if (qbBelow < cap.qb * 0.8) {
          warnings.push(`Weaker layer "${l.name || l.type}" starts ${(l.top - req).toFixed(2)} m below the toe (< 3D). Check punching / reduced base resistance and consider founding deeper.`);
        }
      }
      if (cap.baseLayer.type === 'rock' && geom && (input.pile.type === 'precast' || input.pile.type === 'steelTube')) {
        warnings.push('Rock socket shaft/base correlations are intended for bored (drilled) piles. Review driveability and toe resistance for driven piles on rock.');
      }
      if (req >= maxToe - EPS) warnings.push('Required toe is at the maximum toe depth / base of the soil profile - extend the investigation.');
    } else {
      warnings.push('No pile length within the soil profile satisfies both geotechnical strength (ULS) and settlement (SLS). Increase diameter, extend the profile or revise parameters.');
    }
    if (loads.sls > 0 && detail && loads.sls > detail.Rdug * 0.7) {
      warnings.push('Serviceability load exceeds 70% of the ultimate geotechnical strength - settlement predictions are sensitive to non-linear behaviour.');
    }
    if (phi.override) warnings.push('Geotechnical strength reduction factor φg has been manually overridden. Justify in accordance with AS 2159 Cl. 4.3.');
    // Unit resistance profile with depth (for the pile / ground profile graphic)
    const shaftStart = Math.max(ctx.head, ctx.ignoreTop);
    const zs = new Set();
    for (let z = 0; z <= profileBottom + EPS; z += 0.1) zs.add(Math.round(z * 1000) / 1000);
    for (const l of profile) {
      if (l.top > 0) zs.add(l.top - 1e-4);
      zs.add(l.top + 1e-4);
    }
    const unitProfile = input.fast ? [] : Array.from(zs)
      .filter((z) => z >= 0 && z <= profileBottom)
      .sort((a, b) => a - b)
      .map((z) => {
        const layer = layerAt(profile, z);
        ctx.embedLength = Math.max(z, DZ);
        const sh = unitShaft(layer, z, ctx);
        return { z, fs: sh.fs, sv: sh.sv, qb: unitBase(layer, z, ctx).qb, onShaft: z >= shaftStart };
      });

    return {
      phi,
      loads,
      geom,
      unitProfile,
      shaftStart,
      head: ctx.head,
      method: ctx.method,
      settlementLimit: sLimit,
      settlementMethod: sMethod,
      required: req,
      requiredULS: reqULS,
      requiredSLS: reqSLS,
      requiredLength: req !== null ? req - ctx.head : null,
      detail,
      rows,
      warnings,
      profile,
    };
  }

  return {
    GAMMA_W,
    RISK_FACTORS,
    RISK_LEVELS,
    PHI_GB_TABLE,
    PILE_TYPES,
    averageRiskRating,
    phiGb,
    geotechnicalReductionFactor,
    designLoads,
    geometry,
    buildProfile,
    sigmaV,
    apiAlpha,
    makeContext,
    capacityAt,
    randolphWroth,
    flemingModel,
    settlementAt,
    loadSettlementCurve,
    design,
  };
});
