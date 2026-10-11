#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process");
const {
  PRODUCTS,
  SUMS,
  OWNED,
  sha256,
  reconcile,
  formatSums,
  verifySums,
  verifyMetadata,
} = require("./lib/release");
function gh(args, input) {
  return cp.execFileSync("gh", args, {
    input,
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function api(route, method = "GET", body) {
  return JSON.parse(
    gh(
      ["api", route, "--method", method, ...(body ? ["--input", "-"] : [])],
      body ? JSON.stringify(body) : undefined,
    ),
  );
}
async function main() {
  const [mode, tag, commit, directoryOrDigest] = process.argv.slice(2),
    repo = process.env.GITHUB_REPOSITORY,
    version = require("../package.json").version;
  if (
    !["prepare", "publish"].includes(mode) ||
    !repo ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo)
  )
    throw new Error("Expected prepare/publish and a repository");
  const base = `repos/${repo}`;
  function tagCommit() {
    let object = api(`${base}/git/ref/tags/${encodeURIComponent(tag)}`).object;
    for (let i = 0; object.type === "tag" && i < 8; i++)
      object = api(`${base}/git/tags/${object.sha}`).object;
    if (object.type !== "commit") throw new Error("Invalid tag object");
    return object.sha;
  }
  function releaseForTag() {
    let found = [];
    for (let page = 1; page <= 100; page++) {
      const values = api(`${base}/releases?per_page=100&page=${page}`);
      found.push(...values.filter((value) => value.tag_name === tag));
      if (values.length < 100) break;
      if (page === 100) throw new Error("Release inventory exceeded bound");
    }
    if (found.length > 1) throw new Error("Conflicting release identities");
    return found[0] || null;
  }
  function inspect(release) {
    return reconcile({
      mode,
      release,
      tag,
      commit,
      tagCommit: tagCommit(),
      version,
      manifestVersions: [require("../src/shared/defaults").BABEL_VERSION],
    });
  }
  let release = releaseForTag(),
    decision = inspect(release);
  if (mode === "prepare") {
    const directory = path.resolve(directoryOrDigest),
      buffers = {},
      metadata = [];
    for (const name of PRODUCTS)
      buffers[name] = fs.readFileSync(path.join(directory, name));
    for (const platform of ["mac", "windows"])
      metadata.push(
        JSON.parse(
          fs.readFileSync(
            path.join(directory, `build-${platform}.json`),
            "utf8",
          ),
        ),
      );
    verifyMetadata(metadata, buffers, commit, version);
    fs.writeFileSync(path.join(directory, SUMS), formatSums(buffers));
    const notes = `此版本改进自 0.1.5：原生 AppKit/Win32 管理窗口、按端点隔离密钥、统一翻译队列和缓存，以及配置冲突与卸载数据保留。\n\nWindows：下载 Babel-Installer.exe，选择 Discord 后安装。macOS：打开 Babel Manager.dmg，运行 Babel Manager 并安装。安装或卸载后完全退出并重新打开 Discord。普通卸载保留设置、密钥和缓存；清除数据需要明确勾选。\n\n验证源码：${commit}\nWindows：${buffers[PRODUCTS[1]].length} 字节；macOS：${buffers[PRODUCTS[0]].length} 字节。SHA256SUMS 包含两个安装包的校验值。`;
    if (decision.create) {
      gh([
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--draft",
        "--verify-tag",
        "--title",
        `Babel ${tag}`,
        "--notes",
        notes,
      ]);
      release = releaseForTag();
    }
    if (!release) throw new Error("Draft creation not confirmed");
    inspect(release);
    api(`${base}/releases/${release.id}`, "PATCH", {
      target_commitish: commit,
      body: notes,
      name: `Babel ${tag}`,
    });
    for (const name of OWNED) {
      const current = api(`${base}/releases/${release.id}`);
      inspect(current);
      gh([
        "release",
        "upload",
        tag,
        path.join(directory, name),
        "--repo",
        repo,
        "--clobber",
      ]);
    }
    release = api(`${base}/releases/${release.id}`);
    decision = inspect(release);
    verifyDownloaded(
      release,
      sha256(fs.readFileSync(path.join(directory, SUMS))),
    );
    console.log(
      `Verified draft ${tag}; preserved extra assets: ${decision.extras.join(", ") || "none"}`,
    );
  } else {
    verifyDownloaded(release, directoryOrDigest);
    release = api(`${base}/releases/${release.id}`);
    decision = inspect(release);
    // Re-read digests and the tag immediately before the sole public-state mutation.
    verifyDownloaded(release, directoryOrDigest);
    inspect(release);
    console.log(
      `Publishing also exposes preserved extra assets: ${decision.extras.join(", ") || "none"}`,
    );
    const published = api(`${base}/releases/${release.id}`, "PATCH", {
      draft: false,
    });
    if (
      published.draft ||
      published.tag_name !== tag ||
      published.id !== release.id
    )
      throw new Error("Publication outcome not confirmed");
    console.log(`Published ${published.html_url}`);
  }
  function verifyDownloaded(current, pinnedDigest) {
    if (current.target_commitish !== commit)
      throw new Error("Draft target metadata mismatch");
    const buffers = {};
    for (const name of OWNED) {
      const matches = current.assets.filter((asset) => asset.name === name);
      if (matches.length !== 1)
        throw new Error(`Required asset missing or duplicated: ${name}`);
      buffers[name] = gh([
        "api",
        `${base}/releases/assets/${matches[0].id}`,
        "--header",
        "Accept: application/octet-stream",
      ]);
    }
    verifySums(buffers[SUMS], buffers, pinnedDigest);
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      error.message.startsWith("Command failed")
        ? "GitHub command failed; no further mutations attempted."
        : error.message,
    );
    process.exitCode = 1;
  });
