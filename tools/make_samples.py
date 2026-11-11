"""Generate sample data for the Automated calculation tab.

Writes to samples/:
  ground_model.dxf    four closed volumes (Fill, Clay, Sand as 3DFACE; Rock as a polyface mesh)
  collars.csv         pile collar points (id, easting, northing, RL, optional G/Q)
  groundwater.csv     scattered groundwater RL points
  groundwater.dxf     triangulated groundwater surface
  zones.zip           zipped shapefile with two design-case polygons
Run:  python3 tools/make_samples.py
"""
import math, os, struct, zipfile, io

E0, N0 = 330000.0, 6250000.0
W, H, STEP = 200.0, 150.0, 10.0
OUT = os.path.join(os.path.dirname(__file__), '..', 'samples')

def s0(x, y): return 20 + 1.5 * math.sin(x / 60) + 0.01 * y
def s1(x, y): return s0(x, y) - 1.5
def s2(x, y): return s0(x, y) - 6 - 2 * (x / W)
def s3(x, y): return s2(x, y) - 5 + 1.5 * math.cos(y / 40)
def s4(x, y): return s0(x, y) - 30
def gw(x, y): return s0(x, y) - 3 - 0.01 * x

nx, ny = int(W / STEP), int(H / STEP)
xs = [i * STEP for i in range(nx + 1)]
ys = [j * STEP for j in range(ny + 1)]

def surface_tris(f, flip=False):
    t = []
    for i in range(nx):
        for j in range(ny):
            a = (xs[i], ys[j]); b = (xs[i + 1], ys[j]); c = (xs[i + 1], ys[j + 1]); d = (xs[i], ys[j + 1])
            for tri in ((a, b, c), (a, c, d)):
                p = [(x, y, f(x, y)) for x, y in tri]
                t.append(p[::-1] if flip else p)
    return t

def wall_tris(ftop, fbot):
    t = []
    edge = [(x, 0.0) for x in xs] + [(W, y) for y in ys[1:]] + [(x, H) for x in reversed(xs[:-1])] + [(0.0, y) for y in reversed(ys[1:-1])] + [(0.0, 0.0)]
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        a, b = (xa, ya, ftop(xa, ya)), (xb, yb, ftop(xb, yb))
        c, d = (xb, yb, fbot(xb, yb)), (xa, ya, fbot(xa, ya))
        t += [(a, b, c), (a, c, d)]
    return t

def volume(ftop, fbot):
    return surface_tris(ftop) + surface_tris(fbot, flip=True) + wall_tris(ftop, fbot)

def w(f, code, val): f.write(f"{code}\n{val}\n")

def face3d(f, layer, tri):
    w(f, 0, '3DFACE'); w(f, 8, layer)
    pts = list(tri) + [tri[2]]
    for k, (x, y, z) in enumerate(pts):
        w(f, 10 + k, f"{x + E0:.3f}"); w(f, 20 + k, f"{y + N0:.3f}"); w(f, 30 + k, f"{z:.3f}")

def polyface(f, layer, tris):
    verts, idx, faces = [], {}, []
    for tri in tris:
        fi = []
        for p in tri:
            key = tuple(round(c, 4) for c in p)
            if key not in idx:
                idx[key] = len(verts) + 1; verts.append(p)
            fi.append(idx[key])
        faces.append(fi)
    w(f, 0, 'POLYLINE'); w(f, 8, layer); w(f, 66, 1); w(f, 70, 64); w(f, 71, len(verts)); w(f, 72, len(faces))
    for x, y, z in verts:
        w(f, 0, 'VERTEX'); w(f, 8, layer); w(f, 10, f"{x + E0:.3f}"); w(f, 20, f"{y + N0:.3f}"); w(f, 30, f"{z:.3f}"); w(f, 70, 192)
    for a, b, c in faces:
        w(f, 0, 'VERTEX'); w(f, 8, layer); w(f, 10, 0); w(f, 20, 0); w(f, 30, 0); w(f, 70, 128); w(f, 71, a); w(f, 72, b); w(f, 73, c)
    w(f, 0, 'SEQEND'); w(f, 8, layer)

def dxf(path, body):
    with open(path, 'w') as f:
        w(f, 0, 'SECTION'); w(f, 2, 'HEADER'); w(f, 0, 'ENDSEC')
        w(f, 0, 'SECTION'); w(f, 2, 'ENTITIES')
        body(f)
        w(f, 0, 'ENDSEC'); w(f, 0, 'EOF')

def ground(f):
    for name, a, b in (('Fill', s0, s1), ('Clay', s1, s2), ('Sand', s2, s3)):
        for tri in volume(a, b): face3d(f, name, tri)
    polyface(f, 'Rock', volume(s3, s4))

dxf(os.path.join(OUT, 'ground_model.dxf'), ground)
dxf(os.path.join(OUT, 'groundwater.dxf'), lambda f: [face3d(f, 'Groundwater', t) for t in surface_tris(gw)])

with open(os.path.join(OUT, 'collars.csv'), 'w') as f:
    f.write('Pile_ID,Easting,Northing,RL,G,Q\n')
    k = 0
    for j, y in enumerate(range(15, 150, 20)):
        for i, x in enumerate(range(10, 200, 15)):
            k += 1
            g, q = ('', '') if (i + j) % 3 else (900 + 40 * i, 300 + 10 * j)
            f.write(f"P{k:03d},{x + E0:.2f},{y + N0:.2f},{s0(x, y) - 0.5:.3f},{g},{q}\n")

with open(os.path.join(OUT, 'groundwater.csv'), 'w') as f:
    f.write('X,Y,Z\n')
    for x in range(0, 201, 50):
        for y in range(0, 151, 50):
            f.write(f"{x + E0:.2f},{y + N0:.2f},{gw(x, y):.3f}\n")

# ---- zones shapefile (Polygon) with NAME and CASE attributes
polys = [
    ('Heavy loads', 'Heavy', [(120, 0), (200, 0), (200, 80), (120, 80), (120, 0)]),
    ('Settlement sensitive', 'Sensitive', [(20, 100), (90, 100), (90, 150), (20, 150), (20, 100)]),
]
def shp_bytes():
    recs = []
    for _, _, ring in polys:
        pts = [(x + E0, y + N0) for x, y in reversed(ring)]  # clockwise outer ring
        xs_, ys_ = [p[0] for p in pts], [p[1] for p in pts]
        c = struct.pack('<i4d2i', 5, min(xs_), min(ys_), max(xs_), max(ys_), 1, len(pts)) + struct.pack('<i', 0)
        c += b''.join(struct.pack('<2d', *p) for p in pts)
        recs.append(c)
    allx = [x + E0 for _, _, r in polys for x, _ in r]; ally = [y + N0 for _, _, r in polys for _, y in r]
    def header(length_words):
        return struct.pack('>7i', 9994, 0, 0, 0, 0, 0, length_words) + struct.pack('<2i8d', 1000, 5, min(allx), min(ally), max(allx), max(ally), 0, 0, 0, 0)
    body, shx, off = b'', b'', 50
    for n, c in enumerate(recs, 1):
        body += struct.pack('>2i', n, len(c) // 2) + c
        shx += struct.pack('>2i', off, len(c) // 2); off += 4 + len(c) // 2
    return header(50 + len(body) // 2) + body, header(50 + len(shx) // 2) + shx

def dbf_bytes():
    fields = [('NAME', 'C', 30), ('CASE', 'C', 20)]
    hlen = 32 + 32 * len(fields) + 1; rlen = 1 + sum(f[2] for f in fields)
    out = struct.pack('<BBBBIHH20x', 3, 126, 11, 11, len(polys), hlen, rlen)
    for name, t, ln in fields:
        out += name.encode().ljust(11, b'\0') + t.encode() + b'\0' * 4 + bytes([ln, 0]) + b'\0' * 14
    out += b'\r'
    for name, case, _ in polys:
        out += b' ' + name.encode().ljust(30) + case.encode().ljust(20)
    return out + b'\x1a'

shp, shx = shp_bytes()
with zipfile.ZipFile(os.path.join(OUT, 'zones.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('zones.shp', shp); z.writestr('zones.shx', shx); z.writestr('zones.dbf', dbf_bytes())
    z.writestr('zones.prj', 'PROJCS["GDA2020 / MGA zone 56"]')
print('samples written to', os.path.abspath(OUT))
