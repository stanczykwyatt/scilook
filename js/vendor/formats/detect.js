// Tells file types apart by their first bytes, not their names, so a misnamed file still opens.
import { isNpy } from "./npy.js";
import { isMat5 } from "./mat5.js";

const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

/** Where the HDF5 signature is (0, 512, 1024, …), or -1. `head` should be the first few KB. */
export function hdf5Offset(head) {
  for (let at = 0; at + 8 <= head.length; at = at === 0 ? 512 : at * 2) {
    if (HDF5.every((b, i) => head[at + i] === b)) return at;
  }
  return -1;
}

/** "hdf5", "npy", "npz", "mat5" or "unknown". */
export function sniff(head) {
  if (hdf5Offset(head) >= 0) return "hdf5";
  if (isNpy(head)) return "npy";
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) return "npz";
  if (isMat5(head)) return "mat5";
  return "unknown";
}

/** Describes a file for people, for the header bar. */
export const LABELS = {
  hdf5: "HDF5",
  npy: "NumPy .npy",
  npz: "NumPy .npz",
  mat5: "MATLAB 5.0 MAT-file",
  zarr: "Zarr",
};
