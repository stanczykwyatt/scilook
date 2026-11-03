// The bundle's entry: Quick Look's engine calls SciLook.preview with a native file reader.
import { preview } from "./summary.js";

globalThis.SciLook = { preview };
