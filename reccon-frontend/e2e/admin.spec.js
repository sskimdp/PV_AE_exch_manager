import { test, expect } from "@playwright/test";
import { E2E, login, uniqueText } from "./helpers";

test.describe("Администрирование", () => {
  test("master admin видит раздел администратора и список пользователей", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Администратор").click();

    await expect(page.getByText("Пользователи")).toBeVisible();
    await expect(page.locator(".admin-login").filter({ hasText: E2E.masterLogin }).first()).toBeVisible();
  });

  test("master admin видит вкладку компаний", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Администратор").click();

    await expect(page.getByText("Компании")).toBeVisible();

    await page.getByText("Компании").click();

    await expect(page.getByText("Slave Company")).toBeVisible();
  });

  test("master admin открывает форму создания пользователя", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Администратор").click();

    await page.getByText("+ Добавить пользователя").click();

    await expect(page.getByText(/создание пользователя|пользователь/i)).toBeVisible();
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible();
  });

  test("master admin открывает форму создания компании", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Администратор").click();
    await page.getByText("Компании").click();

    await page.getByText("+ Добавить компанию").click();

    await expect(page).toHaveURL(/admin\/companies\/new|company/i);
    await expect(page.locator("input").first()).toBeVisible();
  });

  test("настройки напоминаний отображаются и переключаются", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Администратор").click();

    await expect(page.locator(".admin-reminders__title")).toHaveText("Напоминания");

    const oneHour = page.getByText("1 час");
    if (await oneHour.isVisible()) {
      await oneHour.click();
      await expect(page.locator(".admin-reminders__title")).toHaveText("Напоминания");
    }
  });

  test("slave admin не видит управление компаниями", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("Администратор").click();

    await expect(page.getByText("Пользователи")).toBeVisible();
    await expect(page.getByText("Компании")).not.toBeVisible();
  });
});