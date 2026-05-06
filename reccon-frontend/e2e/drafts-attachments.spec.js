import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E, login, uniqueText } from "./helpers";

function draftButton(page) {
  return page.locator(".new-message__draftBtn");
}

function sendButton(page) {
  return page.locator(".new-message__sendBtn");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Черновики и вложения", () => {
  test("черновик открывается из списка, редактируется и сохраняется", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E editable draft");
    const body = uniqueText("E2E editable body");
    const updatedSubject = uniqueText("E2E updated draft");
    const updatedBody = uniqueText("E2E updated body");

    await page.getByText("+ Новое сообщение").click();
    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await draftButton(page).click();

    await expect(page.getByText(subject)).toBeVisible();

    await page.getByText(subject).click();

    await page.locator(".new-message__subjectInput").fill(updatedSubject);

    const openedEditor = page.locator(".new-message__editor");
    await openedEditor.click();
    await openedEditor.fill(updatedBody);

    await page.getByText("← Назад").click();

    await expect(page.getByText(updatedSubject)).toBeVisible();
    await expect(page.getByText(updatedBody)).toBeVisible();
  });

  test("черновик отправляется из списка черновиков", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E draft send");
    const body = uniqueText("E2E draft send body");

    await page.getByText("+ Новое сообщение").click();
    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    await draftButton(page).click();

    await expect(page.getByText(subject)).toBeVisible();

    await page.getByText(subject).click();
    await sendButton(page).click();

    await expect(page.getByText("Отправленные")).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();
  });

  test("локальный файл можно удалить до сохранения черновика", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E local file remove");
    const body = uniqueText("E2E local file body");

    await page.getByText("+ Новое сообщение").click();

    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    const filePath = path.join(__dirname, "fixtures", "test-file.txt");
    await page.locator(".new-message__hiddenInput").setInputFiles(filePath);

    await expect(page.getByText("test-file.txt")).toBeVisible();

    await page.getByTitle("Удалить").click();

    await expect(page.getByText("test-file.txt")).not.toBeVisible();

    await draftButton(page).click();

    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.getByText("test-file.txt")).not.toBeVisible();
  });

  test("локальное вложение отображается в новом сообщении и удаляется из формы", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    const subject = uniqueText("E2E attachment local");
    const body = uniqueText("E2E attachment local body");

    await page.getByText("+ Новое сообщение").click();

    await page.locator(".new-message__subjectInput").fill(subject);

    const editor = page.locator(".new-message__editor");
    await editor.click();
    await editor.fill(body);

    const filePath = path.join(__dirname, "fixtures", "test-file.txt");
    await page.locator(".new-message__hiddenInput").setInputFiles(filePath);

    await expect(page.getByText("test-file.txt")).toBeVisible();

    await page.getByTitle("Удалить").click();

    await expect(page.getByText("test-file.txt")).not.toBeVisible();

    await expect(draftButton(page)).toBeEnabled();
    await expect(sendButton(page)).toBeEnabled();
 });

  test("недопустимый тип файла показывает ошибку", async ({ page }) => {
    await login(page, E2E.slaveLogin, E2E.slavePassword);

    await page.getByText("+ Новое сообщение").click();

    const filePath = path.join(__dirname, "fixtures", "bad-file.exe");
    await page.locator(".new-message__hiddenInput").setInputFiles(filePath);

    await expect(
      page.getByText("Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ.")
    ).toBeVisible();
  });
});