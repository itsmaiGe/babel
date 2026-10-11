#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { installDiscordMod } = require("./desktop-core-action");

function installFromProject(options = {}) {
  return installDiscordMod({
    payloadSource: path.resolve(__dirname, "..", "src"),
    ...options,
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
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
      console.log(`Usage: node scripts/install.js [--base-dir <dir>]

This developer command does not lock the target. No other install, prune, or
uninstall may operate on that Discord target at the same time. Overlap is
unsupported. A later non-overlapping run repairs an interrupted install.`);
      return;
    }
    const result = installFromProject(parseArgs(args));
    console.log(`Installed Babel into ${result.coreDir}`);
    for (const kept of result.retained || []) console.log(`Kept ${kept}`);
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  installDiscordMod: installFromProject,
};
