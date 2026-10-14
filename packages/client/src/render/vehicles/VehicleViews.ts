import * as THREE from 'three';
import { lerpVec3, RIDE_TIERS, ridingConfig, type Garage, type RideTier, type Vec3, type VehicleSpot } from '@dm/shared';
import { lerpAngle } from '../../game/interpolation';
import { buildVehicleMesh } from './vehicleMeshes';

interface View {
  root: THREE.Group;
  /** The vehicle's feet, heading and spot before the last tick (interpolation start). */
  prev: Vec3;
  prevHeading: number;
  prevSpot: VehicleSpot['kind'] | null;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Draws the garage: one placeholder per owned vehicle, parked or ridden, hidden while carried (the skateboard) or not
 * owned. Each is interpolated between the state before the last tick (beforeStep) and the current one, like the
 * courier, so the ridden vehicle and its rider move together; it yaws to the heading and pitches to the ground normal.
 * A summon, tow, mount or dismount moves a vehicle in one go: snap() (and any spot change) draws it at its new place
 * without sweeping across the map.
 */
export class VehicleViews {
  private readonly views: Record<RideTier, View>;
  private snapNext = true;
  private readonly yaw = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly normal = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const views = {} as Record<RideTier, View>;
    for (const t of RIDE_TIERS) {
      const root = buildVehicleMesh(t, ridingConfig.rides[t]);
      root.visible = false;
      scene.add(root);
      views[t] = { root, prev: { x: 0, y: 0, z: 0 }, prevHeading: 0, prevSpot: null };
    }
    this.views = views;
  }

  /** The vehicle's mesh (tests, screenshots). */
  root(t: RideTier): THREE.Group {
    return this.views[t].root;
  }

  /** Call before each simulation tick: records where every vehicle starts it. */
  beforeStep(garage: Garage): void {
    for (const t of RIDE_TIERS) this.record(this.views[t], garage, t);
  }

  /** The next update draws every vehicle at its current state (teleport, summon, respawn). */
  snap(): void {
    this.snapNext = true;
  }

  /** Per frame: `alpha` (0..1) is how far the frame is between the last two ticks. */
  update(garage: Garage, alpha: number): void {
    const owned = garage.owned();
    for (const t of RIDE_TIERS) {
      const view = this.views[t];
      const spot = garage.spot(t).kind;
      view.root.visible = owned.includes(t) && spot !== 'carried';
      if (!view.root.visible) continue;
      // Nothing to interpolate from: a snap, or the vehicle changed spot (mounted, left, towed) since the last tick.
      if (this.snapNext || view.prevSpot !== spot) this.record(view, garage, t);
      const s = garage.state(t);
      const p = lerpVec3(view.prev, s.position, alpha);
      view.root.position.set(p.x, p.y, p.z);
      this.yaw.setFromAxisAngle(UP, lerpAngle(view.prevHeading, s.heading, alpha));
      const n = s.groundNormal;
      this.normal.set(n.x, n.y, n.z).normalize();
      this.tilt.setFromUnitVectors(UP, this.normal);
      view.root.quaternion.multiplyQuaternions(this.tilt, this.yaw);
    }
    this.snapNext = false;
  }

  private record(view: View, garage: Garage, t: RideTier): void {
    const s = garage.state(t);
    view.prev = { x: s.position.x, y: s.position.y, z: s.position.z };
    view.prevHeading = s.heading;
    view.prevSpot = garage.spot(t).kind;
  }
}
