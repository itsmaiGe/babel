"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture(browserDescriptor = "native") {
  const handlers = new Map(), app = new EventEmitter();
  app.isReady = () => true;
  app.getPreferredSystemLanguages = () => ["ja-JP"];
  app.getPath = () => { throw new Error("Initialization must not read user data"); };
  let nextId = 0;
  class Original extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.id = ++nextId;
      this.webContents.mainFrame = { url: "https://discord.com/channels/@me" };
    }
  }
  Object.defineProperty(Original, "earlierInjector", { value: Object.freeze({ intact: true }) });
  const electron = { app, ipcMain: {
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error("Duplicate IPC handler");
      handlers.set(channel, handler);
    },
    removeHandler(channel) { handlers.delete(channel); },
  } };
  Object.defineProperty(electron, "BrowserWindow", ["native", "getter", "locked"].includes(browserDescriptor)
    ? { configurable: browserDescriptor === "getter", enumerable: true, get: () => Original }
      : { configurable: false, enumerable: true, writable: true, value: Original });
  Object.defineProperty(electron, "unrelatedLazyApi", { get() { throw new Error("Do not spread Electron exports"); } });
  const cached = {};
  // Descriptors measured in Discord 0.0.414 / Electron 42.11.8.
  Object.defineProperty(cached, "exports", { configurable: browserDescriptor !== "locked", enumerable: true, get: () => electron });
  const source = path.resolve(__dirname, "../src/mod/main.js"), realRequire = createRequire(source);
  const requireMock = name => name === "electron" ? cached.exports : realRequire(name);
  requireMock.resolve = name => name === "electron" ? "electron" : realRequire.resolve(name);
  requireMock.cache = { electron: cached };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, "utf8"), {
    require: requireMock, module, exports: module.exports, __dirname: path.dirname(source),
    Buffer, URL, console, setTimeout, clearTimeout,
  }, { filename: source });
  return { hook: module.exports, electron, cached, Original, handlers };
}

test("getter-only Electron exports: main injection, splash isolation, static APIs and IPC authorization", async () => {
  const { hook, electron: originalElectron, cached, Original, handlers } = fixture();
  const cacheDescriptor = Object.getOwnPropertyDescriptor(cached, "exports");
  // The previous hook fails here before registering its handlers.
  assert.throws(() => { cached.exports = { ...originalElectron }; }, TypeError);
  hook.install();
  const electron = cached.exports;
  assert.notEqual(electron, originalElectron);
  assert.equal(Object.getOwnPropertyDescriptor(cached, "exports").set, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(cached, "exports").configurable, cacheDescriptor.configurable);
  assert.deepEqual(Object.getOwnPropertyDescriptor(electron, "unrelatedLazyApi"), Object.getOwnPropertyDescriptor(originalElectron, "unrelatedLazyApi"));
  assert.equal(originalElectron.BrowserWindow, Original);
  assert.notEqual(electron.BrowserWindow, Original);
  assert.equal(electron.BrowserWindow.earlierInjector, Original.earlierInjector);
  const originalOptions = { webPreferences: { preload: "/discord/mainScreenPreload.js", additionalArguments: ["--other-injector"], sandbox: true, contextIsolation: true } };
  const main = new electron.BrowserWindow(originalOptions);
  const splash = new electron.BrowserWindow({ webPreferences: { preload: "/discord/splashScreenPreload.js", sandbox: true, contextIsolation: true } });
  const auxiliary = new electron.BrowserWindow({ webPreferences: { preload: "/discord/otherPreload.js" } });
  const preferences = main.options.webPreferences;
  assert.equal(preferences.preload, path.resolve(__dirname, "../src/mod/preload.js"));
  assert.equal(preferences.additionalArguments.filter(arg => arg === "--dtm-preload=1").length, 1);
  assert.equal(preferences.additionalArguments.includes("--dtm-ui-locale=ja"), true);
  assert.equal(preferences.additionalArguments.includes("--other-injector"), true);
  const originalArg = preferences.additionalArguments.find(arg => arg.startsWith("--dtm-original-preload="));
  assert.equal(Buffer.from(originalArg.split("=")[1], "base64").toString(), originalOptions.webPreferences.preload);
  assert.equal(originalOptions.webPreferences.sandbox, true);
  assert.equal(originalOptions.webPreferences.additionalArguments.length, 1);
  assert.equal(splash.options.webPreferences.preload, "/discord/splashScreenPreload.js");
  assert.equal(splash.options.webPreferences.sandbox, true);
  assert.equal(splash.options.webPreferences.contextIsolation, true);
  assert.equal(splash.options.webPreferences.additionalArguments, undefined);
  assert.equal(auxiliary.options.webPreferences.preload, "/discord/otherPreload.js");
  assert.deepEqual([...hook.guard.windows.keys()], [main.webContents.id]);
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  assert.equal(hook.guard.authorize(event, () => true), main.webContents.id);
  for (const denied of [
    { sender: splash.webContents, senderFrame: splash.webContents.mainFrame },
    { ...event, senderFrame: { url: "https://discord.com/channels/@me" } },
  ]) assert.equal((await handlers.get(hook.CHANNELS.getSettings)(denied)).error.code, "UNTRUSTED");
  main.webContents.mainFrame.url = "https://example.com";
  assert.equal((await handlers.get(hook.CHANNELS.getSettings)(event)).error.code, "UNTRUSTED");
  main.webContents.mainFrame.url = "https://discord.com/channels/@me";
  assert.equal((await handlers.get(hook.CHANNELS.cancel)(event, { requestIds: "invalid" })).error.code, "INPUT");
  const patched = electron.BrowserWindow;
  hook.install(); hook.install();
  assert.equal(electron.BrowserWindow, patched);
  assert.equal(handlers.size, Object.keys(hook.CHANNELS).length - 1);
  main.emit("closed");
  assert.equal(hook.guard.windows.size, 0);
});

test("partial IPC registration rolls back the hook and handlers, then initialization can retry", () => {
  const { hook, electron, cached, Original, handlers } = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(cached, "exports"), handle = electron.ipcMain.handle;
  let count = 0;
  electron.ipcMain.handle = (channel, handler) => {
    if (++count === 4) throw new Error("Injected IPC registration failure");
    // Reentrant calls do not stack hooks while the first setup is incomplete.
    hook.install();
    handle(channel, handler);
  };
  assert.throws(() => hook.install(), /Injected IPC registration failure/);
  assert.equal(electron.BrowserWindow, Original);
  assert.deepEqual(Object.getOwnPropertyDescriptor(cached, "exports"), descriptor);
  assert.equal(handlers.size, 0);
  electron.ipcMain.handle = handle;
  hook.install();
  assert.notEqual(cached.exports.BrowserWindow, Original);
  assert.equal(handlers.size, Object.keys(hook.CHANNELS).length - 1);
  const patched = cached.exports.BrowserWindow;
  hook.install();
  assert.equal(cached.exports.BrowserWindow, patched);
});

test("a configurable BrowserWindow getter is patched directly without replacing cached exports", () => {
  const { hook, electron, cached, Original } = fixture("getter");
  const descriptor = Object.getOwnPropertyDescriptor(cached, "exports");
  hook.install();
  assert.notEqual(electron.BrowserWindow, Original);
  assert.equal(cached.exports, electron);
  assert.deepEqual(Object.getOwnPropertyDescriptor(cached, "exports"), descriptor);
});

test("a non-configurable writable BrowserWindow can be patched", () => {
  const { hook, electron, Original } = fixture("writable");
  hook.install();
  assert.notEqual(electron.BrowserWindow, Original);
  assert.equal(Object.getOwnPropertyDescriptor(electron, "BrowserWindow").configurable, false);
});

test("an unreplaceable BrowserWindow fails visibly and never reports successful initialization", () => {
  const { hook, electron, Original, handlers } = fixture("locked");
  assert.throws(() => hook.install(), /BrowserWindow is not replaceable/);
  assert.throws(() => hook.install(), /BrowserWindow is not replaceable/);
  assert.equal(electron.BrowserWindow, Original);
  assert.equal(handlers.size, 0);
});
