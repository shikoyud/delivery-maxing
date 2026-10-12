import * as THREE from 'three';

/** Fog depth = distance from the camera (radial), replacing three's view depth (-mvPosition.z). */
const RADIAL_FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG

	vFogDepth = length( mvPosition.xyz );

#endif
`;

/**
 * Makes the scene fog radial for every material (built-in, instanced and the city palette material all include
 * `fog_vertex`). The city stops drawing props and render regions at a horizontal radius (city.lodRadii[2] = fogFar);
 * with three's default view-depth fog, things at that radius near the screen sides are only part-fogged, so the
 * cutoff would show there. Call once before any material compiles (Renderer does); repeated calls are harmless.
 */
export function installRadialFog(): void {
  THREE.ShaderChunk.fog_vertex = RADIAL_FOG_VERTEX;
}
