import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {makeMedia, mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {inventoryData} from './inventory-fixtures';

/**
 * Revisión 1 · E3: material photos. A member adds one from the camera or a
 * file; it is prepared on the device (upright, ≤ 1600 px, JPEG under
 * 400 KB) and the first one becomes main. The sheet shows the photo being
 * looked at with who took it, a strip with the others, «Hacer principal»
 * and «Quitar» (asks first); lists show the main photo or the category
 * icon. Without coverage a photo waits on the device and goes out by itself.
 * Guests see the photos and none of the actions.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const photos = (page: Page) => page.locator('#lx-resource-photos');
const count = (page: Page) => page.locator('#lx-resource-photos-count');
const uploads = (api: MockApi) =>
  api.calls('POST', '/media').map(c => c.body as Json);

/**
 * A picture drawn in the page (stripes and a band, like a stack of fences),
 * as base64. Image content, not interface colours.
 */
async function drawPicture(
  page: Page,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg',
  hue = 18,
): Promise<string> {
  return page.evaluate(
    ([w, h, t, base]) => {
      const c = document.createElement('canvas');
      c.width = w as number;
      c.height = h as number;
      const x = c.getContext('2d')!;
      x.fillStyle = `hsl(${base} 30% 88%)`;
      x.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 14; i++) {
        x.fillStyle = `hsl(${(base as number) + i * 3} 55% ${i % 2 ? 42 : 60}%)`;
        x.fillRect(
          (i * c.width) / 14,
          c.height * 0.18,
          c.width / 22,
          c.height * 0.7,
        );
      }
      x.fillStyle = 'hsl(220 25% 25%)';
      x.fillRect(0, c.height * 0.55, c.width, c.height * 0.06);
      return c.toDataURL(t as string, 0.85).split(',')[1];
    },
    [width, height, type, hue] as const,
  );
}

async function pictureFile(page: Page, width = 3000, height = 2000) {
  const data = await drawPicture(page, width, height, 'image/png');
  return {
    name: 'vallas.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  };
}

async function openResource(page: Page, id: string) {
  await page.locator('#lx-nav-inventarios').click();
  await page.locator(`[data-resource-id="${id}"] .lx-resrow__main`).click();
  await expect(photos(page)).toBeVisible();
}

/** Inventory data with r1 holding `n` stored photos (the first one main). */
async function withPhotos(page: Page, n: number) {
  await page.goto('about:blank');
  const data = inventoryData();
  const r1 = data.resources!.find(r => r.id === 'r1')!;
  const media: Json[] = [];
  for (let i = 0; i < n; i++) {
    media.push(
      makeMedia(`m${i + 1}`, 'r1', {
        main: i === 0,
        contentType: 'image/jpeg',
        width: 480,
        height: 320,
        createdAt: `2026-12-01T0${i + 1}:00:00.000Z`,
        data: await drawPicture(page, 480, 320, 'image/jpeg', 18 + i * 40),
      }),
    );
  }
  r1.media = media;
  return data;
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect(page.locator('#lx-sync-chip')).toHaveAttribute(
    'data-state',
    'offline',
  );
}

test.describe('Gestor logístico · fotos del material', () => {
  test('a member adds a photo: prepared on the device, first one is main', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await openResource(page, 'r2');
    await expect(page.locator('#lx-resource-photos-empty')).toContainText(
      'Sin fotos todavía',
    );
    await expect(count(page)).toHaveText('0/5');

    await page
      .locator('#lx-resource-photo-file')
      .setInputFiles(await pictureFile(page));
    await expect(
      page.locator('.lx-toast').filter({hasText: 'Foto añadida'}),
    ).toContainText('Foto añadida a «Vallas Prueba».');

    const [body] = uploads(api);
    expect(body).toMatchObject({
      ownerType: 'resource',
      ownerId: 'r2',
      contentType: 'image/jpeg',
      width: 1600,
      height: 1067,
    });
    expect(String(body.id)).toMatch(UUID_RE);
    const bytes = Buffer.from(String(body.data), 'base64');
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeLessThanOrEqual(400 * 1024);

    const stage = page.locator('#lx-resource-photo-stage img');
    await expect(stage).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#lx-resource-photo-main')).toHaveText(
      'Principal',
    );
    await expect(page.locator('#lx-resource-photo-stage')).toContainText(
      'Foto de Elvis',
    );
    await expect(count(page)).toHaveText('1/5');
    // The bytes are fetched with the session, never as a bare URL.
    const gets = api.calls('GET', /^\/media\//);
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.every(g => g.authorization === 'Bearer test-token')).toBe(true);

    // Lists show the main photo; others keep their category icon.
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[data-resource-id="r2"] .lx-thumb'),
    ).toHaveAttribute('data-photo', 'stored');
    await expect(
      page.locator('[data-resource-id="r3"] .lx-thumb'),
    ).toHaveAttribute('data-photo', 'none');
  });

  test('choose a photo, make it main, remove one (asks first)', async ({
    page,
  }) => {
    const data = await withPhotos(page, 2);
    const api = await mockApi(page, data);
    await signIn(page);
    await openResource(page, 'r1');
    const picks = page.locator('.lx-photos__pick');
    await expect(picks).toHaveCount(2);
    await expect(picks.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(picks.nth(0)).toHaveAttribute(
      'aria-label',
      'Foto 1 de 2, principal',
    );
    await expect(page.locator('#lx-resource-photo-make-main')).toHaveCount(0);

    await picks.nth(1).click();
    await page.locator('#lx-resource-photo-make-main').click();
    await expect(page.locator('#lx-resource-photo-main')).toBeVisible();
    expect(api.calls('PATCH', '/media/m2').map(c => c.body)).toEqual([
      {main: true},
    ]);
    // Main first: m2 now leads the strip.
    await expect(picks.nth(0)).toHaveAttribute('data-photo-id', 'm2');

    await page.locator('#lx-resource-photo-remove').click();
    const confirm = page.locator('#lx-resource-photo-confirm');
    await expect(confirm).toContainText('¿Quitar esta foto?');
    await expect(confirm).toContainText('para todo el equipo');
    await page.locator('#lx-resource-photo-keep').click();
    await expect(confirm).toHaveCount(0);
    expect(api.calls('DELETE', /^\/media\//)).toEqual([]);

    await page.locator('#lx-resource-photo-remove').click();
    await page.locator('#lx-resource-photo-remove-yes').click();
    await expect(count(page)).toHaveText('1/5');
    expect(api.calls('DELETE', /^\/media\//).map(c => c.path)).toEqual([
      '/media/m2',
    ]);
    // The one left is main again.
    await expect(page.locator('#lx-resource-photo-main')).toBeVisible();
    await expect(page.locator('.lx-photos__pick')).toHaveCount(0);
  });

  test('five photos fill the material; a refusal reads in plain words', async ({
    page,
  }) => {
    const data = await withPhotos(page, 4);
    const api = await mockApi(page, data);
    await signIn(page);
    await openResource(page, 'r1');
    await expect(count(page)).toHaveText('4/5');
    api.rejectWrite('POST', '/media', {
      data: 'No hemos podido leer esta foto: usa una imagen JPEG, PNG o WebP.',
    });
    await page
      .locator('#lx-resource-photo-file')
      .setInputFiles(await pictureFile(page, 800, 600));
    await expect(page.locator('#lx-resource-photos-problem')).toHaveText(
      'No hemos podido leer esta foto: usa una imagen JPEG, PNG o WebP.',
    );
    await page
      .locator('#lx-resource-photo-file')
      .setInputFiles(await pictureFile(page, 800, 600));
    await expect(count(page)).toHaveText('5/5');
    await expect(page.locator('#lx-resource-photo-add')).toHaveCount(0);
  });

  test('without coverage a photo waits on the device and goes out by itself', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await openResource(page, 'r2');
    await goOffline(context, page);
    await page
      .locator('#lx-resource-photo-file')
      .setInputFiles(await pictureFile(page));
    await expect(
      page.locator('.lx-toast').filter({hasText: 'este dispositivo'}),
    ).toContainText('Foto guardada en este dispositivo');
    await expect(page.locator('#lx-resource-photo-stage img')).toHaveAttribute(
      'src',
      /^data:image\/jpeg;base64,/,
    );
    await expect(page.locator('#lx-resource-photo-stage')).toContainText(
      'Pendiente de enviar',
    );
    await expect(count(page)).toHaveText('1/5');
    expect(uploads(api)).toEqual([]);

    await context.setOffline(false);
    await expect(page.locator('#lx-resource-photo-main')).toBeVisible({
      timeout: 15_000,
    });
    const [sent] = uploads(api);
    expect(sent).toMatchObject({ownerId: 'r2', contentType: 'image/jpeg'});
    const stored = api.resources.find(r => r.id === 'r2')!.media as Json[];
    expect(stored.map(m => m.id)).toEqual([String(sent.id).toLowerCase()]);
    await expect(page.locator('#lx-resource-photo-stage')).not.toContainText(
      'Pendiente de enviar',
    );
  });

  test('guests see the photos and none of the actions', async ({page}) => {
    const data = await withPhotos(page, 2);
    await mockApi(page, data);
    await signIn(page, 'Invitado');
    await openResource(page, 'r1');
    await expect(page.locator('#lx-resource-photo-stage img')).toHaveAttribute(
      'src',
      /^blob:/,
    );
    await expect(page.locator('.lx-photos__pick')).toHaveCount(2);
    await expect(page.locator('#lx-resource-photo-add')).toHaveCount(0);
    await expect(page.locator('#lx-resource-photo-make-main')).toHaveCount(0);
    await expect(page.locator('#lx-resource-photo-remove')).toHaveCount(0);
  });
});
