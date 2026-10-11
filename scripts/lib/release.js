"use strict";
const { createHash } = require("node:crypto");
const PRODUCTS = ["Babel Manager.dmg", "Babel-Installer.exe"],
  SUMS = "SHA256SUMS",
  OWNED = [...PRODUCTS, SUMS];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
function assertPins({
  tag,
  commit,
  tagCommit,
  version,
  manifestVersions = [],
}) {
  if (
    !/^v\d+\.\d+\.\d+$/.test(tag) ||
    tag !== `v${version}` ||
    manifestVersions.some((value) => value !== version)
  )
    throw new Error("Release version mismatch");
  if (!/^[a-f0-9]{40}$/.test(commit) || tagCommit !== commit)
    throw new Error("Tag does not point at the verified candidate commit");
}
function reconcile({
  mode,
  release,
  tag,
  commit,
  tagCommit,
  version,
  manifestVersions,
}) {
  assertPins({ tag, commit, tagCommit, version, manifestVersions });
  if (!release) {
    if (mode !== "prepare") throw new Error("Draft release missing");
    return { create: true, replace: [], extras: [] };
  }
  if (!release.id || release.tag_name !== tag)
    throw new Error("Release identity conflict");
  if (!release.draft)
    throw new Error("Version is already public; no mutation permitted");
  const assets = release.assets || [];
  for (const name of OWNED)
    if (assets.filter((asset) => asset.name === name).length > 1)
      throw new Error(`Conflicting required filename: ${name}`);
  if (
    mode === "publish" &&
    (release.target_commitish !== commit ||
      OWNED.some(
        (name) => assets.filter((asset) => asset.name === name).length !== 1,
      ))
  )
    throw new Error("Draft target or required assets mismatch");
  return {
    create: false,
    replace: assets
      .filter((asset) => OWNED.includes(asset.name))
      .map((asset) => asset.name),
    extras: assets
      .filter((asset) => !OWNED.includes(asset.name))
      .map((asset) => asset.name),
  };
}
function formatSums(buffers) {
  return PRODUCTS.map((name) => `${sha256(buffers[name])}  ${name}\n`).join("");
}
function verifySums(sums, buffers, pinnedSumsDigest) {
  if (
    pinnedSumsDigest &&
    (!/^[a-f0-9]{64}$/.test(pinnedSumsDigest) ||
      sha256(sums) !== pinnedSumsDigest)
  )
    throw new Error("SHA256SUMS digest mismatch");
  if (Buffer.from(sums).toString() !== formatSums(buffers))
    throw new Error("Installer digests or checksum filenames mismatch");
  return true;
}
function verifyMetadata(metadata, buffers, commit, version) {
  for (const name of PRODUCTS) {
    const entry = metadata.find((value) => value.artifact === name);
    if (
      metadata.filter((value) => value.artifact === name).length !== 1 ||
      !entry ||
      entry.commit !== commit ||
      entry.dirty ||
      entry.version !== version ||
      entry.bytes !== buffers[name]?.length ||
      entry.sha256 !== sha256(buffers[name])
    )
      throw new Error(`Unverified build metadata: ${name}`);
  }
  const [mac, win] = PRODUCTS.map((name) =>
    metadata.find((value) => value.artifact === name),
  );
  if (
    !mac.nativeUIVerified ||
    !win.nativeUIVerified ||
    mac.bundleVersion !== version ||
    win.cgo !== "0" ||
    win.embeddedVersion !== version ||
    mac.payloadManifestSha256 !== win.payloadManifestSha256
  )
    throw new Error("Platform version or payload mismatch");
}
module.exports = {
  PRODUCTS,
  SUMS,
  OWNED,
  sha256,
  reconcile,
  formatSums,
  verifySums,
  verifyMetadata,
};
