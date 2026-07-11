#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANAGER_NAME = "Babel Manager";
const PACKAGE_VERSION = require(path.join(PROJECT_ROOT, "package.json")).version;

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-manager-build-"));
  try {
    const appDir = createManagerApp(buildRoot);
    packageDmg(appDir, MANAGER_NAME);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }

  console.log(`Built macOS .dmg in ${DIST_DIR}`);
}

function createManagerApp(buildRoot) {
  const appDir = path.join(buildRoot, `${MANAGER_NAME}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const resourcesDir = path.join(contentsDir, "Resources");
  const executable = path.join(macOSDir, MANAGER_NAME);
  const sourcePath = path.join(buildRoot, "manager.m");
  const nativeCoreDir = path.join(PROJECT_ROOT, "installer", "macos");

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist(MANAGER_NAME, PACKAGE_VERSION), "utf8");
  copyFile(path.join(PROJECT_ROOT, "assets", "babel.icns"), path.join(resourcesDir, "babel.icns"));
  copyManagerResources(resourcesDir);
  fs.writeFileSync(sourcePath, managerSource({ name: MANAGER_NAME }), "utf8");

  childProcess.execFileSync("/usr/bin/clang", [
    "-arch",
    "arm64",
    "-mmacosx-version-min=11.0",
    "-fobjc-arc",
    "-framework",
    "Cocoa",
    "-I",
    nativeCoreDir,
    sourcePath,
    path.join(nativeCoreDir, "BabelInstallerCore.m"),
    "-o",
    executable
  ], {
    stdio: "pipe"
  });

  fs.rmSync(sourcePath, { force: true });
  fs.chmodSync(executable, 0o755);

  clearExtendedAttributes(appDir);
  childProcess.execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "pipe" });
  clearExtendedAttributes(appDir);

  return appDir;
}

function packageDmg(appDir, name) {
  // Stage the .app alongside an /Applications shortcut, then pack into a compressed
  // dmg — the standard, drag-to-install macOS distribution format.
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-dmg-stage-"));
  try {
    clearExtendedAttributes(appDir);
    childProcess.execFileSync("/usr/bin/ditto", ["--norsrc", "--noextattr", appDir, path.join(stageDir, `${name}.app`)], { stdio: "pipe" });
    childProcess.execFileSync("/bin/ln", ["-s", "/Applications", path.join(stageDir, "Applications")], { stdio: "pipe" });

    const dmgPath = path.join(DIST_DIR, `${name}.dmg`);
    fs.rmSync(dmgPath, { force: true });
    childProcess.execFileSync("/usr/bin/hdiutil", [
      "create",
      "-volname", name,
      "-srcfolder", stageDir,
      "-ov",
      "-format", "UDZO",
      dmgPath
    ], { stdio: "pipe" });
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

function clearExtendedAttributes(target) {
  for (const attr of ["com.apple.FinderInfo", "com.apple.fileprovider.fpfs#P", "com.apple.provenance"]) {
    childProcess.spawnSync("/usr/bin/xattr", ["-dr", attr, target], { stdio: "ignore" });
  }
  childProcess.spawnSync("/usr/bin/xattr", ["-cr", target], { stdio: "ignore" });
}

function copyManagerResources(resourcesDir) {
  const payloadDir = path.join(resourcesDir, "payload");

  // Strip test-only scaffolding so it never ships in the running plugin.
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "main.js"), path.join(payloadDir, "mod", "main.js"));
  copyFile(path.join(PROJECT_ROOT, "src", "mod", "preload.js"), path.join(payloadDir, "mod", "preload.js"));
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "renderer.js"), path.join(payloadDir, "mod", "renderer.js"));
  copyDirectory(path.join(PROJECT_ROOT, "src", "shared"), path.join(payloadDir, "shared"));
}

const TEST_ONLY_BLOCK = /\/\* @dtm-test-only:start[\s\S]*?@dtm-test-only:end \*\/\n?/g;

function copyFile(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function copyStripped(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(source, "utf8").replace(TEST_ONLY_BLOCK, ""), "utf8");
}

function copyDirectory(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, destPath);
    }
  }
}

function managerSource({ name }) {
  const appName = objcString(name);

  return `#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>
#import "BabelInstallerCore.h"

static NSString *const AppName = @${appName};

static void ShowAlert(NSString *message, NSString *info) {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = message;
  alert.informativeText = info ?: @"";
  [alert addButtonWithTitle:@"OK"];
  [alert runModal];
}

static int RunAction(NSString *action, NSString *successMessage) {
  NSString *discordDataDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/discord"];
  NSString *resourcePath = [[NSBundle mainBundle] resourcePath];
  NSString *payloadSource = [resourcePath stringByAppendingPathComponent:@"payload"];
  NSError *error = nil;
  BOOL ok = [action isEqualToString:@"install"]
    ? BabelInstall(discordDataDir, payloadSource, &error)
    : BabelUninstall(discordDataDir, &error);
  if (ok) {
    ShowAlert(AppName, successMessage);
    return 0;
  }

  ShowAlert(AppName, error.localizedDescription ?: @"Babel action failed.");
  return 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];

    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = AppName;
    alert.informativeText = @"Choose what to do with Babel.";
    [alert addButtonWithTitle:@"Install"];
    [alert addButtonWithTitle:@"Uninstall"];
    [alert addButtonWithTitle:@"Cancel"];

    NSModalResponse response = [alert runModal];
    if (response == NSAlertFirstButtonReturn) {
      return RunAction(@"install", @"Babel installed. Quit and reopen Discord to use it.");
    }
    if (response == NSAlertSecondButtonReturn) {
      return RunAction(@"uninstall", @"Babel removed. Quit and reopen Discord.");
    }

    return 0;
  }
}
`;
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
  <key>CFBundleShortVersionString</key>
  <string>${escapeXml(version)}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`;
}

function objcString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
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
  managerSource,
  plist
};
