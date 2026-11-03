// A small, read-only HDF5 reader, written from the HDF Group's published file format spec. It reads
// only what a question needs: the superblock, the object headers along a path, and the chunks a
// slice touches. It covers files written with HDF5's default settings (what pynwb, h5py and MatNWB
// write) and the newest format, with gzip, shuffle and fletcher32. It never writes.
import { inflateSync } from "node:zlib";

export class Hdf5Error extends Error {}

const SIGNATURE = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const UNDEFINED = -1;
// The most raw bytes one read may gather, so a careless request can't pull gigabytes.
export const MAX_READ_BYTES = 128 * 1024 * 1024;
// The most values one read may decode, since each becomes a JavaScript value.
export const MAX_VALUES = 10_000_000;
// The largest piece of the file's own bookkeeping (a header, a heap, an index node) brainhound will read.
const MAX_STRUCTURE = 16 * 1024 * 1024;
// How many index nodes and heap objects one call may visit, so a hostile file can't loop it for hours.
const WORK_LIMIT = 200_000;
const FILTER_NAMES = { 1: "gzip", 2: "shuffle", 3: "fletcher32", 4: "szip", 5: "nbit", 6: "scaleoffset", 32000: "lzf", 32001: "blosc", 32004: "lz4", 32008: "bitshuffle", 32015: "zstd" };

/** A cursor over a buffer that knows the file's address and length sizes. */
class Cursor {
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
    for (let i = size - 1; i >= 0; i--) v = (v << 8n) | BigInt(this.b[this.at + i]);
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
  signature(text) {
    const got = this.bytes(4).toString("latin1");
    if (got !== text) throw new Hdf5Error(`Expected a ${text} block but found something else; the file may be damaged.`);
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
}

/** Bytes needed to store numbers up to `max`, the way HDF5 sizes its variable-width fields. */
function encodedSize(max) {
  return max <= 0 ? 1 : Math.floor(Math.log2(max) / 8) + 1;
}

const product = (a) => a.reduce((x, y) => x * y, 1);

// ---------------------------------------------------------------------------------------------
// Datatypes and dataspaces

function parseDatatype(c) {
  const start = c.at;
  const classAndVersion = c.u8();
  const cls = classAndVersion & 0x0f;
  const version = classAndVersion >> 4;
  const bits = c.u8() | (c.u8() << 8) | (c.u8() << 16);
  const size = c.u32();
  const t = { class: cls, size };
  switch (cls) {
    case 0: // fixed-point
      t.kind = "int";
      t.bigEndian = Boolean(bits & 1);
      t.signed = Boolean(bits & 8);
      c.skip(4);
      break;
    case 1: // floating-point
      t.kind = "float";
      t.bigEndian = Boolean(bits & 1);
      c.skip(12);
      break;
    case 2: // time
      t.kind = "opaque";
      c.skip(2);
      break;
    case 3: // fixed-length string
      t.kind = "string";
      t.padding = bits & 0x0f;
      t.charset = (bits >> 4) & 0x0f;
      break;
    case 4: // bitfield
      t.kind = "int";
      t.bigEndian = Boolean(bits & 1);
      t.signed = false;
      c.skip(4);
      break;
    case 5: // opaque
      t.kind = "opaque";
      c.skip(Math.ceil((bits & 0xff) / 8) * 8);
      break;
    case 6: {
      // compound
      t.kind = "compound";
      t.members = [];
      const count = bits & 0xffff;
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
    case 7: // reference
      t.kind = "reference";
      t.refType = bits & 0x0f;
      break;
    case 8: {
      // enumeration
      t.kind = "enum";
      t.base = parseDatatype(c);
      const count = bits & 0xffff;
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
    case 9: // variable-length
      t.kind = (bits & 0x0f) === 1 ? "vlen-string" : "vlen";
      t.charset = (bits >> 8) & 0x0f;
      t.base = parseDatatype(c);
      break;
    case 10: {
      // array
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

/** A short, numpy-like name for a datatype, such as int16, float64, str or compound{t,label}. */
export function describeType(t) {
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

const isBoolEnum = (t) => t.names.length === 2 && t.names.map((n) => n.toUpperCase()).join() === "FALSE,TRUE";

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
  if (n === 2) return t.signed ? (t.bigEndian ? buf.readInt16BE(at) : buf.readInt16LE(at)) : t.bigEndian ? buf.readUInt16BE(at) : buf.readUInt16LE(at);
  if (n === 4) return t.signed ? (t.bigEndian ? buf.readInt32BE(at) : buf.readInt32LE(at)) : t.bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at);
  if (n === 8) {
    const v = t.signed ? (t.bigEndian ? buf.readBigInt64BE(at) : buf.readBigInt64LE(at)) : t.bigEndian ? buf.readBigUInt64BE(at) : buf.readBigUInt64LE(at);
    // Exact whole numbers stay numbers; ones too big for a double stay exact as text.
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  throw new Hdf5Error(`Integers of ${n} bytes aren't supported.`);
}

function halfToNumber(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function decodeFixedString(bytes, t) {
  let end = bytes.length;
  // Null-terminated and null-padded strings stop at the first zero; space-padded ones lose the spaces.
  if (t.padding !== 2) {
    const zero = bytes.indexOf(0);
    if (zero >= 0) end = zero;
  } else {
    while (end > 0 && bytes[end - 1] === 0x20) end--;
  }
  return bytes.toString(t.charset === 1 ? "utf8" : "latin1", 0, end);
}

// ---------------------------------------------------------------------------------------------
// The file

export class Hdf5File {
  /** Opens a file from a FileSource or HttpSource, checking that it really is HDF5. */
  static async open(source) {
    const file = new Hdf5File(source);
    await file.init();
    return file;
  }

  constructor(source) {
    this.source = source;
    this.headers = new Map();
    this.childCache = new Map();
    this.heaps = new Map();
    this.paths = new Map();
  }

  async init() {
    const size = await this.source.size();
    let at = 0;
    let head;
    // The superblock sits at 0, or after a user block at 512, 1024, 2048 and so on.
    for (;;) {
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
      // The root group's symbol table entry: name offset, then its object header address.
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
    // Addresses count from the base address, which is where the superblock is when a user block comes first.
    if (this.base === UNDEFINED || (this.base === 0 && at > 0)) this.base = at;
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
      let prefix = 6 + (flags & 0x20 ? 16 : 0) + (flags & 0x10 ? 4 : 0);
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
    if (type === 0x10) {
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
    return messages.some((m) => m.type === 0x08) ? "dataset" : "group";
  }

  // ----- groups

  /** The links in a group: [{ name, address }] for hard links, [{ name, soft }] or [{ name, external }] for others. */
  async links(address) {
    if (this.childCache.has(address)) return this.childCache.get(address);
    const messages = await this.header(address);
    const links = [];
    for (const m of messages) {
      if (m.type === 0x11) {
        const c = this.cursor(m.data);
        const btree = c.addr();
        const heap = c.addr();
        links.push(...(await this.symbolTableLinks(btree, heap)));
      } else if (m.type === 0x06) {
        links.push(this.parseLink(m.data));
      } else if (m.type === 0x02) {
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
    links.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.childCache.set(address, links);
    return links;
  }

  parseLink(data) {
    const c = this.cursor(data);
    c.skip(1);
    const flags = c.u8();
    const type = flags & 0x08 ? c.u8() : 0;
    if (flags & 0x04) c.skip(8);
    if (flags & 0x10) c.skip(1);
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
    // Each step down must be one level lower, so a damaged index can't send the walk in circles.
    const seen = new Set();
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
      if (type !== 0 || (expected >= 0 && level !== expected)) throw new Hdf5Error("A group's index is damaged.");
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
        // A soft link: the scratch pad holds the target's offset in the same heap.
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
      if ((await this.kindOf(address)) !== "group") throw new Hdf5Error(`${current || "/"} is a dataset, not a group.`);
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
  async pathOf(address, budget = 2000) {
    if (this.paths.has(address)) return this.paths.get(address);
    const queue = [{ address: this.rootAddress, path: "" }];
    const seen = new Set();
    while (queue.length && budget-- > 0) {
      const { address: at, path } = queue.shift();
      if (seen.has(at)) continue;
      seen.add(at);
      if ((await this.kindOf(at)) !== "group") continue;
      for (const link of await this.links(at)) {
        if (link.address === undefined) continue;
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
      if (m.type === 0x0c) raw.push(m.data);
      else if (m.type === 0x15) {
        const c = this.cursor(m.data);
        c.skip(1);
        const flags = c.u8();
        if (flags & 1) c.skip(2);
        const heapAddress = c.addr();
        const nameIndex = c.addr();
        if (heapAddress === UNDEFINED || nameIndex === UNDEFINED) continue;
        const heap = await this.fractalHeap(heapAddress);
        for (const record of await this.btree2Records(nameIndex)) {
          if (record[8] & 1) continue; // a shared attribute, kept elsewhere
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
    // Newer files keep many attributes in hash order; sort them so output is stable.
    decoded.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
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
    const pad = (n) => (version === 1 ? Math.ceil(n / 8) * 8 : n);
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
    for (const r of refs) r.slot[r.key] = { ref: (await this.pathOf(r.address)) ?? `object at ${r.address}` };
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
        const objects = new Map();
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
      maxDirectRows: Math.log2(maxDirect) - Math.log2(startBlock) + 2,
    };
    this.heaps.set(key, heap);
    return heap;
  }

  rowBlockSize(heap, row) {
    return row === 0 ? heap.startBlock : heap.startBlock * 2 ** (row - 1);
  }

  async heapObject(heap, id) {
    const type = (id[0] >> 4) & 3;
    if (type === 2) return id.subarray(1, 1 + (id[0] & 0x0f) + 1);
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
    // Field widths inside internal nodes depend on how many records each level can hold.
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
    const seen = new Set();
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
      if (m.type === 0x01) info.space = parseDataspace(c);
      else if (m.type === 0x03) info.type = m.flags & 2 ? await this.sharedDatatype(m.data) : parseDatatype(c);
      else if (m.type === 0x08) info.layoutData = m.data;
      else if (m.type === 0x0b) info.filters = this.parseFilters(c);
      else if (m.type === 0x05) info.fill = this.parseFill(c);
      else if (m.type === 0x04 && !info.fill) {
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
    const m = messages.find((x) => x.type === 0x03);
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
    if (flags & 0x20) {
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
      const rank = c.u8();
      const address = c.addr();
      const dims = [];
      for (let i = 0; i < rank; i++) dims.push(c.u32());
      return { kind: "chunked", index: "btree1", address, chunk: dims.slice(0, -1) };
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
    if (n * size > MAX_READ_BYTES) throw new Hdf5Error(`That's ${Math.round((n * size) / 1e6)} MB; ask for a smaller slice.`);
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
    if (address === UNDEFINED) return; // never written: the fill value stands
    const dims = info.space.dims;
    const size = info.type.size;
    if (dims.length === 0) {
      (await this.read(address, size)).copy(out, 0);
      return;
    }
    // One run per row of the last dimension, merged when the gaps between them are small.
    const runs = [];
    const strides = dims.map((_, i) => product(dims.slice(i + 1)));
    const last = dims.length - 1;
    const runLength = count[last] * size;
    const outer = count.slice(0, last);
    const index = outer.map(() => 0);
    let outAt = 0;
    for (;;) {
      let element = start[last];
      for (let i = 0; i < last; i++) element += (start[i] + index[i]) * strides[i];
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
      // Edge chunks can be stored unfiltered when the file asks for it.
      const partial = c.offset.some((o, i) => o + chunk[i] > dims[i]);
      const mask = info.layout.dontFilterPartial && partial ? 0xffffffff : c.mask;
      bytes = this.unfilter(bytes, info.filters, mask, chunkBytes, size);
      copyBlock(bytes, chunk, out, start, count, c.offset, dims, size);
    });
    await runLimited(work, 6);
  }

  unfilter(bytes, filters, mask, expected, elementSize) {
    for (let i = filters.length - 1; i >= 0; i--) {
      if (mask & (1 << i)) continue;
      const f = filters[i];
      if (f.id === 1) {
        try {
          // A chunk never inflates past its own size (plus a checksum), so anything bigger is refused.
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
        // Very old files stored the checksum with its bytes swapped; HDF5 accepts both.
        const swapped = ((sum & 0xff) << 24) | ((sum & 0xff00) << 8) | ((sum >>> 8) & 0xff00) | (sum >>> 24);
        if (stored !== sum && stored !== swapped >>> 0) throw new Hdf5Error("A chunk's checksum doesn't match; the file is damaged.");
        bytes = data;
      }
      else if (!f.optional) throw new Hdf5Error(`This dataset is stored with the ${f.name} filter, which brainhound can't undo yet. Only gzip, shuffle and fletcher32 are supported.`);
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
    // Never written: no chunks, so the fill value stands.
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
    do wanted.push(at.slice());
    while (step(at, first, lastChunk));
    // Implicit, fixed and extensible indexes number chunks row-major over the maximum dimensions,
    // with an unlimited dimension moved to the front.
    const maxdims = space.maxdims.map((m, i) => (m === UNDEFINED ? dims[i] : m));
    const unlimited = space.maxdims.findIndex((m) => m === UNDEFINED);
    const order = unlimited > 0 ? [unlimited, ...dims.map((_, i) => i).filter((i) => i !== unlimited)] : dims.map((_, i) => i);
    const maxGrid = order.map((i) => Math.ceil(maxdims[i] / chunk[i]));
    const down = maxGrid.map((_, i) => product(maxGrid.slice(i + 1)));
    const linearOf = (scaled) => order.reduce((sum, dim, k) => sum + scaled[dim] * down[k], 0);
    if (layout.index === "implicit") {
      return wanted.map((scaled) => ({ offset: scaled.map((s, i) => s * chunk[i]), address: layout.address + linearOf(scaled) * raw, size: raw, mask: 0 }));
    }
    const filtered = filters.length > 0;
    const lookup =
      layout.index === "fixed"
        ? await this.fixedArray(layout.address, filtered)
        : layout.index === "extensible"
          ? await this.extensibleArray(layout.address, filtered)
          : await this.btree2Chunks(layout.address, dims.length, filtered);
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
    const seen = new Set();
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
      if (type !== 1 || (expected >= 0 && level !== expected)) throw new Hdf5Error("A dataset's chunk index is damaged.");
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
          // Children are in order of their first coordinate, so skip any that end before the slice or start after it.
          const lo = keys[i].offset[0];
          const hi = i + 1 < used ? keys[i + 1].offset[0] + chunk[0] : Infinity;
          if (rank === 0 || (lo < start[0] + count[0] && hi > start[0])) await visit(children[i], level - 1);
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
      const page = Math.floor(i / pageSize);
      const at = dataBlock + prefix + page * (pageSize * entrySize + 4) + (i % pageSize) * entrySize;
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
    // The layout of super blocks follows from the header's parameters, as in the format spec.
    const superBlocks = 1 + maxBits - Math.log2(dataBlockMin);
    const info = [];
    let startIndex = 0;
    let startBlock = 0;
    for (let s = 0; s < superBlocks; s++) {
      const blocks = 2 ** Math.floor(s / 2);
      const elements = 2 ** Math.ceil(s / 2) * dataBlockMin;
      info.push({ blocks, elements, startIndex, startBlock });
      startIndex += blocks * elements;
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
    const readFromDataBlock = async (blockAddress, elements, within) => {
      if (blockAddress === UNDEFINED) return null;
      if (elements > 2 ** pageBits) throw new Hdf5Error("This dataset's chunk index is too large for brainhound to read yet.");
      const prefix = 4 + 2 + this.offsetSize + blockOffsetBytes;
      return readEntry(this.cursor(await this.read(blockAddress + prefix + within * entrySize, entrySize)));
    };
    return async (i) => {
      if (i < indexElements) return inIndex[i];
      const j = i - indexElements;
      const s = info.findIndex((x) => j >= x.startIndex && j < x.startIndex + x.blocks * x.elements);
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
    const map = new Map();
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
}

/** Copies the overlap of a chunk (at `offset`, shaped `chunk`) into the output block (at `start`, shaped `count`). */
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

/** Moves a multi-dimensional index one step through the box from `lo` to `hi` (inclusive); false when done. */
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

/** HDF5's Fletcher-32 checksum, over 16-bit big-endian words, as in its H5_checksum_fletcher32. */
export function fletcher32(data) {
  let sum1 = 0;
  let sum2 = 0;
  let i = 0;
  let words = data.length >> 1;
  while (words) {
    let block = words > 360 ? 360 : words;
    words -= block;
    do {
      sum1 += (data[i] << 8) | data[i + 1];
      i += 2;
      sum2 += sum1;
    } while (--block);
    sum1 = (sum1 & 0xffff) + (sum1 >>> 16);
    sum2 = (sum2 & 0xffff) + (sum2 >>> 16);
  }
  if (data.length & 1) {
    sum1 += data[i] << 8;
    sum2 += sum1;
    sum1 = (sum1 & 0xffff) + (sum1 >>> 16);
    sum2 = (sum2 & 0xffff) + (sum2 >>> 16);
  }
  sum1 = (sum1 & 0xffff) + (sum1 >>> 16);
  sum2 = (sum2 & 0xffff) + (sum2 >>> 16);
  return ((sum2 << 16) | sum1) >>> 0;
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

/** Nests a flat row-major array into the given shape. */
export function reshape(values, shape) {
  if (shape.length <= 1) return values;
  const inner = product(shape.slice(1));
  const out = [];
  for (let i = 0; i < shape[0]; i++) out.push(reshape(values.slice(i * inner, (i + 1) * inner), shape.slice(1)));
  return out;
}
