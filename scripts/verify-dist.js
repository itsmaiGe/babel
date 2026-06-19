#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const APP_NAMES = [
  "Discord Translator Mod Installer",
  "Discord Translator Mod Uninstaller"
];

function main() {
  for (const name of APP_NAMES) {
    const zipPath = path.join(DIST_DIR, `${name}.zip`);
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Missing ${zipPath}`);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-dist-verify-"));
    try {
      childProcess.execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, tmp], {
        stdio: "pipe"
      });
      childProcess.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", path.join(tmp, `${name}.app`)], {
        stdio: "pipe"
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log("Distribution zip apps passed strict codesign verification.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
