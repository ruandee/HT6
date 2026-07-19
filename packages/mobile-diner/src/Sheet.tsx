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
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { type ReactNode } from 'react';
import { EASE } from './motion';

/** past this far down, let go and it closes */
const DISMISS_DISTANCE = 110;
/** ...or flick it, regardless of distance travelled */
const DISMISS_VELOCITY = 600;

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const controls = useDragControls();

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
  }

  return (
    <motion.div
      className="msheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      onClick={onClose}
    >
      <motion.div
        className="msheet glass glass--strong"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.26, ease: EASE } }}
        transition={{ type: 'spring', stiffness: 380, damping: 40, mass: 0.9 }}
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
