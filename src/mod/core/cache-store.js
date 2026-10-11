"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { failure } = require("./errors");
class CacheStore {
  constructor(directory, writer) {
    this.file = path.join(directory, "cache.json");
    this.writer = writer;
    this.generation = 0;
    this.entries = new Map();
    this.timer = null;
    this.error = null;
    this.maxBytes = 4 * 1024 * 1024;
    const generation = this.generation;
    this.ready = (async () => {
      let handle;
      try {
        handle = await fs.promises.open(this.file, "r");
        if ((await handle.stat()).size > this.maxBytes + 4096)
          throw new Error("oversized");
        const data = Buffer.alloc(this.maxBytes + 4097),
          { bytesRead } = await handle.read(data, 0, data.length, 0);
        if (bytesRead > this.maxBytes + 4096) throw new Error("oversized");
        const parsed = JSON.parse(data.subarray(0, bytesRead));
        if (
          this.generation !== generation ||
          parsed.version !== 2 ||
          !Array.isArray(parsed.entries)
        )
          return;
        for (const [key, text] of parsed.entries)
          if (
            typeof key === "string" &&
            /^[a-f0-9]{64}$/.test(key) &&
            typeof text === "string"
          )
            this.entries.set(key, text);
        this.trim();
      } catch (error) {
        if (error.code !== "ENOENT")
          this.error = { code: "STORAGE", reason: "CACHE_READ" };
      } finally {
        await handle?.close();
      }
    })();
  }
  serialized() {
    return JSON.stringify({ version: 2, entries: [...this.entries] });
  }
  bytes() {
    return Buffer.byteLength(this.serialized());
  }
  trim() {
    while (this.entries.size > 500 || this.bytes() > this.maxBytes)
      this.entries.delete(this.entries.keys().next().value);
  }
  get(key) {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  put(key, text, generation) {
    if (
      generation !== this.generation ||
      typeof text !== "string" ||
      Buffer.byteLength(JSON.stringify([key, text])) > this.maxBytes - 64
    )
      return;
    this.entries.delete(key);
    this.entries.set(key, text);
    this.trim();
    this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, 3000);
    this.timer.unref?.();
  }
  flush() {
    const generation = this.generation,
      data = this.serialized();
    return this.writer.enqueue(async () => {
      if (generation !== this.generation) return;
      try {
        await this.writer.atomic(
          this.file,
          data,
          () => generation === this.generation,
        );
        this.error = null;
      } catch (_) {
        this.error = { code: "STORAGE", reason: "CACHE_WRITE" };
      }
    });
  }
  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    this.entries.clear();
    return this.writer.enqueue(async () => {
      try {
        await fs.promises.rm(this.file, { force: true });
        this.error = null;
      } catch (_) {
        this.error = { code: "STORAGE", reason: "CACHE_CLEAR" };
        throw failure(this.error.code, null, { reason: this.error.reason });
      }
    });
  }
  status() {
    return {
      count: this.entries.size,
      bytes: this.bytes(),
      error: this.error,
      generation: this.generation,
    };
  }
}
module.exports = { CacheStore };
