"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runnerScript } = require("../scripts/build");

test("macOS manager runner prefers Apple Silicon Homebrew Node before Intel Homebrew Node", () => {
  const script = runnerScript({
    name: "Test Manager"
  });

  assert.match(script, /export PATH="\/opt\/homebrew\/bin:\/usr\/local\/bin:/);
  assert.match(script, /for CANDIDATE in \/opt\/homebrew\/bin\/node \/usr\/local\/bin\/node \/usr\/bin\/node/);
});

test("macOS manager runner checks node architectures before running node", () => {
  const script = runnerScript({
    name: "Test Manager"
  });

  assert.match(script, /\$\(uname -m\).*arm64/s);
  assert.match(script, /\/usr\/bin\/lipo -archs "\$CANDIDATE"/);
  assert.match(script, /NODE_RUNNER="\/usr\/bin\/arch -arm64"/);
  assert.doesNotMatch(script, /process\.arch/);
});

test("macOS manager runner supports install and uninstall actions in one app", () => {
  const script = runnerScript({
    name: "Test Manager"
  });

  assert.match(script, /buttons \{"Cancel", "Uninstall", "Install"\}/);
  assert.match(script, /scripts', 'install\.js|scripts.*install\.js/);
  assert.match(script, /scripts', 'uninstall\.js|scripts.*uninstall\.js/);
});
