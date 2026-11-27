import React, {Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {pendingSupplierLink} from './logistics/supplier/link';
import './styles/index.css';

// A supplier link opens only the supplier's form: never the hub, the map or
// the simulation (Revisión 1 · E7).
const SupplierRoot = React.lazy(() => import('./logistics/SupplierRoot'));

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
  createRoot(rootEl).render(
    pendingSupplierLink() ? (
      <Suspense fallback={null}>
        <SupplierRoot />
      </Suspense>
    ) : (
      <App />
    ),
  );
}
