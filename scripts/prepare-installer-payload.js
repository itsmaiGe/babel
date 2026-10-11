#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { emitPayload } = require("./lib/payload");
require("./lib/i18n").generate({ check: true });
const destination = path.resolve(__dirname, "../installer/payload");
fs.rmSync(destination, { recursive: true, force: true });
const manifest = emitPayload(destination);
console.log(
  `Payload ${manifest.version}: ${manifest.files.length} verified files`,
);
