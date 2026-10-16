import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PackManifest } from '@dm/shared';

export type { PackManifest };

/**
 * A pack model's two levels (SP2's PieceModels) and its material. A model of one material (most) has no geometry
 * groups and one material; a model with glass or lights is one geometry with a group per material and a material
 * array in the same order. A model without a LOD1 file draws its LOD0 geometry in the LOD1 ring.
 */
export interface PieceModels {
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry | null;
  material: THREE.Material | THREE.Material[];
}

export interface ModelLoaderOptions {
  /**
   * What `assets:import` wrote. Omitted: unknown (every requested id is fetched, LOD0 only). null: the packs are not
   * installed (every id is missing without a fetch, with one warning in all). Given: ids it lacks are missing without
   * a fetch (one warning each), and LOD1 files are fetched only where it lists one.
   */
  manifest?: PackManifest | null;
  /** Loads a shared texture by URL (default: THREE.TextureLoader). */
  loadTexture?: (url: string) => THREE.Texture;
}

type State = PieceModels | 'missing' | 'loading';

/** The importer's material names: `tex:<file>` samples `<base>textures/<file>`; `flat` is vertex-coloured. */
const TEX = 'tex:';
/** A textured model's untextured parts folded into its texture's material (see foldFlat): `tex:<file>+flat`. */
const FOLDED = '+flat';

/**
 * The texture material for folded models: vertex colours are RGBA, and A = 1 marks an untextured vertex (glass,
 * lights), which takes its colour alone instead of colour × texel. One draw call per model instead of one per material.
 */
function foldedMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
  diffuseColor *= mix( texture2D( map, vMapUv ), vec4( 1.0 ), vColor.a );
#endif`,
    );
  };
  m.customProgramCacheKey = () => 'dm-folded-flat';
  return m;
}

/**
 * Loads the runtime pack models written by `assets:import` (`<base><id>.glb`, `<base><id>.lod1.glb`) on request, once
 * per id. A 404 or a file that does not parse marks the id `missing` with a single `console.warn('model missing:
 * <id>')`, and the city keeps its placeholder box (Review Focus 1). Materials are shared across models by name
 * (Lambert, like the rest of the city): the two pack atlases are each one texture on the GPU, however many models use
 * them.
 */
export class ModelLoader {
  private readonly state = new Map<string, State>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly manifest: PackManifest | null | undefined;
  private readonly loadTexture: (url: string) => THREE.Texture;
  private warnedAbsent = false;

  constructor(
    private readonly base: string,
    private readonly loader: GLTFLoader,
    opts: ModelLoaderOptions = {},
  ) {
    this.manifest = opts.manifest;
    this.loadTexture = opts.loadTexture ?? ((url) => new THREE.TextureLoader().load(url));
  }

  /** Starts loading `id` (no-op if it was requested before). */
  request(id: string): void {
    if (this.state.has(id)) return;
    if (this.manifest === null) {
      this.state.set(id, 'missing');
      if (!this.warnedAbsent) {
        this.warnedAbsent = true;
        console.warn('pack models not installed (no packs/manifest.json; run pnpm assets:import): drawing placeholder boxes');
      }
      return;
    }
    if (this.manifest && !this.manifest.models[id]) {
      this.missing(id);
      return;
    }
    this.state.set(id, 'loading');
    void this.load(id, this.manifest?.models[id]?.lod1 ?? false);
  }

  /** The loaded models, `loading` while in flight, or `missing` (failed, absent, or never requested). */
  get(id: string): State {
    return this.state.get(id) ?? 'missing';
  }

  /** Ids per state, of those requested. */
  stats(): { loaded: number; missing: number; loading: number } {
    const s = { loaded: 0, missing: 0, loading: 0 };
    for (const v of this.state.values()) {
      if (v === 'missing') s.missing++;
      else if (v === 'loading') s.loading++;
      else s.loaded++;
    }
    return s;
  }

  private missing(id: string): void {
    this.state.set(id, 'missing');
    console.warn(`model missing: ${id}`);
  }

  private async load(id: string, withLod1: boolean): Promise<void> {
    // A LOD1 the manifest lists but that fails: one warning, and the LOD1 ring draws LOD0.
    const lod1 = withLod1
      ? this.geometry(`${this.base}${id}.lod1.glb`).catch(() => {
          console.warn(`model LOD1 missing: ${id}`);
          return null;
        })
      : Promise.resolve(null);
    let lod0: Extracted;
    try {
      lod0 = await this.geometry(`${this.base}${id}.glb`);
    } catch {
      this.missing(id);
      return;
    }
    const materials = lod0.names.map((n, i) => this.material(n, lod0.colored[i]!));
    let one = await lod1;
    const folded = lod0.names.length === 1 && lod0.names[0]!.endsWith(FOLDED);
    if (one && folded && !one.names[0]!.endsWith(FOLDED)) {
      // LOD1 lost its untextured parts (or kept only them): it still needs the RGBA colours LOD0's material reads
      one = foldFlat([{ geometry: one.geometry, name: one.names[0]! }], lod0.names[0]!.slice(0, -FOLDED.length), id);
    }
    if (one && lod0.names.length > 1) {
      // LOD1 draws with LOD0's material array, so its groups index LOD0's names. Simplification may have dropped a
      // material's every triangle, leaving LOD1 one primitive (no groups): give it one group, or it draws nothing.
      const index = (name: string | undefined): number => Math.max(0, lod0.names.indexOf(name ?? ''));
      if (one.geometry.groups.length === 0) one.geometry.addGroup(0, Infinity, index(one.names[0]));
      else for (const g of one.geometry.groups) g.materialIndex = index(one.names[g.materialIndex ?? 0]);
    }
    this.state.set(id, { lod0: lod0.geometry, lod1: one?.geometry ?? null, material: materials.length === 1 ? materials[0]! : materials });
  }

  private async geometry(url: string): Promise<Extracted> {
    return extract((await this.loader.loadAsync(url)).scene, url);
  }

  private material(name: string, colored: boolean): THREE.Material {
    const key = name.startsWith(TEX) ? name : `${name}:${colored}`;
    let m = this.materials.get(key);
    if (!m) {
      if (name.startsWith(TEX)) {
        const folded = name.endsWith(FOLDED);
        const tex = this.texture(name.slice(TEX.length, folded ? -FOLDED.length : undefined));
        m = folded ? foldedMaterial(tex) : new THREE.MeshLambertMaterial({ map: tex });
      } else {
        m = new THREE.MeshLambertMaterial({ vertexColors: colored });
      }
      m.name = name;
      this.materials.set(key, m);
    }
    return m;
  }

  /** A pack texture, loaded once per file however many materials use it. */
  private texture(file: string): THREE.Texture {
    let tex = this.textures.get(file);
    if (!tex) {
      tex = this.loadTexture(`${this.base}textures/${file}`);
      tex.flipY = false; // glTF UVs
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // the packs tile UVs past [0, 1]
      this.textures.set(file, tex);
    }
    return tex;
  }
}

interface Extracted {
  geometry: THREE.BufferGeometry;
  /** Material name per geometry group (one entry and no groups for a one-material model) */
  names: string[];
  /** Whether each group's vertices carry colours */
  colored: boolean[];
}

/** The scene's meshes (the importer writes one node, one primitive per material) as one geometry in scene space. */
function extract(scene: THREE.Object3D, url: string): Extracted {
  scene.updateMatrixWorld(true);
  const parts: { geometry: THREE.BufferGeometry; name: string }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.matrixWorld.equals(IDENTITY) ? mesh.geometry : mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    parts.push({ geometry: g, name: mat?.name ?? '' });
  });
  if (parts.length === 0) throw new Error(`${url}: no mesh`);
  const textures = new Set(parts.filter((p) => p.name.startsWith(TEX)).map((p) => p.name));
  if (parts.length > 1 && textures.size === 1) return foldFlat(parts, [...textures][0]!, url);
  const colored = parts.map((p) => p.geometry.getAttribute('color') !== undefined);
  if (parts.length === 1) {
    const g = parts[0]!.geometry;
    g.clearGroups();
    g.computeBoundingSphere();
    return { geometry: g, names: [parts[0]!.name], colored };
  }
  const merged = mergeGeometries(
    parts.map((p) => p.geometry),
    true,
  );
  if (!merged) throw new Error(`${url}: primitives could not be merged`);
  merged.computeBoundingSphere();
  return { geometry: merged, names: parts.map((p) => p.name), colored };
}

/** `attr` as plain floats (GLTFLoader keeps quantised normals and UVs as normalised integers). */
function floats(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number, fill: number): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * size).fill(fill);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < Math.min(size, attr.itemSize); c++) out[i * size + c] = attr.getComponent(i, c);
  }
  return new THREE.BufferAttribute(out, size);
}

/**
 * A model of one texture plus untextured parts (glass, lights) as one geometry without groups: RGBA vertex colours
 * where the untextured parts keep their colour with A = 1 and the textured ones are white with A = 0 (foldedMaterial).
 */
function foldFlat(parts: { geometry: THREE.BufferGeometry; name: string }[], tex: string, url: string): Extracted {
  const geoms = parts.map(({ geometry: g, name }) => {
    const flat = !name.startsWith(TEX);
    const out = new THREE.BufferGeometry();
    const pos = g.getAttribute('position');
    out.setAttribute('position', floats(pos, 3, 0));
    out.setAttribute('normal', floats(g.getAttribute('normal'), 3, 0));
    const uv = g.getAttribute('uv');
    out.setAttribute('uv', uv ? floats(uv, 2, 0) : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    const col = g.getAttribute('color');
    const rgba = col && flat ? floats(col, 4, 1) : new THREE.BufferAttribute(new Float32Array(pos.count * 4).fill(1), 4);
    for (let i = 0; i < pos.count; i++) rgba.setW(i, flat ? 1 : 0);
    out.setAttribute('color', rgba);
    out.setIndex(g.index ? Array.from(g.index.array) : null);
    return out;
  });
  const merged = mergeGeometries(geoms, false);
  if (!merged) throw new Error(`${url}: primitives could not be merged`);
  merged.computeBoundingSphere();
  return { geometry: merged, names: [`${tex}${FOLDED}`], colored: [true] };
}

const IDENTITY = new THREE.Matrix4();
