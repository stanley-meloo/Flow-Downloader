// Keyboard access for clickable elements that aren't <button>s (cards, rows,
// field-like pickers): focusable with Tab, activated with Enter or Space —
// the same as a click. Spread it on the element: <div {...pressable} onClick=…>.
export const pressable = {
  role: "button",
  tabIndex: 0,
  onKeyDown: (e) => {
    if (e.target !== e.currentTarget) return; // a real control inside handles its own keys
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.currentTarget.click();
    }
  },
};

// A button clicked with the MOUSE doesn't keep the keyboard focus. Otherwise,
// e.g. after "Go to file" in the queue, coming back to the app and pressing
// Enter would press that button again instead of the app's Enter shortcut.
// Keyboard use (Tab + Enter/Space) keeps the focus where it is.
export function startMouseFocusRelease() {
  if (typeof document === "undefined" || window.__mouseFocusRelease) return;
  window.__mouseFocusRelease = true;
  document.addEventListener("click", (e) => {
    if (e.detail === 0) return; // activated from the keyboard
    const el = e.target instanceof Element ? e.target.closest('button, a, [role="button"], [role="switch"], [role="menuitem"], [role="option"]') : null;
    if (el && document.activeElement === el) el.blur();
  }, true);
}
