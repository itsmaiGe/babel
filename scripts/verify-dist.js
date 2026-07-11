#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const APP_NAME = "Babel Manager";
const DMG_NAME = "Babel Manager.dmg";

function main() {
  const dmgPath = path.join(DIST_DIR, DMG_NAME);
  if (!fs.existsSync(dmgPath)) throw new Error(`Missing ${dmgPath}`);

  childProcess.execFileSync("/usr/bin/hdiutil", ["verify", dmgPath], { stdio: "pipe" });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-dist-verify-"));
  const mountPath = path.join(tmp, "mount");
  fs.mkdirSync(mountPath);
  let attached = false;
  try {
    childProcess.execFileSync("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPath, dmgPath], {
      stdio: "pipe"
    });
    attached = true;

    const appPath = path.join(mountPath, `${APP_NAME}.app`);
    childProcess.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });

    const executable = path.join(appPath, "Contents", "MacOS", APP_NAME);
    const archs = childProcess.execFileSync("/usr/bin/lipo", ["-archs", executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim().split(/\s+/);

    if (!archs.includes("arm64")) {
      throw new Error(`${APP_NAME} is missing an arm64 executable slice.`);
    }
    if (archs.includes("x86_64")) {
      throw new Error(`${APP_NAME} unexpectedly contains an x86_64 executable slice.`);
    }
  } finally {
    if (attached) {
      childProcess.spawnSync("/usr/bin/hdiutil", ["detach", mountPath], { stdio: "ignore" });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("Distribution DMG passed checksum, codesign, and architecture verification.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
