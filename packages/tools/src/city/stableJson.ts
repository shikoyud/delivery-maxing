import { writeFileSync } from 'node:fs';

/** Deep copy with every object's keys sorted; arrays keep their order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) if (obj[k] !== undefined) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/** JSON with sorted keys and 2-space indentation, ending in a newline, so diffs of generated files stay readable. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function writeStableJson(path: string, value: unknown): void {
  writeFileSync(path, stableStringify(value));
}
