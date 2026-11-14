// Anonymous usage statistics (Aptabase — Rust plugin tauri-plugin-aptabase).
// Only one event: "app_started", once per launch. Aptabase adds the app
// version, the system (Windows / macOS / Linux + version) and the language;
// the country is derived from the connection and the IP is never stored.
// No personal data, no device identifier, nothing about what's downloaded.
// Off when the user turns "Send anonymous usage statistics" off in Settings.

import { trackEvent } from "@aptabase/tauri";

let sent = false;

export function trackAppStart(enabled) {
  if (sent || enabled === false) return;
  sent = true;
  trackEvent("app_started").catch(() => { /* offline / not configured: ignore */ });
}
