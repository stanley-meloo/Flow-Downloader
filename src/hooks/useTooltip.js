import { useState } from 'react';

/**
 * Shared cursor-following tooltip state.
 *
 * One instance lives at the app root; every element that wants a tooltip calls
 * the returned handlers on mouse enter/move/leave. `align` / `vAlign` let the
 * caller pick which corner the bubble grows from (so it never clips offscreen).
 */
export default function useTooltip() {
  const [tooltip, setTooltip] = useState({ visible: false, text: "", x: 0, y: 0, align: "right", vAlign: "bottom" });

  const handleTooltipEnter = (e, text, align = "right", vAlign = "bottom") => {
    setTooltip({ visible: true, text, x: e.clientX, y: e.clientY, align, vAlign });
  };
  const handleTooltipMove = (e) => {
    if (tooltip.visible) setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
  };
  const handleTooltipLeave = () => {
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  return { tooltip, handleTooltipEnter, handleTooltipMove, handleTooltipLeave };
}