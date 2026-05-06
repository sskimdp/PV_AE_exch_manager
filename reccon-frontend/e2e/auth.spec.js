import { test, expect } from "@playwright/test";
import { E2E, login, logout } from "./helpers";

test.describe("Авторизация", () => {
  test("slave успешно входит в систему", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await expect(page.getByText("Главная")).toBeVisible();
    await expect(page.getByText("+ Новое сообщение")).toBeVisible();
  });

  test("master успешно входит в систему", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await expect(page.getByText("Главная")).toBeVisible();
    await expect(page.getByText("Входящие")).toBeVisible();
  });

test("неверный пароль не пускает в систему", async ({ page }) => {
  await page.goto("/auth");

  const loginInput = page
    .locator('input[name="login"], input[name="username"], input[type="text"]')
    .first();

  const passwordInput = page.locator('input[type="password"]').first();

  await loginInput.fill(E2E.slaveLogin);
  await passwordInput.fill("wrong-password");

  await page.getByRole("button", { name: /войти/i }).click();

  await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();
  await expect(page.getByText("Главная")).not.toBeVisible();
  await expect(page.getByText("+ Новое сообщение")).not.toBeVisible();
});

  test("logout возвращает пользователя на страницу входа", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await logout(page);

    await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();
  });

  test("после refresh пользователь остаётся в системе", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.reload();

    await expect(page.getByText("Главная")).toBeVisible();
    await expect(page.getByText("+ Новое сообщение")).toBeVisible();
  });
});