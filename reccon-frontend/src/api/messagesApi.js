import { request } from "./http";

const MESSAGE_CHANGED_EVENT = "reccon:messages-changed";

function emitMessagesChanged() {
  window.dispatchEvent(new CustomEvent(MESSAGE_CHANGED_EVENT));
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

function normalizeApiPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return raw;

  let normalized = raw;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      normalized = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return raw;
    }
  }

  if (normalized.startsWith("/api/")) {
    normalized = normalized.slice(4);
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
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
      (await request("/messages/summary/")) || {
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
    return (await request("/messages/compose-meta/")) || {};
  },

  async listInbox() {
    return (await request("/messages/inbox/")) || [];
  },

  async openInboxMessage(messageId) {
    return await requestAndNotify(`/messages/inbox/${messageId}/open/`, {
      method: "POST",
    });
  },

  async confirmInboxMessage(messageId, receiverNumber) {
    return await requestAndNotify(`/messages/inbox/${messageId}/confirm/`, {
      method: "POST",
      body: { receiver_number: receiverNumber },
    });
  },

  async getNextIncomingNumber(messageId) {
    const data = await request(
      `/messages/inbox/${messageId}/suggest-receiver-number/`
    );
    return data?.suggested_receiver_number || "";
  },

  async listSent() {
    return (await request("/messages/sent/")) || [];
  },

  async composeAndSend(payload) {
    return await requestAndNotify("/messages/sent/compose/", {
      method: "POST",
      body: buildComposeFormData(payload),
    });
  },

  async listDrafts() {
    return (await request("/messages/drafts/")) || [];
  },

  async createDraft(payload) {
    return await requestAndNotify("/messages/drafts/", {
      method: "POST",
      body: buildComposeFormData(payload),
    });
  },

  async updateDraft(draftId, patch, options = {}) {
    return await request(`/messages/drafts/${draftId}/`, {
      method: "PATCH",
      body: {
        ...patch,
        audit: options.audit === true,
      },
    });
  },

  async uploadDraftAttachments(draftId, files) {
    const formData = new FormData();
    for (const file of files || []) {
      formData.append("files", file);
    }

    return await request(`/messages/drafts/${draftId}/attachments/`, {
      method: "POST",
      body: formData,
    });
  },

  async sendDraft(draftId) {
    return await requestAndNotify(`/messages/drafts/${draftId}/send/`, {
      method: "POST",
    });
  },

  async deleteDraft(draftId) {
    await requestAndNotify(`/messages/drafts/${draftId}/`, {
      method: "DELETE",
    });
  },

  async deleteAttachment(attachment) {
    const url =
      typeof attachment === "string"
        ? attachment
        : attachment?.deleteUrl || `/attachments/${attachment?.id}/`;
    await request(normalizeApiPath(url), { method: "DELETE" });
  },
};