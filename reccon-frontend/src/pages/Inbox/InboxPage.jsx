import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { SearchInput } from "../../components/SearchInput/SearchInput";
import { Chip } from "../../components/Chip/Chip";
import { Button } from "../../components/Button/Button";
import { Input } from "../../components/Input/Input";
import MessagesFilterPanel from "../../components/MessagesFilterPanel/MessagesFilterPanel";
import { messagesApi } from "../../api/messagesApi";
import "./InboxPage.css";

const norm = (value) => String(value || "").trim().toLowerCase();

function parseDDMMYYYY(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || ""));
  if (!match) return null;

  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);

  const date = new Date(yyyy, mm - 1, dd);
  if (
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  ) {
    return null;
  }

  return date;
}

function parseDateTime(value) {
  if (!value) return 0;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.getTime();
  }

  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(
    String(value || "")
  );

  if (!match) return 0;

  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0)
  ).getTime();
}

function getMessageGroup(status) {
  return norm(status) === "подтверждено" ? 1 : 0;
}

function getMessageSortTime(message) {
  const isConfirmed = getMessageGroup(message.status) === 1;

  if (isConfirmed) {
    return parseDateTime(
      message.statusChangedAt ||
        message.confirmedAt ||
        message.updatedAt ||
        message.sentAt ||
        message.date
    );
  }

  return parseDateTime(message.sentAt || message.date);
}

function sortMessages(list) {
  return [...list].sort((a, b) => {
    const groupDiff = getMessageGroup(a.status) - getMessageGroup(b.status);
    if (groupDiff !== 0) return groupDiff;

    return getMessageSortTime(b) - getMessageSortTime(a);
  });
}

function shortFileName(name, maxBase = 18) {
  if (!name) return "";

  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return name.length > maxBase ? `${name.slice(0, maxBase)}…` : name;
  }

  const base = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);

  if (base.length <= maxBase) return `${base}${ext}`;
  return `${base.slice(0, maxBase)}…${ext}`;
}

function openLinkHref(href) {
  if (!href) return;

  if (href.startsWith("mailto:") || href.startsWith("tel:")) {
    window.location.href = href;
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

function openAttachmentFile(attachment) {
  if (!attachment?.url) return;
  window.open(attachment.url, "_blank", "noopener,noreferrer");
}

function findClosestLinkNode(node, container) {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  while (current && current !== container) {
    if (current.tagName === "A") return current;
    current = current.parentElement;
  }

  return null;
}

function isIncomingNumberFormat(value) {
  return /^I-\d{6}$/.test(String(value || "").trim().toUpperCase());
}

function getMessagePreview(text, maxLength = 110) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "Без текста";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function getMessageSubject(subject) {
  const value = String(subject || "").trim();
  return value || "Без темы";
}

function validateIncomingNumber(value, messages, currentMessageId) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized) {
    return "Необходимо ввести номер.";
  }

  if (!isIncomingNumberFormat(normalized)) {
    return "Формат номера: I-000001";
  }

  const isTaken = messages.some(
    (message) =>
      message.id !== currentMessageId &&
      norm(message.status) === "подтверждено" &&
      String(message.number || "").trim().toUpperCase() === normalized
  );

  if (isTaken) {
    return "Номер уже занят.";
  }

  return "";
}

const chipVariantByStatus = (status) => {
  const normalized = norm(status);
  if (normalized === "подтверждено") return "confirmed";
  if (normalized === "прочитано") return "read";
  return "pending";
};

function sameText(a, b) {
  return norm(a) === norm(b);
}

function findMessageForOpen(messages, ref) {
  if (!ref) return null;

  const refId = String(ref.id || "").trim();
  const refNumber = String(ref.number || "").trim().toUpperCase();
  const refOutgoingNumber = String(ref.outgoingNumber || "")
    .trim()
    .toUpperCase();
  const refIncomingNumber = String(ref.incomingNumber || "")
    .trim()
    .toUpperCase();
  const refSubject = String(ref.subject || "").trim();
  const refSentAt = String(ref.sentAt || "").trim();
  const refSenderCompany = String(ref.senderCompany || "").trim();
  const refRecipientCompany = String(ref.recipientCompany || "").trim();

  return (
    messages.find((message) => String(message.id || "").trim() === refId) ||
    messages.find(
      (message) =>
        refNumber &&
        String(message.number || "").trim().toUpperCase() === refNumber
    ) ||
    messages.find(
      (message) =>
        refIncomingNumber &&
        String(message.incomingNumber || "").trim().toUpperCase() ===
          refIncomingNumber
    ) ||
    messages.find(
      (message) =>
        refOutgoingNumber &&
        String(message.outgoingNumber || "").trim().toUpperCase() ===
          refOutgoingNumber
    ) ||
    messages.find(
      (message) =>
        sameText(message.subject, refSubject) &&
        String(message.sentAt || "").trim() === refSentAt &&
        sameText(message.senderCompany || message.company, refSenderCompany) &&
        sameText(message.recipientCompany, refRecipientCompany)
    ) ||
    null
  );
}

export default function InboxPage() {
  const { user } = useOutletContext() || {};
  const location = useLocation();
const navigate = useNavigate();
const handledDashboardOpenRef = useRef(null);

const directOpenRef = location.state?.openMessageRef || null;
const isDirectOpenFromReconciliation = Boolean(
  location.state?.openedFromReconciliation && directOpenRef
);

const [messages, setMessages] = useState([]);
const [openedMessageId, setOpenedMessageId] = useState(() => directOpenRef?.id ?? null);
const [isLoading, setIsLoading] = useState(true);
const [isResolvingDirectOpen, setIsResolvingDirectOpen] = useState(
  Boolean(location.state?.openedFromReconciliation && location.state?.openMessageRef)
);

  const [filtersDraft, setFiltersDraft] = useState({
    company: "Все",
    dateFrom: "29.12.2025",
    dateTo: "29.12.2026",
    statuses: new Set(),
  });
  const [filtersApplied, setFiltersApplied] = useState(filtersDraft);
  const [search, setSearch] = useState("");

  const [confirmModalMessageId, setConfirmModalMessageId] = useState(null);
  const [confirmNumber, setConfirmNumber] = useState("");
  const [confirmNumberError, setConfirmNumberError] = useState("");

  const companies = useMemo(() => {
    return [...new Set(messages.map((message) => message.company).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "ru")
    );
  }, [messages]);

  const replaceMessage = (updatedMessage) => {
    if (!updatedMessage?.id) return;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === updatedMessage.id ? { ...message, ...updatedMessage } : message
      )
    );
  };

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      try {
        setIsLoading(true);
        const data = await messagesApi.listInbox();
        if (cancelled) return;
        setMessages(Array.isArray(data) ? data : []);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить входящие сообщения", error);
        setMessages([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadMessages();

    const handleMessagesChanged = () => {
      loadMessages();
    };

    window.addEventListener(
      messagesApi.events.MESSAGE_CHANGED_EVENT,
      handleMessagesChanged
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        messagesApi.events.MESSAGE_CHANGED_EVENT,
        handleMessagesChanged
      );
    };
  }, [user?.companyName]);

  const apply = () => setFiltersApplied(filtersDraft);

  const filtered = useMemo(() => {
    const query = norm(search);
    const company = filtersApplied.company || "Все";
    const statuses = filtersApplied.statuses;

    const fromDate = parseDDMMYYYY(filtersApplied.dateFrom);
    const toDate = parseDDMMYYYY(filtersApplied.dateTo);

    const result = messages.filter((message) => {
      if (company !== "Все" && norm(message.company) !== norm(company)) return false;

      const messageDate = parseDDMMYYYY(message.date);
      if (fromDate && messageDate && messageDate < fromDate) return false;
      if (toDate && messageDate && messageDate > toDate) return false;

      if (statuses.size > 0) {
        const status = norm(message.status);
        const matchesStatus =
          (statuses.has("confirmed") && status === "подтверждено") ||
          (statuses.has("read") && status === "прочитано") ||
          (statuses.has("unconfirmed") && status === "ожидает подтверждения");

        if (!matchesStatus) return false;
      }

      if (query) {
        const haystack = [
          message.company,
          message.subject,
          message.text,
          message.number || "",
        ]
          .map(norm)
          .join(" ");

        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    return sortMessages(result);
  }, [filtersApplied, messages, search]);

  const openedMessage = useMemo(
    () => messages.find((message) => message.id === openedMessageId) || null,
    [messages, openedMessageId]
  );

  const confirmModalMessage = useMemo(
    () => messages.find((message) => message.id === confirmModalMessageId) || null,
    [confirmModalMessageId, messages]
  );

  const showMasterPanel = user?.companyType === "master";

  const openMessage = async (message) => {
    if (!message) return;

    setOpenedMessageId(message.id);

    if (norm(message.status) === "ожидает подтверждения") {
      try {
        const updatedMessage = await messagesApi.openInboxMessage(message.id);
        replaceMessage(updatedMessage);
      } catch (error) {
        console.error("Не удалось отметить письмо как прочитанное", error);
      }
    }
  };

useEffect(() => {
  const targetRef = location.state?.openMessageRef;

  if (!targetRef || !location.state?.openedFromReconciliation) {
    setIsResolvingDirectOpen(false);
    return;
  }

  if (isLoading) return;

  const handledKey = JSON.stringify(targetRef);

  if (handledDashboardOpenRef.current === handledKey) {
    setIsResolvingDirectOpen(false);
    return;
  }

  const targetMessage = findMessageForOpen(messages, targetRef);

  if (!targetMessage) {
    setIsResolvingDirectOpen(false);
    return;
  }

  handledDashboardOpenRef.current = handledKey;
  setIsResolvingDirectOpen(false);
  openMessage(targetMessage);
}, [location.state, messages, isLoading]);

  const openConfirmModal = async (message) => {
    if (!message) return;
    if (norm(message.status) === "подтверждено") return;

    setConfirmModalMessageId(message.id);
    setConfirmNumberError("");

    try {
      const nextNumber = await messagesApi.getNextIncomingNumber(message.id);
      setConfirmNumber(nextNumber || "");
    } catch (error) {
      console.error("Не удалось получить следующий входящий номер", error);
      setConfirmNumber("");
    }
  };

  const closeConfirmModal = () => {
    setConfirmModalMessageId(null);
    setConfirmNumber("");
    setConfirmNumberError("");
  };

  const handleConfirmSubmit = async () => {
    if (!confirmModalMessage) return;

    const error = validateIncomingNumber(confirmNumber, messages, confirmModalMessage.id);
    if (error) {
      setConfirmNumberError(error);
      return;
    }

    try {
      const updatedMessage = await messagesApi.confirmInboxMessage(
        confirmModalMessage.id,
        String(confirmNumber || "").trim().toUpperCase()
      );
      replaceMessage(updatedMessage);
      closeConfirmModal();
    } catch (requestError) {
      console.error("Не удалось подтвердить письмо", requestError);
      setConfirmNumberError(requestError.message || "Не удалось подтвердить письмо.");
    }
  };

  const handleAttachmentOpen = (attachment) => {
    openAttachmentFile(attachment);
  };

  const handleBackFromOpenedMessage = () => {
    if (
      location.state?.openedFromReconciliation &&
      location.state?.returnToReconciliationId
    ) {
      navigate(`/reconciliation/${location.state.returnToReconciliationId}`, {
        state: {
          openReconStageNumber: location.state.returnToReconciliationStageNumber,
          openReconMessageId: location.state.returnToReconciliationMessageId,
        },
      });
      return;
    }

    setOpenedMessageId(null);
  };

  if (isResolvingDirectOpen) {
  return (
    <div className="inbox">
      <div className="inbox-empty">Загрузка сообщения...</div>
    </div>
  );
}

  if (openedMessage) {
    const isConfirmed = norm(openedMessage.status) === "подтверждено";

    return (
      <>
        <div className="inbox-open">
          <div className="inbox-open__top">
            <Button
              type="button"
              variant="secondary"
              className="inbox-open__backBtn"
              onClick={handleBackFromOpenedMessage}
            >
              ← Назад
            </Button>

            <Button
              type="button"
              variant="primary"
              className={`inbox-open__confirmBtn ${isConfirmed ? "is-confirmed" : ""}`}
              onClick={() => openConfirmModal(openedMessage)}
              disabled={isConfirmed}
            >
              {isConfirmed ? "Подтверждено" : "Подтвердить"}
            </Button>
          </div>

          <div
            className={`inbox-open__companyCard ${isConfirmed ? "is-confirmed" : ""}`}
          >
            <div className="inbox-open__companyName" title={openedMessage.company}>
              {openedMessage.company}
            </div>

            {isConfirmed && openedMessage.number && (
              <div className="inbox-open__companyNumber">№ {openedMessage.number}</div>
            )}
          </div>

          <div
            className={`inbox-open__messageCard ${isConfirmed ? "is-confirmed" : ""}`}
          >
            <div className="inbox-open__header">
              <div
                className="inbox-open__subject"
                title={getMessageSubject(openedMessage.subject)}
              >
                {getMessageSubject(openedMessage.subject)}
              </div>

              <div className="inbox-open__date">{openedMessage.date}</div>
            </div>

            <div className="inbox-open__body">
              <div
                className="inbox-open__text"
                onClick={(event) => {
                  const linkNode = findClosestLinkNode(event.target, event.currentTarget);
                  if (!linkNode?.href) return;

                  event.preventDefault();
                  openLinkHref(linkNode.href);
                }}
              >
                {openedMessage.html ? (
                  <div dangerouslySetInnerHTML={{ __html: openedMessage.html }} />
                ) : (
                  openedMessage.text
                )}
              </div>

              {openedMessage.attachments?.length > 0 && (
                <div className="inbox-open__attachments">
                  {openedMessage.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      className="inbox-open__attachment"
                      title={attachment.name}
                      onClick={() => handleAttachmentOpen(attachment)}
                    >
                      <span className="inbox-open__attachmentName">
                        {shortFileName(attachment.name, 18)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {confirmModalMessage && (
          <div className="inbox-confirmModal__overlay" onClick={closeConfirmModal}>
            <div className="inbox-confirmModal" onClick={(event) => event.stopPropagation()}>
              <div className="inbox-confirmModal__title">Подтверждение</div>

              <div className="inbox-confirmModal__messageCard">
                <div className="inbox-confirmModal__messageTop">
                  <div
                    className="inbox-confirmModal__company"
                    title={confirmModalMessage.company}
                  >
                    {confirmModalMessage.company}
                  </div>

                  <div className="inbox-confirmModal__date">{confirmModalMessage.date}</div>
                </div>

                <div
                  className="inbox-confirmModal__subject"
                  title={getMessageSubject(confirmModalMessage.subject)}
                >
                  {getMessageSubject(confirmModalMessage.subject)}
                </div>

                <div className="inbox-confirmModal__text" title={confirmModalMessage.text}>
                  {getMessagePreview(confirmModalMessage.text)}
                </div>
              </div>

              <div className="inbox-confirmModal__field">
                <div className="inbox-confirmModal__label">
                  Введите номер для подтверждения сообщения
                </div>

                <div className="inbox-confirmModal__fieldRow">
                  <div className="inbox-confirmModal__inputWrap">
                    <Input
                      state={confirmNumberError ? "error" : "focus"}
                      value={confirmNumber}
                      onChange={(event) => {
                        const nextValue = String(event.target.value || "")
                          .toUpperCase()
                          .replace(/\s+/g, "");
                        setConfirmNumber(nextValue);

                        if (confirmNumberError) {
                          setConfirmNumberError("");
                        }
                      }}
                      helperText={confirmNumberError || " "}
                    />
                  </div>

                  <div className="inbox-confirmModal__hint">Формат номера: I-000001</div>
                </div>
              </div>

              <div className="inbox-confirmModal__footer">
                <Button type="button" variant="secondary" onClick={closeConfirmModal}>
                  Отменить
                </Button>

                <Button type="button" variant="primary" onClick={handleConfirmSubmit}>
                  Подтвердить
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="inbox">
      {showMasterPanel && (
        <MessagesFilterPanel
          companies={companies}
          value={filtersDraft}
          onChange={setFiltersDraft}
          onApply={apply}
        />
      )}

      <div className="inbox-searchWrap">
        <SearchInput value={search} onChange={setSearch} />
      </div>

      <div className={`inbox-list ${filtered.length === 0 ? "is-empty" : ""}`}>
        {isLoading ? (
          <div className="inbox-empty">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="inbox-empty">Список пуст</div>
        ) : (
          filtered.map((message) => {
            const confirmed = norm(message.status) === "подтверждено";

            return (
              <div
                key={message.id}
                className={`inbox-row ${confirmed ? "is-confirmed" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => openMessage(message)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openMessage(message);
                  }
                }}
              >
                <div className="inbox-left">
                  <div className="inbox-company" title={message.company}>
                    {message.company}
                  </div>

                  <div className="inbox-subject" title={getMessageSubject(message.subject)}>
                    {getMessageSubject(message.subject)}
                  </div>

                  <div className="inbox-text" title={message.text}>
                    {message.text}
                  </div>
                </div>

                <div className="inbox-right">
                  <div className="inbox-rightTop">
                    <Chip variant={chipVariantByStatus(message.status)}>
                      {message.status}
                    </Chip>

                    <div className="inbox-date">{message.date}</div>
                  </div>

                  <div className={`inbox-number ${confirmed ? "" : "is-empty"}`}>
                    {confirmed && message.number ? `№ ${message.number}` : " "}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
