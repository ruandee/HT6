/**
 * On-screen device shell, for demoing on a laptop projected to a room. On a real phone (or any
 * narrow viewport) the frame drops away entirely via CSS and the app fills the screen. The same
 * build is both the stage prop and the real thing.
 */
import { useEffect, useState } from 'react';

function clock(): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const [time, setTime] = useState(clock);

  useEffect(() => {
    const t = setInterval(() => setTime(clock()), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="stage">
      {/* the orbs live outside the phone too, so the projected backdrop is warm, not flat grey */}
      <div className="stage__orbs" aria-hidden>
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <div className="stage__caption" aria-hidden>
        <span className="brand-dots">
          <i />
          <i />
        </span>
        hora diner app
      </div>

      <div className="phone">
        <div className="phone__screen">
          <div className="statusbar">
            <span className="statusbar__time">{time}</span>
            <span className="statusbar__right">
              <SignalIcon />
              <WifiIcon />
              <BatteryIcon />
            </span>
          </div>
          <div className="island" aria-hidden />
          <div className="viewport">{children}</div>
          <div className="homebar" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden>
      <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
      <rect x="4.6" y="5.2" width="3" height="5.8" rx="1" />
      <rect x="9.2" y="2.6" width="3" height="8.4" rx="1" />
      <rect x="13.8" y="0" width="3" height="11" rx="1" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden>
      <path
        d="M1 3.4a10.5 10.5 0 0 1 14 0M3.6 6.2a6.7 6.7 0 0 1 8.8 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="9.4" r="1.4" fill="currentColor" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden>
      <rect
        x="0.6"
        y="0.6"
        width="22"
        height="10.8"
        rx="3.2"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.1"
      />
      <rect x="2.2" y="2.2" width="17" height="7.6" rx="2" fill="currentColor" />
      <path
        d="M24.4 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8Z"
        fill="currentColor"
        fillOpacity="0.4"
      />
    </svg>
  );
}
