"use strict";
const path = require("node:path");
const { failure } = require("./errors");
// Verified in Discord Stable 0.0.414 core.asar's mainWindow module, including the
// legacy domain migration and PTB/Canary endpoint selection.
const ORIGINS = new Set([
  "https://discord.com",
  "https://discordapp.com",
  "https://ptb.discord.com",
  "https://canary.discord.com",
]);
function mainPreload(value) {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    path.basename(value) === "mainScreenPreload.js"
  );
}
class IpcGuard {
  constructor(onDestroyed = () => {}) {
    this.windows = new Map();
    this.onDestroyed = onDestroyed;
  }
  track(window) {
    const sender = window.webContents;
    this.windows.set(sender.id, sender);
    window.once("closed", () => {
      this.windows.delete(sender.id);
      this.onDestroyed(sender.id);
    });
    sender.once?.("destroyed", () => {
      this.windows.delete(sender.id);
      this.onDestroyed(sender.id);
    });
  }
  authorize(event, validate, value) {
    const sender = this.windows.get(event.sender?.id),
      frame = event.senderFrame;
    let origin;
    try {
      origin = new URL(frame?.url).origin;
    } catch (_) {}
    if (
      !sender ||
      sender !== event.sender ||
      !frame ||
      frame !== sender.mainFrame ||
      !ORIGINS.has(origin)
    )
      throw failure("UNTRUSTED");
    if (!validate(value)) throw failure("INPUT");
    return sender.id;
  }
  broadcast(channel, value) {
    for (const sender of this.windows.values())
      if (!sender.isDestroyed?.()) sender.send(channel, value);
  }
}
module.exports = { IpcGuard, mainPreload, ORIGINS };
