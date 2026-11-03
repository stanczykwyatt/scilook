// The preview page, built in Node from the shared test files, the same way Quick Look builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { inflateRawSync, inflateSync, deflateRawSync, deflateSync } from "node:zlib";
import { preview, plan, png, formatBytes } from "../src/summary.js";
import { inflateRaw, inflateZlib } from "../src/inflate.js";
import { LiteBuffer, LiteDecoder } from "../src/shims.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const source = (name, log = []) => {
  const bytes = readFileSync(fixture(name));
  return { name, size: bytes.length, read: async (o, l) => (log.push(l), new Uint8Array(bytes.subarray(o, o + l))) };
};

test("NWB: facts, the tree and a plot of the recorded data", async () => {
  for (const name of ["earliest.nwb", "latest.nwb"]) {
    const html = await preview(source(name));
    assert.match(html, /NWB \(HDF5\) · \d+ KB/);
    assert.match(html, /<dt>Session<\/dt><dd>Made-up session for tests<\/dd>/);
    assert.match(html, /<dt>Subject<\/dt><dd>species: Mus musculus, subject id: mouse-7, age: P90D, sex: F<\/dd>/);
    assert.match(html, /<h2>\/acquisition\/ElectricalSeries\/data<\/h2>/);
    assert.match(html, /20000 × 4 · the first 1500 of 20000 · unit: volts/);
    assert.match(html, /<svg viewBox="0 0 640 220"/);
    assert.match(html, /trace_39/);
    assert.match(html, />units<\/span>/);
  }
});

test("HDF5 is read lazily: a preview touches a small part of the file", async () => {
  const log = [];
  await preview(source("earliest.nwb", log));
  const total = statSync(fixture("earliest.nwb")).size;
  assert.ok(log.reduce((a, b) => a + b, 0) < total * 2, "reads are bounded");
  assert.ok(Math.max(...log) < total, "never the whole file at once");
});

test("MATLAB v5 and v7.3, NumPy .npy and .npz", async () => {
  const mat = await preview(source("session-compressed.mat"));
  assert.match(mat, /MATLAB 5\.0 MAT-file/);
  assert.match(mat, /<dt>Header<\/dt><dd>MATLAB 5\.0 MAT-file/);
  assert.match(mat, />info<\/span><\/td><td>struct/);
  assert.match(mat, />rate<\/span><\/td><td>1 × 1 float64/);
  const v73 = await preview(source("v73.mat"));
  assert.match(v73, /MATLAB v7\.3 \(HDF5\)/);
  assert.match(v73, />x<\/span><\/td><td>2 × 3 float64/);
  const npy = await preview(source("grid.npy"));
  assert.match(npy, /NumPy \.npy/);
  assert.match(npy, /2 × 3 × 4 float64/);
  const npz = await preview(source("bundle-compressed.npz"));
  assert.match(npz, />labels<\/span><\/td><td>3 uint8/);
});

test("images: 2-D grids and stacks become a heatmap PNG", async () => {
  assert.deepEqual(plan([10, 128, 128]).kind, "image");
  assert.deepEqual(plan([64, 64]).kind, "image");
  assert.deepEqual(plan([20000, 4]).kind, "lines");
  assert.deepEqual(plan([5000]).count, [1500]);
  const image = png(2, 1, new Uint8Array([255, 0, 0, 0, 0, 255]));
  assert.deepEqual(Array.from(image.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const html = await preview(source("latest.nwb"));
  assert.ok(html.length < 60_000, `${html.length} characters`);
});

test("pickled NumPy objects and unknown files are explained, never loaded", async () => {
  assert.match(await preview(source("objects.npy")), /never loads those/);
  const junk = { name: "notes.txt", size: 12, read: async () => new TextEncoder().encode("hello, world") };
  assert.match(await preview(junk), /doesn&#39;t recognize this file/);
});

test("text from files is escaped, so a file can't put markup in the preview", async () => {
  const evil = { name: "<script>x</script>.npy", size: 12, read: async () => new TextEncoder().encode("hello, world") };
  const html = await preview(evil);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;\.npy/);
});

test("the small inflate matches zlib, and stops at its limit", () => {
  const data = readFileSync(fixture("session.mat"));
  for (const level of [0, 1, 9]) {
    assert.deepEqual(Buffer.from(inflateRaw(deflateRawSync(data, { level }))), data);
    assert.deepEqual(Buffer.from(inflateZlib(deflateSync(data, { level }))), data);
  }
  assert.throws(() => inflateRaw(deflateRawSync(Buffer.alloc(1e6)), 1000), /more than its stated size/);
  assert.throws(() => inflateZlib(new Uint8Array([1, 2, 3])), /damaged/);
  assert.ok(inflateRawSync && inflateSync);
});

test("the Buffer and TextDecoder stand-ins behave like Node's", () => {
  const b = LiteBuffer.from(new Uint8Array([1, 0, 0, 0, 0xc3, 0xa9, 0, 0x41]));
  assert.equal(b.readUInt32LE(0), 1);
  assert.equal(b.readUInt32BE(0), 0x01000000);
  assert.equal(b.toString("utf8", 4, 6), "é");
  assert.equal(b.toString("latin1", 7, 8), "A");
  assert.equal(b.subarray(4).indexOf(0), 2);
  const target = LiteBuffer.alloc(3);
  b.copy(target, 1, 6, 8);
  assert.deepEqual(Array.from(target), [0, 0, 0x41]);
  assert.equal(new LiteDecoder().decode(new Uint8Array([0xe6, 0xb5, 0xb7, 0xff])), "海�");
  assert.equal(formatBytes(309175), "309 KB");
});
