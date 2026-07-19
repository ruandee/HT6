import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { UnifoldProvider } from '@unifold/connect-react';
import '@unifold/connect-react/styles.css';
import App from './App';
import './styles.css';
import { UNIFOLD_PUBLISHABLE_KEY, unifoldEnabled } from './unifold';

/**
 * UnifoldProvider is mounted only when a publishable key is configured (UNIFOLD_INTEGRATION.md §6).
 * Without a key the app runs the StubGateway flow end to end, so the demo never depends on network
 * access to Unifold — the seam is the same one app-services uses to pick UnifoldGateway vs
 * StubGateway, kept consistent on the client.
 *
 * `appearance: 'dark'` matches this app's palette so the modal doesn't arrive as a white slab.
 */
function Root({ children }: { children: ReactNode }) {
  if (!unifoldEnabled) return <>{children}</>;
  return (
    <UnifoldProvider
      publishableKey={UNIFOLD_PUBLISHABLE_KEY}
      config={{ appearance: 'dark', modalTitle: 'Claim this table' }}
    >
      {children}
    </UnifoldProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root>
      <App />
    </Root>
  </StrictMode>,
);
