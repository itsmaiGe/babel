"use strict";
module.exports = function requireShared(name) {
  try { return require(`./shared/${name}`); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") return require(`../shared/${name}`); throw error; }
};
