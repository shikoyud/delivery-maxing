import type { Vec3 } from '../math/vec3';

/** Patrol: node to node along the streets. Chase: after a courier. Return: back to the street graph, then patrol. */
export type ThiefMode = 'patrol' | 'chase' | 'return';

/**
 * One street thief. `position` is its feet on the street. `heading` is a yaw (see movement facing()). `route` is the
 * nodes still to walk to (patrol: the next node; return: the near end of its street), `prevNode` the last node reached.
 */
export interface ThiefState {
  id: string;
  position: Vec3;
  heading: number;
  speed: number;
  mode: ThiefMode;
  chaseTime: number;
  aboveTime: number;
  route: string[];
  prevNode: string | null;
}

/** What the thieves know of the courier: feet position, packages carried, whether it stands in the HUB plaza. */
export interface CourierInfo { position: Vec3; carrying: number; inPlaza: boolean }

export type ThiefEvent =
  | { kind: 'chaseStarted'; thiefId: string }
  /** `empty`: the courier no longer carries a package (delivered mid-chase, ruling R25). */
  | { kind: 'chaseEnded'; thiefId: string; reason: 'timeout' | 'distance' | 'above' | 'plaza' | 'empty' }
  | { kind: 'caught'; thiefId: string };

/** Line of sight between two points (the host raycasts its world). */
export type LineOfSight = (from: Vec3, to: Vec3) => boolean;
