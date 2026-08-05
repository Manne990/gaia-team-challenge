import { expect, test } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@northstar.test');
  await page.getByLabel('Password').fill('OwnerPass!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
}

test('navigates the operational shell at desktop size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Companies' }).click();
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Companies' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('opens navigation without page-level horizontal scrolling on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
  await expect(
    page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
});
