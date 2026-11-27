/**
 * F2 · What each role sees and does, in one compact table. Roles add up in
 * one account (Fabián: administrador + desarrollador).
 */
import React from 'react';
import {Chip, Icon} from '../../ui';
import {ROLE_HINT, ROLE_LABEL, USERS, type RoleId} from '../data';
import {Avatar} from '../kit';

type Cell = 'yes' | 'no' | 'read' | string;

const ROLES: RoleId[] = ['admin', 'developer', 'team', 'guest'];

const ROWS: {label: string; help?: string; cells: Record<RoleId, Cell>}[] = [
  {
    label: 'Ver el plan: eventos, tareas, calendario, inventarios',
    cells: {admin: 'yes', developer: 'yes', team: 'yes', guest: 'read'},
  },
  {
    label: 'Editar el plan',
    cells: {admin: 'yes', developer: 'yes', team: 'yes', guest: 'no'},
  },
  {
    label: 'Contactos y Catálogo con precios',
    cells: {admin: 'yes', developer: 'yes', team: 'yes', guest: 'no'},
  },
  {
    label: 'Presupuesto y gastos del evento',
    cells: {
      admin: 'yes',
      developer: 'Sí · se puede retirar',
      team: 'no',
      guest: 'no',
    },
  },
  {
    label: 'Aprobar ofertas recibidas',
    cells: {admin: 'yes', developer: 'no', team: 'no', guest: 'no'},
  },
  {
    label: 'Poner una contraseña provisional',
    cells: {admin: 'yes', developer: 'yes', team: 'no', guest: 'no'},
  },
  {
    label: 'Gestionar usuarios y roles · sesión de soporte',
    cells: {admin: 'yes', developer: 'no', team: 'no', guest: 'no'},
  },
  {
    label: 'Diagnóstico técnico',
    cells: {admin: 'no', developer: 'yes', team: 'no', guest: 'no'},
  },
  {
    label: 'Perfil propio y contraseña',
    cells: {
      admin: 'yes',
      developer: 'yes',
      team: 'Compartido · contraseña la pone un administrador',
      guest: 'Sin perfil',
    },
  },
];

const CellView: React.FC<{value: Cell}> = ({value}) => {
  if (value === 'yes')
    {return (
      <span className="lx-mk-cell lx-mk-cell--yes">
        <Icon name="check" size={18} label="Sí" />
      </span>
    );}
  if (value === 'no')
    {return (
      <span className="lx-mk-cell lx-mk-cell--no">
        <Icon name="minus" size={18} label="No" />
      </span>
    );}
  if (value === 'read')
    {return <span className="lx-mk-cell lx-mk-cell--text">Solo lectura</span>;}
  return <span className="lx-mk-cell lx-mk-cell--text">{value}</span>;
};

export const RolesTable: React.FC = () => (
  <div className="lx-mk-view" id="mk-roles">
    <div className="lx-mk-rolecards">
      {ROLES.map(r => {
        const people = USERS.filter(u => u.roles.includes(r));
        return (
          <section
            key={r}
            className="lx-card lx-mk-rolecard"
            data-role={r}
            aria-labelledby={`mk-role-${r}`}
          >
            <h2 className="lx-card__title" id={`mk-role-${r}`}>
              {ROLE_LABEL[r]}
            </h2>
            <p>{ROLE_HINT[r]}</p>
            <ul className="lx-mk-people">
              {people.map(u => (
                <li key={u.id}>
                  <Avatar name={u.displayName} size="sm" />
                  {u.displayName}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
    <div
      className="lx-mk-tablewrap"
      role="region"
      aria-label="Qué ve y hace cada rol"
      tabIndex={0}
    >
      <table className="lx-mk-roles">
        <thead>
          <tr>
            <th scope="col">Qué puede hacer</th>
            {ROLES.map(r => (
              <th scope="col" key={r}>
                {ROLE_LABEL[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {ROLES.map(r => (
                <td key={r} data-label={ROLE_LABEL[r]}>
                  <CellView value={row.cells[r]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="lx-notice">
      <Icon name="lock" size={18} />
      <span>
        Los roles son <strong>por organización</strong> y se suman: Fabián es{' '}
        <Chip size="sm" certainty="confirmed">
          Administrador
        </Chip>{' '}
        +{' '}
        <Chip size="sm" certainty="confirmed">
          Desarrollador
        </Chip>
        . El servidor comprueba cada permiso: esconder una pantalla no basta.
      </span>
    </p>
  </div>
);
