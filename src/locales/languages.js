// Single source of truth for the interface languages.
// Used by the language pickers (Settings, first-run setup) and by the
// "Automatic" mode, so adding a language only requires one change here
// (plus its JSON file registered in i18n.js).

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "ko", label: "한국어 (Korean)" },
  { value: "zh", label: "中文 (Chinese)" },
  { value: "ja", label: "日本語 (Japanese)" },
  { value: "ru", label: "Русский (Russian)" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "bn", label: "বাংলা (Bengali)" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "tr", label: "Türkçe (Turkish)" },
  { value: "vi", label: "Tiếng Việt (Vietnamese)" },
  { value: "pl", label: "Polski (Polish)" },
];

const SUPPORTED_CODES = LANGUAGES.map((l) => l.value);

// Languages written right-to-left (the whole UI is mirrored for them).
export const RTL_CODES = ["ar"];

// "Automatic" mode: the OS/browser language if we support it, else English.
function detectLanguage() {
  const candidates = [...(navigator.languages || []), navigator.language]
    .filter(Boolean)
    .map((l) => l.split("-")[0].toLowerCase());
  return candidates.find((c) => SUPPORTED_CODES.includes(c)) || "en";
}

// Resolves a saved setting ("auto" or a code) to the language actually used.
export function resolveLanguage(setting) {
  return !setting || setting === "auto" ? detectLanguage() : setting;
}
