import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ordersConfig, vec3, type CityMap, type PoiRow, type PoiTableFile, type ThiefState } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { mapDebugColors } from '../src/render/palette';
import { MapDebugView, poiMarkerStyle, type LabelPainter } from '../src/ui/mapDebug';

const bands = ordersConfig.bands.city;
const cfg = clientConfig.mapDebug;

const row = (over: Partial<PoiRow> = {}): PoiRow => ({
  id: 'poi-downtown-07',
  district: 'downtown',
  elevated: true,
  fromHub: 640,
  toHub: 652,
  reachable: true,
  ...over,
});

describe('poiMarkerStyle', () => {
  it('band colours by fromHub with city bands (499 → short, 500 → medium, 1201 → long)', () => {
    expect(bands).toEqual({ shortMax: 500, mediumMax: 1200 });
    expect(poiMarkerStyle(row({ fromHub: 499 }), bands).color).toBe(mapDebugColors.short);
    expect(poiMarkerStyle(row({ fromHub: 500 }), bands).color).toBe(mapDebugColors.medium);
    expect(poiMarkerStyle(row({ fromHub: 1200 }), bands).color).toBe(mapDebugColors.medium);
    expect(poiMarkerStyle(row({ fromHub: 1201 }), bands).color).toBe(mapDebugColors.long);
    expect(new Set(Object.values(mapDebugColors)).size).toBe(4);
    expect(poiMarkerStyle(row({ fromHub: 640.4 }), bands).label).toBe('poi-downtown-07 · 640 m · elevated');
    expect(poiMarkerStyle(row({ id: 'poi-harbor-02', elevated: false, fromHub: 1201 }), bands).label).toBe('poi-harbor-02 · 1201 m');
  });

  it('an unreachable row is red and labelled unreachable', () => {
    const none = poiMarkerStyle(row({ reachable: false, fromHub: -1, toHub: -1 }), bands);
    expect(none).toEqual({ color: mapDebugColors.unreachable, label: 'poi-downtown-07 · unreachable · elevated' });
    // A one-way path (to the POI but not back) is still unreachable; its outbound metres are shown.
    const oneWay = poiMarkerStyle(row({ reachable: false, elevated: false, fromHub: 320, toHub: -1 }), bands);
    expect(oneWay).toEqual({ color: mapDebugColors.unreachable, label: 'poi-downtown-07 · 320 m · unreachable' });
  });
});

describe('MapDebugView', () => {
  // Five POIs along +x, every 200 m; the city is 2 km across in 100 m chunks.
  const xs = [0, 200, 400, 600, 800];
  const city = {
    size: 2000,
    chunkSize: 100,
    pois: xs.map((x, i) => ({ id: `poi-${i}`, position: vec3(x, i === 1 ? 12 : 0, 0), district: 'downtown', kind: 'street' })),
  } as unknown as CityMap;
  const table: PoiTableFile = {
    version: 1,
    pois: xs.map((x, i) => row({ id: `poi-${i}`, fromHub: x + 50, elevated: i === 1, reachable: i !== 3 })),
    between: [],
    unreachable: [{ id: 'poi-3', reason: 'test' }],
  };
  const painted: string[] = [];
  const paint: LabelPainter = (text) => {
    painted.push(text);
    return { texture: new THREE.Texture(), aspect: 4 };
  };
  const thief = (id: string, x: number, mode: ThiefState['mode'], chaseTime: number): ThiefState => ({
    id, position: vec3(x, 0, 5), heading: 0, speed: 0, mode, chaseTime, aboveTime: 0, route: [], prevNode: null,
  });
  const build = (): { scene: THREE.Scene; view: MapDebugView } => {
    const scene = new THREE.Scene();
    return { scene, view: new MapDebugView(scene, city, table, bands, cfg, paint) };
  };

  it('starts hidden in the scene and toggles with setVisible', () => {
    const { scene, view } = build();
    expect(scene.children).toContain(view.group);
    expect(view.visible).toBe(false);
    expect(view.group.visible).toBe(false);
    view.setVisible(true);
    expect(view.group.visible).toBe(true);
    view.setVisible(false);
    expect(view.debug().visible).toBe(false);
  });

  it(`beams and labels only within ${cfg.radius} m, coloured by band; unreachable rows red`, () => {
    expect(cfg.radius).toBe(500);
    const { view } = build();
    view.setVisible(true);
    view.update(vec3(150, 0, 0), new Set(), []);
    // Within 500 m of x = 150: the POIs at 0, 200, 400 and 600 (450 m); not 800 (650 m).
    let d = view.debug();
    expect(d.beams).toBe(4);
    expect(d.labels).toEqual(['poi-0 · 50 m', 'poi-1 · 250 m · elevated', 'poi-2 · 450 m', 'poi-3 · 650 m · unreachable']);
    const beams = view.group.getObjectByName('map-debug-beams') as THREE.InstancedMesh;
    const c = new THREE.Color();
    const colours = Array.from({ length: beams.count }, (_, i) => (beams.getColorAt(i, c), c.getHex()));
    const hex = (n: number): number => new THREE.Color(n).getHex();
    expect(colours).toEqual([hex(mapDebugColors.short), hex(mapDebugColors.short), hex(mapDebugColors.short), hex(mapDebugColors.unreachable)]);
    view.update(vec3(800, 0, 0), new Set(), []);
    d = view.debug();
    expect(d.labels).toEqual(['poi-2 · 450 m', 'poi-3 · 650 m · unreachable', 'poi-4 · 850 m']);
    expect(d.beams).toBe(3);
    // Labels are painted once per POI, not every frame.
    const before = painted.length;
    view.update(vec3(800, 0, 0), new Set(), []);
    expect(painted.length).toBe(before);
  });

  it('draws the chunk grid around the player and tints exactly the physics-loaded chunks', () => {
    const { view } = build();
    view.setVisible(true);
    const grid = view.group.getObjectByName('map-debug-grid') as THREE.LineSegments;
    // 500 m in 100 m chunks: the player's chunk and 5 more each side, so 12 lines each way, two vertices per line.
    expect(grid.geometry.getAttribute('position').count).toBe(12 * 2 * 2);
    view.update(vec3(250, 0, -30), new Set(), []);
    expect(grid.position.toArray()).toEqual([200, 0, -100]); // snapped to the player's chunk (2, −1)
    view.update(vec3(0, 0, 0), new Set(['0,0', '-1,0', '0,-1']), []);
    expect(view.debug().chunks).toBe(3);
    const tints = view.group.getObjectByName('map-debug-chunks') as THREE.InstancedMesh;
    const corners: string[] = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < tints.count; i++) {
      tints.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      corners.push(`${p.x},${p.z}`);
    }
    expect(corners.sort()).toEqual(['-100,0', '0,-100', '0,0']);
    view.update(vec3(0, 0, 0), new Set(['5,5']), []);
    expect(view.debug().chunks).toBe(1);
  });

  it('labels each thief within the radius with its mode and chase time, repainting only when the text changes', () => {
    const { view } = build();
    view.setVisible(true);
    view.update(vec3(0, 0, 0), new Set(), [thief('t-a', 10, 'patrol', 0), thief('t-b', 900, 'chase', 1)]);
    expect(view.debug().thieves).toEqual(['t-a · patrol · 0.0 s']);
    const before = painted.length;
    view.update(vec3(0, 0, 0), new Set(), [thief('t-a', 12, 'patrol', 0)]);
    expect(painted.length).toBe(before);
    view.update(vec3(0, 0, 0), new Set(), [thief('t-a', 14, 'chase', 2.26)]);
    expect(view.debug().thieves).toEqual(['t-a · chase · 2.3 s']);
    expect(painted.length).toBe(before + 1);
  });
});
