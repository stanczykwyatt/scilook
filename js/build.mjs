// Bundles the preview code, with the shared readers, into one script for JavaScriptCore:
// Sources/SciLookCore/Resources/scilook.js. node:zlib is swapped for the small inflate.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./src/entry.js", import.meta.url))],
  bundle: true,
  format: "iife",
  target: "safari16",
  outfile: fileURLToPath(new URL("../Sources/SciLookCore/Resources/scilook.js", import.meta.url)),
  alias: { "node:zlib": fileURLToPath(new URL("./src/zlib-shim.js", import.meta.url)) },
  legalComments: "inline",
  banner: { js: "// SciLook's preview code, bundled from js/ by js/build.mjs. Don't edit; rebuild." },
});
console.log("Bundled Sources/SciLookCore/Resources/scilook.js");
