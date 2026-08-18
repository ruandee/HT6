/**
 * Two screens behind one origin: the landing page at `/`, and the "who are you" role picker at
 * `/demo`.
 *
 * Routing is ~15 lines of history API rather than a router dependency. This package's whole
 * premise is that it can't break the apps it launches, and two static routes don't justify
 * pulling in a routing library to keep that promise. `vercel.json` already rewrites every path
 * to index.html, so a cold load of /demo lands here and reads the pathname.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import Home from './Home';
import Roles from './Roles';

/**
 * The write-up is its own route and carries a page of build-time-typeset equations (~90kB of SVG),
 * which nobody who came to see the demo needs on first paint. Split out, it loads only when the
 * "Read the Devpost" button is clicked — the same reasoning that lazy-loads the decay demo.
 */
const Writeup = lazy(() => import('./Writeup'));

type Route = 'home' | 'demo' | 'writeup';

const routeOf = (path: string): Route =>
  path.startsWith('/demo') ? 'demo' : path.startsWith('/writeup') ? 'writeup' : 'home';

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));

  // back/forward have to work: these are real URLs, and a demo where the browser Back button
  // leaves the page is a demo that loses its audience.
  useEffect(() => {
    const onPop = () => setRoute(routeOf(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * Intercept only the plain left-click. Modified clicks and middle-clicks fall through to the
   * browser so "open in new tab" still works — which is how the demo's two browser profiles get
   * set up in the first place.
   */
  const go = (to: Route, path: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState({}, '', path);
    setRoute(to);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="orbs orbs--poster orbs--drift">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      {/* mode="wait" so the outgoing screen clears before the next arrives; crossfading two
          full-page layouts on top of each other just reads as a flash */}
      <AnimatePresence mode="wait">
        {route === 'home' ? (
          <Home key="home" onEnter={go('demo', '/demo')} onWriteup={go('writeup', '/writeup')} />
        ) : route === 'writeup' ? (
          // fallback is the empty reading column, so the page's width is reserved while the chunk
          // arrives and there is no layout jump when the text lands
          <Suspense key="writeup" fallback={<div className="writeup" aria-busy="true" />}>
            <Writeup onHome={go('home', '/')} onDemo={go('demo', '/demo')} />
          </Suspense>
        ) : (
          <Roles key="demo" onHome={go('home', '/')} />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
