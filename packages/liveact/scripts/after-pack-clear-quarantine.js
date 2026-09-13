/**
 * macOS Gatekeeper quarantine on unpacked Windows Electron binaries makes
 * 7za fail with "Operation not permitted" while building NSIS/portable.
 * Strip quarantine from the pack output before archiving.
 */
const { spawnSync } = require("child_process");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;
  if (context.electronPlatformName !== "win32") return;
  const out = context.appOutDir;
  if (!out) return;
  const result = spawnSync("xattr", ["-cr", out], { encoding: "utf8" });
  if (result.status !== 0) {
    console.warn(
      "[afterPack] xattr -cr failed:",
      result.stderr || result.stdout || result.status
    );
  } else {
    console.log(`[afterPack] cleared quarantine on ${out}`);
  }
};
