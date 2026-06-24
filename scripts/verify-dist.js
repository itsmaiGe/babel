#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const APP_NAMES = [
  "Babel Manager"
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

      const executable = path.join(tmp, `${name}.app`, "Contents", "MacOS", name);
      const archs = childProcess.execFileSync("/usr/bin/lipo", ["-archs", executable], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim().split(/\s+/);

      if (!archs.includes("arm64")) {
        throw new Error(`${name} is missing an arm64 executable slice.`);
      }
      if (archs.includes("x86_64")) {
        throw new Error(`${name} unexpectedly contains an x86_64 executable slice.`);
      }
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
