import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/dark-jp-kit.css';
import App from './App';
import { attachAndroidEdgeStretch } from './utils/android-overscroll';

if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

requestAnimationFrame(() => {
  attachAndroidEdgeStretch();
});
