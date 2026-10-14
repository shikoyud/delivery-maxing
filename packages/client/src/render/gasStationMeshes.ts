import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ridingConfig, type MapData } from '@dm/shared';
import { palette } from './palette';
import { paint } from './vehicles/vehicleMeshes';

// Art dimensions (metres). The canopy and the pump islands are greybox solids (map/greybox.json); this adds the sign
// on each canopy and a glow on the ground around each pump point, as wide as the refuel reach (riding.refuel.pumpRadius).
/** The sign panel stands on two posts `lift` above the canopy, so it shows over the canopy edge from the street. */
const SIGN = { width: 3.6, height: 1.1, depth: 0.16, lift: 0.6, post: 0.14 };
/** Letter cell width and height, stroke width, gap between letters and how far the letters stand off the panel. */
const LETTER = { width: 0.55, height: 0.75, stroke: 0.13, gap: 0.2, relief: 0.04 };
const GLOW_OPACITY = 0.3;
const DECAL_Y = 0.03;

type Rect = [x: number, y: number, w: number, h: number];

/** Block letters as rectangles in a cell of LETTER.width × LETTER.height (origin bottom left). */
function letters(): Rect[][] {
  const { width: W, height: H, stroke: s } = LETTER;
  const left: Rect = [0, 0, s, H];
  const top: Rect = [0, H - s, W, s];
  const mid: Rect = [0, H / 2 - s / 2, W * 0.8, s];
  const bottom: Rect = [0, 0, W, s];
  return [
    [left, top, mid], // F
    [left, [W - s, 0, s, H], bottom], // U
    [left, top, mid, bottom], // E
    [left, bottom], // L
  ];
}

/** The sign: a teal panel on two posts standing on the canopy (y 0) with FUEL in cream on its front and back. */
function signGeometry(): THREE.BufferGeometry {
  const parts = [paint(new THREE.BoxGeometry(SIGN.width, SIGN.height, SIGN.depth).translate(0, SIGN.lift + SIGN.height / 2, 0), palette.fuelSign)];
  for (const x of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(SIGN.post, SIGN.lift, SIGN.post).translate((x * SIGN.width) / 3, SIGN.lift / 2, 0), palette.trim));
  }
  const word = letters();
  const span = word.length * LETTER.width + (word.length - 1) * LETTER.gap;
  const y0 = SIGN.lift + (SIGN.height - LETTER.height) / 2;
  const face: THREE.BufferGeometry[] = [];
  word.forEach((rects, i) => {
    const x0 = -span / 2 + i * (LETTER.width + LETTER.gap);
    for (const [x, y, w, h] of rects) {
      face.push(new THREE.BoxGeometry(w, h, LETTER.relief).translate(x0 + x + w / 2, y0 + y + h / 2, SIGN.depth / 2 + LETTER.relief / 2));
    }
  });
  for (const g of face) {
    parts.push(paint(g.clone(), palette.fuelLetters));
    // The back reads the same way round from behind.
    parts.push(paint(g.rotateY(Math.PI), palette.fuelLetters));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

/**
 * Gas stations (spec §4.4 refuelling): a "FUEL" sign on top of each station's canopy (the solid `<id>-canopy`) and a
 * soft glow disc on each pump point showing where a stopped vehicle refuels. Two InstancedMeshes for every station
 * together (the sign casts a shadow; the glow does not).
 */
export function buildGasStationMeshes(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gas-stations';
  const canopies = map.gasStations.flatMap((s) => map.solids.filter((x) => x.id === `${s.id}-canopy`));
  const signs = new THREE.InstancedMesh(signGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, canopies.length));
  signs.name = 'fuel-signs';
  signs.castShadow = true;
  signs.receiveShadow = false;
  signs.count = canopies.length;
  const m = new THREE.Matrix4();
  canopies.forEach((c, i) => signs.setMatrixAt(i, m.makeTranslation(c.center.x, c.center.y + c.size.y / 2, c.center.z)));

  const pumps = map.gasStations.flatMap((s) => s.pumps);
  const glows = new THREE.InstancedMesh(
    new THREE.CircleGeometry(ridingConfig.refuel.pumpRadius, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: palette.pumpGlow,
      transparent: true,
      opacity: GLOW_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    Math.max(1, pumps.length),
  );
  glows.name = 'pump-glows';
  glows.count = pumps.length;
  pumps.forEach((p, i) => glows.setMatrixAt(i, m.makeTranslation(p.x, p.y + DECAL_Y, p.z)));
  for (const mesh of [signs, glows]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
