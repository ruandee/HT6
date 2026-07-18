/**
 * Bottom sheet — the mobile equivalent of the web app's centered modal. Slides up from the
 * bottom edge, backdrop dims and blurs the canvas beneath, grab handle at the top, and a
 * downward drag or backdrop tap dismisses it.
 */
import { useRef, useState, type ReactNode } from 'react';

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  function down(y: number) {
    start.current = y;
  }
  function move(y: number) {
    if (start.current === null) return;
    setDrag(Math.max(0, y - start.current));
  }
  function up() {
    if (drag > 110) onClose();
    else setDrag(0);
    start.current = null;
  }

  return (
    <div className="msheet-backdrop" onClick={onClose}>
      <div
        className="msheet glass glass--strong"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => down(e.touches[0]!.clientY)}
        onTouchMove={(e) => move(e.touches[0]!.clientY)}
        onTouchEnd={up}
        onPointerDown={(e) => e.pointerType === 'mouse' && down(e.clientY)}
        onPointerMove={(e) => e.pointerType === 'mouse' && move(e.clientY)}
        onPointerUp={up}
      >
        <div className="msheet__grab" />
        {children}
      </div>
    </div>
  );
}
