"use strict";

const path = require("node:path");
const { ipcRenderer, webFrame } = require("electron");

const MAIN_WORLD_BRIDGE_SOURCE = String.raw`
(() => {
  if (window.__discordTranslatorMainWorldBridge) return;
  window.__discordTranslatorMainWorldBridge = true;

  const instances = [];
  const roots = new Map();
  const subnavThumbSprings = new Map();
  const handledInboundMessageIds = new Set();
  let outboundMessageId = 0;
  const SUBNAV_THUMB_SPRING_CONFIG = { mass: .1, friction: 20, tension: 300 };
  const TOAST_POSITION_BOTTOM = 1;
  function defineOwn(target, key, value, enumerable = true) {
    Object.defineProperty(target, key, { configurable: true, enumerable, writable: true, value });
  }

  function isWebpackRequire(require) {
    return typeof require === "function" && require.m && require.c && typeof require.m === "object" && typeof require.c === "object";
  }

  function isMainWebpackRequire(require) {
    return isWebpackRequire(require) && require.p === "/assets/" && typeof require.u === "function" && Object.keys(require.m).length > 500;
  }

  function scoreWebpackRequire(require) {
    return Object.keys(require.m || {}).length * 2 + Object.keys(require.c || {}).length;
  }

  function selectBestWebpackRequire() {
    const mainRequires = instances.filter(isMainWebpackRequire);
    const candidates = mainRequires.length > 0 ? mainRequires : instances.filter(isWebpackRequire);
    return candidates.slice().sort((a, b) => scoreWebpackRequire(b) - scoreWebpackRequire(a))[0] || null;
  }

  function expose() {
    window.__discordTranslatorWebpack = {
      getRequire() {
        return selectBestWebpackRequire();
      },
      getAllRequires() {
        return instances.slice();
      }
    };
  }

  function remember(require) {
    if (!isWebpackRequire(require)) return;
    if (!instances.includes(require)) instances.push(require);
    expose();
  }

  function looksLikeDiscordWebpackRequire(require) {
    return typeof require === "function" && require.m && typeof require.m === "object";
  }

  try {
    Object.defineProperty(Function.prototype, "m", {
      configurable: true,
      enumerable: false,
      set(modules) {
        defineOwn(this, "m", modules);
        const require = this;
        if (!looksLikeDiscordWebpackRequire(require)) return;
        const maybeRemember = () => remember(require);

        if (!Object.prototype.hasOwnProperty.call(require, "p")) {
          Object.defineProperty(require, "p", {
            configurable: true,
            enumerable: false,
            set(bundlePath) {
              defineOwn(require, "p", bundlePath, false);
              maybeRemember();
            }
          });
        }

        if (!Object.prototype.hasOwnProperty.call(require, "c")) {
          Object.defineProperty(require, "c", {
            configurable: true,
            enumerable: false,
            set(cache) {
              defineOwn(require, "c", cache, false);
              maybeRemember();
            }
          });
        }

        setTimeout(maybeRemember, 0);
      }
    });
  } catch (error) {
    console.error("[Babel] Failed to install main-world webpack capture:", error);
  }

  expose();

  function getRequire() {
    if (window.__discordTranslatorWebpack) {
      const captured = window.__discordTranslatorWebpack.getRequire();
      if (captured) return captured;
    }
    if (!Array.isArray(window.webpackChunkdiscord_app)) return null;
    let captured = null;
    try {
      window.webpackChunkdiscord_app.push([[Math.floor(Math.random() * 1e9)], {}, require => {
        captured = require;
      }]);
    } catch (_error) {
      captured = null;
    }
    return captured;
  }

  function stringIncludesAll(value, needles) {
    return needles.every(needle => value.includes(needle));
  }

  function safeFilter(filter, value) {
    try {
      return Boolean(filter(value));
    } catch (_error) {
      return false;
    }
  }

  function unwrapReactComponent(component) {
    let current = component;
    for (let i = 0; current && i < 4; i += 1) {
      if (typeof current === "function") return current;
      if (current.type) current = current.type;
      else if (current.render) current = current.render;
      else return null;
    }
    return null;
  }

  function isComponentMatchingCode(component, code) {
    const unwrapped = unwrapReactComponent(component);
    if (typeof unwrapped !== "function") return false;
    return stringIncludesAll(Function.prototype.toString.call(unwrapped), code);
  }

  function isFunctionMatchingCode(fn, code) {
    return typeof fn === "function" && stringIncludesAll(Function.prototype.toString.call(fn), code);
  }

  function findExportInModule(exports, filter) {
    if (!exports) return null;
    if (safeFilter(filter, exports)) return exports;
    if (typeof exports !== "object" && typeof exports !== "function") return null;
    for (const key of Object.keys(exports)) {
      let value;
      try {
        value = exports[key];
      } catch (_error) {
        continue;
      }
      if (safeFilter(filter, value)) return value;
      const unwrapped = unwrapReactComponent(value);
      if (unwrapped && safeFilter(filter, unwrapped)) return value;
    }
    return null;
  }

  function findModule(require, filter) {
    for (const moduleId of Object.keys(require.c || {})) {
      const found = findExportInModule(require.c[moduleId] && require.c[moduleId].exports, filter);
      if (found) return found;
    }
    return null;
  }

  function findDirectModule(require, filter) {
    for (const moduleId of Object.keys(require.c || {})) {
      const exports = require.c[moduleId] && require.c[moduleId].exports;
      if (safeFilter(filter, exports)) return exports;
    }
    return null;
  }

  function findModuleObject(require, filter, codeHints) {
    for (const moduleId of Object.keys(require.c || {})) {
      const exports = require.c[moduleId] && require.c[moduleId].exports;
      if (safeFilter(filter, exports)) return exports;
    }
    for (const moduleId of Object.keys(require.m || {})) {
      const factoryCode = Function.prototype.toString.call(require.m[moduleId]);
      if (codeHints && !codeHints.some(hint => factoryCode.includes(hint))) continue;
      try {
        const exports = require(moduleId);
        if (safeFilter(filter, exports)) return exports;
      } catch (_error) {}
    }
    return null;
  }

  function requireFactoryMatch(require, code) {
    if (!require.m) return null;
    for (const moduleId of Object.keys(require.m)) {
      const factoryCode = Function.prototype.toString.call(require.m[moduleId]);
      if (!stringIncludesAll(factoryCode, code)) continue;
      try {
        const exports = require(moduleId);
        const direct = findExportInModule(exports, value => isComponentMatchingCode(value, code));
        if (direct) return direct;
      } catch (_error) {}
    }
    return null;
  }

  function findComponent(require, code) {
    return findModule(require, module => isComponentMatchingCode(module, code)) || requireFactoryMatch(require, code);
  }

  function findComponentAny(require, signatures) {
    for (const signature of signatures) {
      const found = findComponent(require, signature);
      if (found) return found;
    }
    return null;
  }

  let uiCache = null;
  let springRuntimeCache = null;
  function resolveUi() {
    if (uiCache) return uiCache;
    const require = getRequire();
    if (!require || !require.c) return null;
    const React = findDirectModule(require, module => module &&
      typeof module.createElement === "function" &&
      typeof module.useState === "function" &&
      typeof module.useEffect === "function" &&
      typeof module.Component === "function" &&
      typeof module.PureComponent === "function" &&
      typeof module.createRoot !== "function");
    const ReactDOM = findDirectModule(require, module => module &&
      typeof module.createPortal === "function" &&
      typeof module.flushSync === "function" &&
      typeof module.createElement !== "function");
    const createRootModule = findDirectModule(require, module => module &&
      typeof module.createRoot === "function" &&
      Object.keys(module).length <= 3);
    const createRoot = createRootModule && createRootModule.createRoot;
    const TextInput = findComponent(require, ['data-mana-component":"text-input']);
    const TextArea = findComponent(require, ['data-mana-component":"text-area']);
    const Field = findComponent(require, ["hideLabel", "helperText", "trailingAuxiliaryContent", "layoutConfig"]);
    const Select = findComponent(require, ["selectionMode", "onSelectionChange", "maxOptionsVisible"]);
    const ComboBoxField = findComponent(require, ["setFloating", "onQueryChange", "showChevronButton", "maxOptionsVisible"]);
    const Switch = findComponentAny(require, [
      ['role:"switch"', "SWITCH_BACKGROUND_SELECTED"],
      ["switchIndicator", "thumb", "data-mana-component"],
      ['data-mana-component":"switch'],
      ["aria-checked", "role", "switch"]
    ]);
    const Checkbox = findComponent(require, ['data-toggleable-component":"checkbox']);
    const Button = findComponent(require, ['data-mana-component":"button']);
    const LockIcon = findComponent(require, ["M6 9h1V6a5 5", "clipRule"]);
    const toastModule = findModuleObject(require, exports => exports &&
      typeof exports.o === "function" &&
      isFunctionMatchingCode(exports.o, ["options", "duration", "appContext", "message", "type"]), ["duration", "appContext", "message"]);
    const toastTypesModule = findModuleObject(require, exports => exports &&
      exports.Ck &&
      exports.Ck.SUCCESS &&
      exports.Ck.FAILURE &&
      exports.Ck.MESSAGE, ["SUCCESS", "FAILURE", "MESSAGE"]);
    const toastActionsModule = findModuleObject(require, exports => exports &&
      typeof exports.P0 === "function" &&
      isFunctionMatchingCode(exports.P0, ["currentToastMap", "queuedToastsMap"]), ["currentToastMap", "queuedToastsMap"]);
    if (!React || !Field || !Select || (!Switch && !Checkbox)) return null;
    uiCache = {
      React,
      ReactDOM,
      createRoot,
      TextInput,
      TextArea,
      Field,
      Select,
      ComboBoxField,
      Switch,
      Checkbox,
      Button,
      LockIcon,
      CreateToast: toastModule && toastModule.o,
      ToastTypes: toastTypesModule && toastTypesModule.Ck,
      ShowToast: toastActionsModule && toastActionsModule.P0
    };
    return uiCache;
  }

  function resolveSpringRuntime() {
    if (springRuntimeCache) return springRuntimeCache;
    const require = getRequire();
    if (!require || !require.c) return null;
    springRuntimeCache = findDirectModule(require, module => module &&
      typeof module.Controller === "function" &&
      typeof module.SpringValue === "function" &&
      typeof module.useSpring === "function");
    return springRuntimeCache;
  }

  function findSubnavThumb(id) {
    if (!/^dtm-subnav-thumb-\d+$/.test(String(id || ""))) return null;
    return document.querySelector('[data-dtm-subnav-thumb-id="' + id + '"]');
  }

  function findSubnavThumbAnchor(thumb) {
    const track = thumb && thumb.parentElement;
    const list = track && track.parentElement;
    if (!list) return null;
    return Array.from(list.children).find(child => String(child.className || "").includes("thumbAnchor")) || null;
  }

  function subnavThumbTarget(thumb) {
    const track = thumb && thumb.parentElement;
    const anchor = findSubnavThumbAnchor(thumb);
    if (!track || !anchor) return null;
    const trackRect = track.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const unit = trackRect.width / 2 || 1;
    return {
      y: (anchorRect.y - trackRect.y) / unit,
      height: anchorRect.height / unit
    };
  }

  function formatCssPixel(value) {
    const rounded = Math.round(Number(value || 0) * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded) + "px";
  }

  function applySubnavThumbFrame(thumb, value) {
    if (!thumb || !thumb.style || !value) return;
    const y = Number(value.y || 0);
    const height = Number(value.height || 0);
    thumb.style.transform = Math.abs(y) < 0.5 ? "none" : "translate3d(0px, " + formatCssPixel(y) + ", 0px)";
    if (Number.isFinite(height) && height > 0) thumb.style.height = formatCssPixel(height);
  }

  function animateSubnavThumb(id, state) {
    if (!state || state.frame != null) return;
    const step = () => {
      const thumb = findSubnavThumb(id);
      if (!thumb) {
        state.controller.dispose();
        subnavThumbSprings.delete(id);
        return;
      }
      applySubnavThumbFrame(thumb, state.controller.get());
      if (state.controller.idle) {
        state.frame = null;
        return;
      }
      state.frame = window.requestAnimationFrame(step);
    };
    state.frame = window.requestAnimationFrame(step);
  }

  function syncSubnavThumb(detail) {
    const id = detail && detail.id;
    const thumb = findSubnavThumb(id);
    const target = subnavThumbTarget(thumb);
    if (!thumb || !target) return;

    const SpringRuntime = resolveSpringRuntime();
    const Controller = SpringRuntime && SpringRuntime.Controller;
    if (!Controller) {
      applySubnavThumbFrame(thumb, target);
      return;
    }

    let state = subnavThumbSprings.get(id);
    if (!state) {
      const controller = new Controller({ ...target, config: SUBNAV_THUMB_SPRING_CONFIG });
      state = { controller, frame: null };
      subnavThumbSprings.set(id, state);
      applySubnavThumbFrame(thumb, target);
      return;
    }

    state.controller.start({ ...target, config: SUBNAV_THUMB_SPRING_CONFIG });
    animateSubnavThumb(id, state);
  }

  function emit(name, detail) {
    outboundMessageId += 1;
    const payload = { ...detail, __dtmMessageId: "dtm-main-" + outboundMessageId };
    window.dispatchEvent(new CustomEvent(name, { detail: payload }));
    window.postMessage({ source: "dtm", type: name, detail: payload }, "*");
  }

  function shouldHandleInboundMessage(detail) {
    const id = detail && detail.__dtmMessageId;
    if (!id) return true;
    if (handledInboundMessageIds.has(id)) return false;
    handledInboundMessageIds.add(id);
    if (handledInboundMessageIds.size > 1000) handledInboundMessageIds.clear();
    return true;
  }

  function handleInboundMessage(detail, handler) {
    const payload = detail || {};
    if (!shouldHandleInboundMessage(payload)) return;
    handler(payload);
  }

  function normalizeSelectedValue(next) {
    if (Array.isArray(next)) return normalizeSelectedValue(next[0]);
    if (next instanceof Set) return normalizeSelectedValue(Array.from(next)[0]);
    if (next && typeof next === "object" && Object.prototype.hasOwnProperty.call(next, "value")) return next.value;
    return next;
  }

  function normalizeComboBoxQuery(next) {
    if (typeof next === "string") return next;
    if (next && next.target && next.target.value != null) return String(next.target.value);
    if (next && next.currentTarget && next.currentTarget.value != null) return String(next.currentTarget.value);
    if (next && Object.prototype.hasOwnProperty.call(next, "value")) return String(next.value || "");
    return "";
  }

  function SelectControl({ ui, detail, sendChange }) {
    const React = ui.React;
    const h = React.createElement.bind(React);
    const state = React.useState(detail.value);
    const value = state[0];
    const setValue = state[1];
    React.useEffect(() => {
      setValue(detail.value);
    }, [detail.value]);
    return h(ui.Select, {
      label: detail.name || "",
      options: detail.options,
      value,
      selectionMode: "single",
      fullWidth: true,
      formatOption: item => formatSelectOption(ui, item),
      onSelectionChange: next => {
        const nextValue = normalizeSelectedValue(next);
        setValue(nextValue);
        sendChange(nextValue);
      },
      serialize: next => String(next)
    });
  }

  function formatSelectOption(ui, item) {
    return {
      ...item,
      id: item.id || String(item.value),
      value: item.value,
      label: item.label,
      disabled: item.disabled,
      leading: item.leading,
      trailing: item.apiKeySaved
        ? providerApiKeyIcon(ui)
        : item.trailing
    };
  }

  function providerApiKeyIcon(ui) {
    if (!ui.LockIcon) return null;
    return ui.React.createElement(ui.LockIcon, {
      size: "xs",
      color: "currentColor",
      "aria-label": "已保存 API Key"
    });
  }

  function ComboBoxControl({ ui, detail, sendChange }) {
    const React = ui.React;
    const h = React.createElement.bind(React);
    const state = React.useState(detail.value || "");
    const value = state[0];
    const setValue = state[1];
    React.useEffect(() => {
      setValue(detail.value || "");
    }, [detail.value]);
    const commit = next => {
      const nextValue = String(normalizeSelectedValue(next) || "");
      setValue(nextValue);
      sendChange(nextValue);
    };
    const onQueryChange = next => {
      const nextValue = normalizeComboBoxQuery(next);
      setValue(nextValue);
      sendChange(nextValue);
    };
    return h(ui.ComboBoxField, {
      label: detail.name || "",
      selectionMode: "single",
      options: detail.options || [],
      value: value || null,
      onSelectionChange: commit,
      onQueryChange,
      closeOnSelect: true,
      maxOptionsVisible: 8,
      placeholder: "输入或选择模型"
    });
  }

  function TextControl({ ui, detail, sendChange }) {
    const Component = detail.kind === "text-area" ? ui.TextArea : ui.TextInput;
    if (!Component) return null;
    const React = ui.React;
    const h = React.createElement.bind(React);
    const state = React.useState(detail.value || "");
    const value = state[0];
    const setValue = state[1];
    React.useEffect(() => {
      setValue(detail.value || "");
    }, [detail.value]);
    const handleChange = next => {
      const nextValue = typeof next === "string" ? next : String(next && next.currentTarget ? next.currentTarget.value : "");
      setValue(nextValue);
      sendChange(nextValue);
    };
    return h(Component, {
      label: detail.name || "",
      type: detail.type || "text",
      value,
      placeholder: detail.placeholder || "",
      min: detail.min,
      max: detail.max,
      rows: detail.kind === "text-area" ? 5 : undefined,
      disabled: Boolean(detail.disabled),
      onChange: handleChange
    });
  }

  function ToggleControl({ ui, detail, sendChange }) {
    const React = ui.React;
    const h = React.createElement.bind(React);
    const Toggle = ui.Switch || ui.Checkbox;
    const state = React.useState(Boolean(detail.value));
    const value = state[0];
    const setValue = state[1];
    React.useEffect(() => {
      setValue(Boolean(detail.value));
    }, [detail.value]);
    const handleChange = (next, checked) => {
      const nextValue = typeof checked === "boolean"
        ? checked
        : typeof next === "boolean" ? next : Boolean(next && next.currentTarget ? next.currentTarget.checked : !value);
      setValue(nextValue);
      sendChange(nextValue);
    };
    return h(ui.Field, { label: detail.name || "", layout: "horizontal" },
      h(Toggle, { checked: value, onChange: handleChange })
    );
  }

  function TranslationPreviewControl({ ui, detail }) {
    if (!ui.Field) return null;
    const h = ui.React.createElement.bind(ui.React);
    return h(ui.Field, { label: detail.name || "预览" },
      h("div", null,
        h("div", { "data-dtm-style-preview-block": "true", style: translationPreviewStyle(detail.style || {}, false) }, "这是译文样式预览")
      )
    );
  }

  function ButtonControl({ ui, detail }) {
    if (!ui.Button) return null;
    const h = ui.React.createElement.bind(ui.React);
    return h(ui.Button, {
      text: detail.label || "",
      variant: detail.variant === "secondary" ? "secondary" : "primary",
      disabled: Boolean(detail.disabled),
      loading: Boolean(detail.loading)
    });
  }

  function translationPreviewStyle(style, isError) {
    const emphasis = style.emphasis || "none";
    const backgroundOn = style.background !== false;
    const markerBand = "linear-gradient(transparent 54%, color-mix(in srgb, currentColor 24%, transparent) 54%, color-mix(in srgb, currentColor 24%, transparent) 92%, transparent 92%)";
    return {
      display: "inline-block",
      boxSizing: "border-box",
      padding: backgroundOn ? "9px 13px" : "1px 0 0",
      border: backgroundOn ? "1px solid color-mix(in srgb, currentColor 14%, transparent)" : "1px solid transparent",
      boxShadow: backgroundOn ? "0 1px 2px rgba(0, 0, 0, .12)" : "none",
      lineHeight: "1.45",
      backgroundColor: backgroundOn ? (style.backgroundColor || "var(--background-secondary)") : "transparent",
      backgroundImage: emphasis === "marker" ? markerBand : "none",
      color: isError ? "#ffb3b8" : style.textColor || "var(--text-normal)",
      opacity: emphasis === "light" ? "0.72" : "1",
      fontWeight: emphasis === "bold" ? "700" : "400",
      borderRadius: Number(style.borderRadius || 0) + "px",
      fontFamily: style.fontFamily || "inherit",
      fontSize: Number(style.fontSize || 13) + "px",
      textDecorationLine: emphasis === "strike"
        ? "line-through"
        : (emphasis === "underline" || emphasis === "wavy") ? "underline" : "none",
      textDecorationStyle: emphasis === "wavy" ? "wavy" : "solid"
    };
  }

  function mount(detail) {
    const host = document.querySelector('[data-dtm-control-id="' + detail.id + '"]');
    if (!host) return;
    const ui = resolveUi();
    if (!ui) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: "Discord UI components were not found." });
      return;
    }

    const React = ui.React;
    const h = React.createElement.bind(React);

    function sendChange(value) {
      emit("dtm:control-change", { id: detail.id, value });
    }

    if (detail.kind === "combobox" && !ui.ComboBoxField) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: "Discord ComboBoxField was not found." });
      return;
    }

    const element = detail.kind === "combobox"
      ? h(ComboBoxControl, { ui, detail, sendChange })
      : detail.kind === "select"
      ? h(SelectControl, { ui, detail, sendChange })
      : detail.kind === "switch" ? h(ToggleControl, { ui, detail, sendChange })
        : detail.kind === "translation-preview" ? h(TranslationPreviewControl, { ui, detail })
          : detail.kind === "button" ? h(ButtonControl, { ui, detail })
            : h(TextControl, { ui, detail, sendChange });

    try {
      let root = roots.get(detail.id);
      if (!root && ui.createRoot) {
        root = ui.createRoot(host);
        roots.set(detail.id, root);
      }
      if (root && typeof root.render === "function") root.render(element);
      else if (ui.ReactDOM && typeof ui.ReactDOM.render === "function") ui.ReactDOM.render(element, host);
      else throw new Error("React renderer was not found.");
      emit("dtm:control-mounted", { id: detail.id, ok: true });
    } catch (error) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: String(error && error.message || error) });
    }
  }

  function showToast(detail) {
    const ui = resolveUi();
    if (!ui || !ui.CreateToast || !ui.ShowToast || !ui.ToastTypes) return;
    const tone = detail && detail.tone;
    const type = tone === "success"
      ? ui.ToastTypes.SUCCESS
      : tone === "failure" ? ui.ToastTypes.FAILURE : ui.ToastTypes.MESSAGE;
    try {
      ui.ShowToast(ui.CreateToast(String(detail && detail.message || ""), type, { position: TOAST_POSITION_BOTTOM }));
    } catch (_error) {}
  }

  window.addEventListener("dtm:mount-control", event => handleInboundMessage(event.detail, mount));
  window.addEventListener("dtm:show-toast", event => handleInboundMessage(event.detail, showToast));
  window.addEventListener("dtm:sync-subnav-thumb", event => handleInboundMessage(event.detail, syncSubnavThumb));
  window.addEventListener("message", event => {
    const data = event.data || {};
    if (event.source !== window || data.source !== "dtm") return;
    if (data.type === "dtm:mount-control") {
      handleInboundMessage(data.detail, mount);
      return;
    }
    if (data.type === "dtm:show-toast") {
      handleInboundMessage(data.detail, showToast);
      return;
    }
    if (data.type === "dtm:sync-subnav-thumb") handleInboundMessage(data.detail, syncSubnavThumb);
  });
})();
`;

const RUNTIME_BRIDGE_RETRY_MS = 50;
const RUNTIME_BRIDGE_MAX_ATTEMPTS = 40;
let runtimeStarted = false;

function injectMainWorldBridge() {
  let injected = false;
  try {
    if (webFrame && typeof webFrame.executeJavaScript === "function") {
      webFrame.executeJavaScript(MAIN_WORLD_BRIDGE_SOURCE).catch(error => {
        console.error("[Babel] Failed to execute main-world bridge:", error);
      });
      injected = true;
    }
  } catch (error) {
    console.error("[Babel] Failed to execute main-world bridge:", error);
  }

  try {
    const target = document.documentElement || document.head || document.body;
    if (!target) return injected;
    const script = document.createElement("script");
    script.textContent = MAIN_WORLD_BRIDGE_SOURCE;
    target.appendChild(script);
    script.remove();
    injected = true;
  } catch (error) {
    console.error("[Babel] Failed to inject main-world bridge:", error);
  }
  return injected;
}

injectMainWorldBridge();

function runOriginalPreload() {
  const arg = process.argv.find(value => value.startsWith("--dtm-original-preload="));
  if (!arg) return;

  const encoded = arg.slice("--dtm-original-preload=".length);
  const originalPreload = Buffer.from(encoded, "base64").toString("utf8");
  if (!originalPreload) return;

  try {
    require(originalPreload);
  } catch (error) {
    console.error("[Babel] Failed to run Discord preload:", error);
  }
}

runOriginalPreload();

const api = Object.freeze({
  getSettings: () => ipcRenderer.invoke("dtm:get-settings"),
  saveSettings: settings => ipcRenderer.invoke("dtm:save-settings", settings),
  getApiKeyStatus: () => ipcRenderer.invoke("dtm:get-api-key-status"),
  setApiKey: request => ipcRenderer.invoke("dtm:set-api-key", request),
  translate: request => ipcRenderer.invoke("dtm:translate", request),
  testConnection: request => ipcRenderer.invoke("dtm:test-connection", request),
  listModels: request => ipcRenderer.invoke("dtm:list-models", request),
  insertAndSend: text => ipcRenderer.invoke("dtm:insert-and-send", text),
  openSettingsFile: () => ipcRenderer.invoke("dtm:open-settings-file"),
  openExternal: url => ipcRenderer.invoke("dtm:open-external", url),
  loadCache: () => ipcRenderer.invoke("dtm:load-cache"),
  saveCache: cache => ipcRenderer.invoke("dtm:save-cache", cache),
  checkUpdate: () => ipcRenderer.invoke("dtm:check-update")
});

function startRuntime(attempt = 0) {
  if (runtimeStarted) return;
  const bridgeInjected = injectMainWorldBridge();
  if (!bridgeInjected && attempt < RUNTIME_BRIDGE_MAX_ATTEMPTS) {
    window.setTimeout(() => startRuntime(attempt + 1), RUNTIME_BRIDGE_RETRY_MS);
    return;
  }

  runtimeStarted = true;
  try {
    require(path.join(__dirname, "renderer.js")).start(api);
  } catch (error) {
    console.error("[Babel] Failed to start renderer runtime:", error);
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startRuntime, { once: true });
} else {
  startRuntime();
}
