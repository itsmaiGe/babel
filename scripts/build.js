#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANAGER_NAME = "Babel Manager";
const PACKAGE_VERSION = require(
  path.join(PROJECT_ROOT, "package.json"),
).version;

function main({ distDir = DIST_DIR } = {}) {
  require("./lib/i18n").generate({ check: true });
  // dist is shared with the Windows installer and other platform outputs: it is
  // never wiped here. Only the Mac-owned outputs (the manager app, the dmg and
  // its build metadata) are replaced, and only after the temporary app below has
  // built successfully, so a failure before Mac output publication leaves every
  // existing file untouched.
  fs.mkdirSync(distDir, { recursive: true });

  const buildRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dtm-manager-build-"),
  );
  try {
    const appDir = createManagerApp(buildRoot);
    const installedApp = path.join(distDir, `${MANAGER_NAME}.app`);
    // fs.cpSync merges into an existing tree: remove the old app first so stale
    // files can never survive into the copied (and signed) output.
    fs.rmSync(installedApp, { recursive: true, force: true });
    copyDirectory(appDir, installedApp);
    packageDmg(appDir, MANAGER_NAME, distDir);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
  // The rebuilt dmg invalidates the previous Mac build metadata, so drop the
  // stale file; scripts/verify-dist.js writes verified metadata afterwards.
  fs.rmSync(path.join(distDir, "build-mac.json"), { force: true });

  console.log(`Built macOS .dmg in ${distDir}`);
}

function createManagerApp(buildRoot) {
  const appDir = path.join(buildRoot, `${MANAGER_NAME}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const resourcesDir = path.join(contentsDir, "Resources");
  const executable = path.join(macOSDir, MANAGER_NAME);
  const nativeCoreDir = path.join(PROJECT_ROOT, "installer", "macos");

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentsDir, "Info.plist"),
    plist(MANAGER_NAME, PACKAGE_VERSION),
    "utf8",
  );
  copyFile(
    path.join(PROJECT_ROOT, "assets", "babel.icns"),
    path.join(resourcesDir, "babel.icns"),
  );
  copyManagerResources(resourcesDir);

  childProcess.execFileSync(
    "/usr/bin/clang",
    [
      "-arch",
      "arm64",
      "-mmacosx-version-min=11.0",
      "-fobjc-arc",
      "-framework",
      "Cocoa",
      "-I",
      nativeCoreDir,
      path.join(nativeCoreDir, "InstallerWindow.m"),
      path.join(nativeCoreDir, "BabelInstallerCore.m"),
      "-o",
      executable,
    ],
    {
      stdio: "pipe",
    },
  );

  fs.chmodSync(executable, 0o755);

  clearExtendedAttributes(appDir);
  childProcess.execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", appDir],
    { stdio: "pipe" },
  );
  clearExtendedAttributes(appDir);

  return appDir;
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function packageDmg(appDir, name, distDir = DIST_DIR) {
  // Stage the .app alongside an /Applications shortcut, then pack into a compressed
  // dmg — the standard, drag-to-install macOS distribution format.
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-dmg-stage-"));
  try {
    clearExtendedAttributes(appDir);
    childProcess.execFileSync(
      "/usr/bin/ditto",
      ["--norsrc", "--noextattr", appDir, path.join(stageDir, `${name}.app`)],
      { stdio: "pipe" },
    );
    childProcess.execFileSync(
      "/bin/ln",
      ["-s", "/Applications", path.join(stageDir, "Applications")],
      { stdio: "pipe" },
    );

    const dmgPath = path.join(distDir, `${name}.dmg`);
    fs.rmSync(dmgPath, { force: true });
    childProcess.execFileSync(
      "/usr/bin/hdiutil",
      [
        "create",
        "-volname",
        name,
        "-srcfolder",
        stageDir,
        "-ov",
        "-format",
        "UDZO",
        dmgPath,
      ],
      { stdio: "pipe" },
    );
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

function clearExtendedAttributes(target) {
  for (const attr of [
    "com.apple.FinderInfo",
    "com.apple.fileprovider.fpfs#P",
    "com.apple.provenance",
  ]) {
    childProcess.spawnSync("/usr/bin/xattr", ["-dr", attr, target], {
      stdio: "ignore",
    });
  }
  childProcess.spawnSync("/usr/bin/xattr", ["-cr", target], {
    stdio: "ignore",
  });
}

function copyManagerResources(resourcesDir) {
  const payloadDir = path.join(resourcesDir, "payload");
  require("./lib/i18n").generate({ check: true });
  for (const locale of require("./lib/i18n").LOCALES)
    copyDirectory(path.join(PROJECT_ROOT, "installer/macos/Resources", `${locale}.lproj`), path.join(resourcesDir, `${locale}.lproj`));
  require("./lib/payload").emitPayload(payloadDir);
}

function copyFile(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function managerSource() {
  return fs.readFileSync(
    path.join(PROJECT_ROOT, "installer/macos/InstallerWindow.m"),
    "utf8",
  );
}

function plist(name, version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundleIconFile</key>
  <string>babel</string>
  <key>CFBundleIdentifier</key>
  <string>local.discord-translator-mod.${bundleSuffix(name)}</string>
  <key>CFBundleName</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleLocalizations</key>
  <array><string>en</string><string>zh-Hans</string><string>zh-Hant</string><string>ja</string></array>
  <key>CFBundleShortVersionString</key>
  <string>${escapeXml(version)}</string>
  <key>CFBundleVersion</key>
  <string>${escapeXml(version)}</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSAppDataUsageDescription</key>
  <string>Babel Manager needs access to Discord's application data folder to install or remove the Babel plugin and manage its saved settings.</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bundleSuffix(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  managerSource,
  plist,
};
