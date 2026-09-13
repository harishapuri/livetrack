#!/usr/bin/env node
/**
 * Build LiveTrack-Uninstall-Portable-<version>-x64.exe into the electron-builder
 * output directory (../release relative to the monorepo root).
 *
 * Uses the same NSIS toolchain electron-builder caches (makensis + NSISDIR).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const pkg = require("../package.json");
const version = String(pkg.version || "0.0.0");
const arch = "x64";

const scriptDir = __dirname;
const packageDir = path.resolve(scriptDir, "..");
const nsiPath = path.join(scriptDir, "windows-portable-uninstall.nsi");
const outDir = path.resolve(
  packageDir,
  pkg.build?.directories?.output || "../../../release"
);
const outFile = path.join(
  outDir,
  `LiveTrack-Uninstall-Portable-${version}-${arch}.exe`
);

function findMakensisInCache() {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron-builder", "nsis");
  if (!fs.existsSync(cacheRoot)) return null;
  const versions = fs
    .readdirSync(cacheRoot)
    .filter((name) => name.startsWith("nsis-"))
    .sort()
    .reverse();
  for (const name of versions) {
    const nsisPath = path.join(cacheRoot, name);
    const bin =
      process.platform === "darwin"
        ? path.join(nsisPath, "mac", "makensis")
        : process.platform === "win32"
          ? path.join(nsisPath, "Bin", "makensis.exe")
          : path.join(nsisPath, "linux", "makensis");
    if (fs.existsSync(bin)) return { nsisPath, bin };
  }
  return null;
}

async function resolveNsis() {
  try {
    const { NSIS_PATH } = require("app-builder-lib/out/targets/nsis/nsisUtil");
    const nsisPath = await NSIS_PATH();
    const bin = path.join(
      nsisPath,
      process.platform === "darwin"
        ? "mac"
        : process.platform === "win32"
          ? "Bin"
          : "linux",
      process.platform === "win32" ? "makensis.exe" : "makensis"
    );
    if (fs.existsSync(bin)) return { nsisPath, bin };
  } catch (err) {
    console.warn(
      "[portable-uninstaller] app-builder-lib NSIS_PATH unavailable:",
      err?.message || err
    );
  }
  const cached = findMakensisInCache();
  if (cached) return cached;
  throw new Error(
    "makensis not found. Run `npm run dist:win` once so electron-builder downloads NSIS, or install NSIS."
  );
}

function runMakensis(nsisPath, bin, args) {
  const env = { ...process.env, NSISDIR: nsisPath };
  let result = spawnSync(bin, args, { env, encoding: "utf8" });
  // Rosetta fallback when mac makensis is x86_64 on Apple Silicon
  if (
    result.status !== 0 &&
    process.platform === "darwin" &&
    process.arch === "arm64"
  ) {
    result = spawnSync("arch", ["-x86_64", bin, ...args], {
      env,
      encoding: "utf8",
    });
  }
  return result;
}

async function main() {
  if (!fs.existsSync(nsiPath)) {
    throw new Error(`Missing NSIS script: ${nsiPath}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { nsisPath, bin } = await resolveNsis();
  // NSIS OutFile expects Windows-style paths when compiling for Windows
  const outFileForNsis = outFile.replace(/\\/g, "/");

  const args = [
    "-INPUTCHARSET",
    "UTF8",
    `-DOUT_FILE=${outFileForNsis}`,
    nsiPath,
  ];

  console.log(`[portable-uninstaller] NSISDIR=${nsisPath}`);
  console.log(`[portable-uninstaller] compiling → ${outFile}`);
  const result = runMakensis(nsisPath, bin, args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`makensis failed with exit ${result.status}`);
  }
  if (!fs.existsSync(outFile)) {
    throw new Error(`Expected output missing: ${outFile}`);
  }

  // Also drop a readable companion script next to the exe (optional, same cleanup).
  const cmdSrc = path.join(scriptDir, "windows-portable-uninstall.cmd");
  if (fs.existsSync(cmdSrc)) {
    const cmdDest = path.join(
      outDir,
      `LiveTrack-Uninstall-Portable-${version}-${arch}.cmd`
    );
    fs.copyFileSync(cmdSrc, cmdDest);
    console.log(`[portable-uninstaller] also copied ${path.basename(cmdDest)}`);
  }

  console.log(
    `[portable-uninstaller] ok (${fs.statSync(outFile).size} bytes)`
  );
}

main().catch((err) => {
  console.error("[portable-uninstaller]", err?.message || err);
  process.exit(1);
});
