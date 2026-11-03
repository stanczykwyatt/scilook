// Builds the Quick Look preview: one self-contained HTML page with the file's structure, its NWB
// facts when it's an NWB file, and a plot of one array. It reads through `read(offset, length)`,
// so only the bytes needed are touched; Quick Look supplies that, and so do the tests.
import "./install.js";
import { inflateRaw, inflateZlib } from "./inflate.js";
import { Hdf5File, describeType } from "../vendor/hdf5/hdf5.js";
import { sniff } from "../vendor/formats/detect.js";
import { npyGroup, npzGroup, parseNpyHeader } from "../vendor/formats/npy.js";
import { parseMat5 } from "../vendor/formats/mat5.js";


// Formats read whole are previewed only up to this size; HDF5 is read lazily at any size.
export const WHOLE_LIMIT = 256 * 1024 * 1024;
const ENTRY_LIMIT = 300;
const POINTS = 1500;
const IMAGE = 160;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const product = (a) => a.reduce((x, y) => x * y, 1);

export function formatBytes(n) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) (v /= 1000), i++;
  return i === 0 ? `${v} bytes` : `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function show(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const items = Array.from(v).slice(0, 8).map(show);
    return `[${items.join(", ")}${v.length > 8 ? ", …" : ""}]`;
  }
  if (v.ref) return `→ ${v.ref}`;
  return JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)).slice(0, 200);
}

// ---------------------------------------------------------------------------------------------
// Turning each format into rows: { depth, name, kind, detail, note, plot }

async function hdf5Rows(file) {
  const rows = [];
  const candidates = [];
  let budget = ENTRY_LIMIT;
  const walk = async (address, path, depth) => {
    for (const link of await file.links(address)) {
      if (budget-- <= 0) return;
      const child = path === "/" ? `/${link.name}` : `${path}/${link.name}`;
      if (link.address === undefined) {
        rows.push({ depth, name: link.name, kind: "link", detail: link.soft ? `→ ${link.soft}` : "→ another file" });
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
      rows.push({ depth, name: link.name, kind: "dataset", detail: `${info.space.kind === "null" ? "empty" : dims.length ? dims.join(" × ") : "scalar"} ${describeType(info.type)}`, note: [type, unit ? `unit: ${show(unit)}` : ""].filter(Boolean).join(" · ") });
      if ((info.type.kind === "int" || info.type.kind === "float") && dims.length >= 1 && dims.length <= 3 && product(dims) >= 8) candidates.push({ path: child, dims, info, unit });
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
      if (node.kind !== "dataset") return undefined;
      const info = await file.dataset(node.address);
      if (product(info.space.dims) > 20) return undefined;
      const { values } = await file.readSlice(info);
      return values.length === 1 ? values[0] : values;
    } catch {
      return undefined;
    }
  };
  const facts = [
    ["NWB version", root.nwb_version],
    ["Session", await scalar("/session_description")],
    ["Started", await scalar("/session_start_time")],
    ["Identifier", await scalar("/identifier")],
    ["Lab", await scalar("/general/lab")],
    ["Institution", await scalar("/general/institution")],
  ];
  const subject = [];
  for (const k of ["species", "subject_id", "age", "sex", "genotype"]) {
    const v = await scalar(`/general/subject/${k}`);
    if (v !== undefined) subject.push(`${k.replace("_", " ")}: ${show(v)}`);
  }
  if (subject.length) facts.push(["Subject", subject.join(", ")]);
  return facts.filter(([, v]) => v !== undefined && v !== "");
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
      rows.push({ depth, name: child.name, kind: "dataset", detail: `${child.shape.length ? child.shape.join(" × ") : "scalar"} ${type}`, note: child.attrs?.matlab_class && child.attrs.matlab_class !== type ? child.attrs.matlab_class : "" });
      if (["int", "uint", "float", "float16", "bool"].includes(dtype.class) && child.shape.length >= 1 && child.shape.length <= 3 && product(child.shape) >= 8) candidates.push({ node: child, dims: child.shape });
    }
  }
  return { rows, candidates };
}

// ---------------------------------------------------------------------------------------------
// The plot

/** Picks the array most worth plotting: recorded data first, then the largest. */
function pick(candidates) {
  const score = (c) => (/^\/acquisition\//.test(c.path ?? "") ? 3 : /\/data$/.test(c.path ?? "") ? 2 : 1) * 1e12 + product(c.dims);
  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

/** How to show an array: an image when it's a 2-D grid or a stack of them, lines otherwise. */
export function plan(dims) {
  if (dims.length === 3) return { kind: "image", start: [0, 0, 0], count: [1, Math.min(dims[1], 1024), Math.min(dims[2], 1024)], rows: Math.min(dims[1], 1024), cols: Math.min(dims[2], 1024), note: `the first of ${dims[0]} slices` };
  if (dims.length === 2 && dims[0] >= 16 && dims[1] >= 16) return { kind: "image", start: [0, 0], count: [Math.min(dims[0], 1024), Math.min(dims[1], 1024)], rows: Math.min(dims[0], 1024), cols: Math.min(dims[1], 1024) };
  const n = Math.min(dims[0], POINTS);
  const lines = dims.length === 2 ? Math.min(dims[1], 4) : 1;
  return { kind: "lines", start: dims.map(() => 0), count: dims.length === 2 ? [n, lines] : [n], n, lines, note: dims[0] > n ? `the first ${n} of ${dims[0]}` : "" };
}

/** The row-major block at `start` of size `count`, out of a whole array shaped `dims`. */
export function block(values, dims, start, count) {
  const strides = dims.map((_, i) => product(dims.slice(i + 1)));
  const n = product(count);
  const out = new Array(n);
  const index = count.map(() => 0);
  for (let k = 0; k < n; k++) {
    let at = 0;
    for (let d = 0; d < dims.length; d++) at += (start[d] + index[d]) * strides[d];
    out[k] = values[at];
    for (let d = count.length - 1; d >= 0; d--) {
      if (++index[d] < count[d]) break;
      index[d] = 0;
    }
  }
  return out;
}

const num = (v) => (typeof v === "bigint" ? Number(v) : typeof v === "boolean" ? Number(v) : Number(v));

function linesSvg(values, p) {
  const W = 640;
  const H = 220;
  // A loop, not Math.min(...values): spreading a big array overflows the stack.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = num(values[i]);
    if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  }
  if (!Number.isFinite(lo)) return "";
  if (lo === hi) (lo -= 1), (hi += 1);
  const colors = ["#3b6fb6", "#69aee0", "#9b7fd1", "#3aa39a"];
  let paths = "";
  for (let l = 0; l < p.lines; l++) {
    let d = "";
    // About one point per pixel is all a 640-wide plot can show.
    const stride = Math.max(1, Math.floor(p.n / W));
    for (let i = 0; i < p.n; i += stride) {
      const v = num(values[i * p.lines + l]);
      if (!Number.isFinite(v)) continue;
      const x = (i / Math.max(p.n - 1, 1)) * W;
      const y = H - ((v - lo) / (hi - lo)) * H;
      d += `${d ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    paths += `<path d="${d}" fill="none" stroke="${colors[l]}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="plot" role="img" aria-label="Line plot">${paths}</svg><div class="range"><span>min ${esc(show(lo))}</span><span>max ${esc(show(hi))}</span></div>`;
}

// A viridis-like ramp from dark blue to yellow, by a few stops.
const RAMP = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];
function color(t) {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const f = x - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG with uncompressed (stored) data: simple, and small enough at preview size. */
export function png(width, height, rgb) {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const blocks = [];
  for (let i = 0; i < raw.length; i += 65535) {
    const piece = raw.subarray(i, i + 65535);
    const head = new Uint8Array([i + 65535 >= raw.length ? 1 : 0, piece.length & 0xff, piece.length >> 8, ~piece.length & 0xff, (~piece.length >> 8) & 0xff]);
    blocks.push(head, piece);
  }
  let a = 1;
  let b = 0;
  for (const v of raw) (a = (a + v) % 65521), (b = (b + a) % 65521);
  const zlib = concat([new Uint8Array([0x78, 0x01]), ...blocks, u32(((b << 16) | a) >>> 0)]);
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
const u32 = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
function concat(list) {
  const out = new Uint8Array(list.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of list) out.set(x, at), (at += x.length);
  return out;
}
function base64(bytes) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? abc[n & 63] : "=");
  }
  return s;
}

function imageHtml(values, p) {
  const step = Math.max(1, Math.ceil(Math.max(p.rows, p.cols) / IMAGE));
  const h = Math.ceil(p.rows / step);
  const w = Math.ceil(p.cols / step);
  const picked = new Float64Array(w * h);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = num(values[y * step * p.cols + x * step]);
      picked[y * w + x] = v;
      if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
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
    return `<section class="card"><h2>${esc(c.path ?? c.node.path)}</h2><p class="muted">${esc([`${c.dims.join(" × ")}`, p.note, c.unit ? `unit: ${show(c.unit)}` : ""].filter(Boolean).join(" · "))}</p>${body}</section>`;
  } catch (e) {
    return `<section class="card"><p class="muted">Couldn't plot ${esc(c.path ?? c.node.path)}: ${esc(e.message)}</p></section>`;
  }
}

// ---------------------------------------------------------------------------------------------
// The page

const STYLE = `
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
  const table = rows?.length
    ? `<section class="card"><table>${rows
        .map((r) => `<tr><td class="name" style="padding-left:${r.depth * 16}px"><span class="${r.kind === "group" ? "group" : ""}">${esc(r.name)}</span></td><td>${esc(r.detail ?? "")}</td><td class="note">${esc(r.note ?? "")}</td></tr>`)
        .join("")}</table>${truncated ? `<p class="muted">Showing the first ${ENTRY_LIMIT} entries.</p>` : ""}</section>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p>${message ? `<section class="card"><p>${esc(message)}</p></section>` : ""}${factHtml}${plot ?? ""}${table}</body></html>`;
}

/**
 * Makes the preview page for a file. `source` is { name, size, read(offset, length) } where read
 * returns (a promise of) a Uint8Array.
 */
export async function preview(source) {
  const { name, size } = source;
  const read = async (offset, length) => Buffer.from(await source.read(offset, length));
  const head = await read(0, Math.min(size, 4096));
  const kind = sniff(head);
  const sub = (label) => `${label} · ${formatBytes(size)}`;
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
          return page({ title: name, subtitle: sub("NumPy .npy"), facts: [["Shape", h.shape.join(" × ") || "scalar"], ["Type", `${h.dtype.class}${h.dtype.size * 8}`], ["Order", h.fortran ? "Fortran (column-major)" : "C (row-major)"]], message: "This file is too big to plot in a preview." });
        }
        return page({ title: name, subtitle: sub(kind === "npz" ? "NumPy .npz" : "MATLAB 5.0 MAT-file"), message: "This file is too big to read in a preview. Open it in dropslice or Python to see inside." });
      }
      // Read whole without an extra copy, and give every compressed piece one shared budget, so
      // many small entries can't each unpack to the limit.
      const bytes = new Uint8Array(await source.read(0, size));
      let budget = WHOLE_LIMIT;
      const spend = (out) => {
        budget -= out.length;
        if (budget < 0) throw new Error("This file unpacks to more than a preview will read.");
        return out;
      };
      const tree =
        kind === "npy"
          ? npyGroup(name, bytes)
          : kind === "npz"
            ? await npzGroup(name, bytes, async (b, n) => spend(inflateRaw(b, Math.min(n ?? budget, budget))))
            : await parseMat5(name, bytes, async (b) => spend(inflateZlib(b, budget)));
      const { rows, candidates } = treeRows(tree);
      const facts = kind === "mat5" && tree.attrs.header ? [["Header", tree.attrs.header]] : null;
      // Cut the planned block out of the whole array, so the layout matches an HDF5 slice.
      const plot = await plotHtml(pick(candidates.map((c) => ({ ...c, path: c.node.path }))), async (c, p) => block((await c.node.read(null)).values, c.dims, p.start, p.count));
      return page({ title: name, subtitle: sub(kind === "npy" ? "NumPy .npy" : kind === "npz" ? "NumPy .npz" : "MATLAB 5.0 MAT-file"), facts, plot, rows });
    }
    return page({ title: name, subtitle: sub("Unknown format"), message: "SciLook doesn't recognize this file. It previews NWB, HDF5, MATLAB .mat and NumPy .npy and .npz files." });
  } catch (e) {
    return page({ title: name, subtitle: sub("Couldn't read"), message: `This file couldn't be read: ${e?.message ?? e}` });
  }
}
