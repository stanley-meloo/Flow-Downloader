// Keeps the last console errors / warnings (and uncaught errors) in memory so
// the right-click menu can copy a "console diagnostics" report. Installed once,
// as early as possible (main.jsx). Messages also still reach the real console.

const MAX_ENTRIES = 200;
const MAX_TEXT = 2000; // characters per entry
const entries = [];
let installed = false;

function stringify(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function record(level, args) {
  const text = args.map(stringify).join(" ").slice(0, MAX_TEXT);
  entries.push({ time: new Date(), level, text });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function installConsoleCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      record(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => {
    record("uncaught", [e.error || e.message || "Unknown error"]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    record("unhandled promise", [e.reason ?? "Unknown rejection"]);
  });
}

// Plain-text report of everything captured since the app started.
export function getConsoleReport() {
  if (entries.length === 0) return "Console: no errors or warnings recorded.";
  const lines = entries.map((e) => {
    const t = e.time.toTimeString().slice(0, 8);
    return `[${t}] ${e.level.toUpperCase()}: ${e.text}`;
  });
  return `Console (${entries.length} errors/warnings):\n${lines.join("\n")}`;
}
