/**
 * Builds the NSIS installer artwork from the logo.
 *
 *   npx electron assets/make-installer-art.js
 *
 * NSIS is strict about these: the sidebar must be a 164x314 BMP and the header
 * a 150x57 BMP, both 24-bit and bottom-up. Electron gives us PNG decoding and
 * compositing; the BMP container is written by hand.
 */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const SRC = path.join(__dirname, 'MineHost_logo.png');
const OUT_SIDEBAR = path.join(__dirname, 'installerSidebar.bmp');
const OUT_HEADER = path.join(__dirname, 'installerHeader.bmp');

/* Matches the app's own canvas so the installer feels like the same product. */
const CANVAS = [0x0c, 0x0d, 0x0e];      // BGR
const ACCENT = [0x44, 0xbf, 0x6b];

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

/** Crops the logo art away from its white card. */
function croppedLogo() {
  const source = nativeImage.createFromPath(SRC);
  if (source.isEmpty()) throw new Error('Cannot read MineHost_logo.png');
  const { width, height } = source.getSize();
  const box = contentBounds(source.toBitmap(), width, height);
  const side = Math.round(Math.max(box.width, box.height) * 1.04);
  return source.crop({
    x: Math.max(0, Math.round(box.left + box.width / 2 - side / 2)),
    y: Math.max(0, Math.round(box.top + box.height / 2 - side / 2)),
    width: Math.min(width, side),
    height: Math.min(height, side),
  });
}

/** 24-bit bottom-up BMP from a BGR pixel buffer. */
function writeBmp(file, pixels, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const buf = Buffer.alloc(54 + pixelBytes);

  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 3;   // BMP rows run bottom-up
    const dst = 54 + y * rowSize;
    pixels.copy(buf, dst, src, src + w * 3);
  }
  fs.writeFileSync(file, buf);
}

/** Blends an RGBA image over a solid background into a BGR buffer. */
function compose(w, h, bg, layers) {
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = bg[0];
    out[i * 3 + 1] = bg[1];
    out[i * 3 + 2] = bg[2];
  }

  for (const { image, x: ox, y: oy } of layers) {
    const { width: iw, height: ih } = image.getSize();
    const bmp = image.toBitmap();          // BGRA
    for (let y = 0; y < ih; y++) {
      const ty = oy + y;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < iw; x++) {
        const tx = ox + x;
        if (tx < 0 || tx >= w) continue;
        const s = (y * iw + x) * 4;
        const alpha = bmp[s + 3] / 255;
        if (alpha <= 0.004) continue;
        const d = (ty * w + tx) * 3;
        for (let c = 0; c < 3; c++) {
          out[d + c] = Math.round(bmp[s + c] * alpha + out[d + c] * (1 - alpha));
        }
      }
    }
  }
  return out;
}

function build() {
  const logo = croppedLogo();

  // Sidebar: logo high on a dark panel, with an accent rule beneath it.
  const sideW = 164, sideH = 314;
  const badge = logo.resize({ width: 92, height: 92, quality: 'best' });
  const side = compose(sideW, sideH, CANVAS, [
    { image: badge, x: Math.round((sideW - 92) / 2), y: 62 },
  ]);
  for (let x = 40; x < sideW - 40; x++) {
    const d = (176 * sideW + x) * 3;
    side[d] = ACCENT[0]; side[d + 1] = ACCENT[1]; side[d + 2] = ACCENT[2];
  }
  writeBmp(OUT_SIDEBAR, side, sideW, sideH);

  // Header: small mark on the right, as NSIS draws its text on the left.
  const headW = 150, headH = 57;
  const mark = logo.resize({ width: 38, height: 38, quality: 'best' });
  const head = compose(headW, headH, CANVAS, [
    { image: mark, x: headW - 38 - 12, y: Math.round((headH - 38) / 2) },
  ]);
  writeBmp(OUT_HEADER, head, headW, headH);

  console.log('installerSidebar.bmp (164x314) and installerHeader.bmp (150x57) written');
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
