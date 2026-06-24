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
  assert.match(source, /fileURLWithPath:@"\/usr\/bin\/arch"/);
  assert.match(source, /RunNodeAndCapture/);
  assert.doesNotMatch(source, /process\.arch/);
  assert.doesNotMatch(source, /osascript/);
});

test("native manager runs the desktop core installer without administrator authorization", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /desktop-core-action\.js/);
  assert.match(source, /--payload-source/);
  assert.doesNotMatch(source, /RunPrivilegedShellCommand/);
  assert.doesNotMatch(source, /with administrator privileges/);
  assert.doesNotMatch(source, /ShellQuote/);
  assert.doesNotMatch(source, /InstallScript/);
  assert.doesNotMatch(source, /UninstallScript/);
  assert.doesNotMatch(source, /privileged-action\.js/);
  assert.doesNotMatch(source, /stage-action\.js/);
});

test("native manager supports install and uninstall actions in one app", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /\[alert addButtonWithTitle:@"Install"\]/);
  assert.match(source, /\[alert addButtonWithTitle:@"Uninstall"\]/);
  assert.match(source, /RunAction\(@"install"/);
  assert.match(source, /RunAction\(@"uninstall"/);
});
