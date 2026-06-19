"use strict";

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function applyPromptTemplate(template, targetLanguage) {
  return String(template || "").replace(/\{\{targetLanguage\}\}/g, targetLanguage);
}

function buildTranslationMessages({ text, direction, settings }) {
  const targetLanguage = direction === "send"
    ? settings.model.sendLanguage
    : settings.model.targetLanguage;
  const template = direction === "send"
    ? settings.model.customSendPrompt
    : settings.model.customReadPrompt;

  return [
    {
      role: "system",
      content: applyPromptTemplate(template, targetLanguage)
    },
    {
      role: "user",
      content: String(text || "")
    }
  ];
}

function parseOpenAICompatibleResponse(body) {
  const content = body &&
    Array.isArray(body.choices) &&
    body.choices[0] &&
    body.choices[0].message &&
    typeof body.choices[0].message.content === "string"
    ? body.choices[0].message.content
    : "";

  if (!content.trim()) {
    throw new Error("Model response did not include translated text.");
  }

  return content.trim();
}

module.exports = {
  applyPromptTemplate,
  buildChatCompletionsUrl,
  buildTranslationMessages,
  parseOpenAICompatibleResponse
};
