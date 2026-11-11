/*
 * 3D ground model queries for automated pile design.
 *
 *   - Spatial index over triangulated volumes (Leapfrog DXF exports)
 *   - Vertical ray / mesh intersection -> 1D stratigraphic column at any (x, y)
 *   - Groundwater RL from a triangulated surface or scattered points (IDW)
 *   - Point-in-polygon zone lookup and convex hulls for plan display
 *   - Per-pile conversion to a PileCalc design input and batch design
 *
 * Coordinates: x = easting, y = northing, z = RL (m). Depths are positive down.
 * Works in the browser (global `GeoModel`) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory(root.PileCalc || (typeof require === 'function' ? require('./calc.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeoModel = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const EPS = 1e-6;

  // ---------------------------------------------------------------------------
  // Spatial index (uniform grid over triangle XY bounding boxes)
  // ---------------------------------------------------------------------------

  function buildIndex(tris) {
    const nt = tris.length / 9;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1], z = tris[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const n = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(nt / 4))));
    const w = Math.max(x1 - x0, EPS), h = Math.max(y1 - y0, EPS);
    const nx = n, ny = n;
    const cw = w / nx, ch = h / ny;
    const cellOf = (x, y) => [Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cw))), Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / ch)))];
    // two passes: count then fill (CSR)
    const counts = new Int32Array(nx * ny + 1);
    const ranges = new Int32Array(nt * 4);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ax = Math.min(tris[o], tris[o + 3], tris[o + 6]);
      const bx = Math.max(tris[o], tris[o + 3], tris[o + 6]);
      const ay = Math.min(tris[o + 1], tris[o + 4], tris[o + 7]);
      const by = Math.max(tris[o + 1], tris[o + 4], tris[o + 7]);
      const [i0, j0] = cellOf(ax, ay);
      const [i1, j1] = cellOf(bx, by);
      ranges.set([i0, j0, i1, j1], t * 4);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * nx + i + 1]++;
    }
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const fill = counts.slice(0, nx * ny);
    const list = new Int32Array(counts[nx * ny]);
    for (let t = 0; t < nt; t++) {
      const [i0, j0, i1, j1] = ranges.subarray(t * 4, t * 4 + 4);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) list[fill[j * nx + i]++] = t;
    }
    return { tris, nt, bbox: [x0, y0, z0, x1, y1, z1], nx, ny, x0, y0, cw, ch, offsets: counts, list };
  }

  /** All z values where the vertical line through (x, y) crosses the mesh, sorted high to low, de-duplicated. */
  function rayZ(index, x, y) {
    const { bbox, tris } = index;
    if (x < bbox[0] - EPS || x > bbox[3] + EPS || y < bbox[1] - EPS || y > bbox[4] + EPS) return [];
    const i = Math.min(index.nx - 1, Math.max(0, Math.floor((x - index.x0) / index.cw)));
    const j = Math.min(index.ny - 1, Math.max(0, Math.floor((y - index.y0) / index.ch)));
    const c = j * index.nx + i;
    const zs = [];
    for (let k = index.offsets[c]; k < index.offsets[c + 1]; k++) {
      const o = index.list[k] * 9;
      const xa = tris[o], ya = tris[o + 1], xb = tris[o + 3], yb = tris[o + 4], xc = tris[o + 6], yc = tris[o + 7];
      const d = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc);
      if (Math.abs(d) < 1e-12) continue; // vertical triangle
      const a = ((yb - yc) * (x - xc) + (xc - xb) * (y - yc)) / d;
      const b = ((yc - ya) * (x - xc) + (xa - xc) * (y - yc)) / d;
      const g = 1 - a - b;
      const tol = -1e-9;
      if (a >= tol && b >= tol && g >= tol) zs.push(a * tris[o + 2] + b * tris[o + 5] + g * tris[o + 8]);
    }
    zs.sort((p, q) => q - p);
    const out = [];
    for (const z of zs) if (!out.length || Math.abs(out[out.length - 1] - z) > 1e-4) out.push(z);
    return out;
  }

  /** Intervals [ztop, zbot] where the vertical line is inside a closed volume. */
  function volumeIntervals(index, x, y) {
    const zs = rayZ(index, x, y);
    const iv = [];
    for (let k = 0; k + 1 < zs.length; k += 2) iv.push([zs[k], zs[k + 1]]);
    return { intervals: iv, odd: zs.length % 2 === 1 };
  }

  /**
   * Stratigraphic column at (x, y) from a list of volumes { id, name, index }.
   * Returns segments ordered top-down with no gaps or overlaps.
   */
  function columnAt(volumes, x, y, opts = {}) {
    const gapTol = opts.gapTol != null ? opts.gapTol : 0.05;
    const raw = [];
    const warnings = [];
    for (const v of volumes) {
      if (!v.index) continue;
      const r = volumeIntervals(v.index, x, y);
      if (r.odd) warnings.push(`Volume "${v.name}" is not closed at this location (odd number of surface crossings).`);
      r.intervals.forEach(([zt, zb]) => raw.push({ ztop: zt, zbot: zb, vol: v }));
    }
    if (!raw.length) return { segments: [], zTop: null, zBot: null, warnings };
    raw.sort((a, b) => b.ztop - a.ztop);
    const segs = [];
    let cur = raw[0].ztop;
    for (const s of raw) {
      if (s.zbot >= cur - EPS) continue; // fully overlapped by a higher segment
      if (s.ztop < cur - EPS) {
        const gap = cur - s.ztop;
        if (segs.length) {
          segs[segs.length - 1].zbot = s.ztop; // extend the layer above into the gap
          if (gap > gapTol) warnings.push(`Gap of ${gap.toFixed(2)} m in the model below "${segs[segs.length - 1].vol.name}" – filled with that unit.`);
        }
        cur = s.ztop;
      }
      const top = Math.min(cur, s.ztop);
      const last = segs[segs.length - 1];
      if (last && last.vol === s.vol) last.zbot = s.zbot;
      else segs.push({ ztop: top, zbot: s.zbot, vol: s.vol });
      cur = s.zbot;
    }
    return { segments: segs, zTop: segs[0].ztop, zBot: segs[segs.length - 1].zbot, warnings };
  }

  // ---------------------------------------------------------------------------
  // Groundwater
  // ---------------------------------------------------------------------------

  /** Groundwater RL function from a mesh index or [x,y,z,...] points. */
  function groundwaterModel(gw) {
    if (!gw) return () => null;
    if (gw.kind === 'rl') {
      const rl = Number(gw.rl);
      return () => (isFinite(rl) && gw.rl !== '' ? rl : null);
    }
    if (gw.kind === 'mesh' && gw.index) {
      return (x, y) => {
        const zs = rayZ(gw.index, x, y);
        return zs.length ? zs[0] : null;
      };
    }
    if (gw.kind === 'points' && gw.points && gw.points.length >= 3) {
      const P = gw.points;
      const n = P.length / 3;
      const kNear = Math.min(8, n);
      return (x, y) => {
        const best = [];
        for (let i = 0; i < n; i++) {
          const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1e-8) return P[i * 3 + 2];
          if (best.length < kNear || d2 < best[best.length - 1][0]) {
            best.push([d2, P[i * 3 + 2]]);
            best.sort((a, b) => a[0] - b[0]);
            if (best.length > kNear) best.pop();
          }
        }
        let sw = 0, sz = 0;
        for (const [d2, z] of best) {
          const w = 1 / d2;
          sw += w;
          sz += w * z;
        }
        return sz / sw;
      };
    }
    return () => null;
  }

  // ---------------------------------------------------------------------------
  // Plan geometry
  // ---------------------------------------------------------------------------

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** Even-odd test across all rings (outer rings and holes). */
  function pointInPolygon(x, y, rings) {
    let inside = false;
    for (const r of rings) if (pointInRing(x, y, r)) inside = !inside;
    return inside;
  }

  /** Monotone chain convex hull of [[x,y],...]. */
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }
  /** Hull of a flat xyz array, sub-sampled for large meshes. */
  function hullOfXYZ(arr, maxPts = 60000) {
    const n = arr.length / 3;
    const step = Math.max(1, Math.floor(n / maxPts));
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push([arr[i * 3], arr[i * 3 + 1]]);
    return convexHull(pts);
  }

  // ---------------------------------------------------------------------------
  // Per-pile design
  // ---------------------------------------------------------------------------

  /** Which design case applies at (x, y): the last zone containing the point, else the default. */
  function caseAt(x, y, zones, defaultCaseId) {
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (z.rings && z.rings.length && pointInPolygon(x, y, z.rings)) return { caseId: z.caseId, zone: z };
    }
    return { caseId: defaultCaseId, zone: null };
  }

  /**
   * Convert a pile location, its stratigraphic column, design case and groundwater into a PileCalc input.
   * pile: { id, x, y, z, G?, Q? }   column: from columnAt()   dcase: design case
   */
  function pileInput(pile, column, dcase, gwRL, materials) {
    const zc = Number(pile.z);
    const zTop = column.zTop;
    const zRef = Math.max(zc, zTop);
    const layers = [];
    const matOf = (vol) => materials[vol.id] || {};
    if (zc > zTop + 0.01) {
      const m0 = matOf(column.segments[0].vol);
      layers.push({ name: 'Above model', type: 'user', bottom: zRef - zTop, gamma: 0, fsUser: 0, qbUser: 0, E: m0.E, nu: m0.nu, pattern: 'none', color: '#ffffff' });
    }
    for (const s of column.segments) {
      const m = matOf(s.vol);
      layers.push({ ...m, name: s.vol.name, bottom: zRef - s.zbot });
    }
    const head = zRef - zc;
    const maxLen = Number(dcase.maxLength) > 0 ? Number(dcase.maxLength) : null;
    const input = {
      pile: {
        type: dcase.pileType,
        shape: dcase.shape,
        D: Number(dcase.D),
        Ep: Number(dcase.Ep),
        wall: Number(dcase.wall) || 0,
        head,
        ignoreTop: head + (Number(dcase.ignoreTop) || 0),
        minLength: Number(dcase.minLength) || 0,
        minEmbed: Number(dcase.minEmbed) || 0,
        maxToe: maxLen ? head + maxLen : '',
      },
      loads: {
        G: pile.G !== undefined && pile.G !== '' && pile.G !== null && isFinite(pile.G) ? Number(pile.G) : Number(dcase.G),
        Q: pile.Q !== undefined && pile.Q !== '' && pile.Q !== null && isFinite(pile.Q) ? Number(pile.Q) : Number(dcase.Q),
        psiS: Number(dcase.psiS),
      },
      reduction: { override: Number(dcase.phiG) },
      gwl: gwRL == null ? null : Math.max(0, zRef - gwRL),
      settlementLimit: Number(dcase.settlementLimit) || Infinity,
      settlementMethod: dcase.settlementMethod || 'max',
      method: { ...(C ? methodDefaults(dcase.pileType) : {}) },
      layers,
    };
    return { input, zRef, head };
  }

  function methodDefaults(type) {
    const t = C.PILE_TYPES[type] || C.PILE_TYPES.bored;
    return { KK0: t.KK0, deltaPhi: t.deltaPhi, alphaMethod: t.alphaMethod, alpha: t.alpha, Nc: 9, rockShaftA: 0.45, Ms: 0.0015, Ke: 0.5 };
  }

  /**
   * Design one pile. model: { volumes:[{id,name,index}], materials:{volId: material}, gwAt(x,y), cases:{id: case}, zones, defaultCaseId }
   */
  function designPile(pile, model) {
    const x = Number(pile.x), y = Number(pile.y), zc = Number(pile.z);
    const { caseId, zone } = caseAt(x, y, model.zones || [], model.defaultCaseId);
    const dcase = model.cases[caseId] || model.cases[model.defaultCaseId];
    const base = { id: pile.id, x, y, z: zc, caseId: dcase ? dcase.id : null, caseName: dcase ? dcase.name : '', zoneName: zone ? zone.name : '', D: dcase ? Number(dcase.D) : null };
    if (!dcase) return { ...base, status: 'error', message: 'No design case defined.' };
    if (![x, y, zc].every(isFinite)) return { ...base, status: 'error', message: 'Invalid coordinates.' };
    const column = columnAt(model.volumes, x, y);
    if (!column.segments.length) return { ...base, status: 'outside', message: 'Pile is outside the ground model.' };
    if (zc < column.zBot) return { ...base, status: 'outside', message: 'Collar is below the base of the ground model.' };
    const gwRL = model.gwAt ? model.gwAt(x, y) : null;
    const { input, zRef, head } = pileInput(pile, column, dcase, gwRL, model.materials);
    input.fast = true;
    let res;
    try {
      res = C.design(input);
    } catch (e) {
      return { ...base, status: 'error', message: e.message };
    }
    const common = {
      ...base,
      zGround: column.zTop,
      zModelBase: column.zBot,
      gwRL,
      head,
      zRef,
      Ed: res.loads ? res.loads.uls : null,
      Psls: res.loads ? res.loads.sls : null,
      phiG: res.phi ? res.phi.phiG : null,
      column: column.segments.map((s) => ({ name: s.vol.name, volId: s.vol.id, ztop: s.ztop, zbot: s.zbot })),
      warnings: column.warnings.concat((res.warnings || []).filter((w) => !/manually overridden/.test(w))),
    };
    if (res.error) return { ...common, status: 'error', message: res.error };
    if (res.required === null) return { ...common, status: 'nosolution', message: 'No length within the model satisfies ULS and SLS.' };
    const d = res.detail;
    return {
      ...common,
      status: 'ok',
      length: res.requiredLength,
      toeRL: zRef - res.required,
      toeDepth: res.required,
      Rs: d.Rs,
      Rb: d.Rb,
      Rdug: d.Rdug,
      Rdg: d.Rdg,
      utilisation: d.utilisation,
      settlement: d.settlement.governing,
      governedBy: d.governedBy,
      baseLayer: d.baseLayer ? d.baseLayer.name : '',
    };
  }

  return { buildIndex, rayZ, volumeIntervals, columnAt, groundwaterModel, pointInPolygon, convexHull, hullOfXYZ, caseAt, pileInput, designPile, methodDefaults };
});
