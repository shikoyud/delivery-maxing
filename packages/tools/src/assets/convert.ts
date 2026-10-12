import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type } from 'node:os';
import { dirname, join } from 'node:path';

/** The FBX2glTF binary shipped by the `fbx2gltf` package for this OS (Linux, Darwin, Windows_NT). */
export function fbx2gltfBinary(): string {
  const pkg = dirname(createRequire(import.meta.url).resolve('fbx2gltf/package.json'));
  const exe = join(pkg, 'bin', type(), type() === 'Windows_NT' ? 'FBX2glTF.exe' : 'FBX2glTF');
  if (!existsSync(exe)) throw new Error(`FBX2glTF binary not found for ${type()}: ${exe}`);
  return exe;
}

/** Converts `src` (.fbx) to the binary glTF `outGlb` (must end in .glb). Throws on a non-zero exit. */
export function convertFbx(src: string, outGlb: string): void {
  if (!outGlb.endsWith('.glb')) throw new Error(`convertFbx output must end in .glb: ${outGlb}`);
  const res = spawnSync(fbx2gltfBinary(), ['--binary', '-i', src, '-o', outGlb.slice(0, -4)], { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`FBX2glTF failed on ${src} (exit ${res.status}):\n${res.stderr || res.stdout}`);
  }
  if (!existsSync(outGlb)) throw new Error(`FBX2glTF did not write ${outGlb}`);
}
