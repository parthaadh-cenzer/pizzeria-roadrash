// Atlas-aware tint masks. Colour variants hue-shift only masked texels; exposed skin is
// detected and excluded so variants never recolour skin (Scarlet Proxy requirement).
import sharp from 'sharp';

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * nonSkin: saturated non-skin regions (hue-shift riders with coloured gear).
 * paint:   saturated regions (bikes).
 * dye:     every non-skin texel, including neutral black/grey fabric and armour; warm skin and hair
 *          tones are excluded, holes enclosed by them (mouth, eye sockets) are filled, and the
 *          exclusion is grown so filtering never bleeds dye onto skin. Bright trim is kept lighter.
 */
export type MaskKind = 'nonSkin' | 'paint' | 'dye';

export async function tintMask(img: Uint8Array, kind: MaskKind, size = 512): Promise<{ png: Buffer; coverage: number }> {
  const { data, info } = await sharp(img).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = Buffer.alloc(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3]! / 255, g = data[i * 3 + 1]! / 255, b = data[i * 3 + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max, d = max - min, s = max > 1e-5 ? d / max : 0;
    let h = 0;
    if (d > 1e-5) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    let m: number;
    if (kind === 'dye') {
      const warm = h <= 55 || h >= 340 ? smooth(0.1, 0.2, s) : 0;
      m = (1 - warm) * (1 - 0.6 * smooth(0.62, 0.9, v));
    } else if (kind === 'nonSkin') {
      const skin = h >= 4 && h <= 48 && s >= 0.16 && s <= 0.68 && v > 0.26 && r > g && g >= b * 0.9;
      m = skin ? 0 : smooth(0.24, 0.5, s) * smooth(0.1, 0.28, v);
    } else {
      m = smooth(0.22, 0.48, s) * smooth(0.08, 0.24, v);
    }
    out[i] = Math.round(m * 255);
    sum += m;
  }
  if (kind === 'dye') sum = protectSkin(out, info.width, info.height) * n;
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(1.2).png().toBuffer();
  return { png, coverage: sum / n };
}

/** Fills masked holes enclosed by excluded texels and grows the exclusion; returns coverage. */
function protectSkin(m: Buffer, w: number, h: number): number {
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || m[i]! < 128) continue;
    outside[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  let excl = new Uint8Array(n);
  for (let i = 0; i < n; i++) excl[i] = m[i]! < 128 || !outside[i] ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const grown = excl.slice();
    for (let i = 0; i < n; i++) {
      if (excl[i]) continue;
      const x = i % w, y = (i / w) | 0;
      if ((x > 0 && excl[i - 1]) || (x < w - 1 && excl[i + 1]) || (y > 0 && excl[i - w]) || (y < h - 1 && excl[i + w])) grown[i] = 1;
    }
    excl = grown;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (excl[i]) m[i] = 0;
    sum += m[i]! / 255;
  }
  return sum / n;
}
