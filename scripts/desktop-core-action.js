#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKUP_INDEX_NAME = "index.js.dtm-original";
const LOADER_MARKER = "DiscordTranslatorMod desktop-core loader";
const BLOCK_START = `/* ${LOADER_MARKER}:start */`;
const BLOCK_END = `/* ${LOADER_MARKER}:end */`;
const PAYLOAD_DIR_NAME = "discord-translator-mod";
const VANILLA_INDEX = "module.exports = require('./core.asar');\n";
const ROUTE = "d";
const GENERATION_RE = /^discord-translator-mod-g-[nd]-[0-9]+-[0-9a-f]{16}$/;
const STAGE_RE = /^\.discord-translator-mod-s-[nd]-[0-9a-f]{16}$/;
const INDEX_TEMP_RE = /^\.discord-translator-mod-i-[nd]-[0-9a-f]{16}$/;
const PAYLOAD_REF_RE =
  /require\(\s*(['"])\.\/(discord-translator-mod(?:-g-[nd]-[0-9]+-[0-9a-f]{16})?)\/main(?:\.js)?\1\s*\)/;

const HELP = `Usage:
  node scripts/desktop-core-action.js install --payload-source <dir> [--base-dir <dir>]
  node scripts/desktop-core-action.js uninstall [--base-dir <dir>] [--remove-profile-data] [--prune]
  node scripts/desktop-core-action.js prune [--base-dir <dir>]

The developer CLI does not lock the target. No other install, prune, or
uninstall from any route may operate on that Discord target at the same time.
Overlap is unsupported. A non-overlapping rerun repairs an interrupted install.

--prune confirms both that Discord for the selected target is closed and that
no installer of any route is operating. It removes only unreferenced Babel
payload directories.
`;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockPattern() {
  return new RegExp(
    `${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\n?`,
    "g",
  );
}

function installError(id, message) {
  const error = new Error(message);
  error.code = id;
  return error;
}

function randomHex() {
  return crypto.randomBytes(8).toString("hex");
}

function loaderBlock(name) {
  return (
    `${BLOCK_START}\n` +
    "try {\n" +
    `  require("./${name}/main.js").install();\n` +
    "} catch (error) {\n" +
    '  console.error("[Babel] Failed to install hook:", error);\n' +
    "}\n" +
    `${BLOCK_END}\n`
  );
}

function manifestIdentity(manifest) {
  const files = [...(manifest.files || [])]
    .map((entry) => ({
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify({ version: manifest.version, files });
}

function referencedPayload(indexText) {
  const text = String(indexText || "");
  let scope = "";
  if (text.includes(BLOCK_START)) scope = (text.match(blockPattern()) || []).join("\n");
  else if (text.includes(LOADER_MARKER)) scope = text;
  const match = scope.match(PAYLOAD_REF_RE);
  return match ? match[2] : "";
}

function isPayloadName(name) {
  return name === PAYLOAD_DIR_NAME || GENERATION_RE.test(name) || STAGE_RE.test(name);
}

function isOwnedName(name) {
  return isPayloadName(name) || INDEX_TEMP_RE.test(name);
}

function fsyncDir(directory) {
  try {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {}
}

function fsyncTree(root) {
  const dirs = [];
  const walk = (directory) => {
    dirs.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const fd = fs.openSync(full, "r+");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    }
  };
  walk(root);
  for (const directory of dirs.reverse()) fsyncDir(directory);
}

function assertCoreReady(coreDir) {
  for (const name of ["index.js", "core.asar", "package.json"]) {
    const file = path.join(coreDir, name);
    let info;
    try {
      info = fs.lstatSync(file);
    } catch (_) {
      throw installError(
        "common.error.coreIncomplete",
        "Discord is still updating this installation. Try again when it finishes.",
      );
    }
    if (info.isSymbolicLink() || !info.isFile() || info.size === 0)
      throw installError(
        "common.error.coreIncomplete",
        "Discord is still updating this installation. Try again when it finishes.",
      );
  }
  return path.join(coreDir, "index.js");
}

function preservedBase(coreDir, current) {
  const legacy = current.includes(LOADER_MARKER) && !current.includes(BLOCK_START);
  if (!legacy && !String(current).trim()) {
    throw installError(
      "common.error.coreIncomplete",
      "Discord is still updating this installation. Try again when it finishes.",
    );
  }
  if (!legacy) return baseIndex(current);
  const backupPath = path.join(coreDir, BACKUP_INDEX_NAME);
  let info;
  try {
    info = fs.lstatSync(backupPath);
  } catch (error) {
    if (error.code === "ENOENT") return baseIndex(current);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile())
    throw installError(
      "common.error.coreIncomplete",
      "Discord is still updating this installation. Try again when it finishes.",
    );
  return baseIndex(fs.readFileSync(backupPath, "utf8"));
}

function matchingGeneration(coreDir, indexText, sourceRoot) {
  const name = referencedPayload(indexText);
  if (!name) return "";
  try {
    const payload = require("./lib/payload");
    const current = payload.validatePayload(path.join(coreDir, name));
    const requested = payload.describePayload(sourceRoot);
    return manifestIdentity(current) === manifestIdentity(requested) ? name : "";
  } catch (_) {
    return "";
  }
}

function removeOwnStage(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
}

function publishGeneration(sourceRoot, coreDir, hooks) {
  const stage = path.join(coreDir, `.discord-translator-mod-s-${ROUTE}-${randomHex()}`);
  const destination = path.join(
    coreDir,
    `discord-translator-mod-g-${ROUTE}-${Date.now()}-${randomHex()}`,
  );
  fs.mkdirSync(stage);
  try {
    copyPayload(sourceRoot, stage);
    fsyncTree(stage);
    const payload = require("./lib/payload");
    const staged = payload.validatePayload(stage);
    const requested = payload.describePayload(sourceRoot);
    if (manifestIdentity(staged) !== manifestIdentity(requested))
      throw installError(
        "common.error.payloadIntegrity",
        "The staged payload failed integrity checks.",
      );
    if (hooks.stage) hooks.stage(stage);
    if (hooks.publish) hooks.publish(stage);
    fs.renameSync(stage, destination);
  } catch (error) {
    removeOwnStage(stage);
    throw error;
  }
  fsyncDir(coreDir);
  try {
    require("./lib/payload").validatePayload(destination);
  } catch (_) {}
  return destination;
}

function commitIndex(indexPath, contents, snapshot, hooks) {
  const temp = path.join(
    path.dirname(indexPath),
    `.discord-translator-mod-i-${ROUTE}-${randomHex()}`,
  );
  const fd = fs.openSync(temp, "w", 0o644);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const abort = (error) => {
    fs.rmSync(temp, { force: true });
    throw error;
  };
  let again;
  try {
    again = fs.readFileSync(indexPath);
  } catch (error) {
    abort(error);
  }
  if (!again.equals(snapshot))
    abort(
      installError(
        "common.error.targetChanged",
        "Discord changed this installation during the operation. Try again.",
      ),
    );
  if (hooks.commit) {
    try {
      hooks.commit(indexPath);
    } catch (error) {
      abort(error);
    }
  }
  try {
    fs.renameSync(temp, indexPath);
  } catch (error) {
    abort(error);
  }
  fsyncDir(path.dirname(indexPath));
  try {
    fs.readFileSync(indexPath);
  } catch (_) {}
}

function removeMigrationBackup(coreDir) {
  const backupPath = path.join(coreDir, BACKUP_INDEX_NAME);
  let info;
  try {
    info = fs.lstatSync(backupPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (info.isFile() && !info.isSymbolicLink()) fs.rmSync(backupPath);
}

function retainedPayloads(coreDir, activeName) {
  let names = [];
  try {
    names = fs.readdirSync(coreDir);
  } catch (_) {
    return [];
  }
  return names
    .filter((name) => isPayloadName(name) && name !== activeName)
    .sort()
    .map((name) => path.join(coreDir, name));
}

function installDiscordMod(options = {}) {
  const hooks = options.hooks || {};
  const payloadSource = requirePayloadSource(options.payloadSource);
  const coreDir = resolveDiscordCoreDir(options);
  const indexPath = assertCoreReady(coreDir);
  const snapshot = fs.readFileSync(indexPath);
  const current = snapshot.toString("utf8");
  const base = preservedBase(coreDir, current);
  if (!base.includes("core.asar"))
    throw new Error(
      `Refusing to patch an unrecognized Discord desktop core index at ${indexPath}`,
    );
  const legacyWholeFile = current.includes(LOADER_MARKER) && !current.includes(BLOCK_START);
  const active = matchingGeneration(coreDir, current, payloadSource);
  if (active && !legacyWholeFile) {
    removeMigrationBackup(coreDir);
    const payloadDest = path.join(coreDir, active);
    return {
      coreDir,
      indexPath,
      payloadDest,
      retained: retainedPayloads(coreDir, active),
    };
  }
  const payloadDest = active
    ? path.join(coreDir, active)
    : publishGeneration(payloadSource, coreDir, hooks);
  const changed = installError(
    "common.error.targetChanged",
    "Discord changed this installation during the operation. Try again.",
  );
  if (!fs.readFileSync(indexPath).equals(snapshot)) throw changed;
  if (hooks.beforeCommit) hooks.beforeCommit(indexPath);
  if (!fs.readFileSync(indexPath).equals(snapshot)) throw changed;
  commitIndex(
    indexPath,
    Buffer.from(loaderBlock(path.basename(payloadDest)) + base, "utf8"),
    snapshot,
    hooks,
  );
  removeMigrationBackup(coreDir);
  return {
    coreDir,
    indexPath,
    payloadDest,
    retained: retainedPayloads(coreDir, path.basename(payloadDest)),
  };
}

function contained(parent, child) {
  let parentReal, childReal;
  try {
    parentReal = fs.realpathSync(parent);
    childReal = fs.realpathSync(child);
  } catch (_) {
    return false;
  }
  const relative = path.relative(parentReal, childReal);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function removeOwnedEntry(coreDir, name) {
  const full = path.join(coreDir, name);
  const info = fs.lstatSync(full);
  if (info.isSymbolicLink() || !contained(coreDir, full))
    throw installError(
      "common.error.payloadUnsafe",
      "Refusing to remove a linked payload path.",
    );
  fs.rmSync(full, { recursive: true });
}

function pruneDiscordMod(options = {}) {
  const result = { ok: true, removed: [], retained: [], steps: [], errors: [] };
  for (const coreDir of resolveAllDiscordCoreDirs(options)) {
    const indexPath = path.join(coreDir, "index.js");
    let names = [];
    try {
      names = fs.readdirSync(coreDir);
    } catch (error) {
      result.ok = false;
      result.errors.push(error.message);
      continue;
    }
    for (const name of names.filter(isOwnedName).sort()) {
      const full = path.join(coreDir, name);
      let text = "";
      let readable = true;
      try {
        text = fs.readFileSync(indexPath, "utf8");
      } catch (error) {
        readable = false;
        if (error.code !== "ENOENT") {
          result.ok = false;
          result.errors.push(error.message);
          result.retained.push(full);
          result.steps.push({
            path: full,
            action: "remove payload",
            state: "kept",
            detail: "Plugin files were kept.",
            detailID: "common.detail.payloadKept",
          });
          continue;
        }
      }
      if (!readable) text = "";
      if (referencedPayload(text) === name) {
        result.retained.push(full);
        result.steps.push({
          path: full,
          action: "remove payload",
          state: "kept",
          detail: "Plugin files were kept.",
          detailID: "common.detail.payloadKept",
        });
        continue;
      }
      try {
        removeOwnedEntry(coreDir, name);
        result.removed.push(full);
        result.steps.push({
          path: full,
          action: "remove payload",
          state: "done",
          detail: "",
        });
      } catch (error) {
        if (error.code === "ENOENT") continue;
        result.ok = false;
        result.errors.push(error.message);
        result.steps.push({
          path: full,
          action: "remove payload",
          state: "failed",
          detail: error.message,
        });
      }
    }
  }
  return result;
}

function imageRunning(image) {
  try {
    if (process.platform === "win32") {
      const output = childProcess.execFileSync(
        "tasklist",
        ["/FI", `IMAGENAME eq ${image}`, "/NH"],
        { encoding: "utf8" },
      );
      return output.toLowerCase().includes(image.toLowerCase());
    }
    const result = childProcess.spawnSync("pgrep", ["-x", image], { encoding: "utf8" });
    if (result.error) return true;
    if (result.status === 1) return false;
    return true;
  } catch (_) {
    return true;
  }
}

function discordActivity(baseDir, options) {
  if (options.activity && typeof options.activity === "object")
    return {
      known: options.activity.known === true,
      running: options.activity.running === true,
    };
  let resolved;
  try {
    resolved = fs.realpathSync(baseDir);
  } catch (_) {
    return { known: false, running: false };
  }
  const home = os.homedir();
  const table =
    process.platform === "darwin"
      ? [
          [path.join(home, "Library/Application Support/discord"), "Discord"],
          [path.join(home, "Library/Application Support/discordptb"), "Discord PTB"],
          [path.join(home, "Library/Application Support/discordcanary"), "Discord Canary"],
          [
            path.join(home, "Library/Application Support/discorddevelopment"),
            "Discord Development",
          ],
        ]
      : process.platform === "win32"
        ? [
            [path.join(process.env.LOCALAPPDATA || "", "Discord"), "Discord.exe"],
            [path.join(process.env.LOCALAPPDATA || "", "DiscordPTB"), "DiscordPTB.exe"],
            [path.join(process.env.LOCALAPPDATA || "", "DiscordCanary"), "DiscordCanary.exe"],
            [
              path.join(process.env.LOCALAPPDATA || "", "DiscordDevelopment"),
              "DiscordDevelopment.exe",
            ],
          ]
        : [];
  for (const [dir, image] of table) {
    try {
      if (fs.realpathSync(dir) === resolved) return { known: true, running: imageRunning(image) };
    } catch (_) {}
  }
  return { known: false, running: false };
}

function profileIsUnsafe(profile) {
  if (!profile.store) return false;
  try {
    const info = fs.lstatSync(profile.store);
    return info.isSymbolicLink() || !info.isDirectory();
  } catch (error) {
    return error.code !== "ENOENT";
  }
}

function selectedProfile(options) {
  let directory;
  if (options.userDataDir) directory = path.resolve(options.userDataDir);
  else if (process.platform !== "win32") directory = discordBaseDir(options);
  else {
    const selected = fs.statSync(discordBaseDir(options));
    for (const name of ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"]) {
      const candidate = path.join(process.env.LOCALAPPDATA || "", name);
      try {
        const info = fs.statSync(candidate);
        if (info.dev === selected.dev && info.ino === selected.ino && process.env.APPDATA)
          directory = path.join(process.env.APPDATA, name.toLowerCase());
      } catch (_) {}
    }
  }
  if (!directory) return { state: "Unknown" };
  const store = path.join(directory, PAYLOAD_DIR_NAME);
  try {
    const info = fs.lstatSync(store);
    return {
      directory,
      store,
      state: info.isDirectory() && !info.isSymbolicLink() ? "Known" : "Unknown",
    };
  } catch (error) {
    return { directory, store, state: error.code === "ENOENT" ? "KnownAbsent" : "Unknown" };
  }
}

function uninstallDiscordMod(options = {}) {
  const coreDirs = resolveAllDiscordCoreDirs(options);
  const profile = selectedProfile(options);
  const removeData = options.removeProfileData === true && !options.keepConfig;
  // Refuse loudly instead of erasing anything when the erase target is not a
  // safely identified profile store: a profile the platform cannot match ("unmatched")
  // or a linked store. The native erases enforce the same rule (Go profileUnknown,
  // macOS profileUnsafe), and nothing below may delete an unidentified store.
  if (removeData && (profile.state === "Unknown" || profileIsUnsafe(profile)))
    throw new Error("Refusing to erase an unmatched or linked profile store.");
  const activity = discordActivity(discordBaseDir(options), options);
  const result = {
    coreDirs,
    changed: 0,
    configRemoved: false,
    steps: [],
    errors: [],
    ok: true,
    retained: [],
  };
  function push(target, action, state, detail, detailID) {
    result.steps.push({ path: target, action, state, detail: detail || "", detailID: detailID || "" });
  }
  function step(target, action, operation) {
    try {
      const changed = operation();
      push(target, action, changed ? "done" : "already absent", "");
      if (changed) result.changed += 1;
      return true;
    } catch (error) {
      result.ok = false;
      result.errors.push(error.message);
      push(target, action, "failed", error.message);
      return false;
    }
  }
  for (const coreDir of coreDirs) {
    const index = path.join(coreDir, "index.js");
    const backup = path.join(coreDir, BACKUP_INDEX_NAME);
    const detached = step(index, "detach", () => {
      let snapshot;
      try {
        snapshot = fs.readFileSync(index);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      const current = snapshot.toString("utf8");
      if (!current.includes(LOADER_MARKER)) return false;
      let restored;
      if (current.includes(BLOCK_START)) restored = baseIndex(current);
      else {
        let info;
        try {
          info = fs.lstatSync(backup);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          info = null;
        }
        if (info && (info.isSymbolicLink() || !info.isFile()))
          throw new Error("The legacy recovery file is incomplete.");
        restored = info ? fs.readFileSync(backup, "utf8") : VANILLA_INDEX;
      }
      commitIndex(index, Buffer.from(restored, "utf8"), snapshot, options.hooks || {});
      return true;
    });
    if (!detached) {
      push(backup, "remove backup", "not attempted", "Restore failed; recovery material retained.", "common.detail.backupRetained");
      push(
        path.join(coreDir, PAYLOAD_DIR_NAME),
        "remove payload",
        "not attempted",
        "Restore failed; plugin files were kept.",
        "common.detail.payloadRetained",
      );
      continue;
    }
    step(backup, "remove backup", () => {
      let info;
      try {
        info = fs.lstatSync(backup);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error("The legacy recovery file is incomplete.");
      fs.rmSync(backup);
      return true;
    });
    if (!options.prune) {
      let text = "";
      try {
        text = fs.readFileSync(index, "utf8");
      } catch (_) {}
      const kept = retainedPayloads(coreDir, referencedPayload(text));
      if (kept.length === 0)
        push(path.join(coreDir, PAYLOAD_DIR_NAME), "remove payload", "already absent", "");
      for (const full of kept) {
        result.retained.push(full);
        push(full, "remove payload", "kept", "Plugin files were kept.", "common.detail.payloadKept");
      }
    }
  }
  if (options.prune && result.ok) {
    const pruned = pruneDiscordMod(options);
    result.steps.push(...pruned.steps);
    result.removed = pruned.removed;
    result.retained.push(...pruned.retained);
    if (!pruned.ok) {
      result.ok = false;
      result.errors.push(...pruned.errors);
    }
  }
  if (!removeData || !result.ok)
    push(
      profile.store || "",
      "profile data",
      "kept",
      result.ok
        ? "Saved settings, API keys and cache retained."
        : "Uninstall incomplete; saved data retained.",
      result.ok ? "common.detail.kept" : "common.detail.incomplete",
    );
  else if (!activity.known || activity.running)
    push(
      profile.store || "",
      "profile data",
      "kept",
      activity.running
        ? "Discord is open, so plugin files and saved data were kept."
        : "Discord identity is unknown, so plugin files and saved data were kept.",
      activity.running ? "common.detail.discordRunning" : "common.detail.identityUnresolved",
    );
  else if (profileIsUnsafe(selectedProfile(options))) {
    result.ok = false;
    result.errors.push("Store identity changed; saved data retained.");
    push(profile.store || "", "profile data", "kept", "Store identity changed; saved data retained.", "common.detail.identityChanged");
  } else
    step(profile.store, "profile data", () => {
      if (!profile.store || !fs.existsSync(profile.store)) return false;
      fs.rmSync(profile.store, { recursive: true });
      result.configRemoved = true;
      return true;
    });
  return result;
}

function discordUserDataDir(options = {}) {
  if (options.userDataDir) return path.resolve(options.userDataDir);
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "discord");
  }
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "discord");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "discord");
}

function configStoreDir(options = {}) {
  return path.join(discordUserDataDir(options), PAYLOAD_DIR_NAME);
}

function resolveDiscordCoreDir(options = {}) {
  const coreDirs = resolveAllDiscordCoreDirs(options);
  if (coreDirs.length === 0)
    throw new Error(`No Discord desktop core module was found under ${discordBaseDir(options)}`);
  return coreDirs[0];
}

function resolveAllDiscordCoreDirs(options = {}) {
  const baseDir = discordBaseDir(options);
  if (!fs.existsSync(baseDir))
    throw new Error(`No Discord user data directory was found at ${baseDir}`);
  const dirs = [];
  for (const versionDir of versionDirs(baseDir)) {
    const coreDir = resolveCorePath(path.join(baseDir, versionDir, "modules"));
    if (coreDir) dirs.push(coreDir);
  }
  return dirs;
}

function discordBaseDir(options = {}) {
  if (options.baseDir) return path.resolve(options.baseDir);
  if (process.platform === "win32")
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Discord",
    );
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "discord");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "discord");
}

function versionDirs(baseDir) {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^app-\d+\.\d+\.\d+$/.test(name) || /^\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersionDir);
}

function compareVersionDir(a, b) {
  const aApp = a.startsWith("app-") ? 1 : 0;
  const bApp = b.startsWith("app-") ? 1 : 0;
  if (aApp !== bApp) return bApp - aApp;
  const aTuple = versionTuple(a);
  const bTuple = versionTuple(b);
  for (let i = 0; i < Math.max(aTuple.length, bTuple.length); i += 1) {
    const diff = (bTuple[i] || 0) - (aTuple[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionTuple(name) {
  return name.replace(/^app-/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function resolveCorePath(modulesDir) {
  if (!fs.existsSync(modulesDir)) return "";
  const wrappers = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^discord_desktop_core-(\d+)$/.exec(entry.name);
      return match ? { name: entry.name, n: Number.parseInt(match[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.n - a.n);
  for (const wrapper of wrappers) {
    const candidate = path.join(modulesDir, wrapper.name, "discord_desktop_core");
    if (isDesktopCoreDir(candidate)) return candidate;
  }
  const legacy = path.join(modulesDir, "discord_desktop_core");
  return isDesktopCoreDir(legacy) ? legacy : "";
}

function isDesktopCoreDir(coreDir) {
  return (
    fs.existsSync(path.join(coreDir, "core.asar")) &&
    fs.existsSync(path.join(coreDir, "package.json"))
  );
}

function requirePayloadSource(payloadSource) {
  if (!payloadSource) throw new Error("--payload-source is required");
  const resolved = path.resolve(payloadSource);
  if (fs.existsSync(path.join(resolved, "manifest.json"))) {
    require("./lib/payload").validatePayload(resolved);
    return resolved;
  }
  for (const file of ["mod/main.js", "mod/preload.js", "mod/renderer.js", "shared/settings.js"]) {
    if (!fs.existsSync(path.join(resolved, file)))
      throw new Error(`Payload file is missing: ${path.join(resolved, file)}`);
  }
  return resolved;
}

function baseIndex(currentIndex) {
  const content = String(currentIndex ?? "");
  if (content.includes(BLOCK_START)) return content.replace(blockPattern(), "");
  if (content.includes(LOADER_MARKER)) return VANILLA_INDEX;
  return content;
}

function copyPayload(sourceRoot, payloadDest) {
  const payload = require("./lib/payload");
  if (fs.existsSync(path.join(sourceRoot, "manifest.json")))
    payload.copyVerifiedPayload(sourceRoot, payloadDest);
  else payload.emitPayload(payloadDest, { sourceRoot });
}

function parseArgs(argv) {
  const options = { help: false };
  const action = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--payload-source") options.payloadSource = argv[++i];
    else if (arg === "--remove-profile-data") options.removeProfileData = true;
    else if (arg === "--prune") options.prune = true;
    else if (arg === "--base-dir") options.baseDir = argv[++i];
  }
  return { action, options };
}

function printKept(paths) {
  for (const kept of paths || []) console.log(`Kept ${kept}`);
}

function main() {
  try {
    const { action, options } = parseArgs(process.argv.slice(2));
    if (!action || action === "--help" || action === "-h" || options.help) {
      console.log(HELP);
      return;
    }
    if (action === "install") {
      const result = installDiscordMod(options);
      console.log(`Installed Babel into ${result.coreDir}`);
      printKept(result.retained);
      return;
    }
    if (action === "uninstall") {
      const result = uninstallDiscordMod(options);
      printKept(result.retained);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (action === "prune") {
      const result = pruneDiscordMod(options);
      printKept(result.retained);
      for (const removed of result.removed) console.log(`Removed ${removed}`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    throw new Error("Expected action: install, uninstall, or prune");
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  BACKUP_INDEX_NAME,
  LOADER_MARKER,
  BLOCK_START,
  BLOCK_END,
  PAYLOAD_DIR_NAME,
  VANILLA_INDEX,
  HELP,
  installDiscordMod,
  uninstallDiscordMod,
  pruneDiscordMod,
  resolveAllDiscordCoreDirs,
  resolveDiscordCoreDir,
  configStoreDir,
};
