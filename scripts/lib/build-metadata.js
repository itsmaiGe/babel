"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process");
const { sha256 } = require("./release");
const ROOT = path.resolve(__dirname, "../..");
function versionPins(manifestVersion, tag = process.env.GITHUB_REF_NAME) {
  const version = require(path.join(ROOT, "package.json")).version;
  if (
    require(path.join(ROOT, "src/shared/defaults")).BABEL_VERSION !== version ||
    manifestVersion !== version ||
    (tag?.startsWith("v") && tag !== `v${version}`)
  )
    throw new Error("Product version mismatch");
  return version;
}
function writeMetadata(platform, artifact, manifest, extra = {}) {
  const target = path.join(ROOT, "dist", artifact),
    data = fs.readFileSync(target);
  const metadata = {
    artifact,
    version: versionPins(manifest.version),
    commit: cp
      .execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
      })
      .trim(),
    dirty: Boolean(
      cp
        .execFileSync("git", ["status", "--porcelain"], {
          cwd: ROOT,
          encoding: "utf8",
        })
        .trim(),
    ),
    bytes: data.length,
    sha256: sha256(data),
    payloadManifestSha256: sha256(JSON.stringify(manifest)),
    ...extra,
  };
  fs.writeFileSync(
    path.join(ROOT, "dist", `build-${platform}.json`),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  return metadata;
}
module.exports = { versionPins, writeMetadata };
