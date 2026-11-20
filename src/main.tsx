import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles/index.css';

// Register global error handlers matching the prototype's safety toast
window.addEventListener('error', () => {
  const e = document.getElementById('toast');
  if (e) {
    e.hidden = false;
    e.textContent =
      'Se produjo un error. Guarda tu proyecto y vuelve a abrir el archivo en una versión reciente de Chrome o Edge.';
  }
});

window.addEventListener('unhandledrejection', () => {
  const e = document.getElementById('toast');
  if (e) {
    e.hidden = false;
    e.textContent =
      'No se pudo iniciar una función. Abre el archivo descargado en Chrome o Edge.';
  }
});

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
