// Is the Alt key physically held right now?
//
// Wheel events' `altKey` can stay true after Alt was just tapped and released
// (on Windows a lone Alt press enters the "menu key" mode, which the webview
// keeps reporting), so Alt + wheel features check the real key state, tracked
// here from keydown / keyup (and reset when the window loses focus).

let held = false;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt") {
      held = true;
      e.preventDefault(); // no "menu key" mode on a lone Alt
    }
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt") {
      held = false;
      e.preventDefault();
    }
  }, true);
  window.addEventListener("blur", () => { held = false; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) held = false; });
}
install();

/** True only while Alt is actually pressed (and the event says so too). */
export function altHeld(e) {
  return held && (!e || e.altKey);
}
