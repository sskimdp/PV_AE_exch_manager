import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import "./DashboardPage.css";
import { Chip } from "../../components/Chip/Chip";
import { tokenStorage } from "../../api/tokenStorage";
import { messagesApi } from "../../api/messagesApi";

const MESSAGE_CHANGED_EVENT =
  messagesApi?.events?.MESSAGE_CHANGED_EVENT || "reccon:messages-changed";

const norm = (value) => String(value || "").trim().toLowerCase();

const stripHtml = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getPreview = (item) => {
  const text = String(item?.text || item?.body || "").trim();
  if (text) return text;

  const htmlText = stripHtml(item?.html || item?.body_html || "");
  if (htmlText) return htmlText;

  return "";
};

const getCompany = (item, isMaster) => {
  if (item?.company) return item.company;
  if (isMaster) return item?.senderCompany || "";
  return item?.recipientCompany || "";
};

const normalizeDashboardItem = (item, isMaster) => ({
  id: item?.id,
  company: getCompany(item, isMaster),
  subject: String(item?.subject || "").trim() || "Без темы",
  preview: getPreview(item),
  date: item?.date || "",
  sentAt: item?.sentAt || "",
  status: item?.status || "",
  statusCode: item?.statusCode || "",
  number: item?.number || "",
  outgoingNumber: item?.outgoingNumber || "",
  incomingNumber: item?.incomingNumber || "",
  senderCompany: item?.senderCompany || "",
  recipientCompany: item?.recipientCompany || "",
  text: item?.text || "",
  html: item?.html || "",
  attachments: Array.isArray(item?.attachments) ? item.attachments : [],
});

const extractList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

async function requestJson(url) {
  const accessToken = tokenStorage.getAccessToken();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    let errorMessage = "Не удалось загрузить данные для дашборда.";
    try {
      const errorData = await response.json();
      errorMessage =
        errorData?.detail ||
        errorData?.message ||
        errorMessage;
    } catch {
      // ignore json parse errors
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export default function DashboardPage() {
  const { user, counts } = useOutletContext();
  const navigate = useNavigate();

  const isMaster = norm(user?.companyType) === "master";

  const [visibleMessages, setVisibleMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const widgetCount = useMemo(() => {
    if (isMaster) {
      return Number(counts?.inboxUnconfirmed ?? counts?.incoming ?? 0);
    }
    return Number(counts?.draftsCount ?? counts?.drafts ?? 0);
  }, [counts, isMaster]);

  const widgetChipText = isMaster ? "Ожидает подтверждения" : "Черновик";
  const widgetChipVariant = isMaster ? "pending" : "draft";

  const loadDashboardItems = useCallback(async () => {
    if (!user?.id) {
      setVisibleMessages([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const url = isMaster
        ? "/api/messages/inbox/?status_group=unconfirmed"
        : "/api/messages/drafts/";

      const payload = await requestJson(url);
      const items = extractList(payload)
        .slice(0, 2)
        .map((item) => normalizeDashboardItem(item, isMaster));

      setVisibleMessages(items);
    } catch (error) {
      console.error("Не удалось загрузить сообщения для дашборда", error);
      setVisibleMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [isMaster, user?.id]);

  useEffect(() => {
    loadDashboardItems();
  }, [loadDashboardItems]);

  useEffect(() => {
    const handleMessagesChanged = () => {
      loadDashboardItems();
    };

    const handleWindowFocus = () => {
      loadDashboardItems();
    };

    window.addEventListener(MESSAGE_CHANGED_EVENT, handleMessagesChanged);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener(MESSAGE_CHANGED_EVENT, handleMessagesChanged);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [loadDashboardItems]);

  const handleWidgetItemClick = (item) => {
    if (!item?.id) return;

    if (isMaster) {
      navigate("/inbox", {
        state: {
          openMessageRef: {
            id: item.id,
            number: item.number || "",
            outgoingNumber: item.outgoingNumber || "",
            incomingNumber: item.incomingNumber || "",
            subject: item.subject || "",
            sentAt: item.sentAt || "",
            senderCompany: item.senderCompany || "",
            recipientCompany: item.recipientCompany || "",
            company: item.company || "",
            text: item.text || "",
            html: item.html || "",
            date: item.date || "",
            status: item.status || "",
            statusCode: item.statusCode || "",
            attachments: item.attachments || [],
          },
          fromDashboard: true,
        },
      });
      return;
    }

    navigate("/drafts", {
      state: { openDraftId: item.id, fromDashboard: true },
    });
  };

  return (
    <div className="dashboard">
      <div className="dashboard-content">
        <h1 className="dashboard-title">Добро пожаловать!</h1>

        <div className="dashboard-widget">
          <div className="dashboard-widget__top">
            <Chip variant={widgetChipVariant}>{widgetChipText}</Chip>
            <span className="dashboard-widget__count">{widgetCount}</span>
          </div>

          {isLoading ? (
            <div className="dashboard-widget__empty">Загрузка...</div>
          ) : widgetCount === 0 || visibleMessages.length === 0 ? (
            <div className="dashboard-widget__empty">Список пуст</div>
          ) : (
            <div className="dashboard-list">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className="dashboard-msg"
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={() => handleWidgetItemClick(message)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleWidgetItemClick(message);
                    }
                  }}
                >
                  <div className="dashboard-msg__left">
                    <div className="dashboard-msg__company">{message.company}</div>
                    <div className="dashboard-msg__subject">{message.subject}</div>
                    <div
                      className="dashboard-msg__preview"
                      title={message.preview}
                    >
                      {message.preview || "Без текста"}
                    </div>
                  </div>

                  <div className="dashboard-msg__right">
                    <div className="dashboard-msg__date">{message.date}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}