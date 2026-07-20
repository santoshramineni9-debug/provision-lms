const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const w = size, h = size;

  // Build raw image data (RGB, no alpha in raw, PNG will handle)
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const cx = x - w / 2, cy = y - h / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const idx = y * (w * 3 + 1) + 1 + x * 3;
      if (dist < w / 2 - 4) {
        raw[idx] = 67; raw[idx + 1] = 97; raw[idx + 2] = 238;
      } else if (dist < w / 2) {
        raw[idx] = 255; raw[idx + 1] = 255; raw[idx + 2] = 255;
      } else {
        raw[idx] = 26; raw[idx + 1] = 26; raw[idx + 2] = 46;
      }
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
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([lenBuf, combined, crcBuf]);
  }

  // IHDR data: width(4) + height(4) + bitDepth(1) + colorType(1) + compression(1) + filter(1) + interlace(1) = 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

const dir = path.join(__dirname, 'public');
fs.writeFileSync(path.join(dir, 'icon-192.png'), createPNG(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), createPNG(512));
console.log('Icons created!');
