/* Packages the installed Node runtime and runtime-only server dependencies. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The release sidecar must be packaged from Windows x64.");
}

const root = path.resolve(__dirname, "..");
const binary = path.join(root, "src-tauri", "binaries", "vmr-node-x86_64-pc-windows-msvc.exe");
const sidecarModules = path.join(root, "server", "node_modules");

fs.mkdirSync(path.dirname(binary), { recursive: true });
// Keep production modules beside server.js so Node's normal module resolver
// finds native Koffi binaries after Tauri extracts bundle resources.
if (!process.env.npm_execpath) throw new Error("package-sidecar must be run through npm.");
execFileSync(process.execPath, [process.env.npm_execpath, "install", "--prefix", path.join(root, "server"), "--omit=dev",
  "--package-lock=false", "--no-audit", "--no-fund",
], { stdio: "inherit" });
fs.copyFileSync(process.execPath, binary);
if (!fs.existsSync(path.join(sidecarModules, "koffi"))) {
  throw new Error("The production server dependencies were not installed.");
}
console.log(`Bundled Node ${process.version} as ${path.basename(binary)}.`);
