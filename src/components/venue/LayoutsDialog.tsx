import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {LayoutReview} from '../../engine/workspace/promotion-review';
import {useProjectStore} from '../../store/useProjectStore';
import {useWorkspaceStore} from '../../store/useWorkspaceStore';
import type {PhaseKey} from '../../types';
import type {Layout, LayoutState} from '../../types/venue';
import {PromotionGateDialog, type GateAction, type GateOutcome} from './PromotionGateDialog';
import {
  isLayoutStale,
  LAYOUT_PHASES,
  LAYOUT_STATE_LABELS,
  REVIEW_DISCLAIMER,
  STALE_LABEL,
} from './venueLabels';

export interface LayoutsDialogProps {
  open: boolean;
  onClose: () => void;
}

type NameEditor =
  | {mode: 'blank'; value: string}
  | {mode: 'duplicate'; sourceId: string; value: string}
  | {mode: 'rename'; layoutId: string; value: string};

const STATE_ORDER: Record<LayoutState, number> = {current: 0, proposal: 1, draft: 2, archived: 3};

/**
 * Layouts (Distribuciones) of the active event and venue slot (`#layouts-dialog`,
 * OX-04): open, rename, duplicate, create blank, set the covered operational
 * phases, propose, confirm as current, review against the current venue and archive.
 */
export const LayoutsDialog: React.FC<LayoutsDialogProps> = ({open, onClose}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const data = useWorkspaceStore((s) => s.data);
  const layouts = useWorkspaceStore((s) => s.layouts);
  const venues = useWorkspaceStore((s) => s.venues);
  const activeEventId = useWorkspaceStore((s) => s.activeEventId);
  const activeLayoutIds = useWorkspaceStore((s) => s.activeLayoutIds);
  const editMode = useWorkspaceStore((s) => s.editMode);
  const can = useWorkspaceStore((s) => s.can);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const showToast = useProjectStore((s) => s.showToast);

  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<NameEditor | null>(null);
  const [outcome, setOutcome] = useState<GateOutcome | null>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  const event = data.events.find((e) => e.id === activeEventId) || null;
  const canEdit =
    !!event && can('event.edit', {orgId: event.orgId, projectId: event.projectId, eventId: event.id});
  const inVenueMode = editMode === 'venue';
  const openId = activeLayoutIds[activeVenue];

  const list = useMemo(
    () =>
      layouts
        .filter((l) => l.eventId === activeEventId && l.site === activeVenue)
        .sort(
          (a, b) =>
            STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.createdAt.localeCompare(b.createdAt)
        ),
    [layouts, activeEventId, activeVenue]
  );

  const ws = () => useWorkspaceStore.getState();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const showReview = (action: GateAction, layout: Layout, review: LayoutReview | null) => {
    if (!review) return;
    if (!review.gate.ok) {
      setOutcome({action, layoutName: layout.name, review});
      return;
    }
    const others = review.gate.otherCritical.length;
    const tail = others
      ? ` Quedan ${others} bloqueo(s) crítico(s) que no impiden confirmar: revísalos en «Revisar riesgos».`
      : '';
    const head =
      action === 'current'
        ? `«${layout.name}» es ahora la distribución vigente.`
        : action === 'proposal'
          ? `«${layout.name}» queda como propuesta.`
          : `«${layout.name}» revisada con el recinto actual.`;
    showToast(`${head} ${REVIEW_DISCLAIMER}${tail}`);
  };

  const submitEditor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor || !editor.value.trim()) return;
    const current = editor;
    void run(async () => {
      if (current.mode === 'rename') {
        await ws().renameLayout(current.layoutId, current.value);
      } else {
        const created = await ws().createLayout(
          current.mode === 'blank'
            ? {kind: 'blank', name: current.value}
            : {kind: 'duplicate', name: current.value, sourceId: current.sourceId}
        );
        if (!created) return;
        await ws().openLayout(created.id);
      }
      setEditor(null);
    });
  };

  const togglePhase = (layout: Layout, phase: PhaseKey, checked: boolean) => {
    const next = checked
      ? LAYOUT_PHASES.map((p) => p.key).filter((k) => k === phase || layout.phases.includes(k))
      : layout.phases.filter((k) => k !== phase);
    void run(() => ws().setLayoutPhases(layout.id, next));
  };

  const editorLabel =
    editor?.mode === 'rename'
      ? 'Nuevo nombre de la distribución'
      : editor?.mode === 'duplicate'
        ? 'Nombre de la copia'
        : 'Nombre de la nueva distribución';

  return (
    <>
      <dialog id="layouts-dialog" ref={dlgRef} onClose={() => open && onClose()}>
        <div id="layouts-body">
          <h2>Distribuciones</h2>
          <p>
            Una distribución es todo lo que se coloca sobre el recinto para este
            evento. El recinto (perímetro, accesos, subsuelo y elementos
            permanentes) es común a todas.
          </p>
          <p className="venue-notice" role="note">
            Solo puede haber una distribución vigente por fase operativa en este
            recinto: al confirmar otra, la anterior pasa a propuesta. Proponer o
            confirmar repite sobre esta distribución la revisión orientativa de
            perímetro, accesos de emergencia, subsuelo y rutas sanitarias A/B/C;
            no certifica la seguridad del evento.
          </p>
          {inVenueMode && (
            <p className="venue-notice is-warning" role="note">
              Termina la edición del recinto para abrir, crear o duplicar distribuciones.
            </p>
          )}
          {!canEdit && (
            <p className="venue-notice is-warning" role="note">
              Tu perfil no permite modificar las distribuciones de este evento
              (permisos orientativos, modo local).
            </p>
          )}

          {list.length === 0 ? (
            <p className="members-empty">Este evento no tiene distribuciones en este espacio.</p>
          ) : (
            <div className="layouts-list">
              {list.map((l) => {
                const isOpen = l.id === openId;
                const stale = isLayoutStale(l, venues);
                const archived = l.state === 'archived';
                const venueName = venues.find((v) => v.id === l.venueId)?.name;
                return (
                  <article
                    key={l.id}
                    className={`note-card layout-row${isOpen ? ' is-open' : ''}${archived ? ' is-archived' : ''}`}
                    data-layout-id={l.id}
                    data-layout-state={l.state}
                  >
                    <div className="layout-row-head">
                      <b className="layout-name">{l.name}</b>
                      <span className={`layout-state-badge state-${l.state}`}>
                        {LAYOUT_STATE_LABELS[l.state]}
                      </span>
                      <span className="layout-version" title="Versión de la distribución">
                        v{l.version}
                      </span>
                      {isOpen && <span className="layout-open-chip">Abierta</span>}
                      {stale && !archived && (
                        <span className="layout-stale-badge" title={`El recinto «${venueName ?? ''}» ha cambiado desde la última revisión de esta distribución.`}>
                          {STALE_LABEL}
                        </span>
                      )}
                    </div>
                    <fieldset className="layout-phases" disabled={!canEdit || busy || archived}>
                      <legend>Fases operativas</legend>
                      {LAYOUT_PHASES.map((p) => (
                        <label key={p.key}>
                          <input
                            type="checkbox"
                            data-phase={p.key}
                            checked={l.phases.includes(p.key)}
                            onChange={(e) => togglePhase(l, p.key, e.target.checked)}
                          />{' '}
                          {p.label}
                        </label>
                      ))}
                    </fieldset>
                    <div className="layout-actions">
                      {!archived && (
                        <button
                          type="button"
                          className="layout-open"
                          disabled={isOpen || inVenueMode || busy}
                          onClick={() =>
                            void run(async () => {
                              await ws().openLayout(l.id);
                            })
                          }
                        >
                          Abrir
                        </button>
                      )}
                      {!archived && (
                        <button
                          type="button"
                          className="layout-rename"
                          disabled={!canEdit || busy}
                          onClick={() => setEditor({mode: 'rename', layoutId: l.id, value: l.name})}
                        >
                          Renombrar
                        </button>
                      )}
                      <button
                        type="button"
                        className="layout-duplicate"
                        disabled={!canEdit || inVenueMode || busy}
                        onClick={() =>
                          setEditor({mode: 'duplicate', sourceId: l.id, value: `${l.name} (copia)`})
                        }
                      >
                        Duplicar
                      </button>
                      {stale && !archived && (
                        <button
                          type="button"
                          className="layout-review"
                          disabled={!canEdit || busy}
                          onClick={() =>
                            void run(async () => showReview('review', l, await ws().reviewLayout(l.id)))
                          }
                        >
                          Revisar con el recinto actual
                        </button>
                      )}
                      {l.state === 'draft' && (
                        <button
                          type="button"
                          className="layout-propose"
                          disabled={!canEdit || busy}
                          onClick={() =>
                            void run(async () =>
                              showReview('proposal', l, await ws().promoteLayout(l.id, 'proposal'))
                            )
                          }
                        >
                          Proponer
                        </button>
                      )}
                      {!archived && l.state !== 'current' && (
                        <button
                          type="button"
                          className="layout-promote-current"
                          disabled={!canEdit || busy}
                          onClick={() =>
                            void run(async () =>
                              showReview('current', l, await ws().promoteLayout(l.id, 'current'))
                            )
                          }
                        >
                          Confirmar como vigente
                        </button>
                      )}
                      {!archived && !isOpen && (
                        <button
                          type="button"
                          className="layout-archive"
                          disabled={!canEdit || busy}
                          onClick={() => void run(() => ws().archiveLayout(l.id))}
                        >
                          Archivar
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {editor ? (
            <form id="layout-name-form" className="layout-name-form" onSubmit={submitEditor}>
              <label>
                {editorLabel}
                <input
                  id="layout-name"
                  maxLength={100}
                  required
                  autoFocus
                  value={editor.value}
                  onChange={(e) => setEditor({...editor, value: e.target.value})}
                />
              </label>
              <div className="layout-actions">
                <button
                  type="submit"
                  id="layout-name-ok"
                  className="dark"
                  disabled={busy || !editor.value.trim()}
                >
                  {editor.mode === 'rename' ? 'Guardar nombre' : 'Crear y abrir'}
                </button>
                <button type="button" id="layout-name-cancel" onClick={() => setEditor(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              id="layout-new-blank"
              disabled={!canEdit || inVenueMode || busy}
              onClick={() => setEditor({mode: 'blank', value: 'Nueva distribución'})}
            >
              Nueva distribución en blanco
            </button>
          )}
        </div>
        <form method="dialog">
          <button type="submit" id="layouts-close">
            Cerrar
          </button>
        </form>
      </dialog>
      <PromotionGateDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </>
  );
};
