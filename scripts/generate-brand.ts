/**
 * Draws the app's icons, favicon, Apple touch icon, notification badge and social preview from
 * the pixel art below: a T-Rex in the manner of Chrome's offline game, every pixel a whole number
 * of image pixels so each size stays sharp. Needs nothing beyond Bun.
 *
 *   bun scripts/generate-brand.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const DINO = [
  "...........#########..",
  "..........##.########.",
  "..........###########.",
  "..........###########.",
  "..........###########.",
  "..........######......",
  "..........#########...",
  "#........######.......",
  "#.......#######.......",
  "##.....##########.....",
  "###...#########.#.....",
  "##############........",
  "##############........",
  ".############.........",
  "..##########..........",
  "...########...........",
  "....######............",
  ".....###.##...........",
  ".....##...#...........",
  ".....#....#...........",
  ".....##...##..........",
];

/** The ground the dino runs on: a line with a few pebbles under it, as in the game. */
const GROUND_PEBBLES = [[3, 2], [9, 1], [16, 2], [24, 1], [29, 2]];

const WORD: Record<string, string[]> = {
  t: [".#...", ".#...", "###..", ".#...", ".#...", ".#..#", "..##."],
  "-": [".....", ".....", ".....", "####.", ".....", ".....", "....."],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
};

type Rgba = [number, number, number, number];
const INK: Rgba = [0x53, 0x53, 0x53, 255];
const PAPER: Rgba = [0xf7, 0xf7, 0xf7, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

class Canvas {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, background: Rgba) {
    this.pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) this.pixels.set(background, i * 4);
  }
  rect(x: number, y: number, w: number, h: number, color: Rgba): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col++) this.pixels.set(color, (row * this.width + col) * 4);
    }
  }
  art(rows: string[], x: number, y: number, scale: number, color: Rgba): void {
    rows.forEach((row, r) => [...row].forEach((cell, c) => { if (cell === "#") this.rect(x + c * scale, y + r * scale, scale, scale, color); }));
  }
}

const artWidth = (rows: string[]) => rows[0]!.length;

/** The dino centred on a square, standing on the ground line when there is one. */
function icon(size: number, scale: number, { background = PAPER, ink = INK, ground = true } = {}): Canvas {
  const canvas = new Canvas(size, size, background);
  const w = artWidth(DINO) * scale, h = DINO.length * scale;
  // the pebbles reach two pixels of the art under the feet
  const x = Math.round((size - w) / 2 + scale);
  const y = Math.round((size - h - (ground ? 2 * scale : 0)) / 2);
  canvas.art(DINO, x, y, scale, ink);
  if (ground) {
    const thickness = Math.max(1, Math.round(scale / 2));
    const line = y + h - thickness;
    const from = Math.round(size * 0.14), to = size - from;
    canvas.rect(from, line, to - from, thickness, ink);
    for (const [at, depth] of GROUND_PEBBLES) canvas.rect(from + Math.round(((to - from) * at) / 32), line + depth * scale, scale, thickness, ink);
  }
  return canvas;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(canvas: Canvas): Buffer {
  const { width, height, pixels } = canvas;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())]);
}
/** An .ico holding one PNG, which every browser that asks for /favicon.ico reads. */
function ico(canvas: Canvas): Buffer {
  const image = png(canvas);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = canvas.width % 256;
  header[7] = canvas.height % 256;
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}

function socialPreview(): Canvas {
  const canvas = new Canvas(1280, 640, PAPER);
  const dino = 14, letter = 18, gap = 112;
  const word = ["t", "-", "r", "e", "x"];
  const wordWidth = (word.length * 6 - 1) * letter;
  const dinoWidth = artWidth(DINO) * dino;
  const left = Math.round((1280 - dinoWidth - gap - wordWidth) / 2);
  const groundY = 470, thickness = 7;
  canvas.art(DINO, left, groundY + thickness - DINO.length * dino, dino, INK);
  canvas.rect(80, groundY, 1120, thickness, INK);
  for (const [at, depth] of GROUND_PEBBLES) canvas.rect(80 + Math.round((1120 * at) / 32), groundY + depth * 12, 14, thickness, INK);
  // the word stands on the ground too
  word.forEach((glyph, i) => canvas.art(WORD[glyph]!, left + dinoWidth + gap + i * 6 * letter, groundY - 8 * letter, letter, INK));
  return canvas;
}

const root = join(import.meta.dir, "..");
const out = (path: string, bytes: Buffer) => { writeFileSync(join(root, path), bytes); console.log(path); };

out("public/icons/icon-192.png", png(icon(192, 6)));
out("public/icons/icon-512.png", png(icon(512, 16)));
// maskable: the dino and its ground inside the inner 80% circle that every mask keeps
out("public/icons/icon-maskable-192.png", png(icon(192, 4)));
out("public/icons/icon-maskable-512.png", png(icon(512, 11)));
// Android draws a notification's small icon from its alpha alone: white on transparent, no ground
out("public/icons/badge-96.png", png(icon(96, 4, { background: CLEAR, ink: WHITE, ground: false })));
out("public/apple-touch-icon.png", png(icon(180, 6)));
out("public/favicon.png", png(icon(64, 2, { ground: false })));
out("public/favicon.ico", ico(icon(32, 1, { ground: false })));
out("public/social-preview.png", png(socialPreview()));
