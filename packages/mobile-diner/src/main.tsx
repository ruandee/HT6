import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneFrame } from './PhoneFrame';
import App from './App';
// the shared design system: tokens, wash, glass, type ramp
import '@ttr/design/base.css';
import './styles.css';
import './mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhoneFrame>
      <App />
    </PhoneFrame>
  </StrictMode>,
);
