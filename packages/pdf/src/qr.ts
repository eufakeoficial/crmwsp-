/**
 * Minimal QR Code encoder: byte mode, error correction level M, versions 1-15
 * (up to ~400 bytes). Enough for payment URLs; no dependency.
 * Returns a square boolean matrix (true = dark module), without quiet zone.
 */

// Level M: [ecCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw]
const EC_M: readonly (readonly number[])[] = [
  [],
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
];
const ALIGN: readonly (readonly number[])[] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];
const MAX_VERSION = 15;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}
const gmul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number);

function rsRemainder(data: readonly number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] = (next[j] as number) ^ gmul(c, EXP[i] as number);
      next[j + 1] = (next[j + 1] as number) ^ c;
    });
    gen = next;
  }
  // gen is little-endian (x^0 first) and monic; drop the leading coefficient.
  const g = gen.slice(0, degree).reverse();
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (rem.shift() as number);
    rem.push(0);
    g.forEach((c, i) => {
      rem[i] = (rem[i] as number) ^ gmul(c, factor);
    });
  }
  return rem;
}

function dataCapacity(version: number): number {
  const [, b1 = 0, d1 = 0, b2 = 0, d2 = 0] = EC_M[version] as number[];
  return b1 * d1 + b2 * d2;
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  bytes.forEach((b) => push(b, 8));
  const capBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  for (let pad = 0xec; data.length < dataCapacity(version); pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecLen = 0, b1 = 0, d1 = 0, b2 = 0, d2 = 0] = EC_M[version] as number[];
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const chunk = data.slice(offset, offset + len);
    offset += len;
    blocks.push({ data: chunk, ec: rsRemainder(chunk, ecLen) });
  }
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i] as number);
  }
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i] as number);
  return out;
}

function bch(value: number, poly: number, valueBits: number, totalBits: number): number {
  let v = value << (totalBits - valueBits);
  const polyLen = poly.toString(2).length;
  for (let i = totalBits - 1; i >= polyLen - 1; i--) {
    if ((v >>> i) & 1) v ^= poly << (i - polyLen + 1);
  }
  return (value << (totalBits - valueBits)) | v;
}

export function formatBits(mask: number): number {
  // Level M = 00; XOR with the spec mask 101010000010010.
  return bch(mask, 0x537, 5, 15) ^ 0x5412;
}

const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const runScore = (line: boolean[]) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    // Finder-like pattern 1011101 with 4 light modules on either side.
    const str = line.map((b) => (b ? 1 : 0)).join("");
    for (const p of ["10111010000", "00001011101"]) {
      for (let i = str.indexOf(p); i !== -1; i = str.indexOf(p, i + 1)) s += 40;
    }
    return s;
  };
  for (let i = 0; i < n; i++) {
    score += runScore(m[i] as boolean[]);
    score += runScore(m.map((row) => row[i] as boolean));
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = (m[r] as boolean[])[c];
      if (v === (m[r] as boolean[])[c + 1] && v === (m[r + 1] as boolean[])[c] && v === (m[r + 1] as boolean[])[c + 1]) {
        score += 3;
      }
    }
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  const overhead = (v: number) => 4 + (v >= 10 ? 16 : 8);
  while (version <= MAX_VERSION && dataCapacity(version) * 8 < bytes.length * 8 + overhead(version)) {
    version++;
  }
  if (version > MAX_VERSION) throw new RangeError("QR payload too long");

  const n = 17 + version * 4;
  const modules: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    (modules[r] as boolean[])[c] = dark;
    (reserved[r] as boolean[])[c] = true;
  };

  // Finder patterns with separators.
  for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(fr + dr, fc + dc, dark);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns.
  const pos = ALIGN[version] as number[];
  const last = pos.length - 1;
  for (const [ai, ar] of pos.entries()) {
    for (const [aj, ac] of pos.entries()) {
      // Skip the three corners that coincide with finder patterns.
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === last) || (ai === last && aj === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
  // Reserve format areas (written later) and the dark module.
  for (let i = 0; i < 9; i++) {
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, n - 1 - i, false);
    set(n - 1 - i, 8, false);
  }
  set(n - 8, 8, true);
  // Version information.
  if (version >= 7) {
    const info = bch(version, 0x1f25, 6, 18);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + n - 11;
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Place data bits in the zig-zag order.
  const codewords = buildCodewords(bytes, version);
  const dataBits: boolean[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) dataBits.push(((cw >>> i) & 1) === 1);
  let bi = 0;
  const free: [number, number][] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? n - 1 - vert : vert;
        if (!reserved[r]?.[c]) free.push([r, c]);
      }
    }
  }
  for (const [r, c] of free) (modules[r] as boolean[])[c] = dataBits[bi++] ?? false;

  const applyMask = (mask: number): boolean[][] => {
    const out = modules.map((row) => row.slice());
    const fn = MASKS[mask] as (r: number, c: number) => boolean;
    for (const [r, c] of free) (out[r] as boolean[])[c] = (out[r] as boolean[])[c] !== fn(r, c);
    const fmt = formatBits(mask);
    const bit = (i: number) => ((fmt >>> i) & 1) === 1;
    const put = (r: number, c: number, v: boolean) => {
      (out[r] as boolean[])[c] = v;
    };
    for (let i = 0; i <= 5; i++) put(i, 8, bit(i));
    put(7, 8, bit(6));
    put(8, 8, bit(7));
    put(8, 7, bit(8));
    for (let i = 9; i < 15; i++) put(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) put(8, n - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) put(n - 15 + i, 8, bit(i));
    put(n - 8, 8, true);
    return out;
  };

  let best = applyMask(0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask++) {
    const candidate = applyMask(mask);
    const s = penalty(candidate);
    if (s < bestScore) {
      best = candidate;
      bestScore = s;
    }
  }
  return best;
}
