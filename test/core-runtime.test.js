"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Writer } = require("../src/mod/core/storage"),
  { CacheStore } = require("../src/mod/core/cache-store"),
  { KeyStore } = require("../src/mod/core/key-store"),
  { SettingsStore, executionKey } = require("../src/mod/core/settings-store"),
  { TranslationService } = require("../src/mod/core/translation-service"),
  { IpcGuard } = require("../src/mod/core/ipc-guard"),
  { createProvider } = require("../src/mod/core/provider-fetch"),
  {
    normalizeSettings,
    normalizeEndpoint,
    validateEndpoint,
  } = require("../src/shared/settings");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
function fixture(t, provider) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "babel-service-")),
    writer = new Writer(),
    cache = new CacheStore(directory, writer),
    safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
    };
  const keys = new KeyStore(directory, { safeStorage }, writer),
    settings = new SettingsStore(directory, writer, keys);
  settings.settings = normalizeSettings({
    model: { provider: "custom", baseUrl: "https://first.invalid/v1" },
    sendTranslation: { enabled: true },
  });
  const service = new TranslationService({
    snapshot: () => settings.snapshot(),
    credential: (model) => keys.credential(model),
    provider: provider || { translate: async () => "result" },
    cache,
  });
  t.after(async () => {
    for (const c of [...service.consumers.values()])
      service.cancel(c.owner, [c.requestId]);
    clearTimeout(cache.timer);
    await writer.tail;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let id = 0;
  const request = (text = "source", priority = "foreground", extra = {}) => ({
    requestId: `test:${++id}`,
    expectedExecutionRevision: settings.executionRevision,
    direction: "read",
    text,
    priority,
    ...extra,
  });
  return { directory, writer, cache, keys, settings, service, request };
}
test("endpoint normalization isolates exact paths and rejects credential-bearing URL parts", () => {
  assert.equal(
    normalizeEndpoint("https://EXAMPLE.com:443/v1///"),
    "https://example.com/v1",
  );
  for (const value of [
    "https://user:secret@example.com",
    "https://example.com?key=secret",
    "https://example.com#secret",
    "file:///tmp",
  ])
    assert.throws(() => normalizeEndpoint(value));
  assert.throws(() =>
    validateEndpoint({
      baseUrl: "http://example.com/v1",
      allowInsecureHttp: true,
      insecureHttpEndpoint: "http://another.invalid/v1",
    }),
  );
  for (const value of [
    "http://localhost:1234/v1",
    "http://127.0.0.1/v1",
    "http://[::1]/v1",
  ])
    assert.equal(validateEndpoint({ baseUrl: value }), value);
});
test("identical requests share one call and cancellation belongs only to the caller", async (t) => {
  const pending = deferred();
  let calls = 0,
    signal;
  const f = fixture(t, {
    translate: (request) => {
      calls++;
      signal = request.signal;
      return pending.promise;
    },
  });
  const a = f.request(),
    b = f.request();
  const tasks = [f.service.translate(1, a), f.service.translate(2, b)];
  await f.cache.ready;
  await tick();
  assert.equal(calls, 1);
  f.service.cancel(1, [b.requestId]);
  assert.equal(signal.aborted, false);
  f.service.cancel(1, [a.requestId]);
  assert.equal(signal.aborted, false);
  pending.resolve("shared");
  const [first, second] = await Promise.all(tasks);
  assert.equal(first.error.code, "CANCELED");
  assert.equal(second.text, "shared");
});
test("last consumer cancels both started and queued work", async (t) => {
  const f = fixture(t, {
    translate: ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error(), { code: "CANCELED" })),
        ),
      ),
  });
  const requests = Array.from({ length: 5 }, (_, i) => f.request(String(i)));
  const tasks = requests.map((r) => f.service.translate(1, r));
  await f.cache.ready;
  await tick();
  assert.equal(f.service.active, 4);
  f.service.cancel(
    1,
    requests.map((r) => r.requestId),
  );
  const results = await Promise.all(tasks);
  assert.ok(results.every((r) => r.error.code === "CANCELED"));
  await f.cache.ready;
  await tick();
  assert.equal(f.service.active, 0);
  assert.equal(f.service.foreground.length, 0);
});
test("cancel during asynchronous cache startup never dispatches a provider call", async (t) => {
  let calls = 0;
  const f = fixture(t, {
      translate: async () => {
        calls++;
        return "result";
      },
    }),
    load = deferred();
  f.cache.ready = load.promise;
  const request = f.request(),
    task = f.service.translate(1, request);
  f.service.cancel(1, [request.requestId]);
  load.resolve();
  assert.equal((await task).error.code, "CANCELED");
  assert.equal(calls, 0);
});
test("40 messages respect active and queued bounds, and foreground is dispatched first", async (t) => {
  const pending = [];
  const f = fixture(t, {
    translate: ({ text }) => {
      const p = deferred();
      pending.push({ text, ...p });
      return p.promise;
    },
  });
  const tasks = Array.from({ length: 40 }, (_, i) =>
    f.service.translate(1, f.request(String(i), "background")),
  );
  await f.cache.ready;
  await tick();
  assert.equal(f.service.backgroundActive, 2);
  assert.equal(f.service.background.length, 16);
  const foreground = f.service.translate(1, f.request("manual"));
  await f.cache.ready;
  await tick();
  assert.ok(pending.some((p) => p.text === "manual"));
  assert.ok(f.service.active <= 4);
  f.service.cancel(
    1,
    [...f.service.consumers.values()].map((c) => c.requestId),
  );
  for (const p of pending) p.resolve("done");
  const results = await Promise.all([...tasks, foreground]);
  assert.ok(results.some((r) => r.error?.code === "BUSY_SKIPPED"));
});
test("auth failure stops background calls after at most two, and key revision lifts the pause", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    translate: async () => {
      calls++;
      throw Object.assign(new Error(), { code: "AUTH" });
    },
  });
  const tasks = Array.from({ length: 40 }, (_, i) =>
    f.service.translate(1, f.request(String(i), "background")),
  );
  await Promise.all(tasks);
  assert.ok(calls <= 2);
  assert.equal(
    (await f.service.translate(1, f.request("later", "background"))).error.code,
    "PAUSED",
  );
  f.settings.executionRevision++;
  f.service.invalidate(f.settings.executionRevision);
  await f.service.translate(1, f.request("new", "background"));
  assert.ok(calls <= 3);
});
test("stale and disabled requests are rejected before fetch", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    translate: async () => {
      calls++;
      return "translated";
    },
  });
  assert.equal(
    (
      await f.service.translate(
        1,
        f.request("source", "foreground", { expectedExecutionRevision: 0 }),
      )
    ).error.code,
    "STALE_REVISION",
  );
  f.settings.settings.enabled = false;
  assert.equal(
    (await f.service.translate(1, f.request())).error.code,
    "DISABLED",
  );
  assert.equal(calls, 0);
});
test("clear separates request generations and prevents old results from filling the cache", async (t) => {
  const old = deferred(),
    fresh = deferred();
  let calls = 0;
  const f = fixture(t, {
    translate: () => (++calls === 1 ? old.promise : fresh.promise),
  });
  const oldTask = f.service.translate(1, f.request());
  await f.cache.ready;
  await tick();
  await f.cache.clear();
  const newTask = f.service.translate(1, f.request());
  await f.cache.ready;
  await tick();
  old.resolve("old");
  assert.equal((await oldTask).text, "old");
  assert.equal(f.cache.status().count, 0);
  fresh.resolve("fresh");
  assert.equal((await newTask).text, "fresh");
  assert.equal(calls, 2);
  assert.equal(f.cache.status().count, 1);
});
test("clear racing an atomic write drops the stale snapshot and stores the next entry", async (t) => {
  const f = fixture(t);
  await f.cache.ready;
  f.cache.put("a".repeat(64), "cached", 0);
  const writing = f.cache.flush();
  const clearing = f.cache.clear();
  await Promise.all([writing, clearing]);
  assert.equal(fs.existsSync(f.cache.file), false);
  f.cache.put("b".repeat(64), "new", f.cache.generation);
  await f.cache.flush();
  const stored = JSON.parse(fs.readFileSync(f.cache.file, "utf8"));
  assert.equal(stored.entries.some(([key, text]) => key === "b".repeat(64) && text === "new"), true);
  assert.equal(f.cache.get("b".repeat(64)), "new");
});
test("credential namespace rotates and custom endpoints never reuse saved credentials", async (t) => {
  const f = fixture(t);
  let snapshot = f.settings.snapshot();
  await f.settings.save({
    baseSettingsRevision: snapshot.settingsRevision,
    settings: snapshot.settings,
    key: { action: "replace", value: "synthetic-key" },
  });
  const first = f.keys.credential(f.settings.settings.model);
  assert.equal(first.apiKey, "synthetic-key");
  assert.equal(
    f.keys.credential({
      ...f.settings.settings.model,
      baseUrl: "https://second.invalid/v1",
    }).apiKey,
    "",
  );
  snapshot = f.settings.snapshot();
  await f.settings.save({
    baseSettingsRevision: snapshot.settingsRevision,
    settings: snapshot.settings,
    key: { action: "replace", value: "synthetic-key" },
  });
  assert.notEqual(
    f.keys.credential(f.settings.settings.model).namespace,
    first.namespace,
  );
  assert.ok(!first.namespace.includes("synthetic"));
});
for (const valid of [true, false])
  test(`legacy custom key migration ${valid ? "links a valid saved endpoint" : "retains an ambiguous key inactive"}`, async (t) => {
    const f = fixture(t);
    f.keys.store = {
      custom: {
        enc: "plain",
        value: Buffer.from("synthetic-key").toString("base64"),
      },
    };
    await f.keys.migrate(f.settings.settings, valid);
    assert.equal(Boolean(f.keys.store.custom), !valid);
    assert.equal(f.keys.status(f.settings.settings.model).custom, valid);
    assert.ok(!fs.readFileSync(f.keys.file, "utf8").includes("synthetic-key"));
  });
test("malformed external changes retain last valid settings and conflict with an open form", async (t) => {
  const f = fixture(t),
    before = f.settings.snapshot();
  fs.mkdirSync(f.directory, { recursive: true });
  fs.writeFileSync(f.settings.file, "{broken");
  const after = f.settings.snapshot();
  assert.equal(after.settings.model.baseUrl, before.settings.model.baseUrl);
  assert.equal(after.status.code, "MALFORMED");
  assert.ok(after.settingsRevision > before.settingsRevision);
  await assert.rejects(
    f.settings.save({
      baseSettingsRevision: before.settingsRevision,
      settings: before.settings,
      key: { action: "keep" },
    }),
    { code: "CONFLICT" },
  );
  assert.equal(fs.readFileSync(f.settings.file, "utf8"), "{broken");
  await f.settings.save({
    baseSettingsRevision: after.settingsRevision,
    settings: after.settings,
    key: { action: "keep" },
  });
  assert.equal(f.settings.snapshot().status, null);
});
test("settings save and send-box drag preserve each other's fields", async (t) => {
  const f = fixture(t),
    snapshot = f.settings.snapshot(),
    settings = { ...snapshot.settings, customPrompt: "new prompt" };
  await Promise.all([
    f.settings.patchSendBox({ x: 22, y: 33, width: 444 }),
    f.settings.save({
      baseSettingsRevision: snapshot.settingsRevision,
      settings,
      key: { action: "keep" },
    }),
  ]);
  const result = f.settings.snapshot();
  assert.equal(result.settings.customPrompt, "new prompt");
  assert.equal(result.settings.sendBox.x, 22);
  assert.equal(result.settings.sendBox.width, 444);
  assert.equal(result.settingsRevision, snapshot.settingsRevision + 1);
});
test("settings-only write failure preserves keys and reports storage failure", async (t) => {
  const f = fixture(t),
    snapshot = f.settings.snapshot();
  const atomic = f.writer.atomic.bind(f.writer);
  f.writer.atomic = (file, ...args) => {
    if (file === f.settings.file)
      throw Object.assign(new Error("synthetic write failure"), {
        code: "EACCES",
      });
    return atomic(file, ...args);
  };
  await assert.rejects(
    f.settings.save({
      baseSettingsRevision: snapshot.settingsRevision,
      settings: snapshot.settings,
      key: { action: "keep" },
    }),
    { code: "STORAGE" },
  );
  assert.equal(f.settings.snapshot().status.code, "STORAGE");
  assert.deepEqual(f.keys.store, {});
  assert.equal(fs.existsSync(f.keys.file), false);
  assert.equal(fs.existsSync(f.settings.file), false);
});
for (const rollbackFails of [false, true]) {
  test(`failed settings save ${rollbackFails ? "reports a failed key rollback" : "restores the original key"}`, async (t) => {
    const f = fixture(t),
      initial = f.settings.snapshot();
    await f.settings.save({
      baseSettingsRevision: initial.settingsRevision,
      settings: initial.settings,
      key: { action: "replace", value: "synthetic-old-key" },
    });
    const before = f.settings.snapshot(),
      originalSettings = fs.readFileSync(f.settings.file, "utf8");
    const atomic = f.writer.atomic.bind(f.writer);
    let keyWrites = 0;
    f.writer.atomic = (file, ...args) => {
      if (
        file === f.settings.file ||
        (file === f.keys.file && ++keyWrites === 2 && rollbackFails)
      )
        throw Object.assign(new Error("synthetic write failure"), {
          code: "EACCES",
        });
      return atomic(file, ...args);
    };
    await assert.rejects(
      f.settings.save({
        baseSettingsRevision: before.settingsRevision,
        settings: { ...before.settings, customPrompt: "unsaved prompt" },
        key: { action: "replace", value: "synthetic-new-key" },
      }),
      { code: "PARTIAL_SAVE" },
    );
    assert.equal(fs.readFileSync(f.settings.file, "utf8"), originalSettings);
    const expected = rollbackFails ? "synthetic-new-key" : "synthetic-old-key";
    assert.equal(f.keys.credential(before.settings.model).apiKey, expected);
    const diskKeys = JSON.parse(fs.readFileSync(f.keys.file, "utf8"));
    assert.equal(
      f.keys.decrypt(diskKeys[f.keys.slot(before.settings.model)]),
      expected,
    );
    assert.equal(f.settings.snapshot().status.code, "PARTIAL_SAVE");
    assert.equal(
      f.settings.executionRevision,
      before.executionRevision + Number(rollbackFails),
    );
  });
}
test("IPC requires a patched window's actual main frame and verified origin", () => {
  const guard = new IpcGuard(),
    sender = { id: 1, mainFrame: { url: "https://discord.com/channels/1/2" } };
  guard.windows.set(1, sender);
  assert.equal(
    guard.authorize({ sender, senderFrame: sender.mainFrame }, () => true),
    1,
  );
  for (const event of [
    { sender, senderFrame: { url: sender.mainFrame.url } },
    { sender: { ...sender }, senderFrame: sender.mainFrame },
    { sender, senderFrame: { url: "https://evil.invalid" } },
  ])
    assert.throws(() => guard.authorize(event, () => true));
});
test("both provider network routes block redirects and bound response bytes without secret errors", async (t) => {
  const previous = global.fetch;
  t.after(() => {
    global.fetch = previous;
  });
  const settings = normalizeSettings({
    model: { provider: "custom", baseUrl: "https://first.invalid/v1" },
  });
  for (const electron of [
    {},
    {
      net: {
        fetch: async (_, options) => {
          assert.equal(options.redirect, "error");
          return { status: 302 };
        },
      },
    },
  ]) {
    global.fetch = async (_, options) => {
      assert.equal(options.redirect, "error");
      return { status: 302 };
    };
    await assert.rejects(
      createProvider(electron).translate({
        settings,
        apiKey: "synthetic-key",
        text: "source",
        direction: "read",
      }),
      { code: "REDIRECT_BLOCKED" },
    );
  }
  global.fetch = async () => new Response("x".repeat(256 * 1024 + 1));
  await assert.rejects(
    createProvider().translate({
      settings,
      apiKey: "synthetic-key",
      text: "source",
      direction: "read",
    }),
    { code: "RESPONSE_TOO_LARGE" },
  );
});

test("read cache follows the effective request and ignores send language", async (t) => {
  let calls = 0;
  const f = fixture(t, { translate: async () => `result:${++calls}` });
  async function read() {
    return f.service.translate(1, f.request("unchanged source"));
  }
  const first = await read();
  assert.equal((await read()).text, first.text);
  assert.equal(calls, 1);
  f.settings.settings.model.sendLanguage = "日语";
  assert.equal((await read()).cacheHit, true);
  f.settings.settings.model.temperature = 0.7;
  f.settings.settings.model.maxTokens = 777;
  assert.equal((await read()).cacheHit, true);
  assert.equal(calls, 1);
  for (const change of [
    (s) => (s.model.modelId = "another-model"),
    (s) => (s.model.targetLanguage = "日语"),
    (s) => {
      s.translationStyle = "custom";
      s.customPrompt = "Distinct prompt {{targetLanguage}}";
    },
    (s) => (s.customPrompt = "New prompt {{targetLanguage}}"),
    (s) => (s.model.baseUrl = "https://second.invalid/v2"),
    (s) => {
      f.keys.store = f.keys.prepare(s.model, {
        action: "replace",
        value: "synthetic-key",
      }).store;
    },
  ]) {
    change(f.settings.settings);
    f.settings.executionRevision++;
    assert.equal((await read()).cacheHit, undefined);
  }
  const before = calls;
  await f.service.translate(
    1,
    f.request("unchanged source", "foreground", { direction: "send" }),
  );
  await f.service.translate(
    1,
    f.request("unchanged source", "foreground", { direction: "send" }),
  );
  assert.equal(calls, before + 2);
});
test("execution identity includes send language and the read model", () => {
  const base = normalizeSettings({
    model: { sendLanguage: "英语", targetLanguage: "简体中文" },
    sendTranslation: { enabled: true },
  });
  const sent = normalizeSettings({
    ...base,
    model: { ...base.model, sendLanguage: "日语" },
  });
  assert.notEqual(executionKey(base), executionKey(sent));
  assert.notEqual(
    executionKey(base),
    executionKey(
      normalizeSettings({
        ...base,
        model: { ...base.model, targetLanguage: "日语" },
      }),
    ),
  );
  assert.notEqual(
    executionKey(base),
    executionKey(
      normalizeSettings({
        ...base,
        sendTranslation: { ...base.sendTranslation, enabled: false },
      }),
    ),
  );
});
test("saving only the send language bumps the execution revision", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "babel-exec-")),
    writer = new Writer(),
    keys = new KeyStore(directory, { safeStorage: { isEncryptionAvailable: () => true } }, writer),
    settings = new SettingsStore(directory, writer, keys);
  t.after(async () => {
    await writer.tail;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseline = await settings.save({
    baseSettingsRevision: settings.settingsRevision,
    settings: settings.settings,
    key: { action: "keep" },
  });
  const sent = await settings.save({
    baseSettingsRevision: baseline.settingsRevision,
    settings: normalizeSettings({
      ...baseline.settings,
      model: { ...baseline.settings.model, sendLanguage: "日语" },
    }),
    key: { action: "keep" },
  });
  assert.equal(sent.executionRevision, baseline.executionRevision + 1);
  const changed = await settings.save({
    baseSettingsRevision: sent.settingsRevision,
    settings: normalizeSettings({
      ...sent.settings,
      model: { ...sent.settings.model, targetLanguage: "日语" },
    }),
    key: { action: "keep" },
  });
  assert.equal(changed.executionRevision, baseline.executionRevision + 2);
});
test("an in-flight send is dropped when its language configuration changes", async (t) => {
  const pending = deferred();
  let calls = 0;
  const f = fixture(t, {
    translate: () => {
      calls += 1;
      return pending.promise;
    },
  });
  const task = f.service.translate(
    1,
    f.request("outgoing", "foreground", { direction: "send" }),
  );
  await f.cache.ready;
  await tick();
  assert.equal(calls, 1);
  const baseline = await f.settings.save({
    baseSettingsRevision: f.settings.settingsRevision,
    settings: f.settings.settings,
    key: { action: "keep" },
  });
  const sent = await f.settings.save({
    baseSettingsRevision: baseline.settingsRevision,
    settings: normalizeSettings({
      ...baseline.settings,
      model: { ...baseline.settings.model, sendLanguage: "日语" },
    }),
    key: { action: "keep" },
  });
  assert.equal(sent.executionRevision, baseline.executionRevision + 1);
  f.service.invalidate(sent.executionRevision);
  const targeted = await f.settings.save({
    baseSettingsRevision: sent.settingsRevision,
    settings: normalizeSettings({
      ...sent.settings,
      model: { ...sent.settings.model, targetLanguage: "日语" },
    }),
    key: { action: "keep" },
  });
  assert.equal(targeted.executionRevision, sent.executionRevision + 1);
  f.service.invalidate(targeted.executionRevision);
  pending.resolve("must-not-land");
  const result = await task;
  assert.equal(result.error.code, "STALE_REVISION");
  const next = await f.service.translate(
    1,
    f.request("outgoing", "foreground", { direction: "send" }),
  );
  assert.equal(next.text, "must-not-land");
  assert.equal(calls, 2);
});
// Windows chmod does not enforce POSIX access bits. The denial tests keep the
// real permission modes where the OS enforces them and inject the same EACCES
// failures the OS raises elsewhere, so denial and rollback stay covered on
// every platform behind identical assertions.
function denyFileReads(t, file) {
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0);
    const restore = () => {
      try {
        fs.chmodSync(file, 0o600);
      } catch (_) {}
    };
    t.after(restore);
    return restore;
  }
  const original = fs.openSync;
  const restore = () => {
    fs.openSync = original;
  };
  fs.openSync = (target, ...args) => {
    if (String(target) === file)
      throw Object.assign(
        new Error(`EACCES: permission denied, open '${file}'`),
        { code: "EACCES" },
      );
    return original.call(fs, target, ...args);
  };
  t.after(restore);
  return restore;
}
function denyDirectoryWrites(t, directory) {
  if (process.platform !== "win32") {
    fs.chmodSync(directory, 0o555);
    const restore = () => {
      try {
        fs.chmodSync(directory, 0o700);
      } catch (_) {}
    };
    t.after(restore);
    return restore;
  }
  const rename = fs.promises.rename,
    writeFile = fs.promises.writeFile;
  const denied = (target) => String(target).startsWith(directory + path.sep);
  const blocked = (operation, target) =>
    Object.assign(
      new Error(`EACCES: permission denied, ${operation} '${target}'`),
      { code: "EACCES" },
    );
  const restore = () => {
    fs.promises.rename = rename;
    fs.promises.writeFile = writeFile;
  };
  fs.promises.rename = (from, to, ...rest) => {
    if (denied(from) || denied(to))
      return Promise.reject(blocked("rename", from));
    return rename.call(fs.promises, from, to, ...rest);
  };
  fs.promises.writeFile = (target, ...rest) => {
    if (denied(target))
      return Promise.reject(blocked("writeFile", target));
    return writeFile.call(fs.promises, target, ...rest);
  };
  t.after(restore);
  return restore;
}
function keyFixture(t, raw) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "babel-keys-")),
    file = path.join(directory, "api-keys.json"),
    writer = new Writer(),
    electron = {
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
      },
    };
  if (raw !== undefined) fs.writeFileSync(file, raw);
  const keys = new KeyStore(directory, electron, writer),
    settings = new SettingsStore(directory, writer, keys);
  t.after(async () => {
    try { fs.chmodSync(directory, 0o700); } catch (_) {}
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    await writer.tail;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, file, writer, keys, settings };
}
test("a damaged key file stays read-only until reset renames it aside", async (t) => {
  const original = "{not json";
  const { file, directory, keys, settings } = keyFixture(t, original);
  fs.writeFileSync(
    path.join(directory, "settings.json"),
    `${JSON.stringify({ enabled: true, model: { provider: "openai", targetLanguage: "简体中文" } }, null, 2)}\n`,
  );
  settings.reload(true);
  assert.equal(keys.fault.code, "MALFORMED");
  assert.equal(keys.fault.reason, "INVALID_JSON");
  assert.equal(keys.recoverable, true);
  assert.equal(keys.status(settings.settings.model).unavailable.recoverable, true);
  assert.equal(settings.snapshot().settings.model.provider, "openai");
  assert.equal(settings.snapshot().status, null);
  assert.equal(keys.prepare(settings.settings.model, { action: "keep" }).changed, false);
  assert.throws(
    () => keys.prepare(settings.settings.model, { action: "replace", value: "new-key" }),
    (error) => error.code === "MALFORMED" && error.reason === "INVALID_JSON",
  );
  assert.throws(
    () => keys.credential({ provider: "openai" }),
    (error) => error.code === "MALFORMED" && error.reason === "INVALID_JSON",
  );
  const custom = keys.credential({ provider: "custom", baseUrl: "https://example.invalid/v1" });
  assert.equal(custom.apiKey, "");
  assert.equal(custom.namespace, "unavailable:INVALID_JSON");
  assert.equal(custom.unavailable, true);
  assert.equal(keys.credential({ provider: "openai" }, " typed-key ").apiKey, "typed-key");
  const loaded = settings.snapshot();
  await settings.save({
    baseSettingsRevision: loaded.settingsRevision,
    settings: { ...loaded.settings, customPrompt: "still saved" },
    key: { action: "keep" },
  });
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(settings.settings.customPrompt, "still saved");
  const reset = await settings.save({
    baseSettingsRevision: settings.settingsRevision,
    settings: settings.snapshot().settings,
    key: { action: "reset" },
  });
  assert.equal(keys.fault, null);
  assert.equal(fs.existsSync(file), false);
  const aside = fs.readdirSync(directory).filter((name) => name.startsWith("api-keys.json.damaged-"));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), original);
  await settings.save({
    baseSettingsRevision: reset.settingsRevision,
    settings: reset.settings,
    key: { action: "replace", value: "fresh-key" },
  });
  assert.equal(keys.credential(reset.settings.model).apiKey, "fresh-key");
});
test("oversized and non-object key files are recoverable, and access denial is not", async (t) => {
  const oversized = keyFixture(t, Buffer.alloc(256 * 1024 + 1, 0x61));
  assert.equal(oversized.keys.fault.reason, "OVERSIZED");
  assert.equal(oversized.keys.recoverable, true);
  const size = fs.statSync(oversized.file).size;
  await oversized.settings.save({
    baseSettingsRevision: oversized.settings.settingsRevision,
    settings: oversized.settings.settings,
    key: { action: "keep" },
  });
  assert.equal(fs.statSync(oversized.file).size, size);
  for (const raw of ["null", "[]", "1", '"x"']) {
    const sample = keyFixture(t, raw);
    assert.equal(sample.keys.fault.reason, "INVALID_JSON");
    assert.equal(sample.keys.recoverable, true);
  }
  const empty = keyFixture(t, "");
  assert.equal(empty.keys.fault.reason, "INVALID_JSON");
  assert.equal(empty.keys.recoverable, true);
  assert.equal(fs.readFileSync(empty.file, "utf8"), "");
  assert.equal(
    empty.keys.prepare(empty.settings.settings.model, { action: "keep" }).changed,
    false,
  );
  assert.equal(fs.readFileSync(empty.file, "utf8"), "");
  await empty.settings.save({
    baseSettingsRevision: empty.settings.settingsRevision,
    settings: empty.settings.settings,
    key: { action: "reset" },
  });
  assert.equal(empty.keys.fault, null);
  assert.equal(fs.existsSync(empty.file), false);
  assert.equal(
    fs.readdirSync(empty.directory).some((name) => name.startsWith("api-keys.json.damaged-")),
    true,
  );
  const missing = keyFixture(t);
  assert.equal(missing.keys.fault, null);
  const denied = keyFixture(t, '{"openai":{"enc":"plain","value":"abc"}}');
  const restoreReads = denyFileReads(t, denied.file);
  const blocked = new KeyStore(denied.directory, denied.keys.electron, denied.writer);
  assert.equal(blocked.fault.code, "STORAGE");
  assert.equal(blocked.fault.reason, "ACCESS_DENIED");
  assert.equal(blocked.recoverable, false);
  assert.equal(blocked.status({ provider: "openai" }).unavailable.recoverable, false);
  await assert.rejects(
    blocked.preserveAndClear(),
    (error) => error.code === "STORAGE" && error.reason === "ACCESS_DENIED",
  );
  restoreReads();
  assert.equal(fs.readFileSync(denied.file, "utf8"), '{"openai":{"enc":"plain","value":"abc"}}');
});
test("a failed key reset leaves the damaged bytes and does not write settings", async (t) => {
  const original = "[1,2,3]";
  const { directory, file, keys, settings } = keyFixture(t, original);
  const settingsFile = path.join(directory, "settings.json");
  const beforeSettings = `${JSON.stringify({ enabled: false }, null, 2)}\n`;
  fs.writeFileSync(settingsFile, beforeSettings);
  settings.reload(true);
  const revision = settings.settingsRevision;
  const restoreWrites = denyDirectoryWrites(t, directory);
  await assert.rejects(
    settings.save({
      baseSettingsRevision: revision,
      settings: { ...settings.settings, customPrompt: "must not land" },
      key: { action: "reset" },
    }),
    (error) => error.code === "STORAGE" && error.reason === "ACCESS_DENIED",
  );
  restoreWrites();
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(fs.readFileSync(settingsFile, "utf8"), beforeSettings);
  assert.equal(keys.fault.reason, "INVALID_JSON");
  assert.equal(keys.recoverable, true);
  assert.equal(settings.settingsRevision, revision);
});
test("a damaged-key reset restores the fault when the later settings write fails", async (t) => {
  const original = "{not json";
  const { directory, file, writer, keys, settings } = keyFixture(t, original);
  const settingsFile = path.join(directory, "settings.json");
  const beforeSettings = `${JSON.stringify({ enabled: true }, null, 2)}\n`;
  fs.writeFileSync(settingsFile, beforeSettings);
  settings.reload(true);
  const revision = settings.settingsRevision;
  const atomic = writer.atomic.bind(writer);
  writer.atomic = async (target, data, guard) => {
    if (target === settingsFile) throw Object.assign(new Error("synthetic write failure"), { code: "EACCES" });
    return atomic(target, data, guard);
  };
  await assert.rejects(
    settings.save({
      baseSettingsRevision: revision,
      settings: settings.settings,
      key: { action: "reset" },
    }),
    (error) => error.code === "STORAGE" && error.reason === "WRITE_FAILED",
  );
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(keys.fault.reason, "INVALID_JSON");
  assert.equal(keys.recoverable, true);
  assert.equal(fs.readdirSync(directory).some((name) => name.startsWith("api-keys.json.damaged-")), false);
  assert.equal(fs.readFileSync(settingsFile, "utf8"), beforeSettings);
  assert.equal(settings.settingsRevision, revision);
  writer.atomic = atomic;
  const reset = await settings.save({
    baseSettingsRevision: settings.settingsRevision,
    settings: settings.settings,
    key: { action: "reset" },
  });
  assert.equal(keys.fault, null);
  assert.equal(fs.existsSync(file), false);
  const aside = fs.readdirSync(directory).filter((name) => name.startsWith("api-keys.json.damaged-"));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), original);
  assert.equal(reset.settingsRevision, revision + 1);
});
test("a damaged-key reset does not replace a key file created during a failed save", async (t) => {
  const original = "{not json";
  const { directory, file, writer, keys, settings } = keyFixture(t, original);
  const settingsFile = path.join(directory, "settings.json");
  const beforeSettings = `${JSON.stringify({ enabled: false }, null, 2)}\n`;
  fs.writeFileSync(settingsFile, beforeSettings);
  settings.reload(true);
  const revision = settings.settingsRevision;
  const separate = "{\"separate\":true}\n";
  const atomic = writer.atomic.bind(writer);
  writer.atomic = async (target, data, guard) => {
    if (target === settingsFile) {
      fs.writeFileSync(file, separate);
      throw Object.assign(new Error("synthetic write failure"), { code: "EACCES" });
    }
    return atomic(target, data, guard);
  };
  await assert.rejects(
    settings.save({
      baseSettingsRevision: revision,
      settings: { ...settings.settings, customPrompt: "must not land" },
      key: { action: "reset" },
    }),
    (error) => error.code === "PARTIAL_SAVE" && error.reason === "KEY_ROLLBACK_FAILED",
  );
  assert.equal(fs.readFileSync(file, "utf8"), separate);
  const aside = fs.readdirSync(directory).filter((name) => name.startsWith("api-keys.json.damaged-"));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), original);
  assert.equal(fs.readFileSync(settingsFile, "utf8"), beforeSettings);
  assert.notEqual(settings.settings.customPrompt, "must not land");
  assert.equal(keys.fault, null);
  await assert.rejects(
    settings.save({
      baseSettingsRevision: settings.settingsRevision,
      settings: settings.settings,
      key: { action: "reset" },
    }),
    (error) => error.code === "STORAGE" && error.reason === "ACCESS_DENIED",
  );
  assert.equal(fs.readFileSync(file, "utf8"), separate);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), original);
});
test("a damaged-key restore keeps a concurrent file and the backup when publication fails", async (t) => {
  const original = "{not json";
  const separate = "{\"separate\":true}\n";
  const link = fs.promises.link;
  const { directory, file, keys } = keyFixture(t, original);
  const fault = keys.fault;
  t.after(() => {
    fs.promises.link = link;
  });
  const raced = await keys.preserveAndClear();
  let publications = 0;
  fs.promises.link = async function (existing, target) {
    if (target === file) {
      publications += 1;
      const staged = `${file}.racer`;
      fs.writeFileSync(staged, separate);
      fs.renameSync(staged, target);
      throw Object.assign(new Error("file exists"), { code: "EEXIST" });
    }
    return link.call(this, existing, target);
  };
  assert.equal(await keys.restoreDamaged(raced, fault, true), false);
  assert.equal(publications, 1);
  assert.equal(fs.readFileSync(file, "utf8"), separate);
  assert.equal(fs.readFileSync(raced, "utf8"), original);
  assert.equal(keys.fault, null);
  assert.equal(fs.readdirSync(directory).includes(path.basename(raced)), true);

  fs.promises.link = link;
  fs.rmSync(file);
  const aside = `${file}.damaged-held`;
  fs.writeFileSync(aside, original);
  fs.writeFileSync(file, separate);
  fs.promises.link = async function (existing, target) {
    if (target === file) throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
    return link.call(this, existing, target);
  };
  assert.equal(await keys.restoreDamaged(aside, fault, true), false);
  assert.equal(fs.readFileSync(file, "utf8"), separate);
  assert.equal(fs.readFileSync(aside, "utf8"), original);
  assert.equal(keys.fault, null);
  fs.promises.link = link;
});
test("quota pauses background admission until the execution revision changes", async (t) => {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 402,
      headers: { get: () => null },
      text: async () => "<html>provider-secret-body",
    };
  };
  t.after(() => {
    global.fetch = previous;
  });
  const f = fixture(t, createProvider());
  f.settings.settings.enabled = true;
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => f.service.translate(1, f.request(`q${i}`, "background"))),
  );
  assert.equal(calls, 2);
  assert.ok(results.some((result) => result.error?.code === "RATE_LIMIT" && result.error.reason === "QUOTA"));
  assert.ok(results.some((result) => result.error?.code === "PAUSED"));
  assert.equal(JSON.stringify(results).includes("provider-secret-body"), false);
  assert.equal(f.service.status().paused.until, null);
  assert.equal((await f.service.translate(1, f.request("later", "background"))).error.code, "PAUSED");
  assert.equal(calls, 2);
  const foreground = await f.service.translate(1, f.request("manual"));
  assert.equal(foreground.error.code, "RATE_LIMIT");
  assert.equal(foreground.error.reason, "QUOTA");
  assert.equal(foreground.error.retryAfter, undefined);
  assert.equal(calls, 3);
  f.settings.executionRevision++;
  f.service.invalidate(f.settings.executionRevision);
  await f.service.translate(1, f.request("retry", "background"));
  assert.equal(calls, 4);
});
test("temporary rate limits use a timer and provider outages do not pause", async (t) => {
  const previous = global.fetch;
  let status = 429;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: false,
      status,
      headers: { get: (name) => (name === "retry-after" ? "30" : null) },
      text: async () => JSON.stringify({ error: { message: "slow down secret" } }),
    };
  };
  t.after(() => {
    global.fetch = previous;
  });
  const f = fixture(t, createProvider());
  f.settings.settings.enabled = true;
  const first = await f.service.translate(1, f.request("a", "background"));
  assert.equal(first.error.code, "RATE_LIMIT");
  assert.equal(first.error.reason, "TEMPORARY");
  assert.equal(first.error.retryAfter, 30);
  assert.doesNotMatch(first.error.message, /secret/);
  assert.ok(f.service.pause.until < Infinity);
  assert.equal((await f.service.translate(1, f.request("b", "background"))).error.code, "PAUSED");
  assert.equal(calls, 1);
  f.settings.executionRevision++;
  f.service.invalidate(f.settings.executionRevision);
  status = 503;
  const down = await f.service.translate(1, f.request("c", "background"));
  assert.equal(down.error.code, "NETWORK");
  assert.equal(down.error.reason, "PROVIDER_TEMPORARY");
  assert.equal(f.service.status().paused, null);
  const again = await f.service.translate(1, f.request("d", "background"));
  assert.equal(again.error.code, "NETWORK");
  assert.equal(again.error.reason, "PROVIDER_TEMPORARY");
  assert.equal(calls, 3);
});
test("a successful foreground request clears the same quota pause", async (t) => {
  const previous = global.fetch;
  let mode = "quota";
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (mode === "quota")
      return {
        ok: false,
        status: 402,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: "billing secret" } }),
      };
    if (mode === "limited")
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name === "retry-after" ? "60" : null) },
        text: async () =>
          JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
              message: "Per-minute quota exceeded. Try again in 60 seconds.",
            },
          }),
      };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    };
  };
  t.after(() => {
    global.fetch = previous;
  });
  const f = fixture(t, createProvider());
  f.settings.settings.enabled = true;
  mode = "ok";
  const warmed = await f.service.translate(1, f.request("cached-read"));
  assert.equal(warmed.text, "ok");
  mode = "quota";
  const blocked = await f.service.translate(1, f.request("background-one", "background"));
  assert.equal(blocked.error.code, "RATE_LIMIT");
  assert.equal(blocked.error.reason, "QUOTA");
  assert.doesNotMatch(blocked.error.message, /billing secret/);
  assert.equal((await f.service.translate(1, f.request("background-two", "background"))).error.code, "PAUSED");
  const hit = await f.service.translate(1, f.request("cached-read"));
  assert.equal(hit.cacheHit, true);
  assert.equal((await f.service.translate(1, f.request("background-held", "background"))).error.code, "PAUSED");
  assert.equal(calls, 2);
  mode = "ok";
  const manual = await f.service.translate(1, f.request("manual"));
  assert.equal(manual.ok, true);
  assert.equal(manual.text, "ok");
  const resumed = await f.service.translate(1, f.request("background-three", "background"));
  assert.equal(resumed.ok, true);
  assert.equal(calls, 4);
  mode = "quota";
  await f.service.translate(1, f.request("background-four", "background"));
  const slow = deferred();
  const oldProvider = f.service.provider;
  f.service.provider = {
    translate: (request) =>
      request.text === "stale-foreground" ? slow.promise : oldProvider.translate(request),
  };
  const stale = f.service.translate(1, f.request("stale-foreground"));
  await tick();
  f.settings.executionRevision += 1;
  f.service.invalidate(f.settings.executionRevision);
  const newer = await f.service.translate(1, f.request("newer-quota", "background"));
  assert.equal(newer.error.reason, "QUOTA");
  const pauseCalls = calls;
  slow.resolve("late");
  assert.equal((await stale).error.code, "STALE_REVISION");
  assert.equal(f.service.status().paused.code, "RATE_LIMIT");
  assert.equal((await f.service.translate(1, f.request("still-paused", "background"))).error.code, "PAUSED");
  assert.equal(calls, pauseCalls);
  mode = "limited";
  f.settings.executionRevision += 1;
  f.service.invalidate(f.settings.executionRevision);
  const temporary = await f.service.translate(1, f.request("minute", "background"));
  assert.equal(temporary.error.code, "RATE_LIMIT");
  assert.equal(temporary.error.reason, "TEMPORARY");
  assert.equal(temporary.error.retryAfter, 60);
  assert.doesNotMatch(temporary.error.message, /Per-minute|quota exceeded/i);
});
test("non-JSON provider errors are classified by status and do not echo the body", async () => {
  const { classifyProviderStatus } = require("../src/mod/core/provider-fetch");
  assert.deepEqual(classifyProviderStatus(402, null), { code: "RATE_LIMIT", reason: "QUOTA" });
  assert.deepEqual(classifyProviderStatus(408, null), { code: "TIMEOUT" });
  assert.deepEqual(classifyProviderStatus(418, null), { code: "NETWORK" });
  const padding = "x".repeat(200);
  assert.deepEqual(
    classifyProviderStatus(429, { error: { message: `${padding}quota` } }),
    { code: "RATE_LIMIT", reason: "TEMPORARY" },
  );
  assert.deepEqual(
    classifyProviderStatus(429, { error: { code: "insufficient_quota", message: padding } }),
    { code: "RATE_LIMIT", reason: "QUOTA" },
  );
  assert.deepEqual(
    classifyProviderStatus(429, {
      error: {
        code: "rate_limit_exceeded",
        message: "Per-minute quota exceeded. Try again in 60 seconds.",
      },
    }),
    { code: "RATE_LIMIT", reason: "TEMPORARY" },
  );
  const previous = global.fetch;
  const settings = normalizeSettings({
    enabled: true,
    model: { provider: "custom", baseUrl: "https://first.invalid/v1" },
  });
  try {
    global.fetch = async () => ({
      ok: false,
      status: 402,
      headers: { get: () => null },
      text: async () => "<html>secret-quota",
    });
    await assert.rejects(
      createProvider().translate({ settings, apiKey: "", text: "hi", direction: "read" }),
      (error) => {
        assert.equal(error.code, "RATE_LIMIT");
        assert.equal(error.reason, "QUOTA");
        assert.equal(error.retryAfter, undefined);
        assert.doesNotMatch(String(error.message), /secret|html|quota/i);
        return true;
      },
    );
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "not-json",
    });
    await assert.rejects(
      createProvider().translate({ settings, apiKey: "", text: "hi", direction: "read" }),
      { code: "CONFIG" },
    );
  } finally {
    global.fetch = previous;
  }
});
test("an obsolete background failure does not replace the current quota pause", async () => {
  const { failure } = require("../src/mod/core/errors");
  const settings = normalizeSettings({});
  let revision = 1;
  let calls = 0;
  let lateReject;
  const service = new TranslationService({
    snapshot: () => ({ settings, executionRevision: revision }),
    credential: () => ({ apiKey: "synthetic", namespace: "synthetic-" + revision }),
    cache: { generation: 0, ready: Promise.resolve(), get() {}, put() {} },
    provider: {
      translate() {
        calls += 1;
        return calls === 1
          ? new Promise((resolve, reject) => {
              lateReject = reject;
            })
          : Promise.reject(failure("RATE_LIMIT", null, { reason: "QUOTA" }));
      },
    },
  });
  const request = (n) =>
    service.translate("fixture", {
      requestId: "stale:" + n,
      expectedExecutionRevision: revision,
      direction: "read",
      priority: "background",
      text: "Synthetic " + n,
    });
  const old = request(1);
  await tick();
  revision = 2;
  service.invalidate(2);
  const first = await old;
  assert.equal(first.error.code, "STALE_REVISION");
  await request(2);
  await tick();
  const before = { ...service.pause };
  lateReject(failure("AUTH"));
  await tick();
  assert.deepEqual(service.pause, before);
  assert.equal(service.pause.revision, 2);
  assert.equal(service.pause.reason, "QUOTA");
  assert.equal(service.status().paused.code, "RATE_LIMIT");
  assert.equal(service.background.length, 0);
});
test("queued requests keep their captured endpoint, language and credential", async (t) => {
  const active = [];
  const f = fixture(t, {
    translate: (request) => {
      const pending = deferred();
      active.push({ request, ...pending });
      return pending.promise;
    },
  });
  const tasks = Array.from({ length: 5 }, (_, i) =>
    f.service.translate(1, f.request(`source ${i}`)),
  );
  await f.cache.ready;
  await tick();
  assert.equal(active.length, 4);
  f.settings.settings.model.baseUrl = "https://later.invalid/v2";
  f.settings.settings.model.targetLanguage = "日语";
  active[0].resolve("first");
  await tasks[0];
  await tick();
  assert.equal(active.length, 5);
  assert.equal(
    active[4].request.settings.model.baseUrl,
    "https://first.invalid/v1",
  );
  assert.notEqual(active[4].request.settings.model.targetLanguage, "日语");
  for (const operation of active.slice(1)) operation.resolve("result");
  await Promise.all(tasks);
});
test("late asynchronous disk load cannot repopulate a cleared cache", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "babel-cache-load-")),
    file = path.join(directory, "cache.json"),
    writer = new Writer(),
    load = deferred();
  const contents = Buffer.from(
      JSON.stringify({
        version: 2,
        entries: [["d".repeat(64), "old disk entry"]],
      }),
    ),
    original = fs.promises.open;
  fs.promises.open = async (...args) =>
    args[0] === file ? load.promise : original(...args);
  const cache = new CacheStore(directory, writer);
  fs.promises.open = original;
  t.after(async () => {
    clearTimeout(cache.timer);
    await writer.tail;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await cache.clear();
  load.resolve({
    stat: async () => ({ size: contents.length }),
    read: async (buffer) => {
      contents.copy(buffer);
      return { bytesRead: contents.length };
    },
    close: async () => {},
  });
  await cache.ready;
  assert.equal(cache.status().count, 0);
  assert.equal(fs.existsSync(file), false);
});
test("invalid saved endpoint still exposes a readable settings snapshot without a credential", async (t) => {
  const f = fixture(t);
  f.settings.settings.model.baseUrl = "not a URL";
  assert.equal(
    f.keys.displayContext(f.settings.settings.model),
    "invalid-endpoint",
  );
  assert.equal(
    (await f.service.translate(1, f.request())).error.code,
    "CONFIG",
  );
});

test("external file changes broadcast once and preserve the last good snapshot on corruption", async (t) => {
  const f = fixture(t),
    changed = deferred();
  let calls = 0;
  f.settings.changed = (snapshot) => {
    calls++;
    changed.resolve(snapshot);
  };
  f.settings.startWatching();
  t.after(() => f.settings.stopWatching());
  fs.writeFileSync(f.settings.file, '{"enabled":false}');
  const deadline = setTimeout(
    () => changed.reject(new Error("File watch did not report a change")),
    5000,
  );
  try {
    const snapshot = await changed.promise;
    assert.equal(snapshot.settings.enabled, false);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(deadline);
  }
  fs.writeFileSync(f.settings.file, "{broken");
  const snapshot = f.settings.snapshot();
  assert.equal(snapshot.settings.enabled, false);
  assert.equal(snapshot.status.code, "MALFORMED");
});

test("legacy plaintext migration makes an encrypted, backwards-compatible recovery copy", async (t) => {
  const f = fixture(t),
    legacy = {
      custom: {
        enc: "plain",
        value: Buffer.from("synthetic-key").toString("base64"),
      },
    };
  fs.writeFileSync(f.keys.file, JSON.stringify(legacy));
  fs.writeFileSync(f.settings.file, JSON.stringify(f.settings.settings));
  f.keys.store = legacy;
  await f.keys.migrate(f.settings.settings, true);
  const recovery = JSON.parse(fs.readFileSync(`${f.keys.file}.pre-0.1.6`));
  assert.equal(recovery.custom.enc, "safeStorage");
  assert.ok(recovery.custom.credentialId);
  assert.equal(recovery.custom.value.includes("synthetic-key"), false);
  assert.equal(f.keys.decrypt(recovery.custom), "synthetic-key");
  assert.equal(f.keys.store.custom, undefined);
  assert.ok(
    f.keys
      .credential(f.settings.settings.model)
      .namespace.startsWith("credential:"),
  );
});
test("unavailable encryption retains the original legacy file and creates no plaintext backup", async (t) => {
  const f = fixture(t),
    legacy = {
      custom: {
        enc: "plain",
        value: Buffer.from("synthetic-key").toString("base64"),
      },
    },
    original = JSON.stringify(legacy);
  fs.writeFileSync(f.keys.file, original);
  f.keys.store = legacy;
  f.keys.electron.safeStorage.isEncryptionAvailable = () => false;
  await f.keys.migrate(f.settings.settings, true);
  assert.equal(fs.readFileSync(f.keys.file, "utf8"), original);
  assert.equal(fs.existsSync(`${f.keys.file}.pre-0.1.6`), false);
  assert.equal(f.keys.credential(f.settings.settings.model).apiKey, "");
  assert.throws(() =>
    f.keys.prepare(f.settings.settings.model, { action: "link" }),
  );
});

test("forced save detects an external content change even when metadata appears unchanged", async (t) => {
  const f = fixture(t);
  await f.settings.save({
    baseSettingsRevision: f.settings.settingsRevision,
    settings: f.settings.settings,
    key: { action: "keep" },
  });
  const before = f.settings.snapshot();
  const changed = { ...before.settings, customPrompt: "external edit" };
  fs.writeFileSync(f.settings.file, `${JSON.stringify(changed, null, 2)}\n`);
  f.settings.fileIdentity = require("../src/mod/core/storage").identity(
    f.settings.file,
  ); // Simulate coarse or preserved filesystem metadata.
  await assert.rejects(
    f.settings.save({
      baseSettingsRevision: before.settingsRevision,
      settings: before.settings,
      key: { action: "keep" },
    }),
    { code: "CONFLICT" },
  );
  assert.equal(f.settings.settings.customPrompt, "external edit");
});

test("UI-only saves advance CAS revision while preserving execution, cache and active work",async t=>{
 const pending=deferred(),f=fixture(t,{translate:()=>pending.promise});
 fs.writeFileSync(f.settings.file,JSON.stringify(f.settings.settings));f.settings.reload(true);
 const base=f.settings.snapshot(),prompt=base.settings.customPrompt;
 const task=f.service.translate(1,f.request("in-flight content"));await f.cache.ready;await tick();
 f.cache.put("a".repeat(64),"cached content",f.cache.generation);const generation=f.cache.generation;
 for(const fontSize of [10,11,12,13]){
  const before=f.settings.snapshot();const after=await f.settings.save({baseSettingsRevision:before.settingsRevision,settings:{...before.settings,style:{...before.settings.style,fontSize}},key:{action:"keep"}});
  assert.equal(after.settingsRevision,before.settingsRevision+1);assert.equal(after.executionRevision,base.executionRevision);assert.equal(after.settings.customPrompt,prompt);assert.equal(f.cache.generation,generation);assert.equal(f.cache.get("a".repeat(64)),"cached content");assert.equal(f.service.active,1);
  await assert.rejects(f.settings.save({baseSettingsRevision:before.settingsRevision,settings:after.settings,key:{action:"keep"}}),error=>error.code==="CONFLICT");
 }
 pending.resolve("translated content");assert.equal((await task).text,"translated content");
});

test("a legacy uiLanguage never reaches stored settings on load or save", async (t) => {
 const f = fixture(t);
 fs.writeFileSync(f.settings.file, JSON.stringify({ ...f.settings.settings, uiLanguage: "ja" }, null, 2));
 f.settings.reload(true);
 assert.equal(Object.hasOwn(f.settings.settings, "uiLanguage"), false);
 const before = f.settings.snapshot();
 const after = await f.settings.save({ baseSettingsRevision: before.settingsRevision, settings: { ...before.settings, uiLanguage: "zh-Hant" }, key: { action: "keep" } });
 assert.equal(Object.hasOwn(after.settings, "uiLanguage"), false);
 assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(f.settings.file, "utf8")), "uiLanguage"), false);
});

const GOLDEN_TEXT = "Hello, world! 你好 🌐";
const GOLDEN_MODEL = { modelId: "test-model", targetLanguage: "简体中文", sendLanguage: "英语" };
test("legacy requests and cache-key hashes match the pre-implementation golden", async (t) => {
  // Recorded from the pre-implementation source: for every built-in provider and
  // any Custom base without a known endpoint suffix the request and the cache
  // key stay byte-identical.
  const golden = [
    [{ provider: "openai", ...GOLDEN_MODEL }, "https://api.openai.com/v1/chat/completions", "1061594fa6b7f3516b400d35b677452f1c9fe17db4159f6ff5a671ace6691deb"],
    [{ provider: "google", ...GOLDEN_MODEL }, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "8981daeed22fed7feddacbdafb233b9680795002e6fb967210adc27e5529ad29"],
    [{ provider: "anthropic", ...GOLDEN_MODEL }, "https://api.anthropic.com/v1/messages", "84de1aaff704672986190d70d21ba013a483f1a64534105badbb44e2391fe709"],
    [{ provider: "deepseek", ...GOLDEN_MODEL }, "https://api.deepseek.com/chat/completions", "b5e3d19d81251037a50758b3fc334d861d39232d741cc6960566fa246669cc27"],
    [{ provider: "zhipu", ...GOLDEN_MODEL }, "https://api.z.ai/api/paas/v4/chat/completions", "e72f2258e355721e09db64ab742437d1cdea8901cd8653b1605a782003515cb4"],
    [{ provider: "kimi", ...GOLDEN_MODEL }, "https://api.moonshot.ai/v1/chat/completions", "c429a70fffc41cf364008c615cf9f31b18179cd13789d903e930bcd9e5f2b47d"],
    [{ provider: "openrouter", ...GOLDEN_MODEL }, "https://openrouter.ai/api/v1/chat/completions", "bac2ca2359729cf6b254e8fd3dd025d21e808cdf28a05759d2d4eb96b155927d"],
    [{ provider: "ollama", ...GOLDEN_MODEL }, "http://localhost:11434/v1/chat/completions", "9c00ca310fc76698c8a10bd8c11f9e8acaf4b069addf9d527cfc16c90adda83b"],
    [{ provider: "lmstudio", ...GOLDEN_MODEL }, "http://localhost:1234/v1/chat/completions", "57427544080bc935965d678e732154221b36db64501d586f546fd633be37439f"],
    [{ provider: "custom", baseUrl: "https://api.example.com/v1", ...GOLDEN_MODEL }, "https://api.example.com/v1/chat/completions", "308bae16fda33fb31dc20c627e170f356d15464068d6af7dff3292a92c1a1345"],
    [{ provider: "custom", baseUrl: "https://api.example.com/openai/deep/v3", ...GOLDEN_MODEL }, "https://api.example.com/openai/deep/v3/chat/completions", "217764d5199727043cebfcb4cceef9830541388be5953d379ec1c9d30467e3da"],
  ];
  for (const [model, url, hash] of golden) {
    // The legacy settings shape carries no protocol: this is the migration path.
    assert.equal(Object.hasOwn(model, "protocol"), false);
    const settings = normalizeSettings({ model });
    const f = fixture(t, { translate: async () => "golden" });
    f.settings.settings = settings;
    const { buildProviderRequest } = require("../src/mod/core/provider-fetch");
    const { buildTranslationMessages, resolveModelConfig } = require("../src/shared/translate");
    const effective = buildProviderRequest(
      resolveModelConfig(settings.model),
      buildTranslationMessages({ text: GOLDEN_TEXT, direction: "read", settings }),
      "",
    );
    assert.equal(effective.url, url);
    const result = await f.service.translate(1, f.request(GOLDEN_TEXT));
    assert.equal(result.text, "golden");
    assert.deepEqual([...f.cache.entries.keys()], [hash]);
  }
});

test("the wire request carries only the required fields for each API format", async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const forbidden = ["store", "previous_response_id", "conversation", "background", "stream", "tools", "reasoning", "reasoning_effort", "temperature", "top_p", "max_output_tokens"];
  const captured = [];
  const replies = {
    openai: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
    responses: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] },
    anthropic: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" },
  };
  const settingsFor = (protocol) => normalizeSettings({
    model: { provider: "custom", baseUrl: "https://gw.example/v1", modelId: "m1", protocol, targetLanguage: "简体中文" },
  });
  for (const protocol of ["openai", "responses", "anthropic"]) {
    captured.length = 0;
    global.fetch = async (url, options) => {
      captured.push({ url, method: options.method, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(replies[protocol]) };
    };
    const result = await createProvider().translate({
      settings: settingsFor(protocol),
      apiKey: "sk-test",
      direction: "read",
      text: "Hello",
    });
    assert.equal(result, "ok");
    assert.equal(captured.length, 1);
    const { url, method, headers, body } = captured[0];
    for (const key of forbidden) assert.equal(Object.hasOwn(body, key), false, `${protocol} ${key}`);
    if (protocol === "openai") {
      assert.equal(url, "https://gw.example/v1/chat/completions");
      assert.deepEqual(headers, { "content-type": "application/json", authorization: "Bearer sk-test" });
      assert.deepEqual(Object.keys(body).sort(), ["messages", "model"]);
      assert.equal(body.model, "m1");
      assert.deepEqual(body.messages[1], { role: "user", content: "Hello" });
      assert.equal(body.messages[0].role, "system");
      assert.match(body.messages[0].content, /简体中文/);
    } else if (protocol === "responses") {
      assert.equal(url, "https://gw.example/v1/responses");
      assert.deepEqual(headers, { "content-type": "application/json", authorization: "Bearer sk-test" });
      assert.deepEqual(Object.keys(body).sort(), ["input", "instructions", "model"]);
      assert.equal(body.model, "m1");
      assert.equal(body.input, "Hello");
      assert.match(body.instructions, /简体中文/);
    } else {
      assert.equal(url, "https://gw.example/v1/messages");
      assert.deepEqual(headers, { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": "sk-test" });
      assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "system"]);
      assert.equal(body.model, "m1");
      assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
      assert.match(body.system, /简体中文/);
      assert.equal(Number.isInteger(body.max_tokens), true);
      assert.ok(body.max_tokens >= 1024 && body.max_tokens <= 8192);
    }
    assert.equal(method, "POST");
  }
  // The selected format always wins over a full-endpoint base URL.
  captured.length = 0;
  global.fetch = async (url, options) => {
    captured.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(replies.responses) };
  };
  await createProvider().translate({
    settings: normalizeSettings({ model: { provider: "custom", baseUrl: "https://gw.example/v1/chat/completions", modelId: "m1", protocol: "responses" } }),
    apiKey: "sk-test",
    direction: "read",
    text: "Hello",
  });
  assert.equal(captured[0].url, "https://gw.example/v1/responses");
});

test("model list requests authenticate with the headers the selected format uses", async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  for (const [protocol, expected] of [
    ["openai", { authorization: "Bearer sk-test" }],
    ["responses", { authorization: "Bearer sk-test" }],
    ["anthropic", { "anthropic-version": "2023-06-01", "x-api-key": "sk-test" }],
  ]) {
    let seen;
    global.fetch = async (url, options) => {
      seen = { url, headers: options.headers };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: [{ id: "m1" }] }) };
    };
    const models = await createProvider().models({
      settings: normalizeSettings({ model: { provider: "custom", baseUrl: "https://gw.example/v1/messages", modelId: "m1", protocol } }),
      apiKey: "sk-test",
    });
    assert.deepEqual(models, [{ value: "m1", label: "m1" }]);
    assert.equal(seen.url, "https://gw.example/v1/models");
    assert.deepEqual(seen.headers, expected);
  }
});

test("HTTP rejection classification uses exact machine codes and narrow phrases", () => {
  const { classifyProviderStatus } = require("../src/mod/core/provider-fetch");
  const ambiguous = [
    null,
    {},
    { error: { code: "invalid_request_error", message: "Unsupported value: 'temperature' is not supported with this model." } },
    { error: { code: "invalid_request_error", message: "Invalid parameter: 'reasoning_effort'." } },
    { error: { code: "ModelProtocolUnsupportedError", message: "similar but not exact" } },
    { error: { code: "model_not_found_v2", message: "unknown" } },
    { error: { message: "This model is only supported in the v2/responses API." } },
  ];
  for (const status of [400, 404, 405, 422]) {
    for (const body of ambiguous)
      assert.deepEqual(classifyProviderStatus(status, body), { code: "CONFIG", reason: "REQUEST_REJECTED" });
    assert.deepEqual(
      classifyProviderStatus(status, { error: { type: "ModelProtocolUnsupported", message: "routing" } }),
      { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" },
    );
    assert.deepEqual(
      classifyProviderStatus(status, { error: { message: "This model is only supported in the /v1/chat/completions API." } }),
      { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" },
    );
    assert.deepEqual(
      classifyProviderStatus(status, { error: { message: "not a chat model" } }),
      { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" },
    );
    assert.deepEqual(
      classifyProviderStatus(status, { error: { message: "This model does not support this protocol" } }),
      { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" },
    );
    assert.deepEqual(
      classifyProviderStatus(status, { error: { code: "MODEL_NOT_FOUND" } }),
      { code: "CONFIG", reason: "MODEL_UNAVAILABLE" },
    );
    assert.deepEqual(
      classifyProviderStatus(status, { type: "model_not_found", message: "gone" }),
      { code: "CONFIG", reason: "MODEL_UNAVAILABLE" },
    );
  }
  // Codes decide before phrases; other statuses keep their existing classes.
  assert.deepEqual(
    classifyProviderStatus(400, { error: { code: "model_not_found", message: "only supported in the /v1/responses API" } }),
    { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" },
  );
  assert.deepEqual(classifyProviderStatus(418, { error: { code: "ModelProtocolUnsupported" } }), { code: "NETWORK" });
});

test("partial, refused and non-final replies are never accepted or cached", async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const replies = [
    [{ choices: [{ message: { content: "declined text", refusal: "declined" }, finish_reason: "stop" }] }, "REFUSED"],
    [{ choices: [{ message: { content: "cut off" }, finish_reason: "length" }] }, "INCOMPLETE"],
    [{ choices: [{ message: { content: "tool work", tool_calls: [{ id: "1" }] }, finish_reason: "tool_calls" }] }, "INCOMPLETE"],
    [{ status: "incomplete", output: [] }, "UNEXPECTED_RESPONSE"],
    [{ choices: [{ message: { content: "  translated  " }, finish_reason: "stop" }] }, null],
  ];
  let calls = 0, current = null;
  global.fetch = async () => {
    const body = current;
    calls++;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  const f = fixture(t, createProvider());
  f.settings.settings = normalizeSettings({ model: { provider: "custom", baseUrl: "https://gw.example/v1" } });
  for (const [reply, reason] of replies) {
    current = reply;
    const result = await f.service.translate(1, f.request("same source"));
    if (reason) {
      assert.equal(result.error.reason, reason);
      assert.equal(f.cache.entries.size, 0);
      const retried = await f.service.translate(1, f.request("same source"));
      assert.equal(retried.error.reason, reason);
      assert.equal(f.cache.entries.size, 0);
    } else {
      assert.equal(result.text, "translated");
      assert.equal(f.cache.entries.size, 1);
      assert.equal((await f.service.translate(1, f.request("same source"))).cacheHit, true);
    }
  }
  // Every failure re-requested once; only the successful reply went on the wire.
  assert.equal(calls, 9);
});

test("a wrong-format JSON reply pauses background work; network outcomes never pause", async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  let reply;
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(reply) });
  const configured = () => {
    const f = fixture(t, createProvider());
    f.settings.settings = normalizeSettings({ model: { provider: "custom", baseUrl: "https://gw.example/v1" } });
    return f;
  };
  {
    // A JSON reply in the wrong format is a deterministic mismatch: it pauses
    // background work but never stops foreground retries.
    reply = { unexpected: true };
    const f = configured();
    assert.equal((await f.service.translate(1, f.request("one", "background"))).error.reason, "UNEXPECTED_RESPONSE");
    assert.equal((await f.service.translate(1, f.request("two", "background"))).error.code, "PAUSED");
    assert.equal((await f.service.translate(1, f.request("three", "foreground"))).error.reason, "UNEXPECTED_RESPONSE");
  }
  {
    reply = { choices: [{ message: { content: "no", refusal: "declined" }, finish_reason: "stop" }] };
    const f = configured();
    assert.equal((await f.service.translate(1, f.request("one", "background"))).error.reason, "REFUSED");
    assert.equal((await f.service.translate(1, f.request("two", "background"))).error.reason, "REFUSED");
    assert.equal(f.service.status().paused, null);
    reply = { choices: [{ message: { content: "partial" }, finish_reason: "length" }] };
    assert.equal((await f.service.translate(1, f.request("three", "background"))).error.reason, "INCOMPLETE");
    assert.equal(f.service.status().paused, null);
    reply = { choices: [{ message: { content: "x" }, finish_reason: "stop" }] };
    assert.equal((await f.service.translate(1, f.request("four", "background"))).text, "x");
    assert.equal(f.service.status().paused, null);
  }
});

test("the key slot and credential identity ignore the API format", (t) => {
  const f = fixture(t);
  const model = { provider: "custom", baseUrl: "https://gw.example/v1/messages" };
  f.keys.store = f.keys.prepare(model, { action: "replace", value: "synthetic-key" }).store;
  const slot = f.keys.slot(model);
  const namespace = f.keys.credential(model).namespace;
  assert.equal(slot, "custom:https://gw.example/v1/messages");
  assert.match(namespace, /^credential:/);
  for (const protocol of ["openai", "responses", "anthropic"]) {
    const next = { ...model, protocol };
    assert.equal(f.keys.slot(next), slot);
    assert.equal(f.keys.credential(next).namespace, namespace);
    assert.equal(f.keys.credential(next).apiKey, "synthetic-key");
    assert.equal(normalizeSettings({ model: next }).model.baseUrl, model.baseUrl);
    assert.equal(f.keys.slot(normalizeSettings({ model: next }).model), slot);
  }
});
