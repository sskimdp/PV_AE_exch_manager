import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { SearchInput } from "../../components/SearchInput/SearchInput";
import { Chip } from "../../components/Chip/Chip";
import { Button } from "../../components/Button/Button";
import MessagesFilterPanel from "../../components/MessagesFilterPanel/MessagesFilterPanel";
import { messagesApi } from "../../api/messagesApi";
import "../Inbox/InboxPage.css";

const norm = (s) => String(s || "").trim().toLowerCase();

function parseDDMMYYYY(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || ""));
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  const d = new Date(yyyy, mm - 1, dd);
  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd
  ) {
    return null;
  }

  return d;
}

function parseDateTime(value) {
  if (!value) return 0;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.getTime();
  }

  const ddmmyyyy = parseDDMMYYYY(value);
  return ddmmyyyy ? ddmmyyyy.getTime() : 0;
}

function getMessageGroup(status) {
  return norm(status) === "подтверждено" ? 1 : 0;
}

function getMessageSortTime(message) {
  const isConfirmed = getMessageGroup(message.status) === 1;

  if (isConfirmed) {
    return parseDateTime(
      message.statusChangedAt || message.updatedAt || message.sentAt || message.date
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

function getMessageSubject(subject) {
  const value = String(subject || "").trim();
  return value || "Без темы";
}

const chipVariantByStatus = (status) => {
  const s = norm(status);
  if (s === "подтверждено") return "confirmed";
  if (s === "прочитано") return "read";
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
        sameText(message.senderCompany, refSenderCompany) &&
        sameText(message.recipientCompany || message.company, refRecipientCompany)
    ) ||
    null
  );
}

export default function SentPage() {
  const { user } = useOutletContext() || {};
  const location = useLocation();
const navigate = useNavigate();
const handledOpenRef = useRef(null);

const directOpenRef = location.state?.openMessageRef || null;
const isDirectOpenFromReconciliation = Boolean(
  location.state?.openedFromReconciliation && directOpenRef
);

const [messages, setMessages] = useState([]);
const [filtersDraft, setFiltersDraft] = useState({
  dateFrom: "29.12.2025",
  dateTo: "29.12.2026",
  statuses: new Set(),
});
const [filtersApplied, setFiltersApplied] = useState(filtersDraft);
const [search, setSearch] = useState("");
const [openedMessageId, setOpenedMessageId] = useState(() => directOpenRef?.id ?? null);
const [isLoading, setIsLoading] = useState(true);
const [isResolvingDirectOpen, setIsResolvingDirectOpen] = useState(
  Boolean(location.state?.openedFromReconciliation && location.state?.openMessageRef)
);

  const apply = () => setFiltersApplied(filtersDraft);

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      try {
        setIsLoading(true);
        const data = await messagesApi.listSent();
        if (cancelled) return;
        setMessages(Array.isArray(data) ? data : []);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить отправленные сообщения", error);
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

useEffect(() => {
  const targetRef = location.state?.openMessageRef;

  if (!targetRef || !location.state?.openedFromReconciliation) {
    setIsResolvingDirectOpen(false);
    return;
  }

  if (isLoading) return;

  const handledKey = JSON.stringify(targetRef);

  if (handledOpenRef.current === handledKey) {
    setIsResolvingDirectOpen(false);
    return;
  }

  const targetMessage = findMessageForOpen(messages, targetRef);

  if (!targetMessage) {
    setIsResolvingDirectOpen(false);
    return;
  }

  handledOpenRef.current = handledKey;
  setOpenedMessageId(targetMessage.id);
  setIsResolvingDirectOpen(false);
}, [location.state, messages, isLoading]);

  const filtered = useMemo(() => {
    const q = norm(search);
    const st = filtersApplied.statuses;

    const fromD = parseDDMMYYYY(filtersApplied.dateFrom);
    const toD = parseDDMMYYYY(filtersApplied.dateTo);

    const result = messages.filter((m) => {
      const md = parseDDMMYYYY(m.date);
      if (fromD && md && md < fromD) return false;
      if (toD && md && md > toD) return false;

      if (st.size > 0) {
        const s = norm(m.status);
        const ok =
          (st.has("confirmed") && s === "подтверждено") ||
          (st.has("read") && s === "прочитано") ||
          (st.has("unconfirmed") && s === "ожидает подтверждения");

        if (!ok) return false;
      }

      if (q) {
        const hay = [m.company, m.subject, m.text].map(norm).join(" ");
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    return sortMessages(result);
  }, [messages, search, filtersApplied]);

  const openedMessage = useMemo(() => {
    return messages.find((message) => message.id === openedMessageId) || null;
  }, [messages, openedMessageId]);

  const showSlavePanel = user?.companyType === "slave";
  const isOpenedConfirmed = norm(openedMessage?.status) === "подтверждено";

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
    <div className="inbox sent">
      <div className="inbox-empty">Загрузка сообщения...</div>
    </div>
  );
}

  if (openedMessage) {

    return (
      <div className="sent-open">
        <div className="sent-open__top">
          <Button
            type="button"
            variant="secondary"
            className="sent-open__backBtn"
            onClick={handleBackFromOpenedMessage}
          >
            ← Назад
          </Button>

          <Chip
            variant={chipVariantByStatus(openedMessage.status)}
            className={`sent-open__status ${
              isOpenedConfirmed ? "sent-open__status--confirmed" : ""
            }`}
          >
            {openedMessage.status}
          </Chip>
        </div>

        <div className={`sent-open__card ${isOpenedConfirmed ? "is-confirmed" : ""}`}>
          <div className="sent-open__header">
            <div
              className="sent-open__subject"
              title={getMessageSubject(openedMessage.subject)}
            >
              {getMessageSubject(openedMessage.subject)}
            </div>

            <div className="sent-open__date">{openedMessage.date}</div>
          </div>

          <div className="sent-open__body">
            <div
              className="sent-open__text"
              onClick={(e) => {
                const linkNode = findClosestLinkNode(e.target, e.currentTarget);
                if (!linkNode?.href) return;

                e.preventDefault();
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
              <div className="sent-open__attachments">
                {openedMessage.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="sent-open__attachment"
                    title={attachment.name}
                    onClick={() => handleAttachmentOpen(attachment)}
                  >
                    <span className="sent-open__attachmentName">
                      {shortFileName(attachment.name, 18)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox sent">
      {showSlavePanel && (
        <MessagesFilterPanel
          value={filtersDraft}
          onChange={setFiltersDraft}
          onApply={apply}
          hideCompany={true}
        />
      )}

      <div className="inbox-searchWrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск" />
      </div>

      <div className={`inbox-list ${filtered.length === 0 ? "is-empty" : ""}`}>
        {isLoading ? (
          <div className="inbox-empty">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="inbox-empty">Список пуст</div>
        ) : (
          filtered.map((m) => (
            <div
              key={m.id}
              className={`inbox-row ${
                norm(m.status) === "подтверждено" ? "is-confirmed" : ""
              }`}
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => setOpenedMessageId(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenedMessageId(m.id);
                }
              }}
            >
              <div className="inbox-left">
                <div className="inbox-company" title={m.company}>
                  {m.company}
                </div>

                <div className="inbox-subject" title={getMessageSubject(m.subject)}>
                  {getMessageSubject(m.subject)}
                </div>

                <div className="inbox-text" title={m.text}>
                  {m.text}
                </div>
              </div>

              <div className="inbox-right sent-right">
                <div className="inbox-rightTop">
                  <Chip variant={chipVariantByStatus(m.status)}>{m.status}</Chip>

                  <div className="inbox-date">{m.date}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
