/** Row-major rotation matrix for an XYZ Euler in degrees, matching three.js 'XYZ' order (R = Rx·Ry·Rz). */
export function rotationMatrixXYZ(r: { x: number; y: number; z: number }): [[number, number, number], [number, number, number], [number, number, number]] {
  const [a, b, c] = [r.x, r.y, r.z].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
}
