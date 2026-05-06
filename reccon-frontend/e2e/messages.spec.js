import { test, expect } from "@playwright/test";
import { E2E, login, uniqueText } from "./helpers";

function draftButton(page) {
  return page.locator(".new-message__draftBtn");
}

function sendButton(page) {
  return page.locator(".new-message__sendBtn");
}

test.describe("Сообщения и новое сообщение", () => {
  test("slave открывает страницу нового сообщения", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();

    await expect(page.getByText("Кому:")).toBeVisible();
    await expect(page.getByText("Тема:")).toBeVisible();
    await expect(page.getByText("Master Company")).toBeVisible();

    await expect(draftButton(page)).toBeDisabled();
    await expect(sendButton(page)).toBeDisabled();
  });

  test("после ввода текста кнопки Черновик и Отправить становятся активными", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill("Тестовое сообщение для проверки кнопок");

    await expect(draftButton(page)).toBeEnabled();
    await expect(sendButton(page)).toBeEnabled();
  });

  test("slave сохраняет новое сообщение как черновик", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E draft");
    const body = uniqueText("E2E draft body");

    await page.getByText("+ Новое сообщение").click();

    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await draftButton(page).click();

    await expect(page.getByText("Черновики")).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
  });

  test("slave создаёт новое сообщение и сразу отправляет", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E sent");
    const body = uniqueText("E2E sent body");

    await page.getByText("+ Новое сообщение").click();

    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await sendButton(page).click();

    await expect(page.getByText("Отправленные")).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
  });

test("страница нового сообщения не ломается после перезагрузки", async ({ page }) => {
  await login(page, E2E.slaveLogin, E2E.slavePassword);

  await page.getByText("+ Новое сообщение").click();

  await page.locator(".new-message__subjectInput").fill(uniqueText("E2E reload"));
  await page.locator(".new-message__editor").click();
  await page.locator(".new-message__editor").fill(uniqueText("E2E reload body"));

  await page.reload();

  await expect(page.getByText("Кому:")).toBeVisible();
  await expect(page.getByText("Тема:")).toBeVisible();
  await expect(page.locator(".new-message__editor")).toBeVisible();
});

  test("при переходе со страницы новое сообщение сохраняется в черновики", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E sidebar save");
    const body = uniqueText("E2E sidebar save body");

    await page.getByText("+ Новое сообщение").click();

    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await page.getByText("Главная").click();
    await page.getByText("Черновики").click();

    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
  });

  test("master видит отправленное slave-сообщение во входящих", async ({ page }) => {
    const subject = uniqueText("E2E incoming");
    const body = uniqueText("E2E incoming body");

    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();
    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await sendButton(page).click();

    await expect(page.getByText("Отправленные")).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();

    await page.getByText("Выход").click();

    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Входящие").click();

    const search = page.locator(".search__input");
    if (await search.isVisible()) {
    await search.fill(subject);
    }

    await expect(page.getByText(subject)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(body)).toBeVisible({ timeout: 20000 });
  });

  test("master открывает входящее сообщение и видит действие подтверждения", async ({ page }) => {
    const subject = uniqueText("E2E confirm");
    const body = uniqueText("E2E confirm body");

    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();
    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await sendButton(page).click();

    await expect(page.getByText("Отправленные")).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();

    await page.getByText("Выход").click();

    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Входящие").click();

    const search = page.locator(".search__input");
    if (await search.isVisible()) {
        await search.fill(subject);
    }

    await expect(page.getByText(subject)).toBeVisible({ timeout: 20000 });

    await page.getByText(subject).click();

    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByRole("button", { name: /подтвердить/i })).toBeVisible();
  });
});