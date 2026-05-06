import { expect } from "@playwright/test";

export const E2E = {
  slaveLogin: process.env.E2E_SLAVE_LOGIN || "slave_admin",
  slavePassword: process.env.E2E_SLAVE_PASSWORD || "12345678",

  masterLogin: process.env.E2E_MASTER_LOGIN || "master_admin",
  masterPassword: process.env.E2E_MASTER_PASSWORD || "12345678",
};

export async function login(page, username, password) {
  await page.goto("/auth");

  const loginInput = page
    .locator('input[name="login"], input[name="username"], input[type="text"]')
    .first();

  const passwordInput = page.locator('input[type="password"]').first();

  await loginInput.fill(username);
  await passwordInput.fill(password);

  await page.getByRole("button", { name: /войти/i }).click();

  await expect(page.getByText("Главная")).toBeVisible();
}

export async function logout(page) {
  await page.getByText("Выход").click();
  await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();
}

export function uniqueText(prefix) {
  return `${prefix} ${Date.now()}`;
}