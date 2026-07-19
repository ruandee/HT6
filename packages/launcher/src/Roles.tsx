/**
 * The "who are you" screen: one question, three doors into the demo.
 *
 * Why this exists as its own package rather than a route inside an app: the three surfaces are
 * three separate origins, each with its own identity on the x-user-id stub. A shared landing page
 * that navigates between them is the only thing that can sit above all three, and keeping it
 * dependency-free means it can't break the apps it launches.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { fadeUp, group } from './motion';
import { Desktop, Phone, Counter } from './Glyphs';

/**
 * Targets are env-driven so a deployed build points at real hosts; the fallbacks are the local
 * dev ports the demo runs on. Vite inlines VITE_* at build time, so a changed URL needs a redeploy,
 * not just an env edit.
 */
const URLS = {
  diner: import.meta.env.VITE_DINER_URL ?? 'http://localhost:5173',
  mobile: import.meta.env.VITE_MOBILE_URL ?? 'http://localhost:5175',
  restaurant: import.meta.env.VITE_RESTAURANT_URL ?? 'http://localhost:5174',
};

interface Role {
  key: keyof typeof URLS;
  title: string;
  glyph: JSX.Element;
}

const ROLES: Role[] = [
  { key: 'diner', title: 'A diner', glyph: <Desktop /> },
  { key: 'mobile', title: 'A diner on their phone', glyph: <Phone /> },
  { key: 'restaurant', title: 'The restaurant', glyph: <Counter /> },
];

/**
 * Liveness dots, dev only. They exist to answer "did all my terminals come up?" while setting the
 * demo up, and they work by proxying each dev server (see vite.config.ts; a direct fetch is
 * CORS-blocked). Deployed, there is no proxy and no reason to probe, so this stays off and the
 * cards just show their arrow.
 */
function useReady(): Record<string, boolean> {
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let alive = true;
    const probe = () => {
      for (const r of ROLES) {
        fetch(`/up/${r.key}`, { method: 'HEAD' })
          .then((res) => alive && setReady((p) => ({ ...p, [r.key]: res.ok })))
          .catch(() => alive && setReady((p) => ({ ...p, [r.key]: false })));
      }
    };
    probe();
    const t = setInterval(probe, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return ready;
}

export default function Roles({ onHome }: { onHome: (e: React.MouseEvent) => void }) {
  const ready = useReady();
  const reduceMotion = Boolean(useReducedMotion());
  const enter = useMemo(() => fadeUp(reduceMotion), [reduceMotion]);

  return (
    <motion.div className="shell" variants={group(0.07)} initial="hidden" animate="show">
      <motion.header className="topbar" variants={enter}>
        {/* the wordmark goes home, which is the only way back to the marketing page once
            you've walked in the door */}
        <a className="brand brand--link" href="/" onClick={onHome}>
          <span className="brand-dots">
            <i />
            <i />
          </span>
          hora
        </a>
        <div className="stat-label">tokenized reservations</div>
      </motion.header>

      <motion.div className="eyebrow" variants={enter}>
        Pick a seat
      </motion.div>

      <motion.h1 className="headline" variants={enter}>
        Who are <span className="script">you</span>?
      </motion.h1>

      <motion.div className="roles" variants={group(0.08)}>
        {ROLES.map((r) => (
          <motion.a
            key={r.key}
            className="glass role"
            href={URLS[r.key]}
            variants={enter}
            // no target=_blank: during the demo you want this window to *become* the app.
            // Middle-click still opens a new one when you're setting the profiles up.
          >
            <span className="role__glyph">{r.glyph}</span>
            <span className="role__title">{r.title}</span>

            {ready[r.key] ? (
              <span className="role__ready" title="dev server is up">
                <i />
              </span>
            ) : (
              <span className="role__arrow">&#8594;</span>
            )}
          </motion.a>
        ))}
      </motion.div>

      <motion.p className="footnote" variants={enter}>
        One table per person per service window, so the desktop and phone diners are two
        different people, and both can hold a table on the same night.
      </motion.p>
    </motion.div>
  );
}
