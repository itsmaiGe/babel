"use strict";
const MESSAGES = Object.freeze({
  UNKNOWN: "Operation failed.",
  MALFORMED: "Configuration could not be read safely.",
  COMPOSER_UNAVAILABLE: "Discord composer unavailable.",
  COMPOSER_DRAFT_NOT_EMPTY: "Discord composer contains a draft.",
  COMPOSER_CHANGED: "Discord composer changed.",
  COMPOSER_UNSUPPORTED: "Unsupported composer state.",
  CONFIG: "模型配置有误，请检查地址和模型 ID。",
  INSECURE_HTTP: "此接口使用未加密 HTTP，请明确允许后重试。",
  NO_KEY: "请先填写并保存 API Key。",
  KEY_UNAVAILABLE: "系统加密暂不可用，无法读取保存的 API Key。",
  SECURE_STORAGE: "系统加密暂不可用，API Key 未保存。请重启 Discord 后重试。",
  DISABLED: "Babel 已关闭。",
  STALE_REVISION: "配置已改变，请重试。",
  CANCELED: "已取消翻译。",
  BUSY: "翻译队列已满，请稍后重试。",
  BUSY_SKIPPED: "队列已满，此条自动翻译已跳过。",
  PAUSED: "自动翻译已暂停，请检查配置或稍后重试。",
  AUTH: "API Key 无效或已过期，请重新填写。",
  RATE_LIMIT: "请求过于频繁，请稍后重试。",
  RESPONSE_TOO_LARGE: "模型响应过大，已停止读取。",
  REDIRECT_BLOCKED: "接口重定向已阻止，请使用最终 HTTPS 地址。",
  TIMEOUT: "翻译超时，已自动取消，请重试。",
  NETWORK: "网络连接失败，请检查网络或代理后重试。",
  INPUT: "请求无效或文本过长（最多 12000 字符）。",
  CONFLICT: "配置文件已改变，请重新加载后保存。",
  STORAGE: "配置保存失败，请检查配置文件夹权限。",
  PARTIAL_SAVE: "部分保存失败，已尝试恢复原配置。",
  UNTRUSTED: "此窗口不能使用 Babel。",
});
// Recovery reasons and IPC parameters form a bounded, language-neutral contract.
const REASONS = Object.freeze({
  CONFIG: ["INVALID_ENDPOINT", "MODELS_EMPTY", "NATIVE_UI_UNAVAILABLE", "PROTOCOL_UNSUPPORTED", "MODEL_UNAVAILABLE", "REQUEST_REJECTED", "UNEXPECTED_RESPONSE"],
  AUTH: ["PERMISSION"],
  RATE_LIMIT: ["QUOTA", "TEMPORARY"],
  MALFORMED: ["UNREADABLE", "INVALID_JSON", "OVERSIZED"],
  STORAGE: ["KEY_MIGRATION", "READ_FAILED", "WRITE_FAILED", "OPEN_FOLDER", "CACHE_READ", "CACHE_WRITE", "CACHE_CLEAR", "ACCESS_DENIED"],
  PARTIAL_SAVE: ["KEY_RESTORED", "KEY_ROLLBACK_FAILED"],
  INPUT: ["EMPTY_TEXT", "TEXT_LIMIT", "EXTERNAL_HTTPS", "PROVIDER_LIMIT"],
  CANCELED: ["SEND"],
  NETWORK: ["EMPTY_RESPONSE", "PROVIDER_TEMPORARY", "INCOMPLETE", "REFUSED", "RESPONSE_FAILED"],
});
function sanitizeError(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "UNKNOWN";
  const reason = REASONS[code]?.includes(error?.reason) ? error.reason : undefined;
  const params = {};
  if (["AUTH", "RATE_LIMIT", "CONFIG", "NETWORK", "TIMEOUT"].includes(code)) {
    if (Number.isSafeInteger(error?.params?.status) && error.params.status >= 100 && error.params.status <= 599) params.status = error.params.status;
    try {
      const value = error?.params?.origin, url = new URL(value);
      if (typeof value === "string" && value.length <= 512 && /^https?:$/.test(url.protocol) && url.origin === value && !url.username && !url.password) params.origin = value;
    } catch (_) {}
  }
  if (code === "INPUT" && reason === "TEXT_LIMIT" && Number.isSafeInteger(error?.params?.limit) && error.params.limit > 0 && error.params.limit <= 12000) params.limit = error.params.limit;
  return { code, ...(reason ? { reason } : {}), ...(Object.keys(params).length ? { params } : {}),
    ...(Number.isFinite(error?.retryAfter) && error.retryAfter >= 0 ? { retryAfter: Math.min(300, error.retryAfter) } : {}), message: MESSAGES[code] };
}
function failure(code, message, extra) {
  return Object.assign(new Error(message || MESSAGES[code] || MESSAGES.UNKNOWN), { code, ...extra });
}
function publicFailure(error) { return { ok: false, error: sanitizeError(error) }; }
module.exports = { failure, publicFailure, sanitizeError, REASONS, MESSAGES };
