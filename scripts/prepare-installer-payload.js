#!/usr/bin/env node
"use strict";

// Populates installer/payload/ with the test-stripped plugin files so the Go
// installer can //go:embed them. Run before `go build` in CI and locally.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DEST = path.join(ROOT, "installer", "payload");
const TEST_ONLY = /\/\* @dtm-test-only:start[\s\S]*?@dtm-test-only:end \*\/\n?/g;

function strip(file) {
  return fs.readFileSync(file, "utf8").replace(TEST_ONLY, "");
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.join(DEST, "shared"), { recursive: true });

// mod files flatten to the payload root (matching the installed layout).
fs.writeFileSync(path.join(DEST, "main.js"), strip(path.join(SRC, "mod", "main.js")), "utf8");
fs.writeFileSync(path.join(DEST, "renderer.js"), strip(path.join(SRC, "mod", "renderer.js")), "utf8");
fs.copyFileSync(path.join(SRC, "mod", "preload.js"), path.join(DEST, "preload.js"));

for (const name of fs.readdirSync(path.join(SRC, "shared"))) {
  fs.copyFileSync(path.join(SRC, "shared", name), path.join(DEST, "shared", name));
}

console.log(`Installer payload prepared at ${DEST}`);
