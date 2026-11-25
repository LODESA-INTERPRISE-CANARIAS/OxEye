import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ROLE_LABELS} from '../../engine/workspace/permissions';
import {
  LOCAL_MODE_NOTICE,
  useWorkspaceStore,
} from '../../store/useWorkspaceStore';
import type {
  AccessLogEntry,
  Membership,
  PermissionTarget,
  WorkspaceRole,
} from '../../types/workspace';

export interface MembersDialogProps {
  open: boolean;
  onClose: () => void;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-ES');
};

/**
 * Members of the active project and event (`#members-dialog`, OX-03): invite a
 * local profile, change its role, revoke access and read the access log.
 * Local mode only: permissions are indicative and do not protect data.
 */
export const MembersDialog: React.FC<MembersDialogProps> = ({open, onClose}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const data = useWorkspaceStore((s) => s.data);
  const allUsers = useWorkspaceStore((s) => s.allUsers);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeEventId = useWorkspaceStore((s) => s.activeEventId);
  const can = useWorkspaceStore((s) => s.can);
  const assignableRoles = useWorkspaceStore((s) => s.assignableRoles);
  const activeUserId = useWorkspaceStore((s) => s.activeUserId);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('technician');
  const [scope, setScope] = useState<'project' | 'event'>('project');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  const project = data.projects.find((p) => p.id === activeProjectId) || null;
  const event =
    data.events.find(
      (e) => e.id === activeEventId && e.projectId === activeProjectId
    ) || null;

  const userName = (id: string) =>
    allUsers.find((u) => u.id === id)?.name || 'Perfil eliminado';
  const userContact = (id: string) =>
    allUsers.find((u) => u.id === id)?.contact || '';

  const projectMembers = useMemo(
    () =>
      data.memberships.filter(
        (m) => m.scope === 'project' && m.projectId === activeProjectId
      ),
    [data, activeProjectId]
  );
  const eventMembers = useMemo(
    () =>
      event
        ? data.memberships.filter(
            (m) => m.scope === 'event' && m.eventId === event.id
          )
        : [],
    [data, event]
  );
  const log = useMemo(
    () =>
      data.accessLog
        .filter((a) => a.projectId === activeProjectId)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [data, activeProjectId]
  );

  const projectTarget: PermissionTarget | null = project
    ? {orgId: project.orgId, projectId: project.id}
    : null;
  const eventTarget: PermissionTarget | null =
    project && event
      ? {orgId: project.orgId, projectId: project.id, eventId: event.id}
      : null;
  const effectiveScope = scope === 'event' && event ? 'event' : 'project';
  const inviteTarget = effectiveScope === 'event' ? eventTarget : projectTarget;
  const inviteRoles = inviteTarget ? assignableRoles(inviteTarget) : [];
  const canInvite =
    !!inviteTarget && can('members.manage', inviteTarget) && inviteRoles.length > 0;
  // Keep the selected role within what this profile may grant.
  const inviteRole: WorkspaceRole = inviteRoles.includes(role)
    ? role
    : (inviteRoles[0] ?? role);

  const membershipTarget = (m: Membership): PermissionTarget => ({
    orgId: m.orgId,
    projectId: m.projectId,
    eventId: m.eventId,
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !canInvite || !name.trim()) return;
    void run(async () => {
      await useWorkspaceStore.getState().invite({
        name,
        contact,
        role: inviteRole,
        scope: effectiveScope,
        projectId: project.id,
        eventId: effectiveScope === 'event' ? event?.id : undefined,
      });
      setName('');
      setContact('');
    });
  };

  const describe = (a: AccessLogEntry): string => {
    const actor = userName(a.actorId);
    const target = userName(a.targetUserId);
    const when = formatDate(a.at);
    if (a.action === 'invite') {
      return `${actor} invitó a ${target}${a.role ? ` como ${ROLE_LABELS[a.role]}` : ''} · ${when}`;
    }
    if (a.action === 'role_change') {
      const change =
        a.previousRole && a.role
          ? ` (${ROLE_LABELS[a.previousRole]} → ${ROLE_LABELS[a.role]})`
          : '';
      return `${actor} cambió el rol de ${target}${change} · ${when}`;
    }
    return `${actor} retiró a ${target} · ${when}`;
  };

  const renderMembers = (list: Membership[], emptyText: string) =>
    list.length === 0 ? (
      <p className="members-empty">{emptyText}</p>
    ) : (
      <div className="members-list">
        {list.map((m) => {
          const assignable = assignableRoles(membershipTarget(m));
          // Own role and roles above the actor's cannot be changed (no self-promotion).
          const allowed =
            can('members.manage', membershipTarget(m)) &&
            m.userId !== activeUserId &&
            assignable.includes(m.role);
          const roleOptions = assignable.includes(m.role) ? assignable : [m.role];
          const contactText = userContact(m.userId);
          return (
            <article key={m.id} className="note-card members-row" data-membership-id={m.id}>
              <div className="members-who">
                <b>{userName(m.userId)}</b>
                {contactText && <small>{contactText}</small>}
              </div>
              <select
                aria-label={`Rol de ${userName(m.userId)}`}
                value={m.role}
                disabled={!allowed || busy}
                onChange={(e) => {
                  const next = e.target.value as WorkspaceRole;
                  void run(() =>
                    useWorkspaceStore.getState().changeRole(m.id, next)
                  );
                }}
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="members-revoke"
                disabled={!allowed || busy}
                onClick={() =>
                  void run(() => useWorkspaceStore.getState().revoke(m.id))
                }
              >
                Retirar acceso
              </button>
            </article>
          );
        })}
      </div>
    );

  return (
    <dialog id="members-dialog" ref={dlgRef} onClose={() => open && onClose()}>
      <div id="members-body">
        <h2>Miembros y permisos</h2>
        <p className="members-notice" role="note">
          {LOCAL_MODE_NOTICE}
        </p>
        <p>
          Solo se registran el nombre, un contacto profesional opcional y el
          rol de cada persona.
        </p>
        {!project ? (
          <p className="members-empty">Selecciona primero un proyecto.</p>
        ) : (
          <>
            <h3>Proyecto · {project.name}</h3>
            {renderMembers(projectMembers, 'Sin miembros asignados al proyecto.')}
            <h3>Evento · {event ? event.name : 'sin evento abierto'}</h3>
            {event
              ? renderMembers(eventMembers, 'Sin miembros asignados solo a este evento.')
              : <p className="members-empty">Abre un evento de este proyecto para gestionar sus miembros.</p>}

            <h3>Invitar a una persona</h3>
            <form id="members-invite-form" onSubmit={handleInvite}>
              <div className="two">
                <label>
                  Nombre
                  <input
                    id="members-name"
                    required
                    maxLength={100}
                    value={name}
                    disabled={!canInvite || busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Contacto profesional (opcional)
                  <input
                    id="members-contact"
                    maxLength={120}
                    value={contact}
                    disabled={!canInvite || busy}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </label>
                <label>
                  Rol
                  <select
                    id="members-role"
                    value={inviteRole}
                    disabled={!canInvite || busy}
                    onChange={(e) => setRole(e.target.value as WorkspaceRole)}
                  >
                    {inviteRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ámbito
                  <select
                    id="members-scope"
                    value={effectiveScope}
                    disabled={busy}
                    onChange={(e) =>
                      setScope(e.target.value as 'project' | 'event')
                    }
                  >
                    <option value="project">Proyecto</option>
                    <option value="event" disabled={!event}>
                      Evento
                    </option>
                  </select>
                </label>
              </div>
              <button
                id="members-invite"
                type="submit"
                disabled={!canInvite || busy || !name.trim()}
              >
                Invitar
              </button>
              {!canInvite && (
                <p className="members-empty">
                  Tu perfil no permite gestionar miembros en este ámbito.
                </p>
              )}
            </form>

            <h3>Registro de accesos</h3>
            {log.length === 0 ? (
              <p className="members-empty">Sin cambios de acceso registrados.</p>
            ) : (
              <ul id="members-log" className="members-log">
                {log.map((a) => (
                  <li key={a.id}>{describe(a)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
    </dialog>
  );
};
