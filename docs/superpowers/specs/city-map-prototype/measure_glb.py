"""Measure every .glb under a pack folder: world-space bounding box and triangle count.

Usage: python3 measure_glb.py <packs-root> <out.json>
Walks the scene graph (TRS or matrix nodes) and transforms each primitive's
POSITION min/max corners, so pivots and node scales are included. Prototype for
`pnpm assets:check`; not part of the build.
"""
import json, struct, sys, os, math


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def trs(n):
    if "matrix" in n:
        m = n["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get("translation", [0, 0, 0]); r = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def bbox(path):
    with open(path, "rb") as f:
        data = f.read()
    length = struct.unpack_from("<I", data, 12)[0]
    g = json.loads(data[20:20 + length])
    lo, hi, tris = [math.inf] * 3, [-math.inf] * 3, 0

    def visit(i, parent):
        nonlocal tris
        n = g["nodes"][i]
        M = mat_mul(parent, trs(n))
        if "mesh" in n:
            for p in g["meshes"][n["mesh"]]["primitives"]:
                a = g["accessors"][p["attributes"]["POSITION"]]
                mn, mx = a["min"], a["max"]
                if "indices" in p:
                    tris += g["accessors"][p["indices"]]["count"] // 3
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            v = [sum(M[r][k] * [cx, cy, cz, 1][k] for k in range(4)) for r in range(3)]
                            for k in range(3):
                                lo[k] = min(lo[k], v[k]); hi[k] = max(hi[k], v[k])
        for c in n.get("children", []):
            visit(c, M)

    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        visit(r, ident)
    return lo, hi, tris


if __name__ == "__main__":
    root, out = sys.argv[1], sys.argv[2]
    rows = []
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if not os.path.isdir(p):
            continue
        for f in sorted(os.listdir(p)):
            if f.endswith(".glb"):
                lo, hi, t = bbox(os.path.join(p, f))
                rows.append(dict(folder=d, name=f[:-4], w=round(hi[0] - lo[0], 2), h=round(hi[1] - lo[1], 2),
                                 d=round(hi[2] - lo[2], 2), minY=round(lo[1], 2), cx=round((lo[0] + hi[0]) / 2, 2),
                                 cz=round((lo[2] + hi[2]) / 2, 2), tris=t, bytes=os.path.getsize(os.path.join(p, f))))
    json.dump(rows, open(out, "w"), indent=0)
    print(len(rows), "models measured")
