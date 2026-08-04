/**
 * Generates assets/icon.ico (a stylised grass block) without external
 * dependencies, by writing a multi-size ICO of raw BGRA bitmaps.
 */
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const hex = (h) => [
  parseInt(h.slice(5, 7), 16), // B
  parseInt(h.slice(3, 5), 16), // G
  parseInt(h.slice(1, 3), 16), // R
];

const GRASS_TOP = hex('#7ACC4F');
const GRASS_MID = hex('#5FA83B');
const DIRT_HI = hex('#7D5637');
const DIRT = hex('#6B4A2F');
const DIRT_LO = hex('#553A25');

function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;

  // Rounded-square mask
  const r = 0.17;
  const cx = Math.min(u, 1 - u);
  const cy = Math.min(v, 1 - v);
  if (cx < r && cy < r) {
    const dx = r - cx;
    const dy = r - cy;
    if (dx * dx + dy * dy > r * r) return null;
  }

  // Grass layer occupies the top ~38%
  if (v < 0.38) {
    const speck = ((x * 7 + y * 13) % 11) < 3;
    if (v < 0.07) return GRASS_TOP;
    return speck ? GRASS_TOP : GRASS_MID;
  }
  // Transition edge
  if (v < 0.44) return DIRT_HI;

  const speck = ((x * 5 + y * 11) % 13) < 4;
  const deep = ((x * 3 + y * 7) % 17) < 3;
  if (deep) return DIRT_LO;
  return speck ? DIRT_HI : DIRT;
}

function bmpFor(size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // image + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);

  const pixels = Buffer.alloc(size * size * 4);
  // ICO stores rows bottom-up
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = pixel(x, y, size);
      const off = ((size - 1 - y) * size + x) * 4;
      if (!src) {
        pixels.writeUInt32LE(0, off);
        continue;
      }
      pixels[off] = src[0];
      pixels[off + 1] = src[1];
      pixels[off + 2] = src[2];
      pixels[off + 3] = 255;
    }
  }

  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);

  return Buffer.concat([header, pixels, mask]);
}

const images = SIZES.map(bmpFor);

const dir = Buffer.alloc(6 + images.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(images.length, 4);

let offset = dir.length;
images.forEach((img, i) => {
  const size = SIZES[i];
  const e = 6 + i * 16;
  dir[e] = size === 256 ? 0 : size;
  dir[e + 1] = size === 256 ? 0 : size;
  dir[e + 2] = 0;
  dir[e + 3] = 0;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(img.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += img.length;
});

fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([dir, ...images]));
console.log('icon.ico generado');
