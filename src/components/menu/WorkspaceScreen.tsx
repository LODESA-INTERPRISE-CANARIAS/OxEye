import React, {useMemo, useState} from 'react';
import {visibleEvents, visibleProjects} from '../../engine/workspace/permissions';
import {
  LOCAL_MODE_NOTICE,
  useWorkspaceStore,
} from '../../store/useWorkspaceStore';
import type {WorkspaceEvent, WorkspaceProject} from '../../types/workspace';

export interface WorkspaceScreenProps {
  onBack: () => void;
  /** Opens the wizard so it creates a new event in `projectId`. */
  onNewEvent: (projectId: string) => void;
  /** Called after an event was opened (closes the menu). */
  onEventOpened: () => void;
  /** Triggers the shared hidden `#file` input (import as a new project). */
  onImport: () => void;
}

type Editing = {kind: 'project' | 'event'; id: string; name: string} | null;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES');
};

/**
 * «Espacio de trabajo» screen inside the main menu (OX-03): projects and
 * events visible to the active local profile, with actions gated by `can()`.
 */
export const WorkspaceScreen: React.FC<WorkspaceScreenProps> = ({
  onBack,
  onNewEvent,
  onEventOpened,
  onImport,
}) => {
  const data = useWorkspaceStore((s) => s.data);
  const activeUserId = useWorkspaceStore((s) => s.activeUserId);
  const activeOrgId = useWorkspaceStore((s) => s.activeOrgId);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeEventId = useWorkspaceStore((s) => s.activeEventId);
  const can = useWorkspaceStore((s) => s.can);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projects = useMemo(
    () => (activeUserId ? visibleProjects(activeUserId, data) : []),
    [activeUserId, data]
  );
  const orgName =
    data.organizations.find((o) => o.id === activeOrgId)?.name ||
    'Espacio de trabajo';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const ws = () => useWorkspaceStore.getState();

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    void run(async () => {
      const created = await ws().createProject(newName);
      if (created) {
        setNewName('');
        setCreating(false);
      }
    });
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    const current = editing;
    void run(async () => {
      if (current.kind === 'project') {
        await ws().renameProject(current.id, current.name);
      } else {
        await ws().renameEvent(current.id, current.name);
      }
      setEditing(null);
    });
  };

  const handleDelete = (kind: 'project' | 'event', id: string) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }
    setPendingDelete(null);
    void run(() =>
      kind === 'project' ? ws().deleteProject(id) : ws().deleteEvent(id)
    );
  };

  const handleOpen = (eventId: string) => {
    void run(async () => {
      const opened = await ws().openEvent(eventId);
      if (opened) onEventOpened();
    });
  };

  const renameForm = (current: NonNullable<Editing>) => (
    <form className="ws-rename" onSubmit={handleRename}>
      <input
        aria-label="Nuevo nombre"
        maxLength={100}
        autoFocus
        value={current.name}
        onChange={(e) => setEditing({...current, name: e.target.value})}
      />
      <button type="submit" className="game-primary" disabled={busy}>
        Guardar
      </button>
      <button type="button" onClick={() => setEditing(null)}>
        Cancelar
      </button>
    </form>
  );

  const renderEvent = (ev: WorkspaceEvent) => {
    const target = {orgId: ev.orgId, projectId: ev.projectId, eventId: ev.id};
    const isOpen = ev.id === activeEventId;
    const isEditing = editing?.kind === 'event' && editing.id === ev.id;
    return (
      <li
        key={ev.id}
        className={`ws-event${isOpen ? ' is-open' : ''}`}
        data-event-id={ev.id}
      >
        {isEditing ? (
          renameForm(editing)
        ) : (
          <div className="ws-event-info">
            <b>{ev.name}</b>
            <small>
              {isOpen ? 'Abierto · ' : ''}Actualizado {formatDate(ev.updatedAt)}
            </small>
          </div>
        )}
        <div className="ws-row-actions">
          <button
            type="button"
            id={`ws-open-${ev.id}`}
            className="ws-open"
            disabled={busy || isOpen}
            onClick={() => handleOpen(ev.id)}
          >
            {isOpen ? 'Abierto' : 'Abrir'}
          </button>
          <button
            type="button"
            className="ws-rename-btn"
            disabled={busy || !can('event.edit', target)}
            onClick={() => setEditing({kind: 'event', id: ev.id, name: ev.name})}
          >
            Renombrar
          </button>
          <button
            type="button"
            className="ws-delete"
            disabled={busy || isOpen || !can('event.delete', target)}
            title={isOpen ? 'No se puede eliminar el evento abierto' : undefined}
            onClick={() => handleDelete('event', ev.id)}
          >
            {pendingDelete === ev.id ? 'Confirmar eliminación' : 'Eliminar'}
          </button>
        </div>
      </li>
    );
  };

  const renderProject = (p: WorkspaceProject) => {
    const target = {orgId: p.orgId, projectId: p.id};
    const events = activeUserId ? visibleEvents(activeUserId, data, p.id) : [];
    const isEditing = editing?.kind === 'project' && editing.id === p.id;
    const holdsOpenEvent = events.some((e) => e.id === activeEventId);
    return (
      <section
        key={p.id}
        className={`ws-project${p.id === activeProjectId ? ' is-active' : ''}`}
        data-project-id={p.id}
      >
        <header className="ws-project-head">
          {isEditing ? (
            renameForm(editing)
          ) : (
            <h2>{p.name}</h2>
          )}
          <div className="ws-row-actions">
            <button
              type="button"
              className="ws-new-event"
              disabled={busy || !can('event.create', target)}
              onClick={() => onNewEvent(p.id)}
            >
              Nuevo evento
            </button>
            <button
              type="button"
              className="ws-rename-btn"
              disabled={busy || !can('project.edit', target)}
              onClick={() =>
                setEditing({kind: 'project', id: p.id, name: p.name})
              }
            >
              Renombrar
            </button>
            <button
              type="button"
              className="ws-delete"
              disabled={busy || holdsOpenEvent || !can('project.delete', target)}
              title={
                holdsOpenEvent
                  ? 'No se puede eliminar el proyecto del evento abierto'
                  : undefined
              }
              onClick={() => handleDelete('project', p.id)}
            >
              {pendingDelete === p.id ? 'Confirmar eliminación' : 'Eliminar'}
            </button>
          </div>
        </header>
        {events.length === 0 ? (
          <p className="ws-empty">Sin eventos en este proyecto.</p>
        ) : (
          <ul className="ws-events">
            {events.map(renderEvent)}
          </ul>
        )}
      </section>
    );
  };

  return (
    <main className="game-card workspace-card">
      <span className="game-eyebrow">ESPACIO DE TRABAJO</span>
      <h1>{orgName}</h1>
      <p className="ws-notice" role="note">
        {LOCAL_MODE_NOTICE}
      </p>
      <div className="ws-toolbar">
        <button
          type="button"
          id="ws-new-project"
          className="game-primary"
          disabled={busy || !can('project.create')}
          onClick={() => setCreating((v) => !v)}
        >
          Nuevo proyecto
        </button>
        <button
          type="button"
          id="ws-import"
          disabled={busy || !can('project.create')}
          onClick={onImport}
        >
          Importar .json como proyecto nuevo
        </button>
      </div>
      {creating && (
        <form className="ws-create" onSubmit={handleCreateProject}>
          <label>
            Nombre del proyecto
            <input
              id="ws-project-name"
              maxLength={100}
              required
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <button
            type="submit"
            id="ws-project-create"
            className="game-primary"
            disabled={busy || !newName.trim()}
          >
            Crear proyecto
          </button>
        </form>
      )}
      <div className="ws-projects">
        {projects.length === 0 ? (
          <p className="ws-empty">No hay proyectos visibles para tu perfil.</p>
        ) : (
          projects.map(renderProject)
        )}
      </div>
      <button type="button" id="ws-back" onClick={onBack}>
        Volver
      </button>
    </main>
  );
};
