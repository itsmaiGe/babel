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
  HELP,
  installDiscordMod,
  pruneDiscordMod,
  resolveDiscordCoreDir,
  uninstallDiscordMod
} = require("../scripts/desktop-core-action");

const SRC = path.resolve(__dirname, "..", "src");

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function generations(core) {
  return fs.readdirSync(core).filter((name) => /^discord-translator-mod-g-d-[0-9]+-[0-9a-f]{16}$/.test(name));
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
    assert.equal(fs.existsSync(path.join(currentCore, BACKUP_INDEX_NAME)), false);
    assert.equal(fs.existsSync(path.join(baseDir, ".discord-translator-mod.lock")), false);
    const installed = generations(currentCore);
    assert.equal(installed.length, 1);
    assert.match(fs.readFileSync(path.join(currentCore, "index.js"), "utf8"), new RegExp(LOADER_MARKER));
    assert.equal(fs.existsSync(path.join(currentCore, installed[0], "main.js")), true);
    assert.equal(fs.existsSync(path.join(currentCore, installed[0], "shared", "settings.js")), true);
    assert.equal(fs.existsSync(path.join(currentCore, PAYLOAD_DIR_NAME)), false);
    assert.equal(fs.readFileSync(path.join(oldCore, "index.js"), "utf8"), VANILLA_INDEX);

    const userDataDir = path.join(tmp, "userdata", "discord");
    const configStore = path.join(userDataDir, PAYLOAD_DIR_NAME);
    fs.mkdirSync(configStore, { recursive: true });
    fs.writeFileSync(path.join(configStore, "api-keys.json"), "{}", "utf8");
    fs.writeFileSync(path.join(configStore, "settings.json"), "{}", "utf8");

    const kept = uninstallDiscordMod({ baseDir, userDataDir, removeProfileData: true });
    assert.equal(kept.ok, true);
    assert.equal(kept.configRemoved, false);
    assert.equal(fs.readFileSync(path.join(currentCore, "index.js"), "utf8"), VANILLA_INDEX);
    assert.equal(fs.existsSync(path.join(currentCore, installed[0])), true);
    assert.equal(fs.existsSync(configStore), true);
    assert.ok(kept.steps.some((step) => step.detailID === "common.detail.identityUnresolved"));

    const erased = uninstallDiscordMod({
      baseDir,
      userDataDir,
      removeProfileData: true,
      activity: { known: true, running: false },
    });
    assert.equal(erased.configRemoved, true);
    assert.equal(fs.existsSync(configStore), false);
    assert.equal(fs.existsSync(path.join(currentCore, installed[0])), true);

    fs.mkdirSync(configStore, { recursive: true });
    fs.writeFileSync(path.join(configStore, "settings.json"), "{}", "utf8");
    const running = uninstallDiscordMod({
      baseDir,
      userDataDir,
      removeProfileData: true,
      activity: { known: true, running: true },
    });
    assert.equal(running.configRemoved, false);
    assert.equal(fs.existsSync(configStore), true);
    assert.ok(running.steps.some((step) => step.detailID === "common.detail.discordRunning"));

    fs.mkdirSync(path.join(currentCore, PAYLOAD_DIR_NAME));
    fs.writeFileSync(path.join(currentCore, "other-injector.js"), "kept");
    const pruned = pruneDiscordMod({ baseDir });
    assert.equal(pruned.ok, true);
    assert.equal(fs.existsSync(path.join(currentCore, installed[0])), false);
    assert.equal(fs.existsSync(path.join(currentCore, PAYLOAD_DIR_NAME)), false);
    assert.equal(fs.existsSync(path.join(currentCore, "other-injector.js")), true);
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
    const original = `${bdLine}\nmodule.exports = require('./core.asar');\n`;
    fs.writeFileSync(path.join(core, "index.js"), original, "utf8");

    const installed = installDiscordMod({ baseDir, payloadSource: SRC });

    const patched = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.match(patched, new RegExp(LOADER_MARKER));
    assert.ok(patched.includes(bdLine), "BetterDiscord's injection must be preserved");
    assert.ok(patched.includes("core.asar"), "the core export must remain");
    assert.ok(patched.indexOf(BLOCK_START) < patched.indexOf(bdLine), "Babel's hook should be prepended");
    assert.equal(fs.existsSync(path.join(core, PAYLOAD_DIR_NAME)), false);

    const userDataDir = path.join(tmp, "userdata", "discord");
    uninstallDiscordMod({ baseDir, userDataDir, removeProfileData: true });
    const afterUninstall = fs.readFileSync(path.join(core, "index.js"), "utf8");
    assert.equal(afterUninstall, original, "uninstall restores the supplied original bytes");
    assert.equal(fs.existsSync(installed.payloadDest), true);
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

    const first = installDiscordMod({ baseDir, payloadSource: SRC });
    const indexStat = fs.statSync(path.join(core, "index.js"));
    const payloadStat = fs.statSync(first.payloadDest);
    installDiscordMod({ baseDir, payloadSource: SRC });

    const patched = fs.readFileSync(path.join(core, "index.js"), "utf8");
    const again = fs.statSync(path.join(core, "index.js"));
    const payloadAgain = fs.statSync(first.payloadDest);
    assert.equal(countOccurrences(patched, BLOCK_START), 1, "exactly one Babel block");
    assert.equal(countOccurrences(patched, bdLine), 1, "the other injector is preserved exactly once");
    assert.equal(again.ino, indexStat.ino);
    assert.equal(again.mtimeMs, indexStat.mtimeMs);
    assert.equal(payloadAgain.ino, payloadStat.ino);
    assert.equal(payloadAgain.mtimeMs, payloadStat.mtimeMs);
    assert.deepEqual(generations(core), [path.basename(first.payloadDest)]);
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

    assert.throws(
      () => installDiscordMod({ baseDir, payloadSource: SRC }),
      (error) => error.message === `Refusing to patch an unrecognized Discord desktop core index at ${path.join(core, "index.js")}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("publish and index-commit failures leave the previous loader usable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-install-fault-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const indexPath = path.join(core, "index.js");
    const original = fs.readFileSync(indexPath);
    const foreign = path.join(core, ".discord-translator-mod-s-n-0123456789abcdef");
    fs.mkdirSync(foreign);
    assert.throws(
      () => installDiscordMod({
        baseDir,
        payloadSource: SRC,
        hooks: { stage() { throw new Error("stage failed"); } },
      }),
      /stage failed/,
    );
    assert.deepEqual(fs.readFileSync(indexPath), original);
    assert.equal(fs.existsSync(foreign), true);
    assert.deepEqual(generations(core), []);
    assert.deepEqual(
      fs.readdirSync(core).filter((name) => name.startsWith(".discord-translator-mod-s-")),
      [path.basename(foreign)],
    );

    assert.throws(
      () => installDiscordMod({
        baseDir,
        payloadSource: SRC,
        hooks: {
          beforeCommit(index) { fs.appendFileSync(index, "/* mutated */\n"); },
        },
      }),
      (error) => error.code === "common.error.targetChanged",
    );
    const mutated = fs.readFileSync(indexPath, "utf8");
    assert.equal(mutated.includes(BLOCK_START), false);
    assert.equal(mutated.includes("/* mutated */"), true);
    assert.equal(generations(core).length, 1);
    fs.writeFileSync(indexPath, original);

    assert.throws(
      () => installDiscordMod({
        baseDir,
        payloadSource: SRC,
        hooks: { commit() { throw new Error("commit failed"); } },
      }),
      /commit failed/,
    );
    assert.deepEqual(fs.readFileSync(indexPath), original);
    assert.equal(fs.readdirSync(core).some((name) => name.startsWith(".discord-translator-mod-i-")), false);
    assert.ok(generations(core).length >= 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("installer refuses an incomplete core instead of manufacturing index.js", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-core-incomplete-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    fs.rmSync(path.join(core, "index.js"));
    assert.throws(
      () => installDiscordMod({ baseDir, payloadSource: SRC }),
      (error) => error.code === "common.error.coreIncomplete",
    );
    assert.equal(fs.existsSync(path.join(core, "index.js")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("manual reinstall patches a newly simulated Discord core and leaves the older hook", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-core-reinstall-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const older = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    installDiscordMod({ baseDir, payloadSource: SRC });
    const previous = fs.readFileSync(path.join(older, "index.js"));
    const newer = createDesktopCore(baseDir, "app-0.0.396", "discord_desktop_core-1/discord_desktop_core");
    const result = installDiscordMod({ baseDir, payloadSource: SRC });
    assert.equal(result.coreDir, newer);
    assert.match(fs.readFileSync(path.join(newer, "index.js"), "utf8"), new RegExp(LOADER_MARKER));
    assert.deepEqual(fs.readFileSync(path.join(older, "index.js")), previous);
    assert.equal(generations(newer).length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("developer help states the unlocked CLI and the prune precondition", () => {
  assert.match(HELP, /does not lock/);
  assert.match(HELP, /Overlap is unsupported/);
  assert.match(HELP, /--prune/);
  assert.match(HELP, /no installer of any route/);
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/desktop-core-action.js", "--help"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${HELP}\n`);
});

test("installer rejects a blank or incomplete core without inventing vanilla index.js", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-blank-index-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const index = path.join(core, "index.js");
    for (const content of ["", " \n\t", "\r\n"]) {
      fs.writeFileSync(index, content);
      assert.throws(
        () => installDiscordMod({ baseDir, payloadSource: SRC }),
        (error) => error.code === "common.error.coreIncomplete",
      );
      assert.equal(fs.readFileSync(index, "utf8"), content);
      assert.deepEqual(generations(core), []);
    }
    fs.writeFileSync(index, VANILLA_INDEX);
    fs.writeFileSync(path.join(core, "core.asar"), "");
    assert.throws(
      () => installDiscordMod({ baseDir, payloadSource: SRC }),
      (error) => error.code === "common.error.coreIncomplete",
    );
    assert.equal(fs.readFileSync(index, "utf8"), VANILLA_INDEX);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("install and uninstall preserve non-Babel bytes exactly", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-exact-bytes-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const index = path.join(core, "index.js");
    const original = "\n  // Synthetic other injector\r\nrequire(\"./other.js\");  \r\nmodule.exports = require('./core.asar');\r\n\n";
    fs.writeFileSync(index, original);
    installDiscordMod({ baseDir, payloadSource: SRC });
    uninstallDiscordMod({ baseDir });
    assert.equal(fs.readFileSync(index, "utf8"), original);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("uninstall re-reads index.js after syncing the candidate", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-uninstall-race-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const index = path.join(core, "index.js");
    fs.writeFileSync(index, VANILLA_INDEX);
    installDiscordMod({ baseDir, payloadSource: SRC });
    const originalHook = fs.readFileSync(index, "utf8");
    const addition = "\n// Synthetic external modification before final read\n";
    const sync = fs.fsyncSync;
    let injected = false;
    let result;
    try {
      fs.fsyncSync = function patchedSync(fd) {
        const value = sync.call(fs, fd);
        if (!injected) {
          injected = true;
          fs.appendFileSync(index, addition);
        }
        return value;
      };
      result = uninstallDiscordMod({ baseDir });
    } finally {
      fs.fsyncSync = sync;
    }
    assert.equal(injected, true);
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(index, "utf8"), originalHook + addition);
    assert.equal(generations(core).length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("an identical legacy payload migrates before its backup is removed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-legacy-same-"));
  try {
    const baseDir = path.join(tmp, "discord");
    const core = createDesktopCore(baseDir, "app-0.0.395", "discord_desktop_core-1/discord_desktop_core");
    const index = path.join(core, "index.js");
    const backup = path.join(core, BACKUP_INDEX_NAME);
    require("../scripts/lib/payload").emitPayload(path.join(core, PAYLOAD_DIR_NAME));
    const legacy = `// ${LOADER_MARKER}\nrequire("./discord-translator-mod/main.js").install();\n${VANILLA_INDEX}`;
    const original = `require("./synthetic-other-injector.js");\n${VANILLA_INDEX}`;
    fs.writeFileSync(index, legacy);
    fs.writeFileSync(backup, original);
    assert.throws(
      () => installDiscordMod({
        baseDir,
        payloadSource: SRC,
        hooks: { beforeCommit(target) { fs.appendFileSync(target, "\n// changed\n"); } },
      }),
      (error) => error.code === "common.error.targetChanged",
    );
    assert.equal(fs.existsSync(backup), true);
    assert.equal(fs.readFileSync(backup, "utf8"), original);
    assert.equal(fs.readFileSync(index, "utf8").includes(BLOCK_START), false);
    fs.writeFileSync(index, legacy);
    installDiscordMod({ baseDir, payloadSource: SRC });
    const current = fs.readFileSync(index, "utf8");
    assert.equal(current.includes("synthetic-other-injector"), true);
    assert.equal(current.includes(BLOCK_START), true);
    assert.equal(current.endsWith(original), true);
    assert.equal(fs.existsSync(backup), false);
    assert.equal(fs.existsSync(path.join(core, PAYLOAD_DIR_NAME)), true);
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
