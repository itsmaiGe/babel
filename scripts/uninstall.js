#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const asar = require("@electron/asar");

const { BACKUP_NAME } = require("./install");

const DEFAULT_DISCORD_APP = "/Applications/Discord.app";

function uninstallDiscordMod(options = {}) {
  const appPath = path.resolve(options.appPath || DEFAULT_DISCORD_APP);
  const resourcesDir = path.join(appPath, "Contents", "Resources");
  const appAsar = path.join(resourcesDir, "app.asar");
  const backupAsar = path.join(resourcesDir, BACKUP_NAME);

  if (!fs.existsSync(backupAsar)) {
    throw new Error(`Backup was not found at ${backupAsar}`);
  }

  fs.copyFileSync(backupAsar, appAsar);
  fs.rmSync(backupAsar, { force: true });
  asar.uncache(appAsar);
  asar.uncache(backupAsar);

  if (options.codesign !== false && process.platform === "darwin") {
    codesignApp(appPath);
  }

  return { appPath, appAsar };
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

function main() {
  try {
    const result = uninstallDiscordMod(parseArgs(process.argv.slice(2)));
    console.log(`Restored original Discord app.asar in ${result.appPath}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  uninstallDiscordMod
};
