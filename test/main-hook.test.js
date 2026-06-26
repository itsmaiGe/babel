"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { getApiKeyStatus, listModels, patchBrowserWindowOptions, setApiKey, testConnection } = require("../src/mod/main");
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
    assert.equal(url.searchParams.get("key"), "gemini-key");
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

test("API keys are encrypted per provider via safeStorage and never stored in plaintext", () => {
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
    assert.deepEqual(setApiKey({ provider: "openai", apiKey: "sk-openai" }), { ok: true, hasApiKey: true });
    const status = getApiKeyStatus();
    assert.equal(status.openai, true);
    assert.equal(status.google, false);
    assert.equal(status.previews.openai, "sk-o…enai");

    const raw = fs.readFileSync(path.join(tmp, "discord-translator-mod", "api-keys.json"), "utf8");
    assert.equal(raw.includes("sk-openai"), false);
    assert.ok(raw.includes("safeStorage"));

    setApiKey({ provider: "openai", apiKey: "" });
    assert.equal(getApiKeyStatus().openai, false);
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("API key storage falls back to local wrapping when no OS keyring is available", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { setApiKey, getApiKeyStatus, setElectronForTests } = require("../src/mod/main");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-keys-"));
  setElectronForTests({ app: { getPath: () => tmp }, safeStorage: { isEncryptionAvailable: () => false } });

  try {
    setApiKey({ provider: "deepseek", apiKey: "sk-deepseek-123456" });
    const status = getApiKeyStatus();
    assert.equal(status.deepseek, true);
    assert.equal(status.previews.deepseek, "sk-d…3456");

    const raw = fs.readFileSync(path.join(tmp, "discord-translator-mod", "api-keys.json"), "utf8");
    assert.equal(raw.includes("sk-deepseek-123456"), false);
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("openSettingsFile opens the settings directory instead of the JSON file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/main.js"), "utf8");

  assert.ok(source.includes("const directoryPath = path.dirname(filePath);"));
  assert.ok(source.includes("electron.shell.openPath(directoryPath)"));
  assert.equal(source.includes("electron.shell.openPath(filePath)"), false);
});

test("openExternal opens only https links via the OS shell", async () => {
  const { openExternal } = require("../src/mod/main");
  const opened = [];
  const electron = { shell: { openExternal: async url => { opened.push(url); } } };

  assert.deepEqual(
    await openExternal(electron, "https://x.com/unflwMaige"),
    { ok: true, url: "https://x.com/unflwMaige" }
  );
  assert.equal((await openExternal(electron, "file:///etc/passwd")).ok, false);
  assert.equal((await openExternal(electron, "javascript:alert(1)")).ok, false);
  assert.deepEqual(opened, ["https://x.com/unflwMaige"]);
});

test("translation cache persists to disk and reloads, capped in size", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { loadTranslationCache, saveTranslationCache, setElectronForTests } = require("../src/mod/main");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "babel-cache-"));
  setElectronForTests({ app: { getPath: () => tmp } });
  try {
    assert.deepEqual(loadTranslationCache(), {});
    saveTranslationCache({ a: "你好", b: "世界", junk: 123 });
    const back = loadTranslationCache();
    assert.equal(back.a, "你好");
    assert.equal(back.b, "世界");
    assert.equal("junk" in back, false); // non-string values dropped

    const big = {};
    for (let i = 0; i < 1500; i += 1) big["k" + i] = "v" + i;
    const res = saveTranslationCache(big);
    assert.equal(res.count, 1000); // capped
    assert.equal(Object.keys(loadTranslationCache()).length, 1000);
  } finally {
    setElectronForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

test("translateWithSettings turns a 'fetch failed' network error into a clear reason", async () => {
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
      /网络连接失败.*DNS/
    );
  } finally {
    if (previousFetch) global.fetch = previousFetch;
    else delete global.fetch;
  }
});
