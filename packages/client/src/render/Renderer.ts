import * as THREE from 'three';
import type { Vec3 } from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import { lighting, palette } from './palette';

/** Water level (m): below the ground top (y = 0) and above movement fall.outOfBoundsY, so a fall shows a splash-down. */
const WATER_Y = -1.5;
/** How far the water plane extends past the island edge on each side (m). */
const WATER_MARGIN = 2000;

/** Owns the three.js renderer, scene, camera, lights, fog, sky and water. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunOffset = new THREE.Vector3(-0.45, 1, 0.3).normalize();
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

    this.camera = new THREE.PerspectiveCamera(cam.fovBase, 1, 0.1, gfx.fogFar * 1.5);
    this.camera.rotation.order = 'YXZ';

    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.sky, gfx.fogNear, gfx.fogFar);

    this.scene.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, lighting.hemi));
    this.sun = new THREE.DirectionalLight(palette.sun, lighting.sun);
    this.sun.castShadow = gfx.shadows;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -gfx.shadowExtent;
    sc.right = sc.top = gfx.shadowExtent;
    sc.near = 1;
    sc.far = gfx.shadowExtent * 4;
    this.sun.shadow.mapSize.set(gfx.shadowMapSize, gfx.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    const waterSize = mapSize + WATER_MARGIN * 2;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(waterSize, waterSize),
      new THREE.MeshLambertMaterial({ color: palette.water }),
    );
    water.name = 'water';
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
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
