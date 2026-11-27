import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, oneOf} from '../http/validate.ts';
import {acronym, versionField} from '../records/schemas.ts';
import {ORGANIZATION_TIMEZONES} from '../../../shared/logistics/contracts.ts';
import {updateOrganization} from './service.ts';

/** OrganizationInput: the acronym (Revisión 1 · E2) and the time zone. */
const updateOrganizationSchema = z.object({
  version: versionField('los datos de la organización'),
  acronym,
  timezone: oneOf(
    ORGANIZATION_TIMEZONES,
    'Zona horaria no válida: usa Canarias (Atlantic/Canary) o Península (Europe/Madrid).',
  ).optional(),
});

/** Organization settings (members only; guests get 403 from auth). */
export function registerOrganizationRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.patch('/organizations/:orgId', auth, async c => {
    const input = await jsonBody(c, updateOrganizationSchema);
    const org = await updateOrganization(
      deps.db,
      c.get('user'),
      c.req.param('orgId'),
      input,
      deps.now(),
    );
    return c.json(org);
  });
}
