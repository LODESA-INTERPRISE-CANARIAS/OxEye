import {expect, test, type Page} from '@playwright/test';
import {completeObjectivesStep, openWorkspaceWithDefaultProject, WIZARD_SUBMIT} from './helpers';

/**
 * OX-03 workspace flows: projects with several events, import as a new
 * project, and members with the access log. Local mode only.
 */

/**
 * Wizard step 1/5. On a second wizard run in the same page the objectives
 * sub-step may still be «Jerarquía e hipótesis», so handle both sub-steps.
 */
async function passObjectivesStep(page: Page): Promise<void> {
  const eyebrow = page.locator('#game-menu .game-eyebrow');
  await expect(eyebrow).toContainText('1 / 5');
  const wizard = page.locator('#wizard-form');
  await expect(wizard.locator('#smart-cards-grid, #smart-hypotheses').first()).toBeVisible();
  if (await wizard.locator('#smart-cards-grid').isVisible()) {
    await completeObjectivesStep(page);
    return;
  }
  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('2 / 5');
}

/** Runs the 5-step wizard with the Plaza del Cristo location and a given name. */
async function runWizard(page: Page, name: string): Promise<void> {
  const eyebrow = page.locator('#game-menu .game-eyebrow');
  await passObjectivesStep(page);
  // Plaza del Cristo, no network. A custom location would call OSM, so the
  // "different venues" case is covered by the eventVenues unit tests instead.
  await expect(page.locator('#location-mode-cristo')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#wizard-name').fill(name);
  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('3 / 5');
  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('4 / 5');
  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('5 / 5');
  await page.locator(WIZARD_SUBMIT).click();
  await expect(page.locator('#game-menu')).toBeHidden();
}

async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', {name: 'Menú'}).click();
  await expect(page.locator('#game-menu')).toBeVisible();
}

async function openWorkspaceScreen(page: Page): Promise<void> {
  await openMenu(page);
  await expect(page.locator('#game-workspace')).toBeEnabled();
  await page.locator('#game-workspace').click();
  await expect(page.locator('#ws-back')).toBeVisible();
}

const eventRow = (page: Page, name: string) =>
  page.locator('[data-event-id]').filter({has: page.locator('b', {hasText: name})});

test.describe('Espacio de trabajo (OX-03, modo local)', () => {
  test('creates a project with two events that survive a reload without duplicates', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#game-workspace')).toBeEnabled();

    // Event 1: first-run wizard (creates the default project «Mi proyecto»).
    await page.locator('#game-new').click();
    await runWizard(page, 'Evento Uno');
    const tour = page.locator('#tour-title');
    await expect(tour).toBeVisible();
    await page.locator('#tour-close').click();
    await expect(tour).toBeHidden();
    await expect(page.locator('#ctx-event option:checked')).toHaveText('Evento Uno');

    // Event 2: «Nuevo evento» of the same project from the workspace screen.
    await openWorkspaceScreen(page);
    await expect(page.locator('[data-project-id]')).toHaveCount(1);
    await page.locator('[data-project-id] .ws-new-event').click();
    await runWizard(page, 'Evento Dos');
    await expect(page.locator('#ctx-event option:checked')).toHaveText('Evento Dos');

    // Reload.
    await page.reload();
    await expect(page.locator('#game-continue')).toBeEnabled();

    // Both events listed exactly once in the header…
    const ctxEvent = page.locator('#ctx-event');
    await expect(ctxEvent.locator('option', {hasText: 'Evento Uno'})).toHaveCount(1);
    await expect(ctxEvent.locator('option', {hasText: 'Evento Dos'})).toHaveCount(1);
    await expect(page.locator('#ctx-project option')).toHaveCount(1);

    // …and in the workspace screen, inside one project.
    await page.locator('#game-workspace').click();
    await expect(page.locator('[data-project-id]')).toHaveCount(1);
    await expect(page.locator('[data-event-id]')).toHaveCount(2);
    await expect(eventRow(page, 'Evento Uno')).toHaveCount(1);
    await expect(eventRow(page, 'Evento Dos')).toHaveCount(1);

    // Each event opens: Evento Uno from the workspace screen…
    await eventRow(page, 'Evento Uno').locator('.ws-open').click();
    await expect(page.locator('#game-menu')).toBeHidden();
    await expect(page.locator('#ctx-event option:checked')).toHaveText('Evento Uno');
    await expect(page.locator('#ctx-day')).toBeEnabled();

    // …and Evento Dos from the header selector.
    await ctxEvent.selectOption({label: 'Evento Dos'});
    await expect(page.locator('#ctx-event option:checked')).toHaveText('Evento Dos');

    // Still no duplicates after opening both.
    await openWorkspaceScreen(page);
    await expect(page.locator('[data-project-id]')).toHaveCount(1);
    await expect(page.locator('[data-event-id]')).toHaveCount(2);
  });

  test('imports an exported v1 file as a new project once', async ({page}, testInfo) => {
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();

    // Fixture: a v1 file exported by the current version through «Exportar».
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export').click(),
    ]);
    const file = testInfo.outputPath('oxeye-v1-export.json');
    await download.saveAs(file);

    await openWorkspaceScreen(page);
    const projects = page.locator('[data-project-id]');
    await expect(projects).toHaveCount(1);
    const before = await projects.count();
    const eventsBefore = await page.locator('[data-event-id]').count();
    await page.locator('#ws-back').click();

    await page.locator('#file').setInputFiles(file);
    await expect(page.getByText('Importado como evento de un proyecto nuevo')).toBeVisible();
    await expect(page.locator('#game-menu')).toBeHidden();

    await openWorkspaceScreen(page);
    await expect(projects).toHaveCount(before + 1);
    // The new project holds exactly one event, which is the open one.
    const opened = page.locator('[data-event-id].is-open');
    await expect(opened).toHaveCount(1);
    const importedProject = projects.filter({has: opened});
    await expect(importedProject.locator('[data-event-id]')).toHaveCount(1);
    await page.locator('#ws-back').click();

    // Same file again: the existing event is reopened, no new project.
    await page.locator('#file').setInputFiles([]);
    await page.locator('#file').setInputFiles(file);
    await expect(
      page.getByText('Este archivo ya estaba importado: se abre el evento existente')
    ).toBeVisible();

    await openWorkspaceScreen(page);
    await expect(projects).toHaveCount(before + 1);
    // Exactly one event was added in total (the imported one), not one per import.
    await expect(page.locator('[data-event-id]')).toHaveCount(eventsBefore + 1);
    await expect(page.locator('#ctx-project option')).toHaveCount(before + 1);
  });

  test('records invite, role change and revoke, and opens read-only for a read-only profile', async ({
    page,
  }) => {
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(page.locator('#ctx-local-badge')).toBeVisible();
    await expect(page.locator('#ctx-readonly-badge')).toHaveCount(0);

    await page.locator('#ctx-members').click();
    const dialog = page.locator('#members-dialog');
    await expect(dialog).toBeVisible();

    // Invite «Solo lectura» scoped to the event.
    await page.locator('#members-name').fill('Lectora Uno');
    await page.locator('#members-contact').fill('lectora@example.test');
    await page.locator('#members-role').selectOption('read_only');
    await page.locator('#members-scope').selectOption('event');
    await page.locator('#members-invite').click();
    const row = dialog.locator('[data-membership-id]', {hasText: 'Lectora Uno'});
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('combobox')).toHaveValue('read_only');

    // Change role.
    await row.getByRole('combobox').selectOption('technician');
    await expect(row.getByRole('combobox')).toHaveValue('technician');

    // Revoke.
    await row.locator('.members-revoke').click();
    await expect(row).toHaveCount(0);

    const log = page.locator('#members-log li');
    await expect(log).toHaveCount(3);
    await expect(log.filter({hasText: 'invitó a Lectora Uno'})).toHaveCount(1);
    await expect(log.filter({hasText: 'cambió el rol de Lectora Uno'})).toHaveCount(1);
    await expect(log.filter({hasText: 'retiró a Lectora Uno'})).toHaveCount(1);

    // Another read-only person, then switch to that profile.
    await page.locator('#members-name').fill('Lectora Dos');
    await page.locator('#members-role').selectOption('read_only');
    await page.locator('#members-scope').selectOption('event');
    await page.locator('#members-invite').click();
    await expect(dialog.locator('[data-membership-id]', {hasText: 'Lectora Dos'})).toHaveCount(1);
    await expect(log).toHaveCount(4);
    await dialog.getByRole('button', {name: 'Cerrar'}).click();
    await expect(dialog).toBeHidden();

    await page.locator('#ctx-user').selectOption({label: 'Lectora Dos'});
    await expect(page.locator('#ctx-readonly-badge')).toBeVisible();
    await expect(page.locator('#ctx-local-badge')).toBeVisible();
    // The read-only profile still sees the open event.
    await expect(page.locator('#ctx-event option:checked')).not.toHaveText(/Sin evento|Elige/);
  });
});
