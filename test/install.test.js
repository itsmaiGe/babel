"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  BACKUP_INDEX_NAME,
  LOADER_MARKER,
  PAYLOAD_DIR_NAME,
  VANILLA_INDEX,
  installDiscordMod,
  resolveDiscordCoreDir,
  uninstallDiscordMod
} = require("../scripts/desktop-core-action");

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
    assert.equal(fs.readFileSync(path.join(currentCore, BACKUP_INDEX_NAME), "utf8"), VANILLA_INDEX);
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

test("installer refuses to overwrite an unknown desktop core index", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-core-conflict-test-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    fs.writeFileSync(path.join(core, "index.js"), "require('./other-mod');\nmodule.exports = require('./core.asar');\n", "utf8");

    assert.throws(() => installDiscordMod({
      baseDir,
      payloadSource: path.resolve(__dirname, "..", "src")
    }), /Refusing to overwrite/);
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
