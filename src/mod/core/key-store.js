"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { readBounded } = require("./storage");
const { failure } = require("./errors");
const { MODEL_PROVIDERS } = require("../../shared/defaults");
const { normalizeEndpoint } = require("../../shared/settings");
class KeyStore {
  constructor(directory, electron, writer) {
    this.file = path.join(directory, "api-keys.json");
    this.electron = electron;
    this.writer = writer;
    this.store = {};
    this.fault = null;
    this.recoverable = false;
    try {
      const raw = readBounded(this.file, 256 * 1024);
      // null is a missing file. An existing zero-byte file is damaged data.
      if (raw == null) return;
      const parsed = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        this.fault = failure("MALFORMED", null, { reason: "INVALID_JSON" });
        this.recoverable = true;
        return;
      }
      this.store = parsed;
    } catch (error) {
      const oversized = error?.message === "FILE_TOO_LARGE";
      if (error instanceof SyntaxError || oversized) {
        this.fault = failure("MALFORMED", null, {
          reason: oversized ? "OVERSIZED" : "INVALID_JSON",
        });
        this.recoverable = true;
        return;
      }
      const denied = error?.code === "EACCES" || error?.code === "EPERM";
      this.fault = failure("STORAGE", null, {
        reason: denied ? "ACCESS_DENIED" : "READ_FAILED",
      });
    }
  }
  slot(model) {
    return model.provider === "custom"
      ? `custom:${normalizeEndpoint(model.baseUrl)}`
      : model.provider;
  }
  secure() {
    return Boolean(this.electron.safeStorage?.isEncryptionAvailable?.());
  }
  decrypt(entry) {
    if (!entry) return "";
    try {
      if (entry.enc === "safeStorage")
        return this.secure()
          ? this.electron.safeStorage.decryptString(
              Buffer.from(entry.value, "base64"),
            )
          : "";
      if (entry.enc === "plain")
        return Buffer.from(entry.value, "base64").toString("utf8");
    } catch (_) {
      /* No secret or raw provider detail is returned. */
    }
    return "";
  }
  encrypt(value) {
    if (!this.secure()) throw failure("SECURE_STORAGE");
    return {
      enc: "safeStorage",
      value: this.electron.safeStorage.encryptString(value).toString("base64"),
      credentialId: crypto.randomUUID(),
    };
  }
  async migrate(settings, savedCustomEndpoint) {
    if (this.fault) return;
    if (!this.secure()) {
      // Stable for this process; unavailable encryption must not create plaintext
      // recovery copies or rewrite a legacy key store.
      for (const entry of Object.values(this.store))
        if (entry && typeof entry === "object" && !entry.credentialId)
          entry.credentialId = crypto.randomUUID();
      return;
    }
    const next = structuredClone(this.store);
    let changed = false;
    for (const entry of Object.values(next)) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.enc === "plain" && this.secure()) {
        const value = this.decrypt(entry);
        Object.assign(entry, this.encrypt(value));
        changed = true;
      }
      if (!entry.credentialId) {
        entry.credentialId = crypto.randomUUID();
        changed = true;
      }
    }
    const recovery = structuredClone(next);
    if (
      next.custom &&
      savedCustomEndpoint &&
      settings.model.provider === "custom"
    ) {
      try {
        const slot = this.slot(settings.model);
        if (!next[slot]) {
          next[slot] = next.custom;
          delete next.custom;
          changed = true;
        }
      } catch (_) {}
    }
    if (changed)
      await this.writer.enqueue(async () => {
        await this.writer.recovery(
          path.join(path.dirname(this.file), "settings.json"),
        );
        await this.writer.recovery(this.file, JSON.stringify(recovery));
        await this.writer.atomic(this.file, JSON.stringify(next));
        this.store = next;
      });
  }
  credential(model, typed) {
    if (typeof typed === "string" && typed.trim())
      return {
        apiKey: typed.trim(),
        namespace: `typed:${crypto.randomUUID()}`,
      };
    if (this.fault) {
      if (model?.provider === "custom")
        return {
          apiKey: "",
          namespace: `unavailable:${this.fault.reason || "READ_FAILED"}`,
          unavailable: true,
        };
      throw this.fault;
    }
    const slot = this.slot(model),
      entry = this.store[slot];
    const apiKey = this.decrypt(entry);
    if (entry && !apiKey) throw failure("KEY_UNAVAILABLE");
    return {
      apiKey,
      namespace: entry
        ? `credential:${entry.credentialId}`
        : `anonymous:${normalizeEndpoint(model.baseUrl)}`,
    };
  }
  displayContext(model) {
    if (this.fault)
      return crypto
        .createHash("sha256")
        .update(`unavailable:${this.fault.reason || "READ_FAILED"}`)
        .digest("hex");
    let slot;
    try {
      slot = this.slot(model);
    } catch (_) {
      return "invalid-endpoint";
    }
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([slot, this.store[slot]?.credentialId || "anonymous"]),
      )
      .digest("hex");
  }
  status(model) {
    if (this.fault)
      return {
        previews: {},
        unlinked: false,
        secureStorageAvailable: this.secure(),
        unavailable: {
          code: this.fault.code,
          reason: this.fault.reason,
          recoverable: this.recoverable,
        },
      };
    const result = {
      previews: {},
      unlinked: Boolean(this.store.custom),
      secureStorageAvailable: this.secure(),
    };
    for (const provider of MODEL_PROVIDERS) {
      let entry;
      try {
        entry =
          this.store[
            this.slot({ provider: provider.value, baseUrl: model.baseUrl })
          ];
      } catch (_) {}
      const value = this.decrypt(entry);
      result[provider.value] = Boolean(entry);
      if (value)
        result.previews[provider.value] =
          value.length <= 8
            ? `${value.slice(0, 2)}…${value.slice(-2)}`
            : `${value.slice(0, 4)}…${value.slice(-4)}`;
    }
    return result;
  }
  async preserveAndClear() {
    if (!this.fault || !this.recoverable)
      throw this.fault || failure("STORAGE", null, { reason: "ACCESS_DENIED" });
    const aside = `${this.file}.damaged-${crypto.randomBytes(8).toString("hex")}`;
    try {
      await fs.promises.rename(this.file, aside);
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM")
        throw failure("STORAGE", null, { reason: "ACCESS_DENIED" });
      throw error;
    }
    this.store = {};
    this.fault = null;
    this.recoverable = false;
    return aside;
  }
  async restoreDamaged(aside, fault, recoverable) {
    // link is atomic and does not replace. A file present at publication stays put,
    // and a failed link never unlinks that target or the damaged backup.
    try {
      await fs.promises.link(aside, this.file);
    } catch (_) {
      return false;
    }
    await fs.promises.unlink(aside).catch(() => {});
    this.store = {};
    this.fault = fault || null;
    this.recoverable = Boolean(recoverable);
    return true;
  }
  prepare(model, action = { action: "keep" }) {
    if (this.fault) {
      if (action.action === "keep") return { store: this.store, changed: false };
      throw this.fault;
    }
    if (
      action.action !== "keep" &&
      !this.secure() &&
      Object.values(this.store).some((entry) => entry?.enc === "plain")
    )
      throw failure("SECURE_STORAGE");
    const next = structuredClone(this.store),
      slot = this.slot(model);
    if (action.action === "replace") {
      if (
        typeof action.value !== "string" ||
        !action.value.trim() ||
        action.value.length > 8192
      )
        throw failure("INPUT");
      next[slot] = this.encrypt(action.value.trim());
    } else if (action.action === "remove") delete next[slot];
    else if (action.action === "link") {
      if (model.provider !== "custom" || !next.custom || next[slot])
        throw failure("CONFIG");
      next[slot] = { ...next.custom, credentialId: crypto.randomUUID() };
      delete next.custom;
    } else if (action.action === "removeLegacy") delete next.custom;
    else if (action.action !== "keep") throw failure("INPUT");
    return { store: next, changed: action.action !== "keep" };
  }
}
module.exports = { KeyStore };
