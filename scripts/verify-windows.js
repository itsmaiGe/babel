#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  os = require("node:os");
const { validatePayload } = require("./lib/payload"),
  { writeMetadata, versionPins } = require("./lib/build-metadata");
const root = path.resolve(__dirname, ".."),
  binary = path.join(root, "dist/Babel-Installer.exe"),
  payload = path.join(root, "installer/payload");
function main() {
  const manifest = validatePayload(payload);
  versionPins(manifest.version);
  const buildInfo = cp.execFileSync(
    process.env.BABEL_GO || "go",
    ["version", "-m", binary],
    { encoding: "utf8" },
  );
  if (
    !/CGO_ENABLED=0/.test(buildInfo) ||
    !/GOOS=windows/.test(buildInfo) ||
    /giu|cimgui|glfw|OpenGL/i.test(buildInfo)
  )
    throw new Error("Windows build metadata invalid");
  const bytes = fs.readFileSync(binary);
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a)
    throw new Error("Invalid Windows PE image");
  // Go embed stores the complete manifest and each file byte-for-byte in the executable.
  for (const name of [
    "manifest.json",
    ...manifest.files.map((entry) => entry.path),
  ])
    if (!bytes.includes(fs.readFileSync(path.join(payload, name))))
      throw new Error(`Missing embedded payload bytes: ${name}`);
  require("./lib/i18n").generate({ check: true });
  for (const locale of require("./lib/i18n").LOCALES) {
    const source = JSON.parse(fs.readFileSync(path.join(root, "i18n/messages", `${locale}.json`), "utf8"));
    for (const id of ["win.title", "win.install", "win.permission", "common.detail.kept"]) {
      const value = locale === "en" ? source[id].message : source[id];
      if (!bytes.includes(Buffer.from(value))) throw new Error(`Missing compiled native catalog ${locale}/${id}`);
    }
  }
  let nativeUIVerified = false;
  if (process.platform === "win32") {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-win-verify-"));
    try {
      const verified = path.join(temp, "payload.json"),
        smoke = path.join(temp, "ui.json");
      cp.execFileSync(binary, ["--verify-payload", verified], {
        timeout: 30000,
      });
      const embedded = JSON.parse(fs.readFileSync(verified));
      if (JSON.stringify(embedded) !== JSON.stringify(manifest))
        throw new Error("Native payload validation mismatch");
      cp.execFileSync(binary, ["--smoke-ui", smoke], { timeout: 30000 });
      const localizationFile = path.join(temp, "localization.json");
      cp.execFileSync(binary, ["--verify-localization", localizationFile], { timeout: 30000 });
      const localized = JSON.parse(fs.readFileSync(localizationFile));
      for (const locale of require("./lib/i18n").LOCALES) {
        const source = JSON.parse(fs.readFileSync(path.join(root, "i18n/messages", `${locale}.json`), "utf8"));
        for (const [id, value] of Object.entries(localized[locale]))
          if (value !== (locale === "en" ? source[id].message : source[id])) throw new Error(`Native localization lookup mismatch ${locale}/${id}`);
      }
      const controls = JSON.parse(fs.readFileSync(smoke));
      for (let id = 101; id <= 115; id++) {
        const expected =
          id === 104 || id === 110
            ? "EDIT"
            : [105, 111, 112, 113, 114].includes(id)
              ? "BUTTON"
              : id === 108
                ? "msctls_progress32"
                : "STATIC";
        if (controls.Controls[id]?.toUpperCase() !== expected.toUpperCase())
          throw new Error(`Missing native control ${id}`);
      }
      if (controls.Version !== manifest.version)
        throw new Error("Native UI version mismatch");
      nativeUIVerified = true;
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } else if (!process.argv.includes("--cross"))
    throw new Error("Windows native UI verification requires a Windows runner");
  const metadata = writeMetadata("windows", "Babel-Installer.exe", manifest, {
    cgo: "0",
    embeddedVersion: manifest.version,
    nativeUIVerified,
  });
  console.log(
    `Verified Windows EXE (${metadata.bytes} bytes); native UI: ${nativeUIVerified ? "passed" : "requires Windows"}`,
  );
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
