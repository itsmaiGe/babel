"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  PRODUCTS,
  OWNED,
  sha256,
  reconcile,
  formatSums,
  verifySums,
  verifyMetadata,
} = require("../scripts/lib/release");
const commit = "a".repeat(40),
  pins = {
    tag: "v0.1.6",
    commit,
    tagCommit: commit,
    version: "0.1.6",
    manifestVersions: ["0.1.6", "0.1.6"],
  };
const draft = () => ({
  id: 1,
  tag_name: pins.tag,
  draft: true,
  target_commitish: commit,
  assets: OWNED.map((name, id) => ({ name, id: id + 10 })),
});
test("draft preparation creates an absent draft and replaces only owned stale assets", () => {
  assert.equal(
    reconcile({ ...pins, mode: "prepare", release: null }).create,
    true,
  );
  const release = draft();
  release.target_commitish = "old-branch";
  release.assets.push({ id: 99, name: "owner-notes.pdf" });
  const decision = reconcile({ ...pins, mode: "prepare", release });
  assert.deepEqual(decision.replace, OWNED);
  assert.deepEqual(decision.extras, ["owner-notes.pdf"]);
});
for (const [name, change] of [
  ["public version", (v) => (v.release.draft = false)],
  ["release identity", (v) => (v.release.tag_name = "v0.1.5")],
  ["wrong tag commit", (v) => (v.tagCommit = "b".repeat(40))],
  ["version mismatch", (v) => (v.manifestVersions = ["0.1.5"])],
  [
    "duplicate required asset",
    (v) => v.release.assets.push({ id: 20, name: PRODUCTS[0] }),
  ],
])
  test(`release rejects ${name}`, () => {
    const value = { ...pins, release: draft(), mode: "prepare" };
    change(value);
    assert.throws(() => reconcile(value));
  });
test("publication pins draft identity, commit, assets and exact checksums", () => {
  const release = draft(),
    buffers = Object.fromEntries(
      PRODUCTS.map((name) => [name, Buffer.from(name)]),
    ),
    sums = Buffer.from(formatSums(buffers));
  assert.equal(reconcile({ ...pins, mode: "publish", release }).create, false);
  assert.equal(verifySums(sums, buffers, sha256(sums)), true);
  assert.throws(() =>
    verifySums(
      sums,
      { ...buffers, [PRODUCTS[0]]: Buffer.from("stale") },
      sha256(sums),
    ),
  );
  assert.throws(() => verifySums(sums, buffers, "f".repeat(64)));
  release.target_commitish = "old";
  assert.throws(() => reconcile({ ...pins, mode: "publish", release }));
  release.target_commitish = commit;
  release.assets.pop();
  assert.throws(() => reconcile({ ...pins, mode: "publish", release }));
});
test("preparation accepts only the same verified source, version and payload on both platforms", () => {
  const buffers = Object.fromEntries(
    PRODUCTS.map((name) => [name, Buffer.from(name)]),
  );
  const metadata = PRODUCTS.map((artifact) => ({
    artifact,
    version: "0.1.6",
    commit,
    dirty: false,
    bytes: buffers[artifact].length,
    sha256: sha256(buffers[artifact]),
    payloadManifestSha256: "c".repeat(64),
    nativeUIVerified: true,
    bundleVersion: "0.1.6",
    embeddedVersion: "0.1.6",
    cgo: "0",
  }));
  verifyMetadata(metadata, buffers, commit, "0.1.6");
  for (const field of [
    "version",
    "commit",
    "sha256",
    "payloadManifestSha256",
    "nativeUIVerified",
    "cgo",
  ]) {
    const wrong = structuredClone(metadata);
    wrong[1][field] = false;
    assert.throws(() => verifyMetadata(wrong, buffers, commit, "0.1.6"));
  }
});
test("build and PR jobs are read only; tags prepare drafts and publication is an explicit pinned dispatch", () => {
  const build = fs.readFileSync(
      path.join(__dirname, "../.github/workflows/build.yml"),
      "utf8",
    ),
    publish = fs.readFileSync(
      path.join(__dirname, "../.github/workflows/publish.yml"),
      "utf8",
    );
  assert.match(build, /pull_request:/);
  assert.match(build, /permissions:\s*contents: read/);
  assert.equal((build.match(/contents: write/g) || []).length, 1);
  assert.match(build, /scripts\/release.js prepare/);
  assert.doesNotMatch(build, /release create|release.js publish/);
  assert.match(build, /CGO_ENABLED: "0"/);
  assert.match(build, /verify-dist.js/);
  assert.match(build, /verify-windows.js/);
  assert.match(publish, /workflow_dispatch:/);
  for (const pin of ["tag:", "commit:", "sums_sha256:"])
    assert.ok(publish.includes(pin));
  assert.match(publish, /scripts\/release.js publish/);
  assert.match(build, /group: babel-release-/);
  assert.match(publish, /group: babel-release-/);
});
