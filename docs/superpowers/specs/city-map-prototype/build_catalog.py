"""Build map/catalog.json from the measured pack folders (sizes.csv).

Every model in the owner's packs gets one entry, keyed by a pack-prefixed id
(`mega/Bakery_01`). Building roles, items and weights are curated below; other
folders get a category from their folder and a `use` from the prop lists.
Missing types the design needs are added with status "missing".
"""
import csv, json, re, sys

SRC, OUT = sys.argv[1], sys.argv[2]
PACK = {"mega": "megatropolis", "trop": "tropical city"}

FOOD, PKG, DF, DP = "foodPickup", "packagePickup", "dropoffFood", "dropoffPackage"

# --- curated building table -------------------------------------------------
# (regex on "pack/Name", category, kind, roles, items, weightKg, districts, use)
B = [
 (r"mega/Airport_01", "landmark", "Airport terminal with runway, 72 m", [], None, None, [], "unused"),
 (r"mega/AutoService_01", "shop", "Auto repair garage", [PKG, DP], "car parts", [5, 45], ["industrial", "market"], "placed"),
 (r"mega/Bakery_01", "food", "Bakery, 3 floors", [FOOD, DP], "bread and pastries", None, ["market", "highstreet"], "placed"),
 (r"mega/Bank_01", "office", "Small bank branch", [DF, DP], "documents", None, ["downtown"], "placed"),
 (r"mega/Bank_02", "office", "Bank tower, 20 m", [DF, DP], "documents", None, ["downtown"], "placed"),
 (r"mega/(Basketball|Football)Playground_01", "leisure", "Fenced sports court", [DF], "team snacks", None, ["openlot"], "placed"),
 (r"(mega|trop)/Burgers_01", "food", "Burger restaurant", [FOOD, DP], "burger meals", None, ["market", "highstreet", "beach"], "placed"),
 (r"(mega|trop)/Cafe_01", "food", "Cafe with roof terrace", [FOOD, DP], "sandwiches and coffee", None, ["market", "highstreet", "downtown"], "placed"),
 (r"mega/Church_0[123]", "landmark", "Church with spire, 31 m", [DF, DP], "flowers and supplies", None, ["uptown", "bayview"], "placed"),
 (r"mega/Cinema_01", "leisure", "Cinema", [DF, DP], "film reels and staff meals", None, ["downtown", "highstreet"], "placed"),
 (r"mega/CityHall_0[123]", "civic", "City hall with steps", [DF, DP], "documents", None, ["downtown"], "placed"),
 (r"mega/Coffe_0[23]|trop/Coffee_0[23]", "food", "Coffee shop, 3 floors", [FOOD, DP], "coffee and pastries", None, ["market", "highstreet", "downtown"], "placed"),
 (r"mega/Construction_0[12]", "industrial", "Construction site (concrete frame)", [DP], "building materials", None, ["industrial", "apartments", "downtown"], "placed"),
 (r"(mega|trop)/Donuts_01", "food", "Donut shop", [FOOD, DP], "donuts", None, ["market", "highstreet", "beach"], "placed"),
 (r"mega/Factory_01", "prop", "Industrial chimney (no doors)", [], None, None, ["docks"], "prop"),
 (r"mega/Factory_0[24]", "prop", "Storage tank / silo (no doors)", [], None, None, ["docks", "industrial"], "prop"),
 (r"mega/Factory_0[35]", "industrial", "Factory with loading doors", [PKG, DP], "industrial goods", [10, 150], ["docks", "industrial"], "placed"),
 (r"mega/FireStation_01", "civic", "Fire station", [DF, DP], "equipment and crew meals", None, ["bayview", "midtown"], "placed"),
 (r"(mega|trop)/Gas_Station_0\d", "service", "Fuel canopy with pumps (no shop)", [], None, None, ["gas"], "placed"),
 (r"mega/Hospital_01", "civic", "Hospital with car park and helipad (spawn + safe zone)", [DF, DP], "medical supplies and staff meals", None, ["hospital"], "placed"),
 (r"(mega|trop)/Hotel_0[12]", "residential", "Small brick hotel, 3 floors", [DF, DP], "room service and luggage", None, ["market", "downtown"], "placed"),
 (r"mega/House_0[1-8]|trop/House_0[1-3]", "residential", "Brick walk-up, 4-5 floors", [DF, DP], None, None, ["bayview", "rowhouses", "highstreet", "slope"], "placed"),
 (r"mega/House_(09|1[0-2])|trop/House_04", "residential", "Narrow townhouse, 2 floors", [DF, DP], None, None, ["rowhouses", "uptown"], "placed"),
 (r"mega/House_1[3-5]", "residential", "Townhouse, 3 floors", [DF, DP], None, None, ["rowhouses", "uptown"], "placed"),
 (r"mega/House_1[6-8]", "residential", "Brownstone with stoop, 3 floors", [DF, DP], None, None, ["uptown", "rowhouses"], "placed"),
 (r"mega/House_(19|2[01])", "residential", "Walk-up with stoop, 4 floors", [DF, DP], None, None, ["bayview", "uptown"], "placed"),
 (r"mega/House_2[3-5]", "office", "Glass office block, 18 m", [DF, DP], None, None, ["downtown", "highstreet"], "placed"),
 (r"mega/House_2[6-8]|mega/OldHouse_09", "residential", "Loft over garages, 2 floors", [DF, DP], None, None, ["industrial", "rowhouses"], "placed"),
 (r"mega/House_3[12]|mega/OldHouse_0[34]", "residential", "L-shaped apartment block, 6 floors", [DF, DP], None, None, ["apartments", "bayview"], "placed"),
 (r"mega/House_3[34]|mega/OldHouse_0[12]", "residential", "Apartment block, 6 floors", [DF, DP], None, None, ["apartments", "bayview", "highstreet"], "placed"),
 (r"mega/House_3[7-9]", "office", "Glass office tower, 32 m", [DF, DP], None, None, ["downtown"], "placed"),
 (r"mega/House_4[0-2]", "office", "Spire tower, 64 m (skyline landmark)", [DF, DP], None, None, ["downtown"], "placed"),
 (r"mega/House_4[3-5]", "office", "Glass office tower, 38 m", [DF, DP], None, None, ["downtown"], "placed"),
 (r"mega/House_4[6-8]", "office", "Glass office tower, 26 m", [DF, DP], None, None, ["downtown"], "placed"),
 (r"mega/House_(49|5[0-2])", "office", "Wide glass tower 24 x 24 m, 39 m", [DF, DP], None, None, ["downtown"], "placed"),
 (r"mega/Office_01", "office", "Small office building", [DF, DP], "documents", None, ["downtown", "highstreet", "industrial"], "placed"),
 (r"mega/OldHouse_0[5-8]", "residential", "Old brick walk-up, 4-5 floors", [DF, DP], None, None, ["bayview", "rowhouses", "slope"], "placed"),
 (r"mega/OldHouse_1[0-2]|mega/SmallHouse_(0\d|1[0-5])|trop/SmallHouse_0[1-3]", "shop", "Single-storey storefront with awning", [DP], "shop stock", None, ["market", "highstreet", "uptown", "beach"], "placed"),
 (r"mega/OldHouse_13|mega/SmallMarket_0[1-4]", "food", "Corner kiosk", [FOOD], "snacks and drinks", None, ["market", "highstreet", "beach", "gas"], "placed"),
 (r"mega/OldHouse_1[4-6]|mega/SuburbHouse_0\d", "residential", "Detached house with porch and garage", [DF, DP], None, None, ["hillcrest"], "placed"),
 (r"(mega|trop)/ParkingBox_01", "prop", "Parking attendant booth", [], None, None, ["openlot"], "prop"),
 (r"mega/ParkingZone_01", "service", "Two-deck car park, 24 x 12 m", [], None, None, ["downtown", "openlot"], "placed"),
 (r"(mega|trop)/Pizza_01", "food", "Pizzeria", [FOOD, DP], "pizzas", None, ["market", "highstreet", "beach"], "placed"),
 (r"mega/Police_01", "civic", "Police station with helipad", [DF, DP], "documents and crew meals", None, ["downtown", "midtown"], "placed"),
 (r"mega/Station_01", "industrial", "Rail station / freight shed", [PKG, DP], "rail parcels", [1, 50], ["docks"], "placed"),
 (r"mega/Supermarket_0[12]|trop/Supermarket_01", "shop", "Neighbourhood supermarket", [PKG, DP], "grocery boxes", [2, 20], ["market", "highstreet", "uptown", "apartments"], "placed"),
 (r"mega/Supermarket_0[34]", "shop", "Large 24/7 store, 24 m", [PKG, DP], "grocery and household boxes", [2, 25], ["industrial", "apartments", "market"], "placed"),
 (r"mega/Sushi_01", "food", "Sushi bar, 3 floors", [FOOD, DP], "sushi platters", None, ["market", "downtown", "harbor"], "placed"),
 (r"trop/Bar_0[12]", "food", "Beach bar kiosk", [FOOD], "smoothies and snacks", None, ["beach"], "placed"),
 (r"trop/Hotel_0[3-5]", "residential", "Two-storey motel strip", [DF, DP], "room service and luggage", None, ["beach", "harbor"], "placed"),
 (r"trop/Hotel_0[6-8]", "residential", "Beach resort hotel, 39 x 27 m", [DF, DP], "room service and luggage", None, ["beach"], "placed"),
 (r"trop/Hotel_(09|1[01])", "residential", "Seaside hotel, 4 floors", [DF, DP], "room service and luggage", None, ["beach", "harbor"], "placed"),
 (r"trop/House_0[56]", "residential", "Beach cottage", [DF, DP], None, None, ["beach", "harbor"], "placed"),
 (r"trop/House_0[78]", "residential", "Seaside apartment block, 4 floors", [DF, DP], None, None, ["harbor", "beach"], "placed"),
 (r"trop/Lighthouse_01", "landmark", "Lighthouse with keeper's hut", [], None, None, ["harbor"], "placed"),
 (r"trop/Towels_cabin_01", "prop", "Beach towel kiosk", [], None, None, ["beach"], "prop"),
 (r"trop/Wok_01", "food", "Wok noodle shop, 3 floors", [FOOD, DP], "noodle boxes", None, ["market", "highstreet", "harbor"], "placed"),
]

# --- curated non-building use lists ------------------------------------------
USE = [
 (r"road/(Road|MobileRoad|RoadPart)_", "road", "Road tiles (12 m streets, 15 m avenues, crossings, markings)"),
 (r"road/Tile_", "road", "3 m pavement tiles: sidewalks, alleys, plazas"),
 (r"road/(BG|ParkingBG)_", "road", "Ground and car-park base tiles"),
 (r"road/Railway_", "road", "Rail track, waterfront freight line"),
 (r"road/Tunel_", "road", "Tunnel portals (optional, under slope bands)"),
 (r"road/(Sand|Seafront)_", "road", "Beach sand and seafront edge"),
 (r"nature/(Terrain|Hill)_", "terrain", "Terrain tiles and hills for parks and the ridge"),
 (r"nature/Mountain_", "terrain", "Backdrop mountains beyond the north cliff"),
 (r"nature/Water_01", "terrain", "Bay water plane, 500 m"),
 (r"nature/(Tree|PalmTree|BananaTree|Plant|Grass|Flower|Rock|Reeds|Stump|Log|Pond|Mud)", "nature", "Street trees, park and garden planting"),
 (r"props/(Bench|Light|Lantern|BusStation|Hydrant|Mailbox|PhoneBooth|Trash|Garbage|Barrier|Parking|RoadSign|ATM|Ad|Banner|Fence|FlowerBed|Flowerbed|Fountain|Pot|PowerLines|Luke|Umbrella|Table|Chair|Menu|Flags|Hotel_sign|Playground|Basketball|Sportsground|Pool|Box|Pallet|Barrel|Grill|Doghouse|HousePart|HouseStairs|Stairs|SuperMarketPart|Circle|Lounger|WC|Windmill)", "prop", "Street and lot dressing"),
 (r"props/(Pier|Plank|Buoy|Kayak|Oar|FishingRod|Lifeguard|Beach_chair|Towel|Sand_castle|Surf_board|Volleyball|Water_slide|Ferris_wheel|Hammock|HammockWood|Cooler|Bucket|Shovel|Rake|Mattress|Rubber|Sunscreen|Mask|Torch|Fire|Fireplace|Bar_chair|Ball|Mold|HouseFloor)", "prop", "Beach, pier and harbor dressing"),
 (r"vehicles/(Car|OldCar|Bus)_", "vehicle", "Parked and decorative road vehicles; the player car is chosen from these in the vehicles sub-project"),
 (r"vehicles/(Cargo_ship|Ship|Yacht|Motorboat|Water_scooter)", "vehicle", "Moored and anchored boats in the bay"),
 (r"vehicles/(Train)_", "vehicle", "Parked freight train at the rail yard"),
 (r"food/", "orderItem", "Order item models for the phone and carried bags"),
]
UNUSED = [
 (r"vehicles/(Plane|AirBalloon|Wheel)_", "Not used (no airport; wheels are parts)"),
 (r"nature/(Cloud|Corn|CornPlant|Tomato|TomatoPlant|Pumpkin|Apple|Orange|Mushroom|Branch|Starfish)", "Not used (farm or tiny props)"),
 (r"props/(Bed|Cup|Plate|Food)_", "Not used (tiny interior props)"),
 (r"fx/", "Not used: particle systems did not convert to geometry"),
]

MISSING = [
 ("PostOffice_01", "shop", "Post office / parcel depot", [PKG, DP], "parcels", [1, 30], [12, 8, 9]),
 ("Warehouse_01", "industrial", "Dockside warehouse with loading bays", [PKG, DP], "pallets and crates", [10, 150], [24, 9, 15]),
 ("School_01", "civic", "School with yard", [DF, DP], "lunches and supplies", None, [24, 10, 15]),
 ("Skateboard_01", "courierVehicle", "Courier skateboard", [], None, None, [0.25, 0.15, 0.85]),
 ("Bicycle_01", "courierVehicle", "Courier bicycle with rear box", [], None, None, [0.6, 1.1, 1.8]),
 ("Motorbike_01", "courierVehicle", "Courier motorbike with top box", [], None, None, [0.8, 1.2, 2.0]),
 ("Container_01", "prop", "Shipping container (stackable)", [], None, None, [2.4, 2.6, 6.1]),
 ("Crane_01", "prop", "Dockside container crane", [], None, None, [12, 40, 20]),
]


def num(s):
    try:
        v = float(s)
        return None if v != v or v in (float("inf"), float("-inf")) else v
    except ValueError:
        return None


rows = list(csv.reader(open(SRC)))
entries, seen = [], {}
for pk, folder, name, w, h, d, cx, cz, miny, tris, size in rows:
    pid = f"{pk}/food/{name}" if folder == "food" else f"{pk}/{name}"
    assert pid not in {x["id"] for x in entries}, pid
    path = f"{PACK[pk]} {folder}/{name}.glb"
    dims = [num(w), num(h), num(d)]
    e = {"id": pid, "file": path, "folder": folder}
    if dims[0] is None:
        e.update(category="fx" if folder == "fx" else folder, use="unused", status="empty",
                 notes="No geometry after conversion")
        entries.append(e)
        continue
    e["size"] = {"w": dims[0], "h": dims[1], "d": dims[2]}
    e["pivot"] = {"x": num(cx), "z": num(cz), "minY": num(miny)}
    e["tris"] = int(tris)
    e["bytes"] = int(size)
    sig = (folder, dims[0], dims[1], dims[2], int(tris))
    if sig in seen and seen[sig].split("/")[0] != pk:
        e["duplicateOf"] = seen[sig]
    seen.setdefault(sig, pid)
    if folder == "buildings":
        for rx, cat, kind, roles, items, wt, dist, use in B:
            if re.fullmatch(rx, pid):
                e.update(category=cat, kind=kind, use=use, districts=dist)
                if roles:
                    e["poi"] = {"roles": roles}
                    if items:
                        e["poi"]["items"] = items
                    if wt:
                        e["poi"]["weightKg"] = wt
                break
        else:
            raise SystemExit(f"unclassified building {pid}")
    else:
        key = f"{folder}/{name}"
        for rx, cat, note in USE:
            if re.match(rx, key):
                e.update(category=cat, use="placed" if cat not in ("prop", "nature") else "prop", notes=note)
                break
        else:
            for rx, note in UNUSED:
                if re.match(rx, key):
                    e.update(category=folder, use="unused", notes=note)
                    break
            else:
                e.update(category=folder, use="unused", notes="Not needed by the layout")
    entries.append(e)

for name, cat, kind, roles, items, wt, size in MISSING:
    e = {"id": f"missing/{name}", "file": None, "category": cat, "kind": kind, "use": "placed",
         "status": "missing", "size": {"w": size[0], "h": size[1], "d": size[2]},
         "notes": "Needed by the design; not in the packs. Placeholder until a model is supplied."}
    if roles:
        e["poi"] = {"roles": roles, "items": items}
        if wt:
            e["poi"]["weightKg"] = wt
    entries.append(e)

json.dump({"version": 1, "units": "metres", "sourceFolder": "assets/packs (git-ignored)",
           "packs": {"mega": "megatropolis", "trop": "tropical city"},
           "entries": entries}, open(OUT, "w"), indent=1)

from collections import Counter
print(len(entries), Counter(e.get("use") for e in entries), Counter(e.get("status", "present") for e in entries))
print("buildings by category", Counter(e["category"] for e in entries if e.get("folder") == "buildings"))
print("dups", sum(1 for e in entries if "duplicateOf" in e))
