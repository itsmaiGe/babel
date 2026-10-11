"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const {
  emitPayload,
  validatePayload,
  copyVerifiedPayload,
} = require("../scripts/lib/payload");
const hash = (data) => createHash("sha256").update(data).digest("hex");
test("canonical emit and copied payload have identical complete manifests and no test hooks", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-payload-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const a = path.join(temp, "a"),
    b = path.join(temp, "b");
  const manifest = emitPayload(a),
    copy = copyVerifiedPayload(a, b);
  assert.deepEqual(copy, manifest);
  assert.equal(manifest.version, require("../package.json").version);
  assert.ok(
    manifest.files.some(
      (entry) => entry.path === "core/translation-service.js",
    ),
  );
  assert.ok(manifest.files.some((entry) => entry.path === "ui/dom-watch.js"));
  for (const entry of manifest.files) {
    const data = fs.readFileSync(path.join(b, entry.path));
    assert.equal(hash(data), entry.sha256);
    assert.equal(data.includes(Buffer.from("@dtm-test-only")), false);
  }
});
for (const [name, change] of [
  [
    "hash corruption",
    (dir, m) => fs.appendFileSync(path.join(dir, m.files[0].path), "changed"),
  ],
  ["path traversal", (dir, m) => (m.files[0].path = "../escape.js")],
  [
    "missing required module",
    (dir, m) =>
      (m.files = m.files.filter(
        (entry) => entry.path !== "core/translation-service.js",
      )),
  ],
  ["version mismatch", (dir, m) => (m.version = "0.1.5")],
  [
    "symlinked file",
    (dir, m) => {
      const file = path.join(dir, m.files[0].path),
        copy = file + ".old";
      fs.renameSync(file, copy);
      fs.symlinkSync(copy, file);
    },
  ],
])
  test(`payload rejects ${name}`, (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-payload-bad-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const m = emitPayload(temp);
    change(temp, m);
    fs.writeFileSync(path.join(temp, "manifest.json"), JSON.stringify(m));
    assert.throws(() => validatePayload(temp));
  });
