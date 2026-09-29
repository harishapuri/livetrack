#!/usr/bin/env node
/**
 * Build LiveTrack-Uninstall-Portable-<version>-x64.exe into the electron-builder
 * output directory, plus a .cmd companion with the same cleanup.
 *
 * On Windows, prefers NSIS (makensis). On macOS/Linux, NSIS 3.0.4 mac binaries
 * often OOM, so this falls back to a trimmed self-contained .NET 8 win-x64 exe.
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
const csprojPath = path.join(
  scriptDir,
  "portable-uninstaller",
  "LiveTrackUninstall.csproj"
);
const outDir = path.resolve(
  packageDir,
  pkg.build?.directories?.output || "../../../release"
);
const outFile = path.join(
  outDir,
  `LiveTrack-Uninstall-Portable-${version}-${arch}.exe`
);

function copyCmdCompanion() {
  const cmdSrc = path.join(scriptDir, "windows-portable-uninstall.cmd");
  if (!fs.existsSync(cmdSrc)) return null;
  const cmdDest = path.join(
    outDir,
    `LiveTrack-Uninstall-Portable-${version}-${arch}.cmd`
  );
  fs.copyFileSync(cmdSrc, cmdDest);
  console.log(`[portable-uninstaller] copied ${path.basename(cmdDest)}`);
  return cmdDest;
}

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

function runMakensis(nsisPath, bin, args) {
  const env = { ...process.env, NSISDIR: nsisPath };
  return spawnSync(bin, args, {
    env,
    encoding: "utf8",
    cwd: nsisPath,
    timeout: 20000,
    killSignal: "SIGKILL",
  });
}

function tryNsis() {
  if (process.platform === "darwin") {
    console.log("[portable-uninstaller] skipping mac NSIS (known bad_alloc); using .NET");
    return false;
  }
  if (!fs.existsSync(nsiPath)) return false;
  const cached = findMakensisInCache();
  if (!cached) {
    console.warn("[portable-uninstaller] makensis not in electron-builder cache");
    return false;
  }
  const outFileForNsis = outFile.replace(/\\/g, "/");
  console.log(`[portable-uninstaller] NSISDIR=${cached.nsisPath}`);
  const result = runMakensis(cached.nsisPath, cached.bin, [
    "-INPUTCHARSET",
    "UTF8",
    `-DOUT_FILE=${outFileForNsis}`,
    nsiPath,
  ]);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 || !fs.existsSync(outFile)) {
    console.warn(
      `[portable-uninstaller] makensis failed (status ${result.status}${result.error ? `, ${result.error.message}` : ""})`
    );
    return false;
  }
  return true;
}

function tryDotnet() {
  if (!fs.existsSync(csprojPath)) {
    throw new Error(`Missing ${csprojPath}`);
  }
  const publishDir = path.join(scriptDir, "portable-uninstaller", "bin", "publish");
  fs.rmSync(publishDir, { recursive: true, force: true });
  console.log("[portable-uninstaller] publishing win-x64 uninstaller with dotnet");
  const result = spawnSync(
    "dotnet",
    [
      "publish",
      csprojPath,
      "-c",
      "Release",
      "-r",
      "win-x64",
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:PublishTrimmed=true",
      "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-o",
      publishDir,
    ],
    { encoding: "utf8" }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`dotnet publish failed with exit ${result.status}`);
  }
  const published = path.join(publishDir, "LiveTrack-Uninstall-Portable.exe");
  if (!fs.existsSync(published)) {
    throw new Error(`Expected output missing: ${published}`);
  }
  fs.copyFileSync(published, outFile);
  return true;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  copyCmdCompanion();

  const built = tryNsis() || tryDotnet();
  if (!built || !fs.existsSync(outFile)) {
    throw new Error(`Expected output missing: ${outFile}`);
  }
  console.log(
    `[portable-uninstaller] ok (${fs.statSync(outFile).size} bytes) -> ${outFile}`
  );
}

main().catch((err) => {
  console.error("[portable-uninstaller]", err?.message || err);
  process.exit(1);
});
