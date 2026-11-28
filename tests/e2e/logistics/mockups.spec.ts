import {expect, test, type Locator, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {choose} from './controls';

/**
 * Visual walk through the Revisión 1 mock-ups (F1 offers and suppliers, F2
 * access and profiles) at `/gestor-logistico/maquetas` (development server only).
 * The mock-ups use fictitious data and no server, so nothing is mocked here;
 * the spec clicks through every screen and takes screenshots on phone and
 * desktop in a light and a dark palette. It asserts only what it needs to
 * reach each screen: behaviour is not under test.
 *
 * Output: test-results/visual/mockups-<viewport>-<screen>-<palette>.png
 * Run: npx playwright test tests/e2e/logistics/mockups.spec.ts
 */

const PALETTES = ['oxeye', 'noctis'] as const;
const OUT = 'test-results/visual';
const VIEWPORTS = {
  phone: {width: 390, height: 844},
  desktop: {width: 1280, height: 800},
} as const;
type Viewport = keyof typeof VIEWPORTS;

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.describe.configure({timeout: 180_000});

async function openIndex(page: Page, vp: Viewport) {
  await page.setViewportSize(VIEWPORTS[vp]);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(lxUrl('maquetas'));
  await expect(page.locator('#mk-index')).toBeVisible({timeout: 30_000});
}

async function shot(page: Page, vp: Viewport, name: string) {
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(250);
    await page.screenshot({path: `${OUT}/mockups-${vp}-${name}-${id}.png`});
  }
  await page.evaluate(() => {
    document.documentElement.dataset.palette = 'oxeye';
  });
}

/** Clicks an answer card inside the fieldset whose legend says `legend`. */
async function answer(page: Page, legend: string, option: string) {
  const group = page
    .locator('fieldset', {
      has: page.locator('legend', {hasText: legend}),
    })
    .last();
  await group.locator('label', {hasText: option}).first().click();
}

async function next(page: Page, step: string) {
  await page.locator('#sf-next').click();
  await expect(page.locator(`.lx-mk-sf[data-step="${step}"]`)).toBeVisible();
}

async function scrollBottom(scroller: Locator) {
  await scroller.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
}

function visibleNav(page: Page, shell: string, id: string): Locator {
  return page.locator(
    `#${shell}-nav-${id}:visible, #${shell}-tab-${id}:visible`,
  );
}

for (const vp of Object.keys(VIEWPORTS) as Viewport[]) {
  test.describe(`Maquetas · ${vp}`, () => {
    test('índice', async ({page}) => {
      await openIndex(page, vp);
      if (vp === 'desktop') {
        // The ribbon's palette switch (the Gestor's own select).
        await choose(page, 'mk-palette', 'atlas');
        await expect(page.locator('html')).toHaveAttribute(
          'data-palette',
          'atlas',
        );
      }
      await shot(page, vp, 'index');
      await page
        .locator('#mk-index')
        .evaluate(el => (el.scrollTop = el.scrollHeight));
      await shot(page, vp, 'index-bottom');
    });

    test('F1 · proveedor responde a una solicitud', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-supplier-request').click();
      await expect(page.locator('.lx-mk-sf[data-step="start"]')).toBeVisible();
      await shot(page, vp, 'f1-sf-01-start');

      await page.locator('label', {hasText: 'Sí, puedo ofrecerlo'}).click();
      await expect(
        page.locator('.lx-mk-sf[data-step="categories"]'),
      ).toBeVisible();
      await shot(page, vp, 'f1-sf-02-categories');

      await page.locator('#sf-next').click();
      await expect(page.locator('.lx-mk-sf[data-step$=":what"]')).toBeVisible();
      await shot(page, vp, 'f1-sf-03-what');

      await page.locator('#sf-next').click();
      await expect(
        page.locator('.lx-mk-sf[data-step$=":price"]'),
      ).toBeVisible();
      await page.locator('.lx-mk-money input').first().fill('180');
      await shot(page, vp, 'f1-sf-04-price');

      await page.locator('#sf-next').click();
      await answer(page, 'Montaje y desmontaje', 'Incluido en el precio');
      await answer(page, 'Transporte', 'Se cobra aparte');
      await page.locator('.lx-mk-money input').first().fill('90');
      await answer(page, 'Lastres', 'Los ponemos nosotros');
      await shot(page, vp, 'f1-sf-05-extras');

      await page.locator('#sf-next').click();
      await answer(page, 'época del año', 'Cambia según la temporada');
      await page.locator('.lx-mk-season--summer input').fill('165');
      await page.locator('.lx-mk-season--rain input').fill('195');
      await answer(page, '¿Hay un mínimo?', 'Sin mínimo');
      await shot(page, vp, 'f1-sf-06-conditions');

      await next(page, 'more');
      await shot(page, vp, 'f1-sf-07-more');

      await next(page, 'tax');
      await answer(page, 'Impuesto', 'IGIC');
      await answer(page, 'llevan ya el impuesto', 'No, son sin impuestos');
      await shot(page, vp, 'f1-sf-08-tax');

      await next(page, 'validity');
      await answer(page, 'Mantengo el precio', '30 días');
      await answer(page, 'prestar el servicio', 'Sí, las 4 jornadas');
      await shot(page, vp, 'f1-sf-09-validity');

      await next(page, 'special');
      await answer(page, 'Compromiso de varios años', 'Sí');
      await page.locator('#sf-commit-price').fill('170');
      await shot(page, vp, 'f1-sf-10-special');

      await next(page, 'review');
      await shot(page, vp, 'f1-sf-11-review');
      await page.locator('#sf-privacy').check();
      await scrollBottom(page.locator('.lx-mk-sf__body'));
      await shot(page, vp, 'f1-sf-12-review-bottom');

      await page.locator('#sf-next').click();
      await expect(page.locator('#sf-sent')).toBeVisible();
      await shot(page, vp, 'f1-sf-13-sent');
    });

    test('F1 · oferta libre con varias actividades', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-supplier-open').click();
      await expect(page.locator('.lx-mk-sf[data-step="start"]')).toBeVisible();
      await shot(page, vp, 'f1-open-01-start');
      await next(page, 'contact');
      await page.locator('#sf-company').fill('Eventos Anaga Demo');
      await page.locator('#sf-person').fill('Rosa Demo');
      await page.locator('#sf-phone').fill('+34 000 000 091');
      await shot(page, vp, 'f1-open-02-contact');
      await next(page, 'categories');
      const body = page.locator('.lx-mk-sf__body');
      await body.locator('label', {hasText: 'Carpas'}).first().click();
      await body.locator('label', {hasText: 'Limpieza'}).first().click();
      await shot(page, vp, 'f1-open-03-categories');
      // Carpas: what, price, extras, conditions; then Limpieza.
      for (let i = 0; i < 5; i++) {
        await page.locator('#sf-next').click();
      }
      await expect(
        page.locator('.lx-mk-sf[data-step^="p:limpieza"]'),
      ).toBeVisible();
      await shot(page, vp, 'f1-open-04-cleaning');
      await page.locator('#sf-next').click();
      await answer(page, '¿Cómo lo cobras?', 'Por hora y persona');
      await page.locator('.lx-mk-money input').first().fill('18');
      await page.locator('#sf-next').click();
      await answer(page, '¿Trabajáis de noche?', 'Sí, con suplemento');
      await shot(page, vp, 'f1-open-05-cleaning-extras');
    });

    test('F1 · registrar a mano y enlace caducado', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-supplier-manual').click();
      await expect(page.locator('.lx-mk-sf[data-step="start"]')).toBeVisible();
      await shot(page, vp, 'f1-manual-start');
      await page.locator('#mk-to-index').click();
      await page.locator('#mk-go-supplier-expired').click();
      await expect(page.locator('#sf-expired')).toBeVisible();
      await shot(page, vp, 'f1-expired');
    });

    test('F1 · solicitudes y pedir presupuesto', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-requests').click();
      await expect(page.locator('#mk-requests')).toBeVisible();
      await shot(page, vp, 'f1-requests');
      await page.locator('#mk-new-request').click();
      const sheet = page.locator('#mk-request-sheet');
      await expect(sheet).toBeVisible();
      await shot(page, vp, 'f1-request-1-need');
      await sheet.locator('button', {hasText: 'Siguiente'}).click();
      await sheet.locator('label', {hasText: 'Carpas Mario Demo'}).click();
      await sheet.locator('label', {hasText: 'Toldos Atlántico Demo'}).click();
      await shot(page, vp, 'f1-request-2-companies');
      await sheet.locator('button', {hasText: 'Preparar'}).click();
      await expect(sheet.locator('.lx-mk-sendrow').first()).toBeVisible();
      await shot(page, vp, 'f1-request-3-send');
    });

    test('F1 · recibidas, aprobar y ver como equipo', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-inbox').click();
      await expect(page.locator('#mk-inbox')).toBeVisible();
      await shot(page, vp, 'f1-inbox');
      await page.locator('[data-proposal="p-toldos"]').click();
      await expect(page.locator('#mk-proposal-sheet')).toBeVisible();
      await shot(page, vp, 'f1-proposal');
      await page.locator('#mk-approve').click();
      await shot(page, vp, 'f1-proposal-approve');
      await page.locator('#mk-approve-confirm').click();
      await expect(page.locator('#mk-proposal-sheet')).toBeHidden();
      await shot(page, vp, 'f1-inbox-after-approve');
      await page.locator('#mk-viewas-team').click();
      await expect(page.locator('#mk-team-note')).toBeVisible();
      await shot(page, vp, 'f1-inbox-team');
    });

    test('F1 · comparar y detalle de oferta', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-compare').click();
      await expect(page.locator('#mk-compare')).toBeVisible();
      await shot(page, vp, 'f1-compare');
      await page.locator('.lx-mk-rank__details summary').first().click();
      await page
        .locator('.lx-mk-rank__details')
        .first()
        .scrollIntoViewIfNeeded();
      await shot(page, vp, 'f1-compare-breakdown');
      await page.locator('.lx-mk-apart').first().scrollIntoViewIfNeeded();
      await shot(page, vp, 'f1-compare-apart');
      await page
        .locator('[data-offer="o-mario"] button', {hasText: 'Ver oferta'})
        .click();
      const sheet = page.locator('#mk-offer-sheet');
      await expect(sheet).toBeVisible();
      await shot(page, vp, 'f1-offer');
      await sheet.locator('.lx-mk-tl').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f1-offer-dates');
      await scrollBottom(sheet.locator('.lx-sheet__body'));
      await shot(page, vp, 'f1-offer-versions');
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await page
        .locator('#mk-compare .lx-filterchip', {hasText: 'Limpieza'})
        .click();
      await shot(page, vp, 'f1-compare-cleaning');
      await page
        .locator('#mk-compare .lx-filterchip', {hasText: 'Castillo'})
        .click();
      await page
        .locator('.lx-mk-rank')
        .first()
        .locator('button', {hasText: 'Ver oferta'})
        .click();
      await expect(sheet).toBeVisible();
      await sheet.locator('.lx-mk-offer__deal').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f1-offer-commitment');
    });

    test('F1 · renovaciones', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-renewals').click();
      await expect(page.locator('#mk-renewals')).toBeVisible();
      await shot(page, vp, 'f1-renewals');
      await page
        .locator('#mk-renewals .lx-mk-apartrow')
        .last()
        .scrollIntoViewIfNeeded();
      await shot(page, vp, 'f1-renewals-bottom');
    });

    test('F2 · inicio de sesión y recuperación', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-login').click();
      await expect(page.locator('#mk-login')).toBeVisible();
      await shot(page, vp, 'f2-login');
      await page.locator('#mk-login-user').fill('nadie');
      await page.locator('#mk-login-password').fill('secreto');
      await page.locator('#mk-login-submit').click();
      await expect(page.locator('#mk-login-password-error')).toBeVisible();
      await shot(page, vp, 'f2-login-error');

      await page.locator('#mk-forgot').click();
      await expect(page.locator('#mk-recovery')).toBeVisible();
      await page.locator('#mk-rec-user').fill('Dailos');
      await shot(page, vp, 'f2-recovery-1-ask');
      await page.locator('#mk-rec-send').click();
      await expect(page.locator('#mk-rec-sent')).toBeVisible();
      await shot(page, vp, 'f2-recovery-2-sent');
      await page.locator('#mk-rec-open-mail').click();
      await shot(page, vp, 'f2-recovery-3-mail');
      await page.locator('#mk-rec-link').click();
      await page.locator('#mk-rec-pw').fill('plaza tinerfe amarilla 47');
      await page.locator('#mk-rec-pw2').fill('plaza tinerfe amarilla 47');
      await shot(page, vp, 'f2-recovery-4-new');
      await page.locator('#mk-rec-save').click();
      await expect(page.locator('#mk-rec-done')).toBeVisible();
      await shot(page, vp, 'f2-recovery-5-done');
    });

    test('F2 · bienvenida del primer inicio', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-login').click();
      await page.locator('#mk-login-user').fill('yeray');
      await page.locator('#mk-login-password').fill('secreto');
      await page.locator('#mk-login-submit').click();
      await expect(page.locator('#mk-welcome')).toBeVisible();
      await shot(page, vp, 'f2-welcome-1-hello');
      await page.locator('label', {hasText: 'Elegir una nueva ahora'}).click();
      await page.locator('#mk-welcome-next').click();
      await page.locator('#mk-wpw-new').fill('Faro de Anaga 2026');
      await shot(page, vp, 'f2-welcome-2-password');
      await page.locator('#mk-wpw-repeat').fill('Faro de Anaga 2026');
      await page.locator('button', {hasText: 'Guardar y seguir'}).click();
      await page.locator('#mk-w-email').fill('yeray@example.com');
      await page.locator('#mk-w-about').fill('Dirección del proyecto');
      await shot(page, vp, 'f2-welcome-3-profile');
      await page.locator('#mk-welcome-done').click();
      await expect(page.locator('#mk-profile')).toBeVisible();
      await shot(page, vp, 'f2-welcome-4-landed');
    });

    test('F2 · perfil, seguridad y actividad', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-profile').click();
      await expect(page.locator('#mk-profile-perfil')).toBeVisible();
      await shot(page, vp, 'f2-profile');
      await page.locator('#mk-p-look').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-profile-appearance');
      await visibleNav(page, 'mk-profile', 'seguridad').click();
      await expect(page.locator('#mk-profile-seguridad')).toBeVisible();
      await page.locator('#mk-s-pw').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-security');
      await page.locator('#mk-s-history').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-security-history');
      await page.locator('#mk-change-pw').click();
      await expect(page.locator('#mk-password-sheet')).toBeVisible();
      await page.locator('#mk-pw-new').fill('contraseña');
      await shot(page, vp, 'f2-password-sheet');
      await page.keyboard.press('Escape');
      await visibleNav(page, 'mk-profile', 'actividad').click();
      await expect(page.locator('#mk-profile-actividad')).toBeVisible();
      await page.locator('#mk-a-week').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-activity');
    });

    test('F2 · usuarios, provisional y soporte', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-users').click();
      await expect(page.locator('#mk-people')).toBeVisible();
      await shot(page, vp, 'f2-users');
      await page.locator('[data-user="Elvis"]').click();
      const sheet = page.locator('#mk-user-sheet');
      await expect(sheet).toBeVisible();
      await shot(page, vp, 'f2-user');
      await page.locator('#mk-prov').click();
      await page.locator('#mk-prov-confirm').click();
      await expect(sheet.locator('.lx-mk-provisional')).toBeVisible();
      await sheet.locator('.lx-mk-provisional').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-user-provisional');
      await page.locator('#mk-start-support').click();
      const support = page.locator('#mk-support-sheet');
      await expect(support).toBeVisible();
      await support.locator('label', {hasText: 'Revisar un error'}).click();
      await page
        .locator('#mk-support-detail')
        .fill('El calendario no le carga');
      await page.locator('#mk-support-pw').fill('secreto');
      await shot(page, vp, 'f2-support-sheet');
      await page.locator('#mk-support-go').click();
      await expect(page.locator('#mk-support-banner')).toBeVisible();
      await shot(page, vp, 'f2-support-active');
      await page.locator('#mk-support-end').click();
      await expect(page.locator('#mk-support-banner')).toBeHidden();
      await page.locator('#mk-view-guest').click();
      await expect(page.locator('#mk-guest-banner')).toBeVisible();
      await shot(page, vp, 'f2-guest');
    });

    test('F2 · registro de seguridad y roles', async ({page}) => {
      await openIndex(page, vp);
      await page.locator('#mk-go-log').click();
      await expect(page.locator('#mk-log')).toBeVisible();
      await shot(page, vp, 'f2-log');
      await page.locator('#mk-to-index').click();
      await page.locator('#mk-go-roles').click();
      await expect(page.locator('#mk-roles')).toBeVisible();
      await shot(page, vp, 'f2-roles');
      await page.locator('.lx-mk-tablewrap').scrollIntoViewIfNeeded();
      await shot(page, vp, 'f2-roles-table');
    });
  });
}
