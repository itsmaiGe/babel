"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runnerScript } = require("../scripts/build");

test("macOS runner prefers Apple Silicon Homebrew Node before Intel Homebrew Node", () => {
  const script = runnerScript({
    name: "Test Installer",
    script: "scripts/install.js",
    successMessage: "Installed."
  });

  assert.match(script, /export PATH="\/opt\/homebrew\/bin:\/usr\/local\/bin:/);
  assert.match(script, /for CANDIDATE in \/opt\/homebrew\/bin\/node \/usr\/local\/bin\/node \/usr\/bin\/node/);
});

test("macOS runner refuses x64 Node on Apple Silicon", () => {
  const script = runnerScript({
    name: "Test Installer",
    script: "scripts/install.js",
    successMessage: "Installed."
  });

  assert.match(script, /\$\(uname -m\).*arm64/s);
  assert.match(script, /process\.arch/);
  assert.match(script, /selected Node\.js is not arm64/);
});
