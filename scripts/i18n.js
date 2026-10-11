#!/usr/bin/env node
"use strict";
if (!["--write", "--check"].includes(process.argv[2])) { console.error("usage: node scripts/i18n.js --write|--check"); process.exitCode = 2; }
else try { require("./lib/i18n").generate({ check: process.argv[2] === "--check" }); console.log("Localization catalogs verified."); }
catch (error) { console.error(error.message); process.exitCode = 1; }
