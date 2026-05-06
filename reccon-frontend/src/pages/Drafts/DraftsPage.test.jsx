import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DraftsPage from "./DraftsPage";
import { messagesApi } from "../../api/messagesApi";

const navigateMock = vi.fn();

let locationMock = {
  state: null,
  key: "test-key",
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
        login: "django",
      },
    }),
  };
});

vi.mock("../../api/messagesApi", () => ({
  messagesApi: {
    listDrafts: vi.fn(),
    getComposeMeta: vi.fn(),
    updateDraft: vi.fn(),
    uploadDraftAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    deleteDraft: vi.fn(),
    sendDraft: vi.fn(),
    events: {
      MESSAGE_CHANGED_EVENT: "reccon:messages-changed",
    },
  },
}));

const draftFixture = {
  id: 1,
  company: "Slave Company",
  recipientCompany: "Master Company",
  subject: "Draft subject",
  text: "Draft text",
  html: "Draft text",
  date: "05.05.2026",
  attachments: [
    {
      id: 10,
      name: "file.pdf",
      filename: "file.pdf",
      size: 100,
      url: "https://example.com/file.pdf",
      downloadUrl: "https://example.com/file.pdf",
      deleteUrl: "/api/attachments/10/",
    },
  ],
};

function getEditor(container) {
  return container.querySelector(".new-message__editor");
}

function typeEditorText(container, text) {
  const editor = getEditor(container);
  editor.textContent = text;
  editor.innerHTML = text;
  fireEvent.input(editor);
}

describe("DraftsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    locationMock = {
      state: null,
      key: "test-key",
    };

    messagesApi.listDrafts.mockResolvedValue([draftFixture]);
    messagesApi.getComposeMeta.mockResolvedValue({
      recipientCompanyName: "Master Company",
    });

    messagesApi.updateDraft.mockImplementation(async (id, patch) => ({
      ...draftFixture,
      id,
      subject: patch.subject ?? draftFixture.subject,
      text: patch.text ?? draftFixture.text,
      html: patch.html ?? draftFixture.html,
    }));

    messagesApi.uploadDraftAttachments.mockResolvedValue({
      ...draftFixture,
      attachments: [
        ...draftFixture.attachments,
        {
          id: 11,
          name: "new.pdf",
          filename: "new.pdf",
          size: 50,
          url: "https://example.com/new.pdf",
          downloadUrl: "https://example.com/new.pdf",
          deleteUrl: "/api/attachments/11/",
        },
      ],
    });

    messagesApi.deleteAttachment.mockResolvedValue();
    messagesApi.deleteDraft.mockResolvedValue();
    messagesApi.sendDraft.mockResolvedValue();

    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("загружает и отображает список черновиков", async () => {
    render(<DraftsPage />);

    expect(await screen.findByText("Draft subject")).toBeInTheDocument();
    expect(screen.getByText("Draft text")).toBeInTheDocument();
    expect(screen.getByText("Черновик")).toBeInTheDocument();

    expect(messagesApi.listDrafts).toHaveBeenCalled();
    expect(messagesApi.getComposeMeta).toHaveBeenCalled();
  });

  it("показывает empty state, если черновиков нет", async () => {
    messagesApi.listDrafts.mockResolvedValue([]);

    render(<DraftsPage />);

    expect(await screen.findByText("Список пуст")).toBeInTheDocument();
  });

  it("открывает черновик по клику и показывает тему, текст, вложение", async () => {
    const { container } = render(<DraftsPage />);

    fireEvent.click(await screen.findByText("Draft subject"));

    expect(await screen.findByDisplayValue("Draft subject")).toBeInTheDocument();
    expect(getEditor(container).textContent).toBe("Draft text");
    expect(screen.getByText("file.pdf")).toBeInTheDocument();
    expect(screen.getByText("Master Company")).toBeInTheDocument();
  });

  it("сохраняет изменения черновика при нажатии Назад с audit=true", async () => {
    const { container } = render(<DraftsPage />);

    fireEvent.click(await screen.findByText("Draft subject"));

    const subjectInput = await screen.findByDisplayValue("Draft subject");
    fireEvent.change(subjectInput, {
      target: { value: "Updated subject" },
    });

    typeEditorText(container, "Updated body");

    fireEvent.click(screen.getByText("← Назад"));

    await waitFor(() => {
      expect(messagesApi.updateDraft).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          subject: "Updated subject",
          text: "Updated body",
          html: "Updated body",
        }),
        { audit: true }
      );
    });
  });

  it("удаляет черновик через модалку подтверждения", async () => {
    render(<DraftsPage />);

    await screen.findByText("Draft subject");

    fireEvent.click(screen.getByText("Удалить"));

    expect(screen.getByText("Удаление черновика")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(messagesApi.deleteDraft).toHaveBeenCalledWith(1);
    });

    expect(screen.queryByText("Draft subject")).not.toBeInTheDocument();
  });

  it("отмена удаления закрывает модалку", async () => {
    render(<DraftsPage />);

    await screen.findByText("Draft subject");

    fireEvent.click(screen.getByText("Удалить"));
    expect(screen.getByText("Удаление черновика")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Отмена"));

    expect(screen.queryByText("Удаление черновика")).not.toBeInTheDocument();
    expect(messagesApi.deleteDraft).not.toHaveBeenCalled();
  });

  it("добавляет вложение к открытому черновику", async () => {
    const { container } = render(<DraftsPage />);

    fireEvent.click(await screen.findByText("Draft subject"));

    const fileInput = container.querySelector(".new-message__hiddenInput");
    const file = new File(["hello"], "new.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(messagesApi.uploadDraftAttachments).toHaveBeenCalledWith(1, [file]);
    });

    expect(await screen.findByText("new.pdf")).toBeInTheDocument();
  });

  it("удаляет вложение из открытого черновика", async () => {
    render(<DraftsPage />);

    fireEvent.click(await screen.findByText("Draft subject"));

    expect(await screen.findByText("file.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Удалить"));

    await waitFor(() => {
      expect(messagesApi.deleteAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 10 })
      );
    });

    expect(screen.queryByText("file.pdf")).not.toBeInTheDocument();
  });

  it("отправляет открытый черновик", async () => {
    render(<DraftsPage />);

    fireEvent.click(await screen.findByText("Draft subject"));

    fireEvent.click(screen.getByText("Отправить"));

    await waitFor(() => {
      expect(messagesApi.sendDraft).toHaveBeenCalledWith(1);
    });

    expect(navigateMock).toHaveBeenCalledWith("/sent");
  });

  it("открывает черновик из location.state.openDraftId", async () => {
    locationMock = {
      state: { openDraftId: 1 },
      key: "open-draft-key",
    };

    render(<DraftsPage />);

    expect(await screen.findByDisplayValue("Draft subject")).toBeInTheDocument();
  });
});