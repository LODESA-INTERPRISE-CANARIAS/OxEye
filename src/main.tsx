import React, {Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {rewriteLegacyLocation} from './logistics/shell/address';
import {pendingSupplierLink} from './logistics/supplier/link';
import './styles/index.css';

// Gestor links made before 2026-11-28 (`#logistica…`, in mails, installed
// apps and bookmarks) move to their clean address before anything reads it.
// Supplier links were already read (and their token taken off) when
// `supplier/link` loaded: it understands both forms.
rewriteLegacyLocation();

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
