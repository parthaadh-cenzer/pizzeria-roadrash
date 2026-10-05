// Internally generated fictional graphics (no external ad services, no real brands).
import sharp from 'sharp';
import { mulberry32 } from '../../../src/shared/math.js';

const BRANDS = [
  'PIZZERIA ROADRASH', 'NEON NOODLE', 'KAIJU COLA', 'OBSIDIAN BANK', 'SYNTH FM 88.9', 'RAIN CITY',
  'CHROME KITTY', 'VOLT DINER', 'HYPERLANE', 'GHOST PROTOCOL', 'ONI SAKE', 'MIDNIGHT RAMEN',
  'ZERO-G GYM', 'LUMEN OPTICS', 'RIOT RADIO', 'NEBULA NAILS', 'WETWARE CLINIC', 'TURBO TACO',
  'SKYHOOK AIR', 'PIXEL DOJO', 'ARC VAPOR', 'NOIR CINEMA', 'ORBITAL PIZZA', 'STATIC BLUE',
];
const GLYPHS = ['電', '夜', '雨', '速', '鬼', '光', '街', '火', '風', '夢', '龍', '刀'];
const PALETTE = ['#18e0ff', '#ff2bd6', '#8a3dff', '#ff2a3a', '#ff7a1a', '#ffc21a', '#3dff9a', '#ffffff'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** A dense grid of fictional neon advertisements. */
export async function adAtlas(seed: number, size = 2048, cols = 4, rows = 4): Promise<Buffer> {
  const rnd = mulberry32(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const cw = size / cols, ch = size / rows;
  let body = `<rect width="${size}" height="${size}" fill="#05060c"/>`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw, y = r * ch;
      const a = pick(PALETTE), b = pick(PALETTE);
      const id = `g${r}_${c}`;
      const style = Math.floor(rnd() * 4);
      body += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${rnd() > 0.5 ? 1 : 0}" y2="1"><stop offset="0" stop-color="${a}" stop-opacity="0.95"/><stop offset="1" stop-color="${b}" stop-opacity="0.85"/></linearGradient></defs>`;
      if (style === 0) {
        body += `<rect x="${x + 8}" y="${y + 8}" width="${cw - 16}" height="${ch - 16}" fill="url(#${id})"/>`;
        body += `<text x="${x + cw / 2}" y="${y + ch * 0.58}" font-family="Arial Black,Impact,sans-serif" font-size="${ch * 0.16}" font-weight="900" text-anchor="middle" fill="#05060c">${esc(pick(BRANDS))}</text>`;
      } else if (style === 1) {
        body += `<rect x="${x + 6}" y="${y + 6}" width="${cw - 12}" height="${ch - 12}" fill="#070812" stroke="${a}" stroke-width="10"/>`;
        body += `<text x="${x + cw / 2}" y="${y + ch * 0.62}" font-family="serif" font-size="${ch * 0.5}" text-anchor="middle" fill="${a}">${pick(GLYPHS)}${pick(GLYPHS)}</text>`;
        body += `<text x="${x + cw / 2}" y="${y + ch * 0.88}" font-family="Arial,sans-serif" font-size="${ch * 0.09}" font-weight="700" text-anchor="middle" fill="${b}">${esc(pick(BRANDS))}</text>`;
      } else if (style === 2) {
        body += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="#090a14"/>`;
        for (let k = 0; k < 7; k++) body += `<rect x="${x + 10}" y="${y + 14 + k * (ch / 7.3)}" width="${(cw - 20) * (0.3 + rnd() * 0.7)}" height="${ch / 12}" fill="${k % 2 ? a : b}" opacity="0.9"/>`;
        body += `<text x="${x + 18}" y="${y + ch * 0.95}" font-family="Arial Black,sans-serif" font-size="${ch * 0.1}" fill="#ffffff">${esc(pick(BRANDS))}</text>`;
      } else {
        body += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="url(#${id})" opacity="0.35"/>`;
        body += `<circle cx="${x + cw / 2}" cy="${y + ch / 2}" r="${Math.min(cw, ch) * 0.34}" fill="none" stroke="${a}" stroke-width="14"/>`;
        body += `<text x="${x + cw / 2}" y="${y + ch * 0.58}" font-family="Arial Black,sans-serif" font-size="${ch * 0.12}" text-anchor="middle" fill="#ffffff">${esc(pick(BRANDS).split(' ')[0]!)}</text>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** App icon: rain-slick neon "PR" monogram. */
export async function appIcon(size: number, maskable: boolean): Promise<Buffer> {
  const pad = maskable ? size * 0.18 : size * 0.06;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0b1a"/><stop offset="1" stop-color="#1a0620"/></linearGradient>
  <linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2a3a"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.18}" fill="url(#bg)"/>
  <circle cx="${size / 2}" cy="${size * 0.56}" r="${size / 2 - pad}" fill="none" stroke="#18e0ff" stroke-width="${size * 0.035}" opacity="0.8"/>
  <text x="${size / 2}" y="${size * 0.64}" font-family="Arial Black,Impact,sans-serif" font-size="${(size - pad * 2) * 0.46}" font-weight="900" text-anchor="middle" fill="url(#t)" font-style="italic">PR</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
