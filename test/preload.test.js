"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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

test("preload bridge searches Discord Switch with multiple native signatures", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("function findComponentAny"));
  assert.ok(source.includes("\"switchIndicator\", \"thumb\", \"data-mana-component\""));
  assert.ok(source.includes("const Switch = findComponentAny"));
});

test("preload bridge mounts Discord searchable combobox controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("ComboBoxField"));
  assert.ok(source.includes("setFloating"));
  assert.ok(source.includes("showChevronButton"));
  assert.ok(source.includes('detail.kind === "combobox"'));
  assert.ok(source.includes("function ComboBoxControl({ ui, detail, sendChange })"));
  assert.ok(source.includes("React.useEffect(() => {"));
  assert.ok(source.includes("h(ComboBoxControl, { ui, detail, sendChange })"));
  assert.equal(source.includes("ComboboxProvider"), false);
  assert.equal(source.includes("ComboboxListbox"), false);
  assert.equal(source.includes("dtm-combobox-popout"), false);
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
  assert.ok(source.includes('h(ui.Field, { label: detail.name || "", layout: "horizontal" }'));
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

test("preload bridge drives settings subnav thumb with Discord spring runtime", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes('window.addEventListener("dtm:sync-subnav-thumb"'));
  assert.ok(source.includes("function resolveSpringRuntime"));
  assert.ok(source.includes('typeof module.Controller === "function"'));
  assert.ok(source.includes('typeof module.useSpring === "function"'));
  assert.ok(source.includes("const SUBNAV_THUMB_SPRING_CONFIG = { mass: .1, friction: 20, tension: 300 }"));
  assert.ok(source.includes("new Controller({ ...target, config: SUBNAV_THUMB_SPRING_CONFIG })"));
  assert.ok(source.includes("state.controller.start({ ...target, config: SUBNAV_THUMB_SPRING_CONFIG })"));
  assert.equal(source.includes("transitionDuration"), false);
});
