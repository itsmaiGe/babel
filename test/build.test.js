"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { managerSource } = require("../scripts/build");

test("native manager source prefers Apple Silicon Homebrew Node before Intel Homebrew Node", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /@"\/opt\/homebrew\/bin\/node"/);
  assert.match(source, /@"\/usr\/local\/bin\/node"/);
});

test("native manager checks node architectures before running node", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /strcmp\(systemInfo\.machine, "arm64"\)/);
  assert.match(source, /RunAndCapture\(@"\/usr\/bin\/lipo", @\[@"-archs", candidate\]\)/);
  assert.match(source, /ShellQuote\(@"\/usr\/bin\/arch"\)/);
  assert.match(source, /ShellQuote\(scriptPath\)/);
  assert.doesNotMatch(source, /process\.arch/);
  assert.doesNotMatch(source, /osascript/);
});

test("native manager runs install and uninstall through administrator authorization", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /RunPrivilegedShellCommand/);
  assert.match(source, /with administrator privileges/);
  assert.match(source, /ShellQuote\(ProjectRoot\)/);
  assert.match(source, /ShellQuote\(logPath\)/);
});

test("native manager supports install and uninstall actions in one app", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /\[alert addButtonWithTitle:@"Install"\]/);
  assert.match(source, /\[alert addButtonWithTitle:@"Uninstall"\]/);
  assert.match(source, /InstallScript/);
  assert.match(source, /UninstallScript/);
});
