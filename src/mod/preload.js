"use strict";

const path = require("node:path");
const { ipcRenderer, webFrame } = require("electron");

const { UI_LOCALES } = require("./shared-loader")("ui-locale");
const { sanitizeError } = require("./core/errors");
const localeArgument = process.argv.find(value => value.startsWith("--dtm-ui-locale="))?.slice("--dtm-ui-locale=".length);
const uiSystemLocale = UI_LOCALES.includes(localeArgument) ? localeArgument : "en";

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
  function bridgeFailure(code, reason) { return Object.assign(new Error(code), { code, ...(reason ? { reason } : {}) }); }
  function configureSettings(detail) {
    if (!detail || !["en", "zh-Hans", "zh-Hant", "ja"].includes(detail.locale) || detail.title !== "Babel" ||
        !Array.isArray(detail.sections) || detail.sections.length !== 4 || !detail.sections.every((item, index) => item.key === ["general", "model", "read", "style"][index] && typeof item.label === "string" && item.label.length <= 200) ||
        typeof detail.unavailable !== "string" || detail.unavailable.length > 1000 || typeof detail.savedKeyLabel !== "string" || detail.savedKeyLabel.length > 200 ||
        typeof detail.icon !== "string" || detail.icon.length > 2000 || !/^(?:<path d="[0-9MmLlHhVvCcQqSsTtAaZz.,\s-]+"\/>)+$/.test(detail.icon)) return;
    settingsSpec = detail;
    for (const refresh of sectionRefresh.values()) refresh();
  }
  const handledInboundMessages = { ids: new Set(), highest: 0, floor: 0 };
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
    if (!require) throw bridgeFailure("COMPOSER_UNAVAILABLE");
    const ChannelEditor = capability("composer:ChannelEditor", () => findModule(require, value => isFunctionMatchingCode(value, ["appendText", "handleInsertText", "saveCurrentText"])));
    const serialize = capability("composer:serialize", () => findModule(require, value => isFunctionMatchingCode(value, ["ignoreTrailingEmptyNodes", "preventEmojiSurrogates", ".range"])));
    const Slate = capability("composer:Slate", () => findModule(require, value => value && typeof value.toDOMNode === "function" && typeof value.focus === "function"));
    const selectedChannel = capability("composer:selectedChannel", () => findModule(require, value => value && typeof value.getChannelId === "function" && typeof value.getVoiceChannelId === "function"));
    const dispatcher = capability("composer:dispatcher", () => findModule(require, value => value && typeof value.dispatch === "function" &&
      typeof value.subscribe === "function" && typeof value.unsubscribe === "function" && typeof value.wait === "function"));
    if (!ChannelEditor || !serialize || !Slate || !selectedChannel || !dispatcher) {
      throw bridgeFailure("COMPOSER_UNAVAILABLE");
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
      throw bridgeFailure("COMPOSER_UNSUPPORTED");
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
      throw bridgeFailure("COMPOSER_DRAFT_NOT_EMPTY");
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
    if (!target || target.id !== id) throw bridgeFailure("COMPOSER_CHANGED");
    cancelSend(id);
    const current = currentComposer();
    if (current.dom !== target.dom || current.editor !== target.editor || current.slate !== target.slate ||
        current.channelId !== target.channelId || current.form !== target.form || current.form.props.pendingReply !== target.reply ||
        resolveComposerApi().serialize(current.slate.children, { mode: "raw" }).trim()) {
      throw bridgeFailure("COMPOSER_CHANGED");
    }
    if (typeof text !== "string" || !text.trim()) throw bridgeFailure("NETWORK", "EMPTY_RESPONSE");
    // Slate updates synchronously; its submit path reads the same editor state.
    current.handle.insertText(text, text, false);
    if (target.send) current.handle.submit();
    else current.handle.focus();
    return { ok: true, sent: target.send };
  }

  window.__discordTranslatorComposer = { beginSend, insertAndSend, cancelSend };

  const capabilityCache=new Map();let capabilityEpoch=0;
  function capability(name,resolve){const previous=capabilityCache.get(name),now=Date.now();if(previous?.value)return previous.value;
    if(previous && (previous.epoch===capabilityEpoch&&(previous.attempts>=20||now<previous.next)))return null;
    const value=resolve();capabilityCache.set(name,{value,attempts:(previous?.epoch===capabilityEpoch?previous.attempts:0)+1,epoch:capabilityEpoch,next:now+Math.min(5000,100*Math.pow(2,previous?.attempts||0))});return value;}
  function settingsReady(ui){return Boolean(ui?.React&&ui.ReactDOM?.createPortal&&ui.Field&&ui.Select&&ui.Switch&&ui.Button);}

  function resolveUi() {
    const require = getRequire();
    if (!require || !require.c) return null;
    const React = capability("React", () => findDirectModule(require, module => module &&
      typeof module.createElement === "function" &&
      typeof module.useState === "function" &&
      typeof module.useEffect === "function" &&
      typeof module.Component === "function" &&
      typeof module.PureComponent === "function" &&
      typeof module.createRoot !== "function"));
    const ReactDOM = capability("ReactDOM", () => findDirectModule(require, module => module &&
      typeof module.createPortal === "function" &&
      typeof module.flushSync === "function" &&
      typeof module.createElement !== "function"));
    const TextInput = capability("TextInput", () => findComponent(require, ['data-mana-component":"text-input']));
    const TextArea = capability("TextArea", () => findComponent(require, ['data-mana-component":"text-area']));
    const Field = capability("Field", () => findComponent(require, ["hideLabel", "helperText", "trailingAuxiliaryContent", "layoutConfig"]));
    // Keep these signatures aligned with Vencord's current Discord component map.
    const Select = capability("Select", () => findComponent(require, ['selectionMode:"single",onSelectionChange:', "isSelected:"]));
    const SearchableSelect = capability("SearchableSelect", () => findComponent(require, ['?"multiple":"single",required:']));
    const Switch = capability("Switch", () => findComponent(require, ["switchIconsEnabled", "hasIcon"]));
    const Button = capability("Button", () => findComponent(require, ['data-mana-component":"button']));
    const LockIcon = capability("LockIcon", () => findComponent(require, ["M6 9h1V6a5 5", "clipRule"]));
    return {
      React,
      ReactDOM,
      TextInput,
      TextArea,
      Field,
      Select,
      SearchableSelect,
      Switch,
      Button,
      LockIcon
    };
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
      for (const chunk of args) if (Array.isArray(chunk)) { capabilityEpoch++;wrapSettingsFactories(chunk[1]); }
      const result=next.apply(this, args);
      for(const refresh of sectionRefresh.values())refresh();
      return result;
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
            useTitle: () => settingsSpec.sections.find(item => item.key === section.key)?.label || settingsSpec.unavailable,
            buildLayout: () => [{
              key: "babel_" + section.key + "_controls", type: types.CUSTOM,
              Component: () => {const ui=resolveUi();return ui?.React?ui.React.createElement(SettingsSection,{section}):null;}
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
    const ui=resolveUi();if(!ui?.React)return null;
    return ui.React.createElement("svg", {
      ...props, width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
      dangerouslySetInnerHTML: { __html: settingsSpec.icon }
    });
  }

  function SettingsSection({ section }) {
    const ui = resolveUi();
    if(!ui?.React)return null;
    const [, update] = ui.React.useState(0);
    ui.React.useLayoutEffect(() => {
      sectionRefresh.set(section.key, () => update(value => value + 1));
      emit("dtm:settings-open", {key:section.key});
      return () => {
        sectionRefresh.delete(section.key);
        for (const [id, control] of controls) if (control.section === section.key) controls.delete(id);
        if (sectionRefresh.size === 0) emit("dtm:settings-close", {});
      };
    }, [section.key]);
    if(!settingsReady(ui))return ui.React.createElement(ui.Field||"div",ui.Field?{hideLabel:true,helperText:settingsSpec?.unavailable || ""}:{role:"status"},ui.Field?null:settingsSpec?.unavailable || "");
    const portals = Array.from(controls, ([id, control]) => control.section === section.key
      ? ui.ReactDOM.createPortal(control.element, control.host, id) : null).filter(Boolean);
    return ui.React.createElement("div", { id: "dtm-settings-slot-" + section.key, "data-dtm-section-key": section.key, lang: settingsSpec?.locale }, portals);
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

  function messageSequence(id) {
    // Renderer sends a primitive canonical dtm-renderer-<positive decimal>.
    // Boxed strings compare by identity, so they are rejected before coercion.
    if (typeof id !== "string") return null;
    const text = id;
    const prefix = "dtm-renderer-";
    const suffix = text.slice(prefix.length);
    if (text.slice(0, prefix.length) !== prefix || !/^[1-9][0-9]*$/.test(suffix)) return null;
    const value = Number(suffix);
    return Number.isSafeInteger(value) ? value : null;
  }
  function acceptMessageId(state, id) {
    const sequence = messageSequence(id);
    if (sequence == null) return false;
    if (state.ids.has(id) || (state.floor && sequence <= state.floor)) return false;
    state.ids.add(id);
    if (sequence > state.highest) state.highest = sequence;
    if (state.ids.size > 1000) {
      state.floor = state.highest - 1000;
      state.ids.forEach(function (seen) {
        const seenSequence = messageSequence(seen);
        if (seenSequence != null && seenSequence <= state.floor) state.ids.delete(seen);
      });
    }
    return true;
  }
  function shouldHandleInboundMessage(detail) {
    const id = detail && detail.__dtmMessageId;
    if (!id) return true;
    return acceptMessageId(handledInboundMessages, id);
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

  function providerApiKeyIcon(ui, label) {
    if (!ui.LockIcon) return null;
    return ui.React.createElement(ui.LockIcon, {
      size: "xs",
      color: "currentColor",
      "aria-label": label || settingsSpec?.savedKeyLabel || ""
    });
  }

  function acceptedSwatch(value) {
    const text = String(value || "").trim();
    if (/^auto$/i.test(text)) return "auto";
    const match = /^#([0-9a-fA-F]{6})$/.exec(text);
    return match ? "#" + match[1].toUpperCase() : "";
  }

  function swatchNode(ui, swatch) {
    const h = ui.React.createElement.bind(ui.React);
    if (swatch === "auto") {
      return h("span", {
        "aria-hidden": "true",
        style: {
          width: "16px",
          height: "16px",
          flex: "none",
          boxSizing: "border-box",
          background: "transparent",
          borderRadius: "4px",
          outline: "1px dashed color-mix(in srgb, currentColor 55%, transparent)",
          outlineOffset: "-1px"
        }
      });
    }
    // High contrast keeps the hex fill; the outer outline stays in currentColor.
    return h("span", {
      "aria-hidden": "true",
      style: {
        width: "16px",
        height: "16px",
        flex: "none",
        boxSizing: "border-box",
        borderRadius: "4px",
        outline: "1px solid currentColor",
        display: "flex"
      }
    }, h("span", {
      style: {
        width: "100%",
        height: "100%",
        borderRadius: "4px",
        background: swatch,
        forcedColorAdjust: "none",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, currentColor 28%, transparent)"
      }
    }));
  }

  function renderSelectOption(ui, item) {
    if (!item) return null;
    const swatch = acceptedSwatch(item.swatch);
    const icon = item.apiKeySaved && ui.LockIcon ? providerApiKeyIcon(ui, item.savedKeyLabel) : null;
    if (!swatch && !icon) return item.label;
    const h = ui.React.createElement.bind(ui.React);
    return h("span", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      swatch ? swatchNode(ui, swatch) : null,
      h("span", null, item.label),
      icon
    );
  }

  function statusToken(tone) {
    if (tone !== "critical" && tone !== "warning") return "";
    const names = tone === "critical" ? ["--text-feedback-critical", "--text-danger"] : ["--text-feedback-warning", "--text-warning"];
    let probe = null;
    try {
      const root = document && document.documentElement;
      if (root && typeof window.getComputedStyle === "function") probe = window.getComputedStyle(root);
    } catch (_error) {
      probe = null;
    }
    if (probe && typeof probe.getPropertyValue === "function") {
      for (let index = 0; index < names.length; index++) {
        const value = String(probe.getPropertyValue(names[index]) || "").trim();
        if (value) return "var(" + names[index] + ")";
      }
    }
    return "currentColor";
  }

  function StatusControl({ ui, detail }) {
    if (!ui.Field) return null;
    const h = ui.React.createElement.bind(ui.React);
    const text = detail.helperText || "";
    const tone = detail.tone || "default";
    const live = detail.live || (tone === "critical" ? "assertive" : "polite");
    const role = detail.role || (tone === "critical" ? "alert" : "status");
    const inspected = unwrapReactComponent(ui.Field);
    let source = "";
    if (typeof inspected === "function") {
      try { source = Function.prototype.toString.call(inspected); } catch (_error) { source = ""; }
    }
    // Field may render both helperText and children. Pass the message once.
    // role and aria-live stay on this element; unknown Field props are not DOM.
    const useError = tone === "critical" && source.indexOf("errorMessage") !== -1;
    const field = useError
      ? h(ui.Field, { hideLabel: true, errorMessage: text })
      : h(ui.Field, { hideLabel: true, helperText: text });
    const color = useError ? "" : statusToken(tone);
    return h("div", { role: role, "aria-live": live, style: color ? { color: color } : null }, field);
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
        placeholder: detail.placeholder || ""
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
      maxLength: detail.maxLength,
      autoComplete: detail.type === "password" ? "off" : undefined,
      spellCheck: detail.type === "password" ? false : undefined,
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
    return h(ui.Field, { label: detail.name || "" },
      h("div", null,
        h("div", { "data-dtm-style-preview-block": "true", style: detail.style, lang: settingsSpec?.locale }, detail.previewText || "")
      )
    );
  }

  function ButtonControl({ ui, detail }) {
    if (!ui.Button) return null;
    const h = ui.React.createElement.bind(ui.React);
    const props = {
      text: detail.label || "",
      variant: detail.variant === "secondary" ? "secondary" : "primary",
      disabled: Boolean(detail.disabled),
      loading: Boolean(detail.loading)
    };
    // aria-live and aria-busy stay on the renderer host. Copying them here would nest a second live region inside an unproved Button prop.
    if (detail.label) props["aria-label"] = detail.label;
    return h(ui.Button, props);
  }

  function mount(detail) {
    if (!detail || !/^dtm-control-[0-9]+$/.test(detail.id)) return;
    const textUpdate = detail.textOnly;
    const previousControl = controls.get(detail.id);
    if (detail.textOnly) {
      const previous = controls.get(detail.id);
      if (!previous) return;
      const next = { ...previous.detail };
      for (const key of ["name", "label", "helperText", "placeholder", "previewText", "savedKeyLabel"]) {
        if (typeof detail[key] === "string" && detail[key].length <= 4000) next[key] = detail[key];
      }
      if (Array.isArray(detail.optionLabels) && Array.isArray(next.options)) {
        next.options = next.options.map(option => {
          const update = detail.optionLabels.find(item => item.value === option.value && typeof item.label === "string" && item.label.length <= 4000);
          return update ? { ...option, label: update.label, ...(typeof update.savedKeyLabel === "string" ? { savedKeyLabel: update.savedKeyLabel } : {}) } : option;
        });
      }
      if (next.kind === "status") {
        if (detail.tone === "default" || detail.tone === "warning" || detail.tone === "critical") next.tone = detail.tone;
        if (detail.live === "polite" || detail.live === "assertive") next.live = detail.live;
        if (detail.role === "status" || detail.role === "alert") next.role = detail.role;
      }
      detail = next;
    }
    const host = document.querySelector('[data-dtm-control-id="' + detail.id + '"]');
    if (!host) return;
    const ui = textUpdate ? previousControl?.element?.props?.ui || resolveUi() : resolveUi();
    if (!settingsReady(ui)) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: {code:"CONFIG",reason:"NATIVE_UI_UNAVAILABLE"} });
      return;
    }

    const React = ui.React;
    const h = React.createElement.bind(React);

    function sendChange(value) {
      emit("dtm:control-change", { id: detail.id, value });
    }

    const required=detail.kind==="text-area"?ui.TextArea:detail.kind==="text-input"||detail.kind==="combobox"&&!ui.SearchableSelect?ui.TextInput:true;
    if(!required){emit("dtm:control-mounted",{id:detail.id,ok:false,error:{code:"CONFIG",reason:"NATIVE_UI_UNAVAILABLE"}});return;}

    const element = textUpdate && previousControl
      ? h(previousControl.element.type, { ...previousControl.element.props, detail, ...(detail.kind === "status" ? { helperText: detail.helperText, tone: detail.tone, live: detail.live, role: detail.role } : {}) })
      : detail.kind === "combobox" && ui.SearchableSelect
      ? h(ComboBoxControl, { ui, detail, sendChange })
      : detail.kind === "combobox" ? h(TextControl,{ui,detail:{...detail,kind:"text-input"},sendChange})
      : detail.kind === "select"
      ? h(SelectControl, { ui, detail, sendChange })
      : detail.kind === "switch" ? h(ToggleControl, { ui, detail, sendChange })
        : detail.kind === "status" ? h(StatusControl, { ui, detail })
        : detail.kind === "translation-preview" ? h(TranslationPreviewControl, { ui, detail })
          : detail.kind === "button" ? h(ButtonControl, { ui, detail })
            : h(TextControl, { ui, detail, sendChange });
    const section = host.closest("[data-dtm-section-key]");
    const key = section && section.dataset.dtmSectionKey;
    const refresh = sectionRefresh.get(key);
    if (!refresh) return;

    try {
      controls.set(detail.id, { element, host, section: key, detail });
      refresh();
      emit("dtm:control-mounted", { id: detail.id, ok: true });
    } catch (error) {
      emit("dtm:control-mounted", { id: detail.id, ok: false, error: {code:"CONFIG",reason:"NATIVE_UI_UNAVAILABLE"} });
    }
  }

  let toastApi = null;
  let toastMiss = null;

  function isToastTypes(value) {
    if (!value || typeof value !== "object") return false;
    return ["SUCCESS", "FAILURE", "MESSAGE"].every(key => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
      const item = value[key];
      return typeof item === "number" || typeof item === "string";
    });
  }

  function initializedToastExport(cache, predicate) {
    let ids;
    try { ids = Object.keys(cache); } catch (_error) { return null; }
    for (const moduleId of ids) {
      let exports;
      try {
        const entry = cache[moduleId];
        exports = entry && entry.exports;
      } catch (_error) { continue; }
      if (!exports || (typeof exports !== "object" && typeof exports !== "function")) continue;
      try { if (predicate(exports)) return exports; } catch (_error) {}
      if (typeof exports !== "object") continue;
      let names;
      try { names = Object.keys(exports); } catch (_error) { continue; }
      for (const name of names) {
        let value;
        try { value = exports[name]; } catch (_error) { continue; }
        try { if (predicate(value)) return value; } catch (_error) {}
      }
    }
    return null;
  }

  function resolveToast() {
    try {
      if (toastApi) return toastApi;
      const now = Date.now();
      if (toastMiss && now < toastMiss.next) return null;
      const require = getRequire();
      const cache = require && require.c;
      const attempts = (toastMiss ? toastMiss.attempts : 0) + 1;
      const delay = Math.min(30000, 100 * Math.pow(2, attempts));
      if (!cache) {
        toastMiss = { attempts: attempts, next: now + delay };
        return null;
      }
      const CreateToast = initializedToastExport(cache, value => isFunctionMatchingCode(value, ["options", "duration", "appContext", "message", "type"]));
      const ToastTypes = initializedToastExport(cache, isToastTypes);
      const ShowToast = initializedToastExport(cache, value => isFunctionMatchingCode(value, ["currentToastMap", "queuedToastsMap"]));
      if (CreateToast && ToastTypes && ShowToast) {
        toastApi = { CreateToast: CreateToast, ToastTypes: ToastTypes, ShowToast: ShowToast };
        toastMiss = null;
        return toastApi;
      }
      toastMiss = { attempts: attempts, next: now + delay };
      return null;
    } catch (_error) {
      const attempts = (toastMiss ? toastMiss.attempts : 0) + 1;
      toastMiss = { attempts: attempts, next: Date.now() + Math.min(30000, 100 * Math.pow(2, attempts)) };
      return null;
    }
  }

  function showToast(detail) {
    const ui = resolveToast();
    if (!ui) return;
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
  window.addEventListener("dtm:settings-config", event => handleInboundMessage(event.detail, configureSettings));
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
    if (data.type === "dtm:settings-config") handleInboundMessage(data.detail, configureSettings);
  });
})();
`;

let runtimeStarted = false;

function injectMainWorldBridge() {
  let injected = false;
  try {
    if (webFrame && typeof webFrame.executeJavaScript === "function") {
      webFrame.executeJavaScript(MAIN_WORLD_BRIDGE_SOURCE).catch((error) => {
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
  const arg = process.argv.find((value) =>
    value.startsWith("--dtm-original-preload="),
  );
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
  const result = await webFrame.executeJavaScript(
    "(() => { try { return { value: window.__discordTranslatorComposer[" +
      JSON.stringify(method) +
      "](" +
      JSON.stringify(argument) +
      ") }; } catch (error) { return { error: { code: error.code || 'COMPOSER_UNAVAILABLE', reason: error.reason } }; } })()",
  );
  if (result.error) throw Object.assign(new Error("Composer operation failed."), sanitizeError(result.error));
  return result.value;
}

const api = Object.freeze({
  uiSystemLocale,
  getSettings: () => ipcRenderer.invoke("dtm:get-settings"),
  saveConfig: (request) => ipcRenderer.invoke("dtm:save-config", request),
  patchSendBox: (patch) => ipcRenderer.invoke("dtm:patch-send-box", patch),
  getApiKeyStatus: (request) =>
    ipcRenderer.invoke("dtm:get-api-key-status", request),
  cancel: (request) => ipcRenderer.invoke("dtm:cancel", request),
  onConfigChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("dtm:config-changed", listener);
    return () => ipcRenderer.removeListener("dtm:config-changed", listener);
  },
  translate: (request) => ipcRenderer.invoke("dtm:translate", request),
  testConnection: (request) =>
    ipcRenderer.invoke("dtm:test-connection", request),
  listModels: (request) => ipcRenderer.invoke("dtm:list-models", request),
  beginSend: (send) => callComposer("beginSend", send),
  insertAndSend: (request) => callComposer("insertAndSend", request),
  cancelSend: (id) => callComposer("cancelSend", id),
  openSettingsFile: () => ipcRenderer.invoke("dtm:open-settings-file"),
  openExternal: (url) => ipcRenderer.invoke("dtm:open-external", url),
  cacheStatus: () => ipcRenderer.invoke("dtm:cache-status"),
  clearCache: () => ipcRenderer.invoke("dtm:clear-cache"),
  checkUpdate: () => ipcRenderer.invoke("dtm:check-update"),
});

function startRuntime() {
  if (runtimeStarted) return;
  injectMainWorldBridge();
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
