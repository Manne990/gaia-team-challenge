import { test, expect } from '@playwright/test';

test('seeded owner can reach the CRM dashboard', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@northstar.test');
  await page.getByLabel('Password').fill('OwnerPass!2026');
  await Promise.all([
    page.waitForURL('**/dashboard'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Northstar CRM', exact: true })).toBeVisible();
  await expect(page.getByText('28 accounts')).toBeVisible();
});
