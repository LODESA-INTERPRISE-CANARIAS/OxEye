import {expect, test, type Page} from '@playwright/test';
import {
  PASSWORD,
  PROVISIONAL_PASSWORD,
  RESET_TOKEN,
  SUPPORT_TOKEN,
  TOKEN,
  VERIFY_TOKEN,
  loginAs,
  makeCompany,
  makeContact,
  mockApi,
  signIn,
} from './mock-api';

/**
 * Revisión 1 · E4, roles and access: what the guest account no longer sees,
 * the provisional password, the first-login welcome, «Tu espacio en Ox
 * Eye», «Usuarios» (roles, provisional password, reset link, support
 * session, «Ver como Invitado») and the account links from an e-mail. The
 * API is the mock (mock-api.ts, E4 block).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const directory = () => ({
  companies: [makeCompany('c1', 'Carpas Teide Demo')],
  contacts: [makeContact('p1', 'Ana Pérez Demo', {companyId: 'c1'})],
});

const sheet = (page: Page, id: string) => page.locator(`#${id}`);

test.describe('Gestor logístico · E4 · Invitado', () => {
  test('Contactos and Catálogo say why they are locked; search has no people', async ({
    page,
  }) => {
    const api = await mockApi(page, directory());
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-user-role')).toHaveText(
      'Invitado · solo lectura',
    );
    // No account space nor «Usuarios» for the shared guest account.
    await expect(page.locator('#lx-user-open')).toHaveCount(0);
    await expect(page.locator('#lx-nav-usuarios')).toHaveCount(0);

    await page.locator('#lx-nav-contactos').click();
    const locked = page.locator('#lx-contactos-noaccess');
    await expect(locked).toContainText('Contactos: sin acceso');
    await expect(locked).toContainText('contienen datos de personas y precios');
    await expect(page.locator('#lx-space-contactos')).toHaveCount(0);
    await page.locator('#lx-nav-catalogo').click();
    await expect(page.locator('#lx-catalogo-noaccess')).toContainText(
      'Catálogo: sin acceso',
    );

    // The lists were never asked for.
    expect(
      api.requests.filter(r => /\/(contacts|companies|offers)$/.test(r.path)),
    ).toHaveLength(0);

    await page.locator('#lx-search').click();
    await expect(page.locator('#lx-search-type-contact')).toHaveCount(0);
    await expect(page.locator('#lx-search-type-company')).toHaveCount(0);
    await expect(page.locator('#lx-search-type-offer')).toHaveCount(0);
    await expect(page.locator('#lx-search-type-event')).toBeVisible();
    await page.locator('#lx-search-input').fill('Ana');
    await expect(page.locator('#lx-search-sheet')).not.toContainText(
      'Ana Pérez Demo',
    );
  });

  test('a member still sees the directory', async ({page}) => {
    await mockApi(page, directory());
    await signIn(page, 'Equipo', '#logistica/contactos');
    await expect(page.locator('#lx-space-contactos')).toContainText(
      'Ana Pérez Demo',
    );
    await expect(page.locator('#lx-user-role')).toHaveText('Equipo');
  });
});

test.describe('Gestor logístico · E4 · contraseña provisional', () => {
  test('the banner asks for a new password; after it the sensitive parts open', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      accounts: {Dailos: {passwordProvisional: true}},
    });
    await signIn(page, 'Dailos');
    const banner = page.locator('#lx-provisional-banner');
    await expect(banner).toContainText('Tu contraseña es provisional');

    // «Usuarios» is there but held back by the provisional password.
    await page.locator('#lx-nav-usuarios').click();
    await expect(page.locator('#lx-users-noaccess')).toContainText(
      'Cambia tu contraseña provisional',
    );
    await page.locator('#lx-users-noaccess-password').click();

    // The profile opens on «Seguridad» with the password form.
    await expect(sheet(page, 'lx-profile-sheet')).toBeVisible();
    await expect(page.locator('#lx-profile-tab-seguridad')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#lx-profile-password-current')).toBeFocused();

    // Wrong current password: said on that field.
    await page.locator('#lx-profile-password-current').fill('otra-cosa');
    await page.locator('#lx-profile-password-new').fill('una frase muy larga');
    await page.locator('#lx-profile-password-submit').click();
    await expect(
      page.locator('#lx-profile-password-current-error'),
    ).toContainText('no es correcta');

    // A short new password never leaves the browser.
    await page.locator('#lx-profile-password-current').fill(PASSWORD);
    await page.locator('#lx-profile-password-new').fill('corta');
    await page.locator('#lx-profile-password-submit').click();
    await expect(page.locator('#lx-profile-password-new-error')).toContainText(
      'al menos 10 caracteres',
    );
    expect(api.calls('POST', '/me/password')).toHaveLength(1);

    await page.locator('#lx-profile-password-new').fill('una frase muy larga');
    await expect(
      page.locator('#lx-profile-password-new-strength'),
    ).toContainText('Seguridad orientativa');
    await page.locator('#lx-profile-password-submit').click();
    await expect(page.locator('.lx-toast')).toContainText(
      'Contraseña cambiada',
    );
    await expect(banner).toHaveCount(0);
    expect(api.e4.accounts.Dailos!.provisional).toBe(false);

    await page.keyboard.press('Escape');
    await page.locator('#lx-nav-usuarios').click();
    await expect(page.locator('#lx-users-list')).toBeVisible();
    await expect(page.locator('#lx-users-noaccess')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · E4 · bienvenida', () => {
  test('first sign-in: keep the provisional password, set a name, start', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      accounts: {Yeray: {welcomed: false, passwordProvisional: true}},
    });
    await signIn(page, 'Yeray');
    const welcome = sheet(page, 'lx-welcome-sheet');
    await expect(welcome).toContainText('Te damos la bienvenida, Yeray');
    await expect(welcome).toContainText('Primer acceso · paso 1 de 2');
    await expect(welcome).toContainText('queda bloqueado hasta que elijas');
    await page.locator('#lx-welcome-keep').click();

    await expect(page.locator('#lx-welcome-profile-step')).toBeVisible();
    await page.locator('#lx-welcome-edit-name').fill('Yeray R.');
    await page.locator('#lx-welcome-edit-bio').fill('Coordinación de montaje');
    await page.locator('#lx-welcome-start').click();
    await expect(welcome).toHaveCount(0);

    expect(api.calls('PATCH', '/me/profile')[0]?.body).toMatchObject({
      displayName: 'Yeray R.',
      bio: 'Coordinación de montaje',
    });
    expect(api.calls('POST', '/me/welcome')).toHaveLength(1);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Yeray R.');
    // Still provisional: the banner stays.
    await expect(page.locator('#lx-provisional-banner')).toBeVisible();
  });
});

test.describe('Gestor logístico · E4 · Tu espacio en Ox Eye', () => {
  test('profile, recovery e-mail, sessions and own history', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page, 'Dailos');
    await page.locator('#lx-user-open').click();
    const profile = sheet(page, 'lx-profile-sheet');
    await expect(profile).toContainText('Tu espacio en Ox Eye');
    await expect(profile).toContainText('Usuario para entrar: Dailos');

    // A name already taken is said on the field.
    await page.locator('#lx-profile-edit-name').fill('elvis');
    await page.locator('#lx-profile-edit-save').click();
    await expect(page.locator('#lx-profile-edit-name-error')).toContainText(
      'Ya hay otra persona con ese nombre',
    );
    await page.locator('#lx-profile-edit-name').fill('Dailos M.');
    await page.locator('#lx-profile-edit-accent-oro').check({force: true});
    await page.locator('#lx-profile-edit-save').click();
    await expect(page.locator('.lx-toast')).toContainText('Perfil guardado');
    await expect(page.locator('#lx-user')).toContainText('Dailos M.');

    // Security: recovery e-mail and sessions.
    await page.locator('#lx-profile-tab-seguridad').click();
    await expect(page.locator('#lx-profile-email-current')).toHaveText(
      'd•••@example.com',
    );
    await page.locator('#lx-profile-email-change').click();
    await page.locator('#lx-profile-email-input').fill('no-es-correo');
    await page.locator('#lx-profile-email-send').click();
    await expect(page.locator('#lx-profile-email-input-error')).toBeVisible();
    await page.locator('#lx-profile-email-input').fill('dailos@example.org');
    await page.locator('#lx-profile-email-send').click();
    await expect(page.locator('#lx-profile-email-pending')).toContainText(
      'd•••@example.org',
    );

    const sessions = page.locator('#lx-profile-sessions');
    await expect(sessions.locator('[data-current]')).toContainText(
      'Esta sesión',
    );
    await expect(sessions).toContainText('Safari · iPhone');
    await page.locator('#lx-profile-sessions-others').click();
    await expect(sessions).not.toContainText('Safari · iPhone');
    expect(api.calls('DELETE', '/me/sessions')).toHaveLength(1);

    // Activity: the own security history.
    await page.locator('#lx-profile-tab-actividad').click();
    await expect(page.locator('#lx-profile-security')).toContainText(
      'Sesiones cerradas',
    );
    await expect(page.locator('#lx-profile-security')).toContainText(
      'Perfil cambiado',
    );
  });
});

test.describe('Gestor logístico · E4 · Usuarios', () => {
  test('roles, provisional password, reset link and the security log', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const list = page.locator('#lx-users-list');
    await expect(list.locator('[data-user]')).toHaveCount(6);

    // Own administrator role cannot be removed.
    await list.locator('[data-user="Elvis"] .lx-users__head').click();
    await expect(
      page.locator(
        '#lx-users-role-u-elvis-00000000-0000-4000-8000-000000000001-admin',
      ),
    ).toBeDisabled();
    await list.locator('[data-user="Elvis"] .lx-users__head').click();

    // Dailos gets the developer role too.
    const dailos = list.locator('[data-user="Dailos"]');
    await dailos.locator('.lx-users__head').click();
    await dailos.getByLabel(/Desarrollo/).check();
    await expect(page.locator('.lx-toast')).toContainText(
      'Roles de Dailos guardados',
    );
    expect(api.calls('PUT', '/admin/users/u-dailos/roles')[0]?.body).toEqual({
      organizationId: '00000000-0000-4000-8000-000000000001',
      roles: ['admin', 'developer'],
    });
    await expect(dailos).toContainText('Administración · Desarrollo');

    // Provisional password: asks first, shown once.
    await page.locator('#lx-users-pw-Dailos').click();
    await expect(page.locator('#lx-users-pw-confirm')).toContainText(
      'Se cerrarán todas sus sesiones',
    );
    await page.locator('#lx-users-pw-confirm-yes').click();
    await expect(page.locator('#lx-users-secret-value')).toHaveText(
      PROVISIONAL_PASSWORD,
    );
    await expect(page.locator('#lx-users-secret')).toContainText(
      'solo se muestra ahora',
    );

    // Reset link: shown because the server has no mail transport.
    await page.locator('#lx-users-link-Dailos').click();
    await expect(page.locator('#lx-users-secret-value')).toContainText(
      `#logistica/cuenta/restablecer/${RESET_TOKEN}`,
    );

    await page.locator('#lx-users-tab-registro').click();
    const log = page.locator('#lx-users-log');
    await expect(log).toContainText('Contraseña provisional puesta');
    await expect(log).toContainText('Roles cambiados');
    await expect(log).toContainText('por Elvis');
  });

  test('the team role has no «Usuarios»', async ({page}) => {
    await mockApi(page);
    await signIn(page, 'Equipo');
    await expect(page.locator('#lx-nav-usuarios')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · E4 · soporte y ver como Invitado', () => {
  test('a support session shows the banner and «Terminar» comes back', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const dailos = page.locator('#lx-users-list [data-user="Dailos"]');
    await dailos.locator('.lx-users__head').click();
    await dailos.getByRole('button', {name: 'Abrir sesión de soporte'}).click();

    const form = sheet(page, 'lx-support-sheet');
    await expect(form).toContainText('Sesión de soporte · Dailos');
    await page.locator('#lx-support-reason').fill('corto');
    await page.locator('#lx-support-start').click();
    await expect(page.locator('#lx-support-reason-error')).toContainText(
      'al menos 10',
    );
    await page
      .locator('#lx-support-reason')
      .fill('No ve las tareas de mañana en el calendario');
    await page.locator('#lx-support-password').fill('equivocada');
    await page.locator('#lx-support-start').click();
    await expect(page.locator('#lx-support-password-error')).toContainText(
      'no es correcta',
    );
    await page.locator('#lx-support-password').fill(PASSWORD);
    await page.locator('#lx-support-start').click();

    const banner = page.locator('#lx-support-banner');
    await expect(banner).toContainText(
      'Sesión de soporte en la cuenta de Dailos',
    );
    await expect(banner).toContainText('No ve las tareas de mañana');
    await expect(page.locator('#lx-support-left')).toContainText(/1[45]:\d\d/);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Dailos');
    // No account administration inside a support session.
    await expect(page.locator('#lx-nav-usuarios')).toHaveCount(0);
    await expect(page.locator('#lx-user-open')).toHaveCount(0);
    // The administrator's own token is kept aside, never in the device copy.
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('oxeye.logistics.support-return.v1'),
    );
    expect(stored).toContain(TOKEN);
    // localStorage holds only the support session (needed to reopen
    // without coverage), never the administrator's own token.
    const local = await page.evaluate(() => JSON.stringify({...localStorage}));
    expect(local).not.toContain(TOKEN);
    expect(local).toContain(SUPPORT_TOKEN);

    await page.locator('#lx-support-end').click();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(banner).toHaveCount(0);
    // «Terminar» signs out of the support token, which ends it (logged).
    expect(api.calls('POST', '/auth/logout').map(c => c.authorization)).toEqual(
      [`Bearer ${SUPPORT_TOKEN}`],
    );
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('oxeye.logistics.support-return.v1'),
      ),
    ).toBeNull();
    expect(api.e4.accounts.Dailos!.log.map(e => e.kind)).toEqual(
      expect.arrayContaining(['support_started', 'support_ended']),
    );
  });

  test('«Ver como Invitado» locks the directory and comes back', async ({
    page,
  }) => {
    await mockApi(page, directory());
    await signIn(page, 'Elvis', '#logistica/contactos');
    await expect(page.locator('#lx-space-contactos')).toContainText(
      'Ana Pérez Demo',
    );
    await page.locator('#lx-nav-usuarios').click();
    await page.locator('#lx-users-view-as-guest').click();
    const banner = page.locator('#lx-support-banner');
    await expect(banner).toContainText('Estás viendo el Gestor como Invitado');
    await expect(page.locator('#lx-contactos-noaccess')).toBeVisible();
    await expect(page.locator('#lx-readonly')).toBeVisible();

    await page.locator('#lx-support-end').click();
    await expect(banner).toHaveCount(0);
    await expect(page.locator('#lx-space-contactos')).toContainText(
      'Ana Pérez Demo',
    );
  });
});

test.describe('Gestor logístico · E4 · enlaces de cuenta', () => {
  test('a reset link works signed out and leaves the address clean', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.goto(`/#logistica/cuenta/restablecer/${RESET_TOKEN}`);
    await expect(page.locator('#lx-reset-form')).toContainText(
      'Elige una contraseña nueva',
    );
    // The token left the address bar.
    await expect(page).toHaveURL(/#logistica$/);
    await page.locator('#lx-reset-password').fill('corta');
    await page.locator('#lx-reset-submit').click();
    await expect(page.locator('#lx-reset-password-error')).toContainText(
      'al menos 10 caracteres',
    );
    await page.locator('#lx-reset-password').fill('mi frase nueva y larga');
    await page.locator('#lx-reset-submit').click();
    await expect(page.locator('#lx-reset-done')).toContainText(
      'Contraseña cambiada',
    );
    expect(api.calls('POST', '/auth/reset')[0]?.body).toEqual({
      token: RESET_TOKEN,
      newPassword: 'mi frase nueva y larga',
    });
    await page.locator('#lx-reset-continue').click();
    await page.locator('#lx-login-username').fill('Yeray');
    await page.locator('#lx-login-password').fill('mi frase nueva y larga');
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Yeray');
  });

  test('a used or expired link says so and offers a new one', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(`/#logistica/cuenta/restablecer/${'x'.repeat(43)}`);
    await page.locator('#lx-reset-password').fill('mi frase nueva y larga');
    await page.locator('#lx-reset-submit').click();
    await expect(page.locator('#lx-link-invalid')).toContainText(
      'Este enlace ya no sirve',
    );
    await page.locator('#lx-link-new').click();
    await expect(page.locator('#lx-recovery-form')).toBeVisible();
  });

  test('a verification link confirms the recovery e-mail', async ({page}) => {
    await mockApi(page);
    await page.goto(`/#logistica/cuenta/verificar/${VERIFY_TOKEN}`);
    await expect(page.locator('#lx-verify-done')).toContainText(
      'Correo verificado',
    );
    await page.locator('#lx-verify-continue').click();
    await loginAs(page, 'Elvis');
  });
});
