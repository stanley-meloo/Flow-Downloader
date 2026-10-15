import { useState, useCallback } from 'react';

/**
 * Shared tooltip state (one instance at the app root, rendered by <Tooltip>).
 *
 * The bubble is anchored to the hovered element (not the cursor): centered
 * below it, or above / to the left when there's no room (see Tooltip.jsx).
 *
 * Two ways to get a tooltip:
 *   - declarative: any element with data-tooltip="text" (optional
 *     data-tooltip-place="top|bottom|left|right", and data-tooltip-variant="text"
 *     for a sentence instead of a short label) — handled by <Tooltip>;
 *   - imperative (older call sites): enter(e, text) / move / leave handlers.
 *     The old align/vAlign arguments are accepted and ignored.
 */
export default function useTooltip() {
  const [tooltip, setTooltip] = useState({ visible: false, text: "", rect: null, place: null, source: null });

  const show = useCallback((el, text, place = null, source = "handler", variant = "label") => {
    if (!el || !text) return;
    const r = el.getBoundingClientRect();
    setTooltip({ visible: true, text, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, place, source, variant, el });
  }, []);

  const handleTooltipEnter = useCallback((e, text) => show(e.currentTarget, text), [show]);
  const handleTooltipMove = useCallback(() => {}, []); // anchored: nothing to follow
  const handleTooltipLeave = useCallback(() => setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev)), []);

  return { tooltip, show, handleTooltipEnter, handleTooltipMove, handleTooltipLeave };
}
