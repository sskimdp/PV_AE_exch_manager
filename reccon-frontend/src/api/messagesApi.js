import { tokenStorage } from "./tokenStorage";

const MESSAGE_CHANGED_EVENT = "reccon:messages-changed";

function emitMessagesChanged() {
  window.dispatchEvent(new CustomEvent(MESSAGE_CHANGED_EVENT));
}

function unwrapOk(payload) {
  if (payload && typeof payload === "object" && "ok" in payload) {
    return payload.data;
  }
  return payload;
}

async function request(path, options = {}) {
  const token = tokenStorage.getAccessToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const rawText = await response.text();
  const data = rawText ? JSON.parse(rawText) : null;

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      data?.error ||
      (typeof data === "string" ? data : "Не удалось выполнить запрос.");
    throw new Error(message);
  }

  return unwrapOk(data);
}

function buildComposeFormData(payload = {}) {
  const formData = new FormData();
  formData.append("subject", payload.subject || "");
  formData.append("text", payload.text || "");
  formData.append("html", payload.html || "");

  if (payload.reconciliationId != null && payload.reconciliationId !== "") {
    formData.append("reconciliation_id", String(payload.reconciliationId));
  }

  for (const attachment of payload.attachments || []) {
    if (attachment?.file) {
      formData.append("files", attachment.file);
    }
  }

  return formData;
}

async function requestAndNotify(path, options = {}) {
  const data = await request(path, options);
  emitMessagesChanged();
  return data;
}

export const messagesApi = {
  events: {
    MESSAGE_CHANGED_EVENT,
  },

  async getCounts() {
    return (
      (await request("/api/messages/summary/")) || {
        inbox: 0,
        sent: 0,
        drafts: 0,
        inboxCount: 0,
        sentCount: 0,
        draftsCount: 0,
      }
    );
  },

  async getComposeMeta() {
    return (await request("/api/messages/compose-meta/")) || {};
  },

  async listInbox() {
    return (await request("/api/messages/inbox/")) || [];
  },

  async openInboxMessage(messageId) {
    return await requestAndNotify(`/api/messages/inbox/${messageId}/open/`, {
      method: "POST",
    });
  },

  async confirmInboxMessage(messageId, receiverNumber) {
    return await requestAndNotify(`/api/messages/inbox/${messageId}/confirm/`, {
      method: "POST",
      body: JSON.stringify({ receiver_number: receiverNumber }),
    });
  },

  async getNextIncomingNumber(messageId) {
    const data = await request(
      `/api/messages/inbox/${messageId}/suggest-receiver-number/`
    );
    return data?.suggested_receiver_number || "";
  },

  async listSent() {
    return (await request("/api/messages/sent/")) || [];
  },

  async composeAndSend(payload) {
    return await requestAndNotify("/api/messages/sent/compose/", {
      method: "POST",
      body: buildComposeFormData(payload),
    });
  },

  async listDrafts() {
    return (await request("/api/messages/drafts/")) || [];
  },

  async createDraft(payload) {
    return await requestAndNotify("/api/messages/drafts/", {
      method: "POST",
      body: buildComposeFormData(payload),
    });
  },

  async updateDraft(draftId, patch) {
    return await request(`/api/messages/drafts/${draftId}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async uploadDraftAttachments(draftId, files) {
    const formData = new FormData();
    for (const file of files || []) {
      formData.append("files", file);
    }

    return await request(`/api/messages/drafts/${draftId}/attachments/`, {
      method: "POST",
      body: formData,
    });
  },

  async sendDraft(draftId) {
    return await requestAndNotify(`/api/messages/drafts/${draftId}/send/`, {
      method: "POST",
    });
  },

  async deleteDraft(draftId) {
    await requestAndNotify(`/api/messages/drafts/${draftId}/`, {
      method: "DELETE",
    });
  },

  async deleteAttachment(attachment) {
    const url =
      typeof attachment === "string"
        ? attachment
        : attachment?.deleteUrl || `/api/attachments/attachments/${attachment?.id}/`;

    await request(url, { method: "DELETE" });
  },
};
