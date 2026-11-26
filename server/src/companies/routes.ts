import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createCompanySchema, updateCompanySchema} from './schemas.ts';
import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from './service.ts';
import type {
  Company,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

export function registerCompanyRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/companies', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Company> = {
      items: await listCompanies(deps.db, org.id, user),
    };
    return c.json(body);
  });

  api.post('/companies', auth, async c => {
    const input = await jsonBody(c, createCompanySchema);
    const company = await createCompany(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(company, 201);
  });

  api.patch('/companies/:id', auth, async c => {
    const input = await jsonBody(c, updateCompanySchema);
    const company = await updateCompany(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(company);
  });

  api.delete('/companies/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'la empresa');
    await deleteCompany(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
