
import { request } from "./http";

const RECONCILIATIONS_CHANGED_EVENT = "reccon:reconciliations-changed";

const norm = (value) => String(value || "").trim().toLowerCase();

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDisplayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatDisplayDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return `${formatDisplayDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapReconciliationStatus(status) {
  const normalized = norm(status);
  if (normalized === "finished" || normalized === "completed" || normalized === "завершена") {
    return "Завершена";
  }
  return "Активна";
}

function mapMessageStatus(status) {
  const normalized = norm(status);
  if (normalized === "confirmed" || normalized === "подтверждено") {
    return "Подтверждено";
  }
  if (normalized === "read" || normalized === "прочитано") {
    return "Прочитано";
  }
  if (normalized === "pending" || normalized === "unconfirmed" || normalized === "ожидает подтверждения") {
    return "Ожидает подтверждения";
  }
  return status || "Ожидает подтверждения";
}

function toComparableDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(String(value))) {
    const [day, month, year] = String(value).split(".");
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOutsidePeriod(value, periodStart, periodEnd) {
  const date = toComparableDate(value);
  const start = toComparableDate(periodStart);
  const end = toComparableDate(periodEnd);

  if (!date || !start || !end) return false;

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  return dateOnly < startOnly || dateOnly > endOnly;
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function mapCompany(rawCompany = {}) {
  return {
    id: rawCompany.id,
    name: rawCompany.name || rawCompany.company_name || "",
    companyType: rawCompany.company_type || rawCompany.companyType || "",
    status: rawCompany.status || rawCompany.state || "",
    isActive: !rawCompany.status || ["active", "активна", "активен"].includes(norm(rawCompany.status)),
  };
}

function pickMessageId(rawItem = {}) {
  if (rawItem.message_id) return rawItem.message_id;
  if (typeof rawItem.message === "number") return rawItem.message;
  if (rawItem.message?.id) return rawItem.message.id;
  return rawItem.id;
}

function pickMessageField(rawItem = {}, key, fallback = "") {
  if (rawItem[key] != null) return rawItem[key];
  if (rawItem.message && rawItem.message[key] != null) return rawItem.message[key];
  return fallback;
}

function mapStageItem(rawItem = {}, reconciliation = {}) {
  const messageId = pickMessageId(rawItem);
  const sentAtRaw =
    rawItem.sent_at ||
    rawItem.sent_at_snapshot ||
    pickMessageField(rawItem, "sent_at") ||
    pickMessageField(rawItem, "created_at") ||
    "";
  const readAtRaw =
    rawItem.read_at ||
    pickMessageField(rawItem, "read_at") ||
    "";
  const confirmedAtRaw =
    rawItem.confirmed_at ||
    rawItem.confirmed_at_snapshot ||
    pickMessageField(rawItem, "confirmed_at") ||
    "";

  const outgoingNumber =
    rawItem.outgoing_number ||
    pickMessageField(rawItem, "outgoing_number") ||
    rawItem.message_number ||
    "";
  const incomingNumber =
    rawItem.incoming_number ||
    rawItem.receiver_number ||
    pickMessageField(rawItem, "incoming_number") ||
    pickMessageField(rawItem, "receiver_number") ||
    "";
  const number =
    rawItem.number ||
    outgoingNumber ||
    incomingNumber ||
    (messageId != null ? String(messageId) : "");

  return {
    id: messageId,
    stageItemId: rawItem.id,
    number,
    outgoingNumber,
    incomingNumber,
    subject:
      rawItem.subject ||
      rawItem.subject_snapshot ||
      pickMessageField(rawItem, "subject") ||
      "",
    status: mapMessageStatus(
      rawItem.status ||
        rawItem.status_snapshot ||
        pickMessageField(rawItem, "status") ||
        ""
    ),
    sentAt: formatDisplayDateTime(sentAtRaw),
    sentAtRaw,
    readAt: formatDisplayDateTime(readAtRaw),
    readAtRaw,
    confirmedAt: formatDisplayDateTime(confirmedAtRaw),
    confirmedAtRaw,
    senderCompany:
      rawItem.sender_company_name ||
      pickMessageField(rawItem, "sender_company_name") ||
      pickMessageField(rawItem, "sender_company")?.name ||
      rawItem.sender_company?.name ||
      "",
    recipientCompany:
      rawItem.recipient_company_name ||
      rawItem.receiver_company_name ||
      pickMessageField(rawItem, "recipient_company_name") ||
      pickMessageField(rawItem, "receiver_company_name") ||
      pickMessageField(rawItem, "receiver_company")?.name ||
      pickMessageField(rawItem, "recipient_company")?.name ||
      rawItem.receiver_company?.name ||
      rawItem.recipient_company?.name ||
      "",
senderLogin:
  rawItem.sender_login ||
  rawItem.sender_username ||
  rawItem.author_username ||
  rawItem.created_by_username ||
  rawItem.sender_user?.username ||
  rawItem.author?.username ||
  rawItem.created_by?.username ||
  pickMessageField(rawItem, "sender_login") ||
  pickMessageField(rawItem, "sender_username") ||
  pickMessageField(rawItem, "author_username") ||
  pickMessageField(rawItem, "created_by_username") ||
  pickMessageField(rawItem, "sender_user")?.username ||
  pickMessageField(rawItem, "author")?.username ||
  pickMessageField(rawItem, "created_by")?.username ||
  "",

confirmerLogin:
  rawItem.confirmer_login ||
  rawItem.confirmer_username ||
  rawItem.confirmed_by_username ||
  rawItem.confirmed_by_user?.username ||
  rawItem.confirmed_by?.username ||
  pickMessageField(rawItem, "confirmer_login") ||
  pickMessageField(rawItem, "confirmer_username") ||
  pickMessageField(rawItem, "confirmed_by_username") ||
  pickMessageField(rawItem, "confirmed_by_user")?.username ||
  pickMessageField(rawItem, "confirmed_by")?.username ||
  "",
    stageReviewed: Boolean(
      rawItem.stage_reviewed ??
        rawItem.confirmed_by_slave ??
        rawItem.reviewed_in_stage ??
        false
    ),
    availableForSlaveConfirmation: Boolean(
      rawItem.available_for_slave_confirmation ??
        !rawItem.confirmed_by_slave
    ),
    isLateForPeriod: isOutsidePeriod(
      sentAtRaw,
      reconciliation.periodStart || reconciliation.period_start,
      reconciliation.periodEnd || reconciliation.period_end
    ),
  };
}

function mapStage(rawStage = {}, reconciliation = {}) {
  const messages = extractArray(rawStage.items || rawStage.messages).map((item) =>
    mapStageItem(item, reconciliation)
  );
  const number = Number(rawStage.stage_number || rawStage.number || rawStage.stage || 1);
  const status = mapReconciliationStatus(rawStage.status);

  return {
    id: rawStage.id,
    number,
    stage: number,
    status,
    isCompleted:
      Boolean(rawStage.is_completed) ||
      norm(rawStage.status) === "finished" ||
      norm(rawStage.status) === "completed",
    messages,
    itemsCount: Number(rawStage.items_count ?? messages.length),
    confirmedItemsCount: Number(
      rawStage.confirmed_items_count ??
        messages.filter((message) => message.stageReviewed).length
    ),
    allItemsConfirmedBySlave: Boolean(
      rawStage.all_items_confirmed_by_slave ??
        messages.every((message) => message.stageReviewed)
    ),
    createdAt: rawStage.created_at || "",
    finishedAt: rawStage.finished_at || "",
  };
}

function mapChatMessage(rawMessage = {}) {
  return {
    id: rawMessage.id,
    text: rawMessage.text || "",
    userLogin:
      rawMessage.author_username ||
      rawMessage.user_login ||
      rawMessage.author?.username ||
      "",
    companyName:
      rawMessage.company?.name ||
      rawMessage.company_name ||
      "",
    sentAt: formatDisplayDateTime(rawMessage.created_at || rawMessage.sent_at || ""),
    sentAtRaw: rawMessage.created_at || rawMessage.sent_at || "",
    stageNumber: Number(rawMessage.stage_number || rawMessage.stageNumber || 1),
  };
}

export function mapReconciliation(rawReconciliation = {}) {
  const base = {
    id: rawReconciliation.id,
    company:
      rawReconciliation.slave_company?.name ||
      rawReconciliation.slaveCompany?.name ||
      rawReconciliation.company ||
      "",
    initiator:
      rawReconciliation.master_company?.name ||
      rawReconciliation.masterCompany?.name ||
      rawReconciliation.initiator ||
      "",
    periodFrom:
      rawReconciliation.periodFrom ||
      formatDisplayDate(rawReconciliation.period_start),
    periodTo:
      rawReconciliation.periodTo ||
      formatDisplayDate(rawReconciliation.period_end),
    periodStart: rawReconciliation.period_start || rawReconciliation.periodStart || "",
    periodEnd: rawReconciliation.period_end || rawReconciliation.periodEnd || "",
    status: mapReconciliationStatus(rawReconciliation.status),
    date: rawReconciliation.date || formatDisplayDate(rawReconciliation.created_at),
    createdAt: rawReconciliation.created_at || "",
    finishedAt: rawReconciliation.finished_at || "",
  };

  const stages = extractArray(rawReconciliation.stages).map((stage) => mapStage(stage, base));
  const currentStageNumber =
    Number(rawReconciliation.current_stage_number || rawReconciliation.currentStageNumber || 0) ||
    stages.find((stage) => !stage.isCompleted)?.number ||
    stages[stages.length - 1]?.number ||
    1;

  return {
    ...base,
    stages,
    currentStageNumber,
    stage:
      Number(rawReconciliation.stage || rawReconciliation.stages_count || 0) ||
      stages[stages.length - 1]?.number ||
      currentStageNumber,
    chatMessages: extractArray(rawReconciliation.chat_messages || rawReconciliation.chatMessages).map(
      mapChatMessage
    ),
  };
}

function emitChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RECONCILIATIONS_CHANGED_EVENT));
}

function getFilenameFromDisposition(disposition, fallbackFilename) {
  const value = String(disposition || "");
  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const basicMatch = value.match(/filename="([^"]+)"/i) || value.match(/filename=([^;]+)/i);
  if (basicMatch?.[1]) {
    return String(basicMatch[1]).trim();
  }

  return fallbackFilename;
}

async function downloadBlobResponse(response, fallbackFilename) {
  const blob = await response.blob();
  const filename = getFilenameFromDisposition(
    response.headers.get("content-disposition"),
    fallbackFilename
  );

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}


export const reconciliationsApi = {
  events: {
    RECONCILIATIONS_CHANGED_EVENT,
  },

  emitChanged,

  async list() {
    const result = await request("/reconciliations/");
    return extractArray(result).map(mapReconciliation);
  },

  async getById(reconciliationId) {
    const result = await request(`/reconciliations/${reconciliationId}/`);
    return mapReconciliation(result);
  },

  async create({ slaveCompanyId, periodStart, periodEnd }) {
    const result = await request("/reconciliations/", {
      method: "POST",
      body: {
        slave_company: slaveCompanyId,
        period_start: periodStart,
        period_end: periodEnd,
      },
    });
    const mapped = mapReconciliation(result);
    emitChanged();
    return mapped;
  },

  async bulkConfirm(reconciliationId, itemIds = []) {
    const result = await request(`/reconciliations/${reconciliationId}/bulk-confirm/`, {
      method: "POST",
      body: { item_ids: itemIds },
    });
    emitChanged();
    return result;
  },

  async listChatMessages(reconciliationId) {
    const result = await request(`/reconciliations/${reconciliationId}/chat/`);
    return extractArray(result).map(mapChatMessage);
  },

  async sendChatMessage(reconciliationId, payload) {
    const body =
      typeof payload === "string"
        ? { text: payload }
        : {
            text: payload?.text || "",
            stage_number: payload?.stageNumber,
          };

    const result = await request(`/reconciliations/${reconciliationId}/chat/`, {
      method: "POST",
      body,
    });

    emitChanged();
    return mapChatMessage(result);
  },

  async createNewStage(reconciliationId) {
    const result = await request(`/reconciliations/${reconciliationId}/new-stage/`, {
      method: "POST",
    });
    const mapped = mapReconciliation(result);
    emitChanged();
    return mapped;
  },

  async finish(reconciliationId) {
    const result = await request(`/reconciliations/${reconciliationId}/finish/`, {
      method: "POST",
    });
    const mapped = mapReconciliation(result);
    emitChanged();
    return mapped;
  },


  async exportStage(reconciliationId, stageNumber) {
    const response = await request(`/reconciliations/${reconciliationId}/export/`, {
      method: "GET",
      query: {
        scope: "stage",
        stage_number: stageNumber,
      },
      raw: true,
    });

    await downloadBlobResponse(
      response,
      `reconciliation_${reconciliationId}_stage_${stageNumber}.xlsx`
    );
  },

  async exportAllStages(reconciliationId) {
    const response = await request(`/reconciliations/${reconciliationId}/export/`, {
      method: "GET",
      query: {
        scope: "all",
      },
      raw: true,
    });

    await downloadBlobResponse(
      response,
      `reconciliation_${reconciliationId}_all_stages.xlsx`
    );
  },

  async listSlaveCompanies() {
    const result = await request("/admin/companies/");
    return extractArray(result)
      .map(mapCompany)
      .filter((company) => norm(company.companyType) === "slave")
      .filter((company) => company.isActive);
  },

  toBackendDate(value) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || ""));
    if (!match) return "";
    return `${match[3]}-${match[2]}-${match[1]}`;
  },

  toDisplayDate: formatDisplayDate,
  toDisplayDateTime: formatDisplayDateTime,
};
