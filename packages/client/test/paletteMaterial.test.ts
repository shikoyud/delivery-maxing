import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPaletteMaterial, paletteRow, PALETTE_ROWS } from '../src/render/city/paletteMaterial';

describe('createPaletteMaterial', () => {
  it('the compiled vertex shader declares aPalette and divides uv.y by rows', () => {
    const material = createPaletteMaterial(new THREE.Texture(), 11);
    const shader = {
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toMatch(/attribute float aPalette;/);
    expect(shader.vertexShader).toMatch(/\(\s*uv\.y \+ aPalette\s*\)\s*\/\s*11\.0/);
    // the remap comes after three's own uv chunk, so it wins
    expect(shader.vertexShader.indexOf('aPalette )')).toBeGreaterThan(shader.vertexShader.indexOf('#include <uv_vertex>'));
  });

  it('samples the atlas with nearest filtering, no mipmaps and glTF (unflipped) UVs', () => {
    const atlas = new THREE.Texture();
    const material = createPaletteMaterial(atlas, 11);
    expect(material.map).toBe(atlas);
    expect(atlas.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.minFilter).toBe(THREE.NearestFilter);
    expect(atlas.generateMipmaps).toBe(false);
    expect(atlas.flipY).toBe(false);
    expect(atlas.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});

describe('paletteRow', () => {
  it('maps palette basenames to atlas rows in the assets.config.json order, null to the default', () => {
    expect(PALETTE_ROWS).toBe(11);
    expect(paletteRow('Texture_Light')).toBe(0);
    expect(paletteRow('Texture_Blue')).toBe(4);
    expect(paletteRow('Texture_Signs')).toBe(10);
    expect(paletteRow(null)).toBe(0); // defaultPalette Texture_Light
    expect(() => paletteRow('Texture_Nope')).toThrow(/Texture_Nope/);
  });
});
