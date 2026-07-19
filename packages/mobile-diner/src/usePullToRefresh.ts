/**
 * Pull-to-refresh. Only engages when the scroller is already at the top, so it never fights a
 * normal scroll. Returns the props to spread onto the scrolling element plus the distance to
 * render the spinner well, matching the rubber-band feel of a native list.
 */
import { useRef, useState, type TouchEvent, type UIEvent } from 'react';

const THRESHOLD = 68;
const MAX = 96;

export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const atTop = useRef(true);
  const start = useRef<number | null>(null);

  function cancelGesture() {
    start.current = null;
    setDragging(false);
    if (!spinning) setPull(0);
  }

  function onScroll(e: UIEvent<HTMLDivElement>) {
    atTop.current = e.currentTarget.scrollTop <= 0;
  }

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (spinning || !atTop.current || e.touches.length !== 1) {
      cancelGesture();
      return;
    }
    start.current = e.touches[0].clientY;
    setDragging(true);
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 1) {
      cancelGesture();
      return;
    }
    if (start.current === null || spinning) return;
    const dy = e.touches[0].clientY - start.current;
    // resistance curve: the further you pull, the harder it gets
    setPull(dy > 0 ? Math.min(MAX, dy * 0.55) : 0);
  }

  async function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length > 0) {
      cancelGesture();
      return;
    }
    start.current = null;
    setDragging(false);
    if (pull >= THRESHOLD && !spinning) {
      setSpinning(true);
      setPull(THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setSpinning(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }

  return {
    pull,
    spinning,
    dragging,
    armed: pull >= THRESHOLD,
    handlers: { onScroll, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancelGesture },
  };
}
