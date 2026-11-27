import {expect, test, type Page} from '@playwright/test';
import {proposeAcronym} from '../../../shared/logistics/acronym.ts';
import {ORG, mockApi, signIn} from './mock-api';
import {fixClock} from './plan-fixtures';

/**
 * Revisión 1 · E2: the «Organización» sheet. A member sets the acronym that
 * starts every saved PDF's name (proposed from the name, checked as the
 * server checks it); another person's change is shown, never overwritten;
 * a change reported by `…/changes` reaches the sheet; guests only read.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const NAME = 'Ayuntamiento de La Laguna';
const PROPOSAL = proposeAcronym(NAME) ?? '';
const sheet = (page: Page) => page.locator('#lx-org-sheet');

async function openSheet(page: Page) {
  await page.locator('#lx-org-select').click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#lx-org-name')).toHaveText(NAME);
}

test.describe('Gestor logístico · Organización', () => {
  test('a member sets the acronym; the file name follows', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    // The sidebar card shows only the name; the acronym lives in the sheet.
    await expect(page.locator('#lx-org-select')).toContainText(NAME);
    await expect(page.locator('#lx-org-select')).not.toContainText('Siglas');
    await openSheet(page);
    await expect(page.locator('#lx-org-acronym-view')).toContainText(
      'propuesta a partir del nombre',
    );
    await expect(page.locator('#lx-org-example')).toContainText(`${PROPOSAL}_`);

    await page.locator('#lx-org-edit').click();
    const input = page.locator('#lx-org-acronym');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(PROPOSAL);

    // Checked before it leaves the device.
    await input.fill('S C!');
    await page.locator('#lx-org-save').click();
    await expect(page.locator('#lx-org-acronym-error')).toBeVisible();
    expect(api.calls('PATCH', `/organizations/${ORG}`)).toHaveLength(0);

    await input.fill('SCLL');
    await expect(page.locator('#lx-org-example')).toContainText('SCLL_');
    await page.locator('#lx-org-save').click();
    await expect(
      page.locator('.lx-toast', {hasText: 'Siglas guardadas: SCLL.'}),
    ).toBeVisible();
    expect(api.calls('PATCH', `/organizations/${ORG}`)[0].body).toEqual({
      acronym: 'SCLL',
      version: 1,
    });
    await expect(page.locator('#lx-org-acronym-view')).toContainText('SCLL');
    await expect(page.locator('#lx-org-acronym-view')).not.toContainText(
      'propuesta',
    );
  });

  test('another person changed it meanwhile: theirs is shown', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openSheet(page);
    await page.locator('#lx-org-edit').click();
    await page.locator('#lx-org-acronym').fill('MIO');
    Object.assign(api.organization, {acronym: 'AYTO', version: 2});
    await page.locator('#lx-org-save').click();
    await expect(page.locator('#lx-org-notice')).toContainText(
      'Otra persona ha cambiado las siglas',
    );
    await expect(page.locator('#lx-org-acronym')).toHaveValue('AYTO');
    // Saving again now carries their version.
    await page.locator('#lx-org-acronym').fill('MIO');
    await page.locator('#lx-org-save').click();
    await expect(page.locator('#lx-org-acronym-view')).toContainText('MIO');
    expect(api.calls('PATCH', `/organizations/${ORG}`).at(-1)!.body).toEqual({
      acronym: 'MIO',
      version: 2,
    });
  });

  test('a change reported by «…/changes» reaches the sheet', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    Object.assign(api.organization, {acronym: 'AYTO', version: 2});
    // The mock's `…/changes` compares lists; report the organization once.
    let reported = false;
    await page.route(
      u => u.pathname === `/api/organizations/${ORG}/changes`,
      async route => {
        if (reported) return route.fallback();
        reported = true;
        await route.fulfill({
          json: {cursor: '999', types: ['organization'], full: false},
        });
      },
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    // The card no longer shows the acronym: read it in the sheet.
    await openSheet(page);
    await expect(page.locator('#lx-org-acronym-view')).toContainText('AYTO');
  });

  test('«Usar la propuesta» only when the acronym differs, and restores it', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openSheet(page);
    const propose = page.locator('#lx-org-use-proposal');
    // Already the proposal: nothing to restore.
    await expect(propose).toBeDisabled();
    await expect(propose).toContainText(PROPOSAL);

    // While editing it follows the field.
    await page.locator('#lx-org-edit').click();
    await page.locator('#lx-org-acronym').fill('XYZ');
    await expect(propose).toBeEnabled();
    await propose.click();
    await expect(page.locator('#lx-org-acronym')).toHaveValue(PROPOSAL);
    await expect(propose).toBeDisabled();
    await page.locator('#lx-org-cancel').click();

    // A stored acronym: restoring saves at once.
    await page.locator('#lx-org-edit').click();
    await page.locator('#lx-org-acronym').fill('AYTO');
    await page.locator('#lx-org-save').click();
    await expect(page.locator('#lx-org-acronym-view')).toContainText('AYTO');
    await expect(propose).toBeEnabled();
    await propose.click();
    await expect(
      page.locator('.lx-toast', {hasText: 'Se usarán las siglas propuestas'}),
    ).toBeVisible();
    expect(api.calls('PATCH', `/organizations/${ORG}`).at(-1)!.body).toEqual({
      acronym: null,
      version: 2,
    });
    await expect(page.locator('#lx-org-acronym-view')).toContainText(
      'propuesta a partir del nombre',
    );
    await expect(propose).toBeDisabled();
  });

  test('the reference time: Canarias by default, peninsular on choice', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openSheet(page);
    const canary = page.getByRole('radio', {name: 'Hora de Canarias'});
    const peninsular = page.getByRole('radio', {name: 'Hora peninsular'});
    await expect(canary).toBeChecked();
    await expect(page.locator('#lx-org-zone-note')).toContainText(
      'los que ya existen mantienen su hora',
    );

    // Controlled by the saved value: it turns on once the server agrees.
    await peninsular.click();
    await expect(
      page.locator('.lx-toast', {
        hasText: 'Hora de referencia: hora peninsular',
      }),
    ).toBeVisible();
    expect(api.calls('PATCH', `/organizations/${ORG}`).at(-1)!.body).toEqual({
      timezone: 'Europe/Madrid',
      version: 1,
    });
    await expect(peninsular).toBeChecked();
    expect(api.organization.timezone).toBe('Europe/Madrid');
    await sheet(page)
      .locator('.lx-sheet__panel, [role="dialog"]')
      .first()
      .screenshot({path: 'test-results/visual/logistics-org-sheet.png'});
  });

  test('a guest reads it and cannot change it', async ({page}) => {
    await mockApi(page);
    await signIn(page, 'Invitado');
    await openSheet(page);
    await expect(page.locator('#lx-org-edit')).toHaveCount(0);
    await expect(page.locator('#lx-org-readonly')).toBeVisible();
    await expect(page.locator('#lx-org-use-proposal')).toHaveCount(0);
    await expect(page.locator('#lx-org-timezone')).toHaveCount(0);
    await expect(page.locator('#lx-org-timezone-view')).toHaveText(
      'hora de Canarias',
    );
  });
});
