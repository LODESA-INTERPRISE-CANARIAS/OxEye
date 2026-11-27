import {expect, test, type Page} from '@playwright/test';
import {windowsFor} from '../../../shared/logistics/acceptance.ts';
import {planWarnings} from '../../../shared/logistics/conflicts.ts';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {
  dailos,
  elvis,
  makeActivity,
  mockApi,
  ORG,
  PASSWORD,
  signIn,
  type MockApi,
} from './mock-api';
import {withBudget} from './money-fixtures';
import {offersData} from './offers-fixtures';
import {DAY, fixClock, planData} from './plan-fixtures';

/**
 * Revisión 1 · E5 follow-ups:
 * - the event budget has its own address (`…/ficha/presupuesto/<eventId>`):
 *   a link opens it, Back and Forward step over it, and without
 *   `budget.read` it shows «Sin acceso» and asks the server nothing;
 * - support attribution (migration 0012): a change made in a support
 *   session reads «Dailos (soporte: Elvis)» in the activity feed, a record's
 *   history and an accepted conflict.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const budgetCalls = (api: MockApi) =>
  api.requests.filter(
    r => /\/budget$|\/budgets$/.test(r.path) || r.path.startsWith('/expenses'),
  );
const hash = (page: Page) => page.evaluate(() => location.hash);

test.describe('Gestor logístico · presupuesto con dirección propia', () => {
  test('opened from the event: its own address, Back and Forward', async ({
    page,
  }) => {
    await mockApi(page, withBudget());
    await signIn(page, 'Elvis', '#logistica/ficha/evento/e1');
    await expect(page.locator('#lx-event-budget')).toContainText('Quedan');
    await page.locator('#lx-event-budget-open').click();
    const budget = page.locator('#lx-budget-sheet');
    await expect(budget).toBeVisible();
    await expect(budget).toContainText('Navidad en la Plaza del Cristo');
    await expect.poll(() => hash(page)).toBe('#logistica/ficha/presupuesto/e1');

    await page.goBack();
    await expect(budget).toHaveCount(0);
    await expect(page.locator('#lx-event-sheet')).toBeVisible();
    await expect.poll(() => hash(page)).toBe('#logistica/ficha/evento/e1');

    await page.goForward();
    await expect(budget).toBeVisible();
    await expect(page.locator('#lx-budget-amount')).toContainText('2000');
  });

  test('a shared link opens the budget; a change shows on the event card', async ({
    page,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Elvis', '#logistica/calendario/ficha/presupuesto/e1');
    const budget = page.locator('#lx-budget-sheet');
    await expect(budget).toBeVisible();
    await expect(page.locator('#lx-budget-amount')).toContainText('2000');
    expect(api.calls('GET', '/events/e1/budget')).toHaveLength(1);
    await page.locator('#lx-budget-close').click();
    await expect(budget).toHaveCount(0);
    await expect.poll(() => hash(page)).toBe('#logistica/calendario');

    // From the event sheet: the card follows what the budget sheet saved.
    await page.evaluate(() => {
      location.hash = '#logistica/calendario/ficha/evento/e1';
    });
    await page.locator('#lx-event-budget-open').click();
    await page.locator('#lx-budget-edit').click();
    await page.locator('#lx-budget-input').fill('3.000');
    await page.locator('#lx-budget-save').click();
    await expect(page.locator('#lx-budget-amount')).toContainText('3000');
    await page.locator('#lx-budget-close').click();
    await expect(page.locator('#lx-event-budget')).toContainText('3000');
  });

  test('without budget.read the address says «Sin acceso» and asks nothing', async ({
    page,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Equipo', '#logistica/ficha/presupuesto/e1');
    const locked = page.locator('#lx-budget-noaccess');
    await expect(locked).toBeVisible();
    await expect(locked).toContainText('Presupuesto: sin acceso');
    await expect(page.locator('#lx-budget-sheet')).not.toContainText('2000');
    expect(budgetCalls(api)).toEqual([]);
    await page.locator('#lx-budget-close').click();
    await expect(locked).toHaveCount(0);
  });

  test('a provisional password holds it back and offers the change', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      ...withBudget(),
      accounts: {Dailos: {passwordProvisional: true}},
    });
    await signIn(page, 'Dailos', '#logistica/ficha/presupuesto/e1');
    const held = page.locator('#lx-budget-noaccess');
    await expect(held).toContainText('Pendiente de tu contraseña nueva');
    await expect(page.locator('#lx-budget-noaccess-password')).toBeVisible();
    expect(budgetCalls(api)).toEqual([]);
  });
});

test.describe('Gestor logístico · cambios firmados en soporte', () => {
  test('the feed and a record history say «Dailos (soporte: Elvis)»', async ({
    page,
  }) => {
    const at = new Date(Date.now() - 10 * 60_000).toISOString();
    const event = {
      type: 'event',
      id: 'e1',
      label: 'Navidad en la Plaza del Cristo',
    };
    await mockApi(page, {
      activity: [
        makeActivity('a-support', event, 'update', at, {
          user: dailos,
          supportBy: elvis,
          changedFields: ['notes'],
        }),
      ],
    });
    await signIn(page, 'Elvis');
    const item = page.locator('[data-activity-id="a-support"]');
    await expect(item).toContainText('Dailos (soporte: Elvis)');
    await expect(item.locator('.lx-signature')).toHaveAttribute(
      'title',
      /sesión de soporte en la cuenta de Dailos/,
    );

    await page.evaluate(() => {
      location.hash = '#logistica/ficha/evento/e1';
    });
    await page.locator('#lx-event-history-toggle').click();
    await expect(page.locator('#lx-event-history')).toContainText(
      'Dailos (soporte: Elvis)',
    );
  });

  test('writes in a support session are signed with the administrator', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const row = page.locator('#lx-users-list [data-user="Dailos"]');
    await row.locator('.lx-users__head').click();
    await row.getByRole('button', {name: 'Abrir sesión de soporte'}).click();
    await page
      .locator('#lx-support-reason')
      .fill('Le falta una nota en el evento de Navidad');
    await page.locator('#lx-support-password').fill(PASSWORD);
    await page.locator('#lx-support-start').click();
    await expect(page.locator('#lx-support-banner')).toBeVisible();

    // An incident written as Dailos while Elvis gives support.
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-incident').click();
    await page
      .locator('#lx-note-text-input')
      .fill('El camión de vallas no llega');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    const signed = api.activity.at(-1) as {
      user: {displayName: string};
      supportBy?: {displayName: string};
    };
    expect(signed.user.displayName).toBe('Dailos');
    expect(signed.supportBy?.displayName).toBe('Elvis');
  });

  test('an accepted conflict says who accepted it in support', async ({
    page,
  }) => {
    await fixClock(page);
    await page.setViewportSize({width: 1280, height: 900});
    const data = planData();
    const tasks = data.tasks as unknown as Task[];
    const warning = planWarnings(
      tasks,
      data.events as unknown as LogisticsEvent[],
    ).find(w => w.kind === 'dependency_order')!;
    await mockApi(page, {
      ...data,
      acceptances: [
        {
          id: 'ca1',
          organizationId: ORG,
          warningKey: warning.key,
          windows: windowsFor(warning, tasks),
          reason: 'Se coordina en obra.',
          acceptedBy: dailos,
          acceptedBySupport: elvis,
          acceptedAt: '2026-12-02T09:00:00.000Z',
        },
      ],
    });
    await signIn(page, 'Elvis', `#logistica/calendario/${DAY}`);
    const box = page.locator('#lx-day-warnings');
    if (!(await box.evaluate(d => (d as HTMLDetailsElement).open))) {
      await box.locator('summary').click();
    }
    await expect(box.locator('.lx-warning--accepted')).toContainText(
      'Dailos (soporte: Elvis)',
    );
  });

  test('a proposal decided in support says who decided it', async ({page}) => {
    const data = offersData();
    const proposals = data.proposals as Record<string, unknown>[];
    Object.assign(
      proposals.find(p => p.id === 'p1')!,
      {
        state: 'approved',
        decidedBy: dailos,
        decidedBySupport: elvis,
        decidedAt: '2026-11-26T10:02:00.000Z',
      },
    );
    await mockApi(page, data);
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await page.locator('#lx-ctab-inbox').click();
    await page.locator('#lx-inbox-tab-approved').click();
    const row = page.locator('#lx-inbox-list [data-proposal-id="p1"]');
    await expect(row).toContainText('aprobada por Dailos (soporte: Elvis)');
    await row.click();
    await expect(page.locator('#lx-proposal-decided')).toContainText(
      'Aprobada por Dailos (soporte: Elvis)',
    );
  });
});
