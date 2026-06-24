#!/usr/bin/env node
"use strict";

const { uninstallDiscordMod } = require("./desktop-core-action");

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
    const result = uninstallDiscordMod(parseArgs(process.argv.slice(2)));
    console.log(`Removed Babel from ${result.changed} desktop core item(s).`);
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  uninstallDiscordMod
};
