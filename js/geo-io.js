/*
 * File readers for the automated pile design tab.
 *   - DXF triangulated meshes (Leapfrog Geo volume / surface exports): 3DFACE and
 *     POLYLINE polyface meshes, grouped by DXF layer
 *   - CSV / delimited text with header detection
 *   - ESRI shapefile (.shp + .dbf), directly or inside a .zip
 * Works in the browser (global `GeoIO`) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeoIO = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // DXF
  // ---------------------------------------------------------------------------

  /**
   * Parse an ASCII DXF and return triangles grouped by layer.
   * @returns {{ layers: Object<string, Float64Array>, counts: Object, skipped: Object }}
   *   Each layer's array is flat [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] per triangle.
   */
  function parseDXF(text) {
    if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error('Binary DXF is not supported – export as ASCII DXF.');
    const lines = text.split(/\r\n|\r|\n/);
    const n = lines.length - 1;
    const layers = new Map();
    const skipped = {};
    const counts = { faces: 0, polyfaces: 0 };
    const out = (name) => {
      let a = layers.get(name);
      if (!a) layers.set(name, (a = []));
      return a;
    };

    // Read group code / value pairs from the ENTITIES and BLOCKS sections
    let i = 0;
    const pairs = [];
    let inSection = false;
    let sectionName = '';
    while (i < n) {
      const code = parseInt(lines[i], 10);
      const val = lines[i + 1] !== undefined ? lines[i + 1].trim() : '';
      i += 2;
      if (code === 0 && val === 'SECTION') {
        inSection = true;
        sectionName = '';
        continue;
      }
      if (inSection && code === 2 && !sectionName) {
        sectionName = val;
        continue;
      }
      if (code === 0 && val === 'ENDSEC') {
        inSection = false;
        sectionName = '';
        continue;
      }
      if (code === 0 && val === 'EOF') break;
      if (sectionName === 'ENTITIES') pairs.push(code, val);
    }

    // Group into entities
    const ents = [];
    let cur = null;
    for (let k = 0; k < pairs.length; k += 2) {
      const code = pairs[k];
      const val = pairs[k + 1];
      if (code === 0) {
        cur = { type: val, g: [] };
        ents.push(cur);
      } else if (cur) cur.g.push(code, val);
    }
    const get = (e, c, def) => {
      for (let k = 0; k < e.g.length; k += 2) if (e.g[k] === c) return e.g[k + 1];
      return def;
    };
    const num = (e, c, def = 0) => {
      const v = get(e, c);
      return v === undefined ? def : parseFloat(v);
    };

    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (e.type === '3DFACE') {
        const layer = get(e, 8, '0');
        const v = [0, 1, 2, 3].map((j) => [num(e, 10 + j), num(e, 20 + j), num(e, 30 + j)]);
        const a = out(layer);
        a.push(...v[0], ...v[1], ...v[2]);
        counts.faces++;
        const same = v[3][0] === v[2][0] && v[3][1] === v[2][1] && v[3][2] === v[2][2];
        if (!same) {
          a.push(...v[0], ...v[2], ...v[3]);
          counts.faces++;
        }
      } else if (e.type === 'POLYLINE') {
        const flags = parseInt(get(e, 70, '0'), 10) || 0;
        const layer = get(e, 8, '0');
        const verts = [];
        const faces = [];
        let j = k + 1;
        for (; j < ents.length && ents[j].type === 'VERTEX'; j++) {
          const v = ents[j];
          const vf = parseInt(get(v, 70, '0'), 10) || 0;
          if (vf & 128 && !(vf & 64)) {
            const idx = [71, 72, 73, 74].map((c) => Math.abs(parseInt(get(v, c, '0'), 10) || 0)).filter((x) => x > 0);
            faces.push(idx);
          } else verts.push([num(v, 10), num(v, 20), num(v, 30)]);
        }
        if (j < ents.length && ents[j].type === 'SEQEND') j++;
        k = j - 1;
        if (flags & 64) {
          counts.polyfaces++;
          const a = out(layer);
          for (const f of faces) {
            for (let t = 1; t + 1 < f.length; t++) {
              const p = [f[0], f[t], f[t + 1]].map((x) => verts[x - 1]);
              if (p.every(Boolean)) {
                a.push(...p[0], ...p[1], ...p[2]);
                counts.faces++;
              }
            }
          }
        } else if (flags & 16) {
          skipped['POLYLINE (polygon mesh)'] = (skipped['POLYLINE (polygon mesh)'] || 0) + 1;
        }
      } else if (e.type === 'MESH' || e.type === 'POLYFACE' || e.type === 'SURFACE' || e.type === '3DSOLID') {
        skipped[e.type] = (skipped[e.type] || 0) + 1;
      }
    }
    const res = {};
    layers.forEach((a, name) => {
      if (a.length) res[name] = Float64Array.from(a);
    });
    return { layers: res, counts, skipped };
  }

  function bboxOf(arr) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] < b[0]) b[0] = arr[i];
      if (arr[i + 1] < b[1]) b[1] = arr[i + 1];
      if (arr[i + 2] < b[2]) b[2] = arr[i + 2];
      if (arr[i] > b[3]) b[3] = arr[i];
      if (arr[i + 1] > b[4]) b[4] = arr[i + 1];
      if (arr[i + 2] > b[5]) b[5] = arr[i + 2];
    }
    return b;
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const delims = [',', ';', '\t', '|'];
    const delim = delims.reduce((a, d) => (first.split(d).length > first.split(a).length ? d : a), ',');
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (!rows.length) return { headers: [], rows: [] };
    const isNum = (s) => s.trim() !== '' && isFinite(Number(s));
    const hasHeader = rows[0].some((c) => !isNum(c));
    const headers = hasHeader ? rows[0].map((h, i) => h.trim() || `col${i + 1}`) : rows[0].map((_, i) => `col${i + 1}`);
    const body = (hasHeader ? rows.slice(1) : rows).map((r) => {
      const o = {};
      headers.forEach((h, i) => (o[h] = r[i] !== undefined ? r[i].trim() : ''));
      return o;
    });
    return { headers, rows: body };
  }

  /** Guess which columns hold the id, x, y, z (and optional loads). */
  function guessColumns(headers) {
    const find = (res) => {
      for (const re of res) {
        const h = headers.find((x) => re.test(x.trim()));
        if (h) return h;
      }
      return '';
    };
    return {
      id: find([/^(id|name|pile|pile.?id|pile.?no|point|pt|label|hole.?id)$/i, /id$|name|pile/i]),
      x: find([/^(x|east|easting|e|mge|x_coord|xcoord|longitude|lon)$/i, /^x|east/i]),
      y: find([/^(y|north|northing|n|mgn|y_coord|ycoord|latitude|lat)$/i, /^y|north/i]),
      z: find([/^(z|rl|elev|elevation|collar|collar.?rl|top|top.?rl|cut.?off|cutoff|cot|z_coord|height)$/i, /rl|elev|^z|collar|cut.?off/i]),
      G: find([/^(g|dead|permanent|g_kn|g.?load)$/i]),
      Q: find([/^(q|live|imposed|q_kn|q.?load)$/i]),
    };
  }

  // ---------------------------------------------------------------------------
  // ZIP (stored and deflate) – for zipped shapefiles
  // ---------------------------------------------------------------------------

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files – upload the .shp and .dbf files directly.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a valid zip file.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = dv.getUint16(lho + 26, true);
      const lxlen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen;
      const data = u8.subarray(start, start + csize);
      if (method === 0) files[name] = data.slice();
      else if (method === 8) files[name] = await inflateRaw(data);
      else throw new Error(`Unsupported zip compression (method ${method}) for ${name}.`);
    }
    return files;
  }

  // ---------------------------------------------------------------------------
  // Shapefile
  // ---------------------------------------------------------------------------

  const toBuf = (x) => (x instanceof ArrayBuffer ? x : x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength));

  function parseDBF(buffer) {
    const dv = new DataView(toBuf(buffer));
    const nrec = dv.getUint32(4, true);
    const hlen = dv.getUint16(8, true);
    const rlen = dv.getUint16(10, true);
    const fields = [];
    const dec = new TextDecoder('latin1');
    const u8 = new Uint8Array(dv.buffer);
    for (let p = 32; p < hlen - 1 && u8[p] !== 0x0d; p += 32) {
      const name = dec.decode(u8.subarray(p, p + 11)).replace(/\0.*$/, '').trim();
      fields.push({ name, type: String.fromCharCode(u8[p + 11]), len: u8[p + 16], dec: u8[p + 17] });
    }
    const recs = [];
    for (let r = 0; r < nrec; r++) {
      let p = hlen + r * rlen;
      if (p + rlen > u8.length) break;
      const deleted = u8[p] === 0x2a;
      p += 1;
      const o = {};
      for (const f of fields) {
        const raw = dec.decode(u8.subarray(p, p + f.len)).trim();
        p += f.len;
        o[f.name] = 'NFO'.includes(f.type) ? (raw === '' ? null : Number(raw)) : raw;
      }
      if (!deleted) recs.push(o);
      else recs.push(null);
    }
    return { fields, records: recs };
  }

  const SHP_TYPES = { 0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint', 11: 'PointZ', 13: 'PolyLineZ', 15: 'PolygonZ', 18: 'MultiPointZ', 21: 'PointM', 23: 'PolyLineM', 25: 'PolygonM', 28: 'MultiPointM' };

  /**
   * Parse a .shp (and optional .dbf) into features.
   * Points: { kind: 'point', coords: [x, y, z|null] }
   * Polygons: { kind: 'polygon', rings: [[[x,y],...], ...] }
   */
  function parseShapefile(shpBuf, dbfBuf) {
    const buf = toBuf(shpBuf);
    const dv = new DataView(buf);
    if (dv.getInt32(0, false) !== 9994) throw new Error('Not a valid .shp file.');
    const fileLen = dv.getInt32(24, false) * 2;
    const shapeType = dv.getInt32(32, true);
    const dbf = dbfBuf ? parseDBF(dbfBuf) : null;
    const features = [];
    let p = 100;
    let rec = 0;
    while (p + 8 <= Math.min(fileLen, buf.byteLength)) {
      const clen = dv.getInt32(p + 4, false) * 2;
      const c = p + 8;
      const t = dv.getInt32(c, true);
      const props = dbf && dbf.records[rec] ? dbf.records[rec] : {};
      if (t === 1 || t === 11 || t === 21) {
        const x = dv.getFloat64(c + 4, true);
        const y = dv.getFloat64(c + 12, true);
        const z = t === 11 ? dv.getFloat64(c + 20, true) : null;
        features.push({ kind: 'point', coords: [x, y, z], props });
      } else if (t === 8 || t === 18 || t === 28) {
        const np = dv.getInt32(c + 36, true);
        const zo = c + 40 + np * 16 + 16;
        for (let k = 0; k < np; k++) {
          const x = dv.getFloat64(c + 40 + k * 16, true);
          const y = dv.getFloat64(c + 48 + k * 16, true);
          const z = t === 18 ? dv.getFloat64(zo + k * 8, true) : null;
          features.push({ kind: 'point', coords: [x, y, z], props });
        }
      } else if ([3, 5, 13, 15, 23, 25].includes(t)) {
        const nparts = dv.getInt32(c + 36, true);
        const npts = dv.getInt32(c + 40, true);
        const parts = [];
        for (let k = 0; k < nparts; k++) parts.push(dv.getInt32(c + 44 + k * 4, true));
        const p0 = c + 44 + nparts * 4;
        const rings = [];
        for (let k = 0; k < nparts; k++) {
          const s = parts[k];
          const e = k + 1 < nparts ? parts[k + 1] : npts;
          const ring = [];
          for (let m = s; m < e; m++) ring.push([dv.getFloat64(p0 + m * 16, true), dv.getFloat64(p0 + m * 16 + 8, true)]);
          rings.push(ring);
        }
        features.push({ kind: [5, 15, 25].includes(t) ? 'polygon' : 'polyline', rings, props });
      }
      p = c + clen;
      rec++;
    }
    return { shapeType: SHP_TYPES[shapeType] || String(shapeType), fields: dbf ? dbf.fields : [], features };
  }

  /**
   * Read a shapefile from a list of {name, buffer} (zip, or .shp/.dbf files).
   */
  async function readShapefileFiles(files) {
    let shp = null;
    let dbf = null;
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        const z = await readZip(f.buffer);
        const names = Object.keys(z);
        const s = names.find((n) => n.toLowerCase().endsWith('.shp'));
        if (!s) throw new Error('No .shp file found in the zip.');
        const base = s.slice(0, -4).toLowerCase();
        const d = names.find((n) => n.toLowerCase() === base + '.dbf') || names.find((n) => n.toLowerCase().endsWith('.dbf'));
        shp = z[s];
        dbf = d ? z[d] : null;
      } else if (lower.endsWith('.shp')) shp = f.buffer;
      else if (lower.endsWith('.dbf')) dbf = f.buffer;
    }
    if (!shp) throw new Error('Select a zipped shapefile, or the .shp file (with its .dbf for attributes).');
    return parseShapefile(shp, dbf);
  }

  return { parseDXF, bboxOf, parseCSV, guessColumns, readZip, parseDBF, parseShapefile, readShapefileFiles };
});
