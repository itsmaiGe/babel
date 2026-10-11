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

async function main() {
  const dmgPath = path.join(DIST_DIR, DMG_NAME);
  if (!fs.existsSync(dmgPath)) throw new Error(`Missing ${dmgPath}`);

  childProcess.execFileSync("/usr/bin/hdiutil", ["verify", dmgPath], {
    stdio: "pipe",
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-dist-verify-"));
  const mountPath = path.join(tmp, "mount");
  fs.mkdirSync(mountPath);
  let attached = false;
  try {
    childProcess.execFileSync(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPath, dmgPath],
      {
        stdio: "pipe",
      },
    );
    attached = true;

    const appPath = path.join(mountPath, `${APP_NAME}.app`);
    childProcess.execFileSync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", appPath],
      { stdio: "pipe" },
    );

    const payload = path.join(appPath, "Contents/Resources/payload");
    const manifest = require("./lib/payload").validatePayload(payload);
    const { versionPins, writeMetadata } = require("./lib/build-metadata");
    const version = versionPins(manifest.version);
    for (const key of ["CFBundleShortVersionString", "CFBundleVersion"])
      if (
        childProcess
          .execFileSync(
            "/usr/libexec/PlistBuddy",
            ["-c", `Print :${key}`, path.join(appPath, "Contents/Info.plist")],
            { encoding: "utf8" },
          )
          .trim() !== version
      )
        throw new Error("Bundle version mismatch");
    const plistPath = path.join(appPath, "Contents/Info.plist");
    if (childProcess.execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleDevelopmentRegion", plistPath], { encoding: "utf8" }).trim() !== "en") throw new Error("Bundle development locale invalid");
    const declared = childProcess.execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleLocalizations", plistPath], { encoding: "utf8" });
    const expectedResources = require("./lib/i18n").generate({ check: true });
    for (const locale of require("./lib/i18n").LOCALES) {
      if (!declared.includes(locale)) throw new Error(`Missing bundle locale ${locale}`);
      for (const table of ["Localizable", "InfoPlist"]) {
        const relative = `installer/macos/Resources/${locale}.lproj/${table}.strings`;
        const file = path.join(appPath, "Contents/Resources", `${locale}.lproj`, `${table}.strings`);
        if (fs.readFileSync(file, "utf8") !== expectedResources.get(relative)) throw new Error(`Incomplete bundle localization ${locale}/${table}`);
        childProcess.execFileSync("/usr/bin/plutil", ["-lint", file], { stdio: "pipe" });
      }
      if (!manifest.files.some(entry => entry.path === `ui/i18n/messages/${locale}.js`)) throw new Error(`Missing plugin catalog ${locale}`);
    }
    const smoke = path.join(tmp, "native-ui.json");
    childProcess.execFileSync(
      "/usr/bin/open",
      ["-n", appPath, "--args", "--smoke-ui", smoke],
      { stdio: "pipe" },
    );
    const started = Date.now();
    while (!fs.existsSync(smoke) && Date.now() - started < 30000)
      await new Promise((resolve) => setTimeout(resolve, 200));
    if (!fs.existsSync(smoke))
      throw new Error("Native AppKit smoke did not complete");
    const ui = JSON.parse(fs.readFileSync(smoke, "utf8"));
    for (const [key, type] of Object.entries({
      window: "NSWindow",
      icon: "NSImageView",
      path: "NSTextField",
      details: "NSTextView",
      disclosure: "NSButton",
      checkbox: "NSButton",
      install: "NSButton",
      uninstall: "NSButton",
      close: "NSButton",
    }))
      if (ui[key] !== type)
        throw new Error(`Missing native AppKit control: ${key}`);
    if (ui.version !== version || ui.cleanupSelectedByDefault || ui.cleanupInMainWindow || !ui.detailsCollapsed)
      throw new Error("Native manager initial state mismatch");
    const executable = path.join(appPath, "Contents", "MacOS", APP_NAME);
    const archs = childProcess
      .execFileSync("/usr/bin/lipo", ["-archs", executable], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      .trim()
      .split(/\s+/);

    if (!archs.includes("arm64")) {
      throw new Error(`${APP_NAME} is missing an arm64 executable slice.`);
    }
    if (archs.includes("x86_64")) {
      throw new Error(
        `${APP_NAME} unexpectedly contains an x86_64 executable slice.`,
      );
    }
    writeMetadata("mac", DMG_NAME, manifest, {
      bundleVersion: version,
      nativeUIVerified: true,
    });
  } finally {
    if (attached) {
      childProcess.spawnSync("/usr/bin/hdiutil", ["detach", mountPath], {
        stdio: "ignore",
      });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(
    "Distribution DMG passed checksum, codesign, and architecture verification.",
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
