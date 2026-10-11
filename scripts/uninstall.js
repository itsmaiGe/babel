#!/usr/bin/env node
"use strict";

const { uninstallDiscordMod } = require("./desktop-core-action");

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--remove-profile-data") options.removeProfileData = true;
    else if (arg === "--prune") options.prune = true;
    else if (arg === "--base-dir") options.baseDir = argv[++i];
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(`Usage: node scripts/uninstall.js [--base-dir <dir>] [--remove-profile-data] [--prune]

This developer command does not lock the target. No other install, prune, or
uninstall may operate on that Discord target at the same time. Overlap is
unsupported. A later non-overlapping run repairs an interrupted operation.

--prune confirms Discord for the selected target is closed and that no
installer of any route is operating. It removes only unreferenced Babel
payload directories.`);
      return;
    }
    const result = uninstallDiscordMod(options);
    for (const kept of result.retained || []) console.log(`Kept ${kept}`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  uninstallDiscordMod,
};
