// Registry consistency and the built runtime assets (the same checks as npm run assets:verify).
import { describe, expect, it } from 'vitest';
import { ASSET_REGISTRY } from '../src/config/assets.js';
import { REQUIRED_RUNTIME_ASSETS } from '../src/config/runtimeAssets.js';
import { summarize, verifyAssets } from '../tools/asset-pipeline/verify.js';

describe('asset registry', () => {
  it('the client-side required list matches the registry exactly', () => {
    const registry = ASSET_REGISTRY.filter((a) => a.required).map((a) => a.id).sort();
    expect([...REQUIRED_RUNTIME_ASSETS].sort()).toEqual(registry);
  });

  it('built runtime assets pass every verification section', async () => {
    const results = await verifyAssets({ hashSources: false });
    const failures = results.filter((r) => r.level === 'FAIL').map((r) => `${r.section}: ${r.message}`);
    expect(failures).toEqual([]);
    expect(summarize(results).every((s) => s.level !== 'FAIL')).toBe(true);
  });
});
