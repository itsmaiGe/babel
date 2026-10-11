"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const contentDigest = (value) =>
  value === null ? "absent" : createHash("sha256").update(value).digest("hex");
const {
  normalizeSettings,
  normalizeEndpoint,
  validateEndpoint,
} = require("../../shared/settings");
const { readBounded, identity } = require("./storage");
const { failure } = require("./errors");
const clone = (value) => JSON.parse(JSON.stringify(value));
function executionKey(settings) {
  return JSON.stringify({
    enabled: settings.enabled,
    model: settings.model || {},
    translationStyle: settings.translationStyle,
    customPrompt: settings.customPrompt,
    send: settings.sendTranslation.enabled,
  });
}
class SettingsStore {
  constructor(directory, writer, keys, changed = () => {}) {
    this.file = path.join(directory, "settings.json");
    this.writer = writer;
    this.keys = keys;
    this.changed = changed;
    this.settings = normalizeSettings({});
    this.settingsRevision = 1;
    this.executionRevision = 1;
    this.status = null;
    this.fileIdentity = "initial";
    this.reload(true);
  }
  reload(force = false) {
    let current;
    try {
      current = identity(this.file);
    } catch (_) {
      const changed = this.fileIdentity !== "unreadable";
      this.fileIdentity = "unreadable";
      this.status = {
        code: "MALFORMED",
        reason: "UNREADABLE",
        message:
          "配置文件无法读取，继续使用上次有效配置。请检查文件权限或重新加载。",
      };
      if (changed) {
        this.settingsRevision++;
        this.changed(this.snapshot(false));
      }
      return;
    }
    if (!force && current === this.fileIdentity) return;
    const first = this.fileIdentity === "initial",
      previous = executionKey(this.settings);
    let externalChange = !first && current !== this.fileIdentity;
    this.fileIdentity = current;
    try {
      const text = readBounded(this.file, 256 * 1024);
      const digest = contentDigest(text);
      if (!first && this.fileDigest !== undefined && this.fileDigest !== digest)
        externalChange = true;
      this.fileDigest = digest;
      const raw = text ? JSON.parse(text) : {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Malformed settings");
      this.savedCustomEndpoint = false;
      if (raw.model?.provider === "custom")
        try {
          normalizeEndpoint(raw.model.baseUrl);
          this.savedCustomEndpoint = true;
        } catch (_) {}
      const next = normalizeSettings(raw);
      if (
        first &&
        this.savedCustomEndpoint &&
        raw.model.allowInsecureHttp === undefined
      ) {
        const endpoint = normalizeEndpoint(next.model.baseUrl);
        if (endpoint.startsWith("http:")) {
          next.model.allowInsecureHttp = true;
          next.model.insecureHttpEndpoint = endpoint;
        }
      }
      this.settings = next;
      this.status = null;
    } catch (_) {
      this.status = {
        code: "MALFORMED",
        reason: "INVALID_JSON",
        message:
          "配置文件无法读取，继续使用上次有效配置。请重新加载或明确覆盖。",
      };
    }
    if (externalChange) this.settingsRevision++;
    if (externalChange && previous !== executionKey(this.settings))
      this.executionRevision++;
    if (externalChange) this.changed(this.snapshot(false));
  }
  snapshot(check = true) {
    if (check) this.reload();
    return {
      settings: clone(this.settings),
      settingsRevision: this.settingsRevision,
      executionRevision: this.executionRevision,
      status: this.status,
    };
  }
  startWatching() {
    this.stopWatching();
    // Directory watch delivery is best effort on some filesystems. This bounded
    // metadata check reads content only when the file identity changes.
    this.watchHealth = setInterval(
      () => this.writer.enqueue(() => this.reload()).catch(() => {}),
      1500,
    );
    this.watchHealth.unref?.();
    const directory = path.dirname(this.file);
    const target = fs.existsSync(directory)
      ? directory
      : path.dirname(directory);
    try {
      this.watcher = fs.watch(target, (_event, name) => {
        if (
          name &&
          String(name) !==
            (target === directory
              ? path.basename(this.file)
              : path.basename(directory))
        )
          return;
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          if (target !== directory || !fs.existsSync(directory))
            this.startWatching();
          this.writer.enqueue(() => this.reload()).catch(() => {});
        }, 150);
        this.watchTimer.unref?.();
      });
      this.watcher.unref?.();
    } catch (_) {
      /* Relevant IPC operations still recheck file metadata. */
    }
  }
  stopWatching() {
    clearInterval(this.watchHealth);
    this.watchHealth = null;
    this.watcher?.close();
    this.watcher = null;
    clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }
  async save(request) {
    return this.writer.enqueue(async () => {
      this.reload(true);
      // A forced content recheck of an unchanged file must not itself create a conflict.
      if (request.baseSettingsRevision !== this.settingsRevision)
        throw failure("CONFLICT");
      const settings = normalizeSettings(request.settings);
      validateEndpoint(settings.model);
      Object.assign(settings.sendBox, {
        x: this.settings.sendBox.x,
        y: this.settings.sendBox.y,
        width: this.settings.sendBox.width,
      });
      let keyRequest = request.key || { action: "keep" };
      let resetAside = null;
      let resetFault = null;
      let resetRecoverable = false;
      if (keyRequest.action === "reset") {
        resetFault = this.keys.fault;
        resetRecoverable = this.keys.recoverable;
        resetAside = await this.keys.preserveAndClear();
        keyRequest = { action: "keep" };
      }
      const prepared = this.keys.prepare(settings.model, keyRequest);
      const previousKeys = this.keys.store,
        previousExecution = executionKey(this.settings);
      let keysWritten = false;
      try {
        await this.writer.recovery(this.file);
        if (prepared.changed) await this.writer.recovery(this.keys.file);
        if (prepared.changed) {
          await this.writer.atomic(
            this.keys.file,
            JSON.stringify(prepared.store),
          );
          keysWritten = true;
        }
        await this.writer.atomic(
          this.file,
          `${JSON.stringify(settings, null, 2)}\n`,
          () => {
            if (
              identity(this.file) !== this.fileIdentity ||
              contentDigest(readBounded(this.file, 256 * 1024)) !==
                this.fileDigest
            ) {
              this.reload(true);
              throw failure("CONFLICT");
            }
            return true;
          },
        );
      } catch (saveError) {
        if (resetAside) {
          const restored = await this.keys.restoreDamaged(
            resetAside,
            resetFault,
            resetRecoverable,
          );
          if (!restored) {
            this.status = {
              code: "PARTIAL_SAVE",
              reason: "KEY_ROLLBACK_FAILED",
              message: "配置保存失败，密钥恢复也失败，请重新加载。",
            };
            this.changed(this.snapshot(false));
            throw failure("PARTIAL_SAVE", null, {
              reason: "KEY_ROLLBACK_FAILED",
            });
          }
        }
        if (
          !keysWritten &&
          (saveError?.code === "MALFORMED" ||
            (saveError?.code === "STORAGE" &&
              ["ACCESS_DENIED", "READ_FAILED"].includes(saveError.reason)))
        )
          throw saveError;
        let recovered = !keysWritten;
        if (keysWritten)
          try {
            await this.writer.atomic(
              this.keys.file,
              JSON.stringify(previousKeys),
            );
            recovered = true;
          } catch (_) {
            this.keys.store = prepared.store;
            this.executionRevision++;
          }
        if (saveError.code === "CONFLICT" && recovered) throw saveError;
        if (!keysWritten) {
          this.status = {
            code: "STORAGE",
            reason: "WRITE_FAILED",
            message: "配置保存失败，请检查配置文件夹权限。",
          };
          this.changed(this.snapshot(false));
          throw failure("STORAGE", null, { reason: "WRITE_FAILED" });
        }
        this.status = {
          code: "PARTIAL_SAVE",
          reason: recovered ? "KEY_RESTORED" : "KEY_ROLLBACK_FAILED",
          message: recovered
            ? "保存失败，已恢复原密钥；请重试。"
            : "配置保存失败，密钥恢复也失败，请重新加载。",
        };
        this.changed(this.snapshot(false));
        throw failure("PARTIAL_SAVE", null, { reason: this.status.reason });
      }
      this.keys.store = prepared.store;
      this.settings = settings;
      this.fileIdentity = identity(this.file);
      this.fileDigest = contentDigest(`${JSON.stringify(settings, null, 2)}\n`);
      this.status = null;
      this.settingsRevision++;
      if (prepared.changed || previousExecution !== executionKey(settings))
        this.executionRevision++;
      const result = this.snapshot(false);
      this.changed(result);
      return result;
    });
  }
  async patchSendBox(patch) {
    return this.writer.enqueue(async () => {
      this.reload();
      if (this.status) throw failure("CONFLICT");
      const next = normalizeSettings({
        ...this.settings,
        sendBox: { ...this.settings.sendBox, ...patch },
      });
      await this.writer.atomic(
        this.file,
        `${JSON.stringify(next, null, 2)}\n`,
        () => {
          if (
            identity(this.file) !== this.fileIdentity ||
            contentDigest(readBounded(this.file, 256 * 1024)) !==
              this.fileDigest
          ) {
            this.reload(true);
            throw failure("CONFLICT");
          }
          return true;
        },
      );
      this.settings = next;
      this.fileIdentity = identity(this.file);
      this.fileDigest = contentDigest(`${JSON.stringify(next, null, 2)}\n`);
      return this.snapshot(false);
    });
  }
}
module.exports = { SettingsStore, executionKey };
