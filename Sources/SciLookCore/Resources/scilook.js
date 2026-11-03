// SciLook's preview code, bundled from js/ by js/build.mjs. Don't edit; rebuild.
(() => {
  // src/shims.js
  var LiteDecoder = class {
    constructor(label = "utf-8") {
      this.encoding = String(label).toLowerCase().replace(/^utf8$/, "utf-8").replace(/^(iso-8859-1|ascii|binary)$/, "latin1");
    }
    decode(bytes = new Uint8Array(0)) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
      let s = "";
      if (this.encoding === "latin1") {
        for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
        return s;
      }
      if (this.encoding === "utf-16le") {
        for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | b[i + 1] << 8);
        return s;
      }
      for (let i = 0; i < b.length; ) {
        const c = b[i];
        let cp;
        let n;
        if (c < 128) cp = c, n = 1;
        else if (c >= 192 && c < 224) cp = c & 31, n = 2;
        else if (c >= 224 && c < 240) cp = c & 15, n = 3;
        else if (c >= 240 && c < 248) cp = c & 7, n = 4;
        else {
          s += "\uFFFD";
          i++;
          continue;
        }
        let ok = i + n <= b.length;
        for (let k = 1; ok && k < n; k++) {
          if ((b[i + k] & 192) !== 128) ok = false;
          else cp = cp << 6 | b[i + k] & 63;
        }
        if (!ok) {
          s += "\uFFFD";
          i++;
          continue;
        }
        s += String.fromCodePoint(cp);
        i += n;
      }
      return s;
    }
  };
  var LiteBuffer = class _LiteBuffer extends Uint8Array {
    static alloc(n) {
      return new _LiteBuffer(n);
    }
    static from(x) {
      if (typeof x === "string") return new _LiteBuffer(Array.from(x, (c) => c.charCodeAt(0) & 255));
      if (ArrayBuffer.isView(x)) return new _LiteBuffer(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      return new _LiteBuffer(x);
    }
    static concat(list) {
      const out = new _LiteBuffer(list.reduce((n, b) => n + b.length, 0));
      let at = 0;
      for (const b of list) {
        out.set(b, at);
        at += b.length;
      }
      return out;
    }
    get view() {
      return new DataView(this.buffer, this.byteOffset, this.byteLength);
    }
    toString(encoding = "utf8", start = 0, end = this.length) {
      return new LiteDecoder(encoding).decode(this.subarray(start, end));
    }
    equals(other) {
      return this.length === other.length && this.every((v, i) => v === other[i]);
    }
    copy(target, targetStart = 0, start = 0, end = this.length) {
      const piece = this.subarray(start, Math.min(end, start + target.length - targetStart));
      target.set(piece, targetStart);
      return piece.length;
    }
    readUInt8(at) {
      return this.view.getUint8(at);
    }
    readInt8(at) {
      return this.view.getInt8(at);
    }
  };
  var methods = {
    UInt16: "getUint16",
    Int16: "getInt16",
    UInt32: "getUint32",
    Int32: "getInt32",
    Float: "getFloat32",
    Double: "getFloat64",
    BigUInt64: "getBigUint64",
    BigInt64: "getBigInt64"
  };
  for (const [name, getter] of Object.entries(methods)) {
    LiteBuffer.prototype[`read${name}LE`] = function(at) {
      return this.view[getter](at, true);
    };
    LiteBuffer.prototype[`read${name}BE`] = function(at) {
      return this.view[getter](at, false);
    };
  }
  function installShims(target = globalThis) {
    if (!target.TextDecoder) target.TextDecoder = LiteDecoder;
    if (!target.Buffer) target.Buffer = LiteBuffer;
  }

  // src/install.js
  installShims();

  // src/inflate.js
  var InflateError = class extends Error {
    name = "InflateError";
  };
  var LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
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
  var FIXED_LIT = table(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
  var FIXED_DIST = table(Array(30).fill(5));
  function inflateRaw(input, limit = Infinity) {
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
        v |= (input[pos] >> bit & 1) << i;
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
        first = first + count << 1;
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
        const len = input[pos] | input[pos + 1] << 8;
        const nlen = input[pos + 2] | input[pos + 3] << 8;
        if ((len ^ 65535) !== nlen) throw new InflateError("Compressed data is damaged.");
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
      for (; ; ) {
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
  function inflateZlib(input, limit) {
    if (input.length < 2 || (input[0] & 15) !== 8 || (input[0] << 8 | input[1]) % 31 !== 0) throw new InflateError("Compressed data is damaged.");
    if (input[1] & 32) throw new InflateError("Compressed data uses a preset dictionary, which isn't supported.");
    return inflateRaw(input.subarray(2), limit);
  }

  // src/zlib-shim.js
  function inflateSync(bytes, { maxOutputLength = Infinity } = {}) {
    return Buffer.from(inflateZlib(bytes, maxOutputLength));
  }

  // vendor/hdf5/hdf5.js
  var Hdf5Error = class extends Error {
  };
  var SIGNATURE = Buffer.from([137, 72, 68, 70, 13, 10, 26, 10]);
  var UNDEFINED = -1;
  var MAX_READ_BYTES = 128 * 1024 * 1024;
  var MAX_VALUES = 1e7;
  var MAX_STRUCTURE = 16 * 1024 * 1024;
  var WORK_LIMIT = 2e5;
  var FILTER_NAMES = { 1: "gzip", 2: "shuffle", 3: "fletcher32", 4: "szip", 5: "nbit", 6: "scaleoffset", 32e3: "lzf", 32001: "blosc", 32004: "lz4", 32008: "bitshuffle", 32015: "zstd" };
  var Cursor = class {
    constructor(buffer, file, at = 0) {
      this.b = buffer;
      this.at = at;
      this.o = file?.offsetSize ?? 8;
      this.l = file?.lengthSize ?? 8;
    }
    need(n) {
      if (this.at + n > this.b.length) throw new Hdf5Error("A structure in the file is cut short; the file may be damaged.");
    }
    u8() {
      this.need(1);
      return this.b[this.at++];
    }
    u16() {
      this.need(2);
      const v = this.b.readUInt16LE(this.at);
      this.at += 2;
      return v;
    }
    u32() {
      this.need(4);
      const v = this.b.readUInt32LE(this.at);
      this.at += 4;
      return v;
    }
    uint(size) {
      this.need(size);
      let v = 0n;
      for (let i = size - 1; i >= 0; i--) v = v << 8n | BigInt(this.b[this.at + i]);
      this.at += size;
      return v;
    }
    /** An unsigned number of `size` bytes, as a Number; all ones (an unset address) comes back as -1. */
    num(size) {
      const v = this.uint(size);
      if (v === (1n << BigInt(size * 8)) - 1n) return UNDEFINED;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Hdf5Error("A number in the file is too large to be an address or length.");
      return Number(v);
    }
    addr() {
      return this.num(this.o);
    }
    len() {
      return this.num(this.l);
    }
    bytes(n) {
      this.need(n);
      const v = this.b.subarray(this.at, this.at + n);
      this.at += n;
      return v;
    }
    skip(n) {
      this.need(n);
      this.at += n;
    }
    signature(text2) {
      const got = this.bytes(4).toString("latin1");
      if (got !== text2) throw new Hdf5Error(`Expected a ${text2} block but found something else; the file may be damaged.`);
    }
    cstring() {
      const end = this.b.indexOf(0, this.at);
      if (end < 0) throw new Hdf5Error("A name in the file has no end.");
      const s = this.b.toString("utf8", this.at, end);
      this.at = end + 1;
      return s;
    }
    align(n, from = 0) {
      const rem = (this.at - from) % n;
      if (rem) this.at += n - rem;
    }
  };
  function encodedSize(max) {
    return max <= 0 ? 1 : Math.floor(Math.log2(max) / 8) + 1;
  }
  var product = (a) => a.reduce((x, y) => x * y, 1);
  function parseDatatype(c) {
    const start = c.at;
    const classAndVersion = c.u8();
    const cls = classAndVersion & 15;
    const version = classAndVersion >> 4;
    const bits = c.u8() | c.u8() << 8 | c.u8() << 16;
    const size = c.u32();
    const t = { class: cls, size };
    switch (cls) {
      case 0:
        t.kind = "int";
        t.bigEndian = Boolean(bits & 1);
        t.signed = Boolean(bits & 8);
        c.skip(4);
        break;
      case 1:
        t.kind = "float";
        t.bigEndian = Boolean(bits & 1);
        c.skip(12);
        break;
      case 2:
        t.kind = "opaque";
        c.skip(2);
        break;
      case 3:
        t.kind = "string";
        t.padding = bits & 15;
        t.charset = bits >> 4 & 15;
        break;
      case 4:
        t.kind = "int";
        t.bigEndian = Boolean(bits & 1);
        t.signed = false;
        c.skip(4);
        break;
      case 5:
        t.kind = "opaque";
        c.skip(Math.ceil((bits & 255) / 8) * 8);
        break;
      case 6: {
        t.kind = "compound";
        t.members = [];
        const count = bits & 65535;
        for (let i = 0; i < count; i++) {
          const nameStart = c.at;
          const name = c.cstring();
          let offset;
          if (version < 3) {
            c.align(8, nameStart);
            offset = c.u32();
            if (version === 1) c.skip(1 + 3 + 4 + 4 + 16);
          } else {
            offset = Number(c.uint(encodedSize(size)));
          }
          t.members.push({ name, offset, type: parseDatatype(c) });
        }
        break;
      }
      case 7:
        t.kind = "reference";
        t.refType = bits & 15;
        break;
      case 8: {
        t.kind = "enum";
        t.base = parseDatatype(c);
        const count = bits & 65535;
        t.names = [];
        for (let i = 0; i < count; i++) {
          const nameStart = c.at;
          t.names.push(c.cstring());
          if (version < 3) c.align(8, nameStart);
        }
        t.values = [];
        for (let i = 0; i < count; i++) t.values.push(decodeNumber(c.bytes(t.base.size), 0, t.base));
        break;
      }
      case 9:
        t.kind = (bits & 15) === 1 ? "vlen-string" : "vlen";
        t.charset = bits >> 8 & 15;
        t.base = parseDatatype(c);
        break;
      case 10: {
        t.kind = "array";
        const rank = c.u8();
        if (version < 3) c.skip(3);
        t.dims = [];
        for (let i = 0; i < rank; i++) t.dims.push(c.u32());
        if (version < 3) c.skip(4 * rank);
        t.base = parseDatatype(c);
        break;
      }
      default:
        throw new Hdf5Error(`Unknown datatype class ${cls}.`);
    }
    if (size === 0) throw new Hdf5Error("A datatype in the file has no size; the file may be damaged.");
    t.encodedLength = c.at - start;
    return t;
  }
  function describeType(t) {
    switch (t.kind) {
      case "int":
        return `${t.signed ? "int" : "uint"}${t.size * 8}${t.bigEndian ? " (big-endian)" : ""}`;
      case "float":
        return `float${t.size * 8}${t.bigEndian ? " (big-endian)" : ""}`;
      case "string":
        return `str (fixed, ${t.size} bytes)`;
      case "vlen-string":
        return "str";
      case "vlen":
        return `vlen<${describeType(t.base)}>`;
      case "reference":
        return t.refType === 0 ? "object reference" : "region reference";
      case "enum":
        return isBoolEnum(t) ? "bool" : `enum<${describeType(t.base)}>{${t.names.join(",")}}`;
      case "compound":
        return `compound{${t.members.map((m) => `${m.name}: ${describeType(m.type)}`).join(", ")}}`;
      case "array":
        return `${describeType(t.base)}[${t.dims.join(",")}]`;
      default:
        return `opaque (${t.size} bytes)`;
    }
  }
  var isBoolEnum = (t) => t.names.length === 2 && t.names.map((n) => n.toUpperCase()).join() === "FALSE,TRUE";
  function parseDataspace(c) {
    const version = c.u8();
    const rank = c.u8();
    const flags = c.u8();
    let kind = rank === 0 ? "scalar" : "simple";
    if (version === 1) c.skip(5);
    else {
      const type = c.u8();
      kind = ["scalar", "simple", "null"][type] ?? "simple";
    }
    const dims = [];
    for (let i = 0; i < rank; i++) dims.push(c.len());
    let maxdims = null;
    if (flags & 1) {
      maxdims = [];
      for (let i = 0; i < rank; i++) maxdims.push(c.len());
    }
    return { kind, dims, maxdims: maxdims ?? dims.slice() };
  }
  function decodeNumber(buf, at, t) {
    const n = t.size;
    if (t.kind === "float") {
      if (n === 4) return t.bigEndian ? buf.readFloatBE(at) : buf.readFloatLE(at);
      if (n === 8) return t.bigEndian ? buf.readDoubleBE(at) : buf.readDoubleLE(at);
      if (n === 2) return halfToNumber(t.bigEndian ? buf.readUInt16BE(at) : buf.readUInt16LE(at));
      throw new Hdf5Error(`Floats of ${n} bytes aren't supported.`);
    }
    if (n === 1) return t.signed ? buf.readInt8(at) : buf.readUInt8(at);
    if (n === 2) return t.signed ? t.bigEndian ? buf.readInt16BE(at) : buf.readInt16LE(at) : t.bigEndian ? buf.readUInt16BE(at) : buf.readUInt16LE(at);
    if (n === 4) return t.signed ? t.bigEndian ? buf.readInt32BE(at) : buf.readInt32LE(at) : t.bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at);
    if (n === 8) {
      const v = t.signed ? t.bigEndian ? buf.readBigInt64BE(at) : buf.readBigInt64LE(at) : t.bigEndian ? buf.readBigUInt64BE(at) : buf.readBigUInt64LE(at);
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    }
    throw new Hdf5Error(`Integers of ${n} bytes aren't supported.`);
  }
  function halfToNumber(h) {
    const sign = h & 32768 ? -1 : 1;
    const exp = h >> 10 & 31;
    const frac = h & 1023;
    if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * 2 ** (exp - 15) * (1 + frac / 1024);
  }
  function decodeFixedString(bytes, t) {
    let end = bytes.length;
    if (t.padding !== 2) {
      const zero = bytes.indexOf(0);
      if (zero >= 0) end = zero;
    } else {
      while (end > 0 && bytes[end - 1] === 32) end--;
    }
    return bytes.toString(t.charset === 1 ? "utf8" : "latin1", 0, end);
  }
  var Hdf5File = class _Hdf5File {
    /** Opens a file from a FileSource or HttpSource, checking that it really is HDF5. */
    static async open(source) {
      const file = new _Hdf5File(source);
      await file.init();
      return file;
    }
    constructor(source) {
      this.source = source;
      this.headers = /* @__PURE__ */ new Map();
      this.childCache = /* @__PURE__ */ new Map();
      this.heaps = /* @__PURE__ */ new Map();
      this.paths = /* @__PURE__ */ new Map();
    }
    async init() {
      const size = await this.source.size();
      let at = 0;
      let head;
      for (; ; ) {
        if (at + 8 > size) throw new Hdf5Error("This isn't an HDF5 file (no HDF5 signature found).");
        head = await this.source.read(at, Math.min(256, size - at));
        if (head.subarray(0, 8).equals(SIGNATURE)) break;
        at = at === 0 ? 512 : at * 2;
        if (at > 64 * 1024 * 1024) throw new Hdf5Error("This isn't an HDF5 file (no HDF5 signature found).");
      }
      const c = new Cursor(head, null, 8);
      this.superblockVersion = c.u8();
      if (this.superblockVersion <= 1) {
        c.skip(4);
        this.offsetSize = c.u8();
        this.lengthSize = c.u8();
        c.skip(1 + 4 + 4);
        if (this.superblockVersion === 1) c.skip(4);
        c.o = this.offsetSize;
        c.l = this.lengthSize;
        this.base = c.addr();
        c.skip(this.offsetSize * 3);
        c.addr();
        this.rootAddress = c.addr();
      } else if (this.superblockVersion <= 3) {
        this.offsetSize = c.u8();
        this.lengthSize = c.u8();
        c.skip(1);
        c.o = this.offsetSize;
        c.l = this.lengthSize;
        this.base = c.addr();
        c.addr();
        c.addr();
        this.rootAddress = c.addr();
      } else {
        throw new Hdf5Error(`This file uses superblock version ${this.superblockVersion}, which brainhound doesn't know yet.`);
      }
      if (this.base === UNDEFINED || this.base === 0 && at > 0) this.base = at;
      this.paths.set(this.rootAddress, "/");
    }
    read(address, length) {
      if (address === UNDEFINED) throw new Hdf5Error("Tried to read from an unset address.");
      if (length > MAX_READ_BYTES) throw new Hdf5Error("A piece of the file is larger than brainhound will read at once; the file may be damaged.");
      return this.source.read(this.base + address, length);
    }
    /** Reads part of the file's own structure, which is never big in a sound file. */
    structure(address, length) {
      if (length > MAX_STRUCTURE) throw new Hdf5Error("A structure in the file claims to be huge; the file may be damaged.");
      this.spend(1);
      return this.read(address, length);
    }
    /** Counts work done in one call; callers reset `work` before each question. */
    spend(n) {
      this.work = (this.work ?? 0) + n;
      if (this.work > WORK_LIMIT) throw new Hdf5Error("Reading this would take too much work; the file may be damaged, or the request too broad.");
    }
    cursor(buffer, at = 0) {
      return new Cursor(buffer, this, at);
    }
    // ----- object headers
    header(address) {
      if (!this.headers.has(address)) {
        const promise = this.parseHeader(address);
        this.headers.set(address, promise);
        promise.catch(() => this.headers.delete(address));
      }
      return this.headers.get(address);
    }
    async parseHeader(address) {
      const messages = [];
      const first = await this.read(address, 16);
      if (first.subarray(0, 4).toString("latin1") === "OHDR") {
        const c = this.cursor(first, 4);
        const version = c.u8();
        if (version !== 2) throw new Hdf5Error(`Unknown object header version ${version}.`);
        const flags = c.u8();
        let prefix = 6 + (flags & 32 ? 16 : 0) + (flags & 16 ? 4 : 0);
        const sizeBytes = 1 << (flags & 3);
        const pre = await this.structure(address, prefix + sizeBytes);
        const chunkSize = Number(this.cursor(pre, prefix).uint(sizeBytes));
        prefix += sizeBytes;
        const block = await this.structure(address + prefix, chunkSize);
        const queue = [];
        this.parseV2Messages(block, 0, chunkSize, flags, messages, queue);
        while (queue.length) {
          const { at, length } = queue.shift();
          const more = await this.structure(at, length);
          if (more.subarray(0, 4).toString("latin1") !== "OCHK") throw new Hdf5Error("An object header continuation is damaged.");
          this.parseV2Messages(more, 4, length - 4, flags, messages, queue);
        }
      } else {
        const c = this.cursor(first);
        const version = c.u8();
        if (version !== 1) throw new Hdf5Error(`Unknown object header version ${version} at ${address}; the file may be damaged.`);
        c.skip(1);
        const count = c.u16();
        c.skip(4);
        const size = c.u32();
        const queue = [{ at: address + 16, length: size }];
        let seen = 0;
        while (queue.length && seen < count) {
          const { at, length } = queue.shift();
          const block = await this.structure(at, length);
          const m = this.cursor(block);
          while (m.at + 8 <= block.length && seen < count) {
            seen++;
            const type = m.u16();
            const msgSize = m.u16();
            const msgFlags = m.u8();
            m.skip(3);
            const data = m.bytes(Math.min(msgSize, block.length - m.at));
            this.collectMessage(type, msgFlags, data, messages, queue);
          }
        }
      }
      return messages;
    }
    /** Messages from `from` up to `end`; continuation blocks end with a checksum, which callers leave out. */
    parseV2Messages(block, from, end, headerFlags, messages, queue) {
      const c = this.cursor(block, from);
      const headerLength = 4 + (headerFlags & 4 ? 2 : 0);
      while (c.at + headerLength <= end) {
        const type = c.u8();
        const size = c.u16();
        const flags = c.u8();
        if (headerFlags & 4) c.skip(2);
        if (c.at + size > end) break;
        this.collectMessage(type, flags, c.bytes(size), messages, queue);
      }
    }
    collectMessage(type, flags, data, messages, queue) {
      if (type === 16) {
        const c = this.cursor(data);
        const block = { at: c.addr(), length: c.len() };
        queue.blocks = (queue.blocks ?? 0) + 1;
        if (queue.blocks > 4096 || block.length > 64 * 1024 * 1024) throw new Hdf5Error("An object header is damaged.");
        queue.push(block);
        return;
      }
      if (type !== 0) messages.push({ type, flags, data });
    }
    /** What kind of object lives at an address: "dataset" or "group". */
    async kindOf(address) {
      const messages = await this.header(address);
      return messages.some((m) => m.type === 8) ? "dataset" : "group";
    }
    // ----- groups
    /** The links in a group: [{ name, address }] for hard links, [{ name, soft }] or [{ name, external }] for others. */
    async links(address) {
      if (this.childCache.has(address)) return this.childCache.get(address);
      const messages = await this.header(address);
      const links = [];
      for (const m of messages) {
        if (m.type === 17) {
          const c = this.cursor(m.data);
          const btree = c.addr();
          const heap = c.addr();
          links.push(...await this.symbolTableLinks(btree, heap));
        } else if (m.type === 6) {
          links.push(this.parseLink(m.data));
        } else if (m.type === 2) {
          const c = this.cursor(m.data);
          c.skip(1);
          const flags = c.u8();
          if (flags & 1) c.skip(8);
          const heapAddress = c.addr();
          const nameIndex = c.addr();
          if (heapAddress !== UNDEFINED && nameIndex !== UNDEFINED) {
            const heap = await this.fractalHeap(heapAddress);
            for (const record of await this.btree2Records(nameIndex)) {
              const id = record.subarray(4, 4 + heap.idLength);
              links.push(this.parseLink(await this.heapObject(heap, id)));
            }
          }
        }
      }
      links.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      this.childCache.set(address, links);
      return links;
    }
    parseLink(data) {
      const c = this.cursor(data);
      c.skip(1);
      const flags = c.u8();
      const type = flags & 8 ? c.u8() : 0;
      if (flags & 4) c.skip(8);
      if (flags & 16) c.skip(1);
      const nameLength = Number(c.uint(1 << (flags & 3)));
      const name = c.bytes(nameLength).toString("utf8");
      if (type === 0) return { name, address: c.addr() };
      if (type === 1) {
        const length = c.u16();
        return { name, soft: c.bytes(length).toString("utf8") };
      }
      if (type === 64) {
        const length = c.u16();
        const info = c.bytes(length);
        const parts = info.subarray(1).toString("utf8").split("\0");
        return { name, external: { file: parts[0], path: parts[1] } };
      }
      return { name, external: { type } };
    }
    async symbolTableLinks(btreeAddress, heapAddress) {
      const heapHead = await this.read(heapAddress, 8 + 2 * this.lengthSize + this.offsetSize);
      const h = this.cursor(heapHead);
      h.signature("HEAP");
      h.skip(4);
      const dataSize = h.len();
      h.len();
      const dataAddress = h.addr();
      const names = await this.structure(dataAddress, dataSize);
      const links = [];
      const seen = /* @__PURE__ */ new Set();
      const visit = async (node, expected = -1) => {
        if (seen.has(node)) throw new Hdf5Error("A group's index points back at itself; the file may be damaged.");
        seen.add(node);
        const prefix = 8 + 2 * this.offsetSize;
        const head = await this.structure(node, prefix);
        const c = this.cursor(head);
        c.signature("TREE");
        const type = c.u8();
        const level = c.u8();
        const used = c.u16();
        if (type !== 0 || expected >= 0 && level !== expected) throw new Hdf5Error("A group's index is damaged.");
        const body = await this.structure(node + prefix, (2 * used + 1) * this.lengthSize + used * this.offsetSize);
        const b = this.cursor(body);
        const children = [];
        b.len();
        for (let i = 0; i < used; i++) {
          children.push(b.addr());
          b.len();
        }
        for (const child of children) {
          if (level > 0) await visit(child, level - 1);
          else await this.readSymbolNode(child, names, links);
        }
      };
      await visit(btreeAddress);
      return links;
    }
    async readSymbolNode(address, names, links) {
      const head = await this.structure(address, 8);
      const c = this.cursor(head);
      c.signature("SNOD");
      c.skip(2);
      const count = c.u16();
      const entrySize = 2 * this.offsetSize + 8 + 16;
      const body = await this.structure(address + 8, count * entrySize);
      const b = this.cursor(body);
      for (let i = 0; i < count; i++) {
        const nameOffset = b.addr();
        const objectAddress = b.addr();
        const cacheType = b.u32();
        b.skip(4);
        const scratch = b.bytes(16);
        const end = names.indexOf(0, nameOffset);
        const name = names.toString("utf8", nameOffset, end < 0 ? names.length : end);
        if (cacheType === 2) {
          const at = scratch.readUInt32LE(0);
          const stop = names.indexOf(0, at);
          links.push({ name, soft: names.toString("utf8", at, stop) });
        } else {
          links.push({ name, address: objectAddress });
        }
      }
    }
    /** Finds the object at a path such as /acquisition/ElectricalSeries/data. */
    async resolve(path, depth = 0) {
      if (depth > 16) throw new Hdf5Error("Too many soft links in a row.");
      const parts = String(path).split("/").filter(Boolean);
      let address = this.rootAddress;
      let current = "";
      for (const part of parts) {
        if (await this.kindOf(address) !== "group") throw new Hdf5Error(`${current || "/"} is a dataset, not a group.`);
        const link = (await this.links(address)).find((l) => l.name === part);
        if (!link) throw new Hdf5Error(`Nothing is called "${part}" in ${current || "/"}.`);
        if (link.soft) {
          const target = link.soft.startsWith("/") ? link.soft : `${current}/${link.soft}`;
          address = (await this.resolve(target, depth + 1)).address;
        } else if (link.external) {
          throw new Hdf5Error(`${current}/${part} points into another file (${link.external.file ?? "unknown"}), which brainhound doesn't follow.`);
        } else {
          address = link.address;
        }
        current = `${current}/${part}`;
        if (!this.paths.has(address)) this.paths.set(address, current);
      }
      return { address, path: current || "/", kind: await this.kindOf(address) };
    }
    /** Finds the path of an object by its address (for object references), searching at most `budget` objects. */
    async pathOf(address, budget = 2e3) {
      if (this.paths.has(address)) return this.paths.get(address);
      const queue = [{ address: this.rootAddress, path: "" }];
      const seen = /* @__PURE__ */ new Set();
      while (queue.length && budget-- > 0) {
        const { address: at, path } = queue.shift();
        if (seen.has(at)) continue;
        seen.add(at);
        if (await this.kindOf(at) !== "group") continue;
        for (const link of await this.links(at)) {
          if (link.address === void 0) continue;
          const childPath = `${path}/${link.name}`;
          if (!this.paths.has(link.address)) this.paths.set(link.address, childPath);
          if (link.address === address) return childPath;
          queue.push({ address: link.address, path: childPath });
        }
      }
      return null;
    }
    // ----- attributes
    /** Every attribute on an object, decoded: { name: value }. */
    async attributes(address) {
      const messages = await this.header(address);
      const raw = [];
      for (const m of messages) {
        if (m.type === 12) raw.push(m.data);
        else if (m.type === 21) {
          const c = this.cursor(m.data);
          c.skip(1);
          const flags = c.u8();
          if (flags & 1) c.skip(2);
          const heapAddress = c.addr();
          const nameIndex = c.addr();
          if (heapAddress === UNDEFINED || nameIndex === UNDEFINED) continue;
          const heap = await this.fractalHeap(heapAddress);
          for (const record of await this.btree2Records(nameIndex)) {
            if (record[8] & 1) continue;
            raw.push(await this.heapObject(heap, record.subarray(0, 8)));
          }
        }
      }
      const out = {};
      const decoded = [];
      for (const data of raw) {
        try {
          decoded.push(await this.parseAttribute(data));
        } catch (e) {
          if (!(e instanceof Hdf5Error)) throw e;
        }
      }
      decoded.sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
      for (const { name, value } of decoded) out[name] = value;
      return out;
    }
    async parseAttribute(data) {
      const c = this.cursor(data);
      const version = c.u8();
      c.skip(1);
      const nameSize = c.u16();
      const typeSize = c.u16();
      const spaceSize = c.u16();
      if (version >= 3) c.skip(1);
      const pad = (n) => version === 1 ? Math.ceil(n / 8) * 8 : n;
      const nameBytes = c.bytes(pad(nameSize));
      const name = nameBytes.toString("utf8", 0, Math.max(0, nameSize - 1));
      const typeStart = c.at;
      const type = parseDatatype(this.cursor(data, typeStart));
      c.at = typeStart + pad(typeSize);
      const spaceStart = c.at;
      const space = parseDataspace(this.cursor(data, spaceStart));
      c.at = spaceStart + pad(spaceSize);
      if (space.kind === "null") return { name, value: null };
      const count = product(space.dims);
      const bytes = data.subarray(c.at, c.at + count * type.size);
      const values = await this.decode(bytes, type, count);
      return { name, value: space.kind === "scalar" ? values[0] : reshape(values, space.dims) };
    }
    // ----- decoding values
    /** Turns raw element bytes into JavaScript values: numbers, strings, objects for compounds. */
    async decode(bytes, t, count, depth = 0) {
      if (count * t.size > bytes.length) throw new Hdf5Error("A value in the file is cut short; the file may be damaged.");
      if (count > MAX_VALUES) throw new Hdf5Error("That's too many values for one read; ask for a smaller slice.");
      if (depth > 4) throw new Hdf5Error("Variable-length values nest too deeply; the file may be damaged.");
      const out = new Array(count);
      const vlens = [];
      const refs = [];
      const decodeOne = (at, type, slot, key) => {
        switch (type.kind) {
          case "int":
          case "float":
            return decodeNumber(bytes, at, type);
          case "string":
            return decodeFixedString(bytes.subarray(at, at + type.size), type);
          case "enum": {
            const v = decodeNumber(bytes, at, type.base);
            if (isBoolEnum(type)) return Boolean(v);
            const i = type.values.indexOf(v);
            return i >= 0 ? type.names[i] : v;
          }
          case "reference":
            if (type.refType !== 0) return "(region reference)";
            refs.push({ slot, key, address: Number(bytes.readBigUInt64LE(at)) });
            return null;
          case "vlen-string":
          case "vlen": {
            const c = this.cursor(bytes, at);
            const length = c.u32();
            const collection = c.addr();
            const index = c.u32();
            vlens.push({ slot, key, length, collection, index, type });
            return null;
          }
          case "compound": {
            const o = {};
            for (const m of type.members) o[m.name] = decodeOne(at + m.offset, m.type, o, m.name);
            return o;
          }
          case "array": {
            const n = product(type.dims);
            const arr = new Array(n);
            for (let i = 0; i < n; i++) arr[i] = decodeOne(at + i * type.base.size, type.base, arr, i);
            return arr;
          }
          default:
            return `(${type.size} opaque bytes)`;
        }
      };
      for (let i = 0; i < count; i++) out[i] = decodeOne(i * t.size, t, out, i);
      for (const v of vlens) {
        if (v.length === 0 || v.collection === UNDEFINED || v.collection === 0) {
          v.slot[v.key] = v.type.kind === "vlen-string" ? "" : [];
          continue;
        }
        this.spend(1);
        const object = await this.globalHeapObject(v.collection, v.index);
        if (v.type.kind === "vlen-string") v.slot[v.key] = object.toString(v.type.charset === 1 ? "utf8" : "latin1").replace(/\0+$/, "");
        else v.slot[v.key] = await this.decode(object, v.type.base, v.length, depth + 1);
      }
      for (const r of refs) r.slot[r.key] = { ref: await this.pathOf(r.address) ?? `object at ${r.address}` };
      return out;
    }
    async globalHeapObject(collection, index) {
      if (!this.heaps.has(collection)) {
        const promise = (async () => {
          const head = await this.read(collection, 8 + this.lengthSize);
          const c = this.cursor(head);
          c.signature("GCOL");
          c.skip(4);
          const size = c.len();
          const body = await this.structure(collection, size);
          const objects = /* @__PURE__ */ new Map();
          const b = this.cursor(body, 8 + this.lengthSize);
          while (b.at + 8 + this.lengthSize <= body.length) {
            const id = b.u16();
            b.skip(6);
            const objectSize = b.len();
            if (id === 0) break;
            objects.set(id, body.subarray(b.at, b.at + objectSize));
            b.skip(Math.ceil(objectSize / 8) * 8);
          }
          return objects;
        })();
        this.heaps.set(collection, promise);
        promise.catch(() => this.heaps.delete(collection));
      }
      const object = (await this.heaps.get(collection)).get(index);
      if (!object) throw new Hdf5Error("A variable-length value points at nothing; the file may be damaged.");
      return object;
    }
    // ----- fractal heaps and v2 B-trees (dense groups and attributes in newer files)
    async fractalHeap(address) {
      const key = `frhp:${address}`;
      if (this.heaps.has(key)) return this.heaps.get(key);
      const head = await this.read(address, 26 + 12 * this.lengthSize + 3 * this.offsetSize);
      const c = this.cursor(head);
      c.signature("FRHP");
      c.skip(1);
      const idLength = c.u16();
      const filterLength = c.u16();
      const flags = c.u8();
      const maxManaged = c.u32();
      c.len();
      c.addr();
      c.len();
      c.addr();
      c.skip(this.lengthSize * 8);
      const width = c.u16();
      const startBlock = c.len();
      const maxDirect = c.len();
      const maxHeapBits = c.u16();
      c.u16();
      const root = c.addr();
      const rows = c.u16();
      if (filterLength > 0) throw new Hdf5Error("This file compresses its group or attribute index, which brainhound doesn't read yet.");
      const heap = {
        idLength,
        checksummed: Boolean(flags & 2),
        width,
        startBlock,
        maxDirect,
        root,
        rows,
        offsetBytes: Math.ceil(maxHeapBits / 8),
        lengthBytes: Math.min(encodedSize(maxManaged), Math.ceil(Math.log2(maxDirect) / 8)),
        maxDirectRows: Math.log2(maxDirect) - Math.log2(startBlock) + 2
      };
      this.heaps.set(key, heap);
      return heap;
    }
    rowBlockSize(heap, row) {
      return row === 0 ? heap.startBlock : heap.startBlock * 2 ** (row - 1);
    }
    async heapObject(heap, id) {
      const type = id[0] >> 4 & 3;
      if (type === 2) return id.subarray(1, 1 + (id[0] & 15) + 1);
      if (type !== 0) throw new Hdf5Error("This file keeps a very large object in its index heap, which brainhound doesn't read yet.");
      const c = this.cursor(id, 1);
      const offset = Number(c.uint(heap.offsetBytes));
      const length = Number(c.uint(heap.lengthBytes));
      let blockAddress;
      let blockOffset;
      if (heap.rows === 0) {
        blockAddress = heap.root;
        blockOffset = 0;
      } else {
        ({ blockAddress, blockOffset } = await this.findDirectBlock(heap, heap.root, heap.rows, 0, offset));
      }
      return this.structure(blockAddress + (offset - blockOffset), length);
    }
    async findDirectBlock(heap, address, rows, base, offset, depth = 0) {
      if (depth > 32 || rows < 1 || rows > 64) throw new Hdf5Error("An index heap is damaged.");
      const directRows = Math.min(rows, heap.maxDirectRows);
      const indirectRows = rows - directRows;
      const prefix = 4 + 1 + this.offsetSize + heap.offsetBytes;
      const entries = directRows * heap.width + indirectRows * heap.width;
      const block = await this.structure(address, prefix + entries * this.offsetSize);
      const c = this.cursor(block, prefix);
      const addresses = [];
      for (let i = 0; i < entries; i++) addresses.push(c.addr());
      let start = base;
      for (let row = 0; row < rows; row++) {
        const size = this.rowBlockSize(heap, row);
        for (let col = 0; col < heap.width; col++) {
          if (offset >= start && offset < start + size) {
            const child = addresses[row * heap.width + col];
            if (row < heap.maxDirectRows) return { blockAddress: child, blockOffset: start };
            const childRows = Math.log2(size) - Math.log2(heap.startBlock * heap.width) + 1;
            return this.findDirectBlock(heap, child, childRows, start, offset, depth + 1);
          }
          start += size;
        }
      }
      throw new Hdf5Error("An index heap entry points past its heap; the file may be damaged.");
    }
    /** Every record in a version 2 B-tree, as raw bytes. */
    async btree2Records(address) {
      const head = await this.read(address, 16 + this.offsetSize + 2 + this.lengthSize + 4);
      const c = this.cursor(head);
      c.signature("BTHD");
      c.skip(1);
      c.u8();
      const nodeSize = c.u32();
      const recordSize = c.u16();
      const depth = c.u16();
      c.skip(2);
      const root = c.addr();
      const rootCount = c.u16();
      if (root === UNDEFINED) return [];
      const maxLeaf = Math.floor((nodeSize - 10) / recordSize);
      const maxNrecSize = encodedSize(maxLeaf);
      const cum = [{ max: maxLeaf, cumMax: maxLeaf, cumSize: 0 }];
      for (let d = 1; d <= depth; d++) {
        const pointer = this.offsetSize + maxNrecSize + (d > 1 ? cum[d - 1].cumSize : 0);
        const max = Math.floor((nodeSize - (10 + pointer)) / (recordSize + pointer));
        const cumMax = (max + 1) * cum[d - 1].cumMax + max;
        cum.push({ max, cumMax, cumSize: encodedSize(cumMax) });
      }
      const records = [];
      const seen = /* @__PURE__ */ new Set();
      const visit = async (node, count, level) => {
        if (seen.has(node)) throw new Hdf5Error("An index points back at itself; the file may be damaged.");
        seen.add(node);
        this.spend(count);
        const body = await this.structure(node, nodeSize);
        const n = this.cursor(body);
        n.signature(level === 0 ? "BTLF" : "BTIN");
        n.skip(2);
        for (let i = 0; i < count; i++) records.push(Buffer.from(n.bytes(recordSize)));
        if (level === 0) return;
        for (let i = 0; i <= count; i++) {
          const child = n.addr();
          const childCount = Number(n.uint(maxNrecSize));
          if (level > 1) n.skip(cum[level - 1].cumSize);
          await visit(child, childCount, level - 1);
        }
      };
      await visit(root, rootCount, depth);
      return records;
    }
    // ----- datasets
    /** Shape, type, layout and filters of a dataset, without reading any of its data. */
    async dataset(address) {
      const messages = await this.header(address);
      const info = { address, filters: [], fill: null };
      for (const m of messages) {
        const c = this.cursor(m.data);
        if (m.type === 1) info.space = parseDataspace(c);
        else if (m.type === 3) info.type = m.flags & 2 ? await this.sharedDatatype(m.data) : parseDatatype(c);
        else if (m.type === 8) info.layoutData = m.data;
        else if (m.type === 11) info.filters = this.parseFilters(c);
        else if (m.type === 5) info.fill = this.parseFill(c);
        else if (m.type === 4 && !info.fill) {
          const size = c.u32();
          if (size) info.fill = Buffer.from(c.bytes(size));
        }
      }
      if (!info.space || !info.type || !info.layoutData) throw new Hdf5Error("This object isn't a dataset.");
      info.layout = this.parseLayout(this.cursor(info.layoutData), info);
      return info;
    }
    async sharedDatatype(data) {
      const c = this.cursor(data);
      const version = c.u8();
      const type = c.u8();
      if (version === 1) c.skip(6);
      if (version >= 3 && type !== 2) throw new Hdf5Error("This file shares datatypes through a table brainhound doesn't read yet.");
      const address = c.addr();
      const messages = await this.header(address);
      const m = messages.find((x) => x.type === 3);
      if (!m) throw new Hdf5Error("A shared datatype is missing.");
      return parseDatatype(this.cursor(m.data));
    }
    parseFill(c) {
      const version = c.u8();
      if (version <= 2) {
        c.skip(2);
        const defined = c.u8();
        if (version === 1 || defined) {
          const size = c.u32();
          return size ? Buffer.from(c.bytes(size)) : null;
        }
        return null;
      }
      const flags = c.u8();
      if (flags & 32) {
        const size = c.u32();
        return size ? Buffer.from(c.bytes(size)) : null;
      }
      return null;
    }
    parseFilters(c) {
      const version = c.u8();
      const count = c.u8();
      if (version === 1) c.skip(6);
      const filters = [];
      for (let i = 0; i < count; i++) {
        const id = c.u16();
        const nameLength = version === 1 || id >= 256 ? c.u16() : 0;
        const flags = c.u16();
        const values = c.u16();
        let name = "";
        if (nameLength) {
          const bytes = c.bytes(version === 1 ? Math.ceil(nameLength / 8) * 8 : nameLength);
          name = bytes.toString("latin1", 0, Math.max(0, bytes.indexOf(0) >= 0 ? bytes.indexOf(0) : nameLength));
        }
        const params = [];
        for (let v = 0; v < values; v++) params.push(c.u32());
        if (version === 1 && values % 2) c.skip(4);
        filters.push({ id, name: FILTER_NAMES[id] ?? (name || `filter ${id}`), optional: Boolean(flags & 1), params });
      }
      return filters;
    }
    parseLayout(c, info) {
      const version = c.u8();
      if (version < 3) throw new Hdf5Error(`This dataset uses layout version ${version}, from HDF5 1.6 or older, which brainhound doesn't read yet.`);
      const cls = c.u8();
      if (cls === 0) {
        const size = c.u16();
        return { kind: "compact", data: Buffer.from(c.bytes(size)) };
      }
      if (cls === 1) return { kind: "contiguous", address: c.addr(), size: c.len() };
      if (cls !== 2) throw new Hdf5Error(`This dataset uses storage type ${cls}, which brainhound doesn't read.`);
      if (version === 3) {
        const rank2 = c.u8();
        const address = c.addr();
        const dims2 = [];
        for (let i = 0; i < rank2; i++) dims2.push(c.u32());
        return { kind: "chunked", index: "btree1", address, chunk: dims2.slice(0, -1) };
      }
      const flags = c.u8();
      const rank = c.u8();
      const dimBytes = c.u8();
      const dims = [];
      for (let i = 0; i < rank; i++) dims.push(Number(c.uint(dimBytes)));
      const indexType = c.u8();
      const layout = { kind: "chunked", chunk: dims.slice(0, -1), dontFilterPartial: Boolean(flags & 1) };
      if (indexType === 1) {
        layout.index = "single";
        if (flags & 2) {
          layout.filteredSize = c.len();
          layout.filterMask = c.u32();
        }
      } else if (indexType === 2) layout.index = "implicit";
      else if (indexType === 3) {
        layout.index = "fixed";
        c.skip(1);
      } else if (indexType === 4) {
        layout.index = "extensible";
        c.skip(5);
      } else if (indexType === 5) {
        layout.index = "btree2";
        c.skip(6);
      } else throw new Hdf5Error(`Unknown chunk index type ${indexType}.`);
      layout.address = c.addr();
      return layout;
    }
    /**
     * Reads a block of a dataset: `start` and `count` per dimension (whole dataset by default).
     * Returns { shape, values } with values flat in row-major order.
     */
    async readSlice(info, start, count) {
      const dims = info.space.kind === "scalar" ? [] : info.space.dims;
      if (info.space.kind === "null") return { shape: [], values: [] };
      start = start ?? dims.map(() => 0);
      count = count ?? dims.map((d, i) => d - start[i]);
      if (start.length !== dims.length || count.length !== dims.length) throw new Hdf5Error(`This dataset has ${dims.length} dimensions; give start and count for each.`);
      for (let i = 0; i < dims.length; i++) {
        if (!Number.isInteger(start[i]) || !Number.isInteger(count[i]) || start[i] < 0 || count[i] < 0 || start[i] + count[i] > dims[i]) {
          throw new Hdf5Error(`Dimension ${i} has ${dims[i]} entries; start ${start[i]} with count ${count[i]} doesn't fit.`);
        }
      }
      const n = product(count);
      const size = info.type.size;
      if (n > MAX_VALUES) throw new Hdf5Error(`That's ${n} values; ask for at most ${MAX_VALUES} at a time.`);
      if (n * size > MAX_READ_BYTES) throw new Hdf5Error(`That's ${Math.round(n * size / 1e6)} MB; ask for a smaller slice.`);
      const out = Buffer.alloc(n * size);
      if (info.fill && info.fill.length === size) for (let i = 0; i < n; i++) info.fill.copy(out, i * size);
      if (n > 0) {
        const layout = info.layout;
        if (layout.kind === "compact") copyBlock(layout.data, dims, out, start, count, dims.map(() => 0), dims, size);
        else if (layout.kind === "contiguous") await this.readContiguous(info, start, count, out);
        else await this.readChunked(info, start, count, out);
      }
      const values = await this.decode(out, info.type, n);
      return { shape: count, values };
    }
    async readContiguous(info, start, count, out) {
      const { address } = info.layout;
      if (address === UNDEFINED) return;
      const dims = info.space.dims;
      const size = info.type.size;
      if (dims.length === 0) {
        (await this.read(address, size)).copy(out, 0);
        return;
      }
      const runs = [];
      const strides = dims.map((_, i2) => product(dims.slice(i2 + 1)));
      const last = dims.length - 1;
      const runLength = count[last] * size;
      const outer = count.slice(0, last);
      const index = outer.map(() => 0);
      let outAt = 0;
      for (; ; ) {
        let element = start[last];
        for (let i2 = 0; i2 < last; i2++) element += (start[i2] + index[i2]) * strides[i2];
        runs.push({ from: element * size, outAt });
        outAt += runLength;
        let d = last - 1;
        while (d >= 0 && ++index[d] === outer[d]) index[d--] = 0;
        if (d < 0) break;
      }
      const gap = 256 * 1024;
      let i = 0;
      let total = 0;
      while (i < runs.length) {
        let j = i;
        while (j + 1 < runs.length && runs[j + 1].from - (runs[j].from + runLength) <= gap) j++;
        const from = runs[i].from;
        const to = runs[j].from + runLength;
        total += to - from;
        if (total > MAX_READ_BYTES) throw new Hdf5Error("That slice is spread across too much of the file; ask for fewer rows or a narrower range.");
        const bytes = await this.read(address + from, to - from);
        for (let k = i; k <= j; k++) bytes.copy(out, runs[k].outAt, runs[k].from - from, runs[k].from - from + runLength);
        i = j + 1;
      }
    }
    async readChunked(info, start, count, out) {
      const dims = info.space.dims;
      const chunk = info.layout.chunk;
      const size = info.type.size;
      const chunkBytes = product(chunk) * size;
      if (chunkBytes > MAX_READ_BYTES || chunk.some((d) => d <= 0)) throw new Hdf5Error("This dataset's chunks are larger than brainhound will read; the file may be damaged.");
      const chunks = await this.chunksFor(info, start, count);
      let total = 0;
      const work = chunks.map((c) => async () => {
        total += c.size;
        if (total > MAX_READ_BYTES) throw new Hdf5Error("That slice touches too much compressed data; ask for a smaller one.");
        let bytes = await this.read(c.address, c.size);
        const partial = c.offset.some((o, i) => o + chunk[i] > dims[i]);
        const mask = info.layout.dontFilterPartial && partial ? 4294967295 : c.mask;
        bytes = this.unfilter(bytes, info.filters, mask, chunkBytes, size);
        copyBlock(bytes, chunk, out, start, count, c.offset, dims, size);
      });
      await runLimited(work, 6);
    }
    unfilter(bytes, filters, mask, expected, elementSize) {
      for (let i = filters.length - 1; i >= 0; i--) {
        if (mask & 1 << i) continue;
        const f = filters[i];
        if (f.id === 1) {
          try {
            bytes = inflateSync(bytes, { maxOutputLength: expected + 4 });
          } catch {
            throw new Hdf5Error("A compressed chunk is damaged or inflates past its size.");
          }
        } else if (f.id === 2) bytes = unshuffle(bytes, f.params[0] ?? elementSize);
        else if (f.id === 3) {
          if (bytes.length < 4) throw new Hdf5Error("A checksummed chunk is cut short.");
          const data = bytes.subarray(0, bytes.length - 4);
          const stored = bytes.readUInt32LE(bytes.length - 4);
          const sum = fletcher32(data);
          const swapped = (sum & 255) << 24 | (sum & 65280) << 8 | sum >>> 8 & 65280 | sum >>> 24;
          if (stored !== sum && stored !== swapped >>> 0) throw new Hdf5Error("A chunk's checksum doesn't match; the file is damaged.");
          bytes = data;
        } else if (!f.optional) throw new Hdf5Error(`This dataset is stored with the ${f.name} filter, which brainhound can't undo yet. Only gzip, shuffle and fletcher32 are supported.`);
      }
      if (bytes.length < expected) {
        const padded = Buffer.alloc(expected);
        bytes.copy(padded);
        return padded;
      }
      return bytes;
    }
    /** The chunks that overlap a selection: [{ offset, address, size, mask }]. */
    async chunksFor(info, start, count) {
      const { layout, space, type, filters } = info;
      const dims = space.dims;
      const chunk = layout.chunk;
      const overlaps = (offset) => offset.every((o, i) => o < start[i] + count[i] && o + chunk[i] > start[i]);
      const raw = product(chunk) * type.size;
      if (layout.address === UNDEFINED) return [];
      if (layout.index === "btree1") return this.btree1Chunks(layout.address, dims.length, start, count, chunk, overlaps);
      if (layout.index === "single") {
        const offset = dims.map(() => 0);
        return [{ offset, address: layout.address, size: layout.filteredSize ?? raw, mask: layout.filterMask ?? 0 }];
      }
      const wanted = [];
      const first = start.map((s, i) => Math.floor(s / chunk[i]));
      const lastChunk = start.map((s, i) => Math.floor((s + count[i] - 1) / chunk[i]));
      const at = first.slice();
      do
        wanted.push(at.slice());
      while (step(at, first, lastChunk));
      const maxdims = space.maxdims.map((m, i) => m === UNDEFINED ? dims[i] : m);
      const unlimited = space.maxdims.findIndex((m) => m === UNDEFINED);
      const order = unlimited > 0 ? [unlimited, ...dims.map((_, i) => i).filter((i) => i !== unlimited)] : dims.map((_, i) => i);
      const maxGrid = order.map((i) => Math.ceil(maxdims[i] / chunk[i]));
      const down = maxGrid.map((_, i) => product(maxGrid.slice(i + 1)));
      const linearOf = (scaled) => order.reduce((sum, dim, k) => sum + scaled[dim] * down[k], 0);
      if (layout.index === "implicit") {
        return wanted.map((scaled) => ({ offset: scaled.map((s, i) => s * chunk[i]), address: layout.address + linearOf(scaled) * raw, size: raw, mask: 0 }));
      }
      const filtered = filters.length > 0;
      const lookup = layout.index === "fixed" ? await this.fixedArray(layout.address, filtered) : layout.index === "extensible" ? await this.extensibleArray(layout.address, filtered) : await this.btree2Chunks(layout.address, dims.length, filtered);
      const out = [];
      for (const scaled of wanted) {
        const entry = await lookup(linearOf(scaled), scaled);
        if (!entry || entry.address === UNDEFINED || entry.address === 0) continue;
        out.push({ offset: scaled.map((s, i) => s * chunk[i]), address: entry.address, size: entry.size ?? raw, mask: entry.mask ?? 0 });
      }
      return out;
    }
    async btree1Chunks(root, rank, start, count, chunk, overlaps) {
      const keySize = 8 + 8 * (rank + 1);
      const found = [];
      const seen = /* @__PURE__ */ new Set();
      const visit = async (node, expected = -1) => {
        if (seen.has(node)) throw new Hdf5Error("A dataset's chunk index points back at itself; the file may be damaged.");
        seen.add(node);
        const prefix = 8 + 2 * this.offsetSize;
        const head = await this.structure(node, prefix);
        const c = this.cursor(head);
        c.signature("TREE");
        const type = c.u8();
        const level = c.u8();
        const used = c.u16();
        if (type !== 1 || expected >= 0 && level !== expected) throw new Hdf5Error("A dataset's chunk index is damaged.");
        const body = await this.structure(node + prefix, (used + 1) * keySize + used * this.offsetSize);
        const b = this.cursor(body);
        const keys = [];
        const children = [];
        const readKey = () => {
          const size = b.u32();
          const mask = b.u32();
          const offset = [];
          for (let i = 0; i <= rank; i++) offset.push(Number(b.uint(8)));
          return { size, mask, offset: offset.slice(0, rank) };
        };
        keys.push(readKey());
        for (let i = 0; i < used; i++) {
          children.push(b.addr());
          keys.push(readKey());
        }
        for (let i = 0; i < used; i++) {
          if (level === 0) {
            if (overlaps(keys[i].offset)) found.push({ offset: keys[i].offset, address: children[i], size: keys[i].size, mask: keys[i].mask });
          } else {
            const lo = keys[i].offset[0];
            const hi = i + 1 < used ? keys[i + 1].offset[0] + chunk[0] : Infinity;
            if (rank === 0 || lo < start[0] + count[0] && hi > start[0]) await visit(children[i], level - 1);
          }
        }
      };
      await visit(root);
      return found;
    }
    entryReader(filtered, entrySize) {
      return (c) => {
        const address = c.addr();
        if (!filtered) return { address };
        const size = Number(c.uint(entrySize - this.offsetSize - 4));
        const mask = c.u32();
        return { address, size, mask };
      };
    }
    async fixedArray(address, filtered) {
      const head = await this.read(address, 12 + this.lengthSize + this.offsetSize);
      const c = this.cursor(head);
      c.signature("FAHD");
      c.skip(2);
      const entrySize = c.u8();
      const pageBits = c.u8();
      const entries = c.len();
      const dataBlock = c.addr();
      const readEntry = this.entryReader(filtered, entrySize);
      const pageSize = 2 ** pageBits;
      const paged = entries > pageSize;
      const pages = Math.ceil(entries / pageSize);
      const prefix = 4 + 2 + this.offsetSize + (paged ? Math.ceil(pages / 8) + 4 : 0);
      let whole;
      return async (i) => {
        if (i >= entries) return null;
        if (!paged) {
          whole ??= await this.structure(dataBlock, prefix + entries * entrySize);
          return readEntry(this.cursor(whole, prefix + i * entrySize));
        }
        const page2 = Math.floor(i / pageSize);
        const at = dataBlock + prefix + page2 * (pageSize * entrySize + 4) + i % pageSize * entrySize;
        return readEntry(this.cursor(await this.read(at, entrySize)));
      };
    }
    async extensibleArray(address, filtered) {
      const head = await this.read(address, 16 + 6 * this.lengthSize + this.offsetSize);
      const c = this.cursor(head);
      c.signature("EAHD");
      c.skip(2);
      const entrySize = c.u8();
      const maxBits = c.u8();
      const indexElements = c.u8();
      const dataBlockMin = c.u8();
      const superBlockMinPointers = c.u8();
      const pageBits = c.u8();
      c.skip(6 * this.lengthSize);
      const indexBlock = c.addr();
      if (indexBlock === UNDEFINED) return async () => null;
      const readEntry = this.entryReader(filtered, entrySize);
      const superBlocks = 1 + maxBits - Math.log2(dataBlockMin);
      const info = [];
      let startIndex = 0;
      let startBlock = 0;
      for (let s = 0; s < superBlocks; s++) {
        const blocks = 2 ** Math.floor(s / 2);
        const elements2 = 2 ** Math.ceil(s / 2) * dataBlockMin;
        info.push({ blocks, elements: elements2, startIndex, startBlock });
        startIndex += blocks * elements2;
        startBlock += blocks;
      }
      const directBlocks = 2 * (superBlockMinPointers - 1);
      const directSupers = 2 * Math.log2(superBlockMinPointers);
      const superPointers = superBlocks - directSupers;
      const blockOffsetBytes = Math.ceil(maxBits / 8);
      const ib = await this.read(indexBlock, 4 + 2 + this.offsetSize + indexElements * entrySize + (directBlocks + superPointers) * this.offsetSize);
      const ic = this.cursor(ib);
      ic.signature("EAIB");
      ic.skip(2 + this.offsetSize);
      const inIndex = [];
      for (let i = 0; i < indexElements; i++) inIndex.push(readEntry(ic));
      const dataAddresses = [];
      for (let i = 0; i < directBlocks; i++) dataAddresses.push(ic.addr());
      const superAddresses = [];
      for (let i = 0; i < superPointers; i++) superAddresses.push(ic.addr());
      const readFromDataBlock = async (blockAddress, elements2, within) => {
        if (blockAddress === UNDEFINED) return null;
        if (elements2 > 2 ** pageBits) throw new Hdf5Error("This dataset's chunk index is too large for brainhound to read yet.");
        const prefix = 4 + 2 + this.offsetSize + blockOffsetBytes;
        return readEntry(this.cursor(await this.read(blockAddress + prefix + within * entrySize, entrySize)));
      };
      return async (i) => {
        if (i < indexElements) return inIndex[i];
        const j = i - indexElements;
        const s = info.findIndex((x2) => j >= x2.startIndex && j < x2.startIndex + x2.blocks * x2.elements);
        if (s < 0) return null;
        const x = info[s];
        const blockInSuper = Math.floor((j - x.startIndex) / x.elements);
        const within = (j - x.startIndex) % x.elements;
        if (s < directSupers) return readFromDataBlock(dataAddresses[x.startBlock + blockInSuper], x.elements, within);
        const superAddress = superAddresses[s - directSupers];
        if (superAddress === UNDEFINED) return null;
        const sb = await this.read(superAddress, 4 + 2 + this.offsetSize + blockOffsetBytes + x.blocks * this.offsetSize);
        const sc = this.cursor(sb, 4 + 2 + this.offsetSize + blockOffsetBytes);
        if (x.elements > 2 ** pageBits) throw new Hdf5Error("This dataset's chunk index is too large for brainhound to read yet.");
        sc.skip(blockInSuper * this.offsetSize);
        return readFromDataBlock(sc.addr(), x.elements, within);
      };
    }
    async btree2Chunks(address, rank, filtered) {
      const records = await this.btree2Records(address);
      const map = /* @__PURE__ */ new Map();
      for (const r of records) {
        const c = this.cursor(r);
        const entryAddress = c.addr();
        let size;
        let mask = 0;
        if (filtered) {
          size = Number(c.uint(r.length - this.offsetSize - 4 - 8 * rank));
          mask = c.u32();
        }
        const scaled = [];
        for (let i = 0; i < rank; i++) scaled.push(Number(c.uint(8)));
        map.set(scaled.join(","), { address: entryAddress, size, mask });
      }
      return async (_, scaled) => map.get(scaled.join(",")) ?? null;
    }
  };
  function copyBlock(src, chunk, out, start, count, offset, dims, size) {
    const rank = count.length;
    if (rank === 0) {
      src.copy(out, 0, 0, size);
      return;
    }
    const lo = count.map((_, i) => Math.max(start[i], offset[i]));
    const hi = count.map((_, i) => Math.min(start[i] + count[i], offset[i] + chunk[i], dims[i]));
    if (lo.some((l, i) => l >= hi[i])) return;
    const srcStride = chunk.map((_, i) => product(chunk.slice(i + 1)));
    const outStride = count.map((_, i) => product(count.slice(i + 1)));
    const last = rank - 1;
    const runBytes = (hi[last] - lo[last]) * size;
    const index = lo.slice(0, last);
    const top = hi.slice(0, last).map((h) => h - 1);
    do {
      let s = lo[last] - offset[last];
      let o = lo[last] - start[last];
      for (let i = 0; i < last; i++) {
        s += (index[i] - offset[i]) * srcStride[i];
        o += (index[i] - start[i]) * outStride[i];
      }
      src.copy(out, o * size, s * size, s * size + runBytes);
    } while (step(index, lo, top));
  }
  function step(index, lo, hi) {
    for (let d = index.length - 1; d >= 0; d--) {
      if (index[d] < hi[d]) {
        index[d]++;
        return true;
      }
      index[d] = lo[d];
    }
    return false;
  }
  function fletcher32(data) {
    let sum1 = 0;
    let sum2 = 0;
    let i = 0;
    let words = data.length >> 1;
    while (words) {
      let block = words > 360 ? 360 : words;
      words -= block;
      do {
        sum1 += data[i] << 8 | data[i + 1];
        i += 2;
        sum2 += sum1;
      } while (--block);
      sum1 = (sum1 & 65535) + (sum1 >>> 16);
      sum2 = (sum2 & 65535) + (sum2 >>> 16);
    }
    if (data.length & 1) {
      sum1 += data[i] << 8;
      sum2 += sum1;
      sum1 = (sum1 & 65535) + (sum1 >>> 16);
      sum2 = (sum2 & 65535) + (sum2 >>> 16);
    }
    sum1 = (sum1 & 65535) + (sum1 >>> 16);
    sum2 = (sum2 & 65535) + (sum2 >>> 16);
    return (sum2 << 16 | sum1) >>> 0;
  }
  function unshuffle(bytes, elementSize) {
    if (elementSize <= 1) return bytes;
    const n = Math.floor(bytes.length / elementSize);
    const out = Buffer.alloc(bytes.length);
    for (let b = 0; b < elementSize; b++) {
      const base = b * n;
      for (let i = 0; i < n; i++) out[i * elementSize + b] = bytes[base + i];
    }
    bytes.copy(out, n * elementSize, n * elementSize);
    return out;
  }
  async function runLimited(tasks, limit) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    });
    await Promise.all(workers);
  }
  function reshape(values, shape) {
    if (shape.length <= 1) return values;
    const inner = product(shape.slice(1));
    const out = [];
    for (let i = 0; i < shape[0]; i++) out.push(reshape(values.slice(i * inner, (i + 1) * inner), shape.slice(1)));
    return out;
  }

  // vendor/formats/tree.js
  var FormatError = class extends Error {
    name = "FormatError";
  };
  var product2 = (a) => a.reduce((x, y) => x * y, 1);
  function group(name, path, children = [], attrs = {}) {
    return { kind: "group", name, path, attrs, children };
  }
  function dataset(name, path, { shape, dtype, attrs = {}, read }) {
    return { kind: "dataset", name, path, attrs, shape, dtype, read };
  }
  var join = (parent, name) => parent === "/" ? `/${name}` : `${parent}/${name}`;
  function select(values, shape, selection) {
    if (!selection || selection.every((s) => s === null || s === void 0)) return { shape, values };
    if (selection.length !== shape.length) throw new FormatError(`This has ${shape.length} dimensions; the selection has ${selection.length}.`);
    selection.forEach((s, i) => {
      if (s !== null && s !== void 0 && (!Number.isInteger(s) || s < 0 || s >= shape[i])) throw new FormatError(`Index ${s} is outside dimension ${i}, which has ${shape[i]} entries.`);
    });
    const strides = shape.map((_, i) => product2(shape.slice(i + 1)));
    const kept = shape.map((_, i) => i).filter((i) => selection[i] === null || selection[i] === void 0);
    const outShape = kept.map((i) => shape[i]);
    const n = product2(outShape);
    const out = ArrayBuffer.isView(values) ? new values.constructor(n) : new Array(n);
    let base = 0;
    selection.forEach((s, i) => {
      if (s !== null && s !== void 0) base += s * strides[i];
    });
    const index = kept.map(() => 0);
    for (let k = 0; k < n; k++) {
      let at = base;
      for (let j = 0; j < kept.length; j++) at += index[j] * strides[kept[j]];
      out[k] = values[at];
      for (let j = kept.length - 1; j >= 0; j--) {
        if (++index[j] < outShape[j]) break;
        index[j] = 0;
      }
    }
    return { shape: outShape, values: out };
  }
  function toRowMajor(values, shape) {
    if (shape.length < 2) return values;
    const n = product2(shape);
    const out = ArrayBuffer.isView(values) ? new values.constructor(n) : new Array(n);
    const index = shape.map(() => 0);
    const colStrides = shape.map((_, i) => product2(shape.slice(0, i)));
    for (let k = 0; k < n; k++) {
      let at = 0;
      for (let d = 0; d < shape.length; d++) at += index[d] * colStrides[d];
      out[k] = values[at];
      for (let d = shape.length - 1; d >= 0; d--) {
        if (++index[d] < shape[d]) break;
        index[d] = 0;
      }
    }
    return out;
  }
  function arrayFor(dtype) {
    const { class: c, size } = dtype;
    if (c === "float") return size === 4 ? Float32Array : size === 8 ? Float64Array : null;
    if (c === "int") return { 1: Int8Array, 2: Int16Array, 4: Int32Array, 8: BigInt64Array }[size] ?? null;
    if (c === "uint" || c === "bool") return { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array, 8: BigUint64Array }[size] ?? null;
    return null;
  }
  function readNumbers(bytes, offset, count, dtype) {
    const Type = arrayFor(dtype);
    if (!Type) throw new FormatError(`Numbers of type ${dtype.class}${dtype.size * 8} aren't supported.`);
    const size = dtype.size;
    if (offset + count * size > bytes.byteLength) throw new FormatError("The file ends before its data does; it may be cut short.");
    const copy = bytes.slice(offset, offset + count * size);
    const little = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    if (size > 1 && dtype.littleEndian !== little) {
      for (let i = 0; i < copy.length; i += size) copy.subarray(i, i + size).reverse();
    }
    return new Type(copy.buffer, copy.byteOffset, count);
  }

  // vendor/formats/zip.js
  function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 101010256) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new FormatError("This isn't a ZIP archive, or it's cut short.");
    let count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    if (count === 65535 || at === 4294967295 || view.getUint32(end + 12, true) === 4294967295) {
      const locator = end - 20;
      if (locator < 0 || view.getUint32(locator, true) !== 117853008) throw new FormatError("This ZIP archive is damaged.");
      const record = Number(view.getBigUint64(locator + 8, true));
      if (record + 56 > bytes.length || view.getUint32(record, true) !== 101075792) throw new FormatError("This ZIP archive is damaged.");
      count = Number(view.getBigUint64(record + 32, true));
      at = Number(view.getBigUint64(record + 48, true));
    }
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== 33639248) throw new FormatError("This ZIP archive's directory is damaged.");
      const method = view.getUint16(at + 10, true);
      let compressedSize = view.getUint32(at + 20, true);
      let size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      let local = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      let extra = at + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = view.getUint16(extra, true);
        const length = view.getUint16(extra + 2, true);
        if (id === 1) {
          let p = extra + 4;
          if (size === 4294967295) size = Number(view.getBigUint64(p, true)), p += 8;
          if (compressedSize === 4294967295) compressedSize = Number(view.getBigUint64(p, true)), p += 8;
          if (local === 4294967295) local = Number(view.getBigUint64(p, true));
        }
        extra += 4 + length;
      }
      entries.push({
        name,
        method,
        size,
        async read(inflateRaw2) {
          if (local + 30 > bytes.length || view.getUint32(local, true) !== 67324752) throw new FormatError(`The ZIP entry ${name} is damaged.`);
          const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
          if (start + compressedSize > bytes.length) throw new FormatError(`The ZIP entry ${name} is cut short.`);
          const data = bytes.subarray(start, start + compressedSize);
          if (method === 0) return data;
          if (method === 8) {
            const out = await inflateRaw2(data, size);
            if (out.length !== size) throw new FormatError(`The ZIP entry ${name} didn't unpack to its stated size.`);
            return out;
          }
          throw new FormatError(`The ZIP entry ${name} uses a compression method dropslice can't read.`);
        }
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  // vendor/formats/npy.js
  var MAGIC = [147, 78, 85, 77, 80, 89];
  var isNpy = (bytes) => MAGIC.every((b, i) => bytes[i] === b);
  function parseNpyHeader(bytes) {
    if (!isNpy(bytes)) throw new FormatError("This isn't a .npy file.");
    const major = bytes[6];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const start = major === 1 ? 10 : 12;
    const text2 = new TextDecoder(major >= 3 ? "utf-8" : "latin1").decode(bytes.subarray(start, start + headerLength));
    const descr = /'descr':\s*'([^']+)'/.exec(text2)?.[1];
    const fortran = /'fortran_order':\s*True/.test(text2);
    const shapeText = /'shape':\s*\(([^)]*)\)/.exec(text2)?.[1];
    if (!descr || shapeText === void 0) {
      if (/'descr':\s*\[/.test(text2)) throw new FormatError("Structured NumPy arrays (with named fields) aren't supported yet.");
      throw new FormatError("This .npy header can't be read; the file may be damaged.");
    }
    const shape = shapeText.split(",").map((s) => s.trim().replace(/L$/, "")).filter(Boolean).map(Number);
    if (shape.some((d) => !Number.isInteger(d) || d < 0)) throw new FormatError("This .npy file has an odd shape; it may be damaged.");
    return { dtype: parseDescr(descr), shape, fortran, dataOffset: start + headerLength };
  }
  function parseDescr(descr) {
    const m = /^([<>|=]?)([biufcUSO])(\d*)$/.exec(descr);
    if (!m) throw new FormatError(`NumPy type ${descr} isn't supported.`);
    const [, order, kind, n] = m;
    const size = Number(n || 1);
    if (size < 1) throw new FormatError(`NumPy type ${descr} has no size; the file may be damaged.`);
    const littleEndian = order !== ">";
    switch (kind) {
      case "b":
        return { class: "bool", size: 1, littleEndian };
      case "i":
        return { class: "int", size, littleEndian };
      case "u":
        return { class: "uint", size, littleEndian };
      case "f":
        if (size === 2) return { class: "float16", size, littleEndian };
        return { class: "float", size, littleEndian };
      case "c":
        return { class: "complex", size, littleEndian, part: { class: "float", size: size / 2, littleEndian } };
      case "U":
        return { class: "string", size: size * 4, chars: size, encoding: "utf-32", littleEndian };
      case "S":
        return { class: "string", size, chars: size, encoding: "bytes", littleEndian };
      default:
        throw new FormatError("This .npy file holds Python objects. dropslice never loads those, because unpickling can run code.");
    }
  }
  function halfToFloat(h) {
    const sign = h & 32768 ? -1 : 1;
    const exp = h >> 10 & 31;
    const frac = h & 1023;
    if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * 2 ** (exp - 15) * (1 + frac / 1024);
  }
  function decodeValues(bytes, offset, count, dtype) {
    if (offset + count * dtype.size > bytes.byteLength) throw new FormatError("The file ends before its data does; it may be cut short.");
    if (dtype.class === "string") {
      const out = new Array(count);
      for (let i = 0; i < count; i++) {
        const at = offset + i * dtype.size;
        if (dtype.encoding === "utf-32") {
          let s = "";
          const view = new DataView(bytes.buffer, bytes.byteOffset + at, dtype.size);
          for (let c = 0; c < dtype.chars; c++) {
            const code = view.getUint32(c * 4, dtype.littleEndian);
            if (code === 0) break;
            s += String.fromCodePoint(code);
          }
          out[i] = s;
        } else {
          const raw = bytes.subarray(at, at + dtype.size);
          const end = raw.indexOf(0);
          out[i] = new TextDecoder("latin1").decode(end < 0 ? raw : raw.subarray(0, end));
        }
      }
      return out;
    }
    if (dtype.class === "float16") {
      const raw = readNumbers(bytes, offset, count, { class: "uint", size: 2, littleEndian: dtype.littleEndian });
      return Float32Array.from(raw, halfToFloat);
    }
    if (dtype.class === "complex") {
      const parts = readNumbers(bytes, offset, count * 2, dtype.part);
      return Array.from({ length: count }, (_, i) => [parts[2 * i], parts[2 * i + 1]]);
    }
    return readNumbers(bytes, offset, count, dtype);
  }
  function npyDataset(name, path, bytes) {
    const { dtype, shape, fortran, dataOffset } = parseNpyHeader(bytes);
    let cache;
    const all = () => {
      if (!cache) {
        const values = decodeValues(bytes, dataOffset, product2(shape), dtype);
        cache = fortran ? toRowMajor(values, shape) : values;
      }
      return cache;
    };
    return dataset(name, path, { shape, dtype, attrs: fortran ? { memory_order: "Fortran (column-major)" } : {}, read: async (selection) => select(all(), shape, selection) });
  }
  async function npzGroup(name, bytes, inflateRaw2) {
    const entries = readZip(bytes);
    const children = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".npy")) continue;
      const childName = entry.name.slice(0, -4).replace(/\//g, "_");
      children.push(npyDataset(childName, join("/", childName), await entry.read(inflateRaw2)));
    }
    if (!children.length) throw new FormatError("This .npz archive has no arrays in it.");
    return group(name, "/", children, { format: entry0Note(entries) });
  }
  var entry0Note = (entries) => entries.some((e) => e.method === 8) ? "NumPy .npz (compressed)" : "NumPy .npz";
  function npyGroup(name, bytes) {
    return group(name, "/", [npyDataset(name.replace(/\.npy$/i, ""), join("/", name.replace(/\.npy$/i, "")), bytes)], { format: "NumPy .npy" });
  }

  // vendor/formats/mat5.js
  var TYPES = {
    1: { class: "int", size: 1 },
    2: { class: "uint", size: 1 },
    3: { class: "int", size: 2 },
    4: { class: "uint", size: 2 },
    5: { class: "int", size: 4 },
    6: { class: "uint", size: 4 },
    7: { class: "float", size: 4 },
    9: { class: "float", size: 8 },
    12: { class: "int", size: 8 },
    13: { class: "uint", size: 8 }
  };
  var MATRIX = 14;
  var COMPRESSED = 15;
  var UTF8 = 16;
  var UTF16 = 17;
  var UTF32 = 18;
  var CLASSES = {
    6: { class: "float", size: 8, name: "double" },
    7: { class: "float", size: 4, name: "single" },
    8: { class: "int", size: 1, name: "int8" },
    9: { class: "uint", size: 1, name: "uint8" },
    10: { class: "int", size: 2, name: "int16" },
    11: { class: "uint", size: 2, name: "uint16" },
    12: { class: "int", size: 4, name: "int32" },
    13: { class: "uint", size: 4, name: "uint32" },
    14: { class: "int", size: 8, name: "int64" },
    15: { class: "uint", size: 8, name: "uint64" }
  };
  var isMat5 = (bytes) => bytes.length >= 128 && new TextDecoder("latin1").decode(bytes.subarray(0, 10)) === "MATLAB 5.0";
  async function parseMat5(name, bytes, inflate) {
    if (bytes.length < 128) throw new FormatError("This MAT-file is cut short.");
    const indicator = new TextDecoder("latin1").decode(bytes.subarray(126, 128));
    if (indicator !== "IM" && indicator !== "MI") throw new FormatError("This MAT-file's header is damaged.");
    const little = indicator === "IM";
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, 116)).replace(/\0+$/, "").trim();
    const children = [];
    let at = 128;
    let budget = { elements: 0 };
    while (at + 8 <= bytes.length) {
      const tag = readTag(bytes, at, little);
      if (tag.type === COMPRESSED) {
        if (at + 8 + tag.size > bytes.length) throw new FormatError("This MAT-file is cut short.");
        const raw = await inflate(bytes.subarray(at + 8, at + 8 + tag.size));
        const inner = readTag(raw, 0, little);
        if (inner.type === MATRIX) children.push(readMatrix(raw.subarray(8, 8 + inner.size), little, "/", null, budget));
        at += 8 + tag.size;
      } else {
        const data = bytes.subarray(at + tag.dataStart, at + tag.dataStart + tag.size);
        if (tag.type === MATRIX) children.push(readMatrix(data, little, "/", null, budget));
        at += tag.small ? 8 : tag.dataStart + pad8(tag.size);
      }
    }
    return group(name, "/", children, { format: "MATLAB 5.0 MAT-file", header });
  }
  var pad8 = (n) => Math.ceil(n / 8) * 8;
  function readTag(bytes, at, little) {
    if (at + 8 > bytes.length) throw new FormatError("A MAT-file element is cut short.");
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, 8);
    const first = view.getUint32(0, little);
    if (first >>> 16 !== 0) return { type: first & 65535, size: first >>> 16, dataStart: 4, small: true };
    return { type: first, size: view.getUint32(4, little), dataStart: 8 };
  }
  function* elements(data, little) {
    let at = 0;
    while (at + 8 <= data.length) {
      const tag = readTag(data, at, little);
      const start = at + tag.dataStart;
      if (start + tag.size > data.length) throw new FormatError("A MAT-file element is cut short.");
      yield { ...tag, bytes: data.subarray(start, start + tag.size) };
      at = tag.small ? at + 8 : start + pad8(tag.size);
    }
  }
  function numbers(element, little) {
    const type = TYPES[element.type];
    if (!type) throw new FormatError(`MAT-file data type ${element.type} isn't supported.`);
    return readNumbers(element.bytes, 0, element.size / type.size, { ...type, littleEndian: little });
  }
  function text(element, little) {
    if (element.type === UTF8) return new TextDecoder().decode(element.bytes);
    if (element.type === 1 || element.type === 2) return new TextDecoder("latin1").decode(element.bytes);
    const codes = element.type === UTF16 || element.type === 4 ? numbers({ ...element, type: 4 }, little) : element.type === UTF32 ? numbers({ ...element, type: 6 }, little) : numbers(element, little);
    return Array.from(codes, (c) => String.fromCodePoint(Number(c))).join("");
  }
  function toClass(values, cls) {
    const Type = { float: cls.size === 4 ? Float32Array : Float64Array, int: { 1: Int8Array, 2: Int16Array, 4: Int32Array, 8: BigInt64Array }[cls.size], uint: { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array, 8: BigUint64Array }[cls.size] }[cls.class];
    if (values instanceof Type) return values;
    const big = Type === BigInt64Array || Type === BigUint64Array;
    return Type.from(values, (v) => big ? BigInt(v) : Number(v));
  }
  function readMatrix(data, little, parentPath, forcedName, budget) {
    if (++budget.elements > 1e6) throw new FormatError("This MAT-file nests too many arrays; it may be damaged.");
    if (data.length === 0) return group(forcedName ?? "(empty)", join(parentPath, forcedName ?? "(empty)"));
    const parts = elements(data, little);
    const flagsEl = parts.next().value;
    const flagWords = numbers(flagsEl, little);
    const cls = flagWords[0] & 255;
    const complex = Boolean(flagWords[0] & 2048);
    const logical = Boolean(flagWords[0] & 512);
    const dims = Array.from(numbers(parts.next().value, little), Number);
    if (dims.some((d) => !Number.isInteger(d) || d < 0)) throw new FormatError("A MAT-file array has an impossible size; the file may be damaged.");
    const count = (values, what) => {
      if (values.length !== product2(dims)) throw new FormatError(`${what} holds ${values.length} values but its size says ${product2(dims)}; the file may be damaged.`);
      return values;
    };
    const rawName = text(parts.next().value, little);
    const name = forcedName ?? (rawName || "(unnamed)");
    const path = join(parentPath, name);
    const n = product2(dims);
    if (CLASSES[cls]) {
      const real = parts.next().value;
      const imag = complex ? parts.next().value : null;
      const c = CLASSES[cls];
      const attrs = { matlab_class: logical ? "logical" : c.name };
      if (complex) {
        const re = Array.from(count(numbers(real, little), name), Number);
        const im = Array.from(count(numbers(imag, little), name), Number);
        const values2 = toRowMajor(re.map((r, i) => [r, im[i]]), dims);
        return dataset(name, path, { shape: dims, dtype: { class: "complex", size: 16 }, attrs, read: async (s) => select(values2, dims, s) });
      }
      const values = toRowMajor(toClass(count(numbers(real, little), name), c), dims);
      const dtype = logical ? { class: "bool", size: 1 } : { class: c.class, size: c.size };
      const out = logical ? Uint8Array.from(values, (v) => v ? 1 : 0) : values;
      return dataset(name, path, { shape: dims, dtype, attrs, read: async (s) => select(out, dims, s) });
    }
    if (cls === 4) {
      const chars = count(Array.from(text(parts.next().value, little)), name);
      const rows = dims[0] ?? 0;
      const cols = n / Math.max(rows, 1);
      const lines = [];
      for (let r = 0; r < rows; r++) {
        let line = "";
        for (let c = 0; c < cols; c++) line += chars[c * rows + r] ?? "";
        lines.push(line);
      }
      const shape = rows === 1 ? [] : [rows];
      return dataset(name, path, { shape, dtype: { class: "string", size: 0 }, attrs: { matlab_class: "char" }, read: async (s) => select(lines, shape.length ? shape : [1], shape.length ? s : null) });
    }
    if (cls === 1) {
      const children = [];
      for (let i = 0; i < n; i++) children.push(readMatrix(parts.next().value.bytes, little, path, `{${i + 1}}`, budget));
      return group(name, path, children, { matlab_class: "cell", size: dims.join("x") });
    }
    if (cls === 2 || cls === 3) {
      if (cls === 3) parts.next();
      const nameLength = Number(numbers(parts.next().value, little)[0]);
      const namesBytes = parts.next().value.bytes;
      if (!Number.isInteger(nameLength) || nameLength < 1 || nameLength > 64 || namesBytes.length % nameLength !== 0) {
        throw new FormatError(`The struct ${name} has damaged field names.`);
      }
      const fields = [];
      for (let i = 0; i * nameLength < namesBytes.length; i++) {
        const raw = namesBytes.subarray(i * nameLength, (i + 1) * nameLength);
        const end = raw.indexOf(0);
        fields.push(new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)));
      }
      const struct = (base, elementPath) => fields.map((f) => readMatrix(parts.next().value.bytes, little, elementPath, f, budget));
      const attrs = { matlab_class: cls === 2 ? "struct" : "object", size: dims.join("x") };
      if (n === 1) return group(name, path, struct(name, path), attrs);
      const children = [];
      for (let i = 0; i < n; i++) {
        const elementPath = join(path, `(${i + 1})`);
        children.push(group(`(${i + 1})`, elementPath, struct(name, elementPath)));
      }
      return group(name, path, children, attrs);
    }
    if (cls === 5) {
      const ir = Array.from(numbers(parts.next().value, little), Number);
      const jc = Array.from(numbers(parts.next().value, little), Number);
      const pr = Float64Array.from(numbers(parts.next().value, little), Number);
      const pi = complex ? Float64Array.from(numbers(parts.next().value, little), Number) : null;
      const sub = (child, values, dtype) => dataset(child, join(path, child), { shape: [values.length], dtype, read: async (s) => select(values, [values.length], s) });
      const kids = [sub("row_indices", Int32Array.from(ir), { class: "int", size: 4 }), sub("column_starts", Int32Array.from(jc), { class: "int", size: 4 }), sub("values", pr, { class: "float", size: 8 })];
      if (pi) kids.push(sub("imaginary_values", pi, { class: "float", size: 8 }));
      return group(name, path, kids, {
        matlab_class: "sparse",
        size: dims.join("x"),
        note: "Stored as MATLAB keeps it: values with 0-based row indices, and where each column starts."
      });
    }
    return group(name, path, [], { matlab_class: { 16: "function handle", 17: "opaque" }[cls] ?? `class ${cls}`, note: "dropslice can't show this kind of MATLAB value yet." });
  }

  // vendor/formats/detect.js
  var HDF5 = [137, 72, 68, 70, 13, 10, 26, 10];
  function hdf5Offset(head) {
    for (let at = 0; at + 8 <= head.length; at = at === 0 ? 512 : at * 2) {
      if (HDF5.every((b, i) => head[at + i] === b)) return at;
    }
    return -1;
  }
  function sniff(head) {
    if (hdf5Offset(head) >= 0) return "hdf5";
    if (isNpy(head)) return "npy";
    if (head[0] === 80 && head[1] === 75 && (head[2] === 3 || head[2] === 5)) return "npz";
    if (isMat5(head)) return "mat5";
    return "unknown";
  }

  // src/summary.js
  var WHOLE_LIMIT = 256 * 1024 * 1024;
  var ENTRY_LIMIT = 300;
  var POINTS = 1500;
  var IMAGE = 160;
  var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var product3 = (a) => a.reduce((x, y) => x * y, 1);
  function formatBytes(n) {
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1e3 && i < units.length - 1) v /= 1e3, i++;
    return i === 0 ? `${v} bytes` : `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
  }
  function show(v) {
    if (v === null || v === void 0) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return v;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const items = Array.from(v).slice(0, 8).map(show);
      return `[${items.join(", ")}${v.length > 8 ? ", \u2026" : ""}]`;
    }
    if (v.ref) return `\u2192 ${v.ref}`;
    return JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x).slice(0, 200);
  }
  async function hdf5Rows(file) {
    const rows = [];
    const candidates = [];
    let budget = ENTRY_LIMIT;
    const walk = async (address, path, depth) => {
      for (const link of await file.links(address)) {
        if (budget-- <= 0) return;
        const child = path === "/" ? `/${link.name}` : `${path}/${link.name}`;
        if (link.address === void 0) {
          rows.push({ depth, name: link.name, kind: "link", detail: link.soft ? `\u2192 ${link.soft}` : "\u2192 another file" });
          continue;
        }
        const kind = await file.kindOf(link.address);
        const attrs = await file.attributes(link.address);
        const type = attrs.neurodata_type ? String(attrs.neurodata_type) : "";
        if (kind === "group") {
          rows.push({ depth, name: link.name, kind: "group", detail: type, note: attrs.description ? show(attrs.description) : "" });
          if (depth < 6) await walk(link.address, child, depth + 1);
          continue;
        }
        const info = await file.dataset(link.address);
        const dims = info.space.kind === "simple" ? info.space.dims : [];
        const unit = attrs.unit ?? attrs.units;
        rows.push({ depth, name: link.name, kind: "dataset", detail: `${info.space.kind === "null" ? "empty" : dims.length ? dims.join(" \xD7 ") : "scalar"} ${describeType(info.type)}`, note: [type, unit ? `unit: ${show(unit)}` : ""].filter(Boolean).join(" \xB7 ") });
        if ((info.type.kind === "int" || info.type.kind === "float") && dims.length >= 1 && dims.length <= 3 && product3(dims) >= 8) candidates.push({ path: child, dims, info, unit });
      }
    };
    if (budget > 0) await walk(file.rootAddress, "/", 0);
    return { rows, candidates, truncated: budget <= 0 };
  }
  async function nwbFacts(file) {
    const root = await file.attributes(file.rootAddress);
    if (root.neurodata_type !== "NWBFile") return null;
    const scalar = async (p) => {
      try {
        const node = await file.resolve(p);
        if (node.kind !== "dataset") return void 0;
        const info = await file.dataset(node.address);
        if (product3(info.space.dims) > 20) return void 0;
        const { values } = await file.readSlice(info);
        return values.length === 1 ? values[0] : values;
      } catch {
        return void 0;
      }
    };
    const facts = [
      ["NWB version", root.nwb_version],
      ["Session", await scalar("/session_description")],
      ["Started", await scalar("/session_start_time")],
      ["Identifier", await scalar("/identifier")],
      ["Lab", await scalar("/general/lab")],
      ["Institution", await scalar("/general/institution")]
    ];
    const subject = [];
    for (const k of ["species", "subject_id", "age", "sex", "genotype"]) {
      const v = await scalar(`/general/subject/${k}`);
      if (v !== void 0) subject.push(`${k.replace("_", " ")}: ${show(v)}`);
    }
    if (subject.length) facts.push(["Subject", subject.join(", ")]);
    return facts.filter(([, v]) => v !== void 0 && v !== "");
  }
  function treeRows(node, depth = 0, rows = [], candidates = []) {
    for (const child of node.children ?? []) {
      if (rows.length >= ENTRY_LIMIT) break;
      if (child.kind === "group") {
        rows.push({ depth, name: child.name, kind: "group", detail: child.attrs?.matlab_class ?? "", note: child.attrs?.size ? `size ${child.attrs.size}` : "" });
        treeRows(child, depth + 1, rows, candidates);
      } else {
        const dtype = child.dtype;
        const type = dtype.class === "string" ? "text" : dtype.class === "complex" ? `complex${dtype.size * 8}` : dtype.class === "bool" ? "bool" : `${dtype.class}${dtype.size * 8}`;
        rows.push({ depth, name: child.name, kind: "dataset", detail: `${child.shape.length ? child.shape.join(" \xD7 ") : "scalar"} ${type}`, note: child.attrs?.matlab_class && child.attrs.matlab_class !== type ? child.attrs.matlab_class : "" });
        if (["int", "uint", "float", "float16", "bool"].includes(dtype.class) && child.shape.length >= 1 && child.shape.length <= 3 && product3(child.shape) >= 8) candidates.push({ node: child, dims: child.shape });
      }
    }
    return { rows, candidates };
  }
  function pick(candidates) {
    const score = (c) => (/^\/acquisition\//.test(c.path ?? "") ? 3 : /\/data$/.test(c.path ?? "") ? 2 : 1) * 1e12 + product3(c.dims);
    return candidates.slice().sort((a, b) => score(b) - score(a))[0];
  }
  function plan(dims) {
    if (dims.length === 3) return { kind: "image", start: [0, 0, 0], count: [1, Math.min(dims[1], 1024), Math.min(dims[2], 1024)], rows: Math.min(dims[1], 1024), cols: Math.min(dims[2], 1024), note: `the first of ${dims[0]} slices` };
    if (dims.length === 2 && dims[0] >= 16 && dims[1] >= 16) return { kind: "image", start: [0, 0], count: [Math.min(dims[0], 1024), Math.min(dims[1], 1024)], rows: Math.min(dims[0], 1024), cols: Math.min(dims[1], 1024) };
    const n = Math.min(dims[0], POINTS);
    const lines = dims.length === 2 ? Math.min(dims[1], 4) : 1;
    return { kind: "lines", start: dims.map(() => 0), count: dims.length === 2 ? [n, lines] : [n], n, lines, note: dims[0] > n ? `the first ${n} of ${dims[0]}` : "" };
  }
  var num = (v) => typeof v === "bigint" ? Number(v) : typeof v === "boolean" ? Number(v) : Number(v);
  function linesSvg(values, p) {
    const W = 640;
    const H = 220;
    const ys = Array.from(values, num).filter(Number.isFinite);
    if (!ys.length) return "";
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (lo === hi) lo -= 1, hi += 1;
    const colors = ["#3b6fb6", "#69aee0", "#9b7fd1", "#3aa39a"];
    let paths = "";
    for (let l = 0; l < p.lines; l++) {
      let d = "";
      const stride = Math.max(1, Math.floor(p.n / W));
      for (let i = 0; i < p.n; i += stride) {
        const v = num(values[i * p.lines + l]);
        if (!Number.isFinite(v)) continue;
        const x = i / Math.max(p.n - 1, 1) * W;
        const y = H - (v - lo) / (hi - lo) * H;
        d += `${d ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      paths += `<path d="${d}" fill="none" stroke="${colors[l]}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="plot" role="img" aria-label="Line plot">${paths}</svg><div class="range"><span>min ${esc(show(lo))}</span><span>max ${esc(show(hi))}</span></div>`;
  }
  var RAMP = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37]
  ];
  function color(t) {
    const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
    const i = Math.min(Math.floor(x), RAMP.length - 2);
    const f = x - i;
    return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
  }
  var CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 4294967295;
    for (const b of bytes) c = CRC[(c ^ b) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function png(width, height, rgb) {
    const raw = new Uint8Array(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
    const blocks = [];
    for (let i = 0; i < raw.length; i += 65535) {
      const piece = raw.subarray(i, i + 65535);
      const head = new Uint8Array([i + 65535 >= raw.length ? 1 : 0, piece.length & 255, piece.length >> 8, ~piece.length & 255, ~piece.length >> 8 & 255]);
      blocks.push(head, piece);
    }
    let a = 1;
    let b = 0;
    for (const v of raw) a = (a + v) % 65521, b = (b + a) % 65521;
    const zlib = concat([new Uint8Array([120, 1]), ...blocks, u32((b << 16 | a) >>> 0)]);
    const chunk = (type, data) => {
      const td = concat([new TextEncoderLite(type), data]);
      return concat([u32(data.length), td, u32(crc32(td))]);
    };
    const ihdr = concat([u32(width), u32(height), new Uint8Array([8, 2, 0, 0, 0])]);
    return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))]);
  }
  function TextEncoderLite(s) {
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  var u32 = (n) => new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
  function concat(list) {
    const out = new Uint8Array(list.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of list) out.set(x, at), at += x.length;
    return out;
  }
  function base64(bytes) {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let s = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
      s += abc[n >> 18 & 63] + abc[n >> 12 & 63] + (i + 1 < bytes.length ? abc[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? abc[n & 63] : "=");
    }
    return s;
  }
  function imageHtml(values, p) {
    const step2 = Math.max(1, Math.ceil(Math.max(p.rows, p.cols) / IMAGE));
    const h = Math.ceil(p.rows / step2);
    const w = Math.ceil(p.cols / step2);
    const picked = new Float64Array(w * h);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = num(values[y * step2 * p.cols + x * step2]);
        picked[y * w + x] = v;
        if (Number.isFinite(v)) lo = Math.min(lo, v), hi = Math.max(hi, v);
      }
    if (!Number.isFinite(lo)) return "";
    const rgb = new Uint8Array(w * h * 3);
    picked.forEach((v, i) => rgb.set(Number.isFinite(v) ? color(hi === lo ? 0.5 : (v - lo) / (hi - lo)) : [128, 128, 128], i * 3));
    return `<img class="image" alt="Heatmap" src="data:image/png;base64,${base64(png(w, h, rgb))}"><div class="range"><span>min ${esc(show(lo))}</span><span>max ${esc(show(hi))}</span></div>`;
  }
  async function plotHtml(c, readSlice) {
    if (!c) return "";
    const p = plan(c.dims);
    try {
      const values = await readSlice(c, p);
      const body = p.kind === "image" ? imageHtml(values, p) : linesSvg(values, p);
      if (!body) return "";
      return `<section class="card"><h2>${esc(c.path ?? c.node.path)}</h2><p class="muted">${esc([`${c.dims.join(" \xD7 ")}`, p.note, c.unit ? `unit: ${show(c.unit)}` : ""].filter(Boolean).join(" \xB7 "))}</p>${body}</section>`;
    } catch (e) {
      return `<section class="card"><p class="muted">Couldn't plot ${esc(c.path ?? c.node.path)}: ${esc(e.message)}</p></section>`;
    }
  }
  var STYLE = `
:root { color-scheme: light dark; --fg: #1d1f22; --muted: #6b7078; --line: #e3e6ea; --card: #f6f7f9; --accent: #3b6fb6; }
@media (prefers-color-scheme: dark) { :root { --fg: #eceef1; --muted: #9aa0a8; --line: #2c3036; --card: #1b1e22; --accent: #8cc4ff; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 22px 26px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); background: transparent; }
h1 { font-size: 18px; margin: 0 0 2px; font-weight: 600; word-break: break-all; }
h2 { font-size: 13px; margin: 0 0 2px; font-weight: 600; font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
.muted { color: var(--muted); margin: 0 0 10px; }
.card { background: var(--card); border-radius: 12px; padding: 14px 16px; margin: 14px 0; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0; }
.facts dt { color: var(--muted); } .facts dd { margin: 0; word-break: break-word; }
.plot { width: 100%; height: 200px; display: block; }
.image { width: 100%; max-width: 420px; image-rendering: pixelated; display: block; border-radius: 6px; }
.range { display: flex; justify-content: space-between; color: var(--muted); font: 11px ui-monospace, Menlo, monospace; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font: 12px/1.5 ui-monospace, Menlo, monospace; }
td { padding: 2px 8px 2px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
td.name { white-space: nowrap; } td.note { color: var(--muted); }
.group { font-weight: 600; } .group::after { content: "/"; color: var(--muted); }
`;
  function page({ title, subtitle, facts, plot, rows, truncated, message }) {
    const factHtml = facts?.length ? `<section class="card"><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(show(v))}</dd>`).join("")}</dl></section>` : "";
    const table2 = rows?.length ? `<section class="card"><table>${rows.map((r) => `<tr><td class="name" style="padding-left:${r.depth * 16}px"><span class="${r.kind === "group" ? "group" : ""}">${esc(r.name)}</span></td><td>${esc(r.detail ?? "")}</td><td class="note">${esc(r.note ?? "")}</td></tr>`).join("")}</table>${truncated ? `<p class="muted">Showing the first ${ENTRY_LIMIT} entries.</p>` : ""}</section>` : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p>${message ? `<section class="card"><p>${esc(message)}</p></section>` : ""}${factHtml}${plot ?? ""}${table2}</body></html>`;
  }
  async function preview(source) {
    const { name, size } = source;
    const read = async (offset, length) => Buffer.from(await source.read(offset, length));
    const head = await read(0, Math.min(size, 4096));
    const kind = sniff(head);
    const sub = (label) => `${label} \xB7 ${formatBytes(size)}`;
    try {
      if (kind === "hdf5") {
        const file = await Hdf5File.open({ name, size: async () => size, read });
        const isMat = name.toLowerCase().endsWith(".mat");
        const facts = await nwbFacts(file);
        const { rows, candidates, truncated } = await hdf5Rows(file);
        const plot = await plotHtml(pick(candidates), async (c, p) => (await file.readSlice(c.info, p.start, p.count)).values);
        return page({ title: name, subtitle: sub(facts ? "NWB (HDF5)" : isMat ? "MATLAB v7.3 (HDF5)" : "HDF5"), facts, plot, rows, truncated });
      }
      if (kind === "npy" || kind === "npz" || kind === "mat5") {
        if (size > WHOLE_LIMIT) {
          if (kind === "npy") {
            const h = parseNpyHeader(head);
            return page({ title: name, subtitle: sub("NumPy .npy"), facts: [["Shape", h.shape.join(" \xD7 ") || "scalar"], ["Type", `${h.dtype.class}${h.dtype.size * 8}`], ["Order", h.fortran ? "Fortran (column-major)" : "C (row-major)"]], message: "This file is too big to plot in a preview." });
          }
          return page({ title: name, subtitle: sub(kind === "npz" ? "NumPy .npz" : "MATLAB 5.0 MAT-file"), message: "This file is too big to read in a preview. Open it in dropslice or Python to see inside." });
        }
        const bytes = await read(0, size);
        const tree = kind === "npy" ? npyGroup(name, bytes) : kind === "npz" ? await npzGroup(name, bytes, async (b, n) => inflateRaw(b, Math.min(n ?? WHOLE_LIMIT, WHOLE_LIMIT))) : await parseMat5(name, bytes, async (b) => inflateZlib(b, WHOLE_LIMIT));
        const { rows, candidates } = treeRows(tree);
        const facts = kind === "mat5" && tree.attrs.header ? [["Header", tree.attrs.header]] : null;
        const plot = await plotHtml(pick(candidates.map((c) => ({ ...c, path: c.node.path }))), async (c) => (await c.node.read(null)).values);
        return page({ title: name, subtitle: sub(kind === "npy" ? "NumPy .npy" : kind === "npz" ? "NumPy .npz" : "MATLAB 5.0 MAT-file"), facts, plot, rows });
      }
      return page({ title: name, subtitle: sub("Unknown format"), message: "SciLook doesn't recognize this file. It previews NWB, HDF5, MATLAB .mat and NumPy .npy and .npz files." });
    } catch (e) {
      return page({ title: name, subtitle: sub("Couldn't read"), message: `This file couldn't be read: ${e?.message ?? e}` });
    }
  }

  // src/entry.js
  globalThis.SciLook = { preview };
})();
