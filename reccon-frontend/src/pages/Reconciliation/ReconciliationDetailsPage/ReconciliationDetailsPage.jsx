
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button } from "../../../components/Button/Button";
import { Chip } from "../../../components/Chip/Chip";
import { SearchInput } from "../../../components/SearchInput/SearchInput";
import { ReconciliationStagePanel } from "../../../components/ReconciliationStagePanel/ReconciliationStagePanel";
import { storage } from "../../../utils/storage";
import { reconciliationsApi } from "../../../api/reconciliationsApi";
import "./ReconciliationDetailsPage.css";

const norm = (value) => String(value || "").trim().toLowerCase();

function formatPercent(confirmed, total) {
  if (!total) return "0%";
  return `${Math.round((confirmed / total) * 100)}%`;
}

function displaySystemNumber(value) {
  const normalized = String(value || "").trim();
  return normalized ? `№ ${normalized}` : "";
}

function getMessageSubject(subject) {
  const value = String(subject || "").trim();
  return value || "Без темы";
}

function findMessageById(stages, messageId) {
  for (const stage of stages || []) {
    const found = (stage.messages || []).find((message) => message.id === messageId);
    if (found) return found;
  }

  return null;
}

function getPendingChipVariant(status) {
  return norm(status) === "прочитано" ? "read" : "pending";
}

function StatCard({ type, title, value }) {
  const isPercent = type === "percent";

  return (
    <div className={`recon-details__statCard recon-details__statCard--${type}`}>
      <div className="recon-details__statTop">
        {isPercent ? (
          <span className="recon-details__statTitle recon-details__statTitle--percent">
            Доля подтверждённых
          </span>
        ) : (
          <div className="recon-details__statLabel">
            <span className="recon-details__statTitle">{title}</span>
          </div>
        )}

        <div className="recon-details__statValue">{value}</div>
      </div>
    </div>
  );
}

export default function ReconciliationDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const outletContext = useOutletContext() || {};
  const user = outletContext.user || null;

  const [reconciliation, setReconciliation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState("messages");
  const [search, setSearch] = useState("");
  const [confirmModal, setConfirmModal] = useState(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [openedMessageId, setOpenedMessageId] = useState(null);
  const [chatText, setChatText] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const chatListRef = useRef(null);
  const handledReconOpenRef = useRef(false);

  const isSlaveView = norm(user?.companyType) === "slave";
  const role = isSlaveView ? "slave" : "master";

  const loadReconciliation = async (options = {}) => {
    const { silent = false } = options;

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const [reconciliationData, chatMessages] = await Promise.all([
        reconciliationsApi.getById(id),
        reconciliationsApi.listChatMessages(id).catch(() => []),
      ]);

      setReconciliation({
        ...reconciliationData,
        chatMessages,
      });
      setLoadError("");
      return reconciliationData;
    } catch (error) {
      console.error("Не удалось загрузить сверку", error);
      setLoadError(error?.message || error?.detail || "Не удалось загрузить сверку");
      setReconciliation(null);
      return null;
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await loadReconciliation();
    };

    run();

    const handleReload = () => {
      if (cancelled) return;
      loadReconciliation({ silent: true });
    };

    window.addEventListener(
      reconciliationsApi.events.RECONCILIATIONS_CHANGED_EVENT,
      handleReload
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        reconciliationsApi.events.RECONCILIATIONS_CHANGED_EVENT,
        handleReload
      );
    };
  }, [id]);

  const stages = reconciliation?.stages || [];
  // const latestStageNumber = stages[stages.length - 1]?.number || 1;
  const latestStageNumber =
    stages.length > 0
      ? Math.max(...stages.map((stage) => Number(stage.number) || 0))
      : 1;

  const [currentStageNumber, setCurrentStageNumber] = useState(null);

  useEffect(() => {
    if (!reconciliation || !stages.length) return;

    const activeStageNumber =
      reconciliation.currentStageNumber ||
      stages.find((stage) => !stage.isCompleted)?.number ||
      latestStageNumber;

    setCurrentStageNumber((prev) => {
      if (prev == null) return activeStageNumber;

      const exists = stages.some((stage) => Number(stage.number) === Number(prev));
      return exists ? prev : activeStageNumber;
    });
  }, [reconciliation?.id, reconciliation?.currentStageNumber, stages, latestStageNumber]);

  useEffect(() => {
    if (!stages.length) return;

    const hasCurrentStage = stages.some(
      (stage) => Number(stage.number) === Number(currentStageNumber)
    );

    if (!hasCurrentStage) {
      setCurrentStageNumber(latestStageNumber);
      return;
    }

    if (currentStageNumber > latestStageNumber) {
      setCurrentStageNumber(latestStageNumber);
    }
  }, [currentStageNumber, latestStageNumber, stages]);

  const currentStage =
    stages.find((stage) => Number(stage.number) === Number(currentStageNumber)) ||
    stages[stages.length - 1] ||
    null;

  const openedMessage = useMemo(
    () => findMessageById(stages, openedMessageId),
    [openedMessageId, stages]
  );

  const isViewingLatestStage = Number(currentStageNumber) === Number(latestStageNumber);
  const isLatestStageCompleted = Boolean(stages[stages.length - 1]?.isCompleted);
  const isCurrentStageCompleted = Boolean(currentStage?.isCompleted);
  const isReconciliationCompleted = norm(reconciliation?.status) === "завершена";

  const canOpenStageMessage = Boolean(currentStage) && !isCurrentStageCompleted;
  const isChatLocked = !isViewingLatestStage || isCurrentStageCompleted || isReconciliationCompleted;
  const canSendChatMessage = !isChatLocked && chatText.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    if (openedMessageId && !openedMessage) {
      setOpenedMessageId(null);
    }
  }, [openedMessage, openedMessageId]);

  useEffect(() => {
    const targetMessageId = location.state?.openReconMessageId;
    const targetStageNumber = location.state?.openReconStageNumber;

    if (!targetMessageId) return;
    if (handledReconOpenRef.current) return;

    handledReconOpenRef.current = true;

    if (
      targetStageNumber &&
      stages.some((stage) => Number(stage.number) === Number(targetStageNumber))
    ) {
      setCurrentStageNumber(Number(targetStageNumber));
    }

    setOpenedMessageId(targetMessageId);

    navigate(location.pathname, {
      replace: true,
      state: {},
    });
  }, [location.pathname, location.state, navigate, stages]);

  useEffect(() => {
    setSelectedMessageIds([]);
  }, [currentStageNumber, activeTab, search, reconciliation?.id]);

  const stats = useMemo(() => {
    const total = currentStage?.messages?.length || 0;
    const confirmed = (currentStage?.messages || []).filter(
      (message) => norm(message.status) === "подтверждено"
    ).length;
    const pending = total - confirmed;

    return {
      total,
      confirmed,
      pending,
      percent: formatPercent(confirmed, total),
    };
  }, [currentStage]);

  const stageMessages = currentStage?.messages || [];
  const isEmptyStage = stageMessages.length === 0;

  const allStageMessagesReviewed =
    isEmptyStage || stageMessages.every((message) => Boolean(message.stageReviewed));

  const visibleMessages = useMemo(() => {
    let result = [...(currentStage?.messages || [])];

    if (activeTab === "confirmed") {
      result = result.filter((message) => norm(message.status) === "подтверждено");
    }

    if (activeTab === "pending") {
      result = result.filter((message) => norm(message.status) !== "подтверждено");
    }

    if (search.trim()) {
      const query = norm(search);
      result = result.filter((message) => {
        const haystack = [message.number, message.subject].map(norm).join(" ");
        return haystack.includes(query);
      });
    }

    return result;
  }, [activeTab, currentStage, search]);

  const reviewableMessages = useMemo(
    () =>
      visibleMessages.filter(
        (message) =>
          !message.stageReviewed && message.availableForSlaveConfirmation !== false
      ),
    [visibleMessages]
  );

  const reviewableMessageIds = useMemo(
    () => reviewableMessages.map((message) => message.id),
    [reviewableMessages]
  );

  const allVisibleMessagesReviewed =
    visibleMessages.length > 0 && visibleMessages.every((message) => message.stageReviewed);

  const allVisibleReviewableSelected =
    reviewableMessageIds.length > 0 &&
    reviewableMessageIds.every((messageId) => selectedMessageIds.includes(messageId));

  const hasSelectedReviewableMessages =
    selectedMessageIds.length > 0 &&
    reviewableMessages.some((message) => selectedMessageIds.includes(message.id));


  const reconciliationCompanyName = isSlaveView
    ? reconciliation?.initiator || "Компания"
    : reconciliation?.company || "Компания";

  const currentUserLogin = norm(user?.login || user?.username || "");

  const visibleChatMessages = useMemo(() => {
    const messages = reconciliation?.chatMessages || [];

    return messages.filter((message) => {
      const messageStageNumber = Number(message.stageNumber) || 1;
      return messageStageNumber <= Number(currentStageNumber);
    });
  }, [currentStageNumber, reconciliation?.chatMessages]);

  useEffect(() => {
    if (activeTab !== "chat") return;

    const listNode = chatListRef.current;
    if (!listNode) return;

    listNode.scrollTop = listNode.scrollHeight;
  }, [activeTab, visibleChatMessages]);

  const handleSendChatMessage = async () => {
    const text = chatText.trim();
    if (!text || !reconciliation || isChatLocked || isSubmitting) return;

    setIsSubmitting(true);

    try {
      await reconciliationsApi.sendChatMessage(reconciliation.id, {
        text,
        stageNumber: currentStageNumber,
      });
      setChatText("");
      await loadReconciliation({ silent: true });
    } catch (error) {
      console.error("Не удалось отправить сообщение в чат", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChatInputKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendChatMessage();
    }
  };

  const createNextStage = async () => {
    if (
      !reconciliation ||
      !isViewingLatestStage ||
      isLatestStageCompleted ||
      !allStageMessagesReviewed ||
      latestStageNumber >= 10 ||
      isSubmitting
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await reconciliationsApi.createNewStage(reconciliation.id);
      const chatMessages = await reconciliationsApi.listChatMessages(reconciliation.id).catch(() => []);
      setReconciliation({
        ...updated,
        chatMessages,
      });
      const nextStageNumber =
        updated.currentStageNumber ||
        updated.stages?.[updated.stages.length - 1]?.number ||
        currentStageNumber + 1;
      setCurrentStageNumber(nextStageNumber);
      setActiveTab("messages");
      setSearch("");
      setSelectedMessageIds([]);
    } catch (error) {
      console.error("Не удалось создать новый этап", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const finishLatestStage = async () => {
    if (
      !reconciliation ||
      !isViewingLatestStage ||
      isLatestStageCompleted ||
      !allStageMessagesReviewed ||
      isSubmitting
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await reconciliationsApi.finish(reconciliation.id);
      const chatMessages = await reconciliationsApi.listChatMessages(reconciliation.id).catch(() => []);
      setReconciliation({
        ...updated,
        chatMessages,
      });
    } catch (error) {
      console.error("Не удалось завершить сверку", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    if (
      !reconciliation ||
      !isViewingLatestStage ||
      isLatestStageCompleted ||
      !allStageMessagesReviewed
    ) {
      return;
    }

    setConfirmModal({ type: "finish" });
  };

  const handleCreateNewStage = () => {
    if (
      !reconciliation ||
      !isViewingLatestStage ||
      isLatestStageCompleted ||
      !allStageMessagesReviewed
    ) {
      return;
    }

    setConfirmModal({ type: "newStage" });
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setConfirmModal(null);
  };

  const handleConfirmModal = async () => {
    if (!confirmModal) return;

    if (confirmModal.type === "newStage") {
      await createNextStage();
    }

    if (confirmModal.type === "finish") {
      await finishLatestStage();
    }

    setConfirmModal(null);
  };

  const toggleMessageSelection = (messageId) => {
    if (!isSlaveView) return;

    const targetMessage = currentStage?.messages?.find((message) => message.id === messageId);
    if (!targetMessage || targetMessage.stageReviewed) return;

    setSelectedMessageIds((prev) =>
      prev.includes(messageId)
        ? prev.filter((idValue) => idValue !== messageId)
        : [...prev, messageId]
    );
  };

  const handleToggleSelectAll = () => {
    if (!isSlaveView || allVisibleMessagesReviewed) return;

    setSelectedMessageIds((prev) => {
      if (allVisibleReviewableSelected) {
        return prev.filter((idValue) => !reviewableMessageIds.includes(idValue));
      }

      const next = new Set(prev);
      reviewableMessageIds.forEach((idValue) => next.add(idValue));
      return Array.from(next);
    });
  };

  const handleSlaveConfirm = async () => {
    if (
      !reconciliation ||
      !isSlaveView ||
      !isViewingLatestStage ||
      isLatestStageCompleted ||
      !hasSelectedReviewableMessages ||
      isSubmitting
    ) {
      return;
    }

    const itemIds = (currentStage?.messages || [])
      .filter((message) => selectedMessageIds.includes(message.id))
      .map((message) => message.stageItemId)
      .filter(Boolean);

    if (!itemIds.length) return;

    setIsSubmitting(true);

    try {
      await reconciliationsApi.bulkConfirm(reconciliation.id, itemIds);
      await loadReconciliation({ silent: true });
      setSelectedMessageIds([]);
    } catch (error) {
      console.error("Не удалось подтвердить сообщения этапа", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMessage = () => {
    if (!reconciliation) return;

    storage.setPendingMessageContext({
      kind: "reconciliation-late-send",
      reconciliationId: reconciliation.id,
      company: reconciliation.company,
      initiator: reconciliation.initiator,
      periodFrom: reconciliation.periodFrom,
      periodTo: reconciliation.periodTo,
      senderCompany: user?.companyName || "",
      recipientCompany: reconciliation.initiator,
    });

    navigate("/messages/new", {
      state: {
        fromReconciliation: true,
        reconciliationId: reconciliation.id,
        recipientCompany: reconciliation.initiator,
      },
    });
  };

  const handleExport = () => {
    if (!currentStage || isExporting) return;
    setExportModalOpen(true);
  };

  const handleCloseExportModal = () => {
    if (isExporting) return;
    setExportModalOpen(false);
  };

  const handleExportCurrentStage = async () => {
    if (!reconciliation || !currentStage) return;

    setIsExporting(true);

    try {
      await reconciliationsApi.exportStage(reconciliation.id, currentStage.number);
      setExportModalOpen(false);
    } catch (error) {
      console.error("Не удалось экспортировать этап", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAllStages = async () => {
    if (!reconciliation) return;

    setIsExporting(true);

    try {
      await reconciliationsApi.exportAllStages(reconciliation.id);
      setExportModalOpen(false);
    } catch (error) {
      console.error("Не удалось экспортировать сверку", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenMessageInfo = (messageId) => {
    if (!canOpenStageMessage) return;
    setOpenedMessageId(messageId);
  };

  const handleBackFromInfo = () => {
    setOpenedMessageId(null);
  };

  const handleOpenMessageContent = () => {
    if (!openedMessage || !reconciliation) return;

    navigate(isSlaveView ? "/sent" : "/inbox", {
      state: {
        openMessageRef: {
          id: openedMessage.id,
          number: openedMessage.number || "",
          outgoingNumber: openedMessage.outgoingNumber || "",
          incomingNumber: openedMessage.incomingNumber || "",
          subject: getMessageSubject(openedMessage.subject),
          sentAt: openedMessage.sentAt || "",
          senderCompany: openedMessage.senderCompany || "",
          recipientCompany: openedMessage.recipientCompany || "",
        },
        openedFromReconciliation: true,
        returnToReconciliationId: reconciliation.id,
        returnToReconciliationStageNumber: currentStageNumber,
        returnToReconciliationMessageId: openedMessage.id,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="recon-details">
        <div className="recon-details__messagesCard">
          <div className="recon-details__empty">Загрузка...</div>
        </div>
      </div>
    );
  }

  if (!reconciliation) {
    return (
      <div className="recon-details">
        <div className="recon-details__topRow">
          <div className="recon-details__backWrap">
            <Button
              type="button"
              variant="secondary"
              className="recon-details__backBtn"
              onClick={() => navigate("/reconciliation")}
            >
              ← Назад
            </Button>
          </div>
        </div>

        <div className="recon-details__messagesCard">
          <div className="recon-details__empty">
            {loadError || "Сверка не найдена"}
          </div>
        </div>
      </div>
    );
  }

  if (openedMessage) {
    return (
      <div className="recon-message-info">
        <div className="recon-message-info__top">
          <Button
            type="button"
            variant="secondary"
            className="recon-details__backBtn recon-details__backBtn--detail"
            onClick={handleBackFromInfo}
          >
            ← Назад
          </Button>
        </div>

        <div className="recon-message-info__card">
          <div className="recon-message-info__metaList">
            <div className="recon-message-info__metaRow">
              <span className="recon-message-info__label">Номер сообщения:</span>
              <span
                className="recon-message-info__value recon-message-info__value--primary"
                title={displaySystemNumber(openedMessage.number)}
              >
                {displaySystemNumber(openedMessage.number)}
              </span>
            </div>

            <div className="recon-message-info__metaRow">
              <span className="recon-message-info__label">Получатель:</span>
              <span
                className="recon-message-info__value recon-message-info__value--primary recon-message-info__value--ellipsis"
                title={openedMessage.recipientCompany}
              >
                {openedMessage.recipientCompany}
              </span>
            </div>

            <div className="recon-message-info__metaRow">
              <span className="recon-message-info__label">Отправитель:</span>
              <span
                className="recon-message-info__value recon-message-info__value--primary recon-message-info__value--ellipsis"
                title={openedMessage.senderCompany}
              >
                {openedMessage.senderCompany}
              </span>
            </div>

            <div className="recon-message-info__metaRow">
              <span className="recon-message-info__label">Тема:</span>
              <span
                className="recon-message-info__value recon-message-info__value--subject recon-message-info__value--ellipsis"
                title={getMessageSubject(openedMessage.subject)}
              >
                {getMessageSubject(openedMessage.subject)}
              </span>
            </div>
          </div>

          <div className="recon-message-info__statusFlow">
            <div className="recon-message-info__statusStep">
              <Chip variant="pending">Ожидает подтверждения</Chip>
              <div className="recon-message-info__statusTime">{openedMessage.sentAt}</div>
            </div>

            <div className="recon-message-info__statusArrow" />

            <div className="recon-message-info__statusStep">
              <Chip
                variant={openedMessage.readAt || norm(openedMessage.status) === "подтверждено" ? "read" : "draft"}
              >
                Прочитано
              </Chip>
              {openedMessage.readAt && (
                <div className="recon-message-info__statusTime">{openedMessage.readAt}</div>
              )}
            </div>

            <div className="recon-message-info__statusArrow" />

            <div className="recon-message-info__statusStep">
              <Chip
                variant={norm(openedMessage.status) === "подтверждено" ? "confirmed" : "draft"}
              >
                Подтверждено
              </Chip>
              {openedMessage.confirmedAt && (
                <div className="recon-message-info__statusTime">{openedMessage.confirmedAt}</div>
              )}
            </div>
          </div>

          <div className="recon-message-info__bottom">
            <div className="recon-message-info__logins">
              <div className="recon-message-info__loginRow">
                <span className="recon-message-info__loginLabel">Логин отправителя:</span>
                <span
                  className="recon-message-info__loginValue"
                  title={openedMessage.senderLogin}
                >
                  {openedMessage.senderLogin}
                </span>
              </div>

              <div className="recon-message-info__loginRow">
                <span className="recon-message-info__loginLabel">
                  Логин подтверждающего:
                </span>
                <span
                  className="recon-message-info__loginValue"
                  title={openedMessage.confirmerLogin}
                >
                  {openedMessage.confirmerLogin || ""}
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="recon-message-info__openBtn"
              onClick={handleOpenMessageContent}
            >
              Открыть содержание
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="recon-details">
      <div className="recon-details__topRow">
        <div className="recon-details__backWrap">
          <Button
            type="button"
            variant="secondary"
            className="recon-details__backBtn"
            onClick={() => navigate("/reconciliation")}
          >
            ← Назад
          </Button>
        </div>

        <div className="recon-details__stats">
          <StatCard type="total" title="Всего сообщений" value={stats.total} />
          <StatCard type="confirmed" title="Подтверждено" value={stats.confirmed} />
          <StatCard
            type="pending"
            title="Ожидает подтверждения"
            value={stats.pending}
          />
          <StatCard type="percent" value={stats.percent} />
        </div>

        <Button
          type="button"
          variant="secondary"
          className="recon-details__exportBtn"
          onClick={handleExport}
        >
          Экспортировать
        </Button>
      </div>

      <ReconciliationStagePanel
        companyName={reconciliationCompanyName}
        periodFrom={reconciliation.periodFrom}
        periodTo={reconciliation.periodTo}
        currentStageNumber={currentStageNumber}
        latestStageNumber={latestStageNumber}
        isViewingLatestStage={isViewingLatestStage}
        isLatestStageCompleted={isLatestStageCompleted}
        role={role}
        isLatestStageReady={allStageMessagesReviewed}
        isConfirmSelectionEnabled={hasSelectedReviewableMessages}
        onOpenPrevStage={() => setCurrentStageNumber((prev) => prev - 1)}
        onOpenNextStage={() => setCurrentStageNumber((prev) => prev + 1)}
        onCreateNewStage={handleCreateNewStage}
        onFinishStage={handleFinish}
        onSendMessage={handleSendMessage}
        onConfirmSelection={handleSlaveConfirm}
      />

      <div
        className={`recon-details__messagesCard ${isSlaveView ? "is-slave-view" : ""
          }`}
      >
        <div className="recon-details__tabs">
          <Button
            type="button"
            variant={activeTab === "messages" ? "primary" : "secondary"}
            className="recon-details__tabBtn"
            onClick={() => setActiveTab("messages")}
          >
            Сообщения
          </Button>

          <Button
            type="button"
            variant={activeTab === "confirmed" ? "primary" : "secondary"}
            className="recon-details__tabBtn"
            onClick={() => setActiveTab("confirmed")}
          >
            Подтверждённые
          </Button>

          <Button
            type="button"
            variant={activeTab === "pending" ? "primary" : "secondary"}
            className="recon-details__tabBtn"
            onClick={() => setActiveTab("pending")}
          >
            Ожидают подтверждения
          </Button>

          <Button
            type="button"
            variant={activeTab === "chat" ? "primary" : "secondary"}
            className="recon-details__tabBtn"
            onClick={() => setActiveTab("chat")}
          >
            Чат с компанией
          </Button>
        </div>

        {activeTab !== "chat" ? (
          <>
            <div className="recon-details__searchWrap">
              <div className="recon-details__searchFixed">
                <SearchInput value={search} onChange={setSearch} placeholder="Поиск" />
              </div>
            </div>

            <div className="recon-details__tableHead">
              <div className="recon-details__headCell">№</div>
              <div className="recon-details__headCell">Тема</div>
              <div className="recon-details__headCell">Дата отправки</div>
              <div className="recon-details__headCell">Дата подтверждения</div>

              {isSlaveView && (
                <div className="recon-details__headCell recon-details__headCell--selector">
                  <button
                    type="button"
                    className={`recon-details__selectBtn ${allVisibleMessagesReviewed
                      ? "recon-details__selectBtn--confirmed"
                      : allVisibleReviewableSelected
                        ? "recon-details__selectBtn--selected"
                        : ""
                      }`}
                    onClick={handleToggleSelectAll}
                    disabled={allVisibleMessagesReviewed || isSubmitting}
                    aria-label="Выбрать все сообщения"
                  />
                </div>
              )}
            </div>

            <div className="recon-details__tableBody">
              {visibleMessages.length > 0 ? (
                visibleMessages.map((message) => {
                  const isConfirmed = norm(message.status) === "подтверждено";
                  const isSelected = selectedMessageIds.includes(message.id);
                  const isReviewed = Boolean(message.stageReviewed);
                  const isStageGreen = isCurrentStageCompleted || isReconciliationCompleted;
                  const isGreenRow = isConfirmed || isReviewed || isStageGreen;

                  return (
                    <div
                      key={message.stageItemId || message.id}
                      className={`recon-details__tableRow ${canOpenStageMessage ? "recon-details__tableRow--clickable" : ""
                        } ${isStageGreen
                          ? "is-completed-stage"
                          : isGreenRow
                            ? "is-confirmed-row"
                            : isSelected
                              ? "is-selected-row"
                              : ""
                        }`}
                      role={canOpenStageMessage ? "button" : undefined}
                      tabIndex={canOpenStageMessage ? 0 : -1}
                      onClick={() => handleOpenMessageInfo(message.id)}
                      onKeyDown={(event) => {
                        if (!canOpenStageMessage) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenMessageInfo(message.id);
                        }
                      }}
                    >
                      <div
                        className="recon-details__cell recon-details__cellNumber"
                        title={displaySystemNumber(message.number)}
                      >
                        {displaySystemNumber(message.number)}
                      </div>

                      <div
                        className="recon-details__cell recon-details__cellSubject"
                        title={getMessageSubject(message.subject)}
                      >
                        {getMessageSubject(message.subject)}
                      </div>

                      <div
                        className={`recon-details__cell recon-details__cellDate ${message.isLateForPeriod ? "is-read-period" : ""
                          }`}
                      >
                        {message.sentAt}
                      </div>

                      <div className="recon-details__cell recon-details__cellConfirm">
                        {isConfirmed ? (
                          <span className="recon-details__confirmedDate">
                            {message.confirmedAt}
                          </span>
                        ) : (
                          <Chip
                            variant={getPendingChipVariant(message.status)}
                            className="recon-details__pendingChip"
                          >
                            {message.status}
                          </Chip>
                        )}
                      </div>

                      {isSlaveView && (
                        <div className="recon-details__cell recon-details__cellSelector">
                          <button
                            type="button"
                            className={`recon-details__selectBtn ${isReviewed
                              ? "recon-details__selectBtn--confirmed"
                              : isSelected
                                ? "recon-details__selectBtn--selected"
                                : ""
                              }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleMessageSelection(message.id);
                            }}
                            disabled={isReviewed || isSubmitting}
                            aria-label={
                              isReviewed
                                ? "Сообщение отмечено в этапе"
                                : "Выбрать сообщение"
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="recon-details__empty">Сообщения не найдены</div>
              )}
            </div>
          </>
        ) : (
          <div className="recon-details__chatArea">
            <div className="recon-details__chatShell">
              <div ref={chatListRef} className="recon-details__chatList">
                {visibleChatMessages.map((message) => {
                  const isMine = norm(message.userLogin) === currentUserLogin;

                  return (
                    <div
                      key={message.id}
                      className={`recon-details__chatRow ${isMine ? "is-mine" : ""}`}
                    >
                      <div
                        className={`recon-details__chatMessage ${isMine ? "is-mine" : ""}`}
                      >
                        <div className="recon-details__chatMeta">
                          <span className="recon-details__chatLogin">{message.userLogin}</span>
                          <span
                            className="recon-details__chatCompany"
                            title={message.companyName}
                          >
                            {message.companyName}
                          </span>
                        </div>

                        <div className="recon-details__chatBubble">
                          <div className="recon-details__chatText">{message.text}</div>
                          <div className="recon-details__chatTime">{message.sentAt}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {visibleChatMessages.length === 0 && (
                  <div className="recon-details__empty">Сообщений в чате пока нет</div>
                )}
              </div>

              {!isChatLocked && (
                <div className="recon-details__chatComposer">
                  <input
                    type="text"
                    value={chatText}
                    onChange={(event) => setChatText(event.target.value)}
                    onKeyDown={handleChatInputKeyDown}
                    className="recon-details__chatInput"
                    placeholder="Введите текст сообщения"
                  />

                  <Button
                    type="button"
                    variant="primary"
                    className="recon-details__chatSendBtn"
                    onClick={handleSendChatMessage}
                    disabled={!canSendChatMessage}
                  >
                    Отправить
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>


      {exportModalOpen && (
        <div className="recon-details__modalOverlay" onClick={handleCloseExportModal}>
          <div
            className="recon-details__modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="recon-details__modalTitle">Экспорт сверки</div>

            <div className="recon-details__modalBody">
              <div className="recon-details__modalMeta">
                <div className="recon-details__modalMetaRow">
                  <span className="recon-details__modalMetaLabel">Компания:</span>
                  <span className="recon-details__modalMetaValue">
                    {reconciliationCompanyName}
                  </span>
                </div>

                <div className="recon-details__modalMetaRow">
                  <span className="recon-details__modalMetaLabel">Период:</span>
                  <span className="recon-details__modalMetaPeriod">
                    {reconciliation.periodFrom} - {reconciliation.periodTo}
                  </span>
                </div>

                <div className="recon-details__modalMetaRow">
                  <span className="recon-details__modalMetaLabel">Текущий этап:</span>
                  <span className="recon-details__modalMetaValue">
                    {currentStageNumber}
                  </span>
                </div>
              </div>
            </div>

            <div className="recon-details__modalActions">
              <Button
                type="button"
                variant="primary"
                className="recon-details__modalBtn"
                onClick={handleExportCurrentStage}
                disabled={isExporting}
              >
                {isExporting ? "Подготовка файла..." : `Скачать этап ${currentStageNumber}`}
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="recon-details__modalBtn"
                onClick={handleExportAllStages}
                disabled={isExporting}
              >
                Скачать все этапы
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="recon-details__modalBtn"
                onClick={handleCloseExportModal}
                disabled={isExporting}
              >
                Отменить
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="recon-details__modalOverlay" onClick={handleCloseModal}>
          <div
            className="recon-details__modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="recon-details__modalTitle">
              {confirmModal.type === "newStage"
                ? `Завершить этап ${currentStageNumber} и начать новый?`
                : "Завершить сверку?"}
            </div>

            <div className="recon-details__modalBody">
              <div className="recon-details__modalMeta">
                <div className="recon-details__modalMetaRow">
                  <span className="recon-details__modalMetaLabel">Компания:</span>
                  <span className="recon-details__modalMetaValue">
                    {reconciliationCompanyName}
                  </span>
                </div>

                <div className="recon-details__modalMetaRow">
                  <span className="recon-details__modalMetaLabel">Период:</span>
                  <span className="recon-details__modalMetaPeriod">
                    {reconciliation.periodFrom} - {reconciliation.periodTo}
                  </span>
                </div>

                {confirmModal.type === "finish" && (
                  <div className="recon-details__modalMetaRow">
                    <span className="recon-details__modalMetaLabel">
                      Всего этапов сверки:
                    </span>
                    <span className="recon-details__modalMetaValue">
                      {latestStageNumber}
                    </span>
                  </div>
                )}

                {confirmModal.type === "newStage" && (
                  <div className="recon-details__modalMetaRow">
                    <span className="recon-details__modalMetaLabel">Этап:</span>
                    <span className="recon-details__modalMetaValue">
                      {currentStageNumber}
                    </span>
                  </div>
                )}
              </div>

              {confirmModal.type === "finish" && (
                <div className="recon-details__modalHint">
                  После завершения сверки создавать в ней новые этапы будет невозможно.
                </div>
              )}
            </div>

            <div className="recon-details__modalActions">
              <Button
                type="button"
                variant="secondary"
                className="recon-details__modalBtn"
                onClick={handleCloseModal}
                disabled={isSubmitting}
              >
                Отменить
              </Button>

              <Button
                type="button"
                variant="primary"
                className="recon-details__modalBtn"
                onClick={handleConfirmModal}
                disabled={isSubmitting}
              >
                Подтвердить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
