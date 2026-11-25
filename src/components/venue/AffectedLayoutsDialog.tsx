import React, {useEffect, useRef} from 'react';
import {useWorkspaceStore} from '../../store/useWorkspaceStore';
import {LAYOUT_STATE_LABELS} from './venueLabels';

/**
 * Layouts affected by a venue change (`#affected-dialog`, OX-04 D8). Shown after
 * leaving «Editar recinto» when the venue version changed. Nothing is modified:
 * each listed layout keeps «Recinto modificado: revisar» until it is reviewed.
 */
export const AffectedLayoutsDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const notice = useWorkspaceStore((s) => s.affectedNotice);
  const layouts = useWorkspaceStore((s) => s.layouts);
  const venues = useWorkspaceStore((s) => s.venues);
  const events = useWorkspaceStore((s) => s.data.events);
  const open = !!notice;

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  const venue = notice ? venues.find((v) => v.id === notice.venueId) : undefined;
  const affected = notice ? layouts.filter((l) => notice.layoutIds.includes(l.id)) : [];

  return (
    <dialog
      id="affected-dialog"
      ref={dlgRef}
      onClose={() => open && useWorkspaceStore.getState().dismissAffectedNotice()}
    >
      {notice && (
        <div id="affected-body">
          <h2>Recinto «{notice.venueName}» modificado</h2>
          <p>
            El recinto ha cambiado (versión {venue?.version ?? '—'}). Estas
            distribuciones no se han modificado; revísalas antes de confirmarlas.
          </p>
          {affected.length === 0 ? (
            <p className="members-empty">Ninguna otra distribución usa este recinto.</p>
          ) : (
            <ul className="affected-list">
              {affected.map((l) => (
                <li key={l.id} data-layout-id={l.id}>
                  <b>{l.name}</b>
                  <span>{events.find((e) => e.id === l.eventId)?.name ?? 'Evento no visible'}</span>
                  <span className={`layout-state-badge state-${l.state}`}>
                    {LAYOUT_STATE_LABELS[l.state]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form method="dialog">
        <button type="submit" id="affected-close">
          Cerrar
        </button>
      </form>
    </dialog>
  );
};
