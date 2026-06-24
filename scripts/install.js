#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { installDiscordMod } = require("./desktop-core-action");

function installFromProject(options = {}) {
  return installDiscordMod({
    payloadSource: path.resolve(__dirname, "..", "src"),
    ...options
  });
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-dir") {
      options.baseDir = argv[++i];
    }
  }
  return options;
}

function main() {
  try {
    const result = installFromProject(parseArgs(process.argv.slice(2)));
    console.log(`Installed Babel into ${result.coreDir}`);
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  installDiscordMod: installFromProject
};
