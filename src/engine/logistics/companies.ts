/**
 * @module engine/logistics/companies
 * Asignación de lotes de trabajo y recursos por empresas responsables en Pre/Post-evento.
 */
import type {CompanyItem, PhaseKey, Scene} from '../../types';

/** Devuelve la configuración base de empresas responsables del proyecto. */
export const baseCompanies = (): CompanyItem[] => [
  {
    name: 'Equipo municipal',
    lead: 'Por designar',
    scope: 'cover',
    pre: {people: 3, trucks: 1, forks: 1},
    post: {people: 3, trucks: 1, forks: 1},
  },
  {
    name: 'Empresa de producción',
    lead: 'Por designar',
    scope: 'other',
    pre: {people: 4, trucks: 2, forks: 2},
    post: {people: 4, trucks: 2, forks: 2},
  },
];

/**
 * Reparte las estructuras a montar o desmontar entre las empresas según su alcance (`scope`)
 * y su dotación de operarios.
 */
export function allocate(
  tasks: Array<Record<string, any>>,
  scene: Scene,
  phase: PhaseKey,
) {
  const companies = scene.companies ?? baseCompanies();
  const groups = companies.map(c => ({
    c,
    jobs: [] as Array<Record<string, any>>,
    res: c[phase as 'pre' | 'post'],
  }));
  const missing: string[] = [];

  for (const o of tasks) {
    const pool = groups.filter(
      g =>
        g.c.scope === (o.role === 'cover' ? 'cover' : 'other') ||
        g.c.scope === 'all',
    );
    const group = pool.sort(
      (a, b) =>
        a.jobs.length / Math.max(1, a.res?.people || 0) -
        b.jobs.length / Math.max(1, b.res?.people || 0),
    )[0];
    if (group) group.jobs.push(o);
    else missing.push(o.name);
  }
  return {groups, missing};
}
