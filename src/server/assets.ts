// Host-side runtime asset verification: required gameplay assets missing -> race start blocked.
import fs from 'node:fs';
import path from 'node:path';
import { ASSET_REGISTRY } from '../config/assets.js';
import type { RuntimeManifest } from '../shared/manifest.js';
import type { AssetStatus } from '../shared/protocol.js';

export function checkRuntimeAssets(staticRoot: string): AssetStatus {
  const base = path.join(staticRoot, 'runtime-assets');
  const manifestPath = path.join(base, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      missingRequired: ASSET_REGISTRY.filter((a) => a.required).map((a) => `${a.id} (no runtime manifest; run npm run assets:build)`),
      missingOptional: [],
      manifestVersion: null,
    };
  }
  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
  } catch (e) {
    return { ok: false, missingRequired: [`manifest.json unreadable: ${(e as Error).message}`], missingOptional: [], manifestVersion: null };
  }
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  for (const def of ASSET_REGISTRY) {
    const entry = manifest.entries[def.id];
    const bucket = def.required ? missingRequired : missingOptional;
    if (!entry) {
      bucket.push(`${def.id} (not in manifest)`);
      continue;
    }
    for (const [role, rel] of Object.entries(entry.files)) {
      if (!fs.existsSync(path.join(base, rel))) bucket.push(`${def.id}:${role} (${rel} missing)`);
    }
  }
  return { ok: missingRequired.length === 0, missingRequired, missingOptional, manifestVersion: manifest.manifestVersion };
}
