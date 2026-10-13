"""Deterministic first-pass layout of the 1.2 km terraced bay city.

Produces layout.json (lots, roads, connectors, POIs) and stats.json from the
catalog. Coordinates: x east 0..1200, z north 0..1200, metres. y = level height.
"""
import json, math, random, sys
from collections import Counter, defaultdict

CAT = {e["id"]: e for e in json.load(open(sys.argv[1]))["entries"]}
OUT = sys.argv[2]
rng = random.Random(20261014)

W = 1200
STREET, AVENUE, ALLEY = 12, 15, 4
CROSS = [12 + 108 * k for k in range(11)]          # N-S cross-street centre lines
EDGE_E = 1188                                       # east edge street x0

LEVELS = {  # name: (z0, z1, height)
    "L0": (None, 270, 2), "L1": (310, 560, 10), "L2": (620, 820, 24),
    "L3": (880, 1040, 38), "RIDGE": (1070, 1180, 48),
}
BANDS = {"A": (270, 310, 2, 10), "B": (560, 620, 10, 24), "C": (820, 880, 24, 38), "D": (1040, 1070, 38, 48)}


def shore(x):
    if x < 380:
        return 110.0
    if x <= 820:
        return 110 + 70 * math.sin(math.pi * (x - 380) / 440)
    return 120.0


lots, roads, connectors, pois, labels, areas = [], [], [], [], [], []


def road(kind, x0, z0, x1, z1, y, name=None, access=None):
    roads.append(dict(kind=kind, rect=[x0, z0, x1, z1], y=y, name=name,
                      access=access or {"avenue": "all", "street": "all", "alley": "noCar"}[kind]))


def area(kind, poly_or_rect, y, name=None):
    areas.append(dict(kind=kind, shape=poly_or_rect, y=y, name=name))


# ---------------------------------------------------------------- palettes
def ids(*rx):
    import re
    out = []
    for r in rx:
        out += [i for i, e in CAT.items() if re.fullmatch(r, i) and e.get("use") in ("placed",) and "duplicateOf" not in e]
    return out


PAL = {
    "downtown": [(ids(r"mega/House_(49|5[0-2])"), 3), (ids(r"mega/House_4[0-8]"), 5), (ids(r"mega/House_(2[3-5]|3[7-9])"), 4),
                 (ids(r"mega/Bank_0[12]", r"mega/Office_01"), 2), (ids(r"mega/Cinema_01"), 0.5), (ids(r"(mega|trop)/Hotel_0[12]"), 1),
                 (ids(r"mega/Coffe_02", r"mega/Cafe_01", r"mega/Sushi_01"), 1.5)],
    "market": [(ids(r"mega/(House_0[1-8]|OldHouse_0[5-8])"), 5), (ids(r"mega/(SmallHouse_(0[1-9]|1[0-5])|OldHouse_1[0-2])"), 4),
               (ids(r"mega/(Bakery_01|Burgers_01|Cafe_01|Coffe_02|Donuts_01|Pizza_01|Sushi_01)", r"trop/Wok_01"), 3.5),
               (ids(r"mega/Supermarket_0[12]", r"mega/AutoService_01"), 1), (ids(r"(mega|trop)/Hotel_0[12]"), 0.6), (ids(r"mega/SmallMarket_01"), 0.6)],
    "highstreet": [(ids(r"mega/(House_0[1-8]|House_1[3-5]|House_3[34]|OldHouse_0[1-2])"), 5), (ids(r"mega/(SmallHouse_(0[1-9]|1[0-5])|OldHouse_1[0-2])"), 3),
                   (ids(r"mega/(Bakery_01|Burgers_01|Cafe_01|Coffe_02|Donuts_01|Pizza_01)", r"trop/(Wok_01|Pizza_01)"), 3),
                   (ids(r"mega/Supermarket_0[12]", r"mega/Office_01", r"mega/House_2[3-5]"), 1), (ids(r"mega/Cinema_01"), 0.3)],
    "bayview": [(ids(r"mega/(House_0[1-8]|House_(19|2[01])|OldHouse_0[5-8]|House_3[34]|OldHouse_0[12])"), 6),
                (ids(r"mega/(SmallHouse_0[1-9]|OldHouse_1[0-2])"), 1.5), (ids(r"mega/(Coffe_02|Pizza_01|Donuts_01)"), 1)],
    "industrial": [(ids(r"mega/Factory_0[35]"), 2), (ids(r"mega/(House_2[6-8]|OldHouse_09)"), 3), (ids(r"mega/Supermarket_0[34]"), 1),
                   (ids(r"mega/AutoService_01", r"mega/Office_01"), 1.5), (ids(r"mega/Construction_0[12]"), 0.6), (ids(r"mega/(Burgers_01|SmallMarket_01)"), 0.6)],
    "rowhouses": [(ids(r"mega/(House_(09|1[0-8])|House_0[1-8]|OldHouse_0[5-8])"), 7), (ids(r"mega/(House_2[6-8]|OldHouse_09)"), 1),
                  (ids(r"mega/(SmallHouse_1[1-5]|Coffe_02|Pizza_01)"), 1)],
    "apartments": [(ids(r"mega/(House_3[1-4]|OldHouse_0[1-4])"), 6), (ids(r"mega/(House_(19|2[01])|House_0[1-8])"), 2),
                   (ids(r"mega/Supermarket_0[1-4]", r"mega/Construction_0[12]"), 0.8), (ids(r"mega/(Donuts_01|Burgers_01|SmallHouse_1[1-5])"), 1)],
    "uptown": [(ids(r"mega/House_1[3-8]", r"mega/House_(09|1[0-2])"), 6), (ids(r"mega/House_(19|2[01])"), 2),
               (ids(r"mega/(SmallHouse_1[1-5]|Bakery_01|Cafe_01|Coffe_02)", r"mega/Supermarket_0[12]"), 1.5)],
    "harbor": [(ids(r"trop/House_0[5-8]", r"trop/Hotel_(0[3-5]|09|1[01])"), 4), (ids(r"mega/Sushi_01", r"trop/Wok_01", r"trop/Pizza_01", r"trop/Burgers_01"), 2),
               (ids(r"mega/(SmallHouse_1[1-5])"), 1)],
    "beach": [(ids(r"trop/Hotel_(0[3-9]|1[01])"), 4), (ids(r"trop/House_0[5-6]"), 2), (ids(r"trop/(Burgers_01|Pizza_01)", r"mega/Donuts_01"), 2)],
    "slope": [(ids(r"mega/House_0[5-6]", r"mega/OldHouse_07"), 1)],
}


def pick(pal, maxw, maxd):
    choices = []
    for group, wgt in PAL[pal]:
        fit = [i for i in group if CAT[i]["size"]["w"] <= maxw and CAT[i]["size"]["d"] <= maxd]
        if fit:
            choices.append((fit, wgt))
    if not choices:
        return None
    tot = sum(w for _, w in choices)
    r = rng.uniform(0, tot)
    for fit, w in choices:
        r -= w
        if r <= 0:
            return rng.choice(fit)
    return rng.choice(choices[-1][0])


def place(mid, x, z, facing, y, district, lot_w=None, lot_d=None, corner=False, extra=None):
    s = CAT[mid]["size"]
    w, d = lot_w or math.ceil(s["w"] * 2) / 2, lot_d or math.ceil(s["d"] * 2) / 2
    if facing in ("S", "N"):
        rect = [x, z, x + w, z + d] if facing == "S" else [x, z - d, x + w, z]
        door = [x + w / 2, z if facing == "S" else z]
    else:
        rect = [x, z, x + d, z + w] if facing == "W" else [x - d, z, x, z + w]
        door = [x, z + w / 2]
    lot = dict(id=f"lot{len(lots):04d}", asset=mid, rect=rect, facing=facing, y=y, district=district,
               door=door, corner=corner)
    if extra:
        lot.update(extra)
    lots.append(lot)
    return w


def fill_row(x0, x1, zfront, facing, y, pal, maxd, district):
    """Wall-to-wall row along x from x0 to x1, fronts on zfront."""
    x = x0
    first = True
    while x1 - x >= 4.2:
        mid = pick(pal, x1 - x, maxd)
        if not mid:
            break
        w = place(mid, x, zfront, facing, y, district, corner=first or (x1 - x - CAT[mid]["size"]["w"] < 4.2))
        first = False
        x += w


OPEN = ["park", "sports", "parking", "plaza"]


def block(x0, x1, z0, z1, y, pal, district, dense=False, openable=False, k=0, row=0):
    if openable and (k + row) % 3 == 0:
        kind = OPEN[(k * 7 + row * 3) % 4]
        area(kind, [x0, z0, x1, z1], y, district)
        if kind == "sports":
            place("mega/FootballPlayground_01", x0 + 6, z0 + 6, "S", y, district, extra={"open": True})
            place("mega/BasketballPlayground_01", x0 + 26, z0 + 6, "S", y, district, extra={"open": True})
        if kind == "parking":
            place("mega/ParkingZone_01", x0 + 3, z0, "S", y, district, extra={"open": True})
        return
    depth = z1 - z0
    if not dense:
        road("alley", x0, (z0 + z1) / 2 - ALLEY / 2, x1, (z0 + z1) / 2 + ALLEY / 2, y)
        half = depth / 2 - ALLEY / 2
        fill_row(x0, x1, z0, "S", y, pal, half, district)
        fill_row(x0, x1, z1, "N", y, pal, half, district)
    else:
        fill_row(x0, x1, z0, "S", y, pal, depth / 2, district)
        fill_row(x0, x1, z1, "N", y, pal, depth / 2, district)


def blocks_x():
    xs = []
    for k in range(len(CROSS)):
        a = CROSS[k] + STREET / 2
        b = (CROSS[k + 1] - STREET / 2) if k + 1 < len(CROSS) else EDGE_E
        xs.append((k, a, b))
    return xs


def district_of(level, xc):
    if level == "L1":
        return "industrial" if xc < 330 else ("downtown" if xc < 760 else "market")
    if level == "L2":
        return "rowhouses" if xc < 400 else ("highstreet" if xc < 800 else "apartments")
    if level == "L3":
        return "uptown"


SPECIAL = {}  # (level, k) -> list of (kind, ...) reserved corners


def build_level(level, avenue_name):
    z0, z1, y = LEVELS[level]
    road("avenue", 0, z0, W, z0 + AVENUE, y, avenue_name)
    for xc in CROSS:
        road("street", xc - STREET / 2, z0 + AVENUE, xc + STREET / 2, z1, y)
    road("street", EDGE_E, z0 + AVENUE, W, z1, y)
    road("street", 0, z1 - STREET, W, z1, y)
    for k, a, b in blocks_x():
        xc = (a + b) / 2
        dist = district_of(level, xc)
        dense = dist == "downtown"
        D = 48 if dense else 30
        z = z0 + AVENUE
        row = 0
        top = z1 - STREET
        while top - z >= 30:
            d = D if top - z >= D else 30
            if top - z - d < 30 + STREET and top - z - d > 0:
                d = top - z  # absorb the remainder into the last row
            bz1 = z + d
            res = SPECIAL.get((level, k, row))
            if res:
                res(a, b, z, bz1, y, dist)
            else:
                openable = dist in ("industrial", "rowhouses", "apartments", "uptown")
                block(a, b, z, bz1, y, dist, dist, dense=(d >= 48 and dense), openable=openable, k=k, row=row)
            if bz1 < top:
                road("street", a, bz1, b, bz1 + STREET, y)
            z = bz1 + STREET
            row += 1


def hospital_block(name):
    def f(a, b, z0, z1, y, dist):
        place("mega/Hospital_01", a, z0, "S", y, dist, lot_w=27, lot_d=27, extra={"hospital": name, "safeZone": 18})
        labels.append(dict(text=name, x=a + 13, z=z0 + 13, kind="hospital"))
        area("hospitalLot", [a, z0, a + 27, z1], y, dist)
        fill_row(a + 27, b, z0, "S", y, dist, (z1 - z0) / 2 - 2, dist)
        fill_row(a + 27, b, z1, "N", y, dist, (z1 - z0) / 2 - 2, dist)
        fill_row(a, a + 27, z1, "N", y, dist, (z1 - z0) - 29, dist)
    return f


def gas_block(name, side="W"):
    def f(a, b, z0, z1, y, dist):
        gx = a if side == "W" else b - 18
        place("mega/Gas_Station_02", gx + 2, z0 + 2, "S", y, dist, extra={"gas": name})
        place("mega/SmallMarket_01", gx + 11, z0 + 4, "S", y, dist, extra={"gasShop": name})
        labels.append(dict(text="Gas", x=gx + 8, z=z0 + 9, kind="gas"))
        area("gasLot", [gx, z0, gx + 18, z0 + 15], y, dist)
        road("alley", a, (z0 + z1) / 2 - 2, b, (z0 + z1) / 2 + 2, y)
        if side == "W":
            fill_row(a + 18, b, z0, "S", y, dist, (z1 - z0) / 2 - 2, dist)
        else:
            fill_row(a, b - 18, z0, "S", y, dist, (z1 - z0) / 2 - 2, dist)
        fill_row(a, b, z1, "N", y, dist, (z1 - z0) / 2 - 2, dist)
    return f


def landmark_block(mid, label):
    def f(a, b, z0, z1, y, dist):
        s = CAT[mid]["size"]
        cx = (a + b) / 2 - s["w"] / 2
        place(mid, cx, z0, "S", y, dist, extra={"landmark": label})
        labels.append(dict(text=label, x=(a + b) / 2, z=z0 + s["d"] / 2, kind="landmark"))
        area("plaza", [a, z0, b, z1], y, dist)
        fill_row(a, cx - 3, z0, "S", y, dist, 20, dist)
        fill_row(cx + s["w"] + 3, b, z0, "S", y, dist, 20, dist)
        fill_row(a, b, z1, "N", y, dist, max(6, (z1 - z0) - s["d"] - 4), dist)
    return f


SPECIAL[("L1", 1, 0)] = hospital_block("Bayview General")
SPECIAL[("L1", 9, 0)] = hospital_block("Harbor Clinic")
SPECIAL[("L2", 8, 0)] = hospital_block("Midtown Medical")
SPECIAL[("L3", 1, 0)] = hospital_block("Uptown Hospital")
SPECIAL[("L1", 0, 1)] = gas_block("Gas L1 West")
SPECIAL[("L1", 10, 1)] = gas_block("Gas L1 East", "E")
SPECIAL[("L2", 5, 1)] = gas_block("Gas L2")
SPECIAL[("L3", 7, 1)] = gas_block("Gas L3")
SPECIAL[("L1", 5, 0)] = landmark_block("mega/CityHall_01", "City Hall")
SPECIAL[("L1", 4, 1)] = landmark_block("mega/Police_01", "Police")
SPECIAL[("L2", 3, 1)] = landmark_block("mega/FireStation_01", "Fire Station")
SPECIAL[("L3", 5, 0)] = landmark_block("mega/Church_01", "Church")
SPECIAL[("L2", 6, 2)] = landmark_block("missing/School_01", "School (missing model)")
SPECIAL[("L2", 2, 0)] = landmark_block("missing/PostOffice_01", "Post Office (missing model)")

build_level("L1", "Bayview Avenue")
build_level("L2", "Midtown Avenue")
build_level("L3", "Uptown Avenue")

# ---------------------------------------------------------------- waterfront L0
Y0 = 2
road("avenue", 0, 255, W, 270, Y0, "Harbor Road")
# rail line (docks)
area("rail", [0, 236, 420, 246], Y0, "docks")
# docks quay + yard
area("quay", [0, 110, 380, 255], Y0, "docks")
area("containerYard", [20, 120, 200, 184], Y0, "docks")
for i in range(8):
    for j in range(4):
        place("missing/Container_01", 26 + i * 21, 126 + j * 15, "S", Y0, "docks", lot_w=6.1, lot_d=2.4, extra={"stack": 1 + (i + j) % 3})
place("missing/Crane_01", 40, 98, "S", Y0, "docks", lot_w=20, lot_d=12)
place("missing/Crane_01", 120, 98, "S", Y0, "docks", lot_w=20, lot_d=12)
labels.append(dict(text="Cargo ship", x=110, z=88, kind="note"))
area("ship", [60, 80, 160, 96], 0, "docks")
place("missing/Warehouse_01", 215, 130, "S", Y0, "docks")
place("missing/Warehouse_01", 215, 160, "S", Y0, "docks")
place("mega/Factory_05", 250, 196, "S", Y0, "docks")
place("mega/Factory_03", 275, 196, "S", Y0, "docks")
place("mega/Factory_01", 300, 140, "S", Y0, "docks", extra={"prop": True})
place("mega/Factory_04", 315, 165, "S", Y0, "docks", extra={"prop": True})
place("mega/Factory_02", 330, 140, "S", Y0, "docks", extra={"prop": True})
place("mega/Station_01", 120, 234, "N", Y0, "docks", lot_w=24, lot_d=12)
place("mega/Factory_03", 30, 200, "S", Y0, "docks")
place("mega/Factory_05", 60, 200, "S", Y0, "docks")
road("street", 200, 120, 212, 255, Y0)
road("street", 0, 112, 200, 118, Y0)  # quay-side service lane (6 m, cars allowed)
road("street", 0, 186, 380, 192, Y0)  # factory yard lane
# gas on L0
place("mega/Gas_Station_02", 350, 230, "S", Y0, "docks", extra={"gas": "Gas L0 Docks"})
place("mega/SmallMarket_01", 360, 240, "S", Y0, "docks", extra={"gasShop": "Gas L0 Docks"})
labels.append(dict(text="Gas", x=356, z=236, kind="gas"))
# beach
beach_poly = [(380, shore(380))] + [(x, shore(x)) for x in range(380, 821, 10)] + [(820, 200), (380, 200)]
area("sand", beach_poly, 1, "beach")
area("boardwalk", [380, 200, 820, 208], Y0, "beach")
for x in range(392, 800, 34):
    place(rng.choice(["trop/Bar_01", "trop/Bar_02"]), x, 185 if x % 3 else 178, "N", 1, "beach") if (x // 34) % 3 == 0 else None
x = 382
while x < 812:
    mid = pick("beach", 812 - x, 44)  # backs onto the boardwalk
    if not mid:
        break
    x += place(mid, x, 255, "N", Y0, "beach") + 3
place("trop/Ferris_wheel_01" if "trop/Ferris_wheel_01" in CAT else "trop/Bar_01", 790, 150, "S", 1, "beach", lot_w=11, lot_d=6, extra={"prop": True})
# old harbor
area("quay", [820, 120, W, 255], Y0, "harbor")
area("pier", [995, 30, 1007, 120], Y0, "harbor")
area("breakwater", [1120, 60, 1200, 72], Y0, "harbor")
place("trop/Lighthouse_01", 1150, 74, "S", Y0, "harbor", extra={"landmark": "Lighthouse"})
labels.append(dict(text="Lighthouse", x=1155, z=96, kind="landmark"))
area("marina", [840, 70, 980, 118], 0, "harbor")
for row_z, facing in ((170, "N"), (255, "N")):
    x = 824
    while x < 1196:
        mid = pick("harbor", 1196 - x, 30 if row_z == 255 else 36)
        if not mid:
            break
        x += place(mid, x, row_z, facing, Y0, "harbor")
road("street", 820, 170, W, 182, Y0, "Quay Street")
road("alley", 820, 210, W, 214, Y0)
x = 824
while x < 1196:
    mid = pick("harbor", 1196 - x, 26)
    if not mid:
        break
    x += place(mid, x, 182, "S", Y0, "harbor")

# ---------------------------------------------------------------- Hillcrest ridge
YR = 48
lane = [(x, 1118 + 22 * math.sin(2 * math.pi * x / 420)) for x in range(0, W + 1, 10)]
roads.append(dict(kind="lane", poly=lane, width=10, y=YR, name="Hillcrest Drive", access="all"))
x = 4
while x < W - 16:
    zc = 1118 + 22 * math.sin(2 * math.pi * (x + 8) / 420)
    if 560 < x < 660:
        x += 16
        continue
    for facing, zf in (("S", zc + 6), ("N", zc - 6)):
        mid = rng.choice(ids(r"mega/(SuburbHouse_0[1-9]|OldHouse_1[4-6])"))
        place(mid, x, zf, facing, YR, "hillcrest", lot_w=15, lot_d=16)
    x += 16
area("park", [560, 1075, 660, 1175], YR, "hillcrest")
labels.append(dict(text="Lookout", x=610, z=1160, kind="landmark"))
place("mega/Gas_Station_02", 900, 1078, "S", YR, "hillcrest", extra={"gas": "Gas Hillcrest"})
labels.append(dict(text="Gas", x=905, z=1084, kind="gas"))
area("cliff", [0, 1180, W, 1200], 60, "edge")

# ---------------------------------------------------------------- slope bands
SW_K = {"A": [1, 5, 9], "B": [2, 6, 10], "C": [1, 5, 9], "D": [3, 8]}
LANE_K = {"A": [3, 7], "B": [0, 4, 8], "C": [3, 7, 10], "D": [0, 6]}
STAIR_X = {"A": [70, 330, 500, 650, 820, 1050], "B": [60, 170, 280, 390, 500, 610, 720, 830, 940, 1050],
           "C": [60, 170, 280, 500, 610, 720, 830, 940, 1050, 1150], "D": [120, 450, 760, 1000, 1150]}
for bname, (bz0, bz1, y0, y1) in BANDS.items():
    area("slopeBand", [0, bz0, W, bz1], (y0 + y1) / 2, bname)
    used = []
    for k in SW_K[bname]:
        xc = CROSS[k]
        dz = bz1 - bz0
        if dz >= 50:
            leg = 80
            poly = [(xc, bz0), (xc, bz0 + 14), (xc + leg, bz0 + 14), (xc + leg, bz1 - 14), (xc, bz1 - 14), (xc, bz1)]
        else:
            leg = 50
            poly = [(xc, bz0), (xc, bz0 + 10), (xc + leg, bz0 + 10), (xc + leg, bz1 - 10), (xc, bz1 - 10), (xc, bz1)]
        connectors.append(dict(kind="switchback", band=bname, poly=poly, width=12, y=[y0, y1], access="all", gradePct=9))
        used.append((xc - 8, xc + leg + 8))
    for k in LANE_K[bname]:
        xc = CROSS[k] + 40
        if any(a <= xc <= b for a, b in used):
            xc += 30
        connectors.append(dict(kind="steepLane", band=bname, poly=[(xc, bz0), (xc + 45, bz1)], width=6, y=[y0, y1],
                               access="bike,motorbike,foot", gradePct=14))
        used.append((xc - 4, xc + 49))
    for sx in STAIR_X[bname]:
        if any(a <= sx <= b for a, b in used):
            sx += 25
        connectors.append(dict(kind="stairs", band=bname, poly=[(sx, bz0), (sx, bz1)], width=4, y=[y0, y1], access="foot"))
        used.append((sx - 3, sx + 3))
    # slope-band buildings with doors on both levels (B and C only: 14 m rise)
    if bname in ("B", "C"):
        x = 6
        while x < W - 8:
            if any(a - 2 <= x <= b + 2 or a - 2 <= x + 8 <= b + 2 for a, b in used):
                x += 3
                continue
            if rng.random() < 0.45:
                mid = rng.choice(PAL["slope"][0][0])
                w = place(mid, x, bz0, "S", y0, "slope", extra={"upperDoor": [x + 3.5, bz0 + 6.3], "upperY": y1})
                x += w + 0.5
            else:
                x += 8

# ---------------------------------------------------------------- POIs
def roles(lot):
    p = CAT[lot["asset"]].get("poi")
    return p["roles"] if p else []


cands = [l for l in lots if roles(l) and not l.get("prop")]
rng.shuffle(cands)
pickups = [l for l in cands if any(r in ("foodPickup", "packagePickup") for r in roles(l))]
drops = [l for l in cands if l not in pickups]
chosen = []


def far_enough(p, minsep=12):
    return all((p[0] - q["pos"][0]) ** 2 + (p[1] - q["pos"][1]) ** 2 >= minsep ** 2 for q in chosen)


def add_poi(lot, pos, rs, y, access, name_role):
    item = CAT[lot["asset"]].get("poi", {}).get("items")
    chosen.append(dict(id=f"poi{len(chosen):04d}", lot=lot["id"], asset=lot["asset"], pos=pos, y=y, roles=rs,
                       access=access, district=lot["district"], items=item))


CAP = {"foodPickup": 100, "packagePickup": 60}
got = Counter()
for l in sorted(pickups, key=lambda l: "packagePickup" not in roles(l)):
    kind = "packagePickup" if "packagePickup" in roles(l) else "foodPickup"
    if got[kind] < CAP[kind] and far_enough(l["door"]):
        got[kind] += 1
        add_poi(l, l["door"], roles(l), l["y"], "street", "pickup")
    else:
        drops.append(l)  # restaurants and shops beyond the cap still receive packages
TARGET = 800
for l in drops:
    if l in pickups:
        rs = [r for r in roles(l) if r.startswith("dropoff")]
        if not rs or len(chosen) >= TARGET - 80 or not far_enough(l["door"]):
            continue
        add_poi(l, l["door"], rs, l["y"], "street", "drop")
        continue
    if len(chosen) >= TARGET - 80:
        break
    if far_enough(l["door"]):
        add_poi(l, l["door"], roles(l), l["y"], "street", "drop")
# food-only doors on stairs / steep lanes / alleys (<= 15% of food dropoffs)
side = [l for l in lots if l.get("upperDoor")] + [l for l in drops if l["facing"] in ("S", "N") and rng.random() < 0.25]
rng.shuffle(side)
for l in side:
    if len(chosen) >= TARGET:
        break
    pos = l.get("upperDoor") or [l["door"][0], l["rect"][3] if l["facing"] == "S" else l["rect"][1]]
    if far_enough(pos):
        add_poi(l, pos, ["dropoffFood"], l.get("upperY", l["y"]), "noCar", "side")
pois = chosen

# ---------------------------------------------------------------- stats
def is_building(l):
    e = CAT[l["asset"]]
    return not l.get("prop") and not l.get("open") and e.get("category") not in ("prop",) and not e["id"].startswith("missing/Container") and not e["id"].startswith("missing/Crane")


bl = [l for l in lots if is_building(l)]
st = dict(
    buildings=len(bl),
    buildingsByDistrict=Counter(l["district"] for l in bl),
    buildingsByCategory=Counter(CAT[l["asset"]]["category"] for l in bl),
    distinctModels=len(set(l["asset"] for l in bl)),
    missingPlacements=Counter(l["asset"] for l in lots if l["asset"].startswith("missing/")),
    pois=len(pois),
    poisByRole=Counter(r for p in pois for r in p["roles"]),
    foodPickups=sum(1 for p in pois if "foodPickup" in p["roles"]),
    packagePickups=sum(1 for p in pois if "packagePickup" in p["roles"]),
    noCarFoodDrops=sum(1 for p in pois if p["access"] == "noCar"),
    foodDrops=sum(1 for p in pois if "dropoffFood" in p["roles"]),
    blocksAlleys=sum(1 for r in roads if r["kind"] == "alley"),
    connectors=Counter(c["kind"] for c in connectors),
    trisPlaced=sum(CAT[l["asset"]].get("tris", 0) for l in bl),
    hospitals=[l["hospital"] for l in lots if l.get("hospital")],
    gas=[l["gas"] for l in lots if l.get("gas")],
)
json.dump(dict(lots=lots, roads=roads, connectors=connectors, areas=areas, pois=pois, labels=labels,
               levels=LEVELS, bands=BANDS), open(OUT, "w"))
json.dump(st, open(OUT.replace(".json", ".stats.json"), "w"), indent=1)
print(json.dumps(st, indent=1))

# ---------------------------------------------------------------- validation
def overlap(a, b):
    return a[0] < b[2] - 0.05 and b[0] < a[2] - 0.05 and a[1] < b[3] - 0.05 and b[1] < a[3] - 0.05
solid = [l for l in lots if not l.get("prop")]
bad = []
grid = defaultdict(list)
for i, l in enumerate(solid):
    r = l["rect"]
    for gx in range(int(r[0] // 50), int(r[2] // 50) + 1):
        for gz in range(int(r[1] // 50), int(r[3] // 50) + 1):
            grid[(gx, gz)].append(i)
seenp = set()
for cell in grid.values():
    for a in cell:
        for b in cell:
            if a < b and (a, b) not in seenp and overlap(solid[a]["rect"], solid[b]["rect"]):
                seenp.add((a, b)); bad.append((solid[a]["id"], solid[a]["asset"], solid[b]["id"], solid[b]["asset"]))
road_hits = []
for l in solid:
    for r in roads:
        if "rect" in r and overlap(l["rect"], r["rect"]):
            road_hits.append((l["id"], l["asset"], r["kind"], r.get("name")))
# package POIs: door within 30 m of a car road (rect roads, lane polyline sampled)
def car_dist(p):
    best = 1e9
    for r in roads:
        if r["access"] != "all":
            continue
        if "rect" in r:
            x0, z0, x1, z1 = r["rect"]
            dx = max(x0 - p[0], 0, p[0] - x1); dz = max(z0 - p[1], 0, p[1] - z1)
            best = min(best, math.hypot(dx, dz))
        else:
            best = min(best, min(math.hypot(p[0] - x, p[1] - z) - r["width"] / 2 for x, z in r["poly"]))
    return best
far_pkg = [(p["id"], p["asset"], round(car_dist(p["pos"]), 1)) for p in pois
           if any(r in ("packagePickup", "dropoffPackage") for r in p["roles"]) and car_dist(p["pos"]) > 30]
print("overlapping lots:", len(bad), bad[:8])
print("lots on roads:", len(road_hits), road_hits[:8])
print("package POIs > 30 m from a car road:", len(far_pkg), far_pkg[:8])
