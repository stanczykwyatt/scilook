// MATLAB's Level 5 MAT-file format (what save writes before -v7.3): numeric, logical and char
// arrays, structs, cell arrays, complex numbers and sparse matrices, compressed or not. Written
// from MathWorks' published MAT-file format document. MATLAB stores arrays column by column; they
// are reordered to row-major here, keeping MATLAB's dimensions.
import { FormatError, dataset, group, join, readNumbers, select, toRowMajor, product } from "./tree.js";

const TYPES = {
  1: { class: "int", size: 1 },
  2: { class: "uint", size: 1 },
  3: { class: "int", size: 2 },
  4: { class: "uint", size: 2 },
  5: { class: "int", size: 4 },
  6: { class: "uint", size: 4 },
  7: { class: "float", size: 4 },
  9: { class: "float", size: 8 },
  12: { class: "int", size: 8 },
  13: { class: "uint", size: 8 },
};
const MATRIX = 14;
const COMPRESSED = 15;
const UTF8 = 16;
const UTF16 = 17;
const UTF32 = 18;

// mxClass ids for numeric arrays, and the dtype values are converted to.
const CLASSES = {
  6: { class: "float", size: 8, name: "double" },
  7: { class: "float", size: 4, name: "single" },
  8: { class: "int", size: 1, name: "int8" },
  9: { class: "uint", size: 1, name: "uint8" },
  10: { class: "int", size: 2, name: "int16" },
  11: { class: "uint", size: 2, name: "uint16" },
  12: { class: "int", size: 4, name: "int32" },
  13: { class: "uint", size: 4, name: "uint32" },
  14: { class: "int", size: 8, name: "int64" },
  15: { class: "uint", size: 8, name: "uint64" },
};

export const isMat5 = (bytes) => bytes.length >= 128 && new TextDecoder("latin1").decode(bytes.subarray(0, 10)) === "MATLAB 5.0";

/**
 * Parses a whole MAT-file into a group with one child per variable. `inflate` unpacks zlib data
 * (Node's inflateSync, or the browser's DecompressionStream), and may be async.
 */
export async function parseMat5(name, bytes, inflate) {
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

const pad8 = (n) => Math.ceil(n / 8) * 8;

function readTag(bytes, at, little) {
  if (at + 8 > bytes.length) throw new FormatError("A MAT-file element is cut short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, 8);
  const first = view.getUint32(0, little);
  // Small elements pack their type and size into one word, with the data in the next four bytes.
  if (first >>> 16 !== 0) return { type: first & 0xffff, size: first >>> 16, dataStart: 4, small: true };
  return { type: first, size: view.getUint32(4, little), dataStart: 8 };
}

/** Reads the sub-elements of a matrix, in order. */
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
  // One byte per character: decode byte for byte, so positions stay where MATLAB put them.
  if (element.type === 1 || element.type === 2) return new TextDecoder("latin1").decode(element.bytes);
  const codes = element.type === UTF16 || element.type === 4 ? numbers({ ...element, type: 4 }, little) : element.type === UTF32 ? numbers({ ...element, type: 6 }, little) : numbers(element, little);
  return Array.from(codes, (c) => String.fromCodePoint(Number(c))).join("");
}

/** Converts values to the array's own class, since MATLAB may store doubles as smaller integers. */
function toClass(values, cls) {
  const Type = { float: cls.size === 4 ? Float32Array : Float64Array, int: { 1: Int8Array, 2: Int16Array, 4: Int32Array, 8: BigInt64Array }[cls.size], uint: { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array, 8: BigUint64Array }[cls.size] }[cls.class];
  if (values instanceof Type) return values;
  const big = Type === BigInt64Array || Type === BigUint64Array;
  return Type.from(values, (v) => (big ? BigInt(v) : Number(v)));
}

function readMatrix(data, little, parentPath, forcedName, budget) {
  if (++budget.elements > 1_000_000) throw new FormatError("This MAT-file nests too many arrays; it may be damaged.");
  if (data.length === 0) return group(forcedName ?? "(empty)", join(parentPath, forcedName ?? "(empty)"));
  const parts = elements(data, little);
  const flagsEl = parts.next().value;
  const flagWords = numbers(flagsEl, little);
  const cls = flagWords[0] & 0xff;
  const complex = Boolean(flagWords[0] & 0x800);
  const logical = Boolean(flagWords[0] & 0x200);
  const dims = Array.from(numbers(parts.next().value, little), Number);
  if (dims.some((d) => !Number.isInteger(d) || d < 0)) throw new FormatError("A MAT-file array has an impossible size; the file may be damaged.");
  // Every stored value count is checked against this before anything is built from it.
  const count = (values, what) => {
    if (values.length !== product(dims)) throw new FormatError(`${what} holds ${values.length} values but its size says ${product(dims)}; the file may be damaged.`);
    return values;
  };
  const rawName = text(parts.next().value, little);
  const name = forcedName ?? (rawName || "(unnamed)");
  const path = join(parentPath, name);
  const n = product(dims);

  if (CLASSES[cls]) {
    const real = parts.next().value;
    const imag = complex ? parts.next().value : null;
    const c = CLASSES[cls];
    const attrs = { matlab_class: logical ? "logical" : c.name };
    if (complex) {
      const re = Array.from(count(numbers(real, little), name), Number);
      const im = Array.from(count(numbers(imag, little), name), Number);
      const values = toRowMajor(re.map((r, i) => [r, im[i]]), dims);
      // Values are already plain numbers, so the parts are shown as doubles whatever the class.
      return dataset(name, path, { shape: dims, dtype: { class: "complex", size: 16 }, attrs, read: async (s) => select(values, dims, s) });
    }
    const values = toRowMajor(toClass(count(numbers(real, little), name), c), dims);
    const dtype = logical ? { class: "bool", size: 1 } : { class: c.class, size: c.size };
    const out = logical ? Uint8Array.from(values, (v) => (v ? 1 : 0)) : values;
    return dataset(name, path, { shape: dims, dtype, attrs, read: async (s) => select(out, dims, s) });
  }
  if (cls === 4) {
    // char: rows of text. Column-major, so row r is every rows-th character starting at r.
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
    // cell: each element is a matrix of its own, named by its MATLAB index.
    const children = [];
    for (let i = 0; i < n; i++) children.push(readMatrix(parts.next().value.bytes, little, path, `{${i + 1}}`, budget));
    return group(name, path, children, { matlab_class: "cell", size: dims.join("x") });
  }
  if (cls === 2 || cls === 3) {
    if (cls === 3) parts.next(); // the object's class name
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
    // sparse: row indices, column starts and values, kept as they are.
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
      note: "Stored as MATLAB keeps it: values with 0-based row indices, and where each column starts.",
    });
  }
  return group(name, path, [], { matlab_class: { 16: "function handle", 17: "opaque" }[cls] ?? `class ${cls}`, note: "dropslice can't show this kind of MATLAB value yet." });
}
