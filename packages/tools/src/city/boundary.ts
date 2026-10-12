import type { Rect, Solid } from '@dm/shared';
import { box, groundRect, intersectRect, r2 } from './layout';
import { splitAtChunks } from './streets';
import type { CitySource, Edge } from './source';

/** One 1 m thick ground tile per chunk with land, top at y = 0, clipped to the quay lines. */
export function groundTiles(src: CitySource, chunkSize: number): Solid[] {
  const g = groundRect(src);
  const out: Solid[] = [];
  for (let cz = Math.floor(g.minZ / chunkSize); cz * chunkSize < g.maxZ; cz++) {
    for (let cx = Math.floor(g.minX / chunkSize); cx * chunkSize < g.maxX; cx++) {
      const chunk = { minX: cx * chunkSize, minZ: cz * chunkSize, maxX: (cx + 1) * chunkSize, maxZ: (cz + 1) * chunkSize };
      out.push(box(`ground-${cx}_${cz}`, 'ground', intersectRect(chunk, g), -1, 0));
    }
  }
  return out;
}

/** The strip `depth` m wide just inside an edge of the map square, running its full length. */
function edgeStrip(edge: Edge, half: number, depth: number, inner: number): Rect {
  switch (edge) {
    case 'north':
      return { minX: -half, maxX: half, minZ: -half, maxZ: -half + depth };
    case 'south':
      return { minX: -half, maxX: half, minZ: inner - depth, maxZ: inner };
    case 'west':
      return { minX: -half, maxX: -half + depth, minZ: -half, maxZ: half };
    case 'east':
      return { minX: inner - depth, maxX: inner, minZ: -half, maxZ: half };
  }
}

/**
 * Cliffs: `cliffHeight` m walls `cliffDepth` m thick standing inside each cliff edge, in segments of at most one
 * chunk, reaching `quayDepth` below ground so corners over the water look solid. North and south cliffs run the full
 * width; east and west cliffs stop where they meet them.
 */
export function cliffs(src: CitySource, chunkSize: number): Solid[] {
  const half = src.size / 2;
  const { cliffEdges, cliffDepth, cliffHeight, quayDepth } = src.boundary;
  const out: Solid[] = [];
  for (const edge of cliffEdges) {
    let r = edgeStrip(edge, half, cliffDepth, half);
    if (edge === 'east' || edge === 'west') {
      if (cliffEdges.includes('north')) r = { ...r, minZ: -half + cliffDepth };
      if (cliffEdges.includes('south')) r = { ...r, maxZ: half - cliffDepth };
    }
    splitAtChunks(r, chunkSize).forEach((s, k) => out.push(box(`cliff-${edge}-${k}`, 'cliff', s, -quayDepth, cliffHeight)));
  }
  return out;
}

/**
 * Quay walls: a wall under the edge of the land along each water edge, from the bottom of the ground tiles down to
 * `quayDepth`, so the quay shows a face above and below the water line (the client draws the water).
 */
export function quays(src: CitySource, chunkSize: number): Solid[] {
  const half = src.size / 2;
  const g = groundRect(src);
  const { waterEdges, quayWallThickness: t, quayDepth } = src.boundary;
  const out: Solid[] = [];
  for (const edge of waterEdges) {
    const inner = edge === 'south' ? g.maxZ : edge === 'east' ? g.maxX : edge === 'north' ? g.minZ : g.minX;
    let r: Rect;
    if (edge === 'north') r = { ...edgeStrip('north', half, t, inner), minZ: r2(inner), maxZ: r2(inner + t) };
    else if (edge === 'west') r = { ...edgeStrip('west', half, t, inner), minX: r2(inner), maxX: r2(inner + t) };
    else r = edgeStrip(edge, half, t, inner);
    // Run along the land only, and leave the corner to the wall that runs along x
    r = intersectRect(r, g);
    if (edge === 'east' || edge === 'west') {
      if (waterEdges.includes('south')) r = { ...r, maxZ: g.maxZ - t };
      if (waterEdges.includes('north')) r = { ...r, minZ: g.minZ + t };
    }
    splitAtChunks(r, chunkSize).forEach((s, k) => out.push(box(`quay-${edge}-${k}`, 'ground', s, -quayDepth, -1)));
  }
  return out;
}
