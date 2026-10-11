"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { getApiKeyStatus, getRuntime, getSettings, listModels, patchBrowserWindowOptions, saveConfig, setApiKey, setElectronForTests, testConnection } = require("../src/mod/main");
const { normalizeSettings } = require("../src/shared/settings");

test("patchBrowserWindowOptions replaces Discord preload and preserves the original path", () => {
  const options = patchBrowserWindowOptions({
    title: "Discord",
    webPreferences: {
      preload: "/discord/mainScreenPreload.js",
      additionalArguments: ["--existing"]
    }
  }, "/mod/preload.js");

  assert.equal(options.webPreferences.preload, "/mod/preload.js");
  assert.equal(options.webPreferences.sandbox, false);
  assert.equal(options.webPreferences.contextIsolation, false);
  assert.equal(options.webPreferences.additionalArguments.includes("--existing"), true);
  assert.equal(options.webPreferences.additionalArguments.includes("--dtm-preload=1"), true);

  const originalArg = options.webPreferences.additionalArguments.find(value => value.startsWith("--dtm-original-preload="));
  assert.equal(Buffer.from(originalArg.slice("--dtm-original-preload=".length), "base64").toString("utf8"), "/discord/mainScreenPreload.js");
});

test("patchBrowserWindowOptions skips Discord splash preload", () => {
  const options = patchBrowserWindowOptions({
    webPreferences: {
      preload: "/discord/splashScreenPreload.js"
    }
  }, "/mod/preload.js");

  assert.equal(options.webPreferences.preload, "/discord/splashScreenPreload.js");
  assert.equal(options.webPreferences.additionalArguments, undefined);
});

test("provider failures use typed reasons and localized status text", () => {
  const { classifyProviderStatus } = require("../src/mod/core/provider-fetch");
  const i18n = require("../src/mod/ui/i18n/index");
  const cases = [
    [401, { error: { message: "invalid api key" } }, { code: "AUTH" }, "plugin.error.AUTH"],
    [429, { error: { code: "insufficient_quota", message: "quota exceeded" } }, { code: "RATE_LIMIT", reason: "QUOTA" }, "plugin.error.RATE_LIMIT.QUOTA"],
    [403, { error: { message: "forbidden model" } }, { code: "AUTH", reason: "PERMISSION" }, "plugin.error.AUTH.PERMISSION"],
    [404, { error: { message: "model not found" } }, { code: "CONFIG", reason: "REQUEST_REJECTED" }, "plugin.error.CONFIG.REQUEST_REJECTED"],
    [413, { message: "too large" }, { code: "INPUT", reason: "PROVIDER_LIMIT" }, "plugin.error.INPUT.PROVIDER_LIMIT"],
    [503, null, { code: "NETWORK", reason: "PROVIDER_TEMPORARY" }, "plugin.error.NETWORK.PROVIDER_TEMPORARY"],
    [429, { error: { message: "slow down" } }, { code: "RATE_LIMIT", reason: "TEMPORARY" }, "plugin.error.RATE_LIMIT.TEMPORARY"],
    [400, { error: { type: "ModelProtocolUnsupported", message: "upstream routing" } }, { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" }, "plugin.error.CONFIG.PROTOCOL_UNSUPPORTED"],
    [400, { error: { code: "ModelProtocolUnsupported", message: "upstream routing" } }, { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" }, "plugin.error.CONFIG.PROTOCOL_UNSUPPORTED"],
    [400, { error: { message: "This model is only supported in the /v1/responses API." } }, { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" }, "plugin.error.CONFIG.PROTOCOL_UNSUPPORTED"],
    [400, { error: { message: "not a chat model" } }, { code: "CONFIG", reason: "PROTOCOL_UNSUPPORTED" }, "plugin.error.CONFIG.PROTOCOL_UNSUPPORTED"],
    [404, { error: { code: "model_not_found", message: "unknown identifier" } }, { code: "CONFIG", reason: "MODEL_UNAVAILABLE" }, "plugin.error.CONFIG.MODEL_UNAVAILABLE"],
    [422, { error: { type: "Model_Not_Found", message: "unknown identifier" } }, { code: "CONFIG", reason: "MODEL_UNAVAILABLE" }, "plugin.error.CONFIG.MODEL_UNAVAILABLE"],
  ];
  for (const [status, body, expected, id] of cases) {
    assert.deepEqual(classifyProviderStatus(status, body), expected);
    for (const locale of ["en", "zh-Hans", "zh-Hant", "ja"]) {
      i18n.setLocale(locale);
      const text = i18n.errorText({ ...expected, params: { status } });
      assert.equal(text, i18n.t(id, { status }));
      assert.doesNotMatch(text, /invalid api key|quota exceeded|forbidden model|model not found|slow down|upstream routing|unknown identifier/i);
    }
  }
  i18n.setLocale("en");
});

test("hosted providers reject a missing API key before making a request", async () => {
  await assert.rejects(
    listModels({ settings: normalizeSettings({ model: { provider: "openai" } }), apiKey: "" }),
    /请先填写并保存 API Key/
  );
});

test("testConnection uses staged settings and api key without reading the keychain", async () => {
  const previousFetch = global.fetch;
  let requestUrl = "";
  let requestHeaders = {};
  let requestBody = null;

  global.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "连接正常" } }]
      })
    };
  };

  try {
    const result = await testConnection({
      apiKey: "sk-staged",
      settings: {
        model: {
          baseUrl: "https://model.example/v1",
          modelId: "demo-model",
          targetLanguage: "简体中文"
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.text, "连接正常");
    assert.equal(requestUrl, "https://model.example/v1/chat/completions");
    assert.equal(requestHeaders.authorization, "Bearer sk-staged");
    assert.equal(requestBody.model, "demo-model");
    assert.deepEqual(Object.keys(requestBody).sort(), ["messages", "model"]);
    assert.ok(requestBody.messages.find(message => message.role === "system")?.content);
    assert.ok(requestBody.messages.find(message => message.role === "user")?.content);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("translateWithSettings keeps read translation available even if old settings disabled it", async () => {
  const { translateWithSettings } = require("../src/mod/main");
  const previousFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [{ message: { content: "你好" } }]
    })
  });

  try {
    const settings = normalizeSettings({});
    settings.readTranslation.enabled = false;
    const result = await translateWithSettings({ direction: "read", text: "Hello" }, settings, "sk-test");

    assert.equal(result.text, "你好");
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("translateWithSettings sends Claude providers through Anthropic Messages API", async () => {
  const { translateWithSettings } = require("../src/mod/main");
  const previousFetch = global.fetch;
  let requestUrl = "";
  let requestHeaders = {};
  let requestBody = null;

  global.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "连接正常" }]
      })
    };
  };

  try {
    const result = await translateWithSettings({
      direction: "read",
      text: "Hello"
    }, normalizeSettings({
      model: {
        provider: "anthropic",
        modelId: "claude-haiku-4-5"
      }
    }), "sk-ant-test");

    assert.equal(result.text, "连接正常");
    assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(requestHeaders["x-api-key"], "sk-ant-test");
    assert.equal(requestHeaders["anthropic-version"], "2023-06-01");
    assert.equal(requestBody.model, "claude-haiku-4-5");
    assert.deepEqual(Object.keys(requestBody).sort(), ["max_tokens", "messages", "model", "system"]);
    assert.ok(requestBody.max_tokens > 0);
    assert.ok(requestBody.system);
    assert.equal(requestBody.messages[0].role, "user");
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("translateWithSettings scales Anthropic max_tokens with the input length", async () => {
  const { translateWithSettings } = require("../src/mod/main");
  const previousFetch = global.fetch;
  const bodies = [];

  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return {
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] })
    };
  };

  try {
    const claude = normalizeSettings({ model: { provider: "anthropic", modelId: "claude-haiku-4-5" } });

    await translateWithSettings({ direction: "read", text: "Hi" }, claude, "sk-ant");
    await translateWithSettings({ direction: "read", text: "x".repeat(8000) }, claude, "sk-ant");

    // Short input keeps a sensible floor; long input grows but stays within the model ceiling.
    assert.equal(bodies[0].max_tokens, 1024);
    assert.ok(bodies[1].max_tokens > 2048);
    assert.ok(bodies[1].max_tokens <= 8192);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("listModels fetches OpenAI-compatible provider models", async () => {
  const previousFetch = global.fetch;
  let requestUrl = "";
  let requestHeaders = {};

  global.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: [
          { id: "demo-a" },
          { id: "demo-b", name: "Demo B" }
        ]
      })
    };
  };

  try {
    const result = await listModels({
      apiKey: "sk-models",
      settings: {
        model: {
          provider: "custom",
          baseUrl: "https://model.example/v1",
          modelId: "demo-a"
        }
      }
    });

    assert.equal(requestUrl, "https://model.example/v1/models");
    assert.equal(requestHeaders.authorization, "Bearer sk-models");
    assert.deepEqual(result.models, [
      { value: "demo-a", label: "demo-a" },
      { value: "demo-b", label: "Demo B" }
    ]);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("listModels fetches Gemini native models", async () => {
  const previousFetch = global.fetch;
  let requestUrl = "";

  global.fetch = async (url) => {
    requestUrl = url;
    return {
      ok: true,
      text: async () => JSON.stringify({
        models: [
          {
            name: "models/gemini-3.5-flash",
            baseModelId: "gemini-3.5-flash",
            displayName: "Gemini 3.5 Flash",
            supportedGenerationMethods: ["generateContent"]
          }
        ]
      })
    };
  };

  try {
    const result = await listModels({
      apiKey: "gemini-key",
      settings: {
        model: {
          provider: "google",
          modelId: "gemini-3.5-flash"
        }
      }
    });
    const url = new URL(requestUrl);

    assert.equal(url.origin + url.pathname, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(url.searchParams.get("key"), null);
    assert.deepEqual(result.models, [
      { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" }
    ]);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("listModels fetches Claude models with Anthropic headers", async () => {
  const previousFetch = global.fetch;
  let requestUrl = "";
  let requestHeaders = {};

  global.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: [
          { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }
        ]
      })
    };
  };

  try {
    const result = await listModels({
      apiKey: "sk-ant-models",
      settings: {
        model: {
          provider: "anthropic",
          modelId: "claude-haiku-4-5"
        }
      }
    });

    assert.equal(requestUrl, "https://api.anthropic.com/v1/models");
    assert.equal(requestHeaders["x-api-key"], "sk-ant-models");
    assert.equal(requestHeaders["anthropic-version"], "2023-06-01");
    assert.deepEqual(result.models, [
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
    ]);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("API keys are encrypted per provider via safeStorage and never stored in plaintext", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { setApiKey, getApiKeyStatus, setElectronForTests } = require("../src/mod/main");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-keys-"));
  setElectronForTests({
    app: { getPath: () => tmp },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: buffer => buffer.toString("utf8").replace(/^enc:/, "")
    }
  });

  try {
    await setApiKey({provider:"openai",apiKey:"sk-openai"});
    const status = getApiKeyStatus();
    assert.equal(status.openai, true);
    assert.equal(status.google, false);
    assert.equal(status.previews.openai, "sk-o…enai");

    const raw = fs.readFileSync(path.join(tmp, "discord-translator-mod", "api-keys.json"), "utf8");
    assert.equal(raw.includes("sk-openai"), false);
    assert.ok(raw.includes("safeStorage"));

    await setApiKey({ provider: "openai", apiKey: "" });
    assert.equal(getApiKeyStatus().openai, false);
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("API key storage rejects unavailable encryption without replacing saved keys", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { setApiKey, getApiKeyStatus, setElectronForTests } = require("../src/mod/main");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-keys-"));
  setElectronForTests({ app: { getPath: () => tmp }, safeStorage: { isEncryptionAvailable: () => false } });

  try {
    const file = path.join(tmp, "discord-translator-mod", "api-keys.json");
    fs.mkdirSync(path.dirname(file));
    const original = JSON.stringify({ openai: { enc: "safeStorage", value: "existing-encrypted-key" } });
    fs.writeFileSync(file, original);
    await assert.rejects(() => setApiKey({ provider: "deepseek", apiKey: "sk-test-only" }), /系统加密.*不可用/);
    assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).openai.value,JSON.parse(original).openai.value);
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("local models remain usable while OS encryption is unavailable for a legacy key", async t => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-local-key-"));
  const file = path.join(tmp, "discord-translator-mod", "api-keys.json");
  const previousFetch = global.fetch;
  fs.mkdirSync(path.dirname(file));
  const original = JSON.stringify({ openai: { enc: "plain", value: Buffer.from("test-only-key").toString("base64") } });
  fs.writeFileSync(file, original);
  t.after(() => { global.fetch = previousFetch; setElectronForTests(null); fs.rmSync(tmp, { recursive: true, force: true }); });
  setElectronForTests({ app: { getPath: () => tmp }, safeStorage: { isEncryptionAvailable: () => false } });
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ data: [{ id: "local-test" }] }) });
  const result = await listModels({ settings: normalizeSettings({ model: { provider: "ollama" } }) });
  assert.equal(result.models[0].value, "local-test");
  assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).openai.value,JSON.parse(original).openai.value);
  await assert.rejects(() => setApiKey({ provider: "custom", apiKey: "new-test-key" }), /系统加密.*不可用/);
});

test("legacy wrapped API keys are migrated to OS encryption when read", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-key-migration-"));
  const file = path.join(tmp, "discord-translator-mod", "api-keys.json");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ custom: { enc: "plain", value: Buffer.from("test-only-key").toString("base64") } }));
  setElectronForTests({
    app: { getPath: () => tmp },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from("encrypted:" + value),
      decryptString: value => value.toString().replace(/^encrypted:/, "")
    }
  });
  try {
    await require("../src/mod/main").getRuntime().ready;
    assert.equal(getApiKeyStatus().custom, false);
    assert.equal(getApiKeyStatus().unlinked, true);
    const entry = JSON.parse(fs.readFileSync(file, "utf8")).custom;
    assert.equal(entry.enc, "safeStorage");
    assert.notEqual(entry.value, Buffer.from("test-only-key").toString("base64"));
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a damaged key file leaves settings readable and blocks key replacement", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-damaged-keys-"));
  const dir = path.join(tmp, "discord-translator-mod");
  const file = path.join(dir, "api-keys.json");
  const original = "{not-json";
  fs.mkdirSync(dir);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify({ enabled: true, customPrompt: "kept" }, null, 2)}\n`);
  setElectronForTests({ app: { getPath: () => tmp, once() {} }, safeStorage: { isEncryptionAvailable: () => false } });
  try {
    const loaded = await getSettings();
    assert.equal(loaded.settings.customPrompt, "kept");
    assert.equal(loaded.settings.enabled, true);
    assert.equal(loaded.keyStatus.unavailable.reason, "INVALID_JSON");
    assert.equal(loaded.keyStatus.unavailable.recoverable, true);
    await assert.rejects(
      saveConfig({
        baseSettingsRevision: loaded.settingsRevision,
        settings: loaded.settings,
        key: { action: "replace", value: "should-not-write" }
      }),
      error => error.code === "MALFORMED" && error.reason === "INVALID_JSON"
    );
    assert.equal(fs.readFileSync(file, "utf8"), original);
    const saved = await saveConfig({
      baseSettingsRevision: loaded.settingsRevision,
      settings: { ...loaded.settings, customPrompt: "still saved" },
      key: { action: "keep" }
    });
    assert.equal(saved.settings.customPrompt, "still saved");
    assert.equal(saved.keyStatus.unavailable.reason, "INVALID_JSON");
    assert.equal(fs.readFileSync(file, "utf8"), original);
  } finally {
    getRuntime().settings.stopWatching();
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setElectronForTests stops the previous runtime's file watching before fixtures are removed", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-watch-teardown-"));
  fs.mkdirSync(path.join(tmp, "discord-translator-mod"));
  setElectronForTests({ app: { getPath: () => tmp, once() {} }, safeStorage: { isEncryptionAvailable: () => false } });
  let store;
  try {
    await getRuntime().ready;
    store = getRuntime().settings;
    assert.ok(store.watcher, "the runtime watches its settings directory");
    assert.ok(store.watchHealth, "the runtime keeps its watch health check armed");
  } finally {
    setElectronForTests(null);
  }
  // Teardown closes every watcher and timer, so nothing keeps a handle on the
  // fixture directory the tests remove immediately afterwards.
  assert.equal(store.watcher, null);
  assert.equal(store.watchHealth, null);
  assert.equal(store.watchTimer, null);
  // Closing a watch handle is asynchronous; let the loop finish it, then the
  // watched fixture directory must be removable.
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

for (const operation of ["translate", "models"]) {
  for (const failure of ["timeout", "network"]) {
    test(`${operation} reports ${failure} while reading the response body in Chinese`, async t => {
      const { translateWithSettings } = require("../src/mod/main");
      t.mock.method(global, "fetch", async () => ({
        ok: true,
        text: async () => {
          if (failure === "timeout") throw new DOMException("The operation was aborted", "AbortError");
          throw new TypeError("terminated", { cause: { code: "ECONNRESET" } });
        }
      }));
      const settings = normalizeSettings({ model: { provider: "openai" } });
      const promise = operation === "translate"
        ? translateWithSettings({ text: "hello" }, settings, "test-only-key")
        : listModels({ settings, apiKey: "test-only-key" });
      await assert.rejects(promise, error => {
        assert.equal(error.code, failure === "timeout" ? "TIMEOUT" : "NETWORK");
        assert.match(error.message, failure === "timeout" ? /超时/ : /网络连接失败/);
        assert.doesNotMatch(error.message, /ECONNRESET|重置/);
        return true;
      });
    });
  }
}

test("openSettingsFile opens the settings directory instead of the JSON file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/main.js"), "utf8");

  assert.match(source, /const directory\s*=\s*getStoreDir\(\);/);
  assert.ok(source.includes("electron.shell.openPath(directory)"));
  assert.equal(source.includes("electron.shell.openPath(filePath)"), false);
});

test("openExternal opens only https links via the OS shell", async () => {
  const { openExternal } = require("../src/mod/main");
  const opened = [];
  const electron = { shell: { openExternal: async url => { opened.push(url); } } };

  assert.deepEqual(
    await openExternal(electron, "https://x.com/Samoye"),
    { ok: true, url: "https://x.com/Samoye" }
  );
  assert.equal((await openExternal(electron, "file:///etc/passwd")).ok, false);
  assert.equal((await openExternal(electron, "javascript:alert(1)")).ok, false);
  assert.deepEqual(opened, ["https://x.com/Samoye"]);
});

test("legacy persistCache false is ignored on startup, save, and external reload", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-persist-cache-"));
  const dir = path.join(tmp, "discord-translator-mod");
  const settingsFile = path.join(dir, "settings.json");
  fs.mkdirSync(dir);
  fs.writeFileSync(settingsFile, JSON.stringify({
    enabled: true,
    persistCache: false,
    customPrompt: "kept",
    style: { backgroundColor: "#E8EDF8", textColor: " Auto " },
  }));
  setElectronForTests({ app: { getPath: () => tmp, once() {} }, safeStorage: { isEncryptionAvailable: () => false } });
  try {
    const cacheFile = path.join(dir, "cache.json");
    const stored = async (key, text) => {
      const cache = getRuntime().cache;
      assert.equal(Object.hasOwn(cache.status(), "persist"), false);
      cache.put(key, text, cache.generation);
      await cache.flush();
      const body = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      assert.equal(body.entries.some(([entry, value]) => entry === key && value === text), true);
    };
    const loaded = await getSettings();
    assert.equal(Object.hasOwn(loaded.cache, "persist"), false);
    assert.equal(Object.hasOwn(loaded.settings, "persistCache"), false);
    assert.equal(loaded.settings.style.backgroundColor, "#E8EDF8");
    assert.equal(loaded.settings.style.textColor, "Auto");
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).persistCache, false);
    assert.equal(fs.existsSync(cacheFile), false);
    await stored("a".repeat(64), "loaded");
    const saved = await saveConfig({
      baseSettingsRevision: loaded.settingsRevision,
      settings: { ...loaded.settings, persistCache: false, customPrompt: "saved" },
      key: { action: "keep" },
    });
    assert.equal(saved.settings.customPrompt, "saved");
    assert.equal(Object.hasOwn(saved.settings, "persistCache"), false);
    assert.equal(saved.settings.style.backgroundColor, "#E8EDF8");
    const disk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(Object.hasOwn(disk, "persistCache"), false);
    assert.equal(disk.style.backgroundColor, "#E8EDF8");
    assert.equal(disk.customPrompt, "saved");
    await stored("b".repeat(64), "saved");
    disk.persistCache = false;
    disk.customPrompt = "external";
    fs.writeFileSync(settingsFile, JSON.stringify(disk));
    getRuntime().settings.reload(true);
    const again = await getSettings();
    assert.equal(again.settings.customPrompt, "external");
    assert.equal(Object.hasOwn(again.settings, "persistCache"), false);
    assert.equal(Object.hasOwn(again.cache, "persist"), false);
    const key = "c".repeat(64);
    getRuntime().cache.put(key, "kept-on-disk", getRuntime().cache.generation);
    await getRuntime().cache.flush();
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.equal(cache.entries.some(([entry, text]) => entry === key && text === "kept-on-disk"), true);
  } finally {
    clearTimeout(getRuntime().cache.timer);
    getRuntime().settings.stopWatching();
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("translation cache persists to disk and reloads, capped in size", async t => {
  const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createHash}=require("node:crypto");
  const {CacheStore}=require("../src/mod/core/cache-store"),{Writer}=require("../src/mod/core/storage");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"babel-cache-"));const cache=new CacheStore(temp,new Writer());t.after(()=>{clearTimeout(cache.timer);fs.rmSync(temp,{recursive:true,force:true});});await cache.ready;
  for(let i=0;i<1500;i++)cache.put(createHash("sha256").update(String(i)).digest("hex"),String(i),0);
  assert.equal(cache.status().count,500);await cache.flush();const loaded=new CacheStore(temp,new Writer());await loaded.ready;assert.equal(loaded.status().count,500);
});

test("compareVersions orders semantic versions numerically and ignores a v prefix", () => {
  const { compareVersions } = require("../src/mod/main");
  assert.equal(compareVersions("0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.1.0-beta", "0.1.0"), 0);
});

function atomFeed(tag) {
  return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">'
    + '<link rel="self" href="https://github.com/itsmaiGe/babel/releases.atom"/>'
    + '<entry><id>tag:github.com,2008:Repository/1/' + tag + '</id>'
    + '<link rel="alternate" type="text/html" href="https://github.com/itsmaiGe/babel/releases/tag/' + tag + '"/>'
    + '<title>' + tag + '</title></entry></feed>';
}

test("checkForUpdate flags a newer release from the ATOM feed and surfaces the download link", async () => {
  const { checkForUpdate } = require("../src/mod/main");
  const previousFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url, options) => {
    requestedUrl = url;
    assert.ok(options.headers["User-Agent"]);
    return { ok: true, text: async () => atomFeed("v9.9.9") };
  };
  try {
    const result = await checkForUpdate();
    assert.ok(requestedUrl.includes("itsmaiGe/babel"));
    assert.ok(requestedUrl.includes("releases.atom"), "uses the rate-limit-free ATOM feed, not the API");
    assert.equal(result.ok, true);
    assert.equal(result.updateAvailable, true);
    assert.equal(result.latest, "9.9.9");
    assert.ok(result.url.includes("github.com/itsmaiGe/babel/releases/tag/v9.9.9"));
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("checkForUpdate reports no update when the feed's latest equals the current version, and fails quietly on errors", async () => {
  const { checkForUpdate } = require("../src/mod/main");
  const { BABEL_VERSION } = require("../src/shared/defaults");
  const previousFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, text: async () => atomFeed("v" + BABEL_VERSION) });
    const same = await checkForUpdate();
    assert.equal(same.ok, true);
    assert.equal(same.updateAvailable, false);

    global.fetch = async () => { throw new Error("offline"); };
    const offline = await checkForUpdate();
    assert.equal(offline.ok, false);
    assert.equal(offline.current, BABEL_VERSION);
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("bundled BABEL_VERSION stays in sync with package.json", () => {
  const { BABEL_VERSION } = require("../src/shared/defaults");
  const pkg = require("../package.json");
  assert.equal(BABEL_VERSION, pkg.version);
});

test("translateWithSettings turns a request timeout into a clear, friendly message", async () => {
  const { translateWithSettings } = require("../src/mod/main");
  const previousFetch = global.fetch;
  global.fetch = async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  };
  try {
    const settings = normalizeSettings({ enabled: true, model: { provider: "openai" } });
    await assert.rejects(
      translateWithSettings({ direction: "read", text: "hello" }, settings, "sk-test"),
      /翻译超时/
    );
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});

test("translateWithSettings reports a network failure without DNS or host text", async () => {
  const { translateWithSettings } = require("../src/mod/main");
  const previousFetch = global.fetch;
  global.fetch = async () => {
    const error = new TypeError("fetch failed");
    error.cause = { code: "ENOTFOUND" };
    throw error;
  };
  try {
    const settings = normalizeSettings({ enabled: true, model: { provider: "openai" } });
    await assert.rejects(
      translateWithSettings({ direction: "read", text: "hello" }, settings, "sk-test"),
      error => {
        assert.equal(error.code, "NETWORK");
        assert.match(error.message, /网络连接失败/);
        assert.doesNotMatch(error.message, /DNS|ENOTFOUND|api\.openai/);
        return true;
      }
    );
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});
