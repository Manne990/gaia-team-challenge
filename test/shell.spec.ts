import { expect, test } from '@playwright/test';

test('desktop navigation renders a working list view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good morning, Lina' })).toBeVisible();
  await page.getByRole('button', { name: 'Companies' }).click();
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Companies list' })).toBeVisible();
});

test('mobile shell opens navigation without page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Close navigation' }),
  ).toBeVisible();
  expect(
    await page.locator('html').evaluate((element) => element.scrollWidth === element.clientWidth),
  ).toBe(true);
});

test('account dialog restores focus to its trigger when dismissed', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /Lina Berg.*owner/ });
  await trigger.focus();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Account menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
