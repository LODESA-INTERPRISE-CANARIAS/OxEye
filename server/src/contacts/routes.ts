import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createContactSchema, updateContactSchema} from './schemas.ts';
import {
  createContact,
  deleteContact,
  listContacts,
  updateContact,
} from './service.ts';
import type {
  Contact,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

export function registerContactRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/contacts', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Contact> = {
      items: await listContacts(deps.db, org.id, user),
    };
    return c.json(body);
  });

  api.post('/contacts', auth, async c => {
    const input = await jsonBody(c, createContactSchema);
    const created = await createContact(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/contacts/:id', auth, async c => {
    const input = await jsonBody(c, updateContactSchema);
    const contact = await updateContact(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(contact);
  });

  api.delete('/contacts/:id', auth, async c => {
    const version = parseVersionParam(
      c.req.query('version'),
      'la ficha de la persona',
    );
    await deleteContact(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
