// Stands in for node:zlib in the Quick Look bundle: the HDF5 reader only needs inflateSync.
import { inflateZlib } from "./inflate.js";

export function inflateSync(bytes, { maxOutputLength = Infinity } = {}) {
  return Buffer.from(inflateZlib(bytes, maxOutputLength));
}
