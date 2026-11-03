// Just enough of the ZIP format to read .npz archives: the central directory, and stored or
// deflated entries. Inflating is passed in, so Node and the browser can each use their own.
import { FormatError } from "./tree.js";

export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 KB plus 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new FormatError("This isn't a ZIP archive, or it's cut short.");
  let count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  // ZIP64 archives (over 4 GB, or many entries) keep the real numbers in another record.
  if (count === 0xffff || at === 0xffffffff || view.getUint32(end + 12, true) === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) throw new FormatError("This ZIP archive is damaged.");
    const record = Number(view.getBigUint64(locator + 8, true));
    if (record + 56 > bytes.length || view.getUint32(record, true) !== 0x06064b50) throw new FormatError("This ZIP archive is damaged.");
    count = Number(view.getBigUint64(record + 32, true));
    at = Number(view.getBigUint64(record + 48, true));
  }
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new FormatError("This ZIP archive's directory is damaged.");
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    // ZIP64 sizes and offsets live in an extra field when the 32-bit ones are full.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let p = extra + 4;
        if (size === 0xffffffff) (size = Number(view.getBigUint64(p, true))), (p += 8);
        if (compressedSize === 0xffffffff) (compressedSize = Number(view.getBigUint64(p, true))), (p += 8);
        if (local === 0xffffffff) local = Number(view.getBigUint64(p, true));
      }
      extra += 4 + length;
    }
    entries.push({
      name,
      method,
      size,
      async read(inflateRaw) {
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new FormatError(`The ZIP entry ${name} is damaged.`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + compressedSize > bytes.length) throw new FormatError(`The ZIP entry ${name} is cut short.`);
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) {
          const out = await inflateRaw(data, size);
          if (out.length !== size) throw new FormatError(`The ZIP entry ${name} didn't unpack to its stated size.`);
          return out;
        }
        throw new FormatError(`The ZIP entry ${name} uses a compression method dropslice can't read.`);
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
