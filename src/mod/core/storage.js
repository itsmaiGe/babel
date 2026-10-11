"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const fsp = fs.promises;
function readBounded(file, limit) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    if (fs.fstatSync(fd).size > limit) throw new Error("FILE_TOO_LARGE");
    const buffer = Buffer.alloc(limit + 1);
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (size > limit) throw new Error("FILE_TOO_LARGE");
    return buffer.subarray(0, size).toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function identity(file) {
  try {
    const s = fs.statSync(file, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    throw error;
  }
}
class Writer {
  constructor() {
    this.tail = Promise.resolve();
  }
  enqueue(operation) {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
  async atomic(file, data, guard = () => true) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, data, { mode: 0o600 });
      if (!guard()) return false;
      await fsp.rename(temporary, file);
      return true;
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }
  async recovery(file, encryptedContents) {
    try {
      if (encryptedContents !== undefined) {
        await fsp.access(file);
        await fsp.writeFile(`${file}.pre-0.1.6`, encryptedContents, {
          flag: "wx",
          mode: 0o600,
        });
      } else
        await fsp.copyFile(
          file,
          `${file}.pre-0.1.6`,
          fs.constants.COPYFILE_EXCL,
        );
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EEXIST") throw error;
    }
  }
}
module.exports = { readBounded, identity, Writer };
