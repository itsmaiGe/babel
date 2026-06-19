#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const asar = require("@electron/asar");

const DEFAULT_DISCORD_APP = "/Applications/Discord.app";
const BACKUP_NAME = "app.asar.dtm-original";
const LOADER_MARKER = "/* DiscordTranslatorMod loader */";
const LOADER = `${LOADER_MARKER}\ntry{require("./discord-translator-mod/main").install();}catch(error){console.error("[Discord Translator Mod] Failed to install hook:",error);}\n`;

async function installDiscordMod(options = {}) {
  const appPath = path.resolve(options.appPath || DEFAULT_DISCORD_APP);
  const resourcesDir = path.join(appPath, "Contents", "Resources");
  const appAsar = path.join(resourcesDir, "app.asar");
  const backupAsar = path.join(resourcesDir, BACKUP_NAME);

  if (!fs.existsSync(appAsar)) {
    throw new Error(`Discord app.asar was not found at ${appAsar}`);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discord-translator-mod-"));
  const extractDir = path.join(tmpDir, "extract");
  const packedAsar = path.join(tmpDir, "app.asar");

  try {
    if (!fs.existsSync(backupAsar)) {
      fs.copyFileSync(appAsar, backupAsar);
    }

    await asar.extractAll(backupAsar, extractDir);

    const bundlePath = path.join(extractDir, "bundle.js");
    if (!fs.existsSync(bundlePath)) {
      throw new Error("Discord bundle.js was not found inside app.asar.");
    }

    const payloadDir = path.join(extractDir, "discord-translator-mod");
    fs.rmSync(payloadDir, { recursive: true, force: true });
    fs.mkdirSync(payloadDir, { recursive: true });
    copyRuntimePayload(projectRoot, payloadDir);

    const bundle = fs.readFileSync(bundlePath, "utf8").replace(LOADER_MARKER, "");
    fs.writeFileSync(bundlePath, `${LOADER}${bundle}`, "utf8");

    await asar.createPackage(extractDir, packedAsar);
    fs.copyFileSync(packedAsar, appAsar);
    asar.uncache(appAsar);
    asar.uncache(backupAsar);

    if (options.codesign !== false && process.platform === "darwin") {
      codesignApp(appPath);
    }

    return {
      appPath,
      appAsar,
      backupAsar
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function copyRuntimePayload(projectRoot, payloadDir) {
  copyFile(path.join(projectRoot, "src", "mod", "main.js"), path.join(payloadDir, "main.js"));
  copyFile(path.join(projectRoot, "src", "mod", "preload.js"), path.join(payloadDir, "preload.js"));
  copyFile(path.join(projectRoot, "src", "mod", "renderer.js"), path.join(payloadDir, "renderer.js"));
  copyDirectory(path.join(projectRoot, "src", "shared"), path.join(payloadDir, "shared"));
}

function copyFile(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function copyDirectory(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destPath);
    else if (entry.isFile()) copyFile(sourcePath, destPath);
  }
}

function codesignApp(appPath) {
  childProcess.execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "pipe"
  });
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app" || arg === "--target") {
      options.appPath = argv[++i];
    } else if (arg === "--skip-codesign") {
      options.codesign = false;
    }
  }
  return options;
}

async function main() {
  try {
    const result = await installDiscordMod(parseArgs(process.argv.slice(2)));
    console.log(`Installed Discord Translator Mod into ${result.appPath}`);
    console.log(`Backup: ${result.backupAsar}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BACKUP_NAME,
  LOADER_MARKER,
  installDiscordMod
};
