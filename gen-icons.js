const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function dist(x1,y1,x2,y2) { return Math.sqrt((x1-x2)**2+(y1-y2)**2); }

function createPNG(size) {
  const w = size, h = size;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const m = 0.04;

  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const idx = y * (w * 3 + 1) + 1 + x * 3;
      const nx = x / w, ny = y / h;

      let r = 18, g = 18, b = 30;

      // Rounded rect check
      const pad = 0.03;
      const corner = 0.06;
      const ix = nx - pad, iy = ny - pad;
      const iw = 1 - pad*2, ih = 1 - pad*2;
      let inside = false;
      if (ix >= corner && ix <= iw - corner && iy >= 0 && iy <= ih) inside = true;
      if (iy >= corner && iy <= ih - corner && ix >= 0 && ix <= iw) inside = true;
      if (!inside) {
        const cdx = ix < corner ? corner : (ix > iw-corner ? iw-corner : ix);
        const cdy = iy < corner ? corner : (iy > ih-corner ? ih-corner : iy);
        if (dist(ix, iy, cdx, cdy) <= corner) inside = true;
      }

      if (inside) {
        // Gradient background
        const t = ny;
        r = 30 + t * 10;
        g = 50 + t * 47;
        b = 220 + t * 18;

        // --- WHITE HEALTHCARE CROSS ---
        const cx = 0.5, cy = 0.42;
        const vw = 0.09, vh = 0.24;  // vertical arm
        const hw = 0.22, hh = 0.09;  // horizontal arm
        const inV = Math.abs(nx - cx) < vw && Math.abs(ny - cy) < vh;
        const inH = Math.abs(nx - cx) < hw && Math.abs(ny - cy) < hh;
        // Rounded cross ends
        const endR = 0.025;
        const topCap = dist(nx, ny, cx, cy - vh + endR) <= endR && Math.abs(nx-cx) < vw;
        const botCap = dist(nx, ny, cx, cy + vh - endR) <= endR && Math.abs(nx-cx) < vw;
        const lftCap = dist(nx, ny, cx - hw + endR, cy) <= endR && Math.abs(ny-cy) < hh;
        const rgtCap = dist(nx, ny, cx + hw - endR, cy) <= endR && Math.abs(ny-cy) < hh;

        if (inV || inH || topCap || botCap || lftCap || rgtCap) {
          r = 255; g = 255; b = 255;
        }

        // --- RED HEART below cross ---
        const hcx = 0.5, hcy = 0.72;
        const hs = 0.085;
        const dx = (nx - hcx) / hs;
        const dy = (ny - hcy) / hs;
        const leftCirc = dist(dx+0.4, dy+0.2, 0, 0) < 1;
        const rightCirc = dist(dx-0.4, dy+0.2, 0, 0) < 1;
        const inHeart = (leftCirc || rightCirc) && dy < 0.1;
        const inTri = dy >= 0.0 && dy < 1.2 && Math.abs(dx) < (1.2 - dy) * 0.78;
        if ((inHeart || inTri) && dy < 1.2 && dy > -0.65) {
          r = 255; g = 50; b = 70;
        }

        // --- "LMS" simple block text ---
        const ty = 0.89;
        const th = 0.04;
        const tw = th * 0.15;
        if (Math.abs(ny - ty) < th && ny > ty - th && ny < ty + th) {
          // L at 0.28
          if (nx > 0.28 && nx < 0.28 + tw*4) {
            const lx = (nx - 0.28) / (tw*4);
            if (lx < 0.3 || (lx > 0.7 && ny > ty)) { r = 255; g = 255; b = 255; }
          }
          // M at 0.42
          if (nx > 0.42 && nx < 0.42 + tw*5) {
            const mx = (nx - 0.42) / (tw*5);
            if (mx < 0.15 || mx > 0.85 || (Math.abs(mx-0.5) < 0.15 && ny < ty) || Math.abs(mx-0.5) < 0.08) {
              r = 255; g = 255; b = 255;
            }
          }
          // S at 0.58
          if (nx > 0.58 && nx < 0.58 + tw*4.5) {
            const sx = (nx - 0.58) / (tw*4.5);
            const sy = (ny - ty) / th;
            const curve = 0.3 + 0.4 * Math.sin(sx * Math.PI * 2 - Math.PI/2);
            if (Math.abs(sy - (curve - 0.3)) < 0.35 && sx > 0.05 && sx < 0.95) {
              r = 255; g = 255; b = 255;
            }
          }
        }
      }

      raw[idx] = Math.max(0, Math.min(255, Math.round(r)));
      raw[idx+1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[idx+2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }

  const compressed = zlib.deflateSync(raw);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([t, data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([l, combined, c]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, 'public');
fs.writeFileSync(path.join(dir, 'icon-192.png'), createPNG(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), createPNG(512));
console.log('Healthcare icons created!');
