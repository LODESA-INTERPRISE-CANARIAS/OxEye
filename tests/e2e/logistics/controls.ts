/**
 * Helpers for the Gestor's own form controls (`src/logistics/ui/`): the
 * select is a button with a listbox, so `selectOption` and `toHaveValue`
 * become these. Time and date fields stay text inputs: `fill('09:30')`,
 * `fill('2026-12-02')` and `toHaveValue('09:30')` keep working; a date
 * shows as «02/12/2026», so compare its value with `expectValue`.
 */
import {expect, type Page} from '@playwright/test';

/** Asserts the stored value (`YYYY-MM-DD`, `HH:MM`, option value). */
export async function expectValue(page: Page, id: string, value: string) {
  await expect(page.locator(`#${id}`)).toHaveAttribute('data-value', value);
}

/** Opens the select `#id` and chooses the option with `value`. */
export async function choose(page: Page, id: string, value: string) {
  const field = page.locator(`#${id}`);
  await field.click();
  await page
    .locator(`#${id}-listbox [role="option"][data-value="${value}"]`)
    .click();
  await expect(field).toHaveAttribute('data-value', value);
}

/** Option labels of the select `#id` (opens and closes the list). */
export async function optionLabels(page: Page, id: string): Promise<string[]> {
  await page.locator(`#${id}`).click();
  const labels = await page
    .locator(`#${id}-listbox [role="option"] .lx-lb__label`)
    .allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.locator(`#${id}-listbox`)).toHaveCount(0);
  return labels;
}

/** Option values of the select `#id` (opens and closes the list). */
export async function optionValues(page: Page, id: string): Promise<string[]> {
  await page.locator(`#${id}`).click();
  const values = await page
    .locator(`#${id}-listbox [role="option"]`)
    .evaluateAll(els => els.map(el => el.getAttribute('data-value') ?? ''));
  await page.keyboard.press('Escape');
  await expect(page.locator(`#${id}-listbox`)).toHaveCount(0);
  return values;
}

/** Group headings and their option labels (opens and closes the list). */
export async function optionGroups(
  page: Page,
  id: string,
): Promise<{label: string; options: string[]}[]> {
  await page.locator(`#${id}`).click();
  const groups = await page
    .locator(`#${id}-listbox [role="group"]`)
    .evaluateAll(els =>
      els.map(g => ({
        label: g.querySelector('.lx-lb__heading')?.textContent ?? '',
        options: [...g.querySelectorAll('[role="option"] .lx-lb__label')].map(
          o => o.textContent ?? '',
        ),
      })),
    );
  await page.keyboard.press('Escape');
  return groups;
}
