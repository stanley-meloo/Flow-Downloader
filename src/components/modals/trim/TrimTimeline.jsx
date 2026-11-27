// Trim mode — the timeline block: the strip (filmstrip, handles, zoom) and,
// under it, the start / end times, the length and the reset button.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { RotateCcwIcon as RotateCcw } from "../../ui/AnimatedIcons";
import { formatClock } from "../../../utils/trim";
import { Strip } from "./Strip";
import { MIN_LEN, clamp, cutBounds, roundSec, trimWindows } from "./shared";

// ---------------------------------------------------------------------------
// Timeline + the controls under it
// ---------------------------------------------------------------------------
export function TrimTimeline({ duration, storyboard, trim, setTrim, playhead, player, cutApi, url, getWaveform, formatType, onScrub, onSeek, onReset, active }) {
  const { t } = useTranslation();
  const { start, end } = trim;
  const windows = trimWindows(trim);
  const total = windows.reduce((s, [a, b]) => s + (b - a), 0);

  const others = trim.others || [];
  const [lo, hi] = cutBounds(trim, duration);
  const setRange = (a, b) => setTrim((p) => ({ ...p, start: a, end: b }));
  // Multiple cuts (right-click on the timeline): each becomes its own file.
  // Another cut becomes the edited one when clicked.
  const activate = (i) => setTrim((p) => {
    const list = [...(p.others || [])];
    const [r] = list.splice(i, 1);
    if (!r) return p;
    return { ...p, start: r.start, end: r.end, others: [...list, { start: p.start, end: p.end }] };
  });
  // New cut around time `tm`, inside the free gap there (a tenth of what's
  // in view, at least MIN_LEN, never over another cut). null = no room.
  const addCut = (tm, viewLen) => {
    const all = [[trim.start, trim.end], ...others.map((r) => [r.start, r.end])].sort((a, b) => a[0] - b[0]);
    if (all.some(([a, b]) => tm > a && tm < b)) return null; // on a cut
    let gapS = 0, gapE = duration;
    for (const [a, b] of all) { if (b <= tm) gapS = Math.max(gapS, b); if (a >= tm) gapE = Math.min(gapE, a); }
    if (gapE - gapS < MIN_LEN) return null;
    const len = Math.min(gapE - gapS, Math.max(MIN_LEN, Math.round(viewLen / 10)));
    let a = Math.round(tm - len / 2);
    a = clamp(a, Math.ceil(gapS), Math.floor(gapE - len));
    const b = Math.min(gapE, a + len);
    if (b - a < MIN_LEN - 0.001) return null;
    setTrim((p) => ({ ...p, start: a, end: b, others: [...(p.others || []), { start: p.start, end: p.end }] }));
    onSeek?.(a);
    return [a, b];
  };
  // Remove the cut at time `tm` (when there's more than one).
  const removeCutAt = (tm) => setTrim((p) => {
    const list = p.others || [];
    if (!list.length) return p;
    if (tm >= p.start && tm <= p.end) { // the edited one: the nearest other takes over
      const mid = (p.start + p.end) / 2;
      let k = 0;
      list.forEach((r, i) => { if (Math.abs((r.start + r.end) / 2 - mid) < Math.abs((list[k].start + list[k].end) / 2 - mid)) k = i; });
      const rest = list.filter((_, i) => i !== k);
      return { ...p, start: list[k].start, end: list[k].end, others: rest };
    }
    return { ...p, others: list.filter((r) => !(tm >= r.start && tm <= r.end)) };
  });

  return (
    <div>
      <Strip
        duration={duration}
        storyboard={storyboard}
        windows={windows}
        start={start}
        end={end}
        others={others}
        lo={lo}
        hi={hi}
        playhead={playhead}
        onRange={setRange}
        onActivate={activate}
        onAddCut={addCut}
        onRemoveCut={removeCutAt}
        cutApi={cutApi}
        url={url}
        getWaveform={getWaveform}
        formatType={formatType}
        onScrub={onScrub}
        onSeek={onSeek}
      />

      {/* Start · [length · reset] · End  (cuts are always the fast
          "approximate" kind: the times are whole seconds anyway) */}
      {/* 3 columns (1fr · auto · 1fr): the middle stays centred whatever the
          width of the start / end times on the sides. */}
      <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="justify-self-start">
        <TimeField
          value={start}
          label={t('trim.start', { defaultValue: 'Start' })}
          onCommit={(v) => { const s = clamp(v, lo, end - MIN_LEN); setRange(s, end); onSeek?.(s); }}
        />
        </div>

        <div className="flex items-center gap-2 min-w-0">
          {/* Length of the cut */}
          {/* leading-none + 1 px down: Poppins sits high in its line box, so this
              puts the caps' middle on the reset icon's middle */}
          <span className="flex items-baseline gap-1.5 whitespace-nowrap px-1 leading-none translate-y-px">
            <span className="text-[16px] font-bold text-zinc-300 uppercase tracking-wide">{t('trim.length', { defaultValue: 'Length' })}</span>
            {/* As wide as the longest possible length (the video's), so the
                label and the reset button don't shift as the digits change */}
            <span className="text-[16px] font-black text-white tabular-nums text-left" style={{ minWidth: `${formatClock(duration).replace(/:/g, '').length + formatClock(duration).split(':').length * 0.3 - 0.3}ch` }}>{formatClock(total)}</span>
          </span>


          {/* Reset: slides in (its width opens from 0), smoothly pushing the
              items next to it aside; slides out the same way. */}
          <AnimatePresence initial={false}>
          {active && (
          <motion.div
            key="reset"
            className="flex overflow-hidden"
            initial={{ width: 0, marginLeft: -8, opacity: 0 }}
            animate={{ width: 32, marginLeft: -6, opacity: 1 }}
            exit={{ width: 0, marginLeft: -8, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              type="button"
              onClick={onReset}
              data-tooltip={t('trim.reset', { defaultValue: 'Reset cut' })}
              aria-label={t('trim.reset', { defaultValue: 'Reset cut' })}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <RotateCcw size={19} />
            </button>
          </motion.div>
          )}
          </AnimatePresence>
        </div>

        <div className="justify-self-end flex">
        <TimeField
          value={end}
          label={t('trim.end', { defaultValue: 'End' })}
          align="right"
          onCommit={(v) => { const e = clamp(v, start + MIN_LEN, hi); setRange(start, e); onSeek?.(e); }}
        />
        </div>
      </div>
    </div>
  );
}

// Time typed by hand; applied on Enter / leaving the field, reverted if invalid.
// Typed text → seconds: "2:22", "2:2", "1:02:33", "83"… (minutes / seconds
// above 59 carry over; an empty group counts as 0). null when no digits.
function typedSeconds(text) {
  if (!/\d/.test(text)) return null;
  return text.split(":").slice(-3).reduce((total, n) => total * 60 + (parseInt(n, 10) || 0), 0);
}

// Time typed by hand — edits like a normal text field (type and delete
// anywhere, the caret stays where it is), with two rules: only digits and ":"
// can be typed, and a single Backspace / Delete never removes a ":" (the
// caret just steps over it), so the time keeps its separators. Clicking puts
// the caret where the click was; Tab selects it all.
// Applied on Enter / leaving the field (as m:ss); Escape restores it.
function TimeField({ value, label, onCommit, dim, align = "left" }) {
  const [text, setText] = useState(formatClock(value));
  const [editing, setEditing] = useState(false);
  const pointerFocus = useRef(false);
  useEffect(() => { if (!editing) setText(formatClock(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = typedSeconds(text);
    if (v == null) setText(formatClock(value));
    else onCommit(roundSec(v)); // the field then shows the (clamped) value it gets back
  };

  const onKeyDown = (e) => {
    const el = e.currentTarget;
    if (e.key === "Enter") { e.preventDefault(); el.blur(); return; }
    if (e.key === "Escape") { e.preventDefault(); setText(formatClock(value)); setEditing(false); el.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // copy / paste / select all…
    if (e.key.length === 1 && !/[\d:]/.test(e.key)) { e.preventDefault(); return; } // letters etc.
    // A lone ":" next to the caret isn't deleted: the caret steps over it.
    const a = el.selectionStart, b = el.selectionEnd;
    if (a !== b || a == null) return;
    if (e.key === "Backspace" && text[a - 1] === ":") { e.preventDefault(); el.setSelectionRange(a - 1, a - 1); }
    else if (e.key === "Delete" && text[a] === ":") { e.preventDefault(); el.setSelectionRange(a + 1, a + 1); }
  };

  return (
    <input
      value={text}
      aria-label={label}
      data-tooltip={label}
      inputMode="numeric"
      spellCheck={false}
      onPointerDown={() => { pointerFocus.current = true; }}
      onFocus={(e) => {
        setEditing(true);
        // Clicked: the caret goes where the click was. Tab: select it all.
        if (!pointerFocus.current) e.target.select();
        pointerFocus.current = false;
      }}
      onKeyDown={onKeyDown}
      onChange={(e) => setText(e.target.value.replace(/[^\d:]/g, "").slice(0, 9))}
      onBlur={commit}
      style={{ width: `calc(${Math.max(4, text.length)}ch + 16px)` }} /* hugs the time: the highlight is only as wide as the text */
      className={`shrink-0 h-8 bg-transparent border border-transparent hover:bg-white/5 focus:bg-white/5 focus:border-(--accent)/60 rounded-lg px-2 ${align === "right" ? "text-right -mr-2" : "text-left -ml-2"} text-[13px] font-bold text-white tabular-nums outline-none transition-colors ${dim ? "opacity-60" : ""}`}
    />
  );
}
