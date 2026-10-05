// Extracted material textures (copied from source documents, never modifying them).
import sharp from 'sharp';
import type { ManifestEntry } from '../../../src/shared/manifest.js';
import { cacheGet, cachePut, hashFile, log, readSource, recipeKey, ROOT, writeOutput } from '../lib/core.js';
import { encodeImageKtx2, type TextureRole } from '../lib/textures.js';
import { codeHashOf, libHash, registryDef, sourceInfo } from './common.js';
import path from 'node:path';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/textures.ts');

async function crop(img: Uint8Array, top: number, bottom: number): Promise<Buffer> {
  const meta = await sharp(img).metadata();
  const h = meta.height!, w = meta.width!;
  const y0 = Math.round(h * top), y1 = Math.round(h * bottom);
  return sharp(img).extract({ left: 0, top: y0, width: w, height: y1 - y0 }).resize(1024, 512, { fit: 'fill' }).png().toBuffer();
}

export async function buildTextures(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  // Wet asphalt: the line-free band between the baked edge line and the dashed centre line,
  // so lane markings can be drawn procedurally for any road width.
  {
    const id = 'texture.wetRoad';
    const src = 'Assets/City/post-apocalyptic_city.glb';
    const key = recipeKey([id, hashFile(path.join(ROOT, src)), CODE()]);
    let entry = cacheGet<ManifestEntry>(id, key);
    if (!entry) {
      const doc = await readSource(src);
      const mat = doc.getRoot().listMaterials().find((m) => /Wet_road/i.test(m.getName()));
      if (!mat) throw new Error('wet road material not found in post-apocalyptic_city.glb');
      const files: Record<string, string> = {};
      let bytes = 0;
      const put = async (role: string, img: Uint8Array | null | undefined, kind: TextureRole) => {
        if (!img) throw new Error(`wet road ${role} texture missing`);
        const cropped = await crop(img, 0.075, 0.455);
        const ktx = await encodeImageKtx2(new Uint8Array(cropped), 1024, kind);
        files[role] = writeOutput('textures', `wet_asphalt.${role}`, 'ktx2', ktx);
        bytes += ktx.byteLength;
      };
      await put('baseColor', mat.getBaseColorTexture()?.getImage(), 'color');
      await put('orm', mat.getMetallicRoughnessTexture()?.getImage(), 'data');
      await put('normal', mat.getNormalTexture()?.getImage(), 'normal');
      const def = registryDef(id);
      entry = {
        id, category: def.category, required: def.required, source: sourceInfo([src]), files, bytes, triangles: 0,
        maxTextureSize: 1024, textureFormat: 'ktx2', orientation: { forward: '+Z', up: '+Y', units: 'm' },
        notes: ['cropped to the band without baked lane markings (rows 7.5%-45.5%); G channel = roughness incl. puddle variation'],
        texture: { baseColor: files.baseColor, orm: files.orm, normal: files.normal, width: 1024, height: 512 },
      };
      cachePut(id, key, Object.values(files), entry);
      log.step(id, `extracted (${(bytes / 1e6).toFixed(2)} MB)`);
    } else log.step(id, 'cached');
    out.push(entry);
  }
  // Rain: streak mask (alpha of the streak texture) + ripple-ring normal map.
  {
    const id = 'texture.rain';
    const src = 'Assets/Weather/rain_drops_circles__download__like_please.glb';
    const key = recipeKey([id, hashFile(path.join(ROOT, src)), CODE()]);
    let entry = cacheGet<ManifestEntry>(id, key);
    if (!entry) {
      const doc = await readSource(src);
      const mats = doc.getRoot().listMaterials();
      const streakMat = mats.find((m) => m.getEmissiveTexture());
      const rippleMat = mats.find((m) => m.getNormalTexture());
      const streakImg = streakMat?.getBaseColorTexture()?.getImage();
      const rippleImg = rippleMat?.getNormalTexture()?.getImage();
      if (!streakImg || !rippleImg) throw new Error('rain textures not found');
      const alpha = await sharp(streakImg).ensureAlpha().extractChannel(3).png().toBuffer();
      const files: Record<string, string> = {};
      const s = await encodeImageKtx2(new Uint8Array(alpha), 512, 'data');
      const r = await encodeImageKtx2(rippleImg, 1024, 'normal');
      files.streak = writeOutput('textures', 'rain.streak', 'ktx2', s);
      files.ripple = writeOutput('textures', 'rain.ripple_normal', 'ktx2', r);
      const def = registryDef(id);
      entry = {
        id, category: def.category, required: def.required, source: sourceInfo([src]), files, bytes: s.byteLength + r.byteLength, triangles: 0,
        maxTextureSize: 1024, textureFormat: 'ktx2', orientation: { forward: '+Z', up: '+Y', units: 'm' },
        notes: ['streak mask from the alpha of the static rain-plane texture; ripple rings normal map animated by shader'],
        texture: { alpha: files.streak, normal: files.ripple, width: 1024, height: 1024 },
      };
      cachePut(id, key, Object.values(files), entry);
      log.step(id, 'extracted');
    } else log.step(id, 'cached');
    out.push(entry);
  }
  return out;
}
