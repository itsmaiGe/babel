#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKUP_INDEX_NAME = "index.js.dtm-original";
const LOADER_MARKER = "DiscordTranslatorMod desktop-core loader";
const PAYLOAD_DIR_NAME = "discord-translator-mod";
const VANILLA_INDEX = "module.exports = require('./core.asar');\n";

function installDiscordMod(options = {}) {
  const payloadSource = requirePayloadSource(options.payloadSource);
  const coreDir = resolveDiscordCoreDir(options);
  const indexPath = path.join(coreDir, "index.js");
  const backupPath = path.join(coreDir, BACKUP_INDEX_NAME);
  const payloadDest = path.join(coreDir, PAYLOAD_DIR_NAME);

  const currentIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : VANILLA_INDEX;
  if (!fs.existsSync(backupPath)) {
    if (!isVanillaIndex(currentIndex) && !currentIndex.includes(LOADER_MARKER)) {
      throw new Error(`Refusing to overwrite an unknown Discord desktop core index at ${indexPath}`);
    }
    fs.writeFileSync(backupPath, currentIndex, "utf8");
  }

  replacePayloadDirectory(payloadSource, payloadDest);
  fs.writeFileSync(indexPath, loaderIndex(), "utf8");

  return {
    coreDir,
    indexPath,
    payloadDest
  };
}

function uninstallDiscordMod(options = {}) {
  const coreDirs = resolveAllDiscordCoreDirs(options);
  let changed = 0;

  for (const coreDir of coreDirs) {
    const indexPath = path.join(coreDir, "index.js");
    const backupPath = path.join(coreDir, BACKUP_INDEX_NAME);
    const payloadDest = path.join(coreDir, PAYLOAD_DIR_NAME);
    const currentIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";

    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, indexPath);
      fs.rmSync(backupPath, { force: true });
      changed += 1;
    } else if (currentIndex.includes(LOADER_MARKER)) {
      fs.writeFileSync(indexPath, VANILLA_INDEX, "utf8");
      changed += 1;
    }

    if (fs.existsSync(payloadDest)) {
      fs.rmSync(payloadDest, { recursive: true, force: true });
      changed += 1;
    }
  }

  return {
    coreDirs,
    changed
  };
}

function resolveDiscordCoreDir(options = {}) {
  const coreDirs = resolveAllDiscordCoreDirs(options);
  if (coreDirs.length === 0) {
    throw new Error(`No Discord desktop core module was found under ${discordBaseDir(options)}`);
  }
  return coreDirs[0];
}

function resolveAllDiscordCoreDirs(options = {}) {
  const baseDir = discordBaseDir(options);
  if (!fs.existsSync(baseDir)) {
    throw new Error(`No Discord user data directory was found at ${baseDir}`);
  }

  const dirs = [];
  for (const versionDir of versionDirs(baseDir)) {
    const modulesDir = path.join(baseDir, versionDir, "modules");
    const coreDir = resolveCorePath(modulesDir);
    if (coreDir) {
      dirs.push(coreDir);
    }
  }
  return dirs;
}

function discordBaseDir(options = {}) {
  if (options.baseDir) {
    return path.resolve(options.baseDir);
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Discord");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "discord");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "discord");
}

function versionDirs(baseDir) {
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => /^app-\d+\.\d+\.\d+$/.test(name) || /^\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersionDir);
}

function compareVersionDir(a, b) {
  const aApp = a.startsWith("app-") ? 1 : 0;
  const bApp = b.startsWith("app-") ? 1 : 0;
  if (aApp !== bApp) {
    return bApp - aApp;
  }

  const aTuple = versionTuple(a);
  const bTuple = versionTuple(b);
  for (let i = 0; i < Math.max(aTuple.length, bTuple.length); i += 1) {
    const diff = (bTuple[i] || 0) - (aTuple[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function versionTuple(name) {
  return name.replace(/^app-/, "").split(".").map(part => Number.parseInt(part, 10) || 0);
}

function resolveCorePath(modulesDir) {
  if (!fs.existsSync(modulesDir)) {
    return "";
  }

  const wrappers = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const match = /^discord_desktop_core-(\d+)$/.exec(entry.name);
      return match ? { name: entry.name, n: Number.parseInt(match[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.n - a.n);

  for (const wrapper of wrappers) {
    const candidate = path.join(modulesDir, wrapper.name, "discord_desktop_core");
    if (isDesktopCoreDir(candidate)) {
      return candidate;
    }
  }

  const legacy = path.join(modulesDir, "discord_desktop_core");
  return isDesktopCoreDir(legacy) ? legacy : "";
}

function isDesktopCoreDir(coreDir) {
  return fs.existsSync(path.join(coreDir, "core.asar")) && fs.existsSync(path.join(coreDir, "package.json"));
}

function requirePayloadSource(payloadSource) {
  if (!payloadSource) {
    throw new Error("--payload-source is required");
  }
  const resolved = path.resolve(payloadSource);
  for (const file of ["mod/main.js", "mod/preload.js", "mod/renderer.js", "shared/settings.js"]) {
    if (!fs.existsSync(path.join(resolved, file))) {
      throw new Error(`Payload file is missing: ${path.join(resolved, file)}`);
    }
  }
  return resolved;
}

function isVanillaIndex(value) {
  return /^\s*module\.exports\s*=\s*require\(["']\.\/core\.asar["']\);\s*$/.test(value);
}

function loaderIndex() {
  return `/* ${LOADER_MARKER} */\n` +
    `try {\n` +
    `  require("./${PAYLOAD_DIR_NAME}/main.js").install();\n` +
    `} catch (error) {\n` +
    `  console.error("[Babel] Failed to install hook:", error);\n` +
    `}\n` +
    `module.exports = require("./core.asar");\n`;
}

function replacePayloadDirectory(source, dest) {
  const tempDest = path.join(path.dirname(dest), `.${path.basename(dest)}-${process.pid}-${Date.now()}`);
  try {
    copyPayload(source, tempDest);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tempDest, dest);
  } catch (error) {
    fs.rmSync(tempDest, { recursive: true, force: true });
    throw error;
  }
}

const TEST_ONLY_BLOCK = /\/\* @dtm-test-only:start[\s\S]*?@dtm-test-only:end \*\/\n?/g;

function copyPayload(sourceRoot, payloadDest) {
  // Strip test-only scaffolding so it never ships in the running plugin (idempotent).
  copyStripped(path.join(sourceRoot, "mod", "main.js"), path.join(payloadDest, "main.js"));
  copyFile(path.join(sourceRoot, "mod", "preload.js"), path.join(payloadDest, "preload.js"));
  copyStripped(path.join(sourceRoot, "mod", "renderer.js"), path.join(payloadDest, "renderer.js"));
  copyDirectory(path.join(sourceRoot, "shared"), path.join(payloadDest, "shared"));
}

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
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

function parseArgs(argv) {
  const options = {};
  const action = argv[0];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--payload-source") {
      options.payloadSource = argv[++i];
    } else if (arg === "--base-dir") {
      options.baseDir = argv[++i];
    }
  }

  return { action, options };
}

function main() {
  try {
    const { action, options } = parseArgs(process.argv.slice(2));
    if (action === "install") {
      const result = installDiscordMod(options);
      console.log(`Installed Babel into ${result.coreDir}`);
      return;
    }
    if (action === "uninstall") {
      const result = uninstallDiscordMod(options);
      console.log(`Removed Babel from ${result.changed} desktop core item(s).`);
      return;
    }
    throw new Error("Expected action: install or uninstall");
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BACKUP_INDEX_NAME,
  LOADER_MARKER,
  PAYLOAD_DIR_NAME,
  VANILLA_INDEX,
  installDiscordMod,
  uninstallDiscordMod,
  resolveAllDiscordCoreDirs,
  resolveDiscordCoreDir
};
