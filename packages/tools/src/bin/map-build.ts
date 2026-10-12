import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseCityMap, parsePieceCatalog } from '@dm/shared';
import { generateCity } from '../city/generate';
import { parseCitySource } from '../city/source';
import { stableStringify, writeStableJson } from '../city/stableJson';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));

const t0 = Date.now();
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
// Validate what will be written (a parse failure throws and fails the build)
const city = parseCityMap(JSON.parse(stableStringify(generateCity(src, pieces))), pieces);
const out = join(repo, 'map/city.json');
writeStableJson(out, city);

const bytes = statSync(out).size;
const gz = gzipSync(readFileSync(out)).length;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `map:build wrote map/city.json: ${city.props.length} props, ${city.solids.length} solids, ` +
    `${city.streets.nodes.length} street nodes, ${city.checkpoints.length} checkpoints; ` +
    `${kb(bytes)} (gzip ${kb(gz)}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
