#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  createCommandApp({
    name: "Discord Translator Mod Installer",
    script: "scripts/install.js",
    successMessage: "Discord Translator Mod installed. Quit and reopen Discord to use it."
  });

  createCommandApp({
    name: "Discord Translator Mod Uninstaller",
    script: "scripts/uninstall.js",
    successMessage: "Discord Translator Mod removed. Quit and reopen Discord."
  });

  packageCommandApp("Discord Translator Mod Installer");
  packageCommandApp("Discord Translator Mod Uninstaller");

  console.log(`Built macOS apps in ${DIST_DIR}`);
}

function createCommandApp({ name, script, successMessage }) {
  const appDir = path.join(DIST_DIR, `${name}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const executable = path.join(macOSDir, name);

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist(name), "utf8");
  fs.writeFileSync(executable, runnerScript({ name, script, successMessage }), "utf8");
  fs.chmodSync(executable, 0o755);

  if (process.platform === "darwin") {
    childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], {
      stdio: "pipe"
    });
    childProcess.execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir], {
      stdio: "pipe"
    });
    childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], {
      stdio: "pipe"
    });
  }
}

function packageCommandApp(name) {
  const appDir = path.join(DIST_DIR, `${name}.app`);
  const zipPath = path.join(DIST_DIR, `${name}.zip`);

  if (process.platform === "darwin") {
    childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], {
      stdio: "pipe"
    });
    childProcess.execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", appDir, zipPath], {
      cwd: DIST_DIR,
      stdio: "pipe"
    });
  }
}

function runnerScript({ name, script, successMessage }) {
  const projectRoot = shellQuote(PROJECT_ROOT);
  const scriptPath = shellQuote(path.join(PROJECT_ROOT, script));
  const quotedSuccess = successMessage.replace(/"/g, '\\"');
  const quotedName = name.replace(/"/g, '\\"');

  return `#!/bin/zsh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG="$TMPDIR/discord-translator-mod-${script.includes("uninstall") ? "uninstall" : "install"}.log"
cd ${projectRoot}
NODE_BIN=""
for CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -x "$CANDIDATE" ]; then
    NODE_BIN="$CANDIDATE"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  osascript -e 'display dialog "Node.js was not found. Install Node.js or run this project with npm." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi
if [ "$(uname -m)" = "arm64" ]; then
  NODE_ARCH="$("$NODE_BIN" -p 'process.arch' 2>/dev/null || true)"
  if [ "$NODE_ARCH" != "arm64" ]; then
    osascript -e 'display dialog "Apple Silicon Mac detected, but the selected Node.js is not arm64. Install native arm64 Node.js from https://nodejs.org or Homebrew under /opt/homebrew, then run this installer again." buttons {"OK"} default button "OK" with icon stop'
    exit 1
  fi
fi
"$NODE_BIN" ${scriptPath} > "$LOG" 2>&1
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  osascript -e 'display dialog "${quotedSuccess}" buttons {"OK"} default button "OK" with title "${quotedName}"'
else
  ERROR_TEXT="$(tail -n 12 "$LOG" | sed 's/"/\\\\"/g')"
  osascript -e "display dialog \\"$ERROR_TEXT\\" buttons {\\"OK\\"} default button \\"OK\\" with title \\"${quotedName}\\" with icon stop"
fi
exit "$STATUS"
`;
}

function plist(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundleIdentifier</key>
  <string>local.discord-translator-mod.${bundleSuffix(name)}</string>
  <key>CFBundleName</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bundleSuffix(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

if (require.main === module) {
  main();
}

module.exports = {
  runnerScript
};
