#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANAGER_NAME = "Discord Translator Mod Manager";

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  createManagerApp();
  packageCommandApp(MANAGER_NAME);

  console.log(`Built macOS apps in ${DIST_DIR}`);
}

function createManagerApp() {
  const name = MANAGER_NAME;
  const appDir = path.join(DIST_DIR, `${name}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const executable = path.join(macOSDir, name);

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist(name), "utf8");
  fs.writeFileSync(executable, runnerScript({ name }), "utf8");
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

function runnerScript({ name }) {
  const projectRoot = shellQuote(PROJECT_ROOT);
  const installScript = shellQuote(path.join(PROJECT_ROOT, "scripts", "install.js"));
  const uninstallScript = shellQuote(path.join(PROJECT_ROOT, "scripts", "uninstall.js"));
  const quotedName = name.replace(/"/g, '\\"');

  return `#!/bin/zsh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG="$TMPDIR/discord-translator-mod-manager.log"
cd ${projectRoot}
CHOICE="$(osascript -e 'button returned of (display dialog "Choose what to do with Discord Translator Mod." buttons {"Cancel", "Uninstall", "Install"} default button "Install" cancel button "Cancel" with title "${quotedName}")' 2>/dev/null || true)"
if [ -z "$CHOICE" ] || [ "$CHOICE" = "Cancel" ]; then
  exit 0
fi
case "$CHOICE" in
  Install)
    SCRIPT=${installScript}
    SUCCESS_MESSAGE="Discord Translator Mod installed. Quit and reopen Discord to use it."
    ;;
  Uninstall)
    SCRIPT=${uninstallScript}
    SUCCESS_MESSAGE="Discord Translator Mod removed. Quit and reopen Discord."
    ;;
  *)
    exit 0
    ;;
esac
NODE_BIN=""
NODE_RUNNER=""
for CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ ! -x "$CANDIDATE" ]; then
    continue
  fi
  if [ "$(uname -m)" = "arm64" ]; then
    ARCHS="$(/usr/bin/lipo -archs "$CANDIDATE" 2>/dev/null || true)"
    case " $ARCHS " in
      *" arm64 "*)
        NODE_BIN="$CANDIDATE"
        NODE_RUNNER="/usr/bin/arch -arm64"
        break
        ;;
    esac
  else
    NODE_BIN="$CANDIDATE"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  osascript -e 'display dialog "Native arm64 Node.js was not found. Install the Apple Silicon build from https://nodejs.org or Homebrew under /opt/homebrew, then run this manager again. No Rosetta is required." buttons {"OK"} default button "OK" with title "${quotedName}" with icon stop'
  exit 1
fi
if [ -n "$NODE_RUNNER" ]; then
  $NODE_RUNNER "$NODE_BIN" "$SCRIPT" > "$LOG" 2>&1
else
  "$NODE_BIN" "$SCRIPT" > "$LOG" 2>&1
fi
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  osascript -e "display dialog \\"$SUCCESS_MESSAGE\\" buttons {\\"OK\\"} default button \\"OK\\" with title \\"${quotedName}\\""
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
