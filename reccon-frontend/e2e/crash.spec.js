import { test, expect } from "@playwright/test";
import { E2E, login, uniqueText } from "./helpers";

test.describe("Негативные и crash-сценарии интерфейса", () => {
  test("страница авторизации открывается без белого экрана", async ({ page }) => {
    await page.goto("/auth");

    await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();
  });

  test("refresh главной страницы не ломает приложение", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.reload();

    await expect(page.getByText("Главная")).toBeVisible();
    await expect(page.getByText("+ Новое сообщение")).toBeVisible();
  });

  test("refresh страницы черновиков не ломает приложение", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("Черновики").click();

    await page.reload();

    await expect(page.getByText("Черновики")).toBeVisible();
  });

  test("refresh страницы сверок не ломает приложение", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();

    await page.reload();

    await expect(page.getByText("Сверка")).toBeVisible();
  });

  test("обычный переход между разделами не вызывает белый экран", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("Отправленные").click();
    await expect(page.getByText("Отправленные")).toBeVisible();

    await page.getByText("Черновики").click();
    await expect(page.getByText("Черновики")).toBeVisible();

    await page.getByText("Сверка").click();
    await expect(page.getByText("Сверка")).toBeVisible();

    await page.getByText("Главная").click();
    await expect(page.getByText("Главная")).toBeVisible();
  });

  test("недопустимый файл не ломает форму нового сообщения", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();

    await expect(page.getByText("Кому:")).toBeVisible();

    await page.locator(".new-message__hiddenInput").setInputFiles("e2e/fixtures/bad-file.exe");

    await expect(
      page.getByText("Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ.")
    ).toBeVisible();

    await expect(page.locator(".new-message__editor")).toBeVisible();
  });

  test("после ошибки логина можно повторно войти корректно", async ({ page }) => {
    await page.goto("/auth");

    const loginInput = page
      .locator('input[name="login"], input[name="username"], input[type="text"]')
      .first();

    const passwordInput = page.locator('input[type="password"]').first();

    await loginInput.fill(E2E.slaveLogin);
    await passwordInput.fill("wrong-password");

    await page.getByRole("button", { name: /войти/i }).click();

    await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();

    await passwordInput.fill(E2E.slavePassword);

    await page.getByRole("button", { name: /войти/i }).click();

    await expect(page.getByText("Главная")).toBeVisible();
  });
});