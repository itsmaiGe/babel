"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const asar = require("@electron/asar");
const { installDiscordMod, LOADER_MARKER } = require("../scripts/install");
const { uninstallDiscordMod } = require("../scripts/uninstall");

test("installer patches and uninstaller restores a Discord-style app.asar", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-install-test-"));
  try {
    const fakeApp = path.join(tmp, "Discord.app");
    const resources = path.join(fakeApp, "Contents", "Resources");
    const source = path.join(tmp, "source");
    fs.mkdirSync(resources, { recursive: true });
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ main: "bundle.js" }), "utf8");
    fs.writeFileSync(path.join(source, "bundle.js"), "console.log('discord bundle');\n", "utf8");

    await asar.createPackage(source, path.join(resources, "app.asar"));
    await installDiscordMod({ appPath: fakeApp, codesign: false });

    const patched = path.join(tmp, "patched");
    await asar.extractAll(path.join(resources, "app.asar"), patched);

    assert.match(fs.readFileSync(path.join(patched, "bundle.js"), "utf8"), new RegExp(escapeRegExp(LOADER_MARKER)));
    assert.equal(fs.existsSync(path.join(patched, "discord-translator-mod", "main.js")), true);
    assert.equal(fs.existsSync(path.join(patched, "discord-translator-mod", "shared", "settings.js")), true);

    uninstallDiscordMod({ appPath: fakeApp, codesign: false });

    const restored = path.join(tmp, "restored");
    await asar.extractAll(path.join(resources, "app.asar"), restored);
    assert.doesNotMatch(fs.readFileSync(path.join(restored, "bundle.js"), "utf8"), new RegExp(escapeRegExp(LOADER_MARKER)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
