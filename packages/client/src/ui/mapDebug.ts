import * as THREE from 'three';
import {
  bandFor,
  type BandLimits,
  type ChunkKey,
  type CityMap,
  type PoiRow,
  type PoiTableFile,
  type ThiefState,
  type Vec3,
} from '@dm/shared';
import type { MapDebugConfig } from '../clientConfig';
import { cssHex, mapDebugColors, mapDebugOverlay } from '../render/palette';

/** A POI's debug colour (its distance band from the HUB, red when unreachable) and label text. */
export interface PoiMarkerStyle {
  color: number;
  label: string;
}

/**
 * The F4 view's colour and label for a POI table row (spec §5.2): Short teal, Medium amber, Long violet by the one-way
 * `fromHub` path metres in `bands` (bandFor, as the Order Board), red when unreachable. Label:
 * `poi-downtown-07 · 640 m · elevated`; an unreachable row reads `… · unreachable` after its metres (left out when there
 * is no path from the HUB at all).
 */
export function poiMarkerStyle(row: PoiRow, bands: BandLimits): PoiMarkerStyle {
  const parts = [row.id];
  if (row.fromHub >= 0) parts.push(`${Math.round(row.fromHub)} m`);
  if (!row.reachable) parts.push('unreachable');
  if (row.elevated) parts.push('elevated');
  const color = row.reachable ? mapDebugColors[bandFor(row.fromHub, bands)] : mapDebugColors.unreachable;
  return { color, label: parts.join(' · ') };
}

/** A label's texture and its width / height. */
export interface LabelImage {
  texture: THREE.Texture;
  aspect: number;
}

/** Paints one label (text with a `color` accent). The default draws on a canvas; tests pass a stub (no DOM in Node). */
export type LabelPainter = (text: string, color: number) => LabelImage;

// Art dimensions. Beams and lines in metres; labels in canvas pixels, and in screen units for their size (sprites
// without size attenuation: the label height is this fraction of the camera's view height at distance 1).
const BEAM_WIDTH = 0.6;
const BEAM_HEIGHT = 24;
const LABEL_LIFT = 1;
const LABEL_SCREEN_HEIGHT = 0.032;
const THIEF_LABEL_LIFT = 2.6;
const OVERLAY_Y = 0.15;
const FONT_PX = 26;
const PAD_PX = 8;
const SWATCH_PX = 8;
const GRID_OPACITY = 0.6;
const CHUNK_OPACITY = 0.28;

/** Canvas label: dark plate, band-coloured swatch and border, white text. */
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

/** A POI with a table row: where it stands, its style, and its label sprite once it has been near the player. */
interface PoiEntry {
  position: Vec3;
  style: PoiMarkerStyle;
  sprite: THREE.Sprite | null;
}

interface ThiefLabel {
  sprite: THREE.Sprite;
  text: string;
}

const horizontal = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The F4 map debug view (spec §5.2): over the city, a beam and a label (`poiMarkerStyle`) for each POI within
 * `cfg.radius` of the player, the chunk grid around it with the physics-loaded chunks tinted, and a mode / chase-time label over
 * each nearby thief. Hidden until setVisible(true); update() only while visible.
 *
 * Cost when shown: one draw call for all beams (an InstancedMesh), one for the grid, one for the chunk tints, and one
 * per visible label sprite. Labels are painted once per POI (thieves: when their text changes). The labels, grid and
 * tints overlay the scene (no depth test), so they read through buildings; the beams are solid and fog-free.
 */
export class MapDebugView {
  readonly group = new THREE.Group();
  private readonly entries: PoiEntry[];
  private readonly beams: THREE.InstancedMesh;
  private readonly tints: THREE.InstancedMesh;
  private readonly labels = new THREE.Group();
  /** Chunk grid lines over the chunks within the radius, moved along with the player's chunk. */
  private readonly grid: THREE.LineSegments;
  private readonly thiefLabels = new Map<string, ThiefLabel>();
  /** Indices into `entries` of the beams drawn, in instance order. */
  private shown: number[] = [];
  private chunks: ChunkKey[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly city: CityMap,
    table: PoiTableFile,
    bands: BandLimits,
    private readonly cfg: MapDebugConfig,
    private readonly paint: LabelPainter = paintCanvasLabel,
  ) {
    this.group.name = 'map-debug';
    this.group.visible = false;
    const where = new Map(city.pois.map((p) => [p.id, p.position]));
    this.entries = table.pois.flatMap((row) => {
      const position = where.get(row.id);
      return position ? [{ position, style: poiMarkerStyle(row, bands), sprite: null }] : [];
    });

    const beamGeo = new THREE.BoxGeometry(BEAM_WIDTH, BEAM_HEIGHT, BEAM_WIDTH).translate(0, BEAM_HEIGHT / 2, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, Math.max(1, this.entries.length));
    this.beams.name = 'map-debug-beams';
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.entries.length) * 3), 3);

    const tintGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
    const tintMat = overlayMaterial(CHUNK_OPACITY);
    tintMat.color.setHex(mapDebugOverlay.loadedChunk);
    tintMat.side = THREE.DoubleSide;
    // Room for every chunk of the map plus a ring around it (the pager loads by distance, also past the edge).
    const perSide = Math.ceil(city.size / city.chunkSize) + 2;
    this.tints = new THREE.InstancedMesh(tintGeo, tintMat, perSide * perSide);
    this.tints.name = 'map-debug-chunks';

    for (const mesh of [this.beams, this.tints]) {
      mesh.count = 0;
      mesh.frustumCulled = false; // the instances change; bounds would have to be recomputed each time
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 20;
    }
    this.labels.name = 'map-debug-labels';
    this.grid = this.chunkGrid();
    this.group.add(this.grid, this.tints, this.beams, this.labels);
    scene.add(this.group);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Per frame while visible: POIs and thieves near the player's feet `center`, and the physics-loaded chunks. */
  update(center: Vec3, loaded: ReadonlySet<ChunkKey>, thieves: readonly ThiefState[]): void {
    if (!this.group.visible) return;
    const size = this.city.chunkSize;
    this.grid.position.set(Math.floor(center.x / size) * size, 0, Math.floor(center.z / size) * size);
    this.updatePois(center);
    this.updateChunks(loaded);
    this.updateThieves(center, thieves);
  }

  /** Tests and the e2e hook: what is shown (label texts in POI-table order; thief labels in thieves order). */
  debug(): { visible: boolean; beams: number; labels: string[]; chunks: number; thieves: string[] } {
    return {
      visible: this.group.visible,
      beams: this.beams.count,
      labels: this.shown.map((i) => this.entries[i]!.style.label),
      chunks: this.tints.count,
      thieves: [...this.thiefLabels.values()].filter((l) => l.sprite.visible).map((l) => l.text),
    };
  }

  private updatePois(center: Vec3): void {
    const next: number[] = [];
    this.entries.forEach((e, i) => {
      if (horizontal(e.position, center) <= this.cfg.radius) next.push(i);
    });
    if (next.length === this.shown.length && next.every((k, i) => this.shown[i] === k)) return;
    for (const i of this.shown) this.entries[i]!.sprite!.visible = false;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    next.forEach((k, i) => {
      const e = this.entries[k]!;
      m.makeTranslation(e.position.x, e.position.y, e.position.z);
      this.beams.setMatrixAt(i, m);
      this.beams.setColorAt(i, c.setHex(e.style.color));
      e.sprite ??= this.sprite(e.style.label, e.style.color, e.position, BEAM_HEIGHT + LABEL_LIFT);
      e.sprite.visible = true;
    });
    this.beams.count = next.length;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.instanceColor!.needsUpdate = true;
    this.shown = next;
  }

  private updateChunks(loaded: ReadonlySet<ChunkKey>): void {
    const keys = [...loaded].slice(0, this.tints.instanceMatrix.count);
    if (keys.length === this.chunks.length && keys.every((k, i) => this.chunks[i] === k)) return;
    const size = this.city.chunkSize;
    const m = new THREE.Matrix4();
    keys.forEach((key, i) => {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      m.makeScale(size, 1, size).setPosition(cx * size, OVERLAY_Y, cz * size);
      this.tints.setMatrixAt(i, m);
    });
    this.tints.count = keys.length;
    this.tints.instanceMatrix.needsUpdate = true;
    this.chunks = keys;
  }

  private updateThieves(center: Vec3, thieves: readonly ThiefState[]): void {
    for (const l of this.thiefLabels.values()) l.sprite.visible = false;
    for (const t of thieves) {
      if (horizontal(t.position, center) > this.cfg.radius) continue;
      const text = `${t.id} · ${t.mode} · ${t.chaseTime.toFixed(1)} s`;
      let l = this.thiefLabels.get(t.id);
      if (!l) {
        l = { sprite: this.sprite(text, mapDebugOverlay.thief, t.position, THIEF_LABEL_LIFT), text };
        this.thiefLabels.set(t.id, l);
      } else if (l.text !== text) {
        this.repaint(l.sprite, text, mapDebugOverlay.thief);
        l.text = text;
      }
      l.sprite.position.set(t.position.x, t.position.y + THIEF_LABEL_LIFT, t.position.z);
      l.sprite.visible = true;
    }
  }

  /** A screen-sized label sprite `lift` m above `at`, its bottom edge centred there. */
  private sprite(text: string, color: number, at: Vec3, lift: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0);
    s.renderOrder = 21;
    s.position.set(at.x, at.y + lift, at.z);
    this.repaint(s, text, color);
    this.labels.add(s);
    return s;
  }

  private repaint(s: THREE.Sprite, text: string, color: number): void {
    const { texture, aspect } = this.paint(text, color);
    s.material.map?.dispose();
    s.material.map = texture;
    s.material.needsUpdate = true;
    s.scale.set(LABEL_SCREEN_HEIGHT * aspect, LABEL_SCREEN_HEIGHT, 1);
  }

  /**
   * Chunk grid lines (one draw call) over the chunks reaching within the radius of a point in the chunk at the origin;
   * update() moves it to the player's chunk.
   */
  private chunkGrid(): THREE.LineSegments {
    const size = this.city.chunkSize;
    const n = Math.ceil(this.cfg.radius / size);
    const lo = -n * size;
    const hi = (n + 1) * size;
    const pts: number[] = [];
    for (let k = -n; k <= n + 1; k++) {
      const v = k * size;
      pts.push(v, OVERLAY_Y, lo, v, OVERLAY_Y, hi); // along z at x = v
      pts.push(lo, OVERLAY_Y, v, hi, OVERLAY_Y, v); // along x at z = v
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: mapDebugOverlay.grid, transparent: true, opacity: GRID_OPACITY, depthTest: false, depthWrite: false, fog: false });
    const grid = new THREE.LineSegments(geo, mat);
    grid.name = 'map-debug-grid';
    grid.renderOrder = 20;
    return grid;
  }
}

/** Unlit, fog-free, drawn over the scene (no depth test): debug overlays read through buildings. */
function overlayMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
}
