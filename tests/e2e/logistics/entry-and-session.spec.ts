import {expect, test} from '@playwright/test';
import {openWorkspaceWithDefaultProject} from '../helpers';
import {
  PASSWORD,
  SESSION_KEY,
  TOKEN,
  loginAs,
  mockApi,
  signIn,
  storedSession,
} from './mock-api';

/**
 * Gestor logístico, milestone 1: entering from the OxEye hub, server gates,
 * login, session persistence, logout and session expiry. The API is mocked
 * (see mock-api.ts); no server or database is needed.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

test.describe('Gestor logístico · entrada desde el hub', () => {
  test('opens from «Gestor logístico», makes the hub inert and returns', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/');
    const menu = page.locator('#game-menu');
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveAttribute('inert');

    await page.locator('#game-logistics').click();
    const app = page.locator('#logistics-app');
    await expect(app).toBeVisible();
    await expect(page).toHaveURL(/#logistica$/);
    await expect(menu).toHaveAttribute('inert', '');
    await expect(page.locator('#lx-login-form')).toBeVisible();

    // The gate's «Volver a OxEye» closes the module and gives focus back.
    await page.locator('#lx-gate-exit').click();
    await expect(app).toHaveCount(0);
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveAttribute('inert');
    await expect(page.locator('#game-logistics')).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('«Volver a OxEye» from the workspace keeps the session for the next visit', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#game-logistics').click();
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');

    await page.locator('#lx-back-to-oxeye').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect(page.locator('#game-menu')).not.toHaveAttribute('inert');

    await page.locator('#game-logistics').click();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
  });

  test('#logistica deep link opens the module directly over an inert hub', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/#logistica');
    await expect(page.locator('#logistics-app')).toBeVisible();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page.locator('#game-menu')).toHaveAttribute('inert', '');
  });

  test('#logistica/<space> deep link lands on that space after login', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page, 'Elvis', '#logistica/contactos');
    await expect(page.locator('#lx-space-contactos')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Contactos');
    await expect(page.locator('#lx-nav-contactos')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('Gestor logístico · historial y hash', () => {
  const historyLength = (page: import('@playwright/test').Page) =>
    page.evaluate(() => history.length);

  test('closing after opening from the hub leaves no duplicate entry', async ({
    page,
  }) => {
    await mockApi(page);
    // Two real entries before the hub, so Back has somewhere to go.
    await page.goto('/?entrada=1');
    await page.goto('/');
    await expect(page.locator('#game-menu')).toBeVisible();
    const before = await historyLength(page);

    await page.locator('#game-logistics').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page).toHaveURL(/\/#logistica$/);
    expect(await historyLength(page)).toBe(before + 1);

    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    // Closing popped the entry it pushed instead of adding another one.
    expect(await historyLength(page)).toBe(before + 1);
    await expect(page.locator('#game-logistics')).toBeFocused();

    // Back leaves the hub for the previous page; it does not reopen the
    // module or stay on an identical hub entry.
    await page.goBack();
    await expect(page).toHaveURL(/\/\?entrada=1$/);
    await expect(page.locator('#game-menu')).toBeVisible();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
  });

  test('Forward after closing reopens the module (Back/Forward support)', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#game-logistics').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');

    await page.goForward();
    await expect(page).toHaveURL(/#logistica$/);
    await expect(page.locator('#lx-login-form')).toBeVisible();
    // And Back closes it again.
    await page.goBack();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect(page.locator('#game-menu')).not.toHaveAttribute('inert');
  });

  test('closing after a #logistica deep link does not add an entry', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/#logistica');
    await expect(page.locator('#lx-login-form')).toBeVisible();
    const before = await historyLength(page);
    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(await historyLength(page)).toBe(before);
  });

  test('#logistica never opens on top of a simulation in use', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(page.locator('#game-menu')).toBeHidden();

    await page.evaluate(() => {
      window.location.hash = '#logistica';
    });
    await expect(page).toHaveURL(/#logistica$/);
    // Negative check: give the lazy chunk time it would need to appear.
    await page.waitForTimeout(800);
    await expect(page.locator('#logistics-loading')).toHaveCount(0);
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect(page.locator('#drawing')).toBeVisible();
    expect(api.requests).toHaveLength(0);
  });

  test('with the module open, a hash change switches the space', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await page.evaluate(() => {
      window.location.hash = '#logistica/calendario';
    });
    await expect(page.locator('#lx-space-calendario')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Calendario');
    await expect(page.locator('#lx-nav-calendario')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.evaluate(() => {
      window.location.hash = '#logistica';
    });
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(page.locator('#logistics-app')).toBeVisible();
  });
});

test.describe('Gestor logístico · servidor no disponible', () => {
  test('health down shows the gate and «Reintentar» recovers', async ({
    page,
  }) => {
    const api = await mockApi(page, {health: 'down'});
    await page.goto('/#logistica');
    const gate = page.locator('#lx-gate-unreachable');
    await expect(gate).toBeVisible();
    await expect(page.locator('#lx-gate-title')).toHaveText(
      'Servidor no disponible',
    );
    await expect(page.locator('#lx-local-help')).toBeVisible();

    api.health = 'ok';
    await page.locator('#lx-retry').click();
    await expect(gate).toHaveCount(0);
    await expect(page.locator('#lx-login-form')).toBeVisible();
  });

  test('database down says so instead of a generic error', async ({page}) => {
    const api = await mockApi(page, {health: 'database'});
    await page.goto('/#logistica');
    await expect(page.locator('#lx-gate-title')).toHaveText(
      'La base de datos no responde',
    );
    api.health = 'ok';
    await page.locator('#lx-retry').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
  });
});

test.describe('Gestor logístico · acceso', () => {
  test('asks for username and password, with a neutral error, and signs in', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.goto('/#logistica');

    // E4: no list of people anywhere.
    await expect(page.locator('.lx-person')).toHaveCount(0);
    expect(api.requests.some(r => r.path === '/auth/users')).toBe(false);
    const username = page.locator('#lx-login-username');
    const password = page.locator('#lx-login-password');
    await expect(username).toBeFocused();
    await expect(username).toHaveAttribute('autocomplete', 'username');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');

    // Nothing typed: inline errors, no request.
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-login-username-error')).toHaveText(
      'Escribe tu nombre de usuario.',
    );
    await username.fill('elvis');
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-login-password-error')).toHaveText(
      'Escribe tu contraseña.',
    );
    expect(api.calls('POST', '/auth/login')).toHaveLength(0);

    // Wrong password: the same message as an unknown user.
    await password.fill('incorrecta');
    await page.locator('#lx-login-submit').click();
    const neutral = 'El usuario o la contraseña no son correctos';
    await expect(page.locator('#lx-login-error')).toContainText(neutral);
    await expect(password).toHaveValue('');
    await expect(password).toBeFocused();
    await expect(username).toHaveValue('elvis');
    await username.fill('nadie');
    await password.fill(PASSWORD);
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-login-error')).toContainText(neutral);

    // Typing clears the error; the username is any letter case.
    await username.fill('elvis');
    await expect(page.locator('#lx-login-error')).toHaveCount(0);
    await password.fill(PASSWORD);
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');

    const logins = api.calls('POST', '/auth/login');
    expect(logins).toHaveLength(3);
    expect(logins[2].body).toMatchObject({
      username: 'elvis',
      password: PASSWORD,
    });
    // Data calls carry the bearer token.
    await expect
      .poll(() => api.calls('GET', /\/events$/).length)
      .toBeGreaterThan(0);
    expect(api.calls('GET', /\/events$/)[0].authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  test('«¿Has olvidado tu contraseña?» always answers the same', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.goto('/#logistica');
    await page.locator('#lx-login-username').fill('Yeray');
    await page.locator('#lx-login-forgot').click();
    // The username typed so far comes along.
    await expect(page.locator('#lx-recovery-username')).toHaveValue('Yeray');
    await page.locator('#lx-recovery-submit').click();
    await expect(page.locator('#lx-recovery-sent')).toContainText(
      'Revisa tu correo',
    );
    expect(api.calls('POST', '/auth/recovery')[0]?.body).toEqual({
      username: 'Yeray',
    });
    await page.locator('#lx-recovery-done').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
  });

  test('the session survives a reload and logout returns to the login', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    const stored = JSON.parse((await storedSession(page)) ?? 'null');
    expect(stored?.token).toBe(TOKEN);
    expect(stored?.user?.displayName).toBe('Elvis');

    await page.reload();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    expect(api.calls('POST', '/auth/login')).toHaveLength(1);
    expect(api.calls('GET', '/me').at(-1)?.authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    await page.locator('#lx-logout').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(await storedSession(page)).toBeNull();
    await expect.poll(() => api.calls('POST', '/auth/logout').length).toBe(1);
    expect(api.calls('POST', '/auth/logout')[0].authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    // A reload after logout does not bring the session back.
    await page.reload();
    await expect(page.locator('#lx-login-form')).toBeVisible();
  });
});

test.describe('Gestor logístico · sesión caducada', () => {
  test('a 401 on a data refresh returns to login with a clear message', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await expect(page.locator('[data-event-id="e1"]')).toBeVisible();

    api.sessionExpired = true;
    // Coming back online triggers a background refresh (LogisticsApp.tsx).
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator('#lx-session-notice')).toHaveText(
      'Tu sesión ha caducado. Vuelve a entrar para seguir.',
    );
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(await storedSession(page)).toBeNull();

    // Signing in again clears the notice and shows the data.
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(page.locator('#lx-session-notice')).toHaveCount(0);
    await expect(page.locator('[data-event-id="e1"]')).toBeVisible();
  });

  test('a stored session rejected on reload returns to login with the message', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    api.sessionExpired = true;
    await page.reload();
    await expect(page.locator('#lx-session-notice')).toContainText(
      'Tu sesión ha caducado',
    );
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(await storedSession(page)).toBeNull();
  });

  test('a stored session past its expiry is dropped without calling /me', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.addInitScript(key => {
      localStorage.setItem(
        key,
        JSON.stringify({
          token: 'old-token',
          expiresAt: '2000-01-01T00:00:00.000Z',
          user: {id: 'u-elvis', displayName: 'Elvis', role: 'member'},
        }),
      );
    }, SESSION_KEY);
    await page.goto('/#logistica');
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(api.calls('GET', '/me')).toHaveLength(0);
  });
});
