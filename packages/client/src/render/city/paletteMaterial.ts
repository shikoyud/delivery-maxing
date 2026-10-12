import * as THREE from 'three';
// Named imports: Vite tree-shakes the rest of the asset config (piece list, collider overrides) out of the bundle.
import { defaultPalette, palettes } from '../../../../tools/assets.config.json';

/** Atlas rows, top to bottom, in the order of assets.config.json `palettes` (basenames, e.g. "Texture_Blue"). */
const ROW_NAMES: readonly string[] = palettes.map((p) => p.replace(/^.*\//, '').replace(/\.png$/i, ''));

/** Rows in the palette atlas (assets/city/palette-atlas.png: one 32 × 32 palette per row). */
export const PALETTE_ROWS = ROW_NAMES.length;

/** The atlas row of a prop's palette; null is the pieces' default palette. Throws on an unknown name. */
export function paletteRow(name: string | null): number {
  const row = ROW_NAMES.indexOf(name ?? defaultPalette);
  if (row < 0) throw new Error(`unknown palette ${String(name)}`);
  return row;
}

/**
 * The one material every building instance shares: Lambert over the palette atlas. Each instance picks its atlas
 * row through the per-instance `aPalette` attribute (float row index): the piece's own UVs (glTF convention, v = 0 at
 * the top of its palette image) are squeezed into that row. The atlas is uploaded unflipped to match glTF UVs, with
 * nearest filtering and no mipmaps so neighbouring swatches and rows never bleed into each other.
 */
export function createPaletteMaterial(atlas: THREE.Texture, rows: number): THREE.MeshLambertMaterial {
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({ map: atlas });
  material.name = 'city-palette';
  const rowsLiteral = rows.toFixed(1);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPalette;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = ( mapTransform * vec3( uv.x, ( uv.y + aPalette ) / ${rowsLiteral}, 1.0 ) ).xy;\n#endif`,
      );
  };
  material.customProgramCacheKey = () => `city-palette-${rowsLiteral}`;
  return material;
}
