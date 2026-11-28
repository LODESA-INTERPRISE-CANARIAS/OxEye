import {expect, test, type Page} from '@playwright/test';
import {lxUrl, lxUrlRe} from './address';
import {PASSWORD, RESET_TOKEN, mockApi, signIn} from './mock-api';

/**
 * Revisión 1 · E4, review follow-ups: the shared «Equipo» account (no
 * provisional prompt, name and password set by administration, edited from
 * «Usuarios»), «Usuarios» waiting for unsent changes before entering another
 * account, password help limited to accounts the viewer outranks, a reset
 * link used inside an open session, «Catálogo» on the phone only with the
 * directory, and a 401 from a direct call ending the session.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

async function openUser(page: Page, username: string) {
  const row = page.locator(`#lx-users-list [data-user="${username}"]`);
  await row.locator('.lx-users__head').click();
  return row;
}

test.describe('Gestor logístico · E4 · cuenta compartida Equipo', () => {
  test('no provisional prompt, one welcome step, name and password locked', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      accounts: {Equipo: {welcomed: false, passwordProvisional: true}},
    });
    await signIn(page, 'Equipo');

    // Welcome: a single profile step, the shared-account explanation.
    const welcome = page.locator('#lx-welcome-sheet');
    await expect(welcome).toContainText('Primer acceso');
    await expect(welcome).not.toContainText('paso 1 de 2');
    await expect(page.locator('#lx-welcome-password-step')).toHaveCount(0);
    await expect(page.locator('#lx-welcome-profile-step')).toContainText(
      'cuenta compartida por varias personas',
    );
    await expect(page.locator('#lx-welcome-edit-name')).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(page.locator('#lx-welcome-edit-photo')).toHaveCount(0);
    await expect(page.locator('#lx-welcome-email-title')).toHaveCount(0);
    await page.locator('#lx-welcome-edit-bio').fill('Móvil del almacén');
    await page.locator('#lx-welcome-start').click();
    await expect(welcome).toHaveCount(0);
    expect(api.calls('PATCH', '/me/profile')[0]?.body).toMatchObject({
      displayName: 'Equipo',
      bio: 'Móvil del almacén',
    });

    // Nobody on the field is asked to change the team's password.
    await expect(page.locator('#lx-provisional-banner')).toHaveCount(0);
    await expect(page.locator('#lx-user-role')).toHaveText('Equipo');

    await page.locator('#lx-user-open').click();
    await expect(page.locator('#lx-profile-edit-name')).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(page.locator('#lx-profile-edit-shared')).toContainText(
      'los cambia administración',
    );
    await expect(page.locator('#lx-profile-edit-photo')).toHaveCount(0);

    await page.locator('#lx-profile-tab-seguridad').click();
    await expect(page.locator('#lx-profile-password-shared')).toContainText(
      'La contraseña de Equipo la pone administración',
    );
    await expect(page.locator('#lx-profile-password-current')).toHaveCount(0);
    await expect(page.locator('#lx-profile-shared')).toContainText(
      'no tiene correo de recuperación',
    );
    // Its other sessions are colleagues' phones: no «Cerrar las demás».
    await expect(page.locator('#lx-profile-sessions')).toContainText(
      'Safari · iPhone',
    );
    await expect(page.locator('#lx-profile-sessions-others')).toHaveCount(0);
    expect(api.calls('POST', '/me/password')).toHaveLength(0);
  });

  test('administration renames Equipo and sets its password from «Usuarios»', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const equipo = await openUser(page, 'Equipo');
    await expect(equipo).toContainText('Compartida');
    await expect(equipo).not.toContainText('Sin correo');

    // A taken name is said on the field.
    const name = page.locator('#lx-users-shared-Equipo-name');
    await name.fill('Dailos');
    await page.locator('#lx-users-shared-Equipo-save').click();
    await expect(
      page.locator('#lx-users-shared-Equipo-name-error'),
    ).toContainText('Ya hay otra persona con ese nombre');

    await name.fill('Equipo de montaje');
    await page.locator('#lx-users-shared-Equipo-save').click();
    await expect(page.locator('.lx-toast')).toContainText(
      'Nombre de la cuenta compartida: Equipo de montaje',
    );
    expect(
      api.calls('PATCH', '/admin/users/u-equipo/profile').at(-1)?.body,
    ).toEqual({version: 1, displayName: 'Equipo de montaje'});
    await expect(equipo.locator('.lx-users__who strong')).toHaveText(
      'Equipo de montaje',
    );
    expect(api.e4.accounts.Equipo!.displayName).toBe('Equipo de montaje');

    // Its password is simply a new one; no reset link (no recovery e-mail).
    await expect(page.locator('#lx-users-link-Equipo')).toHaveCount(0);
    await expect(page.locator('#lx-users-pw-Equipo')).toHaveText(
      'Poner contraseña nueva',
    );

    // A personal account has no such editor: each person edits their own.
    await openUser(page, 'Dailos');
    await expect(page.locator('#lx-users-shared-Dailos')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · E4 · Usuarios · límites', () => {
  test('unsent changes hold back «Ver como Invitado» and support sessions', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    // A note written without coverage waits on this device; back online the
    // server still refuses writes, so it keeps waiting.
    await context.setOffline(true);
    await expect(page.locator('#lx-sync-chip')).toHaveAttribute(
      'data-state',
      'offline',
    );
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-note').click();
    await page.locator('#lx-note-text-input').fill('Falta cinta de balizar');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    // The saved note opens; back to the workspace.
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    api.writesOffline = true;
    await context.setOffline(false);

    await page.locator('#lx-nav-usuarios').click();
    const notice = page.locator('#lx-users-unsent');
    await expect(notice).toContainText('un cambio');
    await expect(notice).toContainText('sin enviar en este dispositivo');
    await expect(page.locator('#lx-users-view-as-guest')).toBeDisabled();
    await expect(page.locator('#lx-users-view-as-guest')).toHaveAttribute(
      'aria-describedby',
      'lx-users-unsent',
    );
    const dailos = await openUser(page, 'Dailos');
    await expect(
      dailos.getByRole('button', {name: 'Abrir sesión de soporte'}),
    ).toBeDisabled();
    expect(api.calls('POST', '/admin/view-as-guest')).toHaveLength(0);

    // Once sent, both open again.
    api.writesOffline = false;
    await notice.getByRole('button', {name: 'Ver cambios pendientes'}).click();
    const send = page.locator('#lx-outbox-send');
    if (await send.isEnabled()) await send.click();
    await expect(page.locator('#lx-outbox-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#lx-users-view-as-guest')).toBeEnabled();
  });

  test('a developer account: fixed roles, and only development handles its password', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();

    // Elvis is an administrator, but Fabián is a developer account.
    const fabian = await openUser(page, 'Fabián');
    await expect(fabian.locator('.lx-users__rolegroup')).toContainText(
      'Cuenta de desarrollo: sus roles son fijos',
    );
    for (const box of await fabian
      .locator('.lx-users__rolegroup input[type="checkbox"]')
      .all()) {
      await expect(box).toBeDisabled();
    }
    await expect(page.locator('#lx-users-help-blocked-Fabián')).toContainText(
      'solo los gestiona desarrollo',
    );
    await expect(page.locator('#lx-users-pw-Fabián')).toHaveCount(0);
    await expect(page.locator('#lx-users-link-Fabián')).toHaveCount(0);
    await expect(fabian.getByText('Abrir sesión de soporte')).toHaveCount(0);

    // Development is never handed out from «Usuarios».
    const yeray = await openUser(page, 'Yeray');
    await expect(
      yeray.locator('input[type="checkbox"][id$="-developer"]'),
    ).toBeDisabled();
    await expect(yeray).toContainText('Lo asigna el equipo técnico');
    expect(api.calls('PUT', /\/admin\/users\/u-fabián\//)).toHaveLength(0);
    expect(api.calls('POST', /\/admin\/users\/u-fabián\//)).toHaveLength(0);
  });

  test('a developer helps every account in, administrators included', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Fabián');
    await page.locator('#lx-nav-usuarios').click();

    await openUser(page, 'Elvis');
    await expect(page.locator('#lx-users-help-blocked-Elvis')).toHaveCount(0);
    await page.locator('#lx-users-pw-Elvis').click();
    await page.locator('#lx-users-pw-confirm-yes').click();
    await expect(page.locator('#lx-users-secret-value')).toBeVisible();
    expect(
      api.calls('POST', '/admin/users/u-elvis/provisional-password'),
    ).toHaveLength(1);
  });
});

test.describe('Gestor logístico · E4 · sesión', () => {
  test('a reset link used while signed in ends this session too', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Yeray');
    // Pasted into the address bar of the open Gestor (a new page load).
    await page.goto(`${lxUrl('cuenta/restablecer')}#${RESET_TOKEN}`);
    // The token leaves the address bar at once.
    await expect(page).toHaveURL(lxUrlRe());
    expect(page.url()).not.toContain(RESET_TOKEN);
    await expect(page.locator('#lx-account-link-sheet')).toBeVisible();
    await page.locator('#lx-reset-password').fill('mi frase nueva y larga');
    await page.locator('#lx-reset-submit').click();

    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page.locator('#lx-session-notice')).toContainText(
      'Contraseña cambiada',
    );
    await expect(page.locator('#lx-session-notice')).toContainText(
      'también esta',
    );
    expect(api.calls('POST', '/auth/reset')).toHaveLength(1);
  });

  test('a 401 from a direct call signs out with the notice', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page, 'Dailos');
    api.sessionExpired = true;
    // «Tu espacio» loads its profile with a direct call, not the store.
    await page.locator('#lx-user-open').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page.locator('#lx-session-notice')).toContainText(
      'Tu sesión ha caducado',
    );
    await expect(page.locator('#lx-profile-sheet')).toHaveCount(0);
    await page.locator('#lx-login-username').fill('Dailos');
    await page.locator('#lx-login-password').fill(PASSWORD);
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Dailos');
  });
});

test.describe('Gestor logístico · E4 · móvil', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('«Catálogo» in the account sheet only with the directory', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page, 'Invitado');
    await page.locator('#lx-account-button').click();
    await expect(page.locator('#lx-account-sheet')).toBeVisible();
    await expect(page.locator('#lx-account-catalogo')).toHaveCount(0);
  });
});
