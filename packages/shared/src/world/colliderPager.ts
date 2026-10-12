import type { Collider } from '@dimforge/rapier3d-compat';
import type { WorldConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { chunksOverlapping, chunksWithin, solidRect, type ChunkKey } from './chunks';
import type { MapData, Surface } from './mapTypes';
import { addSolidCollider, solidSurface, type PhysicsWorld, type Rapier } from './physicsWorld';

export interface PagedPhysicsWorld extends PhysicsWorld {
  /** Loads chunks within loadRadius of `center`, unloads beyond unloadRadius; calls world.step() if anything changed. Returns whether it changed. */
  update(center: Vec3): boolean;
  /** Loads every chunk and never unloads afterwards (tests, tools and the SP4 server). */
  loadAll(): void;
  loadedChunks(): ReadonlySet<ChunkKey>;
}

interface LiveSolid {
  collider: Collider;
  /** Loaded chunks that contain this solid. */
  refs: number;
}

/**
 * A physics world whose solids only have colliders while a chunk they touch is loaded. A solid spanning several
 * chunks is created once and removed when its last chunk unloads. The pager only removes colliders it created.
 * The caller must `update(player position)` before every sim step, and again after a teleport or respawn.
 */
export function createPagedPhysicsWorld(
  rapier: Rapier,
  map: MapData,
  chunkSize: number,
  radii: WorldConfig['physics'],
): PagedPhysicsWorld {
  const world = new rapier.World({ x: 0, y: 0, z: 0 });
  const surfaces = new Map<number, Surface>();

  const solidsByChunk = new Map<ChunkKey, number[]>();
  map.solids.forEach((s, i) => {
    for (const key of chunksOverlapping(solidRect(s), chunkSize)) {
      const list = solidsByChunk.get(key);
      if (list) list.push(i);
      else solidsByChunk.set(key, [i]);
    }
  });

  const live = new Map<number, LiveSolid>();
  const loaded = new Set<ChunkKey>();
  let everythingLoaded = false;

  function loadChunk(key: ChunkKey): void {
    loaded.add(key);
    for (const i of solidsByChunk.get(key) ?? []) {
      const entry = live.get(i);
      if (entry) {
        entry.refs++;
        continue;
      }
      const solid = map.solids[i]!;
      const collider = addSolidCollider(world, rapier, solid);
      surfaces.set(collider.handle, solidSurface(solid));
      live.set(i, { collider, refs: 1 });
    }
  }

  function unloadChunk(key: ChunkKey): void {
    loaded.delete(key);
    for (const i of solidsByChunk.get(key) ?? []) {
      const entry = live.get(i)!;
      if (--entry.refs > 0) continue;
      surfaces.delete(entry.collider.handle);
      world.removeRigidBody(entry.collider.parent()!);
      live.delete(i);
    }
  }

  return {
    rapier,
    world,
    surfaceOf: (c) => surfaces.get(c.handle) ?? 'default',

    update(center) {
      if (everythingLoaded) return false;
      let changed = false;
      const keep = new Set(chunksWithin(center, radii.unloadRadius, chunkSize));
      for (const key of [...loaded]) {
        if (keep.has(key)) continue;
        unloadChunk(key);
        changed = true;
      }
      for (const key of chunksWithin(center, radii.loadRadius, chunkSize)) {
        if (loaded.has(key)) continue;
        loadChunk(key);
        changed = true;
      }
      // Rapier 0.21 has no updateSceneQueries: a step is what makes new colliders visible to queries.
      if (changed) world.step();
      return changed;
    },

    loadAll() {
      if (everythingLoaded) return;
      for (const key of solidsByChunk.keys()) if (!loaded.has(key)) loadChunk(key);
      everythingLoaded = true;
      world.step();
    },

    loadedChunks: () => loaded,
  };
}
