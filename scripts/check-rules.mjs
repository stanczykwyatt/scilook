// CI's rule check: SciLook only reads the file it previews. Run it after scripts/build-app.sh.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const problems = [];

// Swift: no network, no writing, no running programs.
const swift = [];
const walk = (dir, ext, out) => {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
};
walk(path.join(root, "Sources"), ".swift", swift);
for (const f of swift) {
  const code = readFileSync(f, "utf8");
  for (const [re, why] of [
    [/URLSession|NWConnection|CFNetwork|Socket/, "uses the network"],
    [/\.write\(to|createFile|FileHandle\(forWriting|FileHandle\(forUpdating|removeItem|moveItem|copyItem/, "writes files"],
    [/Process\(|NSTask|posix_spawn|system\(/, "runs programs"],
  ])
    if (re.test(code)) problems.push(`${path.relative(root, f)} ${why}`);
}

// The bundled JavaScript: no ways to reach out of JavaScriptCore.
const js = readFileSync(path.join(root, "Sources/SciLookCore/Resources/scilook.js"), "utf8");
for (const [re, why] of [
  [/\bfetch\(|XMLHttpRequest|WebSocket/, "uses the network"],
  [/\beval\(|new Function\(/, "evaluates code"],
]) if (re.test(js)) problems.push(`scilook.js ${why}`);

// The built app: sandboxed, with nothing else.
const app = path.join(root, "build/SciLook.app");
if (existsSync(app)) {
  for (const bundle of [app, path.join(app, "Contents/PlugIns/SciLookPreview.appex")]) {
    const xml = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", bundle], { encoding: "utf8" });
    const keys = [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    if (keys.join() !== "com.apple.security.app-sandbox" || !/<true\/>/.test(xml)) problems.push(`${path.basename(bundle)} has entitlements ${keys.join(", ")}`);
  }
} else problems.push("build/SciLook.app is missing; run scripts/build-app.sh first");

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`OK: ${swift.length} Swift files, the preview code and both bundles only read, sandboxed with nothing else.`);
