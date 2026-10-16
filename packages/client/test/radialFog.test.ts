import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installRadialFog } from '../src/render/radialFog';

describe('installRadialFog', () => {
  it('makes fog depth the radial distance from the camera, not the view depth, for every built-in material', () => {
    installRadialFog();
    installRadialFog(); // idempotent
    const chunk = THREE.ShaderChunk.fog_vertex;
    expect(chunk).toMatch(/vFogDepth\s*=\s*length\(\s*mvPosition\.xyz\s*\)/);
    expect(chunk).not.toMatch(/-\s*mvPosition\.z/);
    // Lambert (blocks, regions) and basic (decals) pull the chunk in by name.
    expect(THREE.ShaderLib.lambert.vertexShader).toContain('#include <fog_vertex>');
    expect(THREE.ShaderLib.basic.vertexShader).toContain('#include <fog_vertex>');
  });
});
