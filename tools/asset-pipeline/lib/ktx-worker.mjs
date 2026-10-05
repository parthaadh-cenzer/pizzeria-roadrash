// Worker thread: encodes one RGBA image to KTX2 (Basis ETC1S or UASTC).
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';

// The Basis encoder prints progress to stdout; keep pipeline output readable.
process.stdout.write = () => true;

const { encodeToKTX2 } = await import('ktx2-encoder');

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

parentPort.on('message', async (job) => {
  try {
    const out = await encodeToKTX2(new Uint8Array(job.png), {
      isUASTC: job.uastc,
      isNormalMap: job.normal,
      isPerceptual: job.srgb,
      isSetKTX2SRGBTransferFunc: job.srgb,
      generateMipmap: true,
      qualityLevel: job.normal ? 255 : 170,
      compressionLevel: 2,
      needSupercompression: true,
      uastcLDRQualityLevel: 1,
      enableRDO: job.uastc,
      rdoQualityLevel: 1.5,
      imageDecoder,
    });
    parentPort.postMessage({ id: job.id, ok: true, data: out }, [out.buffer]);
  } catch (e) {
    parentPort.postMessage({ id: job.id, ok: false, error: String(e && e.message ? e.message : e) });
  }
});
