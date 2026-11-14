// Language switch with a "decoding" effect: every piece of text that changes
// briefly turns into random characters, then settles left-to-right into the
// new language (~0.5 s).
//
// How: snapshot the visible text nodes, switch the language, let React
// re-render, then animate only the nodes whose text changed (or that are new).
// We write node.nodeValue directly and always end on React's exact text. If
// React updates a node mid-animation, that node is simply left alone.
// Turned off when the OS asks for reduced motion.
//
// No layout jumps: random characters have other widths than the real ones, so
// a scrambling line could wrap differently on every frame — cards changed
// height and "tilted" while centered (worse with verbose languages). During the
// effect, the box around each animated text is locked to its final size (the
// new language is already rendered when we measure), then released. Text that
// fits on one line is also kept from wrapping (white-space: nowrap) — otherwise
// a slightly wider noise string broke into two overlapping lines.

import i18n from "../locales/i18n";

const DURATION = 520;      // ms until the last character settles
const MAX_NODES = 400;     // safety cap
// Lowercase + digits only: similar widths, so the noise stays close to the
// real text's length (wide capitals and symbols made lines grow and shrink).
const GLYPHS = "abcdeghknopqrsuvxyz0123456789";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "KBD", "CODE"]);

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function visibleTextNodes() {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(el.tagName) || el.closest("[data-no-scramble], .font-path")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const H = window.innerHeight, W = window.innerWidth;
  while (walker.nextNode() && out.length < MAX_NODES * 2) {
    const r = walker.currentNode.parentElement.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W) out.push(walker.currentNode);
  }
  return out;
}

// Release of the boxes locked by the running effect (switching again before
// it ends releases them first, so a lock is never measured as the "real" size).
let releaseLocks = null;

// Locks the size of the nearest non-inline box around each text node (its
// final, already-rendered size) and returns a function that restores them.
function lockBoxes(nodes) {
  const boxes = new Map(); // box → true while all its text is on one line
  for (const node of nodes) {
    let el = node.parentElement;
    while (el && el !== document.body && getComputedStyle(el).display === "inline") el = el.parentElement;
    if (!el || el === document.body) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top)));
    boxes.set(el, (boxes.get(el) ?? true) && tops.size <= 1);
  }
  const saved = [];
  for (const [el, oneLine] of boxes) {
    const w = el.offsetWidth, h = el.offsetHeight; // layout size (ignores transforms)
    if (!w || !h) continue;
    saved.push([el, el.style.width, el.style.height, el.style.boxSizing, el.style.whiteSpace]);
    el.style.boxSizing = "border-box";
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    if (oneLine) el.style.whiteSpace = "nowrap";
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const [el, w, h, b, ws] of saved) {
      el.style.width = w;
      el.style.height = h;
      el.style.boxSizing = b;
      el.style.whiteSpace = ws;
    }
    if (releaseLocks === release) releaseLocks = null;
  };
  releaseLocks = release;
  return release;
}

function animate(nodes) {
  const items = nodes.slice(0, MAX_NODES).map((node) => {
    const final = node.nodeValue;
    const chars = Array.from(final); // code points (keeps emoji / CJK intact)
    // Random characters come from the text's own letters too, so Japanese
    // scrambles with Japanese, Arabic with Arabic…
    const own = chars.filter((c) => c.trim());
    // Noise from the text's own letters (same font, similar widths) plus a
    // few neutral glyphs for Latin text, so its length barely changes.
    const pool = /^[\x00-\x7F]*$/.test(final) ? own.concat(Array.from(GLYPHS)) : own;
    const n = chars.length;
    // Each character settles at its own moment: left-to-right with jitter.
    const settle = chars.map((_, i) => (0.25 + 0.6 * (i / Math.max(1, n - 1)) + Math.random() * 0.15) * DURATION);
    return { node, final, chars, pool, settle, last: null, done: false };
  });
  if (!items.length) return;
  releaseLocks?.(); // a previous switch still running
  const release = lockBoxes(items.map((it) => it.node));

  const start = performance.now();
  let lastSwap = 0;
  const frame = (now) => {
    const t = now - start;
    // New random characters every ~40 ms (every frame looks like noise).
    const swap = now - lastSwap > 40;
    if (swap) lastSwap = now;
    let running = false;
    for (const it of items) {
      if (it.done) continue;
      // React changed the node under us → its value wins, stop touching it.
      if (it.last !== null && it.node.nodeValue !== it.last) { it.done = true; continue; }
      if (!it.node.isConnected) { it.done = true; continue; }
      if (t >= DURATION) {
        it.node.nodeValue = it.final;
        it.done = true;
        continue;
      }
      running = true;
      if (!swap && it.last !== null) continue;
      const text = it.chars
        .map((c, i) => (!c.trim() || t >= it.settle[i] ? c : it.pool[(Math.random() * it.pool.length) | 0]))
        .join("");
      it.node.nodeValue = text;
      it.last = text;
    }
    if (running) requestAnimationFrame(frame);
    else release();
  };
  requestAnimationFrame(frame);
}

// Drop-in replacement for i18n.changeLanguage(lang) with the effect.
export function changeLanguageScrambled(lang) {
  if (reducedMotion() || lang === i18n.resolvedLanguage) return i18n.changeLanguage(lang);
  const before = new Map(visibleTextNodes().map((n) => [n, n.nodeValue]));
  const result = i18n.changeLanguage(lang);
  // Two frames: React has re-rendered and the DOM holds the new text.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const changed = visibleTextNodes().filter((n) => !before.has(n) || before.get(n) !== n.nodeValue);
    animate(changed);
  }));
  return result;
}
