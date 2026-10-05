// Graphics presets change rendering cost only; gameplay visibility (fog, draw distance) is kept.
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/render/RenderCore.js';
import { DISTRICT_LOOK } from '../src/render/materials/Palette.js';
import { GRAPHICS_PRESETS } from '../src/shared/ids.js';

describe('graphics presets', () => {
  it('all presets use identical fog, so hazards read at the same distance everywhere', () => {
    for (const p of GRAPHICS_PRESETS) expect(PRESETS[p].fogDensityScale).toBe(PRESETS.HIGH.fogDensityScale);
  });

  it('draw distance never cuts geometry the fog would still show (worst: clearest district, light rain)', () => {
    const clearest = Math.min(...Object.values(DISTRICT_LOOK).map((l) => l.fogDensity));
    // Environment: density = look.fogDensity * (0.8 + weather * 0.28) * scale; weather >= 0.
    for (const p of GRAPHICS_PRESETS) {
      const density = clearest * 0.8 * PRESETS[p].fogDensityScale;
      const visibleAtCutoff = Math.exp(-((density * PRESETS[p].drawDistance) ** 2));
      expect(visibleAtCutoff).toBeLessThan(0.02);
    }
  });

  it('hazard reaction distance stays visible in the densest weather on every preset', () => {
    const densest = Math.max(...Object.values(DISTRICT_LOOK).map((l) => l.fogDensity));
    const reaction = 80; // 1 s at top speed
    for (const p of GRAPHICS_PRESETS) {
      const density = densest * (0.8 + 3 * 0.28) * PRESETS[p].fogDensityScale;
      expect(Math.exp(-((density * reaction) ** 2))).toBeGreaterThan(0.5);
    }
  });
});
