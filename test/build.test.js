"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { managerSource, plist } = require("../scripts/build");

test("distribution verifier validates the DMG instead of the removed zip artifact", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../scripts/verify-dist.js"), "utf8");

  assert.match(source, /Babel Manager\.dmg/);
  assert.match(source, /hdiutil/);
  assert.match(source, /attach/);
  assert.match(source, /codesign/);
  assert.doesNotMatch(source, /\.zip/);
});

test("native manager bundle uses the package release version", () => {
  assert.match(plist("Babel Manager", require("../package.json").version), /<key>CFBundleShortVersionString<\/key>\s*<string>0\.1\.4<\/string>/);
});

test("native manager does not depend on Node or an external installer process", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.doesNotMatch(source, /NSTask/);
  assert.doesNotMatch(source, /node/i);
  assert.doesNotMatch(source, /desktop-core-action\.js/);
  assert.match(source, /BabelInstallerCore/);
});

test("native manager runs the desktop core installer without administrator authorization", () => {
  const source = managerSource({
    name: "Test Manager"
  });

  assert.match(source, /BabelInstall/);
  assert.match(source, /BabelUninstall/);
  assert.doesNotMatch(source, /RunPrivilegedShellCommand/);
  assert.doesNotMatch(source, /with administrator privileges/);
  assert.doesNotMatch(source, /ShellQuote/);
  assert.doesNotMatch(source, /InstallScript/);
  assert.doesNotMatch(source, /UninstallScript/);
  assert.doesNotMatch(source, /privileged-action\.js/);
  assert.doesNotMatch(source, /stage-action\.js/);
});

test("native manager resolves Discord directly without a folder access panel", () => {
  const source = managerSource({ name: "Test Manager" });

  assert.match(source, /Application Support.*discord/);
  assert.doesNotMatch(source, /NSOpenPanel/);
  assert.doesNotMatch(source, /Allow Access/);
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
