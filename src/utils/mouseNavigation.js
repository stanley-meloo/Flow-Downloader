// Mouse side buttons (Back / Forward) for the whole app, like in a browser.
//
// Anything that can be "gone back" from registers a layer while it's open
// (useBackLayer): a dialog, the Settings window, a page inside it… The Back
// button undoes the newest layer (closes that dialog, leaves that page). Its
// handler may return a "redo" function: Forward runs it to go there again.
// Opening something new by hand clears the Forward history (like a browser).
//
// The webview's own back/forward navigation is blocked, so these buttons can
// never reload or navigate the app away.

import { useEffect, useRef } from "react";

const layers = [];   // open layers, oldest → newest: { back: () => redo | void }
let forward = [];    // redo functions, newest last
let redoingUntil = 0; // layers opened by a Forward don't clear the Forward history

const BACK = 3;
const FORWARD = 4;

export function clearForward() {
  if (performance.now() > redoingUntil) forward = [];
}

function goBack() {
  const top = layers[layers.length - 1];
  if (!top) return;
  const redo = top.back();
  if (typeof redo === "function") forward.push(redo);
}

function goForward() {
  const redo = forward.pop();
  if (!redo) return;
  redoingUntil = performance.now() + 600;
  redo();
}

/** Installs the global listener once (main.jsx). */
export function startMouseNavigation() {
  if (typeof window === "undefined" || window.__mouseNav) return;
  window.__mouseNav = true;
  const isNav = (e) => e.button === BACK || e.button === FORWARD;
  // Swallow every phase of the side buttons so the webview never navigates.
  const block = (e) => { if (isNav(e)) { e.preventDefault(); e.stopPropagation(); } };
  window.addEventListener("mousedown", block, true);
  window.addEventListener("auxclick", block, true);
  window.addEventListener("mouseup", (e) => {
    if (!isNav(e)) return;
    block(e);
    if (e.button === BACK) goBack(); else goForward();
  }, true);
}

/**
 * Registers a layer while `active` is true. `onBack` closes / leaves it and may
 * return a function that brings it back (used by the Forward button).
 */
export function useBackLayer(active, onBack) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    const layer = { back: () => handler.current?.() };
    layers.push(layer);
    clearForward(); // something new was opened by hand
    return () => {
      const i = layers.indexOf(layer);
      if (i !== -1) layers.splice(i, 1);
    };
  }, [active]);
}
