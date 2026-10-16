import * as THREE from 'three';
import { bandFor, type AccessKind, type Band, type CityMap, type PoiRole, type Vec3 } from '@dm/shared';
import { accessZoneColors, cssHex, mapDebugColors, mapDebugOverlay } from '../render/palette';

/** A label's texture and its width / height. */
export interface LabelImage {
  texture: THREE.Texture;
  aspect: number;
}

/** Paints one label (text with a `color` accent). The default draws on a canvas; tests pass a stub (no DOM in Node). */
export type LabelPainter = (text: string, color: number) => LabelImage;

/** What the F4 view reads from config: lot labels show within `labelRadius` m of the player (city.labelRadius). */
export interface MapDebugOptions {
  labelRadius: number;
}

// Art dimensions. Beams and lines in metres; labels in canvas pixels, and in screen units for their size (sprites
// without size attenuation: the label height is this fraction of the camera's view height at distance 1).
const BEAM_WIDTH = 0.6;
const BEAM_HEIGHT = 24;
const LABEL_LIFT = 1.5;
const LABEL_SCREEN_HEIGHT = 0.028;
const OVERLAY_LIFT = 0.15;
const FONT_PX = 26;
const PAD_PX = 8;
const SWATCH_PX = 8;
const GRID_OPACITY = 0.5;
const CHUNK_OPACITY = 0.28;
/** The beams are recoloured once the player has moved this far (m) since the last time. */
const RECOLOR_STEP = 1;

/** Canvas label: dark plate, accent swatch and border, white text. */
export const paintCanvasLabel: LabelPainter = (text, color) => {
  const font = `600 ${FONT_PX}px system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('map debug: no 2D canvas context');
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + SWATCH_PX + PAD_PX * 3;
  canvas.height = FONT_PX + PAD_PX * 2;
  ctx.font = font; // resizing the canvas resets its state
  ctx.fillStyle = 'rgba(14, 22, 26, 0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = cssHex(color);
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  ctx.fillStyle = cssHex(color);
  ctx.fillRect(PAD_PX, PAD_PX, SWATCH_PX, FONT_PX);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SWATCH_PX + PAD_PX * 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, aspect: canvas.width / canvas.height };
};

/** Each lot's POI roles (its door and upper door together, first-seen order, no repeats); lots without POIs are absent. */
export function lotRoles(city: CityMap): Map<string, PoiRole[]> {
  const out = new Map<string, PoiRole[]>();
  for (const p of city.pois) {
    if (!p.lotId) continue;
    const roles = out.get(p.lotId) ?? [];
    for (const r of p.roles) if (!roles.includes(r)) roles.push(r);
    out.set(p.lotId, roles);
  }
  return out;
}

/** A lot's debug label (Decision 7: the placeholder's sign): `lot-L1-4-1-7 · foodPickup, dropoffFood`, or just the id. */
export function lotLabel(id: string, roles: readonly PoiRole[]): string {
  return roles.length > 0 ? `${id} · ${roles.join(', ')}` : id;
}

/** A lot as the view draws it: where its label and beam stand, its label, and its sprite once it has been near. */
interface LotEntry {
  /** Rect centre at the lot's base height (distances are measured from here). */
  center: Vec3;
  /** Where the label stands: the door (on the street side), else the centre. */
  anchor: Vec3;
  label: string;
  hasRoles: boolean;
  sprite: THREE.Sprite | null;
}

const horizontal = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The F4 map debug view over the city (Decision 7): a label with the id and POI roles of each lot within
 * `labelRadius` of the player; a beam on every lot with POI roles, coloured by the straight-line distance band from
 * the player (the map's order bands: Short teal, Medium amber, Long violet); the city's chunk grid with the
 * physics-loaded chunks tinted (both at the player's height); and the access-zone outlines coloured by kind. Hidden until setVisible(true); update()
 * works only while visible.
 *
 * Cost when shown: one draw call for all beams (an InstancedMesh), one for the grid, one for the chunk tints, one for
 * the zone outlines, and one per visible label sprite. Labels are painted once per lot. The labels, grid and
 * tints overlay the scene (no depth test), so they read through buildings; the beams and zone outlines are depth-tested
 * and fog-free.
 */
export class MapDebugView {
  readonly group = new THREE.Group();
  private readonly lots: LotEntry[];
  /** Indices into `lots` of the lots with roles, in beam instance order. */
  private readonly marked: number[];
  private readonly beams: THREE.InstancedMesh;
  private readonly tints: THREE.InstancedMesh;
  private readonly labels = new THREE.Group();
  /** The chunk grid and the loaded-chunk tints, kept at the player's height (the terraces span 2 to 48 m). */
  private readonly chunkLayer = new THREE.Group();
  private readonly zoneCounts: Partial<Record<AccessKind, number>> = {};
  private readonly bandCounts: Record<Band, number> = { short: 0, medium: 0, long: 0 };
  /** Indices into `lots` of the labels shown, in lot order. */
  private shown: number[] = [];
  private chunks: string[] = [];
  private lastColor: Vec3 | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly city: CityMap,
    private readonly opts: MapDebugOptions,
    private readonly paint: LabelPainter = paintCanvasLabel,
  ) {
    this.group.name = 'map-debug';
    this.group.visible = false;
    const roles = lotRoles(city);
    this.lots = city.layout.lots.map((lot) => {
      const r = lot.rect;
      const own = roles.get(lot.id) ?? [];
      return {
        center: { x: (r.minX + r.maxX) / 2, y: lot.y, z: (r.minZ + r.maxZ) / 2 },
        anchor: lot.door ? { ...lot.door } : { x: (r.minX + r.maxX) / 2, y: lot.y, z: (r.minZ + r.maxZ) / 2 },
        label: lotLabel(lot.id, own),
        hasRoles: own.length > 0,
        sprite: null,
      };
    });
    this.marked = this.lots.flatMap((l, i) => (l.hasRoles ? [i] : []));

    const beamGeo = new THREE.BoxGeometry(BEAM_WIDTH, BEAM_HEIGHT, BEAM_WIDTH).translate(0, BEAM_HEIGHT / 2, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const beamCount = Math.max(1, this.marked.length);
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, beamCount);
    this.beams.name = 'map-debug-beams';
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(beamCount * 3), 3);
    const m = new THREE.Matrix4();
    this.marked.forEach((k, i) => {
      const c = this.lots[k]!.center;
      this.beams.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z));
    });
    this.beams.count = this.marked.length;

    const tintGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
    const tintMat = overlayMaterial(CHUNK_OPACITY);
    tintMat.color.setHex(mapDebugOverlay.loadedChunk);
    tintMat.side = THREE.DoubleSide;
    // Room for every chunk of the map plus a ring around it (the pager loads by distance, also past the edge).
    const perSide = Math.ceil(city.size / city.chunkSize) + 2;
    this.tints = new THREE.InstancedMesh(tintGeo, tintMat, perSide * perSide);
    this.tints.name = 'map-debug-chunks';
    this.tints.count = 0;
    this.tints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (const mesh of [this.beams, this.tints]) {
      mesh.frustumCulled = false; // instances span the city; bounds would have to be recomputed as they change
      mesh.renderOrder = 20;
    }
    this.labels.name = 'map-debug-labels';
    this.chunkLayer.add(this.chunkGrid(), this.tints);
    this.group.add(this.chunkLayer, this.zoneOutlines(), this.beams, this.labels);
    scene.add(this.group);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Per frame while visible: labels and bands from the player's feet `center`, and the physics-loaded chunk keys. */
  update(center: Vec3, loaded: Iterable<string>): void {
    if (!this.group.visible) return;
    this.chunkLayer.position.y = center.y;
    this.updateLabels(center);
    this.updateBands(center);
    this.updateChunks(loaded);
  }

  /** Tests and the debug hook: what is shown (label texts in lot order). */
  debug(): {
    visible: boolean;
    labels: string[];
    beams: number;
    bands: Record<Band, number>;
    chunks: number;
    zones: Partial<Record<AccessKind, number>>;
  } {
    return {
      visible: this.group.visible,
      labels: this.shown.map((i) => this.lots[i]!.label),
      beams: this.beams.count,
      bands: { ...this.bandCounts },
      chunks: this.tints.count,
      zones: { ...this.zoneCounts },
    };
  }

  private updateLabels(center: Vec3): void {
    const r = this.opts.labelRadius;
    const next: number[] = [];
    this.lots.forEach((l, i) => {
      if (Math.abs(l.center.x - center.x) <= r && Math.abs(l.center.z - center.z) <= r && horizontal(l.center, center) <= r) next.push(i);
    });
    if (next.length === this.shown.length && next.every((k, i) => this.shown[i] === k)) return;
    for (const i of this.shown) this.lots[i]!.sprite!.visible = false;
    for (const k of next) {
      const l = this.lots[k]!;
      l.sprite ??= this.sprite(l.label, l.hasRoles ? mapDebugColors.short : mapDebugOverlay.plainLot, l.anchor);
      l.sprite.visible = true;
    }
    this.shown = next;
  }

  private updateBands(center: Vec3): void {
    if (this.lastColor && horizontal(this.lastColor, center) < RECOLOR_STEP) return;
    this.lastColor = { ...center };
    const bands = this.city.orderRules.bands;
    const c = new THREE.Color();
    this.bandCounts.short = this.bandCounts.medium = this.bandCounts.long = 0;
    this.marked.forEach((k, i) => {
      const band = bandFor(horizontal(this.lots[k]!.center, center), bands);
      this.bandCounts[band]++;
      this.beams.setColorAt(i, c.setHex(mapDebugColors[band]));
    });
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }

  private updateChunks(loaded: Iterable<string>): void {
    const keys = [...loaded].slice(0, this.tints.instanceMatrix.count);
    if (keys.length === this.chunks.length && keys.every((k, i) => this.chunks[i] === k)) return;
    const size = this.city.chunkSize;
    const m = new THREE.Matrix4();
    keys.forEach((key, i) => {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      m.makeScale(size, 1, size).setPosition(cx * size, OVERLAY_LIFT, cz * size);
      this.tints.setMatrixAt(i, m);
    });
    this.tints.count = keys.length;
    this.tints.instanceMatrix.needsUpdate = true;
    this.chunks = keys;
  }

  /** A screen-sized label sprite LABEL_LIFT m above `at`, its bottom edge centred there. */
  private sprite(text: string, color: number, at: Vec3): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0);
    s.renderOrder = 21;
    s.position.set(at.x, at.y + LABEL_LIFT, at.z);
    const { texture, aspect } = this.paint(text, color);
    mat.map = texture;
    s.scale.set(LABEL_SCREEN_HEIGHT * aspect, LABEL_SCREEN_HEIGHT, 1);
    this.labels.add(s);
    return s;
  }

  /** The city's chunk grid (one draw call): a line every chunkSize across the map, just above the chunk layer's height. */
  private chunkGrid(): THREE.LineSegments {
    const size = this.city.chunkSize;
    const n = Math.ceil(this.city.size / size);
    const hi = n * size;
    const pts: number[] = [];
    for (let k = 0; k <= n; k++) {
      const v = k * size;
      pts.push(v, OVERLAY_LIFT, 0, v, OVERLAY_LIFT, hi); // along z at x = v
      pts.push(0, OVERLAY_LIFT, v, hi, OVERLAY_LIFT, v); // along x at z = v
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: mapDebugOverlay.grid, transparent: true, opacity: GRID_OPACITY, depthTest: false, depthWrite: false, fog: false });
    const grid = new THREE.LineSegments(geo, mat);
    grid.name = 'map-debug-grid';
    grid.renderOrder = 20;
    grid.frustumCulled = false;
    return grid;
  }

  /** Every access zone's rect outline at its floor, coloured by kind (one draw call); counts them by kind. */
  private zoneOutlines(): THREE.LineSegments {
    const pts: number[] = [];
    const cols: number[] = [];
    const c = new THREE.Color();
    for (const z of this.city.accessZones) {
      this.zoneCounts[z.kind] = (this.zoneCounts[z.kind] ?? 0) + 1;
      const { minX, minZ, maxX, maxZ } = z.rect;
      const y = z.minY + OVERLAY_LIFT;
      const corners = [
        [minX, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [minX, maxZ],
      ] as const;
      c.setHex(accessZoneColors[z.kind]);
      for (let i = 0; i < 4; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        pts.push(a[0], y, a[1], b[0], y, b[1]);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    // Depth-tested (unlike the other overlays): outlines over the whole city drawn through every building are noise.
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false, fog: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = 'map-debug-zones';
    lines.renderOrder = 20;
    lines.frustumCulled = false;
    return lines;
  }
}

/** Unlit, fog-free, drawn over the scene (no depth test): debug overlays read through buildings. */
function overlayMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
}
