"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process");
const corpus = require("./fixtures/installer-conformance.json");
const core = require("../scripts/desktop-core-action");
const injector =
  "require('./other-injector');\nmodule.exports = require('./core.asar');\n";
function setup(directory, entry) {
  const base = path.join(directory, "discord"),
    target = path.join(
      base,
      "app-0.0.999/modules/discord_desktop_core-1/discord_desktop_core",
    ),
    store = path.join(base, core.PAYLOAD_DIR_NAME);
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(store);
  fs.writeFileSync(path.join(store, "api-keys.json"), "saved");
  fs.writeFileSync(path.join(target, "core.asar"), "core");
  fs.writeFileSync(path.join(target, "package.json"), "{}");
  const index = path.join(target, "index.js"),
    backup = path.join(target, core.BACKUP_INDEX_NAME),
    payload = path.join(target, core.PAYLOAD_DIR_NAME);
  const content =
    entry.format === "additive"
      ? `${core.BLOCK_START}\nrequire('./discord-translator-mod/main');\n${core.BLOCK_END}\n${injector}`
      : entry.format === "legacy"
        ? `/* ${core.LOADER_MARKER} */\n${core.VANILLA_INDEX}`
        : injector;
  if (entry.indexDirectory) fs.mkdirSync(index);
  else fs.writeFileSync(index, content);
  if (entry.backupDirectory) {
    fs.mkdirSync(backup);
    fs.writeFileSync(path.join(backup, "recovery"), "saved");
  } else if (entry.backup) fs.writeFileSync(backup, injector);
  fs.mkdirSync(payload);
  fs.writeFileSync(path.join(payload, "main.js"), "saved");
  return { base, target, store, index, backup, payload };
}
function verify(f, entry, succeeded) {
  assert.equal(succeeded, entry.succeeds);
  assert.equal(fs.existsSync(f.store), entry.dataKept);
  if (!entry.indexDirectory) {
    const content = fs.readFileSync(f.index, "utf8");
    assert.equal(content.includes(core.LOADER_MARKER), entry.hookKept);
    if (entry.backup || entry.format === "additive" || entry.format === "plain")
      assert.ok(content.includes("other-injector"));
  }
  assert.equal(fs.existsSync(f.payload), Boolean(entry.payloadKept));
  if (!entry.succeeds)
    assert.ok(fs.existsSync(f.backup) || entry.indexDirectory);
}
for (const entry of corpus)
  test(`JS conformance: ${entry.name}`, (t) => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "babel-conformance-js-"),
    );
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const f = setup(temp, entry),
      options = {
        baseDir: f.base,
        userDataDir: f.base,
        removeProfileData: entry.removeData,
      };
    const result = core.uninstallDiscordMod(options);
    verify(f, entry, result.ok);
    assert.ok(
      result.steps.every((step) =>
        ["done", "already absent", "failed", "not attempted", "kept"].includes(
          step.state,
        ),
      ),
    );
    if (!entry.succeeds)
      assert.ok(result.steps.some((step) => step.state === "not attempted"));
    if (entry.repeat) assert.equal(core.uninstallDiscordMod(options).ok, true);
  });
test(
  "Objective-C consumes the same conformance corpus",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "babel-conformance-mac-"),
    );
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const source = path.join(temp, "harness.m"),
      executable = path.join(temp, "core");
    fs.writeFileSync(
      source,
      `#import <Foundation/Foundation.h>\n#import "BabelInstallerCore.h"\nint main(int argc,const char *argv[]){@autoreleasepool{NSString *base=[NSString stringWithUTF8String:argv[1]];NSError *error=nil;NSMutableArray *steps=[NSMutableArray array];BOOL ok=BabelUninstallWithOptions(base,atoi(argv[2])!=0,base,steps,&error);NSData *data=[NSJSONSerialization dataWithJSONObject:steps options:0 error:nil];fwrite(data.bytes,1,data.length,stdout);return ok?0:1;}}`,
    );
    cp.execFileSync("/usr/bin/clang", [
      "-fobjc-arc",
      "-framework",
      "Foundation",
      "-I",
      path.resolve(__dirname, "../installer/macos"),
      path.resolve(__dirname, "../installer/macos/BabelInstallerCore.m"),
      source,
      "-o",
      executable,
    ]);
    for (const entry of corpus)
      await t.test(entry.name, () => {
        const dir = path.join(temp, String(corpus.indexOf(entry)));
        fs.mkdirSync(dir);
        const f = setup(dir, entry);
        const result = cp.spawnSync(
          executable,
          [f.base, entry.removeData ? "1" : "0"],
          { encoding: "utf8" },
        );
        verify(f, entry, result.status === 0);
        const steps = JSON.parse(result.stdout);
        assert.ok(steps.length >= 4);
        if (entry.repeat)
          assert.equal(cp.spawnSync(executable, [f.base, "0"]).status, 0);
      });
  },
);
test("JS selected-profile cleanup rejects a symlink and preserves its destination", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-profile-link-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const f = setup(temp, corpus[0]),
    outside = path.join(temp, "outside");
  fs.renameSync(f.store, outside);
  fs.symlinkSync(outside, f.store, "dir");
  assert.throws(() =>
    core.uninstallDiscordMod({ baseDir: f.base, removeProfileData: true }),
  );
  assert.ok(fs.existsSync(path.join(outside, "api-keys.json")));
  assert.ok(fs.readFileSync(f.index, "utf8").includes(core.LOADER_MARKER));
});
