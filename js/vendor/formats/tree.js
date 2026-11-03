// The shape every format is turned into: groups that hold children, and datasets that can read a
// slice of themselves. It has nothing to do with the browser, so it runs in Node for the tests and
// is shared with SciLook.
//
//   group:   { kind: "group", name, path, attrs, children: [...] }
//   dataset: { kind: "dataset", name, path, attrs, shape, dtype, read(selection) }
//
// A dtype is { class: "int" | "uint" | "float" | "bool" | "complex" | "string", size, littleEndian }.
// A selection has one entry per dimension: an index to fix that dimension, or null to keep all of it.

export class FormatError extends Error {
  name = "FormatError";
}

export const product = (a) => a.reduce((x, y) => x * y, 1);

export function group(name, path, children = [], attrs = {}) {
  return { kind: "group", name, path, attrs, children };
}

export function dataset(name, path, { shape, dtype, attrs = {}, read }) {
  return { kind: "dataset", name, path, attrs, shape, dtype, read };
}

/** Joins a parent path and a child name the way HDF5 paths read: /a/b. */
export const join = (parent, name) => (parent === "/" ? `/${name}` : `${parent}/${name}`);

/** Finds a node by path. */
export function find(root, path) {
  if (!path || path === "/") return root;
  let node = root;
  for (const part of path.split("/").filter(Boolean)) {
    node = node.kind === "group" ? node.children.find((c) => c.name === part) : undefined;
    if (!node) return undefined;
  }
  return node;
}

/**
 * Picks a selection out of row-major values: fixed dimensions drop out, kept ones stay whole.
 * Works on typed arrays and plain arrays alike.
 */
export function select(values, shape, selection) {
  if (!selection || selection.every((s) => s === null || s === undefined)) return { shape, values };
  if (selection.length !== shape.length) throw new FormatError(`This has ${shape.length} dimensions; the selection has ${selection.length}.`);
  selection.forEach((s, i) => {
    if (s !== null && s !== undefined && (!Number.isInteger(s) || s < 0 || s >= shape[i])) throw new FormatError(`Index ${s} is outside dimension ${i}, which has ${shape[i]} entries.`);
  });
  const strides = shape.map((_, i) => product(shape.slice(i + 1)));
  const kept = shape.map((_, i) => i).filter((i) => selection[i] === null || selection[i] === undefined);
  const outShape = kept.map((i) => shape[i]);
  const n = product(outShape);
  const out = ArrayBuffer.isView(values) ? new values.constructor(n) : new Array(n);
  let base = 0;
  selection.forEach((s, i) => {
    if (s !== null && s !== undefined) base += s * strides[i];
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

/** Reorders column-major (Fortran, MATLAB) values into row-major order for the same shape. */
export function toRowMajor(values, shape) {
  if (shape.length < 2) return values;
  const n = product(shape);
  const out = ArrayBuffer.isView(values) ? new values.constructor(n) : new Array(n);
  const index = shape.map(() => 0);
  const colStrides = shape.map((_, i) => product(shape.slice(0, i)));
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

/** Parses h5web's selection text, like "0,:,:", into [0, null, null]. */
export function parseSelection(text, rank) {
  if (!text) return Array(rank).fill(null);
  const parts = String(text).split(",");
  return parts.map((p) => (p.trim() === ":" ? null : Number(p)));
}

/** Typed array constructors for numeric dtypes. */
export function arrayFor(dtype) {
  const { class: c, size } = dtype;
  if (c === "float") return size === 4 ? Float32Array : size === 8 ? Float64Array : null;
  if (c === "int") return { 1: Int8Array, 2: Int16Array, 4: Int32Array, 8: BigInt64Array }[size] ?? null;
  if (c === "uint" || c === "bool") return { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array, 8: BigUint64Array }[size] ?? null;
  return null;
}

/** Reads `count` numbers from bytes into a typed array, swapping byte order when needed. */
export function readNumbers(bytes, offset, count, dtype) {
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
