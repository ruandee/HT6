/**
 * Bottom sheet, the mobile equivalent of the web app's centered modal. Slides up from the
 * bottom edge, backdrop dims and blurs the canvas beneath, grab handle at the top, and a
 * downward drag or backdrop tap dismisses it.
 *
 * Framer owns the gesture now. The hand-rolled version tracked touch deltas by hand and snapped
 * back to rest with no animation at all; this one rubber-bands at the top of its range and
 * springs home, and it can animate OUT, which a mount-time CSS keyframe never could.
 *
 * The drag starts from the handle only (dragControls + dragListener={false}) so that a sheet
 * taller than the viewport still scrolls normally under your thumb.
 */
import { motion, useAnimationControls, useDragControls, type PanInfo } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { EASE } from './motion';

/** past this far down, let go and it closes */
const DISMISS_DISTANCE = 110;
/** Framer reports px/s; project roughly 100ms along the release trajectory. */
const PROJECTION_SECONDS = 0.1;

export function Sheet({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const animation = useAnimationControls();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void animation.start({
      y: 0,
      transition: { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 },
    });
    dialog.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [animation]);

  async function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y + info.velocity.y * PROJECTION_SECONDS <= DISMISS_DISTANCE) return;
    await animation.start({
      y: '100%',
      transition: {
        type: 'spring',
        bounce: 0.1,
        duration: 0.3,
        velocity: Math.max(0, info.velocity.y),
      },
    });
    onClose();
  }

  return (
    <motion.div
      className="msheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <motion.div
        ref={dialog}
        className="msheet glass glass--strong"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={{ y: '100%' }}
        animate={animation}
        exit={{ y: '100%', transition: { duration: 0.26, ease: EASE } }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        /* nothing upward, elastic downward: it follows your thumb toward dismissal but
           refuses to be pulled up past its resting edge */
        dragElastic={{ top: 0, bottom: 0.55 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="msheet__handle"
          onPointerDown={(e) => controls.start(e)}
          aria-hidden
        >
          <span className="msheet__grab" />
        </span>
        {children}
      </motion.div>
    </motion.div>
  );
}
