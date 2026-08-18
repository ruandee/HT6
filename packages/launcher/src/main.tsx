import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// the shared design system: tokens, wash, glass, type ramp
import '@ttr/design/base.css';
import './styles.css';

/**
 * The landing page opens by measuring where the wordmark's dots come to rest, and that measurement
 * is only correct from the top of the page. Browsers restore scroll position on reload, and they
 * do it after the app has mounted — so without this, reloading while scrolled down would take the
 * measurement against a viewport the reader is about to be yanked away from.
 *
 * Nothing here wants the restored position anyway: both routes are entrances, and the one that
 * navigates already scrolls itself to the top.
 */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
