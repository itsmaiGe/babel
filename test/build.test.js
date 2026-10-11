"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main: runMacBuild, managerSource, plist } = require("../scripts/build");

// F4 regression: the Mac build orchestration must replace only its own dist
// outputs. The fixture runs the real scripts/build.js orchestration against a
// temporary dist with the external compiler/packager commands stubbed — the
// real dist is never touched.

function writeBuildFixture(distDir) {
  const appMacOS = path.join(distDir, "Babel Manager.app", "Contents", "MacOS");
  fs.mkdirSync(appMacOS, { recursive: true });
  fs.writeFileSync(path.join(appMacOS, "Babel Manager"), "old binary");
  fs.writeFileSync(path.join(distDir, "Babel Manager.app", "stale-old-app-file.txt"), "stale");
  fs.writeFileSync(path.join(distDir, "Babel Manager.dmg"), "old dmg bytes");
  fs.writeFileSync(path.join(distDir, "build-mac.json"), '{"artifact":"Babel Manager.dmg"}\n');
  fs.writeFileSync(path.join(distDir, "Babel-Installer.exe"), "windows exe bytes");
  fs.writeFileSync(path.join(distDir, "build-windows.json"), '{"artifact":"Babel-Installer.exe"}\n');
  fs.writeFileSync(path.join(distDir, "unrelated.txt"), "keep me");
}

function snapshotDir(dir, prefix = "") {
  const entries = new Map();
  for (const item of fs
    .readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.set(`${relative}/`, "directory");
      for (const [key, value] of snapshotDir(dir, relative)) entries.set(key, value);
    } else {
      entries.set(relative, fs.readFileSync(path.join(dir, relative)));
    }
  }
  return entries;
}

function stubBuildCommands({ failCompile = false } = {}) {
  const childProcess = require("node:child_process");
  const original = {
    execFileSync: childProcess.execFileSync,
    spawnSync: childProcess.spawnSync,
  };
  const commands = [];
  const stub = (command, args = []) => {
    const name = path.basename(String(command));
    commands.push([name, ...args.map(String)]);
    if (name === "clang") {
      if (failCompile) throw new Error("clang failed (stubbed)");
      const output = args[args.indexOf("-o") + 1];
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, "stub binary");
      return Buffer.alloc(0);
    }
    if (name === "ditto") {
      fs.cpSync(args[args.length - 2], args[args.length - 1], { recursive: true });
      return Buffer.alloc(0);
    }
    if (name === "ln") {
      fs.symlinkSync(args[1], args[2]);
      return Buffer.alloc(0);
    }
    if (name === "hdiutil" && args[0] === "create") {
      fs.writeFileSync(args[args.length - 1], "stub dmg bytes");
      return Buffer.alloc(0);
    }
    if (["codesign", "xattr"].includes(name)) return Buffer.alloc(0);
    throw new Error(`unexpected external command: ${command}`);
  };
  childProcess.execFileSync = stub;
  childProcess.spawnSync = stub;
  return {
    commands,
    restore() {
      childProcess.execFileSync = original.execFileSync;
      childProcess.spawnSync = original.spawnSync;
    },
  };
}

test("a failed manager build preserves Windows and old Mac dist artifacts byte-for-byte", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "babel-build-dist-"));
  writeBuildFixture(distDir);
  const before = snapshotDir(distDir);
  const stub = stubBuildCommands({ failCompile: true });
  let after;
  try {
    assert.throws(() => runMacBuild({ distDir }), /clang failed/);
    after = snapshotDir(distDir);
  } finally {
    stub.restore();
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  assert.deepEqual(after, before);
});

test("a successful manager build replaces only Mac outputs and keeps Windows bytes", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "babel-build-dist-"));
  writeBuildFixture(distDir);
  const before = snapshotDir(distDir);
  const stub = stubBuildCommands();
  let after;
  try {
    runMacBuild({ distDir });
    after = snapshotDir(distDir);
  } finally {
    stub.restore();
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  // Windows and unrelated outputs are kept byte-for-byte.
  for (const name of ["Babel-Installer.exe", "build-windows.json", "unrelated.txt"])
    assert.deepEqual(after.get(name), before.get(name), name);
  // The old app was removed before copying: no stale file can merge into the
  // fresh (signed) app, and the executable is the new stub-built one.
  assert.equal([...after.keys()].some((name) => name.includes("stale-old-app-file")), false);
  assert.deepEqual(after.get("Babel Manager.app/Contents/MacOS/Babel Manager"), Buffer.from("stub binary"));
  assert.ok(after.has("Babel Manager.app/Contents/Info.plist"));
  assert.ok(after.has("Babel Manager.app/Contents/Resources/payload/manifest.json"));
  // The dmg output is rebuilt and the stale Mac build metadata goes with it
  // (scripts/verify-dist.js writes the verified metadata afterwards).
  assert.deepEqual(after.get("Babel Manager.dmg"), Buffer.from("stub dmg bytes"));
  assert.equal(after.has("build-mac.json"), false);
  // The orchestration only shelled out to the expected build commands.
  assert.deepEqual([...new Set(stub.commands.map(([name]) => name))].sort(), ["clang", "codesign", "ditto", "hdiutil", "ln", "xattr"]);
});

test("distribution verifier validates the DMG instead of the removed zip artifact", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../scripts/verify-dist.js"), "utf8");

  assert.match(source, /Babel Manager\.dmg/);
  assert.match(source, /hdiutil/);
  assert.match(source, /attach/);
  assert.match(source, /codesign/);
  assert.doesNotMatch(source, /\.zip/);
});

test("native manager bundle uses the package release version", () => {
  const version = require("../package.json").version;
  assert.ok(plist("Babel Manager", version).includes(
    `<key>CFBundleShortVersionString</key>\n  <string>${version}</string>`
  ));
});

test("native manager does not depend on Node or an external installer process", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.doesNotMatch(source, /NSTask/);
  assert.doesNotMatch(source, /node/i);
  assert.doesNotMatch(source, /desktop-core-action\.js/);
  assert.match(source, /BabelInstallerCore/);
});

test("native manager runs the desktop core installer without administrator authorization", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /BabelInstall/);
  assert.match(source, /BabelUninstall/);
  assert.doesNotMatch(source, /RunPrivilegedShellCommand/);
  assert.doesNotMatch(source, /with administrator privileges/);
  assert.doesNotMatch(source, /ShellQuote/);
  assert.doesNotMatch(source, /InstallScript/);
  assert.doesNotMatch(source, /UninstallScript/);
  assert.doesNotMatch(source, /privileged-action\.js/);
  assert.doesNotMatch(source, /stage-action\.js/);
});

test("native manager detects the default target and offers optional native access recovery", () => {
  const source = managerSource({ name: "Test Manager" });

  assert.match(source, /Application Support.*discord/);
  const startup = source.slice(source.indexOf("applicationDidFinishLaunching:"), source.indexOf("- (void)detectTarget:"));
  assert.match(startup, /\[self detectTarget:nil\]/);
  assert.doesNotMatch(startup, /NSOpenPanel/);
  assert.match(source, /NSOpenPanel/);
  assert.match(source, /NSFileReadNoPermissionError/);
  assert.match(plist("Babel Manager", "0.1.6"), /<key>NSAppDataUsageDescription<\/key>\s*<string>[^<]*Discord/);
});

test("native manager supports install and uninstall actions in one app", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /button:L\(@"mac.install"/);
  assert.match(source, /button:L\(@"mac.uninstall"/);
  assert.match(source, /run:YES/);
  assert.match(source, /run:NO/);
});

test("Windows installer dependencies are reproducibly pinned", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const goMod = fs.readFileSync(path.join(__dirname, "../installer/go.mod"), "utf8");
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/build.yml"), "utf8");

  assert.match(goMod, /golang\.org\/x\/sys v0\.36\.0/);
  assert.doesNotMatch(goMod,/giu|cimgui/);
  assert.match(workflow, /github\.com\/akavel\/rsrc@v0\.10\.2/);
  assert.doesNotMatch(workflow, /@latest/);
  assert.doesNotMatch(workflow, /go mod tidy/);
});
