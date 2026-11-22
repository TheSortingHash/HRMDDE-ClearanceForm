/**
 * Built-in QR code generator (no external service): byte mode (UTF-8), versions 1–20, automatic
 * mask selection, PNG output. To keep the code as small (easy to scan) as possible it uses the smallest
 * version that fits, preferring error-correction level M (15%) and dropping to L (7%) only when that
 * gives a smaller code.
 *
 *   qrPngBlob_('https://…')  → image/png Blob, ready for Sheet.insertImage()
 *
 * Implements ISO/IEC 18004: Reed–Solomon error correction over GF(256), function patterns,
 * format/version information and the 8 mask patterns with the standard penalty rules.
 */

/** Error-correction blocks per version and level: [count, totalCodewords, dataCodewords, …]. */
const QR_RS_L_ = [[1, 26, 19], [1, 44, 34], [1, 70, 55], [1, 100, 80], [1, 134, 108], [2, 86, 68], [2, 98, 78],
  [2, 121, 97], [2, 146, 116], [2, 86, 68, 2, 87, 69], [4, 101, 81], [2, 116, 92, 2, 117, 93], [4, 133, 107],
  [3, 145, 115, 1, 146, 116], [5, 109, 87, 1, 110, 88], [5, 122, 98, 1, 123, 99], [1, 135, 107, 5, 136, 108],
  [5, 150, 120, 1, 151, 121], [3, 141, 113, 4, 142, 114], [3, 135, 107, 5, 136, 108]];
const QR_RS_M_ = [[1, 26, 16], [1, 44, 28], [1, 70, 44], [2, 50, 32], [2, 67, 43], [4, 43, 27], [4, 49, 31],
  [2, 60, 38, 2, 61, 39], [3, 58, 36, 2, 59, 37], [4, 69, 43, 1, 70, 44], [1, 80, 50, 4, 81, 51],
  [6, 58, 36, 2, 59, 37], [8, 59, 37, 1, 60, 38], [4, 64, 40, 5, 65, 41], [5, 65, 41, 5, 66, 42],
  [7, 73, 45, 3, 74, 46], [10, 74, 46, 1, 75, 47], [9, 69, 43, 4, 70, 44], [3, 70, 44, 11, 71, 45],
  [3, 67, 41, 13, 68, 42]];

/** Alignment pattern centre coordinates per version. */
const QR_ALIGN_ = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
  [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];

const QR_LEVELS_ = { L: { table: QR_RS_L_, bits: 1 }, M: { table: QR_RS_M_, bits: 0 } };

/* ------------------------------------------------------------------ GF(256) */
const QR_EXP_ = new Array(512);
const QR_LOG_ = new Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_EXP_[i] = x;
    QR_LOG_[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) QR_EXP_[i] = QR_EXP_[i - 255];
})();

function qrGfMul_(a, b) {
  return a === 0 || b === 0 ? 0 : QR_EXP_[QR_LOG_[a] + QR_LOG_[b]];
}

/** Reed–Solomon error-correction codewords for `data`. */
function qrRsEncode_(data, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= qrGfMul_(gen[j], QR_EXP_[i]);
    }
    gen = next;
  }
  const res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) for (let j = 1; j < gen.length; j++) res[i + j] ^= qrGfMul_(gen[j], coef);
  }
  return res.slice(data.length);
}

/* ------------------------------------------------------------------ encoding */

function qrUtf8_(text) {
  const out = [];
  const s = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

function qrBlocks_(version, level) {
  const t = QR_LEVELS_[level].table[version - 1];
  const blocks = [];
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < t[i]; k++) blocks.push({ total: t[i + 1], data: t[i + 2] });
  return blocks;
}

/** Final codeword sequence (data + EC, interleaved) for a version. */
function qrCodewords_(bytes, version, level) {
  const blocks = qrBlocks_(version, level);
  const capacity = blocks.reduce((n, b) => n + b.data, 0);
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  if (bits.length > capacity * 8) return null;
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  blocks.forEach((b) => {
    const d = data.slice(offset, offset + b.data);
    offset += b.data;
    dataBlocks.push(d);
    ecBlocks.push(qrRsEncode_(d, b.total - b.data));
  });
  const out = [];
  const maxData = Math.max.apply(null, dataBlocks.map((d) => d.length));
  for (let i = 0; i < maxData; i++) dataBlocks.forEach((d) => { if (i < d.length) out.push(d[i]); });
  const ecLen = ecBlocks[0].length;
  for (let i = 0; i < ecLen; i++) ecBlocks.forEach((e) => out.push(e[i]));
  return out;
}

/* ------------------------------------------------------------------ matrix */

function qrBch_(data, poly, polyBits) {
  let d = data << (polyBits - 1);
  const deg = (v) => (v === 0 ? 0 : 32 - Math.clz32(v));
  while (deg(d) >= polyBits) d ^= poly << (deg(d) - polyBits);
  return (data << (polyBits - 1)) | d;
}

const QR_MASKS_ = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Builds the module matrix (true = dark) for a version and mask. */
function qrBuild_(version, mask, codewords, level) {
  const n = version * 4 + 17;
  const m = [];
  for (let i = 0; i < n; i++) m.push(new Array(n).fill(null));

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r < 0 || row + r >= n || col + c < 0 || col + c >= n) continue;
        const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[row + r][col + c] = dark;
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);

  const pos = QR_ALIGN_[version - 1];
  pos.forEach((r) => pos.forEach((c) => {
    if (m[r][c] !== null) return; // overlaps a finder pattern
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      }
    }
  }));

  for (let i = 8; i < n - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }

  // Format information (level bits: L = 01, M = 00) and the fixed dark module.
  const fmt = qrBch_((QR_LEVELS_[level].bits << 3) | mask, 0x537, 11) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((fmt >> i) & 1) === 1;
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else m[n - 15 + i][8] = bit;
    if (i < 8) m[8][n - i - 1] = bit;
    else if (i < 9) m[8][15 - i] = bit;
    else m[8][15 - i - 1] = bit;
  }
  m[n - 8][8] = true;

  // Version information (versions 7+).
  if (version >= 7) {
    const v = qrBch_(version, 0x1f25, 13);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >> i) & 1) === 1;
      m[Math.floor(i / 3)][(i % 3) + n - 11] = bit;
      m[(i % 3) + n - 11][Math.floor(i / 3)] = bit;
    }
  }

  // Data, in the zig-zag order, with the mask applied.
  const fn = QR_MASKS_[mask];
  let inc = -1;
  let row = n - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let c0 = n - 1; c0 > 0; c0 -= 2) {
    const col = c0 <= 6 ? c0 - 1 : c0;
    for (;;) {
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (m[row][c] !== null) continue;
        let dark = byteIndex < codewords.length && ((codewords[byteIndex] >> bitIndex) & 1) === 1;
        if (fn(row, c)) dark = !dark;
        m[row][c] = dark;
        if (--bitIndex === -1) { byteIndex++; bitIndex = 7; }
      }
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }
  return m;
}

/** Standard penalty score (lower is better). */
function qrPenalty_(m) {
  const n = m.length;
  let p = 0;
  // Rule 1: runs of 5+ same-colour modules in rows/columns.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = pass ? m[j][i] : m[i][j];
        const b = pass ? m[j - 1][i] : m[i][j - 1];
        if (a === b) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
  }
  // Rule 2: 2x2 blocks.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules on one side.
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= n - 11; j++) {
      let h1 = true; let h2 = true; let v1 = true; let v2 = true;
      for (let k = 0; k < 11; k++) {
        const h = m[i][j + k] ? 1 : 0;
        const v = m[j + k][i] ? 1 : 0;
        if (h !== pat1[k]) h1 = false;
        if (h !== pat2[k]) h2 = false;
        if (v !== pat1[k]) v1 = false;
        if (v !== pat2[k]) v2 = false;
      }
      p += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
    }
  }
  // Rule 4: dark/light balance.
  let dark = 0;
  m.forEach((r) => r.forEach((v) => { if (v) dark++; }));
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/**
 * QR module matrix for `text`. opts.version / opts.mask / opts.level force a choice (for testing).
 * Returns { version, level, mask, size, modules }.
 */
function qrMatrix_(text, opts) {
  const o = opts || {};
  const bytes = qrUtf8_(text);
  let version = 0;
  let level = o.level || 'M';
  let codewords = null;
  if (o.version) {
    version = o.version;
    codewords = qrCodewords_(bytes, version, level);
  } else {
    // Smallest version that fits; at equal size prefer M (more error correction) over L.
    const levels = o.level ? [o.level] : ['M', 'L'];
    for (let v = 1; v <= QR_RS_M_.length && !codewords; v++) {
      for (let i = 0; i < levels.length && !codewords; i++) {
        const cw = qrCodewords_(bytes, v, levels[i]);
        if (cw) { codewords = cw; version = v; level = levels[i]; }
      }
    }
  }
  if (!codewords) throw new Error(`Text too long for a QR code (${bytes.length} bytes).`);

  let best = null;
  const masks = o.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [o.mask];
  masks.forEach((mask) => {
    const modules = qrBuild_(version, mask, codewords, level);
    const score = masks.length > 1 ? qrPenalty_(modules) : 0;
    if (!best || score < best.score) best = { version, level, mask, size: modules.length, modules, score };
  });
  return best;
}

/* ------------------------------------------------------------------ PNG */

function qrCrcTable_() {
  if (qrCrcTable_.t) return qrCrcTable_.t;
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  qrCrcTable_.t = t;
  return t;
}

function qrCrc32_(bytes) {
  const t = qrCrcTable_();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1-bit greyscale PNG of a module matrix (unsigned byte values). */
function qrPngBytes_(modules, scale, quiet) {
  const n = modules.length;
  const size = (n + quiet * 2) * scale;
  const rowBytes = Math.ceil(size / 8);
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter: none
    const my = Math.floor(y / scale) - quiet;
    for (let xb = 0; xb < rowBytes; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        const mx = Math.floor(x / scale) - quiet;
        const dark = x < size && my >= 0 && my < n && mx >= 0 && mx < n && modules[my][mx];
        if (!dark) byte |= 0x80 >> bit; // 1 = white
      }
      raw.push(byte);
    }
  }

  // zlib stream with stored (uncompressed) deflate blocks.
  const z = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    z.push(i + len >= raw.length ? 1 : 0, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let k = 0; k < len; k++) z.push(raw[i + k]);
  }
  let a = 1; let b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  z.push(adler >>> 24, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);

  const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const chunk = (type, data) => {
    const td = type.split('').map((ch) => ch.charCodeAt(0)).concat(data);
    return u32(data.length).concat(td, u32(qrCrc32_(td)));
  };
  const ihdr = u32(size).concat(u32(size), [1, 0, 0, 0, 0]); // bit depth 1, greyscale
  return [137, 80, 78, 71, 13, 10, 26, 10].concat(chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', []));
}

/** PNG Blob of a QR code for `text`. */
function qrPngBlob_(text, scale, quiet) {
  const qr = qrMatrix_(text);
  const bytes = qrPngBytes_(qr.modules, scale || 8, quiet === undefined ? 4 : quiet);
  return Utilities.newBlob(bytes.map((v) => (v > 127 ? v - 256 : v)), 'image/png', 'qr.png');
}
