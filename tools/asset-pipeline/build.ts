// npm run assets:build — Assets/ (immutable) -> tools/asset-pipeline -> public/runtime-assets/
// Usage: npm run assets:build [-- --only=bikes,riders]
import fs from 'node:fs';
import path from 'node:path';
import { ASSET_REGISTRY } from '../../src/config/assets.js';
import type { ManifestEntry, RuntimeManifest } from '../../src/shared/manifest.js';
import { OUT_ROOT, PIPELINE_VERSION, ROOT } from './lib/core.js';
import { appIcon } from './lib/generated.js';
import { closeTexturePool } from './lib/textures.js';
import { buildBikes } from './recipes/bikes.js';
import { buildCrowd, buildRiders, buildStarter } from './recipes/characters.js';
import { buildCity } from './recipes/city.js';
import { buildClips } from './recipes/clips.js';
import { buildTextures } from './recipes/textures.js';
import { buildWeapons } from './recipes/weapons.js';

const STAGES: Record<string, () => Promise<ManifestEntry[] | ManifestEntry>> = {
  clips: buildClips,
  textures: buildTextures,
  bikes: buildBikes,
  riders: buildRiders,
  weapons: buildWeapons,
  starter: buildStarter,
  crowd: buildCrowd,
  city: buildCity,
};

async function main(): Promise<void> {
  const t0 = Date.now();
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1]!.split(',') : null;
  console.log(`Pizzeria Roadrash asset pipeline v${PIPELINE_VERSION}`);
  const unknown = (only ?? []).filter((s) => !(s in STAGES));
  if (unknown.length) {
    console.error(`FAIL: unknown stage(s) ${unknown.join(', ')}; stages are: ${Object.keys(STAGES).join(', ')}`);
    process.exit(1);
  }

  // 1. Source existence: required missing -> fail loudly; optional missing -> warn + skip.
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  for (const def of ASSET_REGISTRY) {
    for (const s of def.sources) {
      if (!fs.existsSync(path.join(ROOT, s))) (def.required ? missingRequired : missingOptional).push(`${def.id}: ${s}`);
    }
  }
  if (missingRequired.length) {
    console.error('\nFAIL: required source assets are missing:\n  ' + missingRequired.join('\n  '));
    process.exit(1);
  }
  for (const m of missingOptional) console.warn(`  WARNING optional source missing (skipped): ${m}`);
  const skip = new Set(missingOptional.map((m) => m.split(':')[0]!));

  // 2. Previous manifest (for partial rebuilds).
  const manifestPath = path.join(OUT_ROOT, 'manifest.json');
  const prev: RuntimeManifest | null = fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest) : null;
  const entries: Record<string, ManifestEntry> = only && prev ? { ...prev.entries } : {};
  const warnings: string[] = [];

  fs.mkdirSync(OUT_ROOT, { recursive: true });
  for (const [name, run] of Object.entries(STAGES)) {
    if (only && !only.includes(name)) continue;
    console.log(`\n[${name}]`);
    try {
      const res = await run();
      for (const e of Array.isArray(res) ? res : [res]) {
        if (skip.has(e.id)) continue;
        entries[e.id] = e;
      }
    } catch (e) {
      console.error(`\nFAIL in stage ${name}:`, e);
      await closeTexturePool();
      process.exit(1);
    }
  }
  await closeTexturePool();

  // 3. Vendor decoders (served locally so the LAN game works offline from the internet).
  const basisDir = path.join(OUT_ROOT, 'basis');
  fs.mkdirSync(basisDir, { recursive: true });
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(ROOT, 'node_modules/three/examples/jsm/libs/basis', f), path.join(basisDir, f));

  // 4. PWA icons (generated in-project; no final branding asset exists).
  const iconDir = path.join(ROOT, 'public', 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  for (const [size, maskable] of [[192, false], [512, false], [512, true], [180, false]] as const) {
    fs.writeFileSync(path.join(iconDir, `icon-${size}${maskable ? '-maskable' : ''}.png`), await appIcon(size, maskable));
  }

  for (const def of ASSET_REGISTRY) {
    if (!entries[def.id] && !def.required) warnings.push(`optional asset ${def.id} not produced`);
    if (!entries[def.id] && def.required) warnings.push(`REQUIRED asset ${def.id} not produced`);
  }
  const manifest: RuntimeManifest = {
    manifestVersion: new Date().toISOString().slice(0, 10) + '-' + Object.keys(entries).length,
    pipelineVersion: PIPELINE_VERSION,
    generatedAt: new Date().toISOString(),
    entries,
    missingSources: missingOptional,
    warnings,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  // 5. Remove stale outputs not referenced by the manifest.
  const referenced = new Set<string>(['manifest.json', 'basis/basis_transcoder.js', 'basis/basis_transcoder.wasm']);
  for (const e of Object.values(entries)) for (const f of Object.values(e.files)) referenced.add(f);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  let removed = 0;
  for (const f of walk(OUT_ROOT)) {
    const rel = path.relative(OUT_ROOT, f).split(path.sep).join('/');
    if (!referenced.has(rel)) {
      fs.unlinkSync(f);
      removed++;
    }
  }

  const total = Object.values(entries).reduce((a, e) => a + e.bytes, 0);
  console.log(`\nWrote ${Object.keys(entries).length} runtime assets (${(total / 1e6).toFixed(1)} MB), removed ${removed} stale files, in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  for (const w of warnings) console.warn('  WARNING ' + w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
