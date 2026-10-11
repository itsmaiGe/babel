"use strict";
const { failure, MESSAGES } = require("./errors");
const { validateEndpoint } = require("../../shared/settings");
const {
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGeminiModelsUrl,
  buildOpenAIModelsUrl,
  buildResponsesUrl,
  buildTranslationMessages,
  parseAnthropicResponse,
  parseModelListResponse,
  parseOpenAICompatibleResponse,
  parseResponsesResponse,
  providerSignals,
  quotaSignal,
  resolveModelConfig,
} = require("../../shared/translate");
const REQUIRED = new Set([
  "openai",
  "google",
  "anthropic",
  "deepseek",
  "zhipu",
  "kimi",
  "openrouter",
]);
function isNetworkFailure(error) {
  if (!error || error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  if (error.cause) return true;
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_|certificate|self[- ]signed/i.test(
    String(error.message || error),
  );
}

// Narrow, exact rejection signals for the HTTP 400/404/405/422 path. Rejections
// of individual parameters name no API path and stay ambiguous.
const PROTOCOL_PHRASE =
  /\bonly supported in (?:the )?\/?v1\/(?:responses|chat\/completions|messages)\b|\bnot a chat model\b|\bdoes not support this protocol\b/i;

function rejectionReason(body) {
  const { codes, texts } = providerSignals(body);
  if (codes.some((code) => /^modelprotocolunsupported$/i.test(code)))
    return "PROTOCOL_UNSUPPORTED";
  if (texts.some((text) => PROTOCOL_PHRASE.test(text)))
    return "PROTOCOL_UNSUPPORTED";
  if (codes.some((code) => /^model_not_found$/i.test(code)))
    return "MODEL_UNAVAILABLE";
  return "REQUEST_REJECTED";
}

function classifyProviderStatus(status, body) {
  if (status === 401) return { code: "AUTH" };
  if (
    status === 402 ||
    ((status === 403 || status === 429) && quotaSignal(body))
  )
    return { code: "RATE_LIMIT", reason: "QUOTA" };
  if (status === 403) return { code: "AUTH", reason: "PERMISSION" };
  if (status === 413) return { code: "INPUT", reason: "PROVIDER_LIMIT" };
  if (status === 429) return { code: "RATE_LIMIT", reason: "TEMPORARY" };
  if (status >= 500 && status <= 599)
    return { code: "NETWORK", reason: "PROVIDER_TEMPORARY" };
  if (status === 408) return { code: "TIMEOUT" };
  if (status === 400 || status === 404 || status === 405 || status === 422)
    return { code: "CONFIG", reason: rejectionReason(body) };
  return { code: "NETWORK" };
}

function retryAfterSeconds(headers) {
  const raw = headers?.get?.("retry-after");
  let retryAfter = Number(raw);
  if (!Number.isFinite(retryAfter))
    retryAfter = (Date.parse(raw) - Date.now()) / 1000;
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = 30;
  return Math.max(1, Math.min(300, retryAfter));
}

function buildModelListRequest(modelConfig, apiKey) {
  if (modelConfig.provider === "google") {
    return {
      url: buildGeminiModelsUrl(""),
      headers: apiKey ? { "x-goog-api-key": apiKey } : {},
    };
  }

  if (modelConfig.protocol === "anthropic") {
    const headers = {
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    return {
      url: buildOpenAIModelsUrl(modelConfig.baseUrl),
      headers,
    };
  }

  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    url: buildOpenAIModelsUrl(modelConfig.baseUrl),
    headers,
  };
}

function buildProviderRequest(modelConfig, messages, apiKey) {
  const systemMessage = messages.find((message) => message.role === "system");

  if (modelConfig.protocol === "anthropic") {
    const userMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));
    const headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    return {
      protocol: "anthropic",
      url: buildAnthropicMessagesUrl(modelConfig.baseUrl),
      headers,
      body: {
        model: modelConfig.modelId,
        max_tokens: anthropicMaxTokens(userMessages),
        system: systemMessage ? systemMessage.content : "",
        messages: userMessages,
      },
    };
  }

  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  if (modelConfig.protocol === "responses") {
    return {
      protocol: "responses",
      url: buildResponsesUrl(modelConfig.baseUrl),
      headers,
      body: {
        model: modelConfig.modelId,
        instructions: systemMessage ? systemMessage.content : "",
        input: messages
          .filter((message) => message.role !== "system")
          .map((message) => message.content)
          .join("\n"),
      },
    };
  }

  return {
    protocol: "openai",
    url: buildChatCompletionsUrl(modelConfig.baseUrl),
    headers,
    body: {
      model: modelConfig.modelId,
      messages,
    },
  };
}

function anthropicMaxTokens(userMessages) {
  // Anthropic requires an explicit max_tokens; a fixed 2048 truncates long
  // translations. Scale with the input size (CJK output can be ~1 token/char)
  // and keep it within a range every supported Claude model can return.
  const chars = userMessages.reduce(
    (total, message) => total + String(message.content || "").length,
    0,
  );
  const estimate = Math.ceil(chars * 1.5) + 256;
  return Math.min(8192, Math.max(1024, estimate));
}

function requireApiKey(config, key) {
  if (REQUIRED.has(config.provider) && !key) throw failure("NO_KEY");
}
async function readResponse(response, limit) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (declared > limit) {
    await response.body?.cancel?.();
    throw failure("RESPONSE_TOO_LARGE");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw failure("RESPONSE_TOO_LARGE");
    return text;
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw failure("RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
function createProvider(electron = {}) {
  const http = (url, options) =>
    electron.net?.fetch
      ? electron.net.fetch(url, options)
      : globalThis.fetch(url, options);
  async function json(data, method, signal, limit) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => {
      controller.abort();
    }, 30000);
    try {
      const response = await http(data.url, {
        method,
        headers: data.headers,
        body: method === "POST" ? JSON.stringify(data.body) : undefined,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400)
        throw failure("REDIRECT_BLOCKED");
      const text = await readResponse(response, limit);
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (_) {
          if (response.ok)
            throw failure("CONFIG", null, { reason: "UNEXPECTED_RESPONSE" });
        }
      }
      if (!response.ok) {
        const classified = classifyProviderStatus(response.status, body);
        const extra = {
          params: {
            status: response.status,
            origin: new URL(data.url).origin,
          },
        };
        if (classified.reason) extra.reason = classified.reason;
        if (classified.reason === "TEMPORARY")
          extra.retryAfter = retryAfterSeconds(response.headers);
        throw failure(classified.code, null, extra);
      }
      return body;
    } catch (error) {
      if (typeof error.code === "string" && MESSAGES[error.code]) throw error;
      if (controller.signal.aborted || error.name === "AbortError")
        throw failure(signal?.aborted ? "CANCELED" : "TIMEOUT");
      if (
        /redirect/i.test(String(error?.cause?.message || error.message || ""))
      )
        throw failure("REDIRECT_BLOCKED");
      if (isNetworkFailure(error)) throw failure("NETWORK");
      throw failure("UNKNOWN");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  return {
    async translate({ settings, apiKey, direction, text, signal }) {
      if (
        !settings.enabled ||
        (direction === "send" && !settings.sendTranslation.enabled)
      )
        throw failure("DISABLED");
      if (typeof text !== "string" || !text.trim() || text.length > 12000)
        throw failure("INPUT", null, { reason: !text?.trim() ? "EMPTY_TEXT" : "TEXT_LIMIT", params: { limit: 12000 } });
      validateEndpoint(settings.model);
      const config = resolveModelConfig(settings.model);
      requireApiKey(config, apiKey);
      const data = buildProviderRequest(
        config,
        buildTranslationMessages({ text, direction, settings }),
        apiKey,
      );
      const body = await json(data, "POST", signal, 256 * 1024);
      if (data.protocol === "anthropic") return parseAnthropicResponse(body);
      if (data.protocol === "responses") return parseResponsesResponse(body);
      return parseOpenAICompatibleResponse(body);
    },
    async models({ settings, apiKey, signal }) {
      validateEndpoint(settings.model);
      const config = resolveModelConfig(settings.model);
      requireApiKey(config, apiKey);
      const body = await json(
        buildModelListRequest(config, apiKey),
        "GET",
        signal,
        2 * 1024 * 1024,
      );
      const models = parseModelListResponse(body, config.provider);
      if (!models.length)
        throw failure("CONFIG", "没有可用模型，请检查模型地址和 API 权限。", { reason: "MODELS_EMPTY" });
      return models;
    },
    http,
  };
}
module.exports = {
  createProvider,
  classifyProviderStatus,
  readResponse,
  buildProviderRequest,
};
