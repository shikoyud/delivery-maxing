import * as THREE from 'three';

/**
 * Radial fog, measured per fragment. Three's fog depth is the view depth (-mvPosition.z); the city wants the
 * distance from the camera instead (see installRadialFog). That distance is not linear across a triangle, so it
 * cannot be computed at the vertices and interpolated: on a 1.2 km street deck the vertices sit hundreds of metres
 * away and the deck under the player's feet came out fully fogged, while a short cross street drawn level with it
 * did not, and the two decks flickered at every intersection (the SP5 playtest). So the vertex shader passes the
 * view-space position and the fragment shader takes its length.
 */
const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG

	varying vec3 vFogPosition;

#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG

	vFogPosition = mvPosition.xyz;

#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying vec3 vFogPosition;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	float vFogDepth = length( vFogPosition );

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
`;

/**
 * Makes the scene fog radial for every material (built-in and instanced materials all include the fog chunks). The
 * city stops drawing blocks at a horizontal radius (city.lodRadii[2] = graphics.fogFar); with three's default
 * view-depth fog, things at that radius near the screen sides are only part-fogged, so the cutoff would show there.
 * Call once before any material compiles (Renderer does); repeated calls are harmless.
 */
export function installRadialFog(): void {
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
}
