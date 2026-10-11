"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");
const TEST_ONLY =
  /\/\* @dtm-test-only:start[\s\S]*?@dtm-test-only:end \*\/\n?/g;
const digest = (data) => createHash("sha256").update(data).digest("hex");
function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    value.split("/").every((part) => part && part !== "." && part !== "..") &&
    !path.posix.isAbsolute(value)
  );
}
function stripTests(data) {
  const text = data.toString("utf8").replace(TEST_ONLY, "");
  if (text.includes("@dtm-test-only"))
    throw new Error("Unbalanced test-only payload marker");
  return Buffer.from(text);
}
function collect(sourceRoot = path.join(ROOT, "src")) {
  const files = new Map();
  function walk(dir, prefix) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name),
        relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink())
        throw new Error(`Payload symlink: ${relative}`);
      if (entry.isDirectory()) walk(file, `${relative}/`);
      else if (entry.isFile() && entry.name.endsWith(".js"))
        files.set(
          relative,
          Buffer.from(
            stripTests(fs.readFileSync(file))
              .toString()
              .replace(
                /require\(["\']\.\.\/\.\.\/shared\/([^"\']+)["\']\)/g,
                'require("../shared/$1")',
              ),
          ),
        );
    }
  }
  walk(path.join(sourceRoot, "mod"), "");
  walk(path.join(sourceRoot, "shared"), "shared/");
  for (const name of [
    "main.js",
    "preload.js",
    "renderer.js",
    "shared/settings.js",
    "shared/defaults.js",
  ]) {
    if (!files.has(name)) throw new Error(`Missing payload entry: ${name}`);
  }
  return files;
}
function describePayload(
  sourceRoot = path.join(ROOT, "src"),
  version = require(path.join(ROOT, "package.json")).version,
) {
  if (fs.existsSync(path.join(sourceRoot, "manifest.json")))
    return validatePayload(sourceRoot, version);
  const files = collect(sourceRoot);
  return {
    version,
    files: [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, data]) => ({
        path: name,
        bytes: data.length,
        sha256: digest(data),
      })),
  };
}
function emitPayload(
  destination,
  {
    sourceRoot,
    version = require(path.join(ROOT, "package.json")).version,
  } = {},
) {
  const files = collect(sourceRoot);
  const manifest = {
    version,
    files: [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        path: name,
        bytes: data.length,
        sha256: digest(data),
      })),
  };
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, data] of files) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  fs.writeFileSync(
    path.join(destination, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  validatePayload(destination, version);
  return manifest;
}
function validatePayload(directory, expectedVersion) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  if (
    !manifest.version ||
    (expectedVersion && manifest.version !== expectedVersion) ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Payload version/manifest invalid");
  const names = new Set();
  for (const entry of manifest.files) {
    if (!safePath(entry.path) || names.has(entry.path))
      throw new Error("Unsafe or duplicate payload path");
    names.add(entry.path);
    const target = path.join(directory, entry.path);
    for (
      let current = target;
      current !== directory;
      current = path.dirname(current)
    ) {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error("Payload symlink");
    }
    const data = fs.readFileSync(target);
    if (data.length !== entry.bytes || digest(data) !== entry.sha256)
      throw new Error(`Payload checksum mismatch: ${entry.path}`);
    if (data.includes(Buffer.from("@dtm-test-only")))
      throw new Error(`Test marker in payload: ${entry.path}`);
    // Verify static relative imports. The source fallback ../shared is paired with ./shared.
    for (const match of data
      .toString()
      .matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      let imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(entry.path), match[1]),
      );
      if (!imported.endsWith(".js")) imported += ".js";
      if (imported.startsWith("../shared/")) imported = imported.slice(3);
      if (
        !names.has(imported) &&
        !manifest.files.some((file) => file.path === imported)
      )
        throw new Error(
          `Unresolved payload import: ${entry.path} -> ${match[1]}`,
        );
    }
  }
  for (const name of [
    "main.js",
    "preload.js",
    "renderer.js",
    "shared/settings.js",
    "shared/defaults.js",
  ])
    if (!names.has(name)) throw new Error(`Missing entry ${name}`);
  const version = fs
    .readFileSync(path.join(directory, "shared/defaults.js"), "utf8")
    .match(/const BABEL_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  if (version !== manifest.version)
    throw new Error("Embedded version mismatch");
  return manifest;
}
function copyVerifiedPayload(source, destination) {
  const manifest = validatePayload(source);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of manifest.files) {
    const target = path.join(destination, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, entry.path), target);
  }
  fs.copyFileSync(
    path.join(source, "manifest.json"),
    path.join(destination, "manifest.json"),
  );
  validatePayload(destination);
  return manifest;
}
module.exports = {
  describePayload,
  emitPayload,
  validatePayload,
  copyVerifiedPayload,
  safePath,
  stripTests,
};
