import {test, expect, type Page} from '@playwright/test';
import {
  dailos,
  elvis,
  makeAnswer,
  makeMedia,
  mockApi,
  signIn,
} from './mock-api';
import {lxUrl} from './address';
import {fixClock} from './plan-fixtures';
import {inventoryData} from './inventory-fixtures';

/**
 * Screenshots of the Revisión 1 · E3 screens (answers and material photos)
 * for the UI review; behaviour lives in answers.spec.ts and photos.spec.ts.
 * Output: test-results/visual/logistics-r1-e3-<screen>-<palette>.png
 */

const PALETTES = [
  'oxeye',
  'atlas',
  'noctis',
  'territorio',
  'vector',
  'bendy',
] as const;
const OUT = 'test-results/visual';
const DESKTOP = {width: 1440, height: 1000};
const PHONE = {width: 390, height: 844};

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.describe.configure({timeout: 120_000});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

async function capture(page: Page, screen: string) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(250);
    await page.screenshot({path: `${OUT}/logistics-r1-e3-${screen}-${id}.png`});
  }
}

/** A picture drawn in the page, as base64 (image content, not UI colour). */
async function picture(page: Page, w: number, h: number, hue: number) {
  return page.evaluate(
    ([w, h, base]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = `hsl(${base} 25% 86%)`;
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) {
        x.fillStyle = `hsl(${base + i * 4} 50% ${i % 2 ? 40 : 58}%)`;
        x.fillRect((i * w) / 12 + 6, h * 0.2, w / 18, h * 0.68);
      }
      x.fillStyle = 'hsl(220 25% 25%)';
      x.fillRect(0, h * 0.55, w, h * 0.05);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    },
    [w, h, hue] as const,
  );
}

async function photoData(page: Page) {
  await page.goto('about:blank');
  const data = inventoryData();
  const r1 = data.resources!.find(r => r.id === 'r1')!;
  const sizes = [
    [1600, 1067, 18],
    [1200, 1600, 140],
    [1600, 900, 210],
  ] as const;
  const media: Json[] = [];
  for (const [i, [w, h, hue]] of sizes.entries()) {
    media.push(
      makeMedia(`m${i + 1}`, 'r1', {
        main: i === 0,
        contentType: 'image/jpeg',
        width: w,
        height: h,
        createdBy: i === 1 ? dailos : elvis,
        createdAt: `2026-12-0${i + 1}T08:00:00.000Z`,
        data: await picture(page, Math.round(w / 4), Math.round(h / 4), hue),
      }),
    );
  }
  r1.media = media;
  const r2 = data.resources!.find(r => r.id === 'r2')!;
  r2.media = [
    makeMedia('m9', 'r2', {
      main: true,
      contentType: 'image/jpeg',
      data: await picture(page, 300, 200, 40),
    }),
  ];
  return data;
}

function answeredData() {
  const data = inventoryData();
  const n2 = data.notes!.find(n => n.id === 'n2')!;
  data.answers = [
    makeAnswer(
      '9b8c7d6e-5f4a-4b3c-9d2e-1f0a9b8c7d6e',
      'n2',
      'Creo que la tiene el conserje del Ayuntamiento.',
      {
        answeredBy: elvis,
        answeredAt: '2026-12-01T17:00:00.000Z',
      },
    ),
  ];
  n2.answer = makeAnswer(
    '0d3c7f5e-1a2b-4c3d-8e9f-a1b2c3d4e5f6',
    'n2',
    'La llave está en conserjería: se recoge a partir de las 7:30 con el DNI.',
    {
      answeredBy: dailos,
      answeredAt: '2026-12-02T09:45:00.000Z',
      replacesId: '9b8c7d6e-5f4a-4b3c-9d2e-1f0a9b8c7d6e',
    },
  );
  return data;
}

async function openQuestion(page: Page) {
  await page
    .locator('#lx-hoy-notes [data-note-id="n2"] .lx-noteitem__open')
    .click();
  await expect(page.locator('#lx-note-answer')).toBeVisible();
}

test.describe('E3 visual · respuestas', () => {
  test('asker view with history (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, answeredData());
    await signIn(page, 'Elvis');
    await capture(page, 'hoy-reminder');
    await openQuestion(page);
    await page.locator('#lx-note-answers-toggle').click();
    await expect(
      page.locator('#lx-note-answers-earlier [data-answer-id]'),
    ).toHaveCount(1);
    await capture(page, 'answer-asker');
  });

  test('replace confirmation (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, answeredData());
    await signIn(page, 'Yeray');
    await openQuestion(page);
    await page.locator('#lx-note-answer-again').click();
    await page
      .locator('#lx-note-answer-input')
      .fill('La tiene el vigilante de noche hasta las 8.');
    await page.locator('#lx-note-answer-send').click();
    await page.locator('#lx-note-answer-confirm').scrollIntoViewIfNeeded();
    await capture(page, 'answer-replace-phone');
  });

  test('no answer yet (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, inventoryData());
    await signIn(page, 'Dailos');
    await openQuestion(page);
    await capture(page, 'answer-empty');
  });

  test('guest (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, answeredData());
    await signIn(page, 'Invitado');
    await openQuestion(page);
    await page.locator('#lx-note-answer').scrollIntoViewIfNeeded();
    await capture(page, 'answer-guest-phone');
  });

  test('closed (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    const data = answeredData();
    Object.assign(
      data.notes!.find(n => n.id === 'n2')!,
      {
        resolved: true,
        resolvedBy: elvis,
        resolvedAt: '2026-12-02T10:10:00.000Z',
      },
    );
    await mockApi(page, data);
    await signIn(page, 'Dailos');
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('[data-warehouse-id="w1"] .lx-whgroup__open').click();
    await page
      .locator('#lx-warehouse-notelist [data-note-id="n2"] .lx-noteitem__open')
      .click();
    await expect(page.locator('#lx-note-answer-closed')).toBeVisible();
    await capture(page, 'answer-closed');
  });
});

test.describe('E3 visual · fotos', () => {
  test('inventory list and gallery (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, await photoData(page));
    await signIn(page);
    await page.locator('#lx-nav-inventarios').click();
    await expect(
      page.locator('[data-resource-id="r1"] .lx-thumb img'),
    ).toBeVisible();
    await capture(page, 'inventory-list');
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-photo-stage img')).toBeVisible();
    await capture(page, 'gallery');
    await page.locator('.lx-photos__pick').nth(1).click();
    await page.locator('#lx-resource-photo-remove').click();
    await capture(page, 'gallery-remove');
  });

  test('task resources picker with thumbnails (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, await photoData(page));
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-res-r1').check();
    await page.locator('#lx-task-resources').scrollIntoViewIfNeeded();
    await expect(
      page.locator('label[for="lx-task-res-r1"] .lx-thumb img'),
    ).toBeVisible();
    await capture(page, 'task-picker');
  });

  test('gallery, empty and waiting (phone)', async ({page, context}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, await photoData(page));
    await signIn(page);
    await page.locator('#lx-tab-inventarios').click();
    await expect(
      page.locator('[data-resource-id="r1"] .lx-thumb img'),
    ).toBeVisible();
    await capture(page, 'inventory-list-phone');
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-photo-stage img')).toBeVisible();
    await capture(page, 'gallery-phone');
    await page.keyboard.press('Escape');
    await page.locator('[data-resource-id="r3"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-photos-empty')).toBeVisible();
    await capture(page, 'gallery-empty-phone');

    await context.setOffline(true);
    await expect(page.locator('#lx-sync-chip')).toHaveAttribute(
      'data-state',
      'offline',
    );
    const data = await picture(page, 1200, 900, 300);
    await page.locator('#lx-resource-photo-file').setInputFiles({
      name: 'mesas.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(data, 'base64'),
    });
    await expect(page.locator('#lx-resource-photo-stage')).toContainText(
      'Pendiente de enviar',
    );
    await capture(page, 'gallery-waiting-phone');
  });
});

test.describe('Revisión 1 visual · siglas y horario del almacén', () => {
  function hoursData() {
    const data = inventoryData();
    Object.assign(data.warehouses![1], {
      acronym: 'A.S.',
      openingHours: {opensAt: '07:30', closesAt: '15:00'},
    });
    return data;
  }

  test('form with an hours problem (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, hoursData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await capture(page, 'warehouse-cards');
    await page.locator('#lx-inventory-add-warehouse').click();
    await page.locator('#lx-warehouse-name').fill('Almacén Municipal');
    await page.locator('#lx-warehouse-opensAt').fill('15:00');
    await page.locator('#lx-warehouse-closesAt').fill('08:00');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-error')).toBeVisible();
    await capture(page, 'warehouse-form');
  });

  test('sheet with hours (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, hoursData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page
      .locator('[data-warehouse-id] .lx-whgroup__open')
      .filter({hasText: 'Sur'})
      .click();
    await expect(page.locator('#lx-warehouse-hours-view')).toBeVisible();
    await capture(page, 'warehouse-sheet-phone');
  });
});
