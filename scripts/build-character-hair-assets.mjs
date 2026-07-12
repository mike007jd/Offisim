#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { buildToyHairAssets, HAIR_ASSET_IDS, renderHairEvidence } from './lib/toy-hair-assets.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outDir = resolve(argument('--out-dir', 'apps/desktop/renderer/src/assets/characters'));
const evidenceDir = resolve(argument('--evidence-dir', '.dev-dispatch/evidence/Offisim/hair'));

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
await mkdir(outDir, { recursive: true });
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const manifestPath = join(outDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.hair = {};
const geometries = await buildToyHairAssets({ io, outDir, manifest });
for (const file of Object.keys(manifest.files)) {
  manifest.files[file] = (await stat(join(outDir, file))).size;
}
manifest.totalBytes = Object.values(manifest.files).reduce((sum, bytes) => sum + bytes, 0);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await renderHairEvidence(evidenceDir, geometries);
console.log(`built ${HAIR_ASSET_IDS.length} hair GLBs in ${outDir}`);
console.log(`wrote ordered previews and manifest to ${evidenceDir}`);
