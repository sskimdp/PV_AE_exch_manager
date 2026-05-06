import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import NewMessagePage from "./NewMessagePage";
import { messagesApi } from "../../api/messagesApi";

const navigateMock = vi.fn();

let locationMock = {
  state: null,
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => locationMock,
    useOutletContext: () => ({
      user: {
        id: 2,
        companyType: "slave",
        companyName: "Slave Company",
        masterPartnerName: "Master Company",
      },
    }),
  };
});

vi.mock("../../api/messagesApi", () => ({
  messagesApi: {
    getComposeMeta: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    uploadDraftAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    sendDraft: vi.fn(),
    composeAndSend: vi.fn(),
    events: {
      MESSAGE_CHANGED_EVENT: "reccon:messages-changed",
    },
  },
}));

function getEditor(container) {
  return container.querySelector(".new-message__editor");
}

function typeEditorText(container, text) {
  const editor = getEditor(container);
  editor.textContent = text;
  editor.innerHTML = text;
  fireEvent.input(editor);
}

describe("NewMessagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    locationMock = { state: null };

    messagesApi.getComposeMeta.mockResolvedValue({
      recipientCompanyName: "Master Company",
      recipientCompanyId: 1,
    });

    messagesApi.createDraft.mockImplementation(async ({ subject, text, html, attachments }) => ({
      id: 10,
      subject,
      text,
      html,
      attachments: (attachments || [])
        .filter((attachment) => !attachment.removed)
        .map((attachment, index) => ({
          id: index + 1,
          name: attachment.name || attachment.file?.name || "file.pdf",
          filename: attachment.name || attachment.file?.name || "file.pdf",
          size: attachment.file?.size || 10,
          url: "https://example.com/file.pdf",
          downloadUrl: "https://example.com/file.pdf",
          deleteUrl: "/api/attachments/1/",
        })),
    }));

    messagesApi.updateDraft.mockImplementation(async (id, patch) => ({
      id,
      subject: patch.subject,
      text: patch.text,
      html: patch.html,
      attachments: [],
    }));

    messagesApi.uploadDraftAttachments.mockResolvedValue({
      id: 10,
      subject: "Test",
      text: "Body",
      html: "Body",
      attachments: [
        {
          id: 1,
          name: "file.pdf",
          filename: "file.pdf",
          size: 10,
          url: "https://example.com/file.pdf",
          downloadUrl: "https://example.com/file.pdf",
          deleteUrl: "/api/attachments/1/",
        },
      ],
    });

    messagesApi.sendDraft.mockResolvedValue({});

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("загружает получателя из compose-meta", async () => {
    render(<NewMessagePage />);

    expect(await screen.findByText("Master Company")).toBeInTheDocument();
    expect(messagesApi.getComposeMeta).toHaveBeenCalled();
  });

  it("кнопки Черновик и Отправить неактивны без текста и вложений", async () => {
    render(<NewMessagePage />);

    expect(await screen.findByText("Master Company")).toBeInTheDocument();

    expect(screen.getByText("Черновик")).toBeDisabled();
    expect(screen.getByText("Отправить")).toBeDisabled();
  });

  it("после ввода текста кнопки становятся активными", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    typeEditorText(container, "Текст сообщения");

    expect(screen.getByText("Черновик")).not.toBeDisabled();
    expect(screen.getByText("Отправить")).not.toBeDisabled();
  });

  it("сохраняет новое сообщение в черновик через createDraft и пишет audit через updateDraft", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    fireEvent.change(document.querySelector(".new-message__subjectInput"), {
      target: { value: "Тема" },
    });
    typeEditorText(container, "Текст сообщения");

    fireEvent.click(screen.getByText("Черновик"));

    await waitFor(() => {
      expect(messagesApi.createDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(messagesApi.updateDraft).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          subject: "Тема",
          text: "Текст сообщения",
          html: "Текст сообщения",
        }),
        { audit: true }
      );
    });

    expect(navigateMock).toHaveBeenCalledWith("/drafts");
  });

  it("при отправке нового сообщения сначала создаёт черновик, затем отправляет его", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    fireEvent.change(document.querySelector(".new-message__subjectInput"), {
      target: { value: "Тема отправки" },
    });
    typeEditorText(container, "Текст отправки");

    fireEvent.click(screen.getByText("Отправить"));

    await waitFor(() => {
      expect(messagesApi.createDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(messagesApi.sendDraft).toHaveBeenCalledWith(10);
    });

    expect(navigateMock).toHaveBeenCalledWith("/sent");
  });

  it("выбор файла показывает файл, но не создаёт черновик автоматически", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    const file = new File(["hello"], "test.pdf", {
      type: "application/pdf",
    });

    const input = container.querySelector(".new-message__hiddenInput");

    fireEvent.change(input, {
      target: { files: [file] },
    });

    expect(await screen.findByText("test.pdf")).toBeInTheDocument();
    expect(messagesApi.createDraft).not.toHaveBeenCalled();
  });

  it("удалённый локальный файл не попадает в createDraft", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    typeEditorText(container, "Текст с файлом");

    const file = new File(["hello"], "remove-me.pdf", {
      type: "application/pdf",
    });

    const input = container.querySelector(".new-message__hiddenInput");

    fireEvent.change(input, {
      target: { files: [file] },
    });

    expect(await screen.findByText("remove-me.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Удалить"));

    await waitFor(() => {
      expect(screen.queryByText("remove-me.pdf")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Черновик"));

    await waitFor(() => {
      expect(messagesApi.createDraft).toHaveBeenCalled();
    });

    const draftPayload = messagesApi.createDraft.mock.calls[0][0];
    expect(draftPayload.attachments).toEqual([]);
  });

  it("недопустимый файл показывает ошибку", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    const file = new File(["bad"], "bad.exe", {
      type: "application/octet-stream",
    });

    const input = container.querySelector(".new-message__hiddenInput");

    fireEvent.change(input, {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(
        "Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ."
      )
    ).toBeInTheDocument();
  });

  it("слишком большой файл показывает ошибку", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    const largeFile = new File(["x"], "large.pdf", {
      type: "application/pdf",
    });

    Object.defineProperty(largeFile, "size", {
      value: 11 * 1024 * 1024,
    });

    const input = container.querySelector(".new-message__hiddenInput");

    fireEvent.change(input, {
      target: { files: [largeFile] },
    });

    expect(
      await screen.findByText(
        "Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ."
      )
    ).toBeInTheDocument();
  });

  it("восстанавливает новое сообщение из localStorage после перезагрузки", async () => {
    localStorage.setItem(
      "reccon:new-message-compose:2:default",
      JSON.stringify({
        draftId: null,
        recipientName: "Master Company",
        subject: "Сохраненная тема",
        text: "Сохраненный текст",
        html: "Сохраненный текст",
        attachments: [],
      })
    );

    const { container } = render(<NewMessagePage />);

    await screen.findByDisplayValue("Сохраненная тема");

    expect(getEditor(container).textContent).toBe("Сохраненный текст");
  });

  it("новое сообщение без draftId не автосоздаёт серверный черновик", async () => {
    const { container } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    typeEditorText(container, "Автосохранение не должно создать серверный черновик");

    vi.useFakeTimers();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    vi.useRealTimers();

    expect(messagesApi.createDraft).not.toHaveBeenCalled();
  });

  it("при переходе со страницы с текстом создаёт серверный черновик и очищает localStorage", async () => {
    const { container, unmount } = render(<NewMessagePage />);

    await screen.findByText("Master Company");

    typeEditorText(container, "Текст перед уходом");

    const storageKey = "reccon:new-message-compose:2:default";
    expect(localStorage.getItem(storageKey)).toBeTruthy();

    unmount();

    await waitFor(() => {
      expect(messagesApi.createDraft).toHaveBeenCalled();
    });

    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});