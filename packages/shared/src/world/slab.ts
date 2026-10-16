import { vec3 } from '../math/vec3';
import type { Solid } from './mapTypes';

/** A slab whose top face is at `top`. */
export function slab(id: string, kind: Solid['kind'], x0: number, x1: number, z0: number, z1: number, top: number, thickness: number): Solid {
  return {
    id,
    kind,
    center: vec3((x0 + x1) / 2, top - thickness / 2, (z0 + z1) / 2),
    size: vec3(x1 - x0, thickness, z1 - z0),
  };
}
