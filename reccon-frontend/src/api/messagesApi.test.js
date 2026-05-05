import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./http", () => ({
  request: vi.fn(),
}));

import { request } from "./http";
import { messagesApi } from "./messagesApi";

describe("messagesApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createDraft отправляет POST /messages/drafts/ с FormData", async () => {
    await messagesApi.createDraft({
      subject: "Test",
      text: "Body",
      html: "<p>Body</p>",
    });

    expect(request).toHaveBeenCalledTimes(1);

    const [path, options] = request.mock.calls[0];
    expect(path).toBe("/messages/drafts/");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("subject")).toBe("Test");
    expect(options.body.get("text")).toBe("Body");
    expect(options.body.get("html")).toBe("<p>Body</p>");
  });

  it("createDraft добавляет reconciliation_id, если он передан", async () => {
    await messagesApi.createDraft({
      subject: "Late",
      text: "Body",
      html: "Body",
      reconciliationId: 15,
    });

    const [, options] = request.mock.calls[0];
    expect(options.body.get("reconciliation_id")).toBe("15");
  });

  it("createDraft добавляет файлы в FormData", async () => {
    const file = new File(["hello"], "test.pdf", { type: "application/pdf" });

    await messagesApi.createDraft({
      subject: "With file",
      text: "Body",
      html: "Body",
      attachments: [{ file }],
    });

    const [, options] = request.mock.calls[0];
    expect(options.body.getAll("files")).toHaveLength(1);
    expect(options.body.getAll("files")[0]).toBe(file);
  });

  it("composeAndSend отправляет POST /messages/sent/compose/ с FormData", async () => {
    await messagesApi.composeAndSend({
      subject: "Send",
      text: "Body",
      html: "Body",
    });

    const [path, options] = request.mock.calls[0];
    expect(path).toBe("/messages/sent/compose/");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
  });

  it("updateDraft отправляет PATCH и audit=true при явном сохранении", async () => {
    await messagesApi.updateDraft(
      7,
      {
        subject: "Updated",
        text: "Text",
        html: "Text",
      },
      { audit: true }
    );

    expect(request).toHaveBeenCalledWith("/messages/drafts/7/", {
      method: "PATCH",
      body: {
        subject: "Updated",
        text: "Text",
        html: "Text",
        audit: true,
      },
    });
  });

  it("updateDraft без audit отправляет audit=false", async () => {
    await messagesApi.updateDraft(7, {
      subject: "Autosave",
      text: "Text",
      html: "Text",
    });

    expect(request).toHaveBeenCalledWith("/messages/drafts/7/", {
      method: "PATCH",
      body: {
        subject: "Autosave",
        text: "Text",
        html: "Text",
        audit: false,
      },
    });
  });

  it("uploadDraftAttachments отправляет файлы в endpoint вложений черновика", async () => {
    const file = new File(["abc"], "file.pdf", { type: "application/pdf" });

    await messagesApi.uploadDraftAttachments(9, [file]);

    const [path, options] = request.mock.calls[0];
    expect(path).toBe("/messages/drafts/9/attachments/");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.getAll("files")[0]).toBe(file);
  });

  it("sendDraft вызывает endpoint отправки черновика", async () => {
    await messagesApi.sendDraft(5);

    expect(request).toHaveBeenCalledWith("/messages/drafts/5/send/", {
      method: "POST",
    });
  });

  it("deleteDraft вызывает DELETE /messages/drafts/{id}/", async () => {
    await messagesApi.deleteDraft(5);

    expect(request).toHaveBeenCalledWith("/messages/drafts/5/", {
      method: "DELETE",
    });
  });

  it("deleteAttachment удаляет вложение по относительному пути без /api/api", async () => {
    await messagesApi.deleteAttachment({
      id: 4,
      deleteUrl: "https://pvaeexchmanager-production.up.railway.app/api/attachments/4/",
    });

    expect(request).toHaveBeenCalledWith("/attachments/4/", {
      method: "DELETE",
    });
  });

  it("deleteAttachment использует fallback /attachments/{id}/", async () => {
    await messagesApi.deleteAttachment({ id: 11 });

    expect(request).toHaveBeenCalledWith("/attachments/11/", {
      method: "DELETE",
    });
  });

  it("openInboxMessage вызывает endpoint открытия входящего", async () => {
    await messagesApi.openInboxMessage(12);

    expect(request).toHaveBeenCalledWith("/messages/inbox/12/open/", {
      method: "POST",
    });
  });

  it("confirmInboxMessage отправляет receiver_number", async () => {
    await messagesApi.confirmInboxMessage(12, "I-000001");

    expect(request).toHaveBeenCalledWith("/messages/inbox/12/confirm/", {
      method: "POST",
      body: { receiver_number: "I-000001" },
    });
  });
});