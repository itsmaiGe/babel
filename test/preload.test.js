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
      configureSettings,
      setUi: value => { resolveUi = () => value; },
      setComposerApi: value => { composerApi = value; },
      findModule,
      controls, sectionRefresh,
      showToast, resolveToast,
      acceptMessageId, handledInboundMessages,
      renderSelectOption, StatusControl, ButtonControl
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
  bridge.configure({ title: "Babel", sections: ["general", "model", "read", "style"].map(key => ({ key, label: key })), icon: "" });
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
  assert.deepEqual(Array.from(panel.buildLayout(), node => node.key), ["babel_general", "babel_model", "babel_read", "babel_style"]);
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
    Field() {}, Select() {}, Switch() {}, Button() {},
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
    assert.throws(() => composer.insertAndSend({ id, text: "Duplicate" }), error => error.code === "COMPOSER_CHANGED");
  });
}

test("native composer preserves existing drafts before translation begins", () => {
  const composer = composerHarness();
  composer.slate.children = [{ text: "Existing draft" }];
  assert.throws(() => composer.beginSend(true), error => error.code === "COMPOSER_DRAFT_NOT_EMPTY");
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

test("composer calls preserve typed errors across the Electron execution boundary", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");
  const code = source.slice(source.indexOf("async function callComposer("), source.indexOf("const api = Object.freeze("));
  const context = {
    sanitizeError: require("../src/mod/core/errors").sanitizeError,
    webFrame: { executeJavaScript: async code => vm.runInNewContext(code, {
      window: { __discordTranslatorComposer: {
        beginSend: () => { throw Object.assign(new Error("sensitive diagnostic"), { code: "COMPOSER_DRAFT_NOT_EMPTY" }); },
        insertAndSend: request => request.text
      } }
    }) }
  };
  vm.runInNewContext(code, context);
  await assert.rejects(context.callComposer("beginSend", true), error => error.code === "COMPOSER_DRAFT_NOT_EMPTY");
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

test("preload injects the main-world bridge before a single runtime start", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("if (runtimeStarted) return;"));
  assert.ok(source.includes("const bridgeInjected = injectMainWorldBridge();") === false);
  assert.ok(source.includes("if (!target) return injected;"));
  const runtime = source.indexOf("function startRuntime");
  assert.ok(runtime > 0);
  assert.ok(source.indexOf("injectMainWorldBridge();", runtime) < source.indexOf('require(path.join(__dirname, "renderer.js")).start(api);'));
  // The startup path is one shot: the dead attempt/retry timer branch is gone.
  assert.ok(source.includes("RUNTIME_BRIDGE_MAX_ATTEMPTS") === false);
  assert.ok(source.includes("RUNTIME_BRIDGE_RETRY_MS") === false);
  assert.ok(source.includes("startRuntime(attempt") === false);
});

test("preload exposes listModels IPC to the renderer", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.match(source, /listModels:\s*\(?request\)?\s*=>\s*ipcRenderer.invoke\("dtm:list-models", request\)/);
  assert.match(source, /getApiKeyStatus:\s*\(request\)\s*=>\s*ipcRenderer.invoke\("dtm:get-api-key-status", request\)/);
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

  assert.ok(source.includes('capability("Field", () => findComponent'));
  assert.ok(source.includes("function StatusControl"));
  assert.ok(source.includes("h(StatusControl, { ui, detail })"));
  assert.ok(source.includes("errorMessage: text"));
  assert.ok(source.includes("hideLabel: true, helperText: text"));
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

test("settings registration waits for validated locale config and category titles read the latest labels",()=>{
 const bridge=bridgeHarness(),language={key:"language_and_time_sidebar_item"},section={buildLayout:()=>[language]},root={key:"$Root",analyticsKey:"user_settings",buildLayout:()=>[section]};
 const types={SECTION:1,SIDEBAR_ITEM:2,PANEL:3,CATEGORY:5,CUSTOM:19},require=Object.assign(()=>{},{c:{types:{exports:{types}}}});
 bridge.installSettingsRoot(root,require);assert.equal(root.buildLayout()[0].buildLayout().length,1);
 const config=(locale,label)=>({title:"Babel",locale,sections:["general","model","read","style"].map(key=>({key,label:label+key})),icon:'<path d="M10 4h4l1 2.6H9z"/>',unavailable:"Unavailable",savedKeyLabel:"Saved"});
 bridge.window.dispatchEvent(new bridge.window.CustomEvent("dtm:settings-config",{detail:config("en","EN ")}));
 const panel=root.buildLayout()[0].buildLayout()[1].buildLayout()[0],category=panel.buildLayout()[0];assert.equal(category.useTitle(),"EN general");
 bridge.window.dispatchEvent(new bridge.window.CustomEvent("dtm:settings-config",{detail:config("ja","JA ")}));assert.equal(category.useTitle(),"JA general");
 bridge.window.dispatchEvent(new bridge.window.CustomEvent("dtm:settings-config",{detail:config("xx","INVALID ")}));assert.equal(category.useTitle(),"JA general");
});
test("bridge text-only updates keep portal identity, controlled values, and component type",()=>{
 const bridge=bridgeHarness(),ui={Field(){},Select(){},Switch(){},Button(){},TextInput(){},React:{createElement:(type,props,...children)=>({type,props,children}),useState:value=>[value,()=>{}],useLayoutEffect(){}},ReactDOM:{createPortal(){}}};
 bridge.setUi(ui);const host={closest:()=>({dataset:{dtmSectionKey:"model"}})};bridge.document.querySelector=()=>host;bridge.sectionRefresh.set("model",()=>{});
 bridge.mount({id:"dtm-control-1",kind:"text-input",type:"password",name:"API Key",value:"test-only-typed",placeholder:"EN"});
 const before=bridge.controls.get("dtm-control-1");
 bridge.mount({id:"dtm-control-1",textOnly:true,name:"API Key",placeholder:"JA",value:"must-be-ignored",type:"text"});
 const after=bridge.controls.get("dtm-control-1");assert.equal(after.host,before.host);assert.equal(after.element.type,before.element.type);assert.equal(after.detail.value,"test-only-typed");assert.equal(after.detail.type,"password");assert.equal(after.detail.placeholder,"JA");assert.equal(after.element.props.sendChange,before.element.props.sendChange);
 bridge.mount({id:"dtm-control-2",kind:"status",helperText:"EN",tone:"default",live:"polite",role:"status"});bridge.mount({id:"dtm-control-2",textOnly:true,helperText:"JA",tone:"critical",live:"assertive",role:"alert"});const status=bridge.controls.get("dtm-control-2");assert.equal(status.element.props.helperText,"JA");assert.equal(status.detail.tone,"critical");assert.equal(status.detail.live,"assertive");assert.equal(status.detail.role,"alert");
});

test("select swatches and status tones use the native slots", () => {
  const bridge = bridgeHarness();
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const ui = { React: { createElement: h }, Field() {}, LockIcon() {} };
  assert.equal(bridge.renderSelectOption(ui, { label: "red", swatch: "red" }), "red");
  assert.equal(bridge.renderSelectOption(ui, { label: "#abc", swatch: "#abc" }), "#abc");
  const auto = bridge.renderSelectOption(ui, { label: "Automatic", swatch: "auto" });
  assert.equal(auto.props.style.gap, "8px");
  assert.equal(auto.children[0].props["aria-hidden"], "true");
  assert.equal(auto.children[0].props.style.background, "transparent");
  assert.match(auto.children[0].props.style.outline, /dashed/);
  const hex = bridge.renderSelectOption(ui, { label: "#AABBCC", swatch: "#aabbcc" });
  const outer = hex.children[0];
  const inner = outer.children[0];
  assert.equal(outer.props.style.width, "16px");
  assert.equal(outer.props.style.outline, "1px solid currentColor");
  assert.equal(inner.props.style.background, "#AABBCC");
  assert.equal(inner.props.style.forcedColorAdjust, "none");
  assert.match(inner.props.style.boxShadow, /currentColor 28%/);
  function FieldWithError() { return "errorMessage"; }
  const critical = bridge.StatusControl({ ui: { ...ui, Field: FieldWithError, React: ui.React }, detail: { helperText: "Failed", tone: "critical", live: "assertive", role: "alert" } });
  assert.equal(critical.type, "div");
  assert.equal(critical.props.role, "alert");
  assert.equal(critical.props["aria-live"], "assertive");
  assert.equal(critical.children[0].type, FieldWithError);
  assert.equal(critical.children[0].props.errorMessage, "Failed");
  assert.equal(critical.children[0].props.helperText, undefined);
  assert.equal(critical.children[0].props.role, undefined);
  assert.equal(critical.children[0].children.length, 0);
  bridge.window.getComputedStyle = () => ({ getPropertyValue: (name) => name === "--text-danger" ? "rgb(1, 2, 3)" : "" });
  bridge.document.documentElement = {};
  function PlainField() { return null; }
  const colored = bridge.StatusControl({ ui: { ...ui, Field: PlainField, React: ui.React }, detail: { helperText: "Check", tone: "critical" } });
  assert.equal(colored.type, "div");
  assert.equal(colored.props.role, "alert");
  assert.equal(colored.props.style.color, "var(--text-danger)");
  assert.equal(colored.children[0].type, PlainField);
  assert.equal(colored.children[0].props.helperText, "Check");
  assert.equal(colored.children[0].props.role, undefined);
  assert.equal(colored.children[0].children.length, 0);
});

test("named colors and the update button reuse the native select and button", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");
  assert.match(source, /renderOptionLabel: item => renderSelectOption\(ui, item\)/);
  assert.match(source, /renderOptionValue: items => renderSelectOption\(ui, \(items \|\| \[\]\)\.find/);
  const bridge = bridgeHarness();
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const ui = { React: { createElement: h }, Button() {}, Field() {} };
  const named = bridge.renderSelectOption(ui, { label: "Slate", swatch: "#303446" });
  assert.equal(named.children[1].children[0], "Slate");
  assert.equal(named.children[0].children[0].props.style.background, "#303446");
  const checking = bridge.ButtonControl({ ui, detail: { label: "检查中…", variant: "secondary", loading: true, busy: true, live: "polite" } });
  assert.equal(checking.type, ui.Button);
  assert.equal(checking.props.text, "检查中…");
  assert.equal(checking.props.loading, true);
  assert.equal(checking.props.disabled, false);
  assert.equal(checking.props["aria-label"], "检查中…");
  assert.equal(checking.props["aria-live"], undefined);
  assert.equal(checking.props["aria-busy"], undefined);
  const idle = bridge.ButtonControl({ ui, detail: { label: "检查更新", variant: "secondary", busy: true, live: "polite" } });
  assert.equal(idle.props.loading, false);
  assert.equal(idle.props["aria-label"], "检查更新");
  assert.equal(idle.props["aria-live"], undefined);
  assert.equal(idle.props["aria-busy"], undefined);
});

test("status control renders one message through memo and forwardRef fields", () => {
  const bridge = bridgeHarness();
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  function reactText(node) {
    if (node == null || node === false || node === true) return [];
    if (typeof node === "string" || typeof node === "number") return [String(node)];
    if (Array.isArray(node)) return node.flatMap(reactText);
    if (typeof node !== "object") return [];
    let type = node.type;
    for (let depth = 0; type && typeof type !== "function" && depth < 4; depth += 1) type = type.type || type.render || null;
    const children = node.children || [];
    if (typeof type === "function") {
      const props = { ...(node.props || {}) };
      if (children.length === 1) props.children = children[0];
      else if (children.length > 1) props.children = children;
      return reactText(type(props));
    }
    return reactText(children);
  }
  // A Discord field paints helper text, an error, and children. One source string must not appear twice.
  function HelperField(props) {
    const nested = props.children == null ? [] : [].concat(props.children);
    return h("div", null, props.helperText || null, ...nested);
  }
  function ErrorField(props) {
    const nested = props.children == null ? [] : [].concat(props.children);
    return h("div", null, props.errorMessage || null, props.helperText || null, ...nested);
  }
  const ui = { React: { createElement: h } };
  assert.throws(() => Function.prototype.toString.call({ type: HelperField }));
  assert.throws(() => Function.prototype.toString.call({ render: ErrorField }));
  const memo = { type: HelperField };
  const saved = bridge.StatusControl({ ui: { ...ui, Field: memo }, detail: { helperText: "Saved", tone: "default", live: "polite", role: "status" } });
  assert.equal(saved.type, "div");
  assert.equal(saved.props.role, "status");
  assert.equal(saved.props["aria-live"], "polite");
  assert.equal(saved.children[0].type, memo);
  assert.deepEqual(reactText(saved), ["Saved"]);
  const translated = bridge.StatusControl({ ui: { ...ui, Field: memo }, detail: { helperText: "保存しました", tone: "default", live: "polite", role: "status" } });
  assert.deepEqual(reactText(translated), ["保存しました"]);
  bridge.window.getComputedStyle = () => ({ getPropertyValue: (name) => name === "--text-warning" ? "rgb(4, 5, 6)" : "" });
  bridge.document.documentElement = {};
  const forward = { render: HelperField };
  const warning = bridge.StatusControl({ ui: { ...ui, Field: forward }, detail: { helperText: "Careful", tone: "warning" } });
  assert.equal(warning.children[0].type, forward);
  assert.equal(warning.props.role, "status");
  assert.equal(warning.props["aria-live"], "polite");
  assert.equal(warning.props.style.color, "var(--text-warning)");
  assert.equal(warning.children[0].props.role, undefined);
  assert.deepEqual(reactText(warning), ["Careful"]);
  const wrapped = { type: { render: ErrorField } };
  const failed = bridge.StatusControl({ ui: { ...ui, Field: wrapped }, detail: { helperText: "Failed", tone: "critical", live: "assertive", role: "alert" } });
  assert.equal(failed.children[0].type, wrapped);
  assert.equal(failed.children[0].props.errorMessage, "Failed");
  assert.equal(failed.children[0].props.helperText, undefined);
  assert.equal(failed.props.role, "alert");
  assert.equal(failed.props["aria-live"], "assertive");
  assert.equal(failed.props.style, null);
  assert.deepEqual(reactText(failed), ["Failed"]);
});

test("toast discovery searches initialized exports only and backs off after a miss", () => {
  const bridge = bridgeHarness();
  let executed = 0;
  let scans = 0;
  const factories = {};
  for (let i = 0; i < 1000; i++) factories[i] = function messageFactory() { executed++; };
  const require = id => { executed++; return factories[id](); };
  Object.defineProperty(require, "c", { get() { scans++; return { unrelated: { exports: { note: "message" } } }; } });
  require.m = factories;
  bridge.window.__discordTranslatorWebpack = { getRequire: () => require };
  assert.equal(bridge.showToast({ message: "first", tone: "success" }), undefined);
  assert.equal(bridge.showToast({ message: "second", tone: "failure" }), undefined);
  assert.equal(scans, 1);
  assert.equal(executed, 0);
});

test("delayed duplicate bridge messages do not repeat preload handler effects", () => {
  const bridge = bridgeHarness();
  let shown = 0;
  function createToast(message, type, options) {
    return { message, type, options, duration: options && options.duration, appContext: true };
  }
  function publishToast(toast) {
    shown += 1;
    return toast && (toast.currentToastMap || toast.queuedToastsMap);
  }
  const cache = {
    maker: { exports: { build: createToast } },
    kinds: { exports: { labels: { SUCCESS: "ok", FAILURE: "bad", MESSAGE: "note" } } },
    actions: { exports: { publish: publishToast } },
  };
  const require = () => ({});
  Object.defineProperty(require, "c", { get: () => cache });
  bridge.window.__discordTranslatorWebpack = { getRequire: () => require };
  const deliver = (messageId, transport) => {
    const detail = { message: "Saved", tone: "success", __dtmMessageId: "dtm-renderer-" + messageId };
    if (transport === "event") {
      bridge.window.dispatchEvent(new bridge.window.CustomEvent("dtm:show-toast", { detail }));
      return;
    }
    bridge.window.dispatchEvent({
      type: "message",
      source: bridge.window,
      data: { source: "dtm", type: "dtm:show-toast", detail },
    });
  };
  deliver(1, "event");
  deliver(1, "message");
  assert.equal(shown, 1);
  for (let messageId = 2; messageId <= 1001; messageId += 1) deliver(messageId, "event");
  const afterBoundary = shown;
  deliver(1001, "message");
  deliver(1, "message");
  assert.equal(shown, afterBoundary);
  assert.equal(shown, 1001);
  deliver(500, "message");
  assert.equal(shown, 1001);
});

test("preload bridge rejects malformed ids and still delivers in-window messages once", () => {
  const bridge = bridgeHarness();
  let shown = 0;
  function createToast(message, type, options) {
    return { message, type, options, duration: options && options.duration, appContext: true };
  }
  function publishToast(toast) {
    shown += 1;
    return toast && (toast.currentToastMap || toast.queuedToastsMap);
  }
  const cache = {
    maker: { exports: { build: createToast } },
    kinds: { exports: { labels: { SUCCESS: "ok", FAILURE: "bad", MESSAGE: "note" } } },
    actions: { exports: { publish: publishToast } },
  };
  const require = () => ({});
  Object.defineProperty(require, "c", { get: () => cache });
  bridge.window.__discordTranslatorWebpack = { getRequire: () => require };
  const deliver = (messageId, transport) => {
    const detail = { message: "Saved", tone: "success", __dtmMessageId: messageId };
    if (transport === "event") {
      bridge.window.dispatchEvent(new bridge.window.CustomEvent("dtm:show-toast", { detail }));
      return;
    }
    bridge.window.dispatchEvent({
      type: "message",
      source: bridge.window,
      data: { source: "dtm", type: "dtm:show-toast", detail },
    });
  };
  for (const messageId of ["dtm-main-1", "dtm-renderer-01", "dtm-renderer-1.0", "dtm-renderer-1e2", "dtm-renderer- 1", "dtm-renderer-+1", "legacy-or-invalid-1"]) {
    deliver(messageId, "event");
    deliver(messageId, "message");
  }
  assert.equal(shown, 0);
  for (let n = 1; n <= 5000; n += 1) {
    assert.equal(bridge.acceptMessageId(bridge.handledInboundMessages, "legacy-or-invalid-" + n), false);
    assert.equal(bridge.acceptMessageId(bridge.handledInboundMessages, new String("dtm-renderer-1")), false);
  }
  assert.equal(bridge.handledInboundMessages.ids.size, 0);
  deliver(new String("dtm-renderer-1"), "event");
  assert.equal(shown, 0);
  assert.equal(bridge.handledInboundMessages.highest, 0);
  deliver("dtm-renderer-5", "event");
  deliver("dtm-renderer-3", "message");
  deliver("dtm-renderer-4", "event");
  deliver("dtm-renderer-3", "message");
  deliver("dtm-renderer-5", "event");
  assert.equal(shown, 3);
  deliver("dtm-renderer-1", "message");
  assert.equal(shown, 4);
  for (let messageId = 6; messageId <= 1005; messageId += 1) {
    if (messageId === 800) continue;
    deliver("dtm-renderer-" + messageId, "event");
  }
  const beforeGap = shown;
  deliver("dtm-renderer-800", "message");
  deliver("dtm-renderer-800", "event");
  assert.equal(shown, beforeGap + 1);
});

test("toast discovery uses API shape from initialized modules and then caches it", () => {
  const bridge = bridgeHarness();
  let executed = 0;
  let scans = 0;
  let shown = null;
  function createToast(message, type, options) {
    return { message, type, options, duration: options && options.duration, appContext: true };
  }
  function publishToast(toast) {
    shown = toast;
    return toast && (toast.currentToastMap || toast.queuedToastsMap);
  }
  const cache = {
    maker: { exports: { build: createToast } },
    kinds: { exports: { labels: { SUCCESS: "ok", FAILURE: "bad", MESSAGE: "note" } } },
    actions: { exports: { publish: publishToast } }
  };
  const require = () => { executed++; return {}; };
  Object.defineProperty(require, "c", { get() { scans++; return cache; } });
  require.m = { pending: function messageFactory() { executed++; } };
  bridge.window.__discordTranslatorWebpack = { getRequire: () => require };
  bridge.showToast({ message: "Saved", tone: "success" });
  bridge.showToast({ message: "Again", tone: "failure" });
  assert.equal(executed, 0);
  assert.equal(scans, 1);
  assert.equal(shown.message, "Again");
  assert.equal(shown.type, "bad");
  assert.equal(shown.options.position, 1);
});

test("toast discovery accepts a numeric enum and skips throwing export getters", () => {
  const bridge = bridgeHarness();
  let executed = 0;
  let shown = null;
  function createToast(message, type, options) {
    return { message, type, options, duration: 1, appContext: true };
  }
  function publishToast(toast) {
    shown = toast;
    return toast.currentToastMap || toast.queuedToastsMap;
  }
  const noisy = {};
  Object.defineProperty(noisy, "boom", { enumerable: true, get() { throw new Error("unrelated export"); } });
  const cache = {
    broken: { exports: noisy },
    maker: { exports: { build: createToast } },
    kinds: { exports: { labels: { SUCCESS: 0, FAILURE: 1, MESSAGE: 2 } } },
    actions: { exports: { publish: publishToast } }
  };
  const require = () => { executed++; return {}; };
  Object.defineProperty(require, "c", { get() { return cache; } });
  require.m = { pending: function messageFactory() { executed++; } };
  bridge.window.__discordTranslatorWebpack = { getRequire: () => require };
  assert.equal(bridge.showToast({ message: "Saved", tone: "success" }), undefined);
  assert.equal(executed, 0);
  assert.equal(shown.type, 0);
  assert.equal(shown.message, "Saved");
});
