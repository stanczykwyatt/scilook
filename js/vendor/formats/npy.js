// NumPy's .npy format (version 1 to 3), and .npz archives of them. Object arrays are refused:
// reading them would mean unpickling, which can run code.
import { FormatError, dataset, group, join, readNumbers, select, toRowMajor, product } from "./tree.js";
import { readZip } from "./zip.js";

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

export const isNpy = (bytes) => MAGIC.every((b, i) => bytes[i] === b);

/** Reads the header: dtype, shape, memory order, and where the data starts. */
export function parseNpyHeader(bytes) {
  if (!isNpy(bytes)) throw new FormatError("This isn't a .npy file.");
  const major = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const start = major === 1 ? 10 : 12;
  const text = new TextDecoder(major >= 3 ? "utf-8" : "latin1").decode(bytes.subarray(start, start + headerLength));
  const descr = /'descr':\s*'([^']+)'/.exec(text)?.[1];
  const fortran = /'fortran_order':\s*True/.test(text);
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(text)?.[1];
  if (!descr || shapeText === undefined) {
    if (/'descr':\s*\[/.test(text)) throw new FormatError("Structured NumPy arrays (with named fields) aren't supported yet.");
    throw new FormatError("This .npy header can't be read; the file may be damaged.");
  }
  // Files from Python 2 write long integers with an L, like (3L,).
  const shape = shapeText.split(",").map((s) => s.trim().replace(/L$/, "")).filter(Boolean).map(Number);
  if (shape.some((d) => !Number.isInteger(d) || d < 0)) throw new FormatError("This .npy file has an odd shape; it may be damaged.");
  return { dtype: parseDescr(descr), shape, fortran, dataOffset: start + headerLength };
}

export function parseDescr(descr) {
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
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/** Decodes all of an array's values in row-major order. */
export function decodeValues(bytes, offset, count, dtype) {
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

/** A dataset node for one .npy file's bytes. */
export function npyDataset(name, path, bytes) {
  const { dtype, shape, fortran, dataOffset } = parseNpyHeader(bytes);
  let cache;
  const all = () => {
    if (!cache) {
      const values = decodeValues(bytes, dataOffset, product(shape), dtype);
      cache = fortran ? toRowMajor(values, shape) : values;
    }
    return cache;
  };
  return dataset(name, path, { shape, dtype, attrs: fortran ? { memory_order: "Fortran (column-major)" } : {}, read: async (selection) => select(all(), shape, selection) });
}

/** A group for an .npz archive: one dataset per array inside. */
export async function npzGroup(name, bytes, inflateRaw) {
  const entries = readZip(bytes);
  const children = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".npy")) continue;
    const childName = entry.name.slice(0, -4).replace(/\//g, "_");
    children.push(npyDataset(childName, join("/", childName), await entry.read(inflateRaw)));
  }
  if (!children.length) throw new FormatError("This .npz archive has no arrays in it.");
  return group(name, "/", children, { format: entry0Note(entries) });
}

const entry0Note = (entries) => (entries.some((e) => e.method === 8) ? "NumPy .npz (compressed)" : "NumPy .npz");

/** A group holding a single .npy dataset at the top. */
export function npyGroup(name, bytes) {
  return group(name, "/", [npyDataset(name.replace(/\.npy$/i, ""), join("/", name.replace(/\.npy$/i, "")), bytes)], { format: "NumPy .npy" });
}
