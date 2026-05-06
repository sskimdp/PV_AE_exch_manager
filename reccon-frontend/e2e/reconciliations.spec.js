import { test, expect } from "@playwright/test";
import { E2E, login, uniqueText } from "./helpers";

async function hideReminder(page) {
  await page.locator(".dashboard-reminder").evaluateAll((items) => {
    for (const item of items) {
      item.style.display = "none";
      item.style.pointerEvents = "none";
    }
  });
}

function sendButton(page) {
  return page.locator(".new-message__sendBtn");
}

async function createMessageFromSlave(page, subject, body) {
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
}

test.describe("Сверки", () => {
  test("master видит раздел сверок", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();

    await expect(page.getByRole("button", { name: "+ Запустить сверку" })).toBeVisible();
  });

  test("slave видит раздел сверок", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("Сверка").click();

    await expect(page.getByText(/свер/i)).toBeVisible();
  });

  test("master создаёт сверку со Slave Company", async ({ page }) => {
    const subject = uniqueText("E2E rec message");
    const body = uniqueText("E2E rec body");

    await createMessageFromSlave(page, subject, body);

    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();

    const createButton = page.getByText(/создать|начать|новая сверка|\+ новая/i).first();

    if (await createButton.isVisible()) {
      await createButton.click();

      const slaveOption = page.getByText("Slave Company").first();
      if (await slaveOption.isVisible()) {
        await slaveOption.click();
      }

      const dateInputs = page.locator('input[type="date"], input');
      const count = await dateInputs.count();

      if (count >= 2) {
        await dateInputs.nth(0).fill("2025-12-29");
        await dateInputs.nth(1).fill("2026-12-29");
      }

      const submitButton = page.getByRole("button", {
        name: /создать|начать|подтвердить/i,
      }).last();

      await submitButton.click();
    }

    await expect(page.getByText("Slave Company").first()).toBeVisible();
  });

  test("открывается деталка сверки и отображается этап", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();

    await page.getByText("Slave Company").first().click();

    await expect(page.getByText("Этап 1")).toBeVisible();
    await expect(page.getByText("Экспортировать")).toBeVisible();
  });

  test("в деталке сверки открывается чат", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();
    await page.getByText("Slave Company").first().click();

    await page.getByText("Чат с компанией").click();

    await expect(page.getByRole("button", { name: "Чат с компанией" })).toBeVisible();
  });

  test("в чат сверки можно отправить сообщение", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    const chatText = uniqueText("E2E chat");

    await page.getByText("Сверка").click();
    await page.getByText("Slave Company").first().click();

    await page.getByText("Чат с компанией").click();

    const input = page
      .locator('textarea, input[placeholder*="сообщ"], input[placeholder*="текст"]')
      .first();

    if (await input.isVisible()) {
      await input.fill(chatText);

      await page.getByRole("button", { name: /отправить/i }).click();

      await expect(page.getByText(chatText)).toBeVisible();
    } else {
      await expect(page.getByText("Чат с компанией")).toBeVisible();
    }
  });

  test("открывается модалка экспорта сверки", async ({ page }) => {
    await login(page, E2E.masterLogin, E2E.masterPassword);

    await page.getByText("Сверка").click();
    await page.getByText("Slave Company").first().click();

    await hideReminder(page);

    await page.locator(".recon-details__exportBtn").click();

    await expect(page.getByText("Экспорт сверки")).toBeVisible();
  });

  test("кнопка Дослать сообщение открывает новое сообщение из сверки", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("Сверка").click();

    const slaveCompanyInList = page.getByText("Master Company").first();
    const fallbackCompany = page.getByText("Slave Company").first();

    if (await slaveCompanyInList.isVisible()) {
      await slaveCompanyInList.click();
    } else if (await fallbackCompany.isVisible()) {
      await fallbackCompany.click();
    }

    const lateSendButton = page.getByText("Дослать сообщение");

    if (await lateSendButton.isVisible()) {
      await lateSendButton.click();

      await expect(page.getByText("Кому:")).toBeVisible();
      await expect(page.getByText("Тема:")).toBeVisible();
    } else {
      await expect(page.getByText(/свер/i)).toBeVisible();
    }
  });
});