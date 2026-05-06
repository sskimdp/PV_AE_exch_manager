import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReconciliationDetailsPage from "./ReconciliationDetailsPage";
import { reconciliationsApi } from "../../../api/reconciliationsApi";
import { storage } from "../../../utils/storage";

const navigateMock = vi.fn();

let outletUser = {
  id: 1,
  companyType: "master",
  companyName: "Master Company",
  login: "master_admin",
};

let locationMock = {
  pathname: "/reconciliation/1",
  state: {},
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: "1" }),
    useLocation: () => locationMock,
    useOutletContext: () => ({
      user: outletUser,
    }),
  };
});

vi.mock("../../../utils/storage", () => ({
  storage: {
    setPendingMessageContext: vi.fn(),
  },
}));

vi.mock("../../../api/reconciliationsApi", () => ({
  reconciliationsApi: {
    getById: vi.fn(),
    listChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    createNewStage: vi.fn(),
    finish: vi.fn(),
    bulkConfirm: vi.fn(),
    exportStage: vi.fn(),
    exportAllStages: vi.fn(),
    events: {
      RECONCILIATIONS_CHANGED_EVENT: "reccon:reconciliations-changed",
    },
  },
}));

vi.mock("../../../components/ReconciliationStagePanel/ReconciliationStagePanel", () => ({
  ReconciliationStagePanel: ({
    companyName,
    currentStageNumber,
    latestStageNumber,
    role,
    onCreateNewStage,
    onFinishStage,
    onSendMessage,
    onConfirmSelection,
    isConfirmSelectionEnabled,
  }) => (
    <div data-testid="stage-panel">
      <div>Компания панели: {companyName}</div>
      <div>Текущий этап: {currentStageNumber}</div>
      <div>Последний этап: {latestStageNumber}</div>
      <div>Роль: {role}</div>

      <button type="button" onClick={onCreateNewStage}>
        + Новый этап
      </button>

      <button type="button" onClick={onFinishStage}>
        Завершить
      </button>

      <button type="button" onClick={onSendMessage}>
        Дослать сообщение
      </button>

      <button
        type="button"
        disabled={!isConfirmSelectionEnabled}
        onClick={onConfirmSelection}
      >
        Подтвердить выбранное
      </button>
    </div>
  ),
}));

const baseReconciliation = {
  id: 1,
  company: "Slave Company",
  initiator: "Master Company",
  periodFrom: "01.05.2026",
  periodTo: "31.05.2026",
  status: "Активна",
  currentStageNumber: 1,
  stages: [
    {
      number: 1,
      isCompleted: false,
      messages: [
        {
          id: 101,
          stageItemId: 1001,
          number: "O-000001",
          subject: "",
          status: "Ожидает подтверждения",
          sentAt: "05.05.2026",
          confirmedAt: "",
          readAt: "",
          senderCompany: "Slave Company",
          recipientCompany: "Master Company",
          senderLogin: "slave_user",
          confirmerLogin: "",
          stageReviewed: false,
          availableForSlaveConfirmation: true,
        },
        {
          id: 102,
          stageItemId: 1002,
          number: "I-000001",
          subject: "Confirmed message",
          status: "Подтверждено",
          sentAt: "05.05.2026",
          confirmedAt: "06.05.2026",
          readAt: "05.05.2026",
          senderCompany: "Slave Company",
          recipientCompany: "Master Company",
          senderLogin: "slave_user",
          confirmerLogin: "master_admin",
          stageReviewed: true,
          availableForSlaveConfirmation: true,
        },
      ],
    },
  ],
};

const chatMessagesFixture = [
  {
    id: 1,
    text: "Chat text",
    userLogin: "master_admin",
    companyName: "Master Company",
    sentAt: "10:00",
    stageNumber: 1,
  },
];

describe("ReconciliationDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    outletUser = {
      id: 1,
      companyType: "master",
      companyName: "Master Company",
      login: "master_admin",
    };

    locationMock = {
      pathname: "/reconciliation/1",
      state: {},
    };

    reconciliationsApi.getById.mockResolvedValue(baseReconciliation);
    reconciliationsApi.listChatMessages.mockResolvedValue(chatMessagesFixture);

    reconciliationsApi.createNewStage.mockResolvedValue({
      ...baseReconciliation,
      currentStageNumber: 2,
      stages: [
        {
          ...baseReconciliation.stages[0],
          isCompleted: true,
        },
        {
          number: 2,
          isCompleted: false,
          messages: [],
        },
      ],
    });

    reconciliationsApi.finish.mockResolvedValue({
      ...baseReconciliation,
      status: "Завершена",
      stages: [
        {
          ...baseReconciliation.stages[0],
          isCompleted: true,
        },
      ],
    });

    reconciliationsApi.sendChatMessage.mockResolvedValue({
      id: 2,
      text: "New chat",
      stageNumber: 1,
    });

    reconciliationsApi.bulkConfirm.mockResolvedValue({});
    reconciliationsApi.exportStage.mockResolvedValue();
    reconciliationsApi.exportAllStages.mockResolvedValue();
  });

  it("загружает деталку сверки и показывает статистику", async () => {
    render(<ReconciliationDetailsPage />);

    expect(await screen.findByText("Компания панели: Slave Company")).toBeInTheDocument();
    expect(screen.getByText("Всего сообщений")).toBeInTheDocument();
    expect(screen.getByText("Подтверждено")).toBeInTheDocument();
    expect(screen.getAllByText("Ожидает подтверждения").length).toBeGreaterThan(0);
    expect(screen.getByText("50%")).toBeInTheDocument();

    expect(reconciliationsApi.getById).toHaveBeenCalledWith("1");
    expect(reconciliationsApi.listChatMessages).toHaveBeenCalledWith("1");
  });

  it("пустая тема сообщения отображается как Без темы", async () => {
    render(<ReconciliationDetailsPage />);

    expect(await screen.findByText("Без темы")).toBeInTheDocument();
  });

  it("открывает модалку экспорта и экспортирует текущий этап", async () => {
    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    fireEvent.click(screen.getByText("Экспортировать"));

    expect(screen.getByText("Экспорт сверки")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Скачать этап 1"));

    await waitFor(() => {
      expect(reconciliationsApi.exportStage).toHaveBeenCalledWith(1, 1);
    });
  });

  it("экспортирует все этапы", async () => {
    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    fireEvent.click(screen.getByText("Экспортировать"));
    fireEvent.click(screen.getByText("Скачать все этапы"));

    await waitFor(() => {
      expect(reconciliationsApi.exportAllStages).toHaveBeenCalledWith(1);
    });
  });

  it("отправляет сообщение в чат с номером текущего этапа", async () => {
    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    fireEvent.click(screen.getByText("Чат с компанией"));

    const input = screen.getByPlaceholderText("Введите текст сообщения");
    fireEvent.change(input, {
      target: { value: "New chat message" },
    });

    fireEvent.click(screen.getByText("Отправить"));

    await waitFor(() => {
      expect(reconciliationsApi.sendChatMessage).toHaveBeenCalledWith(1, {
        text: "New chat message",
        stageNumber: 1,
      });
    });
  });

  it("создаёт новый этап после подтверждения модалки", async () => {
    const readyReconciliation = {
      ...baseReconciliation,
      stages: [
        {
          ...baseReconciliation.stages[0],
          messages: baseReconciliation.stages[0].messages.map((message) => ({
            ...message,
            stageReviewed: true,
          })),
        },
      ],
    };

    reconciliationsApi.getById.mockResolvedValue(readyReconciliation);

    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    await waitFor(() => {
      expect(screen.getByText(/Текущий этап:/)).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText("+ Новый этап"));

    const confirmButton = await screen.findByText("Подтвердить");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(reconciliationsApi.createNewStage).toHaveBeenCalledWith(1);
    });
  });

  it("завершает сверку после подтверждения модалки", async () => {
    const readyReconciliation = {
      ...baseReconciliation,
      stages: [
        {
          ...baseReconciliation.stages[0],
          messages: baseReconciliation.stages[0].messages.map((message) => ({
            ...message,
            stageReviewed: true,
          })),
        },
      ],
    };

    reconciliationsApi.getById.mockResolvedValue(readyReconciliation);

    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    await waitFor(() => {
      expect(screen.getByText(/Текущий этап:/)).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText("Завершить"));

    expect(
      await screen.findByText((content) => content.includes("Завершить сверку?"))
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(reconciliationsApi.finish).toHaveBeenCalledWith(1);
    });
  });

  it("slave выбирает сообщение и подтверждает элементы этапа", async () => {
    outletUser = {
      id: 2,
      companyType: "slave",
      companyName: "Slave Company",
      login: "slave_user",
    };

    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Master Company");

    await waitFor(() => {
      expect(screen.getByText(/Текущий этап:/)).toHaveTextContent("1");
    });

    const selectButtons = screen.getAllByLabelText("Выбрать сообщение");
    fireEvent.click(selectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Подтвердить выбранное")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText("Подтвердить выбранное"));

    await waitFor(() => {
      expect(reconciliationsApi.bulkConfirm).toHaveBeenCalledWith(1, [1001]);
    });
  });

  it("кнопка Дослать сообщение сохраняет контекст и ведёт на новое сообщение", async () => {
    render(<ReconciliationDetailsPage />);

    await screen.findByText("Компания панели: Slave Company");

    fireEvent.click(screen.getByText("Дослать сообщение"));

    expect(storage.setPendingMessageContext).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "reconciliation-late-send",
        reconciliationId: 1,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith("/messages/new", {
      state: expect.objectContaining({
        fromReconciliation: true,
        reconciliationId: 1,
      }),
    });
  });

  it("открывает карточку сообщения и переходит к содержанию", async () => {
    render(<ReconciliationDetailsPage />);

    await waitFor(() => {
    expect(screen.getByText(/Текущий этап:/)).toHaveTextContent("1");
    });

    fireEvent.click(await screen.findByText("Без темы"));

    expect(screen.getByText("Номер сообщения:")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Открыть содержание"));

    expect(navigateMock).toHaveBeenCalledWith("/inbox", {
      state: expect.objectContaining({
        openedFromReconciliation: true,
        returnToReconciliationId: 1,
        returnToReconciliationStageNumber: 1,
        returnToReconciliationMessageId: 101,
      }),
    });
  });
});