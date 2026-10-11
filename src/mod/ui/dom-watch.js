"use strict";
const LIST_SELECTOR =
  "[data-list-id='chat-messages'], #chat-messages, [class*='messagesWrapper'] [class*='scrollerInner']";
const MESSAGE_SELECTOR =
  "[id^='chat-messages-'], [data-list-item-id*='chat-messages']";
const COMPOSER_SELECTOR = "[role='textbox'][contenteditable='true']";
class DomWatch {
  constructor({
    document,
    window,
    onMessages,
    onRoute,
    onPosition,
    sendEnabled,
    findMessage,
    onDoubleClick,
  }) {
    Object.assign(this, {
      document,
      window,
      onMessages,
      onRoute,
      onPosition,
      sendEnabled,
      findMessage,
      onDoubleClick,
    });
    this.running = false;
    this.list = null;
    this.composer = null;
    this.route = "";
    this.pending = new Set();
    this.cleanups = [];
    this.composerCleanups = [];
    this.counters = {
      fullScans: 0,
      messagesExamined: 0,
      layoutReads: 0,
      selectorQueries: 0,
      passes: 0,
    };
  }
  owned(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return Boolean(
      element?.closest?.(
        ".dtm-translation-block, #dtm-send-box, [data-dtm-native-react-control]",
      ),
    );
  }
  listen(target, name, callback, options) {
    target?.addEventListener?.(name, callback, options);
    return () => target?.removeEventListener?.(name, callback, options);
  }
  schedule() {
    if (this.frame) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.running) return;
      const messages = [...this.pending];
      this.pending.clear();
      if (messages.length) {
        this.counters.passes++;
        this.counters.messagesExamined += messages.length;
        this.onMessages(messages);
      }
    });
  }
  mutations(records) {
    for (const record of records) {
      if (this.owned(record.target)) continue;
      const nodes =
        record.type === "characterData"
          ? [record.target.parentElement]
          : [record.target, ...record.addedNodes, ...record.removedNodes];
      if (
        record.type === "childList" &&
        (record.addedNodes.length || record.removedNodes.length) &&
        [...record.addedNodes, ...record.removedNodes].every((node) =>
          this.owned(node),
        )
      )
        continue;
      for (const node of nodes) {
        if (!node || this.owned(node)) continue;
        const message = this.findMessage(node);
        if (message) this.pending.add(message);
        else if (node.nodeType === 1) {
          for (const candidate of node.querySelectorAll(MESSAGE_SELECTOR))
            this.pending.add(candidate);
        }
      }
    }
    if (this.pending.size) this.schedule();
  }
  attachList(list) {
    this.listObserver?.disconnect();
    this.list = list;
    if (!list) return;
    this.rootObserver?.disconnect();
    this.rootObserver = null;
    this.listObserver = new this.window.MutationObserver((records) =>
      this.mutations(records),
    );
    this.listObserver.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.counters.fullScans++;
    const messages = [...list.querySelectorAll(MESSAGE_SELECTOR)];
    this.counters.messagesExamined += messages.length;
    this.onMessages(messages);
  }
  seekList() {
    this.counters.selectorQueries++;
    const list = this.document.querySelector(LIST_SELECTOR);
    if (list) this.attachList(list);
    else if (!this.rootObserver) {
      this.rootObserver = new this.window.MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1 || this.owned(node)) continue;
            const candidate = node.matches?.(LIST_SELECTOR)
              ? node
              : node.querySelector?.(LIST_SELECTOR);
            if (candidate) {
              this.attachList(candidate);
              return;
            }
          }
      });
      this.rootObserver.observe(this.document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }
  position() {
    if (this.positionFrame) return;
    this.positionFrame = this.window.requestAnimationFrame(() => {
      this.positionFrame = 0;
      if (this.running && this.composer) {
        this.counters.layoutReads++;
        this.onPosition(this.composer);
      }
    });
  }
  attachComposer(composer) {
    for (const cleanup of this.composerCleanups) cleanup();
    this.composerCleanups = [];
    this.composer = composer;
    if (!composer) return;
    const resized = new this.window.ResizeObserver(() => this.position());
    resized.observe(composer);
    this.composerCleanups.push(() => resized.disconnect());
    this.composerCleanups.push(
      this.listen(this.window, "resize", () => this.position()),
    );
    for (let node = composer.parentElement; node; node = node.parentElement)
      this.composerCleanups.push(
        this.listen(node, "scroll", () => this.position(), { passive: true }),
      );
    const theme = new this.window.MutationObserver(() => this.position());
    theme.observe(this.document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    this.composerCleanups.push(() => theme.disconnect());
    const layout = new this.window.MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !this.owned(record.target) &&
            (record.type === "attributes" ||
              [...record.addedNodes, ...record.removedNodes].some(
                (node) => !this.owned(node),
              )),
        )
      )
        this.position();
    });
    const container =
      composer.closest?.("[class*='chatContent']") || composer.parentElement;
    if (container) {
      layout.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      this.composerCleanups.push(() => layout.disconnect());
    }
    this.position();
  }
  health() {
    const route = this.window.location.pathname;
    if (route !== this.route) {
      this.route = route;
      this.onRoute();
      this.attachList(null);
      this.attachComposer(null);
    }
    if (!this.list?.isConnected) this.seekList();
    if (!this.sendEnabled()) {
      if (this.composer) this.attachComposer(null);
      return;
    }
    if (!this.composer?.isConnected) {
      this.counters.selectorQueries++;
      this.attachComposer(this.document.querySelector(COMPOSER_SELECTOR));
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    if (this.onDoubleClick)
      this.cleanups.push(
        this.listen(this.document, "dblclick", this.onDoubleClick),
      );
    this.route = this.window.location.pathname;
    this.onRoute();
    this.health();
    this.interval = this.window.setInterval(() => this.health(), 1500);
  }
  stop() {
    this.running = false;
    this.window.clearInterval(this.interval);
    this.interval = null;
    this.listObserver?.disconnect();
    this.rootObserver?.disconnect();
    this.listObserver = this.rootObserver = null;
    this.attachComposer(null);
    this.list = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.window.cancelAnimationFrame?.(this.frame);
    this.window.cancelAnimationFrame?.(this.positionFrame);
    this.frame = this.positionFrame = 0;
    this.pending.clear();
  }
}
if (typeof module !== "undefined")
  module.exports = {
    DomWatch,
    LIST_SELECTOR,
    MESSAGE_SELECTOR,
    COMPOSER_SELECTOR,
  };
else window.BabelDomWatch = DomWatch;
