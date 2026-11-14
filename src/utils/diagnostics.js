// Text copied by "Copy diagnostics" (Settings) and "Copy console diagnostics"
// (right-click menu). Always starts with the project's repository link, so
// whoever receives the report knows where to report/look up the issue.
import { invoke } from "@tauri-apps/api/core";
import { getConsoleReport } from "./consoleCapture";

export const REPO_URL = "https://github.com/stanley-meloo/Flow-Downloader";

// Privacy: reports are often pasted into public GitHub issues, so the user's
// account name is hidden from every path in them (Windows "C:\Users\<name>",
// macOS "/Users/<name>", Linux "/home/<name>" → "<user>"), in any slash style
// (single, doubled/escaped, forward).
const SEP = String.raw`(?:\\{1,2}|/)`;
const USER_PATHS = [
  new RegExp(String.raw`([A-Za-z]:${SEP}Users${SEP})[^\\/'"\r\n<>|]+`, "gi"), // names may contain spaces
  /(\/Users\/)[^/'"\r\n<>|]+/g,
  /(\/home\/)[^/'"\r\n<>|]+/g,
];
export function redactUserPaths(text) {
  return USER_PATHS.reduce((out, re) => out.replace(re, "$1<user>"), String(text));
}

export async function buildDiagnosticsReport({ language, includeConsole = false } = {}) {
  let report;
  try {
    report = await invoke("get_diagnostics");
  } catch (e) {
    report = `App diagnostics unavailable: ${e}`;
  }
  const parts = [
    `Repository: ${REPO_URL}`,
    "",
    report,
    `Language: ${language || "?"} | UI: ${navigator.userAgent}`,
  ];
  if (includeConsole) parts.push("", getConsoleReport());
  return redactUserPaths(parts.join("\n"));
}
