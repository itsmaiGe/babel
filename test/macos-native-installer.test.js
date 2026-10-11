"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
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

    require("../scripts/lib/payload").emitPayload(payload);
    runHarness(executable, "install", base, payload);
    const generation = nativeGeneration(core);
    const indexStat = fs.statSync(path.join(core, "index.js"));
    const payloadStat = fs.statSync(generation);
    require("../scripts/lib/payload").emitPayload(payload);
    runHarness(executable, "install", base, payload);
    const installed = fs.readFileSync(path.join(core, "index.js"), "utf8");
    const indexAgain = fs.statSync(path.join(core, "index.js"));
    const payloadAgain = fs.statSync(generation);
    assert.equal((installed.match(/DiscordTranslatorMod desktop-core loader:start/g) || []).length, 1);
    assert.equal((installed.match(/betterdiscord\.js/g) || []).length, 1);
    assert.equal(indexAgain.ino, indexStat.ino);
    assert.equal(indexAgain.mtimeMs, indexStat.mtimeMs);
    assert.equal(payloadAgain.ino, payloadStat.ino);
    assert.equal(payloadAgain.mtimeMs, payloadStat.mtimeMs);
    assert.equal(fs.existsSync(path.join(generation, "main.js")), true);

    fs.mkdirSync(path.join(base, "discord-translator-mod"), { recursive: true });
    fs.writeFileSync(path.join(base, "discord-translator-mod/settings.json"), "{}");
    runHarness(executable, "uninstall", base, payload);
    const uninstalled = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(uninstalled.includes("DiscordTranslatorMod"), false);
    assert.equal(uninstalled.includes("betterdiscord.js"), true);
    assert.equal(fs.existsSync(generation), false);
    assert.equal(fs.existsSync(path.join(base, "discord-translator-mod")), false);
    assert.equal(fs.existsSync(path.join(base, ".discord-translator-mod.lock")), true);
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

    require("../scripts/lib/payload").emitPayload(payload);
    runHarness(executable, "install", base, payload);
    const installed = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(installed.includes("loader:start"), true);
    assert.equal(installed.includes("betterdiscord.js"), true);
    assert.equal(fs.existsSync(path.join(core, "index.js.dtm-original")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native installer preserves a UTF-8 BOM and notices a BOM-only pre-commit change", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-bom-"));
  try {
    const executable = compileBomDriver(temp);
    const payload = path.join(temp, "payload");
    fs.mkdirSync(path.join(payload, "mod"), { recursive: true });
    fs.writeFileSync(path.join(payload, "mod/main.js"), "module.exports = {};\n");
    require("../scripts/lib/payload").emitPayload(payload);
    const original = Buffer.from("\uFEFF\r\n\tmodule.exports = require(\"./core.asar\");  \r\n\r\n", "utf8");
    assert.deepEqual(original.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
    const prepare = (name, bytes) => {
      const base = path.join(temp, name);
      const core = path.join(base, "app-1.0.0/modules/discord_desktop_core");
      fs.mkdirSync(core, { recursive: true });
      fs.writeFileSync(path.join(core, "core.asar"), "core");
      fs.writeFileSync(path.join(core, "package.json"), "{}");
      const index = path.join(core, "index.js");
      fs.writeFileSync(index, bytes);
      return { base, core, index };
    };
    const ordinary = prepare("bom", original);
    const installed = runBom(executable, "install", ordinary.base, payload);
    const removed = runBom(executable, "uninstall", ordinary.base, payload);
    assert.equal(installed.ok, true, JSON.stringify(installed));
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.deepEqual(fs.readFileSync(ordinary.index), original);
    const legacy = prepare("legacy", Buffer.from("// DiscordTranslatorMod desktop-core loader\nrequire(\"./discord-translator-mod/main.js\").install();\nmodule.exports = require(\"./core.asar\");\n"));
    fs.cpSync(payload, path.join(legacy.core, "discord-translator-mod"), { recursive: true });
    fs.writeFileSync(path.join(legacy.core, "index.js.dtm-original"), original);
    const migrated = runBom(executable, "install", legacy.base, payload);
    const restored = runBom(executable, "uninstall", legacy.base, payload);
    assert.equal(migrated.ok, true, JSON.stringify(migrated));
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.deepEqual(fs.readFileSync(legacy.index), original);
    assert.equal(fs.existsSync(path.join(legacy.core, "index.js.dtm-original")), false);
    const changed = prepare("bom-change", Buffer.from("module.exports = require(\"./core.asar\");\n"));
    const hooked = runBom(executable, "install", changed.base, payload);
    assert.equal(hooked.ok, true, JSON.stringify(hooked));
    const before = fs.readFileSync(changed.index);
    const mutated = runBom(executable, "uninstall-mutate-bom", changed.base, payload);
    assert.equal(mutated.ok, false, JSON.stringify(mutated));
    assert.equal(mutated.error, "common.error.targetChanged");
    assert.deepEqual(fs.readFileSync(changed.index), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), before]));
    const blank = prepare("blank", Buffer.from(""));
    const rejected = runBom(executable, "install", blank.base, payload);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "common.error.coreIncomplete");
    assert.deepEqual(fs.readFileSync(blank.index), Buffer.from(""));
    const spaces = prepare("spaces", Buffer.from(" \n\t"));
    const whitespace = runBom(executable, "install", spaces.base, payload);
    assert.equal(whitespace.ok, false);
    assert.equal(whitespace.error, "common.error.coreIncomplete");
    assert.deepEqual(fs.readFileSync(spaces.index), Buffer.from(" \n\t"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native regular-file fsync failure aborts before activation", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-sync-"));
  try {
    const executable = compileSyncDriver(temp);
    const payload = path.join(temp, "payload");
    fs.mkdirSync(path.join(payload, "mod"), { recursive: true });
    fs.writeFileSync(path.join(payload, "mod/main.js"), "module.exports = {};\n");
    require("../scripts/lib/payload").emitPayload(payload);
    const vanilla = Buffer.from("module.exports = require(\"./core.asar\");\n");
    const prepare = (name) => {
      const base = path.join(temp, name);
      const core = path.join(base, "app-1.0.0/modules/discord_desktop_core");
      fs.mkdirSync(core, { recursive: true });
      fs.writeFileSync(path.join(core, "core.asar"), "core");
      fs.writeFileSync(path.join(core, "package.json"), "{}");
      const index = path.join(core, "index.js");
      fs.writeFileSync(index, vanilla);
      return { base, core, index };
    };
    const temps = (core) => fs.readdirSync(core).filter((name) => /^\.discord-translator-mod-[si]-n-/.test(name));
    const payloadSync = prepare("payload-sync");
    const payloadFailure = runSync(executable, "install-fsync-error", payloadSync.base, payload);
    assert.equal(payloadFailure.ok, false, JSON.stringify(payloadFailure));
    assert.equal(payloadFailure.error, "common.error.operation");
    assert.deepEqual(fs.readFileSync(payloadSync.index), vanilla);
    assert.deepEqual(nativeGenerations(payloadSync.core), []);
    assert.deepEqual(temps(payloadSync.core), []);

    const prior = prepare("index-sync");
    const installed = runSync(executable, "install", prior.base, payload);
    assert.equal(installed.ok, true, JSON.stringify(installed));
    const hooked = fs.readFileSync(prior.index);
    const generation = nativeGeneration(prior.core);
    fs.appendFileSync(path.join(generation, "main.js"), "\n");
    const profile = path.join(prior.base, "discord-translator-mod");
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, "settings.json"), "{\"fixture\":true}");
    const indexFailure = runSync(executable, "install-index-fsync-error", prior.base, payload);
    assert.equal(indexFailure.ok, false, JSON.stringify(indexFailure));
    assert.deepEqual(fs.readFileSync(prior.index), hooked);
    assert.equal(fs.existsSync(generation), true);
    assert.equal(fs.readFileSync(path.join(profile, "settings.json"), "utf8"), "{\"fixture\":true}");
    assert.deepEqual(temps(prior.core), []);
    const uninstallFailure = runSync(executable, "uninstall-index-fsync-error", prior.base, payload);
    assert.equal(uninstallFailure.ok, false, JSON.stringify(uninstallFailure));
    assert.deepEqual(fs.readFileSync(prior.index), hooked);
    assert.equal(fs.existsSync(generation), true);
    assert.equal(fs.readFileSync(path.join(profile, "settings.json"), "utf8"), "{\"fixture\":true}");
    assert.deepEqual(temps(prior.core), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native invalid UTF-8 detach fails and keeps an opted-in profile", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-decode-"));
  try {
    const executable = compileHarness(temp);
    const payload = path.join(temp, "payload");
    fs.mkdirSync(payload, { recursive: true });
    const legacy = Buffer.from("// DiscordTranslatorMod desktop-core loader\nrequire(\"./discord-translator-mod/main.js\").install();\nmodule.exports = require(\"./core.asar\");\n");
    for (const variant of ["index", "backup"]) {
      const base = path.join(temp, variant);
      const core = path.join(base, "app-1.0.0/modules/discord_desktop_core");
      fs.mkdirSync(core, { recursive: true });
      fs.writeFileSync(path.join(core, "core.asar"), "core");
      fs.writeFileSync(path.join(core, "package.json"), "{}");
      const original = variant === "index"
        ? Buffer.concat([Buffer.from([0xff]), Buffer.from("module.exports = require(\"./core.asar\");\n")])
        : legacy;
      const index = path.join(core, "index.js");
      fs.writeFileSync(index, original);
      if (variant === "backup") fs.writeFileSync(path.join(core, "index.js.dtm-original"), Buffer.concat([Buffer.from([0xff]), Buffer.from("synthetic malformed backup")]));
      const sentinel = path.join(base, "discord-translator-mod", "settings.json");
      fs.mkdirSync(path.dirname(sentinel), { recursive: true });
      fs.writeFileSync(sentinel, "{\"fixture\":true}");
      const result = childProcess.spawnSync(executable, ["uninstall", base, payload, "1"], { encoding: "utf8" });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /common\.error\.operation/);
      assert.deepEqual(fs.readFileSync(index), original);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "{\"fixture\":true}");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native installer rejects a blank index, preserves original bytes, and migrates an identical legacy payload", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-edges-"));
  try {
    const executable = compileHarness(temp);
    const payload = path.join(temp, "payload");
    fs.mkdirSync(path.join(payload, "mod"), { recursive: true });
    fs.writeFileSync(path.join(payload, "mod/main.js"), "module.exports = {};\n");
    require("../scripts/lib/payload").emitPayload(payload);
    const prepare = (name) => {
      const base = path.join(temp, name);
      const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
      fs.mkdirSync(core, { recursive: true });
      fs.writeFileSync(path.join(core, "core.asar"), "core");
      fs.writeFileSync(path.join(core, "package.json"), "{}");
      return { base, core, index: path.join(core, "index.js") };
    };
    const blank = prepare("blank");
    fs.writeFileSync(blank.index, "");
    const rejected = childProcess.spawnSync(executable, ["install", blank.base, payload, "1"], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.equal(fs.readFileSync(blank.index, "utf8"), "");
    const spaces = prepare("spaces");
    fs.writeFileSync(spaces.index, " \n\t");
    const whitespace = childProcess.spawnSync(executable, ["install", spaces.base, payload, "1"], { encoding: "utf8" });
    assert.equal(whitespace.status, 1);
    assert.equal(fs.readFileSync(spaces.index, "utf8"), " \n\t");
    const exact = prepare("exact");
    const original = "\n  // Synthetic other injector\nrequire(\"./other.js\");\nmodule.exports = require('./core.asar');\n\n";
    fs.writeFileSync(exact.index, original);
    runHarness(executable, "install", exact.base, payload);
    runHarness(executable, "uninstall", exact.base, payload);
    assert.equal(fs.readFileSync(exact.index, "utf8"), original);
    const legacy = prepare("legacy");
    fs.cpSync(payload, path.join(legacy.core, "discord-translator-mod"), { recursive: true });
    const preserved = "require(\"./synthetic-other-injector.js\");\nmodule.exports = require('./core.asar');\n";
    fs.writeFileSync(legacy.index, "// DiscordTranslatorMod desktop-core loader\nrequire(\"./discord-translator-mod/main.js\").install();\nmodule.exports = require('./core.asar');\n");
    fs.writeFileSync(path.join(legacy.core, "index.js.dtm-original"), preserved);
    runHarness(executable, "install", legacy.base, payload);
    const migrated = fs.readFileSync(legacy.index, "utf8");
    assert.equal(migrated.includes("loader:start"), true);
    assert.equal(migrated.endsWith(preserved), true);
    assert.equal(fs.existsSync(path.join(legacy.core, "index.js.dtm-original")), false);
    assert.equal(fs.existsSync(path.join(legacy.core, "discord-translator-mod")), true);
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

test("native failures keep a published generation and do not publish over a changed index", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-fault-"));
  try {
    const executable = compileHarness(temp);
    const base = path.join(temp, "discord");
    const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
    const payload = path.join(temp, "payload");
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    const original = "require('./betterdiscord.js');\nmodule.exports = require('./core.asar');\n";
    fs.writeFileSync(path.join(core, "index.js"), original);
    const foreign = path.join(core, ".discord-translator-mod-s-d-0123456789abcdef");
    fs.mkdirSync(foreign);
    require("../scripts/lib/payload").emitPayload(payload);

    const staged = runInstalled(executable, base, payload, { BABEL_TEST_HOOK: "stage" });
    assert.notEqual(staged.status, 0, staged.stderr);
    assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), original);
    assert.equal(fs.existsSync(foreign), true);
    assert.equal(nativeGenerations(core).length, 0);

    const mutated = runInstalled(executable, base, payload, {
      BABEL_TEST_HOOK: "beforeCommit",
      BABEL_TEST_HOOK_MODE: "mutate",
    });
    assert.notEqual(mutated.status, 0, mutated.stderr);
    assert.match(mutated.stderr, /targetChanged/);
    const changed = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(changed.includes("loader:start"), false);
    assert.equal(changed.includes("/* mutated */"), true);
    assert.equal(nativeGenerations(core).length, 1);
    fs.writeFileSync(path.join(core, "index.js"), original);

    const committed = runInstalled(executable, base, payload, { BABEL_TEST_HOOK: "commit" });
    assert.notEqual(committed.status, 0, committed.stderr);
    assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), original);
    assert.equal(fs.readdirSync(core).some((name) => name.startsWith(".discord-translator-mod-i-")), false);
    assert.ok(nativeGenerations(core).length >= 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native cleanup keeps developer and unrelated entries and retains them while Discord is running or unknown", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-ownership-"));
  try {
    const executable = compileHarness(temp);
    const base = path.join(temp, "discord");
    const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
    const payload = path.join(temp, "payload");
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    fs.writeFileSync(path.join(core, "index.js"), "module.exports = require('./core.asar');\n");
    for (const name of [
      "discord-translator-mod-g-n-1-fedcba9876543210",
      "discord-translator-mod-g-d-1-0123456789abcdef",
      "discord-translator-mod",
      "unrelated-mod",
    ]) fs.mkdirSync(path.join(core, name));
    require("../scripts/lib/payload").emitPayload(payload);
    runHarness(executable, "install", base, payload, "1");
    const names = new Set(fs.readdirSync(core));
    assert.equal(names.has("discord-translator-mod-g-d-1-0123456789abcdef"), true);
    assert.equal(names.has("unrelated-mod"), true);
    assert.equal(names.has("discord-translator-mod-g-n-1-fedcba9876543210"), false);
    assert.equal(names.has("discord-translator-mod"), false);
    assert.equal([...names].filter((name) => /^discord-translator-mod-g-n-\d+-/.test(name)).length, 1);

    fs.mkdirSync(path.join(base, "discord-translator-mod"));
    runHarness(executable, "uninstall", base, payload, "2");
    assert.equal(fs.existsSync(path.join(base, "discord-translator-mod")), true);
    assert.equal([...fs.readdirSync(core)].some((name) => name.startsWith("discord-translator-mod-g-")), true);
    runHarness(executable, "install", base, payload, "3");
    runHarness(executable, "uninstall", base, payload, "3");
    assert.equal(fs.existsSync(path.join(base, "discord-translator-mod")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("native lock contention clears when the holding process exits", { skip: process.platform !== "darwin" }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-lock-"));
  try {
    const executable = compileHarness(temp);
    const base = path.join(temp, "discord");
    const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
    const payload = path.join(temp, "payload");
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    fs.writeFileSync(path.join(core, "index.js"), "module.exports = require('./core.asar');\n");
    require("../scripts/lib/payload").emitPayload(payload);
    const holder = childProcess.spawn(executable, ["hold", base, payload]);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("lock holder did not become ready")), 5000);
      holder.stdout.on("data", (chunk) => {
        if (String(chunk).includes("ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      holder.once("exit", (code) => reject(new Error(`lock holder exited early (${code})`)));
    });
    const blocked = childProcess.spawnSync(executable, ["install", base, payload, "1"], { encoding: "utf8" });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /targetLocked/);
    holder.kill("SIGKILL");
    await new Promise((resolve) => holder.once("exit", resolve));
    let released;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      released = childProcess.spawnSync(executable, ["install", base, payload, "1"], { encoding: "utf8" });
      if (released.status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(released.status, 0, released.stderr);
    assert.equal(fs.existsSync(path.join(base, ".discord-translator-mod.lock")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

function nativeGeneration(core) {
  const names = nativeGenerations(core);
  assert.equal(names.length, 1);
  return path.join(core, names[0]);
}

function nativeGenerations(core) {
  return fs.readdirSync(core).filter((name) => /^discord-translator-mod-g-n-[0-9]+-[0-9a-f]{16}$/.test(name));
}

function compileSyncDriver(temp) {
  const source = path.join(temp, "sync-driver.m");
  const executable = path.join(temp, "sync-driver");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syslimits.h>
#include <unistd.h>
static int failMode = 0;
static int ProbeFsync(int fd) {
  struct stat info;
  if (failMode && fstat(fd, &info) == 0 && S_ISREG(info.st_mode)) {
    if (failMode == 1) { errno = EIO; return -1; }
    char path[PATH_MAX];
    if (fcntl(fd, F_GETPATH, path) == 0 && strstr(path, ".discord-translator-mod-i-")) { errno = EIO; return -1; }
  }
  return fsync(fd);
}
#define fsync ProbeFsync
#import "${coreSource}"
#undef fsync
int main(int argc, const char *argv[]) { @autoreleasepool {
  if (argc < 4) return 2;
  NSString *action = @(argv[1]), *base = @(argv[2]), *payload = @(argv[3]);
  BabelSetTestActivity(1);
  if ([action isEqualToString:@"install-fsync-error"]) failMode = 1;
  if ([action isEqualToString:@"install-index-fsync-error"] || [action isEqualToString:@"uninstall-index-fsync-error"]) failMode = 2;
  NSError *error = nil;
  BOOL ok = NO;
  if ([action hasPrefix:@"install"]) ok = BabelInstall(base, payload, &error);
  else ok = BabelUninstallWithOptions(base, YES, base, [NSMutableArray array], &error);
  NSDictionary *result = @{@"ok": @(ok), @"error": error.localizedDescription ?: @""};
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\\n', stdout);
  return 0;
} }
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-DBABEL_INSTALL_TEST", "-framework", "Foundation", "-I", coreHeaderDir,
    source, "-o", executable,
  ], { stdio: "pipe" });
  return executable;
}

function runSync(executable, action, base, payload) {
  const result = childProcess.spawnSync(executable, [action, base, payload], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function compileBomDriver(temp) {
  const source = path.join(temp, "bom-driver.m");
  const executable = path.join(temp, "bom-driver");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#include <unistd.h>
static NSString *probeIndex;
static BOOL mutateBOMBeforeCommit = NO;
static int ProbeFsync(int fd) {
  int result = fsync(fd);
  if (mutateBOMBeforeCommit) {
    mutateBOMBeforeCommit = NO;
    NSData *existing = [NSData dataWithContentsOfFile:probeIndex];
    const unsigned char bom[] = {0xef, 0xbb, 0xbf};
    NSMutableData *changed = [NSMutableData dataWithBytes:bom length:3];
    [changed appendData:existing ?: [NSData data]];
    [changed writeToFile:probeIndex atomically:NO];
  }
  return result;
}
#define fsync ProbeFsync
#import "${coreSource}"
#undef fsync
int main(int argc, const char *argv[]) { @autoreleasepool {
  if (argc < 4) return 2;
  NSString *action = @(argv[1]), *base = @(argv[2]), *payload = @(argv[3]);
  BabelSetTestActivity(1);
  NSError *error = nil;
  NSMutableArray *steps = [NSMutableArray array];
  BOOL ok = NO;
  if ([action isEqualToString:@"install"]) ok = BabelInstall(base, payload, &error);
  else {
    probeIndex = [base stringByAppendingPathComponent:@"app-1.0.0/modules/discord_desktop_core/index.js"];
    mutateBOMBeforeCommit = [action isEqualToString:@"uninstall-mutate-bom"];
    ok = BabelUninstallWithOptions(base, NO, base, steps, &error);
  }
  NSDictionary *result = @{@"ok": @(ok), @"error": error.localizedDescription ?: @""};
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\\n', stdout);
  return 0;
} }
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-DBABEL_INSTALL_TEST", "-framework", "Foundation", "-I", coreHeaderDir,
    source, "-o", executable,
  ], { stdio: "pipe" });
  return executable;
}

function runBom(executable, action, base, payload) {
  const result = childProcess.spawnSync(executable, [action, base, payload], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function compileHarness(temp) {
  const source = path.join(temp, "harness.m");
  const executable = path.join(temp, "native-installer-test");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#import <fcntl.h>
#import <signal.h>
#import <sys/file.h>
#import <unistd.h>
#import "BabelInstallerCore.h"
static BOOL TestHook(NSString *step, NSString *path) {
  NSString *want = NSProcessInfo.processInfo.environment[@"BABEL_TEST_HOOK"];
  if (want.length == 0 || ![want isEqualToString:step]) return YES;
  if ([NSProcessInfo.processInfo.environment[@"BABEL_TEST_HOOK_MODE"] isEqualToString:@"mutate"]) {
    NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] ?: @"";
    [[text stringByAppendingString:@"/* mutated */\\n"] writeToFile:path atomically:NO encoding:NSUTF8StringEncoding error:nil];
    return YES;
  }
  return NO;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 4) return 2;
    BabelSetTestActivity(argc > 4 ? atoi(argv[4]) : 1);
    if (NSProcessInfo.processInfo.environment[@"BABEL_TEST_HOOK"].length) BabelSetInstallHook(TestHook);
    NSString *action = [NSString stringWithUTF8String:argv[1]];
    NSString *base = [NSString stringWithUTF8String:argv[2]];
    NSString *payload = [NSString stringWithUTF8String:argv[3]];
    if ([action isEqualToString:@"hold"]) {
      NSString *lockPath = [base stringByAppendingPathComponent:@".discord-translator-mod.lock"];
      int fd = open(lockPath.fileSystemRepresentation, O_CREAT | O_RDWR, 0600);
      if (fd < 0 || flock(fd, LOCK_EX) != 0) return 1;
      fprintf(stdout, "ready\\n");
      fflush(stdout);
      for (;;) pause();
    }
    NSError *error = nil;
    BOOL ok = [action isEqualToString:@"install"]
      ? BabelInstall(base, payload, &error)
      : BabelUninstallWithOptions(base, YES, base, [NSMutableArray array], &error);
    if (!ok) fprintf(stderr, "%s\\n", error.description.UTF8String);
    return ok ? 0 : 1;
  }
}
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-DBABEL_INSTALL_TEST", "-framework", "Foundation", "-I", coreHeaderDir,
    coreSource, source, "-o", executable
  ]);
  return executable;
}

function runHarness(executable, action, base, payload, mode = "1") {
  childProcess.execFileSync(executable, [action, base, payload, mode], { stdio: "pipe" });
}

function runInstalled(executable, base, payload, env) {
  return childProcess.spawnSync(executable, ["install", base, payload, "1"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function referencedGeneration(index) {
  const match = index.match(/require\("\.\/(discord-translator-mod-g-n-[0-9]+-[0-9a-f]{16})\/main\.js"\)/);
  assert.ok(match, index);
  return match[1];
}

function retargetPayload(payload) {
  const mainPath = path.join(payload, "main.js");
  fs.appendFileSync(mainPath, "\nexports.extra = true;\n");
  const manifestPath = path.join(payload, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const data = fs.readFileSync(mainPath);
  const entry = manifest.files.find((file) => file.path === "main.js");
  entry.bytes = data.length;
  entry.sha256 = crypto.createHash("sha256").update(data).digest("hex");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function compileResultHarness(temp) {
  const source = path.join(temp, "result-harness.m");
  const executable = path.join(temp, "result-harness");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#import "BabelInstallerCore.h"
static BOOL TestHook(NSString *step, NSString *path) {
  (void)path;
  NSString *want = NSProcessInfo.processInfo.environment[@"BABEL_TEST_HOOK"];
  if (want.length == 0 || ![want isEqualToString:step]) return YES;
  return NO;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 4) return 2;
    BabelSetTestActivity(1);
    if (NSProcessInfo.processInfo.environment[@"BABEL_TEST_HOOK"].length) BabelSetInstallHook(TestHook);
    NSString *base = [NSString stringWithUTF8String:argv[2]];
    NSString *payload = [NSString stringWithUTF8String:argv[3]];
    NSError *error = nil;
    BOOL ok = BabelInstall(base, payload, &error);
    NSString *messageID = @"";
    NSString *underlying = @"";
    NSString *description = @"";
    if (error) {
      messageID = error.userInfo[@"BabelMessageID"] ?: @"";
      description = error.localizedDescription ?: @"";
      NSError *cause = error.userInfo[NSUnderlyingErrorKey];
      if (cause) underlying = [NSString stringWithFormat:@"%@:%ld", cause.domain, (long)cause.code];
    }
    NSDictionary *result = @{@"ok": @(ok), @"messageID": messageID, @"underlying": underlying, @"error": description};
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\\n', stdout);
    return 0;
  }
}
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-DBABEL_INSTALL_TEST", "-framework", "Foundation", "-I", coreHeaderDir,
    coreSource, source, "-o", executable,
  ], { stdio: "pipe" });
  return executable;
}

function runResult(executable, action, base, payload, env = {}) {
  const result = childProcess.spawnSync(executable, [action, base, payload], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("native macOS install reports post-commit cleanup as a warning and keeps the committed payload", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-cleanup-warning-"));
  const executable = compileResultHarness(temp);
  const base = path.join(temp, "discord");
  const core = path.join(base, "app-0.0.396/modules/discord_desktop_core-1/discord_desktop_core");
  const payload = path.join(temp, "payload");
  const locked = [];
  try {
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(path.join(core, "core.asar"), "core");
    fs.writeFileSync(path.join(core, "package.json"), "{}");
    fs.writeFileSync(path.join(core, "index.js"), "module.exports = require('./core.asar');\n");
    require("../scripts/lib/payload").emitPayload(payload);
    const first = runResult(executable, "install", base, payload);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.messageID, "");
    const stale = nativeGeneration(core);
    const staleName = path.basename(stale);
    fs.writeFileSync(path.join(stale, "kept.txt"), "old");
    fs.chmodSync(stale, 0);
    locked.push(stale);
    retargetPayload(payload);
    const warned = runResult(executable, "install", base, payload);
    assert.equal(warned.ok, true, warned.error);
    assert.equal(warned.messageID, "common.detail.payloadKept");
    assert.match(warned.underlying, /NSCocoaErrorDomain/);
    const installedName = referencedGeneration(fs.readFileSync(path.join(core, "index.js"), "utf8"));
    assert.notEqual(installedName, staleName);
    assert.equal(fs.existsSync(stale), true);
    assert.match(fs.readFileSync(path.join(core, installedName, "main.js"), "utf8"), /exports\.extra = true/);
    fs.chmodSync(stale, 0o755);
    locked.pop();

    const backup = path.join(core, "index.js.dtm-original");
    fs.writeFileSync(backup, "recovery\n");
    const before = fs.readFileSync(path.join(core, "index.js"), "utf8");
    fs.chmodSync(core, 0o555);
    locked.push(core);
    const backupWarning = runResult(executable, "install", base, payload);
    assert.equal(backupWarning.ok, true, backupWarning.error);
    assert.equal(backupWarning.messageID, "common.detail.previousFileKept");
    assert.match(backupWarning.underlying, /NSCocoaErrorDomain/);
    assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), before);
    assert.equal(fs.readFileSync(backup, "utf8"), "recovery\n");
    fs.chmodSync(core, 0o755);
    locked.pop();
    const clean = runResult(executable, "install", base, payload);
    assert.equal(clean.ok, true, clean.error);
    assert.equal(clean.messageID, "");
    assert.equal(fs.existsSync(backup), false);

    retargetPayload(payload);
    const blocked = runResult(executable, "install", base, payload, { BABEL_TEST_HOOK: "beforeCommit" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.messageID, "common.error.operation");
    assert.equal(referencedGeneration(fs.readFileSync(path.join(core, "index.js"), "utf8")), installedName);
  } finally {
    for (const dir of locked) {
      try { fs.chmodSync(dir, 0o755); } catch (_) {}
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("macOS channel identity maps only verified bundle identifiers", { skip: process.platform !== "darwin" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-native-bundleid-"));
  try {
    const executable = compileBundleIDHarness(temp);
    const support = path.join(temp, "home", "Library", "Application Support");
    for (const dir of ["discord", "discordptb", "discordcanary", "discorddevelopment"]) {
      fs.mkdirSync(path.join(support, dir), { recursive: true });
    }
    const home = path.dirname(path.dirname(support));
    const alias = path.join(temp, "alias-discord");
    fs.symlinkSync(path.join(support, "discord"), alias);
    const custom = path.join(temp, "custom");
    fs.mkdirSync(custom);
    assert.equal(bundleIDFor(executable, path.join(support, "discord"), home), "com.hnc.Discord");
    assert.equal(bundleIDFor(executable, alias, home), "com.hnc.Discord");
    // PTB, Canary and Development identifiers are not verifiable from any
    // installed Info.plist on this machine, so they map to nil and keep the
    // manual restart instructions instead of a guessed identifier.
    for (const dir of ["discordptb", "discordcanary", "discorddevelopment"]) {
      assert.equal(bundleIDFor(executable, path.join(support, dir), home), null);
    }
    assert.equal(bundleIDFor(executable, custom, home), null);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

function compileBundleIDHarness(temp) {
  const source = path.join(temp, "bundle-id.m");
  const executable = path.join(temp, "bundle-id");
  fs.writeFileSync(source, `
#import <Foundation/Foundation.h>
#import "BabelInstallerCore.h"
int main(int argc, const char *argv[]) { @autoreleasepool {
  if (argc < 3) return 2;
  NSString *value = BabelChannelBundleIDForHome(@(argv[1]), @(argv[2]));
  NSData *data = [NSJSONSerialization dataWithJSONObject:@[value ?: [NSNull null]] options:0 error:NULL];
  fwrite(data.bytes, 1, data.length, stdout);
  return 0;
} }
`);
  childProcess.execFileSync("/usr/bin/clang", [
    "-fobjc-arc", "-DBABEL_INSTALL_TEST", "-framework", "Foundation", "-I", coreHeaderDir,
    coreSource, source, "-o", executable,
  ], { stdio: "pipe" });
  return executable;
}

function bundleIDFor(executable, base, home) {
  const result = childProcess.spawnSync(executable, [base, home], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout)[0];
}
