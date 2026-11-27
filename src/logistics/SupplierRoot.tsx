/**
 * Revisión 1 · E7: the page a supplier link opens, on its own. `main.tsx`
 * renders this (lazily) instead of the OxEye app when
 * `pendingSupplierLink()` (supplier/link.ts, a tiny module read before any
 * routing) is set, so a supplier never mounts the hub, the map or the
 * simulation: nothing of it is loaded, shown or reachable (screen readers,
 * print, select-all).
 *
 * Same look as inside the Gestor (`.lx`, the supplier form); no session, no
 * store boot, no device copy. «Cerrar» after sending ends here, never on the
 * Gestor's login.
 */
import React from 'react';
import '../styles/logistics/index.css';
import {SupplierApp} from './supplier/SupplierApp';
import {useSupplierLink} from './supplier/useSupplierLink';
import {ContourTexture, EyeMark, Icon} from './ui';

const SupplierRoot: React.FC = () => {
  const link = useSupplierLink();
  if (link) {
    return (
      <div
        className="lx"
        id="logistics-app"
        role="region"
        aria-label="Petición de presupuesto"
      >
        <SupplierApp link={link} />
      </div>
    );
  }
  // «Cerrar» after sending: the link is gone; this page stays the supplier's.
  return (
    <div
      className="lx"
      id="logistics-app"
      role="region"
      aria-label="Petición de presupuesto"
    >
      <div className="lx-supplier" id="lx-supplier" data-state="closed">
        <ContourTexture />
        <header className="lx-supplier__bar">
          <EyeMark size={30} />
          <div className="lx-supplier__brand">
            <strong>Petición de presupuesto</strong>
            <span>con OxEye</span>
          </div>
        </header>
        <main className="lx-supplier__card">
          <div
            className="lx-supplier__status"
            role="status"
            id="lx-supplier-closed"
          >
            <Icon name="check" size={26} />
            <p>Listo. Ya puedes cerrar esta página.</p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default SupplierRoot;
