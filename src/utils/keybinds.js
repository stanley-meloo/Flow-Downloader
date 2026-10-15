// Configurable keyboard shortcuts.
//
// A shortcut ("combo") is stored as a readable string such as "Enter",
// "Ctrl+V" or "Ctrl+Shift+K". "Ctrl" is the platform's primary modifier: Ctrl
// on Windows/Linux and Command (⌘) on macOS — so the same saved shortcut works
// on both systems. Combos are compared as normalized strings, no parsing needed.
// On macOS they are DISPLAYED the Mac way: ⌘ / ⌥ / ⇧ (e.g. "⌘V").

// True on macOS (where the primary modifier is Command).
export const IS_MAC = typeof navigator !== "undefined" &&
  /mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "");

// Default bindings. Users can override any of them in Settings → Shortcuts.
// Single-key combos (like "O") never fire while the user is typing in a text
// field — see isTypingCombo() — so they're safe as main-window shortcuts.
export const DEFAULT_KEYBINDS = {
  // Main window
  search: 'Enter',
  paste: 'Ctrl+V',
  selectBar: 'Ctrl+A',
  openSettings: 'O',
  // Download windows (single video / playlist) and Settings
  download: 'Enter',
  closeModal: 'Escape',
};

// Previous default values that were changed in a later version. A saved value
// equal to an old default is treated as "not customized", so the user gets
// the new default automatically.
const LEGACY_DEFAULTS = {
  openSettings: ['Ctrl+,'],
};

// Only the bindings that differ from the defaults (what gets saved to disk).
export function keybindOverrides(binds) {
  const out = {};
  for (const [id, combo] of Object.entries(binds || {})) {
    if (combo && combo !== DEFAULT_KEYBINDS[id]) out[id] = combo;
  }
  return out;
}

// Saved bindings -> full map: defaults + the user's overrides (legacy defaults dropped).
export function resolveKeybinds(saved) {
  const overrides = { ...(saved || {}) };
  for (const [id, olds] of Object.entries(LEGACY_DEFAULTS)) {
    if (olds.includes(overrides[id])) delete overrides[id];
  }
  return { ...DEFAULT_KEYBINDS, ...keybindOverrides(overrides) };
}

// Actions shown in the Shortcuts tab. Conflicts are only checked inside the
// same group, so "Enter" can mean "search" in the main window and "download"
// inside a download window.
export const KEYBIND_ACTIONS = [
  { id: 'search', group: 'main' },
  { id: 'paste', group: 'main' },
  { id: 'selectBar', group: 'main' },
  { id: 'openSettings', group: 'main' },
  { id: 'download', group: 'modal' },
  { id: 'closeModal', group: 'modal' },
];

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

// Normalizes KeyboardEvent.key: letters upper-cased, space spelled out.
function normalizeKey(key) {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key; // "Enter", "Escape", "F5", "ArrowUp", "Tab", ...
}

// Converts a keydown event into a combo string, or null while only a modifier
// is being held (we wait for the "real" key).
export function eventToCombo(e) {
  if (!e || !e.key || MODIFIER_KEYS.includes(e.key)) return null;
  const parts = [];
  // Primary modifier: Command on macOS, Ctrl elsewhere (both stored as "Ctrl").
  if (IS_MAC ? e.metaKey : (e.ctrlKey || e.metaKey)) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

// True when the event matches the given combo.
export function matchesBind(e, combo) {
  return !!combo && eventToCombo(e) === combo;
}

// A combo that would type a character (letter, digit, symbol, space) because it
// has no Ctrl/Alt. Such shortcuts are ignored while focus is in a text field,
// so the key types normally there and acts as a shortcut everywhere else.
export function isTypingCombo(combo) {
  if (!combo || /(^|\+)(Ctrl|Alt)\+/.test(combo)) return false;
  const key = combo.endsWith('++') ? '+' : combo.split('+').pop();
  return key.length === 1 || key === 'Space';
}

// Short display names for long key names.
const DISPLAY_NAMES = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Del' };
// macOS shows modifiers as symbols: Command ⌘, Option ⌥, Shift ⇧.
const MAC_NAMES = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };

// Splits a combo into its keys for display ("Ctrl++" -> ["Ctrl", "+"],
// "Escape" -> ["Esc"]).
export function comboParts(combo) {
  if (!combo) return [];
  let parts;
  if (combo === '+') parts = ['+'];
  else if (combo.endsWith('++')) parts = [...combo.slice(0, -2).split('+'), '+'];
  else parts = combo.split('+');
  return parts.map((p) => (IS_MAC && MAC_NAMES[p]) || DISPLAY_NAMES[p] || p);
}

// Prefixes a label with its current shortcut, replacing any "(…)" prefix that
// the translation already carries. E.g. ("(ENTER) Search", "F2") -> "(F2) Search".
// On macOS modifier symbols are written together, Mac style: "(⌘V) Paste".
export function withBind(label, combo) {
  const clean = String(label || '').replace(/^\([^)]*\)\s*/, '');
  if (!combo) return clean;
  const keys = comboParts(combo).join(IS_MAC ? '' : '+').toUpperCase();
  return `(${keys}) ${clean}`;
}
