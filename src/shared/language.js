"use strict";

// Best-effort, dependency-free script/language detection used by skip-same-language.
//
// We can reliably tell apart "distinctive" scripts — Han (Chinese), Kana (Japanese),
// Hangul (Korean), Cyrillic (Russian). We canNOT distinguish among Latin-script
// languages (English vs French vs German …) without a real language model, so for a
// Latin-script target we never claim a match and the message is translated anyway.

const SCRIPT_RANGES = [
  ["han", /[㐀-䶿一-鿿豈-﫿]/u],
  ["kana", /[぀-ゟ゠-ヿㇰ-ㇿ]/u],
  ["hangul", /[가-힯ᄀ-ᇿ㄰-㆏]/u],
  ["cyrillic", /[Ѐ-ԯ]/u],
  ["latin", /[A-Za-zÀ-ɏ]/u]
];

const LANGUAGE_SCRIPT = Object.freeze({
  "简体中文": "han",
  "繁体中文": "han",
  "中文": "han",
  "日语": "kana",
  "日文": "kana",
  "韩语": "hangul",
  "韩文": "hangul",
  "俄语": "cyrillic",
  "俄文": "cyrillic"
});

function countScripts(text) {
  const counts = { han: 0, kana: 0, hangul: 0, cyrillic: 0, latin: 0, total: 0 };
  for (const ch of String(text || "")) {
    for (const [name, re] of SCRIPT_RANGES) {
      if (re.test(ch)) {
        counts[name] += 1;
        counts.total += 1;
        break;
      }
    }
  }
  return counts;
}

function dominantScript(text) {
  const counts = countScripts(text);
  if (counts.total === 0) return "";
  let best = "";
  let bestCount = 0;
  for (const name of ["han", "kana", "hangul", "cyrillic", "latin"]) {
    if (counts[name] > bestCount) {
      bestCount = counts[name];
      best = name;
    }
  }
  return best;
}

// True only when we are confident `text` is already written in `language`. Latin
// targets and empty/symbol-only text always return false (translate anyway).
function textMatchesLanguage(text, language) {
  const expected = LANGUAGE_SCRIPT[String(language || "").trim()];
  if (!expected) return false;

  const counts = countScripts(text);
  if (counts.total === 0) return false;
  const dominant = dominantScript(text);

  if (expected === "han") {
    // Chinese: Han-dominant with no Kana/Hangul (those flag Japanese / Korean).
    return dominant === "han" && counts.kana === 0 && counts.hangul === 0;
  }
  if (expected === "kana") {
    // Japanese: any Kana at all is a strong signal (Japanese also mixes in Han).
    return counts.kana > 0;
  }
  if (expected === "hangul") {
    return counts.hangul > 0;
  }
  if (expected === "cyrillic") {
    return dominant === "cyrillic";
  }
  return false;
}

module.exports = { countScripts, dominantScript, textMatchesLanguage };
