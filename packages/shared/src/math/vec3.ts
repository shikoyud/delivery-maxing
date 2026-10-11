export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (v: Vec3, k: number): Vec3 => vec3(v.x * k, v.y * k, v.z * k);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (v: Vec3): number => Math.sqrt(dot(v, v));
export const horizontalLength = (v: Vec3): number => Math.hypot(v.x, v.z);

export function normalize(v: Vec3): Vec3 {
  const l = length(v);
  return l > 0 ? scale(v, 1 / l) : vec3(0, 0, 0);
}

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Caps the x/z length at `max`, leaving y untouched. */
export function clampHorizontal(v: Vec3, max: number): Vec3 {
  const l = horizontalLength(v);
  if (l <= max || l === 0) return vec3(v.x, v.y, v.z);
  const k = max / l;
  return vec3(v.x * k, v.y, v.z * k);
}

/** Closest point on segment a-b to p; `s` is metres from a along the segment. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { s: number; point: Vec3; dist: number } {
  const ab = sub(b, a);
  const len = length(ab);
  if (len === 0) return { s: 0, point: vec3(a.x, a.y, a.z), dist: length(sub(p, a)) };
  const s = Math.min(Math.max(dot(sub(p, a), ab) / len, 0), len);
  const point = s === len ? vec3(b.x, b.y, b.z) : add(a, scale(ab, s / len));
  return { s, point, dist: length(sub(p, point)) };
}
