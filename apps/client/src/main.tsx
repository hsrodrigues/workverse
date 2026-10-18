import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Pixel fonts must be ready before Phaser rasterises any text.
const fontReady = Promise.race([
  Promise.all([
    document.fonts?.load('9px "Pixelify Sans"'),
    document.fonts?.load('600 12px "Pixelify Sans"'), // texto do mundo (nomes e baloes)
  ]).catch(() => undefined),
  new Promise((r) => setTimeout(r, 1500)),
]);

fontReady.then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
