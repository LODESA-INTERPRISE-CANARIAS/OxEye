import React, {useMemo, useState} from 'react';
import {eventDays} from '../../engine/workspace/context';
import {
  effectiveRole,
  ROLE_LABELS,
  visibleEvents,
  visibleProjects,
} from '../../engine/workspace/permissions';
import {useProjectStore} from '../../store/useProjectStore';
import {
  LOCAL_MODE_NOTICE,
  useWorkspaceStore,
} from '../../store/useWorkspaceStore';
import type {PhaseKey} from '../../types';
import type {EditMode} from '../../types/venue';
import {MembersDialog} from '../modals/MembersDialog';
import {LayoutsDialog} from '../venue/LayoutsDialog';
import {isLayoutStale, LAYOUT_STATE_LABELS, STALE_LABEL} from '../venue/venueLabels';

export interface ContextHeaderProps {
  /** Called after another event is opened so the simulation resets and the map fits. */
  onEventOpened: () => void;
}

/** Short Spanish label of the operational phase of a Jornada. */
const PHASE_LABELS: Record<PhaseKey, string> = {
  pre: 'Pre',
  event: 'Evento',
  post: 'Post',
};

/**
 * Context breadcrumb (OX-03): Proyecto › Evento › Jornada, active local user,
 * members dialog and the always-visible local-mode badge.
 */
export const ContextHeader: React.FC<ContextHeaderProps> = ({onEventOpened}) => {
  const ready = useWorkspaceStore((s) => s.ready);
  const unavailable = useWorkspaceStore((s) => s.unavailable);
  const data = useWorkspaceStore((s) => s.data);
  const allUsers = useWorkspaceStore((s) => s.allUsers);
  const activeUserId = useWorkspaceStore((s) => s.activeUserId);
  const activeOrgId = useWorkspaceStore((s) => s.activeOrgId);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeEventId = useWorkspaceStore((s) => s.activeEventId);
  const activeDayId = useWorkspaceStore((s) => s.activeDayId);
  const project = useProjectStore((s) => s.project);
  const readOnly = useProjectStore((s) => s.readOnly);
  const phase = useProjectStore((s) => s.phase);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const venues = useWorkspaceStore((s) => s.venues);
  const layouts = useWorkspaceStore((s) => s.layouts);
  const activeLayoutIds = useWorkspaceStore((s) => s.activeLayoutIds);
  const editMode = useWorkspaceStore((s) => s.editMode);
  const [membersOpen, setMembersOpen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);

  const projects = useMemo(
    () => (activeUserId ? visibleProjects(activeUserId, data) : []),
    [activeUserId, data]
  );
  const events = useMemo(
    () =>
      activeUserId && activeProjectId
        ? visibleEvents(activeUserId, data, activeProjectId)
        : [],
    [activeUserId, activeProjectId, data]
  );
  const days = useMemo(() => eventDays(project), [project]);
  // The shown Jornada must match the operational phase; if the phase was
  // changed elsewhere (phase strip), show no Jornada instead of a stale one.
  const activeDay = days.find((d) => d.id === activeDayId);
  const shownDayId =
    activeDay && (phase === 'all' || activeDay.kind === phase) ? activeDay.id : null;

  const localBadge = (
    <span
      id="ctx-local-badge"
      className="badge ctx-local-badge"
      title={LOCAL_MODE_NOTICE}
      data-tooltip={LOCAL_MODE_NOTICE}
      tabIndex={0}
      aria-label={`Modo local. ${LOCAL_MODE_NOTICE}`}
    >
      Modo local
    </span>
  );

  if (!ready || unavailable) {
    return (
      <>
        <span className="eyebrow">SAN CRISTÓBAL DE LA LAGUNA</span>
        <b>Laboratorio de eventos</b>
        <div className="ctx-meta">
          <span className="badge">REFERENCIA · EDICIÓN 21</span>
          {localBadge}
        </div>
      </>
    );
  }

  const activeEvent = data.events.find((e) => e.id === activeEventId) || null;
  const eventInActiveProject =
    activeEvent && activeEvent.projectId === activeProjectId ? activeEvent : null;
  const orgName =
    data.organizations.find((o) => o.id === activeOrgId)?.name ||
    'Espacio de trabajo';
  const roleTarget = {
    orgId: activeEvent?.orgId ?? activeOrgId ?? '',
    projectId: activeEvent?.projectId ?? activeProjectId ?? undefined,
    eventId: activeEvent?.id,
  };
  const role = activeUserId
    ? effectiveRole(activeUserId, data.memberships, roleTarget)
    : null;
  const roleLabel = role ? ROLE_LABELS[role] : 'Sin acceso';

  const handleEventChange = async (eventId: string) => {
    if (!eventId || eventId === activeEventId) return;
    const opened = await useWorkspaceStore.getState().openEvent(eventId);
    if (opened) onEventOpened();
  };

  // OX-04: Recinto › Distribución of the active venue slot.
  const openLayoutId = activeEvent ? activeLayoutIds[activeVenue] : undefined;
  const openLayout = layouts.find((l) => l.id === openLayoutId);
  const openVenue = openLayout && venues.find((v) => v.id === openLayout.venueId);
  const layoutChoices = openLayout
    ? layouts.filter(
        (l) =>
          l.eventId === openLayout.eventId &&
          l.site === openLayout.site &&
          (l.state !== 'archived' || l.id === openLayout.id)
      )
    : [];
  const canVenue = !!openLayout && useWorkspaceStore.getState().canEditVenue();
  const venueModeTitle = canVenue
    ? 'Modo de edición: la distribución de este evento o el recinto común'
    : 'Tu perfil no permite editar el recinto (permiso provisional; modo local, orientativo).';

  return (
    <>
      {openLayout && openVenue ? (
        <div className="ctx-top has-venue">
          <span className="eyebrow ctx-org" title={`Espacio de trabajo: ${orgName}`}>
            {orgName.toUpperCase()}
          </span>
          <span className="ctx-sep" aria-hidden="true">
            ·
          </span>
          <span
            id="ctx-venue"
            className="ctx-venue-name"
            title={`Recinto: ${openVenue.name} (versión ${openVenue.version})`}
            aria-label={`Recinto: ${openVenue.name}`}
          >
            {openVenue.name}
          </span>
          <span className="ctx-sep" aria-hidden="true">
            ›
          </span>
          <select
            id="ctx-layout"
            className="ctx-select ctx-layout-select"
            aria-label="Distribución"
            title={
              editMode === 'venue'
                ? 'Termina la edición del recinto para cambiar de distribución'
                : 'Distribución'
            }
            disabled={editMode === 'venue'}
            value={openLayout.id}
            onChange={(e) => void useWorkspaceStore.getState().openLayout(e.target.value)}
          >
            {layoutChoices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span
            id="ctx-layout-state"
            className={`badge ctx-layout-state state-${openLayout.state}`}
            data-state={openLayout.state}
          >
            {LAYOUT_STATE_LABELS[openLayout.state]}
          </span>
          <span
            id="ctx-layout-version"
            className="ctx-layout-version"
            title="Versión de la distribución"
          >
            v{openLayout.version}
          </span>
          {isLayoutStale(openLayout, venues) && (
            <span
              id="ctx-layout-stale"
              className="badge ctx-layout-stale"
              title={`${STALE_LABEL}: el recinto ha cambiado desde la última revisión de esta distribución.`}
            >
              {STALE_LABEL}
            </span>
          )}
          <button
            id="ctx-layouts"
            type="button"
            className="ctx-members-btn"
            onClick={() => setLayoutsOpen(true)}
          >
            Distribuciones
          </button>
          <select
            id="ctx-edit-mode"
            className="ctx-select ctx-mode-select"
            data-mode={editMode}
            aria-label="Modo de edición"
            title={venueModeTitle}
            value={editMode}
            onChange={(e) =>
              void useWorkspaceStore.getState().setEditMode(e.target.value as EditMode)
            }
          >
            <option value="layout">Editar distribución</option>
            <option value="venue" disabled={!canVenue}>
              Editar recinto
            </option>
          </select>
        </div>
      ) : (
        <span className="eyebrow ctx-org" title="Espacio de trabajo">
          {orgName.toUpperCase()}
        </span>
      )}
      <nav className="ctx-crumbs" aria-label="Contexto de trabajo">
        <select
          id="ctx-project"
          className="ctx-select"
          aria-label="Proyecto"
          title="Proyecto"
          value={activeProjectId ?? ''}
          onChange={(e) =>
            useWorkspaceStore.getState().setActiveProject(e.target.value || null)
          }
        >
          {!activeProjectId && <option value="">Sin proyecto</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="ctx-sep" aria-hidden="true">
          ›
        </span>
        <select
          id="ctx-event"
          className="ctx-select"
          aria-label="Evento"
          title="Evento"
          value={eventInActiveProject?.id ?? ''}
          onChange={(e) => void handleEventChange(e.target.value)}
        >
          {!eventInActiveProject && (
            <option value="">
              {activeEventId ? 'Elige un evento' : 'Sin evento abierto'}
            </option>
          )}
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
        <span className="ctx-sep" aria-hidden="true">
          ›
        </span>
        <select
          id="ctx-day"
          className="ctx-select"
          aria-label="Jornada"
          title="Jornada (fase operativa)"
          disabled={!activeEventId || days.length === 0}
          value={activeEventId && days.length ? (shownDayId ?? '') : ''}
          onChange={(e) =>
            useWorkspaceStore.getState().setActiveDay(e.target.value || null)
          }
        >
          {(!activeEventId || !days.length || !shownDayId) && (
            <option value="">
              {!activeEventId
                ? '—'
                : days.length
                  ? 'Elige una jornada'
                  : 'Sin jornadas definidas'}
            </option>
          )}
          {activeEventId &&
            days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {PHASE_LABELS[d.kind]}
              </option>
            ))}
        </select>
      </nav>
      <div className="ctx-meta">
        <label className="ctx-user">
          <span>Usuario activo</span>
          <select
            id="ctx-user"
            className="ctx-select"
            value={activeUserId ?? ''}
            onChange={(e) => {
              if (e.target.value) {
                void useWorkspaceStore.getState().setActiveUser(e.target.value);
              }
            }}
          >
            {allUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <span className="ctx-role" title="Rol efectivo en el evento activo">
          {roleLabel}
        </span>
        <button
          id="ctx-members"
          type="button"
          className="ctx-members-btn"
          disabled={!activeProjectId}
          onClick={() => setMembersOpen(true)}
        >
          Miembros
        </button>
        {localBadge}
        {readOnly && activeEventId && (
          <span
            id="ctx-readonly-badge"
            className="badge ctx-readonly-badge"
            title="Tu perfil no permite editar este evento."
          >
            Solo lectura
          </span>
        )}
      </div>
      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} />
      <LayoutsDialog
        open={layoutsOpen && !!openLayout}
        onClose={() => setLayoutsOpen(false)}
      />
    </>
  );
};
