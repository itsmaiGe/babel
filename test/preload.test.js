"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function bridgeHarness() {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");
  const start = source.indexOf("String.raw`\n") + "String.raw`\n".length;
  const code = source.slice(start, source.indexOf("\n`;", start));
  const listeners = new Map();
  const window = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    dispatchEvent: event => listeners.get(event.type)?.(event),
    postMessage() {},
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  };
  const context = { window, CustomEvent: window.CustomEvent, document: { querySelector: () => null }, console, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(code.replace(/\}\)\(\);\s*$/, `
    window.testBridge = {
      installSettingsRoot, mount, unmountControls, SettingsSection, ToggleControl,
      configure: value => { settingsSpec = value; },
      setUi: value => { uiCache = value; },
      setComposerApi: value => { composerApi = value; },
      findModule,
      controls, sectionRefresh
    };
  })();`), context);
  return { ...window.testBridge, window, document: context.document };
}

test("module lookup selects real APIs instead of Discord's dynamic locale messages", () => {
  const bridge = bridgeHarness();
  const messages = new Proxy({}, {
    get: (_, key) => key === Symbol.toStringTag ? "IntlMessagesProxy" : () => ({ locale: "en-US", ast: [] })
  });
  const api = { toDOMNode() {}, focus() {} };
  const require = { c: {
    locale: { exports: { messages } },
    editor: { exports: { api } }
  } };
  assert.equal(bridge.findModule(require, value => typeof value?.toDOMNode === "function" && typeof value?.focus === "function"), api);
});

test("native settings registration adds four categories without depending on the open page or locale", () => {
  const bridge = bridgeHarness();
  bridge.configure({ title: "Babel", sections: ["model", "read", "send", "style"].map(key => ({ key, label: key })), icon: "" });
  const language = { key: "language_and_time_sidebar_item" };
  const section = { key: "native-section", buildLayout: () => [language] };
  const root = { key: "$Root", analyticsKey: "user_settings", buildLayout: () => [section] };
  const types = { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 };
  const require = Object.assign(() => {}, { c: { types: { exports: { types } } } });
  bridge.installSettingsRoot(root, require);
  const entries = root.buildLayout()[0].buildLayout();
  assert.equal(entries[0], language);
  const babel = entries[1];
  assert.equal(babel.useTitle(), "Babel");
  const panel = babel.buildLayout()[0];
  assert.deepEqual(Array.from(panel.buildLayout(), node => node.key), ["babel_model", "babel_read", "babel_send", "babel_style"]);
  assert.equal(panel.buildLayout().every(node => node.type === types.CATEGORY), true);
  bridge.installSettingsRoot(root, require);
  assert.equal(root.buildLayout()[0].buildLayout().length, 2);
  assert.equal(section.buildLayout().length, 1);
});

test("native settings portals inherit the surrounding theme and release controls on section unmount", () => {
  const bridge = bridgeHarness();
  bridge.configure({ sections: [{ key: "model" }] });
  const effects = [];
  const ui = {
    React: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: value => [value, () => {}],
      useLayoutEffect: effect => effects.push(effect)
    },
    ReactDOM: { createPortal: (element, host, key) => ({ portal: element, host, key }) }
  };
  bridge.setUi(ui);
  const host = { closest: () => ({ dataset: { dtmSectionKey: "model" } }) };
  bridge.document.querySelector = () => host;
  bridge.SettingsSection({ section: { key: "model" } });
  const cleanup = effects.pop()();
  bridge.mount({ id: "dtm-control-1", kind: "select", name: "AI 平台", value: "custom", options: [] });
  assert.equal(bridge.controls.size, 1);
  const tree = bridge.SettingsSection({ section: { key: "model" } });
  const portals = tree.children.flat();
  assert.equal(portals.length, 1);
  assert.equal(portals[0].host, host);
  assert.equal(portals[0].portal.type.name, "SelectControl");
  bridge.unmountControls({ ids: ["dtm-control-1"] });
  assert.equal(bridge.controls.size, 0);
  bridge.mount({ id: "dtm-control-2", kind: "select" });
  cleanup();
  assert.equal(bridge.controls.size, 0);
  assert.equal(bridge.sectionRefresh.size, 0);
});

test("lazy settings factories are registered before Discord consumes their layout", () => {
  const bridge = bridgeHarness();
  bridge.configure({ title: "Babel", sections: [{ key: "model", label: "模型" }] });
  bridge.window.webpackChunkdiscord_app = [];
  const types = { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 };
  const language = { key: "language_and_time_sidebar_item" };
  const require = Object.assign(() => {}, { c: { types: { exports: types } } });
  const module = { exports: {} };
  const modules = {
    settings(module) {
      module.exports = { key: "$Root", analyticsKey:"user_settings", buildLayout: () => [
        { buildLayout: () => [language] }
      ] };
    }
  };
  bridge.window.webpackChunkdiscord_app.push = chunk => chunk[1].settings(module, module.exports, require);
  bridge.window.webpackChunkdiscord_app.push([[1], modules]);
  assert.equal(module.exports.buildLayout()[0].buildLayout()[1].key, "babel_sidebar_item");
});

function composerHarness() {
  const bridge = bridgeHarness();
  const { EventEmitter } = require("node:events");
  const calls = [];
  let channelId = "100";
  class ChannelEditor {}
  const dom = { isConnected: true };
  const slate = { children: [{ text: "" }], events: new EventEmitter() };
  const handle = {
    getSlateEditor: () => slate,
    insertText: (text, raw, addSpace) => { calls.push(["insert", text, raw, addSpace]); slate.children = [{ text }]; },
    submit: () => calls.push(["submit", slate.children[0].text]),
    focus: () => calls.push(["focus"])
  };
  const editor = Object.assign(new ChannelEditor(), {
    ref: { current: handle }, state: { submitting: false },
    props: { channel: { id: channelId }, type: { analyticsName: "normal" }, useSlate: true, textValue: "" }
  });
  const form = { editorRef: editor, props: { channel: { id: channelId } }, handleSendMessage() {} };
  dom.__reactFiber$test = { stateNode: null, return: { stateNode: editor, return: { stateNode: form } } };
  bridge.document.querySelector = () => dom;
  bridge.setComposerApi({
    ChannelEditor, serialize: children => children.map(node => node.text).join(""),
    Slate: { toDOMNode: () => dom }, selectedChannel: { getChannelId: () => channelId }
  });
  return { ...bridge.window.__discordTranslatorComposer, calls, slate, dom, editor, form,
    select: id => { channelId = id; } };
}

for (const send of [false, true]) {
  test(`native composer inserts into the captured Slate editor with auto-send=${send}`, () => {
    const composer = composerHarness();
    const id = composer.beginSend(send);
    const result = composer.insertAndSend({ id, text: "Translation" });
    assert.equal(result.ok, true);
    assert.equal(result.sent, send);
    assert.deepEqual(composer.calls, [["insert", "Translation", "Translation", false], send ? ["submit", "Translation"] : ["focus"]]);
    assert.equal(composer.slate.events.listenerCount("onChange"), 0);
    assert.throws(() => composer.insertAndSend({ id, text: "Duplicate" }), /原文已保留/);
  });
}

test("native composer preserves existing drafts before translation begins", () => {
  const composer = composerHarness();
  composer.slate.children = [{ text: "Existing draft" }];
  assert.throws(() => composer.beginSend(true), /已有草稿/);
  assert.deepEqual(composer.calls, []);
  assert.equal(composer.slate.events.listenerCount("onChange"), 0);
});

test("native composer rejects channel, editor, reply, or draft changes during translation", () => {
  for (const change of [
    c => c.select("200"),
    c => { c.dom.isConnected = false; },
    c => { c.form.props.pendingReply = { messageId: "reply" }; },
    c => { c.slate.children = [{ text: "New draft" }]; },
    c => { c.slate.children = [{ text: "Changed draft" }]; c.slate.events.emit("onChange"); c.slate.children = [{ text: "" }]; }
  ]) {
    const composer = composerHarness();
    const id = composer.beginSend(true);
    change(composer);
    assert.throws(() => composer.insertAndSend({ id, text: "Translation" }));
    assert.deepEqual(composer.calls, []);
    assert.equal(composer.slate.events.listenerCount("onChange"), 0);
  }
});

test("native composer cancels outstanding work without cancelling a later request", () => {
  const composer = composerHarness();
  const oldId = composer.beginSend(true);
  const id = composer.beginSend(false);
  composer.cancelSend(oldId);
  assert.equal(composer.slate.events.listenerCount("onChange"), 1);
  composer.cancelSend();
  assert.equal(composer.slate.events.listenerCount("onChange"), 0);
  assert.throws(() => composer.insertAndSend({ id, text: "Translation" }));
  assert.deepEqual(composer.calls, []);
});

test("native composer keeps a pending translation through focus and selection notifications", () => {
  const composer = composerHarness();
  const id = composer.beginSend(false);
  composer.slate.events.emit("onChange");
  assert.equal(composer.insertAndSend({ id, text: "Translation" }).ok, true);
});

test("composer calls preserve Chinese errors across the Electron execution boundary", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");
  const code = source.slice(source.indexOf("async function callComposer("), source.indexOf("const api = Object.freeze("));
  const context = {
    webFrame: { executeJavaScript: async code => vm.runInNewContext(code, {
      window: { __discordTranslatorComposer: {
        beginSend: () => { throw new Error("Discord 输入框已有草稿，请先发送或清空，原文已保留。"); },
        insertAndSend: request => request.text
      } }
    }) }
  };
  vm.runInNewContext(code, context);
  await assert.rejects(context.callComposer("beginSend", true), /已有草稿/);
  const text = "Quoted \"text\"; window.unwanted = true;\nNext line";
  assert.equal(await context.callComposer("insertAndSend", { text }), text);
});

test("preload installs an early Discord webpack capture before running Discord preload", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.indexOf("injectMainWorldBridge();") < source.indexOf("runOriginalPreload();"));
  assert.ok(source.includes('__discordTranslatorWebpack'));
  assert.ok(source.includes('Object.defineProperty(Function.prototype, "m"'));
  assert.ok(source.includes('require.p === "/assets/"'));
  assert.equal(source.includes("installWebpackCapture();"), false);
});

test("preload retries bridge injection until an injection target is available", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("const RUNTIME_BRIDGE_MAX_ATTEMPTS"));
  assert.ok(source.includes("if (runtimeStarted) return;"));
  assert.ok(source.includes("const bridgeInjected = injectMainWorldBridge();"));
  assert.ok(source.includes("if (!target) return injected;"));
  assert.ok(source.includes("window.setTimeout(() => startRuntime(attempt + 1), RUNTIME_BRIDGE_RETRY_MS);"));
  assert.ok(source.indexOf("const bridgeInjected = injectMainWorldBridge();") < source.indexOf('require(path.join(__dirname, "renderer.js")).start(api);'));
});

test("preload exposes listModels IPC to the renderer", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("listModels: request => ipcRenderer.invoke(\"dtm:list-models\", request)"));
  assert.ok(source.includes("getApiKeyStatus: () => ipcRenderer.invoke(\"dtm:get-api-key-status\")"));
  assert.ok(source.includes("openSettingsFile: () => ipcRenderer.invoke(\"dtm:open-settings-file\")"));
});

test("native Switch receives its accessible label and toggles the settings value", () => {
  const bridge = bridgeHarness();
  const changes = [];
  const ui = {
    Switch: function NativeSwitch() {},
    React: {
      createElement: (type, props) => ({ type, props }),
      useState: value => [value, () => {}],
      useEffect() {}
    }
  };
  const tree = bridge.ToggleControl({ ui, detail: { name: "启用插件", value: true }, sendChange: value => changes.push(value) });
  assert.equal(tree.type, ui.Switch);
  assert.equal(tree.props.label, "启用插件");
  assert.equal(tree.props.checked, true);
  tree.props.onChange(false);
  assert.deepEqual(changes, [false]);
});

test("preload bridge mounts Discord searchable combobox controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("SearchableSelect"));
  assert.ok(source.includes('?\"multiple\":\"single\",required:'));
  assert.ok(source.includes('detail.kind === "combobox"'));
  assert.ok(source.includes("function ComboBoxControl({ ui, detail, sendChange })"));
  assert.ok(source.includes("React.useEffect(() => {"));
  assert.ok(source.includes("h(ComboBoxControl, { ui, detail, sendChange })"));
  assert.ok(source.includes("onSearchChange"));
  assert.ok(source.includes("if (!nextValue) return;"));
  assert.equal(source.includes("ComboboxProvider"), false);
  assert.equal(source.includes("ComboboxListbox"), false);
  assert.equal(source.includes("dtm-combobox-popout"), false);
});

test("preload bridge follows Discord's current Select contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes('selectionMode:\"single\",onSelectionChange:'));
  assert.ok(source.includes("isSelected:"));
  assert.ok(source.includes("select: next =>"));
  assert.ok(source.includes("isSelected: next => next === value"));
});

test("preload bridge keeps updating controls on stable React component types", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");
  const mountBody = source.slice(source.indexOf("function mount(detail)"));

  assert.ok(source.includes("function ButtonControl({ ui, detail })"));
  assert.ok(source.includes("h(ButtonControl, { ui, detail })"));
  assert.ok(source.includes("function SelectControl({ ui, detail, sendChange })"));
  assert.ok(source.includes("function TextControl({ ui, detail, sendChange })"));
  assert.ok(source.includes("function ToggleControl({ ui, detail, sendChange })"));
  assert.ok(source.includes("function TranslationPreviewControl({ ui, detail })"));
  assert.equal(mountBody.includes("function ComboBoxControl()"), false);
  assert.equal(mountBody.includes("function ButtonControl()"), false);
  assert.equal(mountBody.includes("function SelectControl()"), false);
  assert.equal(mountBody.includes("function TextControl()"), false);
  assert.equal(mountBody.includes("function ToggleControl()"), false);
  assert.equal(mountBody.includes("function TranslationPreviewControl()"), false);
});

test("preload bridge does not mount the removed color picker path", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("ColorPicker"), false);
  assert.equal(source.includes("DefaultColorButton"), false);
  assert.equal(source.includes("CustomColorButton"), false);
  assert.equal(source.includes("renderDefaultButton"), false);
  assert.equal(source.includes("renderCustomButton"), false);
  assert.equal(source.includes('detail.kind === "color-picker"'), false);
  assert.equal(source.includes("CustomColorPicker"), false);
  assert.equal(source.includes("suggestedColors"), false);
  assert.equal(source.includes("showEyeDropper"), false);
  assert.equal(source.includes("onChangeComplete"), false);
  assert.equal(source.includes("saturation-white"), false);
  assert.equal(source.includes("CustomColorControl"), false);
  assert.equal(source.includes("type: \"color\""), false);
  assert.equal(source.includes("input.click()"), false);
});

test("preload bridge keeps native fields and leaves button clicks to the host DOM", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("const Field = findComponent"));
  assert.ok(source.includes('h(ui.Field, { label: detail.name || "" }'));
  assert.ok(source.includes('detail.kind === "translation-preview"'));
  assert.equal(source.includes('detail.kind === "action-field"'), false);
  assert.equal(source.includes("function sendClick"), false);
  assert.equal(source.includes("dtm:control-click"), false);
  assert.ok(source.includes("function shouldHandleInboundMessage"));
  assert.ok(source.includes("__dtmMessageId"));
  assert.ok(source.includes("window.postMessage"));
  assert.equal(source.includes("dtm-action-field-control"), false);
  assert.equal(source.includes("renderSelectTrailing"), false);
  assert.equal(source.includes("ui.SingleSelect"), false);
});
