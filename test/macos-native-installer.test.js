"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const coreSource = path.join(projectRoot, "installer/macos/BabelInstallerCore.m");
const coreHeaderDir = path.dirname(coreSource);

test("native macOS installer coexists, reinstalls idempotently, and uninstalls cleanly", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-installer-"));
  try {
    const executable = compileHarness(temp);
    const base = path.join(temp, "discord");
    const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
    const payload = path.join(temp, "payload");
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    fs.writeFileSync(path.join(core, "index.js"), "require('./betterdiscord.js');\nmodule.exports = require('./core.asar');\n");
    fs.mkdirSync(path.join(payload, "mod"), { recursive: true });
    fs.mkdirSync(path.join(payload, "shared"), { recursive: true });
    fs.writeFileSync(path.join(payload, "mod/main.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(payload, "shared/settings.js"), "module.exports = {};\n");

    runHarness(executable, "install", base, payload);
    runHarness(executable, "install", base, payload);
    const installed = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal((installed.match(/DiscordTranslatorMod desktop-core loader:start/g) || []).length, 1);
    assert.equal((installed.match(/betterdiscord\.js/g) || []).length, 1);
    assert.equal(fs.existsSync(path.join(core, "discord-translator-mod/main.js")), true);

    fs.mkdirSync(path.join(base, "discord-translator-mod"), { recursive: true });
    fs.writeFileSync(path.join(base, "discord-translator-mod/settings.json"), "{}");
    runHarness(executable, "uninstall", base, payload);
    const uninstalled = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(uninstalled.includes("DiscordTranslatorMod"), false);
    assert.equal(uninstalled.includes("betterdiscord.js"), true);
    assert.equal(fs.existsSync(path.join(core, "discord-translator-mod")), false);
    assert.equal(fs.existsSync(path.join(base, "discord-translator-mod")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native macOS installer migrates the legacy whole-file loader from its backup", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-legacy-"));
  try {
    const executable = compileHarness(temp);
    const base = path.join(temp, "discord");
    const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
    const payload = path.join(temp, "payload");
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    fs.writeFileSync(path.join(core, "index.js"), "/* DiscordTranslatorMod desktop-core loader */\nmodule.exports = require('./core.asar');\n");
    fs.writeFileSync(path.join(core, "index.js.dtm-original"), "require('./betterdiscord.js');\nmodule.exports = require('./core.asar');\n");
    fs.mkdirSync(path.join(payload, "mod"), { recursive: true });
    fs.writeFileSync(path.join(payload, "mod/main.js"), "module.exports = {};\n");

    runHarness(executable, "install", base, payload);
    const installed = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(installed.includes("loader:start"), true);
    assert.equal(installed.includes("betterdiscord.js"), true);
    assert.equal(fs.existsSync(path.join(core, "index.js.dtm-original")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

for (const target of ["backup", "payload", "config"]) {
  test(`native macOS uninstall reports ${target} cleanup permission failures and allows retry`, { skip: process.platform !== "darwin" }, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-cleanup-"));
    try {
      const executable = compileHarness(temp);
      const base = path.join(temp, "discord");
      const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
      const originalIndex = "require('./betterdiscord.js');\nmodule.exports = require('./core.asar');\n";
      const files = {
        backup: path.join(core, "index.js.dtm-original"),
        payload: path.join(core, "discord-translator-mod/main.js"),
        config: path.join(base, "discord-translator-mod/settings.json")
      };
      for (const file of Object.values(files)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "fixture\n");
      }
      fs.writeFileSync(path.join(core, "core.asar"), "core");
      fs.writeFileSync(path.join(core, "package.json"), "{}");
      fs.writeFileSync(path.join(core, "index.js"), originalIndex);

      // Restrict the parent: a file's own write bit does not prevent deletion.
      const restrictedDir = path.dirname(files[target]);
      const cleanupPath = target === "backup" ? files.backup : restrictedDir;
      fs.chmodSync(restrictedDir, 0o555);
      try {
        const result = childProcess.spawnSync(executable, ["uninstall", base, ""], { encoding: "utf8" });
        assert.equal(fs.existsSync(files[target]), true, "permission-restricted file must remain");
        assert.equal(result.status, 1, `uninstall must report failed ${target} cleanup: ${result.stderr}`);
        assert.match(result.stderr, /NSCocoaErrorDomain Code=513/);
        assert.equal(result.stderr.includes(cleanupPath), true, result.stderr);
        assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), originalIndex);
      } finally {
        fs.chmodSync(restrictedDir, 0o755);
      }

      runHarness(executable, "uninstall", base, "");
      runHarness(executable, "uninstall", base, "");
      assert.equal(fs.existsSync(files.backup), false);
      assert.equal(fs.existsSync(path.dirname(files.payload)), false);
      assert.equal(fs.existsSync(path.dirname(files.config)), false);
      assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), originalIndex);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}

function compileHarness(temp) {
  const source = path.join(temp, "harness.m");
  const executable = path.join(temp, "native-installer-test");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#import "BabelInstallerCore.h"
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 4) return 2;
    NSString *action = [NSString stringWithUTF8String:argv[1]];
    NSString *base = [NSString stringWithUTF8String:argv[2]];
    NSString *payload = [NSString stringWithUTF8String:argv[3]];
    NSError *error = nil;
    BOOL ok = [action isEqualToString:@"install"]
      ? BabelInstall(base, payload, &error)
      : BabelUninstall(base, &error);
    if (!ok) fprintf(stderr, "%s\\n", error.description.UTF8String);
    return ok ? 0 : 1;
  }
}
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-framework", "Foundation", "-I", coreHeaderDir,
    coreSource, source, "-o", executable
  ]);
  return executable;
}

function runHarness(executable, action, base, payload) {
  childProcess.execFileSync(executable, [action, base, payload], { stdio: "pipe" });
}
