import {describe, expect, it} from 'vitest';
import {scopeToUser} from '../../src/db/workspace-repository';
import {
  ROLE_MATRIX,
  WORKSPACE_ACTIONS,
  WORKSPACE_ROLES,
  can,
  effectiveRole,
  roleAllows,
  userOrgIds,
  visibleEvents,
  visibleProjects,
} from '../../src/engine/workspace/permissions';
import type {
  Membership,
  WorkspaceAction,
  WorkspaceData,
  WorkspaceRole,
} from '../../src/types/workspace';

const T = '2026-01-01T00:00:00.000Z';

/**
 * Expected role × action matrix, written out explicitly so that any silent
 * change to ROLE_MATRIX fails this test (OX-03, card criterion 2 local equivalent).
 */
const EXPECTED_ACTIONS: WorkspaceAction[] = [
  'project.view',
  'project.create',
  'project.edit',
  'project.delete',
  'event.view',
  'event.create',
  'event.edit',
  'event.delete',
  'members.manage',
  'budget.view',
  'budget.edit',
  'orders.view',
  'orders.update',
  'sensitive.view',
  'export',
];

const EXPECTED_MATRIX: Record<WorkspaceRole, WorkspaceAction[]> = {
  org_admin: [...EXPECTED_ACTIONS],
  event_coordinator: [
    'project.view',
    'project.edit',
    'event.view',
    'event.create',
    'event.edit',
    'members.manage',
    'budget.view',
    'budget.edit',
    'orders.view',
    'orders.update',
    'sensitive.view',
    'export',
  ],
  technician: [
    'project.view',
    'event.view',
    'event.edit',
    'budget.view',
    'orders.view',
    'orders.update',
    'export',
  ],
  team_lead: ['project.view', 'event.view', 'orders.view', 'orders.update'],
  installer: ['project.view', 'event.view', 'orders.view', 'orders.update'],
  external_supplier: ['orders.view'],
  read_only: ['project.view', 'event.view', 'budget.view', 'orders.view'],
};

const EXPECTED_ROLES = Object.keys(EXPECTED_MATRIX) as WorkspaceRole[];

function membership(
  id: string,
  userId: string,
  orgId: string,
  role: WorkspaceRole,
  scope: Membership['scope'],
  extra: Partial<Membership> = {}
): Membership {
  return {id, userId, orgId, role, scope, createdAt: T, createdBy: 'seed', ...extra};
}

/** Two organizations, A and B, with projects, events, members and access log. */
function twoOrgFixture(): WorkspaceData {
  return {
    organizations: [
      {id: 'org-a', name: 'Org A', createdAt: T},
      {id: 'org-b', name: 'Org B', createdAt: T},
    ],
    users: [
      {id: 'u-admin-a', name: 'Admin A', createdAt: T},
      {id: 'u-admin-b', name: 'Admin B', createdAt: T},
      {id: 'u-tech-a', name: 'Técnica A', createdAt: T},
      {id: 'u-guest-a', name: 'Invitado evento A1', createdAt: T},
      {id: 'u-member-b', name: 'Miembro B', createdAt: T},
    ],
    memberships: [
      membership('m1', 'u-admin-a', 'org-a', 'org_admin', 'organization'),
      membership('m2', 'u-admin-b', 'org-b', 'org_admin', 'organization'),
      membership('m3', 'u-tech-a', 'org-a', 'technician', 'project', {projectId: 'p-a'}),
      membership('m4', 'u-guest-a', 'org-a', 'read_only', 'event', {
        projectId: 'p-a',
        eventId: 'e-a1',
      }),
      membership('m5', 'u-member-b', 'org-b', 'installer', 'project', {projectId: 'p-b'}),
    ],
    projects: [
      {id: 'p-a', orgId: 'org-a', name: 'Proyecto A', createdAt: T, updatedAt: T},
      {id: 'p-a2', orgId: 'org-a', name: 'Proyecto A2', createdAt: T, updatedAt: T},
      {id: 'p-b', orgId: 'org-b', name: 'Proyecto B', createdAt: T, updatedAt: T},
    ],
    events: [
      {id: 'e-a1', orgId: 'org-a', projectId: 'p-a', name: 'A1', createdAt: T, updatedAt: T},
      {id: 'e-a2', orgId: 'org-a', projectId: 'p-a', name: 'A2', createdAt: T, updatedAt: T},
      {id: 'e-b1', orgId: 'org-b', projectId: 'p-b', name: 'B1', createdAt: T, updatedAt: T},
    ],
    accessLog: [
      {
        id: 'log-a',
        orgId: 'org-a',
        at: T,
        actorId: 'u-admin-a',
        action: 'invite',
        targetUserId: 'u-tech-a',
        role: 'technician',
      },
      {
        id: 'log-b',
        orgId: 'org-b',
        at: T,
        actorId: 'u-admin-b',
        action: 'invite',
        targetUserId: 'u-member-b',
        role: 'installer',
      },
    ],
  };
}

describe('Workspace permission matrix', () => {
  it('declares exactly the expected roles and actions', () => {
    expect([...WORKSPACE_ROLES]).toEqual(EXPECTED_ROLES);
    expect([...WORKSPACE_ACTIONS]).toEqual(EXPECTED_ACTIONS);
    expect(Object.keys(ROLE_MATRIX).sort()).toEqual([...EXPECTED_ROLES].sort());
  });

  for (const role of EXPECTED_ROLES) {
    it(`matches the expected table for role ${role}`, () => {
      for (const action of EXPECTED_ACTIONS) {
        const expected = EXPECTED_MATRIX[role].includes(action);
        expect({role, action, allowed: roleAllows(role, action)}).toEqual({
          role,
          action,
          allowed: expected,
        });
        expect(ROLE_MATRIX[role].has(action)).toBe(expected);
      }
      expect(ROLE_MATRIX[role].size).toBe(EXPECTED_MATRIX[role].length);
    });
  }

  it('lets an external supplier view orders but not edit the budget', () => {
    expect(roleAllows('external_supplier', 'orders.view')).toBe(true);
    expect(roleAllows('external_supplier', 'budget.edit')).toBe(false);
    const ms = [
      membership('m', 'u-sup', 'org-a', 'external_supplier', 'event', {
        projectId: 'p-a',
        eventId: 'e-a1',
      }),
    ];
    const target = {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'};
    expect(can('u-sup', ms, 'orders.view', target)).toBe(true);
    expect(can('u-sup', ms, 'budget.edit', target)).toBe(false);
  });

  it('grants sensitive.view only to org_admin and event_coordinator', () => {
    const withSensitive = EXPECTED_ROLES.filter((r) => roleAllows(r, 'sensitive.view'));
    expect(withSensitive.sort()).toEqual(['event_coordinator', 'org_admin']);
  });

  it('denies every action without a user id or without memberships', () => {
    const ms = [membership('m', 'u1', 'org-a', 'org_admin', 'organization')];
    for (const action of EXPECTED_ACTIONS) {
      expect(can(null, ms, action, {orgId: 'org-a'})).toBe(false);
      expect(can(undefined, ms, action, {orgId: 'org-a'})).toBe(false);
      expect(can('u1', [], action, {orgId: 'org-a'})).toBe(false);
    }
  });
});

describe('effectiveRole precedence', () => {
  it('lets an organization-level org_admin win over narrower memberships', () => {
    const ms = [
      membership('m1', 'u1', 'org-a', 'org_admin', 'organization'),
      membership('m2', 'u1', 'org-a', 'read_only', 'project', {projectId: 'p-a'}),
      membership('m3', 'u1', 'org-a', 'external_supplier', 'event', {
        projectId: 'p-a',
        eventId: 'e-a1',
      }),
    ];
    expect(effectiveRole('u1', ms, {orgId: 'org-a'})).toBe('org_admin');
    expect(effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a'})).toBe('org_admin');
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'})
    ).toBe('org_admin');
  });

  it('applies an event membership only to that event, overriding the project role', () => {
    const ms = [
      membership('m1', 'u1', 'org-a', 'technician', 'project', {projectId: 'p-a'}),
      membership('m2', 'u1', 'org-a', 'read_only', 'event', {
        projectId: 'p-a',
        eventId: 'e-a1',
      }),
    ];
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'})
    ).toBe('read_only');
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a2'})
    ).toBe('technician');
    expect(effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a'})).toBe('technician');
    expect(can('u1', ms, 'event.edit', {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'})).toBe(
      false
    );
    expect(can('u1', ms, 'event.edit', {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a2'})).toBe(
      true
    );
  });

  it('lets an event membership raise the role for that event only', () => {
    const ms = [
      membership('m1', 'u1', 'org-a', 'read_only', 'project', {projectId: 'p-a'}),
      membership('m2', 'u1', 'org-a', 'event_coordinator', 'event', {
        projectId: 'p-a',
        eventId: 'e-a2',
      }),
    ];
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a2'})
    ).toBe('event_coordinator');
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'})
    ).toBe('read_only');
  });

  it('prefers a project membership over a non-admin organization membership', () => {
    const ms = [
      membership('m1', 'u1', 'org-a', 'read_only', 'organization'),
      membership('m2', 'u1', 'org-a', 'technician', 'project', {projectId: 'p-a'}),
    ];
    expect(effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a'})).toBe('technician');
    expect(effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a2'})).toBe('read_only');
  });

  it('never counts memberships of another organization', () => {
    const ms = [
      membership('m1', 'u1', 'org-b', 'org_admin', 'organization'),
      // Malformed cross-org record pointing at org A ids: must be ignored.
      membership('m2', 'u1', 'org-b', 'event_coordinator', 'project', {projectId: 'p-a'}),
      membership('m3', 'u1', 'org-b', 'event_coordinator', 'event', {
        projectId: 'p-a',
        eventId: 'e-a1',
      }),
    ];
    expect(effectiveRole('u1', ms, {orgId: 'org-a'})).toBeNull();
    expect(effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a'})).toBeNull();
    expect(
      effectiveRole('u1', ms, {orgId: 'org-a', projectId: 'p-a', eventId: 'e-a1'})
    ).toBeNull();
    expect(effectiveRole('u1', ms, {orgId: 'org-b'})).toBe('org_admin');
  });

  it('ignores memberships of other users', () => {
    const ms = [membership('m1', 'u2', 'org-a', 'org_admin', 'organization')];
    expect(effectiveRole('u1', ms, {orgId: 'org-a'})).toBeNull();
  });
});

describe('Organization isolation (local INV-002 equivalent)', () => {
  it('scopeToUser returns no data of another organization', () => {
    const data = twoOrgFixture();
    const scoped = scopeToUser(data, 'u-admin-a');
    expect(scoped.organizations.map((o) => o.id)).toEqual(['org-a']);
    expect(scoped.projects.map((p) => p.id)).toEqual(['p-a', 'p-a2']);
    expect(scoped.events.map((e) => e.id)).toEqual(['e-a1', 'e-a2']);
    expect(scoped.memberships.every((m) => m.orgId === 'org-a')).toBe(true);
    expect(scoped.memberships.map((m) => m.id).sort()).toEqual(['m1', 'm3', 'm4']);
    expect(scoped.users.map((u) => u.id).sort()).toEqual(
      ['u-admin-a', 'u-guest-a', 'u-tech-a'].sort()
    );
    expect(scoped.accessLog.map((a) => a.id)).toEqual(['log-a']);
  });

  it('scopeToUser for org B user returns only org B', () => {
    const scoped = scopeToUser(twoOrgFixture(), 'u-member-b');
    expect(scoped.organizations.map((o) => o.id)).toEqual(['org-b']);
    expect(scoped.projects.map((p) => p.id)).toEqual(['p-b']);
    expect(scoped.events.map((e) => e.id)).toEqual(['e-b1']);
    expect(scoped.users.map((u) => u.id).sort()).toEqual(['u-admin-b', 'u-member-b']);
    expect(scoped.accessLog.map((a) => a.id)).toEqual(['log-b']);
  });

  it('scopeToUser for a user without memberships returns nothing but the user', () => {
    const data = twoOrgFixture();
    data.users.push({id: 'u-lonely', name: 'Sin organización', createdAt: T});
    const scoped = scopeToUser(data, 'u-lonely');
    expect(scoped.organizations).toEqual([]);
    expect(scoped.projects).toEqual([]);
    expect(scoped.events).toEqual([]);
    expect(scoped.memberships).toEqual([]);
    expect(scoped.accessLog).toEqual([]);
    expect(scoped.users.map((u) => u.id)).toEqual(['u-lonely']);
  });

  it('userOrgIds and visibleProjects never include another organization', () => {
    const data = twoOrgFixture();
    expect([...userOrgIds('u-admin-a', data)]).toEqual(['org-a']);
    expect(visibleProjects('u-admin-a', data).map((p) => p.id)).toEqual(['p-a', 'p-a2']);
    expect(visibleEvents('u-admin-a', data, 'p-b')).toEqual([]);
    expect(visibleProjects('u-admin-b', data).map((p) => p.id)).toEqual(['p-b']);
  });

  it('can() is false for every action on organization B targets for an org A admin', () => {
    const data = twoOrgFixture();
    for (const action of EXPECTED_ACTIONS) {
      expect(can('u-admin-a', data.memberships, action, {orgId: 'org-b'})).toBe(false);
      expect(
        can('u-admin-a', data.memberships, action, {orgId: 'org-b', projectId: 'p-b'})
      ).toBe(false);
      expect(
        can('u-admin-a', data.memberships, action, {
          orgId: 'org-b',
          projectId: 'p-b',
          eventId: 'e-b1',
        })
      ).toBe(false);
    }
  });

  it('shows a project-scoped member only their project and its events', () => {
    const data = twoOrgFixture();
    expect(visibleProjects('u-tech-a', data).map((p) => p.id)).toEqual(['p-a']);
    expect(visibleEvents('u-tech-a', data, 'p-a').map((e) => e.id)).toEqual(['e-a1', 'e-a2']);
    expect(visibleEvents('u-tech-a', data, 'p-a2')).toEqual([]);
  });

  it('shows an event-only guest the project container and only that event', () => {
    const data = twoOrgFixture();
    expect(visibleProjects('u-guest-a', data).map((p) => p.id)).toEqual(['p-a']);
    expect(visibleEvents('u-guest-a', data, 'p-a').map((e) => e.id)).toEqual(['e-a1']);
  });
});
