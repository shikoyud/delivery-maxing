"""Render layout.json as a top-down review map (PNG)."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

L = json.load(open(sys.argv[1]))
CAT = {e["id"]: e for e in json.load(open(sys.argv[2]))["entries"]}
ST = json.load(open(sys.argv[1].replace(".json", ".stats.json")))
OUT = sys.argv[3]
S = 2.0                      # px per metre
M = 1200
TOP, LEFT, PANEL = 110, 40, 640
IW, IH = int(M * S) + LEFT * 2 + PANEL, int(M * S) + TOP + 60

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda n, b=False: ImageFont.truetype(FB if b else F, n)

img = Image.new("RGB", (IW, IH), "#f4f1ea")
d = ImageDraw.Draw(img, "RGBA")


def P(x, z):
    return (LEFT + x * S, TOP + (M - z) * S)


def R(r):
    x0, z0, x1, z1 = r
    a, b = P(x0, z1), P(x1, z0)
    return [a[0], a[1], b[0], b[1]]


LEVEL_FILL = {"L0": "#e9e4d6", "L1": "#e2dccb", "L2": "#d8d1bd", "L3": "#cec6af", "RIDGE": "#c3bb9f"}
CATCOL = {"residential": "#c98f6b", "office": "#5f85b5", "shop": "#e3bf4f", "food": "#e0703a", "civic": "#a7aebb",
          "industrial": "#858585", "leisure": "#7cae6a", "landmark": "#9b72c0", "service": "#b9c0c6", "prop": "#9a9a9a"}

# --- ground: levels, water, bands
d.rectangle(R([0, 0, M, M]), fill="#7fb2d6")                       # bay
for name, (z0, z1, y) in L["levels"].items():
    z0 = 100 if z0 is None else z0
    d.rectangle(R([0, z0, M, z1]), fill=LEVEL_FILL[name])
for a in L["areas"]:
    if a["kind"] in ("quay",):
        d.rectangle(R(a["shape"]), fill="#d9d4c7")
# water south of the shore
import math
shore = []
for x in range(0, M + 1, 5):
    z = 110.0 if x < 380 else (110 + 70 * math.sin(math.pi * (x - 380) / 440) if x <= 820 else 120.0)
    shore.append(P(x, z))
d.polygon(shore + [P(M, 0), P(0, 0)], fill="#7fb2d6")
for name, (z0, z1, y0, y1) in L["bands"].items():
    box = R([0, z0, M, z1])
    d.rectangle(box, fill="#b8ad8f")
    for i in range(1, 6):   # contour lines every ~1/6 of the rise
        zz = z0 + (z1 - z0) * i / 6
        d.line([P(0, zz), P(M, zz)], fill="#a39878", width=1)

area_fill = {"sand": "#f1dfa6", "boardwalk": "#b48a5a", "park": "#a9cf8f", "sports": "#a9cf8f", "plaza": "#e6e0d2",
             "parking": "#c8c8c8", "pier": "#a07a4f", "breakwater": "#9b9b9b", "rail": "#8b7d6b", "containerYard": "#cfc8b8",
             "marina": "#6ea3c9", "ship": "#4a4f5a", "cliff": "#8a7b60", "hospitalLot": "#f3f3f3", "gasLot": "#d8d8d8"}
for a in L["areas"]:
    k = a["kind"]
    if k not in area_fill:
        continue
    if isinstance(a["shape"][0], (list, tuple)):
        d.polygon([P(*p) for p in a["shape"]], fill=area_fill[k])
    else:
        d.rectangle(R(a["shape"]), fill=area_fill[k])
for a in L["areas"]:
    if a["kind"] == "rail":
        x0, z0, x1, z1 = a["shape"]
        for zz in (z0 + 3, z1 - 3):
            d.line([P(x0, zz), P(x1, zz)], fill="#4b4036", width=2)
        for xx in range(int(x0), int(x1), 4):
            d.line([P(xx, z0 + 2), P(xx, z1 - 2)], fill="#6b5d4c", width=1)

# --- roads
for r in L["roads"]:
    if "rect" in r:
        col = {"avenue": "#4d4f55", "street": "#6d7077", "alley": "#b3b1aa"}[r["kind"]]
        d.rectangle(R(r["rect"]), fill=col)
    else:
        pts = [P(*p) for p in r["poly"]]
        d.line(pts, fill="#6d7077", width=int(r["width"] * S), joint="curve")
for r in L["roads"]:
    if r["kind"] == "avenue":
        x0, z0, x1, z1 = r["rect"]
        zc = (z0 + z1) / 2
        for xx in range(int(x0), int(x1), 12):
            d.line([P(xx, zc), P(xx + 6, zc)], fill="#f2d14b", width=2)

# --- connectors
for c in L["connectors"]:
    pts = [P(*p) for p in c["poly"]]
    if c["kind"] == "switchback":
        d.line(pts, fill="#6d7077", width=int(12 * S), joint="curve")
        d.line(pts, fill="#ffffff", width=1)
    elif c["kind"] == "steepLane":
        d.line(pts, fill="#1f8a8a", width=int(6 * S))
    else:
        (xa, za), (xb, zb) = c["poly"]
        d.rectangle([P(xa - 2, zb)[0], P(xa, zb)[1], P(xa + 2, za)[0], P(xa, za)[1]], fill="#8c3b2a")
        for zz in range(int(za), int(zb), 2):
            d.line([P(xa - 2, zz), P(xa + 2, zz)], fill="#e9c6b8", width=1)

def band_labels():
    for name, (z0, z1, y0, y1) in L["bands"].items():
        lx = {"A": 150, "B": 470, "C": 360, "D": 300}[name]
        t = f"Slope band {name}: {y0} → {y1} m"
        bb = d.textbbox((0, 0), t, font=f(15, True))
        px_, py_ = P(lx, (z0 + z1) / 2)
        d.rounded_rectangle([px_ - 6, py_ - 12, px_ + bb[2] + 6, py_ + 12], 5, fill=(255, 250, 235, 230))
        d.text((px_, py_ - 10), t, fill="#5a4f35", font=f(15, True))

band_labels()

# --- lots / buildings
for l in L["lots"]:
    e = CAT[l["asset"]]
    box = R(l["rect"])
    if l["asset"].startswith("missing/"):
        d.rectangle(box, fill="#f7d6f0", outline="#c2189b", width=2)
        continue
    col = CATCOL.get(e["category"], "#999999")
    if l.get("hospital"):
        col = "#ffffff"
    d.rectangle(box, fill=col, outline="#3b3326", width=1)
    if l.get("hospital"):
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        d.rectangle([cx - 14, cy - 4, cx + 14, cy + 4], fill="#d62d2d")
        d.rectangle([cx - 4, cy - 14, cx + 4, cy + 14], fill="#d62d2d")
        d.ellipse([cx - 18 * S, cy - 18 * S, cx + 18 * S, cy + 18 * S], outline="#2e9e5b", width=3)

# --- POIs
for p in L["pois"]:
    x, y = P(*p["pos"])
    rs = p["roles"]
    if "foodPickup" in rs:
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill="#ff5a00", outline="#3a1500", width=2)
    elif "packagePickup" in rs:
        d.rectangle([x - 5, y - 5, x + 5, y + 5], fill="#7b2cbf", outline="#200838", width=2)
    elif p["access"] == "noCar":
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill="#1f8a8a", outline="#ffffff")
    else:
        d.ellipse([x - 2.5, y - 2.5, x + 2.5, y + 2.5], fill="#1b1b1b", outline="#ffffff")

# --- labels
def tag(text, x, z, size=18, bold=True, fill="#1d1d1d", bg=(255, 255, 255, 200)):
    px, py = P(x, z)
    fnt = f(size, bold)
    bb = d.textbbox((0, 0), text, font=fnt)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.rounded_rectangle([px - w / 2 - 6, py - h / 2 - 5, px + w / 2 + 6, py + h / 2 + 7], 6, fill=bg)
    d.text((px - w / 2, py - h / 2 - 1), text, fill=fill, font=fnt)


DIST = [("Docks & rail yard", 190, 225), ("Beach & boardwalk", 600, 120), ("Old Harbor", 1010, 145),
        ("Industrial edge", 165, 450), ("Downtown", 545, 440), ("Market Street", 980, 500),
        ("Row houses", 200, 735), ("High Street", 600, 735), ("Apartments", 1000, 735),
        ("Uptown", 600, 965), ("Hillcrest", 300, 1160)]
for t, x, z in DIST:
    tag(t, x, z, 24)
LEVLAB = [("L0 Waterfront · 2 m", 262), ("L1 Bayview · 10 m", 335), ("L2 Midtown · 24 m", 645),
          ("L3 Uptown · 38 m", 905), ("Ridge Hillcrest · 48–60 m", 1092)]
for t, z in LEVLAB:
    px, py = P(1195, z)
    fnt = f(15, True)
    bb = d.textbbox((0, 0), t, font=fnt)
    d.rounded_rectangle([px - (bb[2] - bb[0]) - 10, py - 12, px, py + 10], 5, fill=(40, 40, 40, 210))
    d.text((px - (bb[2] - bb[0]) - 5, py - 10), t, fill="white", font=fnt)
for r in L["roads"]:
    if r.get("name") and "rect" in r:
        x0, z0, x1, z1 = r["rect"]
        tag(r["name"], 90 if r["name"] != "Quay Street" else 900, (z0 + z1) / 2, 13, True, "#ffffff", (40, 40, 40, 220))
for lb in L["labels"]:
    if lb["kind"] == "hospital":
        tag(lb["text"], lb["x"], lb["z"] - 22, 14, True, "#b01919")
    elif lb["kind"] == "gas":
        px, py = P(lb["x"], lb["z"])
        d.ellipse([px - 14, py - 14, px + 14, py + 14], fill="#f2c200", outline="#1d1d1d", width=2)
        d.text((px - 6, py - 10), "G", fill="#1d1d1d", font=f(17, True))
    elif lb["kind"] == "landmark":
        tag(lb["text"], lb["x"], lb["z"] + 18, 13, True, "#4b2a73")
    else:
        tag(lb["text"], lb["x"], lb["z"], 13, False, "#ffffff", (40, 40, 40, 200))

# --- frame, grid ticks, scale, compass, title
d.rectangle([LEFT, TOP, LEFT + M * S, TOP + M * S], outline="#1d1d1d", width=2)
for v in range(0, M + 1, 100):
    x, y = P(v, 0)
    d.line([x, y, x, y + 8], fill="#1d1d1d", width=2)
    d.text((x - 12, y + 10), f"{v}", fill="#333", font=f(13))
    x, y = P(0, v)
    d.line([x - 8, y, x, y], fill="#1d1d1d", width=2)
d.text((LEFT, 22), "Delivery Maxing · City map v1 (1.2 × 1.2 km terraced bay city)", fill="#1d1d1d", font=f(34, True))
d.text((LEFT, 66), "First-pass generated layout for review. North is up; x runs east, z runs north (metres). "
       "Buildings are coloured by catalog category; every lot references a catalog id.", fill="#444", font=f(17))

px = LEFT + M * S + 40
y = TOP
def ptxt(t, size=17, bold=False, col="#1d1d1d"):
    global y
    d.text((px, y), t, fill=col, font=f(size, bold))
    y += size + 9

ptxt("Legend", 24, True)
y += 4
def sw(col, t, shape="rect", outline="#3b3326"):
    global y
    if shape == "rect":
        d.rectangle([px, y + 2, px + 26, y + 20], fill=col, outline=outline, width=1)
    elif shape == "dot":
        d.ellipse([px + 6, y + 4, px + 20, y + 18], fill=col, outline="#000", width=2)
    elif shape == "sq":
        d.rectangle([px + 6, y + 4, px + 20, y + 18], fill=col, outline="#000", width=2)
    elif shape == "line":
        d.rectangle([px, y + 7, px + 26, y + 15], fill=col)
    d.text((px + 38, y + 1), t, fill="#1d1d1d", font=f(16))
    y += 28

for k, t in [("residential", "Residential"), ("office", "Office / tower"), ("shop", "Shop / storefront"),
             ("food", "Food business"), ("civic", "Civic"), ("industrial", "Industrial"), ("leisure", "Sports court"),
             ("landmark", "Landmark")]:
    sw(CATCOL[k], t)
sw("#ffffff", "Hospital (spawn + safe zone, green ring)")
sw("#f7d6f0", "Missing model (placeholder)", outline="#c2189b")
y += 8
sw("#4d4f55", "Avenue 15 m (all vehicles)", "line")
sw("#6d7077", "Street / switchback 12 m (all)", "line")
sw("#b3b1aa", "Alley 4 m (no cars)", "line")
sw("#1f8a8a", "Steep lane 6 m (bike, motorbike, foot)", "line")
sw("#8c3b2a", "Public stairs (foot only)", "line")
sw("#b8ad8f", "Slope band (retaining walls, slope buildings)")
sw("#a9cf8f", "Park / open lot")
sw("#f1dfa6", "Beach")
y += 8
sw("#ff5a00", "Food pickup", "dot")
sw("#7b2cbf", "Package pickup", "sq")
sw("#1b1b1b", "Dropoff (car-reachable door)", "dot")
sw("#1f8a8a", "Food-only dropoff (stairs / alley door)", "dot")
y += 4
d.ellipse([px + 1, y, px + 27, y + 26], fill="#f2c200", outline="#1d1d1d", width=2)
d.text((px + 8, y + 2), "G", fill="#1d1d1d", font=f(17, True))
d.text((px + 38, y + 3), "Gas station (fuel for motorbike and car)", fill="#1d1d1d", font=f(16))
y += 44

ptxt("Generated counts", 22, True)
ptxt(f"Buildings: {ST['buildings']:,} ({ST['distinctModels']} distinct models)")
ptxt(f"POIs: {ST['pois']}  ·  food pickups {ST['foodPickups']}  ·  package pickups {ST['packagePickups']}")
ptxt(f"Food-only stair/alley drops: {ST['noCarFoodDrops']} of {ST['foodDrops']} food drops")
c = ST["connectors"]
ptxt(f"Level links: {c.get('switchback',0)} switchbacks · {c.get('steepLane',0)} steep lanes · {c.get('stairs',0)} stairs")
ptxt(f"Hospitals: {len(ST['hospitals'])}  ·  Gas stations: {len(ST['gas'])}")
ptxt(f"Triangles if every building is LOD0: {ST['trisPlaced']/1e6:.1f} M")
y += 10
ptxt("By district", 20, True)
for k, v in sorted(ST["buildingsByDistrict"].items(), key=lambda kv: -kv[1]):
    ptxt(f"{k:<12} {v:>5}", 15)
y += 10
ptxt("Notes", 20, True)
for t in ["Lot sizes come from measured models; swapping a", "model never moves a lot.",
          "Magenta lots: types the packs don't have yet", "(post office, warehouses, school, containers, cranes).",
          "Building fronts face the street with the door tick;", "the real front axis of each model is checked at import."]:
    ptxt(t, 15)

# scale bar + north arrow
bx, by = LEFT + 20, TOP + M * S - 40
d.rectangle([bx - 8, by - 26, bx + 220, by + 22], fill=(255, 255, 255, 220))
d.rectangle([bx, by, bx + 100 * S, by + 8], fill="#1d1d1d")
d.text((bx, by - 22), "100 m", fill="#1d1d1d", font=f(15, True))
nx, ny = LEFT + M * S - 50, TOP + 60
d.polygon([(nx, ny - 34), (nx - 14, ny + 6), (nx + 14, ny + 6)], fill="#1d1d1d")
d.text((nx - 8, ny + 10), "N", fill="#1d1d1d", font=f(22, True))
img.save(OUT, optimize=True)
print(OUT, img.size)
