"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  BACKUP_INDEX_NAME,
  LOADER_MARKER,
  BLOCK_START,
  PAYLOAD_DIR_NAME,
  VANILLA_INDEX,
  installDiscordMod,
  resolveDiscordCoreDir,
  uninstallDiscordMod
} = require("../scripts/desktop-core-action");

const SRC = path.resolve(__dirname, "..", "src");

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("installer patches and uninstaller restores the newest Discord desktop core", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-core-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const oldCore = createDesktopCore(baseDir, "0.0.394", "discord_desktop_core");
    const currentCore = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");

    assert.equal(resolveDiscordCoreDir({ baseDir }), currentCore);

    const result = installDiscordMod({
      baseDir,
      payloadSource: path.resolve(__dirname, "..", "src")
    });

    assert.equal(result.coreDir, currentCore);
    // The additive install no longer writes a backup file.
    assert.equal(fs.existsSync(path.join(currentCore, BACKUP_INDEX_NAME)), false);
    assert.match(fs.readFileSync(path.join(currentCore, "index.js"), "utf8"), new RegExp(LOADER_MARKER));
    assert.equal(fs.existsSync(path.join(currentCore, PAYLOAD_DIR_NAME, "main.js")), true);
    assert.equal(fs.existsSync(path.join(currentCore, PAYLOAD_DIR_NAME, "shared", "settings.js")), true);
    assert.equal(fs.readFileSync(path.join(oldCore, "index.js"), "utf8"), VANILLA_INDEX);

    // Stored config (settings + API keys + cache) lives under the userData dir; a
    // temp one keeps the test from ever touching the developer's real config.
    const userDataDir = path.join(tmp, "userdata", "discord");
    const configStore = path.join(userDataDir, PAYLOAD_DIR_NAME);
    fs.mkdirSync(configStore, { recursive: true });
    fs.writeFileSync(path.join(configStore, "api-keys.json"), "{}", "utf8");
    fs.writeFileSync(path.join(configStore, "settings.json"), "{}", "utf8");

    const uninstallResult = uninstallDiscordMod({ baseDir, userDataDir });
    // index restore + payload removal + config wipe.
    assert.equal(uninstallResult.changed, 3);
    assert.equal(uninstallResult.configRemoved, true);
    assert.equal(fs.readFileSync(path.join(currentCore, "index.js"), "utf8"), VANILLA_INDEX);
    assert.equal(fs.existsSync(path.join(currentCore, BACKUP_INDEX_NAME)), false);
    assert.equal(fs.existsSync(path.join(currentCore, PAYLOAD_DIR_NAME)), false);
    // The API key / settings files are gone after uninstall.
    assert.equal(fs.existsSync(configStore), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("uninstall keeps stored config when keepConfig is set", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-keep-config-"));
  try {
    const baseDir = path.join(tmp, "discord");
    createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const userDataDir = path.join(tmp, "userdata", "discord");
    const configStore = path.join(userDataDir, PAYLOAD_DIR_NAME);
    fs.mkdirSync(configStore, { recursive: true });
    fs.writeFileSync(path.join(configStore, "api-keys.json"), "{}", "utf8");

    const result = uninstallDiscordMod({ baseDir, userDataDir, keepConfig: true });
    assert.equal(result.configRemoved, false);
    assert.equal(fs.existsSync(configStore), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("installer coexists with another desktop-core injector (e.g. BetterDiscord)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-coexist-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    // Simulate BetterDiscord having patched index.js first.
    const bdLine = "require('./betterdiscord-injector');";
    fs.writeFileSync(path.join(core, "index.js"), `${bdLine}\nmodule.exports = require('./core.asar');\n`, "utf8");

    installDiscordMod({ baseDir, payloadSource: SRC });

    const patched = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.match(patched, new RegExp(LOADER_MARKER));
    assert.ok(patched.includes(bdLine), "BetterDiscord's injection must be preserved");
    assert.ok(patched.includes("core.asar"), "the core export must remain");
    assert.ok(patched.indexOf(BLOCK_START) < patched.indexOf(bdLine), "Babel's hook should be prepended");

    // Uninstall strips only Babel's block, leaving BetterDiscord intact.
    const userDataDir = path.join(tmp, "userdata", "discord");
    uninstallDiscordMod({ baseDir, userDataDir });
    const afterUninstall = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(afterUninstall.includes(LOADER_MARKER), false, "Babel's hook is removed");
    assert.ok(afterUninstall.includes(bdLine), "BetterDiscord's injection survives uninstall");
    assert.ok(afterUninstall.includes("core.asar"));
    assert.equal(fs.existsSync(path.join(core, PAYLOAD_DIR_NAME)), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("re-installing is idempotent — the hook is not duplicated, the other injector stays once", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-idempotent-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const bdLine = "require('./betterdiscord-injector');";
    fs.writeFileSync(path.join(core, "index.js"), `${bdLine}\nmodule.exports = require('./core.asar');\n`, "utf8");

    installDiscordMod({ baseDir, payloadSource: SRC });
    installDiscordMod({ baseDir, payloadSource: SRC });

    const patched = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(countOccurrences(patched, BLOCK_START), 1, "exactly one Babel block");
    assert.equal(countOccurrences(patched, bdLine), 1, "the other injector is preserved exactly once");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("upgrading from the legacy whole-file loader recovers the backed-up injection", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-legacy-migrate-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const bdLine = "require('./betterdiscord-injector');";
    // The old whole-file loader clobbered BetterDiscord but saved it as the backup.
    fs.writeFileSync(path.join(core, BACKUP_INDEX_NAME), `${bdLine}\nmodule.exports = require('./core.asar');\n`, "utf8");
    const legacyLoader = `/* ${LOADER_MARKER} */\ntry { require('./discord-translator-mod/main.js').install(); } catch (e) {}\nmodule.exports = require('./core.asar');\n`;
    fs.writeFileSync(path.join(core, "index.js"), legacyLoader, "utf8");

    installDiscordMod({ baseDir, payloadSource: SRC });

    const patched = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.match(patched, new RegExp(LOADER_MARKER));
    assert.ok(patched.includes(bdLine), "BetterDiscord is recovered from the legacy backup");
    assert.equal(countOccurrences(patched, BLOCK_START), 1);
    assert.equal(fs.existsSync(path.join(core, BACKUP_INDEX_NAME)), false, "stale backup is cleaned up");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("installer refuses an unrecognized index that does not load core.asar", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-core-conflict-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    fs.writeFileSync(path.join(core, "index.js"), "console.log('a totally different module');\n", "utf8");

    assert.throws(() => installDiscordMod({ baseDir, payloadSource: SRC }), /Refusing to patch an unrecognized/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function createDesktopCore(baseDir, versionDir, coreRelativeDir) {
  const coreDir = path.join(baseDir, versionDir, "modules", coreRelativeDir);
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({
    name: "discord_desktop_core",
    version: "0.0.0",
    private: "true",
    main: "index.js"
  }), "utf8");
  fs.writeFileSync(path.join(coreDir, "index.js"), VANILLA_INDEX, "utf8");
  fs.writeFileSync(path.join(coreDir, "core.asar"), "fake core", "utf8");
  return coreDir;
}
