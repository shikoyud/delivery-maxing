import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePieceCatalog } from '@dm/shared';
import { type AssetsConfig, runAssetPipeline } from '../assets/pipeline';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const cfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as AssetsConfig;
const assets = join(repo, 'assets');

const t0 = Date.now();
const catalog = parsePieceCatalog(await runAssetPipeline(cfg, assets, assets));
writeFileSync(join(repo, 'map/pieces.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`assets:build wrote ${Object.keys(catalog).length} pieces in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
