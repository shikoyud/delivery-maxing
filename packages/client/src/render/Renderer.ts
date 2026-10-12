import * as THREE from 'three';
import type { Vec3 } from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import { palette } from './palette';

/** Unit vector from the scene toward the sun (the shadow-casting light). */
export const toSun: Readonly<Vec3> = (() => {
  const v = new THREE.Vector3(-0.45, 1, 0.3).normalize();
  return { x: v.x, y: v.y, z: v.z };
})();

/** Owns the three.js renderer, scene, camera, lights, fog, sky and water. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunOffset = new THREE.Vector3(toSun.x, toSun.y, toSun.z);
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly gfx: ClientConfig['graphics'],
    cam: ClientConfig['camera'],
    mapSize: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = gfx.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    host.prepend(this.renderer.domElement); // under the HUD overlays

    this.camera = new THREE.PerspectiveCamera(cam.fovBase, 1, cam.near, cam.far);
    this.camera.rotation.order = 'YXZ';

    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.sky, gfx.fogNear, gfx.fogFar);

    this.scene.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, gfx.lights.hemi));
    this.sun = new THREE.DirectionalLight(palette.sun, gfx.lights.sun);
    this.sun.castShadow = gfx.shadows;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -gfx.shadowExtent;
    sc.right = sc.top = gfx.shadowExtent;
    sc.near = 1;
    sc.far = gfx.shadowExtent * 4;
    this.sun.shadow.mapSize.set(gfx.shadowMapSize, gfx.shadowMapSize);
    this.sun.shadow.bias = gfx.shadowBias;
    this.sun.shadow.normalBias = gfx.shadowNormalBias;
    this.scene.add(this.sun, this.sun.target);

    const waterSize = mapSize + gfx.waterMargin * 2;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(waterSize, waterSize),
      new THREE.MeshLambertMaterial({ color: palette.water }),
    );
    water.name = 'water';
    water.rotation.x = -Math.PI / 2;
    // Below the ground top and above fall.outOfBoundsY, so a fall reads as a splash-down (spec §5.1).
    water.position.y = gfx.waterLevel;
    water.receiveShadow = false;
    water.updateMatrix();
    water.matrixAutoUpdate = false;
    this.scene.add(water);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /** Keeps the sun's shadow camera centred on `focus`, snapped to whole shadow texels to avoid shimmering. */
  followShadow(focus: Vec3): void {
    const texel = (this.gfx.shadowExtent * 2) / this.gfx.shadowMapSize;
    const snap = (v: number): number => Math.round(v / texel) * texel;
    const fx = snap(focus.x);
    const fz = snap(focus.z);
    const d = this.gfx.shadowExtent * 2;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunOffset.x * d, this.sunOffset.y * d, fz + this.sunOffset.z * d);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
