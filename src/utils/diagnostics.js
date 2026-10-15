// Text copied by "Copy diagnostics" (Settings) and "Copy console diagnostics"
// (right-click menu). Always starts with the project's repository link, so
// whoever receives the report knows where to report/look up the issue.
import { invoke } from "@tauri-apps/api/core";
import { getConsoleReport } from "./consoleCapture";

export const REPO_URL = "https://github.com/stanley-meloo/Flow-Downloader";

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
  return parts.join("\n");
}
