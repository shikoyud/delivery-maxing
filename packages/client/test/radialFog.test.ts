import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installRadialFog } from '../src/render/radialFog';
import { createPaletteMaterial } from '../src/render/city/paletteMaterial';

describe('installRadialFog', () => {
  it('makes fog depth the radial distance from the camera, not the view depth, for every built-in material', () => {
    installRadialFog();
    installRadialFog(); // idempotent
    const chunk = THREE.ShaderChunk.fog_vertex;
    expect(chunk).toMatch(/vFogDepth\s*=\s*length\(\s*mvPosition\.xyz\s*\)/);
    expect(chunk).not.toMatch(/-\s*mvPosition\.z/);
    // Lambert (region meshes, LOD2 boxes) and the palette material (instanced LOD0/LOD1) pull the chunk in by name.
    expect(THREE.ShaderLib.lambert.vertexShader).toContain('#include <fog_vertex>');
    const material = createPaletteMaterial(new THREE.Texture(), 11);
    const shader = {
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('#include <fog_vertex>');
  });
});
