/**
 * Generates minimal PNG icons for the Chrome extension.
 * Uses raw PNG encoding (no dependencies) to create a simple "{ }" braces icon.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'icons');
mkdirSync(iconsDir, { recursive: true });

function createPng(size) {
  const pixels = Buffer.alloc(size * size * 4);

  const bg = [37, 99, 235]; // #2563eb
  const fg = [255, 255, 255]; // white

  // Fill background
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = 255;
  }

  // Draw rounded corners (clear pixels in corners)
  const r = Math.max(2, Math.floor(size * 0.15));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cornerDist = Infinity;
      // Check each corner
      for (const [cx, cy] of [[r, r], [size - 1 - r, r], [r, size - 1 - r], [size - 1 - r, size - 1 - r]]) {
        if ((x <= r || x >= size - 1 - r) && (y <= r || y >= size - 1 - r)) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (((x <= r && cx === r) || (x >= size - 1 - r && cx === size - 1 - r)) &&
              ((y <= r && cy === r) || (y >= size - 1 - r && cy === size - 1 - r))) {
            cornerDist = Math.min(cornerDist, dist);
          }
        }
      }
      if (cornerDist > r + 0.5) {
        pixels[(y * size + x) * 4 + 3] = 0; // transparent
      }
    }
  }

  // Draw "{ }" using simple pixel patterns
  const scale = size / 16;
  const drawPixel = (px, py) => {
    const sx = Math.round(px * scale);
    const sy = Math.round(py * scale);
    const w = Math.max(1, Math.round(scale));
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const fx = sx + dx;
        const fy = sy + dy;
        if (fx >= 0 && fx < size && fy >= 0 && fy < size) {
          const idx = (fy * size + fx) * 4;
          if (pixels[idx + 3] > 0) {
            pixels[idx] = fg[0];
            pixels[idx + 1] = fg[1];
            pixels[idx + 2] = fg[2];
          }
        }
      }
    }
  };

  // Left brace {
  for (let y = 4; y <= 12; y++) drawPixel(5, y);
  drawPixel(6, 4); drawPixel(6, 12);
  drawPixel(4, 7); drawPixel(4, 8); drawPixel(4, 9);

  // Right brace }
  for (let y = 4; y <= 12; y++) drawPixel(10, y);
  drawPixel(9, 4); drawPixel(9, 12);
  drawPixel(11, 7); drawPixel(11, 8); drawPixel(11, 9);

  // Encode as PNG
  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 4)] = 0; // filter: none
    pixels.copy(rawData, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = deflateSync(rawData);

  const crc32Table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc32Table[n] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const iend = Buffer.alloc(0);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', iend)]);
}

for (const size of [16, 48, 128]) {
  const png = createPng(size);
  const path = resolve(iconsDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}
