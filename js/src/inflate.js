// DEFLATE decompression (RFC 1951), with the zlib wrapper (RFC 1950) handled too. Quick Look's
// JavaScript engine has no zlib, so this small one is used there; Node's tests check it against
// Node's own. `limit` caps the output, so a tiny file can't unpack to gigabytes.

export class InflateError extends Error {
  name = "InflateError";
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman table from code lengths: counts per length and symbols in code order. */
function table(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((l, s) => {
    if (l) symbols[offsets[l]++] = s;
  });
  return { counts, symbols };
}

const FIXED_LIT = table(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DIST = table(Array(30).fill(5));

export function inflateRaw(input, limit = Infinity) {
  let pos = 0;
  let bit = 0;
  let out = new Uint8Array(Math.min(Math.max(input.length * 4, 1024), limit === Infinity ? 1 << 30 : limit));
  let size = 0;
  const need = (n) => {
    if (size + n > limit) throw new InflateError("Compressed data unpacks to more than its stated size.");
    if (size + n <= out.length) return;
    let cap = out.length * 2;
    while (cap < size + n) cap *= 2;
    const grown = new Uint8Array(Math.min(cap, limit));
    grown.set(out.subarray(0, size));
    out = grown;
  };
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (pos >= input.length) throw new InflateError("Compressed data is cut short.");
      v |= ((input[pos] >> bit) & 1) << i;
      if (++bit === 8) {
        bit = 0;
        pos++;
      }
    }
    return v;
  };
  const decode = ({ counts, symbols }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = counts[len];
      if (code - first < count) return symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError("Compressed data is damaged.");
  };
  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      if (bit) {
        bit = 0;
        pos++;
      }
      if (pos + 4 > input.length) throw new InflateError("Compressed data is cut short.");
      const len = input[pos] | (input[pos + 1] << 8);
      const nlen = input[pos + 2] | (input[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new InflateError("Compressed data is damaged.");
      pos += 4;
      if (pos + len > input.length) throw new InflateError("Compressed data is cut short.");
      need(len);
      out.set(input.subarray(pos, pos + len), size);
      size += len;
      pos += len;
      continue;
    }
    if (type === 3) throw new InflateError("Compressed data is damaged.");
    let lit = FIXED_LIT;
    let dist = FIXED_DIST;
    if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const codeLengths = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) codeLengths[CODE_ORDER[i]] = bits(3);
      const codes = table(codeLengths);
      const lengths = [];
      while (lengths.length < hlit + hdist) {
        const sym = decode(codes);
        if (sym < 16) lengths.push(sym);
        else if (sym === 16) {
          if (!lengths.length) throw new InflateError("Compressed data is damaged.");
          const prev = lengths[lengths.length - 1];
          for (let n = 3 + bits(2); n > 0; n--) lengths.push(prev);
        } else for (let n = sym === 17 ? 3 + bits(3) : 11 + bits(7); n > 0; n--) lengths.push(0);
      }
      if (lengths.length > hlit + hdist) throw new InflateError("Compressed data is damaged.");
      lit = table(lengths.slice(0, hlit));
      dist = table(lengths.slice(hlit));
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        need(1);
        out[size++] = sym;
      } else if (sym === 256) break;
      else {
        const li = sym - 257;
        if (li >= 29) throw new InflateError("Compressed data is damaged.");
        const length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new InflateError("Compressed data is damaged.");
        const distance = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (distance > size) throw new InflateError("Compressed data is damaged.");
        need(length);
        for (let i = 0; i < length; i++, size++) out[size] = out[size - distance];
      }
    }
  }
  return out.subarray(0, size);
}

/** zlib-wrapped data: a two-byte header, the DEFLATE stream, then a checksum that's skipped. */
export function inflateZlib(input, limit) {
  if (input.length < 2 || (input[0] & 0x0f) !== 8 || ((input[0] << 8) | input[1]) % 31 !== 0) throw new InflateError("Compressed data is damaged.");
  if (input[1] & 0x20) throw new InflateError("Compressed data uses a preset dictionary, which isn't supported.");
  return inflateRaw(input.subarray(2), limit);
}
