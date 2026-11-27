/**
 * Revisión 1 · E5 routes: an event's budget and expenses, and the
 * organization's overview. Thin: validation here, rules in service.ts.
 */
import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {
  budgetSchema,
  createExpenseSchema,
  updateExpenseSchema,
} from './schemas.ts';
import {
  createExpense,
  deleteExpense,
  getBudget,
  listBudgetSummaries,
  setBudget,
  updateExpense,
} from './service.ts';
import type {
  BudgetSummary,
  EventBudget,
  EventBudgetResponse,
  Expense,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

export function registerBudgetRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/events/:id/budget', auth, async c => {
    const body: EventBudgetResponse = await getBudget(
      deps.db,
      c.get('user'),
      c.req.param('id'),
    );
    return c.json(body);
  });

  api.put('/events/:id/budget', auth, async c => {
    const input = await jsonBody(c, budgetSchema);
    const body: EventBudget = await setBudget(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(body);
  });

  api.get('/organizations/:orgId/budgets', auth, async c => {
    const body: ListResponse<BudgetSummary> = {
      items: await listBudgetSummaries(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
      ),
    };
    return c.json(body);
  });

  api.post('/expenses', auth, async c => {
    const input = await jsonBody(c, createExpenseSchema);
    const created = await createExpense(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/expenses/:id', auth, async c => {
    const input = await jsonBody(c, updateExpenseSchema);
    const body: Expense = await updateExpense(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(body);
  });

  api.delete('/expenses/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'el gasto');
    await deleteExpense(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
