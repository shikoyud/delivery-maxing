import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installRadialFog } from '../src/render/radialFog';

describe('installRadialFog', () => {
  it('measures the fog distance per fragment: the vertex shader passes the view position, the fragment shader takes its length', () => {
    installRadialFog();
    installRadialFog(); // idempotent
    // Interpolating a per-vertex distance is wrong on long triangles: a 1.2 km street deck came out fully fogged
    // under the player's feet and flickered against the cross streets drawn level with it (SP5 playtest).
    expect(THREE.ShaderChunk.fog_vertex).toMatch(/vFogPosition\s*=\s*mvPosition\.xyz/);
    expect(THREE.ShaderChunk.fog_vertex).not.toMatch(/length\(/);
    expect(THREE.ShaderChunk.fog_vertex).not.toMatch(/-\s*mvPosition\.z/);
    expect(THREE.ShaderChunk.fog_pars_vertex).toMatch(/varying vec3 vFogPosition/);
    expect(THREE.ShaderChunk.fog_pars_fragment).toMatch(/varying vec3 vFogPosition/);
    expect(THREE.ShaderChunk.fog_pars_fragment).not.toMatch(/varying float vFogDepth/);
    expect(THREE.ShaderChunk.fog_fragment).toMatch(/float vFogDepth\s*=\s*length\(\s*vFogPosition\s*\)/);
    expect(THREE.ShaderChunk.fog_fragment).toMatch(/smoothstep\(\s*fogNear,\s*fogFar,\s*vFogDepth\s*\)/);
    // Lambert (blocks, regions) and basic (decals) pull the chunks in by name.
    for (const lib of [THREE.ShaderLib.lambert, THREE.ShaderLib.basic]) {
      expect(lib.vertexShader).toContain('#include <fog_pars_vertex>');
      expect(lib.vertexShader).toContain('#include <fog_vertex>');
      expect(lib.fragmentShader).toContain('#include <fog_pars_fragment>');
      expect(lib.fragmentShader).toContain('#include <fog_fragment>');
    }
  });
});
