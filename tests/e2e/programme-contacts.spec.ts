import {expect, test} from '@playwright/test';

test.describe('Programme custom activities, inline contact linking & Contacts custom kinds', () => {
  test('adds custom contact kind, creates custom activity, links inline contact without losing unsaved edits, plans, exports CSV, and persists on reload', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto('/');
    await page.click('#game-continue');

    // 1. Contacts: add a custom kind via "Otra..." and verify it becomes an option
    await page.click('#contacts');
    await expect(page.locator('#contacts-dialog')).toBeVisible();
    await page.selectOption('#contact-kind', '__other__');
    await page.fill('#contact-kind-other', 'Sonido profesional');
    await page.click('#contact-kind-other-add');
    await expect(page.locator('#contact-kind')).toHaveValue('Sonido profesional');
    await page.click('#contacts-dialog button[type="submit"]:has-text("Cerrar")');

    // 2. Programme: create custom activity and verify it appears first with "Propia" badge
    await page.click('#programme');
    await expect(page.locator('#programme-dialog')).toBeVisible();
    await page.click('#programme-create-activity');
    await page.fill('#custom-act-name', 'Taller de cerámica local');
    await page.fill('#custom-act-minutes', '60');
    await page.fill('#custom-act-cost', '150');
    await page.fill('#custom-act-places', '18');
    await page.fill('#custom-act-area', '15');
    await page.selectOption('#custom-act-need', 'open');
    await page.click('#custom-act-submit');

    const firstRow = page.locator('#activity-catalog .activity-row').first();
    await expect(firstRow).toContainText('Taller de cerámica local');
    await expect(firstRow.locator('.activity-badge-custom')).toHaveText('Propia');

    // 3. Modify cost (unsaved) and create a new contact inline without losing the modified cost
    const customId = await firstRow.getAttribute('data-activity-id');
    expect(customId).toBeTruthy();
    const costInput = page.locator(`input[data-cost="${customId}"]`);
    await costInput.fill('95');

    const contactSelect = page.locator(`select[data-contact="${customId}"]`);
    await contactSelect.selectOption('__new_contact__');
    await expect(page.locator('#inline-contact-form')).toBeVisible();
    await page.fill('#inline-contact-name', 'Taller Sol');
    await page.fill('#inline-contact-email', 'hola@tallersol.es');
    await page.fill('#inline-contact-phone', '34600123456');
    await page.click('#inline-contact-save');

    // Unsaved cost 95 must still be intact!
    await expect(costInput).toHaveValue('95');
    await expect(contactSelect).toContainText('Taller Sol');

    // 4. Plan programme and verify company appears in proposal
    await page.click('#programme-plan');
    await expect(page.locator('#programme-result')).toContainText(
      'Propuesta de programa'
    );
    await expect(page.locator('#programme-result')).toContainText('Taller Sol');

    // 5. Save programme & verify CSV download contains "Empresa" column and "Taller Sol"
    await page.click('#programme-keep');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#programme-export'),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) {
      chunks.push(Buffer.from(chunk));
    }
    const csvText = Buffer.concat(chunks).toString('utf8');
    expect(csvText).toContain('"Empresa"');
    expect(csvText).toContain('"Taller Sol"');

    // 6. Verify saved contacts appear BEFORE suggested providers, and save a suggested provider
    const savedBox = await page.locator('#saved-providers').boundingBox();
    const suggestedBox = await page.locator('#suggested-providers').boundingBox();
    expect(savedBox!.y).toBeLessThan(suggestedBox!.y);
    await expect(page.locator('#saved-providers')).toContainText('Taller Sol');
    await expect(page.locator('#saved-providers')).toContainText(
      'Taller de cerámica local'
    );
    await page.click('button[data-save-provider="Actividades Tafor"]');
    await expect(page.locator('#saved-providers')).toContainText(
      'Actividades Tafor'
    );

    // 7. Reload page and verify everything persisted
    await page.reload();
    await page.click('#game-continue');
    await page.click('#programme');
    await expect(
      page.locator('#activity-catalog .activity-row').first()
    ).toContainText('Taller de cerámica local');
    await expect(page.locator('#saved-providers')).toContainText('Taller Sol');
    await expect(page.locator('#saved-providers')).toContainText(
      'Actividades Tafor'
    );
  });
});
