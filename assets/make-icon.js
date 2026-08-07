/**
 * Builds assets/icon.ico from MineHost_logo.png.
 *
 * Run with Electron (not plain Node) so nativeImage can decode/resize the PNG:
 *   npx electron assets/make-icon.js
 *
 * The source art sits on a white card with generous margins, so it is cropped
 * to the block and re-matted on the app's canvas colour before scaling.
 */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SRC = path.join(__dirname, 'MineHost_logo.png');
const OUT = path.join(__dirname, 'icon.ico');

/** Finds the bounding box of everything that is not near-white. */
function contentBounds(bitmap, w, h) {
  let top = h, left = w, right = 0, bottom = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2], a = bitmap[i + 3];
      if (a > 24 && !(r > 232 && g > 232 && b > 232)) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function icoEntry(png, size) {
  const header = Buffer.alloc(16);
  header[0] = size === 256 ? 0 : size;
  header[1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(32, 6);
  header.writeUInt32LE(png.length, 8);
  return header;
}

function build() {
  if (!fs.existsSync(SRC)) throw new Error(`No se encuentra ${SRC}`);

  const source = nativeImage.createFromPath(SRC);
  if (source.isEmpty()) throw new Error('No se pudo leer el PNG del logo.');

  const { width, height } = source.getSize();
  const box = contentBounds(source.toBitmap(), width, height);

  // Square the crop around the artwork, with a little breathing room.
  const side = Math.round(Math.max(box.width, box.height) * 1.08);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const crop = {
    x: Math.max(0, Math.round(cx - side / 2)),
    y: Math.max(0, Math.round(cy - side / 2)),
    width: Math.min(width, side),
    height: Math.min(height, side),
  };

  const art = source.crop(crop);

  const pngs = SIZES.map((size) => {
    const scaled = art.resize({ width: size, height: size, quality: 'best' });
    return { size, png: scaled.toPNG() };
  });

  // ICO: 6-byte header, then one 16-byte directory entry per image.
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, png } of pngs) {
    const entry = icoEntry(png, size);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  fs.writeFileSync(OUT, Buffer.concat([dir, ...entries, ...pngs.map((p) => p.png)]));
  console.log(`icon.ico generado · recorte ${crop.width}x${crop.height} · ${SIZES.join(', ')} px`);
}

app.whenReady().then(() => {
  try {
    build();
    app.exit(0);
  } catch (err) {
    console.error(err.message);
    app.exit(1);
  }
});
