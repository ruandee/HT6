import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// the shared design system: tokens, wash, glass, type ramp
import '@ttr/design/base.css';
import './styles.css';
import './lab.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
