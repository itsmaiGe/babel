"use strict";

const path = require("node:path");
const { ipcRenderer, webFrame } = require("electron");

const MAIN_WORLD_BRIDGE_SOURCE = String.raw`
(() => {
  if (window.__discordTranslatorMainWorldBridge) return;
  window.__discordTranslatorMainWorldBridge = true;

  const instances = [];
  const controls = new Map();
  const sectionRefresh = new Map();
  const settingsRoots = new WeakSet();
  const settingsFactories = new WeakSet();
  let settingsSpec = null;
  const handledInboundMessageIds = new Set();
  let outboundMessageId = 0;
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
        wrapSettingsFactories(modules);
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
      if (value?.[Symbol.toStringTag] === "IntlMessagesProxy") return false;
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

  let composerApi = null;
  let sendTarget = null;
  let sendId = 0;

  function resolveComposerApi() {
    if (composerApi) return composerApi;
    const require = getRequire();
    if (!require) throw new Error("Discord 输入框尚未就绪，请稍后重试。");
    const ChannelEditor = findModule(require, value => isFunctionMatchingCode(value, ["appendText", "handleInsertText", "saveCurrentText"]));
    const serialize = findModule(require, value => isFunctionMatchingCode(value, ["ignoreTrailingEmptyNodes", "preventEmojiSurrogates", ".range"]));
    const Slate = findModule(require, value => value && typeof value.toDOMNode === "function" && typeof value.focus === "function");
    const selectedChannel = findModule(require, value => value && typeof value.getChannelId === "function" && typeof value.getVoiceChannelId === "function");
    const dispatcher = findModule(require, value => value && typeof value.dispatch === "function" &&
      typeof value.subscribe === "function" && typeof value.unsubscribe === "function" && typeof value.wait === "function");
    if (!ChannelEditor || !serialize || !Slate || !selectedChannel || !dispatcher) {
      throw new Error("未能连接 Discord 原生输入框，请重启 Discord 后重试。");
    }
    dispatcher.subscribe("CHANNEL_SELECT", () => cancelSend());
    composerApi = { ChannelEditor, serialize, Slate, selectedChannel };
    return composerApi;
  }

  function currentComposer() {
    const api = resolveComposerApi();
    const dom = document.querySelector("[role='textbox'][contenteditable='true']");
    const key = dom && Object.keys(dom).find(key => key.startsWith("__reactFiber$"));
    let editor, form;
    for (let fiber = key && dom[key]; fiber; fiber = fiber.return) {
      const instance = fiber.stateNode;
      if (!editor && instance instanceof api.ChannelEditor) editor = instance;
      if (editor && instance && instance.editorRef === editor && typeof instance.handleSendMessage === "function") {
        form = instance;
        break;
      }
    }
    const handle = editor && editor.ref.current;
    const slate = handle && handle.getSlateEditor?.();
    const channelId = editor && editor.props.channel?.id;
    if (!dom?.isConnected || !form || !slate || editor.props.useSlate !== true || editor.props.disabled ||
        editor.state.submitting || slate.composition || editor.props.type.analyticsName !== "normal" ||
        api.Slate.toDOMNode(slate, slate) !== dom || api.selectedChannel.getChannelId() !== channelId ||
        form.props.channel.id !== channelId) {
      throw new Error("请先打开频道，并退出消息编辑，再使用翻译输入框。");
    }
    return { dom, editor, form, handle, slate, channelId };
  }

  function cancelSend(id) {
    if (!sendTarget || (id != null && id !== sendTarget.id)) return;
    sendTarget.slate.events.off("onChange", sendTarget.onChange);
    sendTarget = null;
  }

  function beginSend(send) {
    cancelSend();
    const target = currentComposer();
    const api = resolveComposerApi();
    const draft = api.serialize(target.slate.children, { mode: "raw" });
    if (draft.trim()) {
      throw new Error("Discord 输入框已有草稿，请先发送或清空，原文已保留。");
    }
    const id = ++sendId;
    sendTarget = { ...target, id, send: send === true, reply: target.form.props.pendingReply,
      onChange: () => {
        if (api.serialize(target.slate.children, { mode: "raw" }) !== draft) cancelSend(id);
      } };
    target.slate.events.on("onChange", sendTarget.onChange);
    return id;
  }

  function insertAndSend({ id, text }) {
    const target = sendTarget;
    if (!target || target.id !== id) throw new Error("频道或草稿已改变，原文已保留，请重新翻译。");
    cancelSend(id);
    const current = currentComposer();
    if (current.dom !== target.dom || current.editor !== target.editor || current.slate !== target.slate ||
        current.channelId !== target.channelId || current.form !== target.form || current.form.props.pendingReply !== target.reply ||
        resolveComposerApi().serialize(current.slate.children, { mode: "raw" }).trim()) {
      throw new Error("频道或草稿已改变，原文已保留，请重新翻译。");
    }
    if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回译文，原文已保留。");
    // Slate updates synchronously; its submit path reads the same editor state.
    current.handle.insertText(text, text, false);
    if (target.send) current.handle.submit();
    else current.handle.focus();
    return { ok: true, sent: target.send };
  }

  window.__discordTranslatorComposer = { beginSend, insertAndSend, cancelSend };

  let uiCache = null;
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
    const TextInput = findComponent(require, ['data-mana-component":"text-input']);
    const TextArea = findComponent(require, ['data-mana-component":"text-area']);
    const Field = findComponent(require, ["hideLabel", "helperText", "trailingAuxiliaryContent", "layoutConfig"]);
    // Keep these signatures aligned with Vencord's current Discord component map.
    const Select = findComponent(require, ['selectionMode:"single",onSelectionChange:', "isSelected:"]);
    const SearchableSelect = findComponent(require, ['?"multiple":"single",required:']);
    const Switch = findComponent(require, ["switchIconsEnabled", "hasIcon"]);
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
    if (!React || !Field || !Select || !Switch) return null;
    uiCache = {
      React,
      ReactDOM,
      TextInput,
      TextArea,
      Field,
      Select,
      SearchableSelect,
      Switch,
      Button,
      LockIcon,
      CreateToast: toastModule && toastModule.o,
      ToastTypes: toastTypesModule && toastTypesModule.Ck,
      ShowToast: toastActionsModule && toastActionsModule.P0
    };
    return uiCache;
  }

  // Register before Discord builds its settings directory, including lazy-loaded chunks.
  function wrapSettingsFactories(modules) {
    for (const [id, factory] of Object.entries(modules || {})) {
      if (typeof factory !== "function" || settingsFactories.has(factory) ||
          !Function.prototype.toString.call(factory).includes('analyticsKey:"user_settings"')) continue;
      const wrapped = function(module, exports, require) {
        factory.call(this, module, exports, require);
        const root = findExportInModule(module.exports, value => value && value.key === "$Root" && value.analyticsKey === "user_settings");
        if (root) installSettingsRoot(root, require);
      };
      settingsFactories.add(wrapped);
      modules[id] = wrapped;
    }
  }

  function watchSettingsChunks(chunks) {
    for (const chunk of chunks) wrapSettingsFactories(chunk[1]);
    let push;
    const wrapPush = next => function(...args) {
      for (const chunk of args) if (Array.isArray(chunk)) wrapSettingsFactories(chunk[1]);
      return next.apply(this, args);
    };
    push = wrapPush(chunks.push);
    Object.defineProperty(chunks, "push", {
      configurable: true,
      get: () => push,
      set: next => { push = wrapPush(next); }
    });
  }

  if (Array.isArray(window.webpackChunkdiscord_app)) watchSettingsChunks(window.webpackChunkdiscord_app);
  else Object.defineProperty(window, "webpackChunkdiscord_app", {
    configurable: true,
    get: () => undefined,
    set: chunks => {
      defineOwn(window, "webpackChunkdiscord_app", chunks);
      if (Array.isArray(chunks)) watchSettingsChunks(chunks);
    }
  });

  function installSettingsRoot(root, require) {
    if (settingsRoots.has(root)) return;
    const types = findModule(require, value => value && typeof value.SECTION === "number" &&
      typeof value.SIDEBAR_ITEM === "number" && typeof value.CATEGORY === "number" && typeof value.CUSTOM === "number");
    if (!types) return;
    const buildLayout = root.buildLayout;
    root.buildLayout = function() {
      const sections = buildLayout.call(this);
      if (!settingsSpec) return sections;
      const item = {
        key: "babel_sidebar_item", type: types.SIDEBAR_ITEM,
        useTitle: () => settingsSpec.title,
        icon: BabelIcon,
        buildLayout: () => [{
          key: "babel_panel", type: types.PANEL, useTitle: () => settingsSpec.title,
          buildLayout: () => settingsSpec.sections.map(section => ({
            key: "babel_" + section.key, type: types.CATEGORY,
            useTitle: () => section.label,
            buildLayout: () => [{
              key: "babel_" + section.key + "_controls", type: types.CUSTOM,
              Component: () => resolveUi().React.createElement(SettingsSection, { section })
            }]
          }))
        }]
      };
      return sections.map(section => {
        const items = section.buildLayout();
        const index = items.findIndex(entry => entry.key === "language_and_time_sidebar_item");
        if (index < 0) return section;
        return { ...section, buildLayout: () => [...items.slice(0, index + 1), item, ...items.slice(index + 1)] };
      });
    };
    settingsRoots.add(root);
  }

  function BabelIcon(props) {
    return resolveUi().React.createElement("svg", {
      ...props, width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
      dangerouslySetInnerHTML: { __html: settingsSpec.icon }
    });
  }

  function SettingsSection({ section }) {
    const ui = resolveUi();
    const [, update] = ui.React.useState(0);
    ui.React.useLayoutEffect(() => {
      sectionRefresh.set(section.key, () => update(value => value + 1));
      emit("dtm:settings-open", {});
      return () => {
        sectionRefresh.delete(section.key);
        for (const [id, control] of controls) if (control.section === section.key) controls.delete(id);
        if (sectionRefresh.size === 0) emit("dtm:settings-close", {});
      };
    }, [section.key]);
    const portals = Array.from(controls, ([id, control]) => control.section === section.key
      ? ui.ReactDOM.createPortal(control.element, control.host, id) : null).filter(Boolean);
    return ui.React.createElement("div", { id: "dtm-settings-slot-" + section.key, "data-dtm-section-key": section.key }, portals);
  }

  function unmountControls(detail) {
    const sections = new Set();
    for (const id of detail.ids || []) {
      const control = controls.get(id);
      if (control) sections.add(control.section);
      controls.delete(id);
    }
    for (const section of sections) sectionRefresh.get(section)?.();
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
    const options = (detail.options || []).map(formatSelectOption);
    return h(ui.Field, { label: detail.name || "" },
      h(ui.Select, {
        options,
        select: next => {
          const nextValue = normalizeSelectedValue(next);
          setValue(nextValue);
          sendChange(nextValue);
        },
        isSelected: next => next === value,
        serialize: next => String(next),
        closeOnSelect: true,
        renderOptionLabel: item => renderSelectOption(ui, item),
        renderOptionValue: items => renderSelectOption(ui, (items || []).find(item => item.value === value))
      })
    );
  }

  function formatSelectOption(item) {
    return {
      ...item,
      id: item.id || String(item.value),
      value: item.value,
      label: item.label,
      disabled: item.disabled
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

  function renderSelectOption(ui, item) {
    if (!item) return null;
    if (!item.apiKeySaved || !ui.LockIcon) return item.label;
    const h = ui.React.createElement.bind(ui.React);
    return h("span", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      h("span", null, item.label),
      providerApiKeyIcon(ui)
    );
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
      // SearchableSelect clears its transient query after selection/blur. An empty
      // query is not a valid model id and must not erase the persisted selection.
      if (!nextValue) return;
      setValue(nextValue);
      sendChange(nextValue);
    };
    // Discord's SearchableSelect can only display a value that exists in its options. A freely
    // typed value (e.g. a local model id that isn't in the preset list) would otherwise
    // vanish from the field on blur — the value is still kept, it just isn't shown. Keep
    // the current value present as an option so it stays visible. This happens inside the
    // component (no re-mount), so the caret isn't lost while typing either.
    const baseOptions = detail.options || [];
    const options = value && !baseOptions.some(option => option && option.value === value)
      ? baseOptions.concat({ id: value, value, label: value })
      : baseOptions;
    return h(ui.Field, { label: detail.name || "" },
      h(ui.SearchableSelect, {
        options,
        value: value || null,
        onChange: commit,
        onSearchChange: onQueryChange,
        closeOnSelect: true,
        maxVisibleItems: 8,
        placeholder: "输入或选择模型"
      })
    );
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
    return h(ui.Switch, { label: detail.name || "", checked: value, disabled: Boolean(detail.disabled), onChange: handleChange });
  }

  function TranslationPreviewControl({ ui, detail }) {
    if (!ui.Field) return null;
    const h = ui.React.createElement.bind(ui.React);
    return h(ui.Field, { label: detail.name || "预览" },
      h("div", null,
        h("div", { "data-dtm-style-preview-block": "true", style: detail.style }, "这是译文样式预览")
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

  function mount(detail) {
    const host = document.querySelector('[data-dtm-control-id="' + detail.id + '"]');
    if (!host) return;
    const ui = resolveUi();
    if (!ui) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: "未找到 Discord 原生 UI 组件。" });
      return;
    }

    const React = ui.React;
    const h = React.createElement.bind(React);

    function sendChange(value) {
      emit("dtm:control-change", { id: detail.id, value });
    }

    if (detail.kind === "combobox" && !ui.SearchableSelect) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: "未找到 Discord 可搜索下拉框组件。" });
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
    const section = host.closest("[data-dtm-section-key]");
    const key = section && section.dataset.dtmSectionKey;
    const refresh = sectionRefresh.get(key);
    if (!refresh) return;

    try {
      controls.set(detail.id, { element, host, section: key });
      refresh();
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
  window.addEventListener("dtm:unmount-controls", event => handleInboundMessage(event.detail, unmountControls));
  window.addEventListener("dtm:settings-config", event => handleInboundMessage(event.detail, detail => { settingsSpec = detail; }));
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
    if (data.type === "dtm:unmount-controls") handleInboundMessage(data.detail, unmountControls);
    if (data.type === "dtm:settings-config") handleInboundMessage(data.detail, detail => { settingsSpec = detail; });
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

async function callComposer(method, argument) {
  const result = await webFrame.executeJavaScript("(() => { try { return { value: window.__discordTranslatorComposer[" +
    JSON.stringify(method) + "](" + JSON.stringify(argument) + ") }; } catch (error) { return { error: String(error.message || error) }; } })()");
  if (result.error) throw new Error(result.error);
  return result.value;
}

const api = Object.freeze({
  getSettings: () => ipcRenderer.invoke("dtm:get-settings"),
  saveSettings: settings => ipcRenderer.invoke("dtm:save-settings", settings),
  getApiKeyStatus: () => ipcRenderer.invoke("dtm:get-api-key-status"),
  setApiKey: request => ipcRenderer.invoke("dtm:set-api-key", request),
  translate: request => ipcRenderer.invoke("dtm:translate", request),
  testConnection: request => ipcRenderer.invoke("dtm:test-connection", request),
  listModels: request => ipcRenderer.invoke("dtm:list-models", request),
  beginSend: send => callComposer("beginSend", send),
  insertAndSend: request => callComposer("insertAndSend", request),
  cancelSend: id => callComposer("cancelSend", id),
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
