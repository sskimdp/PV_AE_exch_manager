const STORAGE_CHANGE_EVENT = "reconciliation-storage-change";
const DEFAULT_MASTER_COMPANY_NAME = "Master Компания";
const RECONCILIATIONS_KEY = "reconciliations";
const PENDING_MESSAGE_CONTEXT_KEY = "pending-message-context";
const REMINDER_SETTINGS_KEY = "reminder-settings";

const REMINDER_INTERVAL_MINUTES = {
  "30 мин.": 30,
  "1 час": 60,
  "2 часа": 120,
  "6 часов": 360,
  "12 часов": 720,
  "24 часа": 1440,
};

const DEFAULT_REMINDER_SETTINGS = {
  enabled: true,
  intervalLabel: "30 мин.",
  intervalMinutes: 30,
  channels: {
    inside: true,
    email: false,
  },
};

const getReminderCompanyKey = (companyName) =>
  norm(companyName || DEFAULT_MASTER_COMPANY_NAME) || "__master__";

const normalizeReminderSettings = (settings = {}) => {
  const intervalLabel =
    REMINDER_INTERVAL_MINUTES[String(settings.intervalLabel || "").trim()]
      ? String(settings.intervalLabel).trim()
      : DEFAULT_REMINDER_SETTINGS.intervalLabel;

  return {
    enabled: settings.enabled !== false,
    intervalLabel,
    intervalMinutes: REMINDER_INTERVAL_MINUTES[intervalLabel],
    channels: {
      inside: settings?.channels?.inside !== false,
      email: Boolean(settings?.channels?.email),
    },
  };
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const norm = (value) => String(value || "").trim().toLowerCase();
const sameId = (a, b) => String(a) === String(b);

const createId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const read = (key, fallback = []) => {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(value) ? clone(value) : clone(fallback);
  } catch {
    return clone(fallback);
  }
};

const readValue = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const emitChange = (key) => {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(STORAGE_CHANGE_EVENT, {
      detail: { key, at: Date.now() },
    })
  );
};

const write = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
  emitChange(key);
};

const remove = (key) => {
  localStorage.removeItem(key);
  emitChange(key);
};

const parseDDMMYYYY = (value) => {
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
};

const parseDateTime = (value) => {
  if (!value) return 0;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.getTime();
  }

  const dateTimeMatch = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(
    String(value || "")
  );

  if (!dateTimeMatch) return 0;

  const dd = Number(dateTimeMatch[1]);
  const mm = Number(dateTimeMatch[2]);
  const yyyy = Number(dateTimeMatch[3]);
  const hh = Number(dateTimeMatch[4] || 0);
  const min = Number(dateTimeMatch[5] || 0);

  return new Date(yyyy, mm - 1, dd, hh, min).getTime();
};

const toDate = (value) => {
  const time = parseDateTime(value);
  return time ? new Date(time) : null;
};

const formatDisplayDate = (value) => {
  const date = toDate(value) || new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();

  return `${dd}.${mm}.${yyyy}`;
};

const formatDisplayDateTime = (value) => {
  const date = toDate(value) || new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
};

const startOfDay = (value) => {
  const date = parseDDMMYYYY(value);
  if (!date) return 0;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
};

const endOfDay = (value) => {
  const date = parseDDMMYYYY(value);
  if (!date) return 0;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
};

const sanitizeAttachments = (attachments) =>
  Array.isArray(attachments)
    ? attachments
        .filter(Boolean)
        .map((attachment) => ({
          id: attachment.id || createId("attachment"),
          name: attachment.name || "Файл",
          url: attachment.url || "",
        }))
    : [];

const isActionRequiredStatus = (status) => {
  const s = norm(status);
  return s === "ожидает подтверждения" || s === "прочитано";
};

const sortByRecent = (list) =>
  [...list].sort((a, b) => {
    const aTime = parseDateTime(
      a.statusChangedAt || a.updatedAt || a.sentAt || a.createdAt || a.date
    );
    const bTime = parseDateTime(
      b.statusChangedAt || b.updatedAt || b.sentAt || b.createdAt || b.date
    );

    return bTime - aTime;
  });

const numberFromPattern = (value, prefix) => {
  const match = new RegExp(`^${prefix}-(\\d{6})$`, "i").exec(
    String(value || "").trim()
  );
  return match ? Number(match[1]) : 0;
};

const formatSystemNumber = (prefix, value) =>
  `${prefix}-${String(value).padStart(6, "0")}`;

const getMaxNumber = (messages, fieldName, prefix) =>
  messages.reduce((maxValue, message) => {
    const direct = numberFromPattern(message[fieldName], prefix);
    const fallback = numberFromPattern(message.number, prefix);
    return Math.max(maxValue, direct, fallback);
  }, 0);

const resolveCurrentMessageNumber = (message) => {
  const status = norm(message.status);
  if (status === "подтверждено") {
    return message.incomingNumber || message.number || "";
  }

  return message.outgoingNumber || message.number || "";
};

const normalizeMessagesCollection = (messages) => {
  const ordered = [...messages].sort((a, b) => {
    const timeDiff =
      parseDateTime(a.sentAt || a.createdAt || a.updatedAt || a.date) -
      parseDateTime(b.sentAt || b.createdAt || b.updatedAt || b.date);

    if (timeDiff !== 0) return timeDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  let nextOutgoing = getMaxNumber(ordered, "outgoingNumber", "O");
  let nextIncoming = getMaxNumber(ordered, "incomingNumber", "I");
  let changed = false;

  const normalized = ordered.map((message) => {
    const nextMessage = {
      ...message,
      attachments: sanitizeAttachments(message.attachments),
    };

    if (!nextMessage.outgoingNumber) {
      const existingOutgoing = numberFromPattern(nextMessage.number, "O");
      if (existingOutgoing > 0) {
        nextMessage.outgoingNumber = formatSystemNumber("O", existingOutgoing);
        nextOutgoing = Math.max(nextOutgoing, existingOutgoing);
      } else {
        nextOutgoing += 1;
        nextMessage.outgoingNumber = formatSystemNumber("O", nextOutgoing);
      }
      changed = true;
    }

    if (norm(nextMessage.status) === "подтверждено" && !nextMessage.incomingNumber) {
      const existingIncoming = numberFromPattern(nextMessage.number, "I");
      if (existingIncoming > 0) {
        nextMessage.incomingNumber = formatSystemNumber("I", existingIncoming);
        nextIncoming = Math.max(nextIncoming, existingIncoming);
      } else {
        nextIncoming += 1;
        nextMessage.incomingNumber = formatSystemNumber("I", nextIncoming);
      }
      changed = true;
    }

    const currentNumber = resolveCurrentMessageNumber(nextMessage);
    if (nextMessage.number !== currentNumber) {
      nextMessage.number = currentNumber;
      changed = true;
    }

    if (!nextMessage.date) {
      nextMessage.date = formatDisplayDate(
        nextMessage.sentAt || nextMessage.createdAt || nextMessage.updatedAt
      );
      changed = true;
    }

    if (norm(nextMessage.status) === "прочитано" && !nextMessage.readAt) {
      nextMessage.readAt = nextMessage.statusChangedAt || nextMessage.updatedAt || null;
      changed = true;
    }

    if (norm(nextMessage.status) === "подтверждено" && !nextMessage.confirmedAt) {
      nextMessage.confirmedAt = nextMessage.statusChangedAt || nextMessage.updatedAt || null;
      changed = true;
    }

    return nextMessage;
  });

  return { normalized, changed };
};

const getUserLoginById = (userId) => {
  if (!userId) return "";

  const user = read("users", []).find((item) => sameId(item.id, userId));
  return user?.login || user?.username || "";
};

const messageBelongsToReconciliation = (message, reconciliation) => {
  const companies = [norm(message.senderCompany), norm(message.recipientCompany)];
  const needed = [norm(reconciliation.company), norm(reconciliation.initiator)];

  const companiesMatch = needed.every((company) => companies.includes(company));
  if (!companiesMatch) return false;

  const sentTime = parseDateTime(message.sentAt || message.createdAt || message.date);
  const inPeriod =
    sentTime >= startOfDay(reconciliation.periodFrom) &&
    sentTime <= endOfDay(reconciliation.periodTo);

  const lateLinks = Array.isArray(message.reconciliationLateLinks)
    ? message.reconciliationLateLinks
    : [];

  const linkedLate = lateLinks.some((item) => sameId(item.reconciliationId, reconciliation.id));

  return inPeriod || linkedLate;
};

const buildStageMessageSnapshot = (message, reconciliation, stageNumber) => {
  const lateLinks = Array.isArray(message.reconciliationLateLinks)
    ? message.reconciliationLateLinks
    : [];
  const isLateForPeriod = lateLinks.some((item) => sameId(item.reconciliationId, reconciliation.id));
  const status =
    norm(message.status) === "подтверждено"
      ? "Подтверждено"
      : norm(message.status) === "прочитано"
      ? "Прочитано"
      : "Ожидает подтверждения";

  return {
    id: `${stageNumber}-${message.id}`,
    sourceMessageId: message.id,
    number: resolveCurrentMessageNumber(message),
    outgoingNumber: message.outgoingNumber || "",
    incomingNumber: message.incomingNumber || "",
    subject: message.subject || "Без темы",
    text: message.text || "",
    html: message.html || "",
    attachments: sanitizeAttachments(message.attachments),
    status,
    sentAt: formatDisplayDateTime(message.sentAt || message.createdAt || message.date),
    sentAtRaw: message.sentAt || message.createdAt || message.date || "",
    readAt: message.readAt ? formatDisplayDateTime(message.readAt) : "",
    readAtRaw: message.readAt || "",
    confirmedAt: message.confirmedAt
      ? formatDisplayDateTime(message.confirmedAt)
      : norm(message.status) === "подтверждено" && message.statusChangedAt
      ? formatDisplayDateTime(message.statusChangedAt)
      : "",
    confirmedAtRaw: message.confirmedAt || message.statusChangedAt || "",
    senderCompany: message.senderCompany || "",
    recipientCompany: message.recipientCompany || "",
    senderLogin: getUserLoginById(message.senderUserId) || message.senderLogin || "",
    confirmerLogin: message.confirmerLogin || "",
    isLateForPeriod,
    stageReviewed: false,
    stageReviewedAt: "",
    stageReviewedByLogin: "",
  };
};

const buildStageMessages = (reconciliation, stageNumber) => {
  const messages = read("messages", []);
  const { normalized } = normalizeMessagesCollection(messages);

  return normalized
    .filter((message) => messageBelongsToReconciliation(message, reconciliation))
    .sort((a, b) => {
      const timeDiff =
        parseDateTime(b.sentAt || b.createdAt || b.date) -
        parseDateTime(a.sentAt || a.createdAt || a.date);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id).localeCompare(String(b.id));
    })
    .map((message) => buildStageMessageSnapshot(message, reconciliation, stageNumber));
};

const normalizeReconciliationsCollection = (reconciliations) => {
  let changed = false;

  const normalized = reconciliations.map((reconciliation) => {
    const stages = Array.isArray(reconciliation.stages) ? reconciliation.stages : [];
    const sortedStages = [...stages]
      .map((stage) => ({
        ...stage,
        messages: Array.isArray(stage.messages) ? stage.messages : [],
      }))
      .sort((a, b) => Number(a.number) - Number(b.number));

    const latestStage = sortedStages[sortedStages.length - 1] || null;
    const currentStageNumber = latestStage?.number || reconciliation.currentStageNumber || 1;
    const status =
      reconciliation.status || (latestStage?.isCompleted ? "завершена" : "активна");

    const nextReconciliation = {
      ...reconciliation,
      stages: sortedStages,
      currentStageNumber,
      status,
      date:
        reconciliation.date ||
        formatDisplayDate(reconciliation.createdAt || reconciliation.updatedAt || new Date()),
      chatMessages: Array.isArray(reconciliation.chatMessages)
  ? reconciliation.chatMessages.map((message) => ({
      ...message,
      stageNumber: Number(message.stageNumber) || 1,
    }))
  : [],
    };

    if (
      nextReconciliation.currentStageNumber !== reconciliation.currentStageNumber ||
      nextReconciliation.status !== reconciliation.status ||
      !Array.isArray(reconciliation.chatMessages)
    ) {
      changed = true;
    }

    return nextReconciliation;
  });

  return { normalized, changed };
};

export const storage = {
  subscribe(callback) {
    if (typeof window === "undefined") return () => {};

    const handler = () => callback();

    window.addEventListener(STORAGE_CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener(STORAGE_CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  },

  // Companies
  getCompanies() {
    return read("companies", []);
  },

  saveCompany(company) {
    const list = read("companies", []);
    const index = list.findIndex((item) => sameId(item.id, company.id));

    const next =
      index >= 0
        ? list.map((item) => (sameId(item.id, company.id) ? company : item))
        : [...list, company];

    write("companies", next);
    return company;
  },

  setCompanies(next) {
    write("companies", next);
  },

  getMasterCompanyName() {
    const companies = read("companies", []);
    const master = companies.find((company) => norm(company.companyType) === "master");
    return master?.name || DEFAULT_MASTER_COMPANY_NAME;
  },

    getReminderSettings(companyName = this.getMasterCompanyName()) {
    const allSettings = readValue(REMINDER_SETTINGS_KEY, {});
    const companyKey = getReminderCompanyKey(companyName);
    return clone(normalizeReminderSettings(allSettings?.[companyKey] || {}));
  },

  saveReminderSettings(companyName = this.getMasterCompanyName(), settings = {}) {
    const allSettings = readValue(REMINDER_SETTINGS_KEY, {});
    const companyKey = getReminderCompanyKey(companyName);
    const normalized = normalizeReminderSettings(settings);

    write(REMINDER_SETTINGS_KEY, {
      ...allSettings,
      [companyKey]: normalized,
    });

    return clone(normalized);
  },

  // Users
  getUsers() {
    return read("users", []);
  },

  saveUser(user) {
    const list = read("users", []);
    const index = list.findIndex((item) => sameId(item.id, user.id));

    const next =
      index >= 0
        ? list.map((item) => (sameId(item.id, user.id) ? user : item))
        : [...list, user];

    write("users", next);
    return user;
  },

  setUsers(next) {
    write("users", next);
  },

  getCurrentUser() {
    return readValue("currentUser", null);
  },

  setCurrentUser(user) {
    if (user == null) {
      remove("currentUser");
      return;
    }

    write("currentUser", user);
  },

updateUserAvatar(userId, avatarDataUrl) {
  if (userId == null) return null;

  const list = read("users", []);
  let updatedUser = null;
  let found = false;

  const next = list.map((user) => {
    if (!sameId(user.id, userId)) return user;

    found = true;
    updatedUser = { ...user, avatarDataUrl };
    return updatedUser;
  });

  const currentUser = readValue("currentUser", null);

  if (!found && currentUser && sameId(currentUser.id, userId)) {
    updatedUser = { ...currentUser, avatarDataUrl };
    next.push(updatedUser);
  }

  write("users", next);

  if (currentUser && sameId(currentUser.id, userId)) {
    write("currentUser", { ...currentUser, avatarDataUrl });
  }

  return updatedUser;
},

  // Messages
  getMessages() {
    const raw = read("messages", []);
    const { normalized, changed } = normalizeMessagesCollection(raw);

    if (changed) {
      write("messages", normalized);
    }

    return clone(normalized);
  },

  setMessages(next) {
    const { normalized } = normalizeMessagesCollection(next || []);
    write("messages", normalized);
  },

  getNextOutgoingNumber() {
    const messages = this.getMessages();
    return formatSystemNumber("O", getMaxNumber(messages, "outgoingNumber", "O") + 1);
  },

  getNextIncomingNumber() {
    const messages = this.getMessages();
    return formatSystemNumber("I", getMaxNumber(messages, "incomingNumber", "I") + 1);
  },

  saveMessage(message) {
    const list = this.getMessages();
    const index = list.findIndex((item) => sameId(item.id, message.id));

    const normalized = {
      ...message,
      attachments: sanitizeAttachments(message.attachments),
    };

    const next =
      index >= 0
        ? list.map((item) => (sameId(item.id, normalized.id) ? normalized : item))
        : [normalized, ...list];

    this.setMessages(next);
    return this.getMessages().find((item) => sameId(item.id, normalized.id)) || normalized;
  },

  setPendingMessageContext(context) {
    if (!context) {
      remove(PENDING_MESSAGE_CONTEXT_KEY);
      return;
    }

    write(PENDING_MESSAGE_CONTEXT_KEY, {
      ...context,
      expiresAt: context.expiresAt || Date.now() + 30 * 60 * 1000,
    });
  },

  getPendingMessageContext() {
    const context = readValue(PENDING_MESSAGE_CONTEXT_KEY, null);
    if (!context) return null;

    if (context.expiresAt && context.expiresAt < Date.now()) {
      remove(PENDING_MESSAGE_CONTEXT_KEY);
      return null;
    }

    return context;
  },

  consumePendingMessageContext() {
    const context = this.getPendingMessageContext();
    if (!context) return null;

    remove(PENDING_MESSAGE_CONTEXT_KEY);
    return context;
  },

  createMessage({
    senderCompany,
    senderUserId,
    recipientCompany,
    subject = "",
    text = "",
    html = "",
    attachments = [],
  }) {
    const now = new Date().toISOString();
    const outgoingNumber = this.getNextOutgoingNumber();
    const pendingContext = this.consumePendingMessageContext();

    const message = {
      id: createId("message"),
      senderCompany: senderCompany || "",
      company: senderCompany || "",
      senderUserId: senderUserId || null,
      recipientCompany: recipientCompany || this.getMasterCompanyName(),
      subject: String(subject || "").trim(),
      text: String(text || ""),
      html: String(html || ""),
      status: "Ожидает подтверждения",
      number: outgoingNumber,
      outgoingNumber,
      incomingNumber: "",
      confirmerLogin: "",
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      sentAt: now,
      readAt: "",
      confirmedAt: "",
      date: formatDisplayDate(now),
      attachments: sanitizeAttachments(attachments),
      reconciliationLateLinks: pendingContext?.reconciliationId
        ? [
            {
              reconciliationId: pendingContext.reconciliationId,
              createdAt: now,
              periodFrom: pendingContext.periodFrom || "",
              periodTo: pendingContext.periodTo || "",
            },
          ]
        : [],
    };

    return this.saveMessage(message);
  },

  updateMessage(messageId, patchOrUpdater) {
    const list = this.getMessages();
    let updated = null;

    const next = list.map((message) => {
      if (!sameId(message.id, messageId)) return message;

      const nextMessage =
        typeof patchOrUpdater === "function"
          ? patchOrUpdater(clone(message))
          : { ...message, ...patchOrUpdater };

      if (!nextMessage) return message;

      updated = {
        ...nextMessage,
        attachments: sanitizeAttachments(nextMessage.attachments),
      };

      return updated;
    });

    if (!updated) return null;

    this.setMessages(next);
    return this.getMessages().find((message) => sameId(message.id, messageId)) || null;
  },

  getInboxMessagesForCompany(companyName) {
    return this.getMessages().filter(
      (message) => norm(message.recipientCompany) === norm(companyName)
    );
  },

  getSentMessagesForCompany(companyName) {
    return this.getMessages().filter(
      (message) => norm(message.senderCompany) === norm(companyName)
    );
  },

  markMessageRead(messageId) {
    return this.updateMessage(messageId, (message) => {
      if (norm(message.status) !== "ожидает подтверждения") {
        return message;
      }

      const now = new Date().toISOString();

      return {
        ...message,
        status: "Прочитано",
        updatedAt: now,
        statusChangedAt: now,
        readAt: message.readAt || now,
      };
    });
  },

  confirmMessage(messageId, incomingNumber, confirmerLogin = "") {
    const normalizedNumber = String(incomingNumber || "").trim().toUpperCase();
    const now = new Date().toISOString();

    return this.updateMessage(messageId, (message) => ({
      ...message,
      status: "Подтверждено",
      number: normalizedNumber,
      incomingNumber: normalizedNumber,
      updatedAt: now,
      statusChangedAt: now,
      readAt: message.readAt || now,
      confirmedAt: now,
      confirmerLogin: confirmerLogin || message.confirmerLogin || "",
    }));
  },

  // Drafts
  getDrafts() {
    return read("drafts", []);
  },

  setDrafts(next) {
    write("drafts", next);
  },

  saveDraft(draft) {
    const list = read("drafts", []);
    const index = list.findIndex((item) => sameId(item.id, draft.id));
    const now = new Date().toISOString();

    const normalized = {
      id: draft.id || createId("draft"),
      company: draft.company || "",
      recipientCompany: draft.recipientCompany || this.getMasterCompanyName(),
      senderUserId: draft.senderUserId || null,
      subject: String(draft.subject || "").trim(),
      text: String(draft.text || ""),
      html: String(draft.html || ""),
      status: "Черновик",
      createdAt: draft.createdAt || now,
      updatedAt: now,
      date: formatDisplayDate(now),
      attachments: sanitizeAttachments(draft.attachments),
    };

    const next =
      index >= 0
        ? list.map((item) => (sameId(item.id, normalized.id) ? normalized : item))
        : [normalized, ...list];

    write("drafts", next);
    return normalized;
  },

  createDraft({
    company,
    senderUserId,
    recipientCompany,
    subject = "",
    text = "",
    html = "",
    attachments = [],
  }) {
    return this.saveDraft({
      id: createId("draft"),
      company: company || "",
      senderUserId: senderUserId || null,
      recipientCompany: recipientCompany || this.getMasterCompanyName(),
      subject,
      text,
      html,
      attachments,
    });
  },

  updateDraft(draftId, patchOrUpdater) {
    const list = read("drafts", []);
    let updated = null;

    const next = list.map((draft) => {
      if (!sameId(draft.id, draftId)) return draft;

      const nextDraft =
        typeof patchOrUpdater === "function"
          ? patchOrUpdater(clone(draft))
          : { ...draft, ...patchOrUpdater };

      if (!nextDraft) return draft;

      updated = this.saveDraftLocal(nextDraft);
      return updated;
    });

    if (!updated) return null;

    write("drafts", next);
    return updated;
  },

  saveDraftLocal(draft) {
    const now = new Date().toISOString();

    return {
      ...draft,
      status: "Черновик",
      updatedAt: now,
      date: formatDisplayDate(now),
      attachments: sanitizeAttachments(draft.attachments),
    };
  },

  deleteDraft(draftId) {
    const next = read("drafts", []).filter((draft) => !sameId(draft.id, draftId));
    write("drafts", next);
  },

  getDraftsForCompany(companyName) {
    return this.getDrafts().filter((draft) => norm(draft.company) === norm(companyName));
  },

  sendDraft(draftId) {
    const draft = this.getDrafts().find((item) => sameId(item.id, draftId));
    if (!draft) return null;

    const message = this.createMessage({
      senderCompany: draft.company,
      senderUserId: draft.senderUserId,
      recipientCompany: draft.recipientCompany || this.getMasterCompanyName(),
      subject: draft.subject,
      text: draft.text,
      html: draft.html || "",
      attachments: draft.attachments || [],
    });

    this.deleteDraft(draftId);
    return message;
  },

  // Reconciliations
  getReconciliations() {
    const raw = read(RECONCILIATIONS_KEY, []);
    const { normalized, changed } = normalizeReconciliationsCollection(raw);

    if (changed) {
      write(RECONCILIATIONS_KEY, normalized);
    }

    return clone(normalized);
  },

  setReconciliations(next) {
    const { normalized } = normalizeReconciliationsCollection(next || []);
    write(RECONCILIATIONS_KEY, normalized);
  },

  saveReconciliation(reconciliation) {
    const list = this.getReconciliations();
    const index = list.findIndex((item) => sameId(item.id, reconciliation.id));

    const next =
      index >= 0
        ? list.map((item) => (sameId(item.id, reconciliation.id) ? reconciliation : item))
        : [reconciliation, ...list];

    this.setReconciliations(next);
    return this.getReconciliationById(reconciliation.id);
  },

  getReconciliationById(reconciliationId) {
    return (
      this.getReconciliations().find((item) => sameId(item.id, reconciliationId)) || null
    );
  },

  getReconciliationsForUser(user) {
    if (!user) return [];

    const list = this.getReconciliations();
    const isMaster = norm(user.companyType) === "master";

    return sortByRecent(
      list.filter((reconciliation) =>
        isMaster
          ? norm(reconciliation.initiator) === norm(user.companyName)
          : norm(reconciliation.company) === norm(user.companyName)
      )
    ).map((reconciliation) => ({
      ...reconciliation,
      stage: reconciliation.stages?.[reconciliation.stages.length - 1]?.number || 1,
    }));
  },

  createReconciliation({ company, initiator, periodFrom, periodTo }) {
    const now = new Date().toISOString();
    const base = {
      id: createId("reconciliation"),
      company: String(company || "").trim(),
      initiator: String(initiator || this.getMasterCompanyName()).trim(),
      periodFrom,
      periodTo,
      createdAt: now,
      updatedAt: now,
      date: formatDisplayDate(now),
      status: "активна",
      currentStageNumber: 1,
      chatMessages: [],
      stages: [],
    };

    const firstStage = {
      number: 1,
      createdAt: now,
      isCompleted: false,
      messages: buildStageMessages(base, 1),
    };

    return this.saveReconciliation({
      ...base,
      stages: [firstStage],
    });
  },

  createNextReconciliationStage(reconciliationId) {
    const reconciliation = this.getReconciliationById(reconciliationId);
    if (!reconciliation) return null;

    const latestStage = reconciliation.stages[reconciliation.stages.length - 1];
    const nextStageNumber = (latestStage?.number || 0) + 1;
    const now = new Date().toISOString();

    const nextStage = {
      number: nextStageNumber,
      createdAt: now,
      isCompleted: false,
      messages: buildStageMessages(reconciliation, nextStageNumber),
    };

    const nextReconciliation = {
      ...reconciliation,
      updatedAt: now,
      currentStageNumber: nextStageNumber,
      status: "активна",
      stages: [
        ...reconciliation.stages.slice(0, -1),
        { ...latestStage, isCompleted: true, completedAt: now },
        nextStage,
      ],
    };

    return this.saveReconciliation(nextReconciliation);
  },

  finishReconciliation(reconciliationId) {
    const reconciliation = this.getReconciliationById(reconciliationId);
    if (!reconciliation) return null;

    const latestStage = reconciliation.stages[reconciliation.stages.length - 1];
    const now = new Date().toISOString();

    return this.saveReconciliation({
      ...reconciliation,
      updatedAt: now,
      status: "завершена",
      stages: [
        ...reconciliation.stages.slice(0, -1),
        { ...latestStage, isCompleted: true, completedAt: now },
      ],
    });
  },

  markReconciliationMessagesReviewed(reconciliationId, stageNumber, messageIds, userLogin = "") {
    const reconciliation = this.getReconciliationById(reconciliationId);
    if (!reconciliation) return null;

    const ids = new Set((messageIds || []).map(String));
    const now = new Date().toISOString();

    return this.saveReconciliation({
      ...reconciliation,
      updatedAt: now,
      stages: reconciliation.stages.map((stage) => {
        if (Number(stage.number) !== Number(stageNumber)) return stage;

        return {
          ...stage,
          messages: stage.messages.map((message) =>
            ids.has(String(message.id))
              ? {
                  ...message,
                  stageReviewed: true,
                  stageReviewedAt: now,
                  stageReviewedByLogin: userLogin || message.stageReviewedByLogin || "",
                }
              : message
          ),
        };
      }),
    });
  },

addReconciliationChatMessage(reconciliationId, payload) {
  const reconciliation = this.getReconciliationById(reconciliationId);
  if (!reconciliation) return null;

  const now = new Date().toISOString();
  const currentStageNumber =
    Number(payload.stageNumber) ||
    Number(reconciliation.currentStageNumber) ||
    Number(reconciliation.stages?.[reconciliation.stages.length - 1]?.number) ||
    1;

  const message = {
    id: createId("reconciliation-chat"),
    userLogin: payload.userLogin || "user",
    companyName: payload.companyName || "Компания",
    text: String(payload.text || "").trim(),
    sentAt: formatDisplayDateTime(now),
    sentAtRaw: now,
    stageNumber: currentStageNumber,
  };

  return this.saveReconciliation({
    ...reconciliation,
    updatedAt: now,
    chatMessages: [...(reconciliation.chatMessages || []), message],
  });
},

  getCountsForUser(user) {
    if (!user) {
      return { incoming: 0, drafts: 0 };
    }

    if (norm(user.companyType) === "master") {
      const incoming = this.getInboxMessagesForCompany(user.companyName).filter((message) =>
        isActionRequiredStatus(message.status)
      ).length;

      return { incoming, drafts: 0 };
    }

    const drafts = this.getDraftsForCompany(user.companyName).length;
    return { incoming: 0, drafts };
  },

  getDashboardItemsForUser(user, limit = 2) {
    if (!user) return [];

    if (norm(user.companyType) === "master") {
      return sortByRecent(
        this.getInboxMessagesForCompany(user.companyName).filter((message) =>
          isActionRequiredStatus(message.status)
        )
      )
        .slice(0, limit)
        .map((message) => ({
          id: message.id,
          company: message.company || message.senderCompany || "Компания",
          subject: message.subject || "Без темы",
          preview: message.text || "Без текста",
          date: message.date || "",
        }));
    }

    return sortByRecent(this.getDraftsForCompany(user.companyName))
      .slice(0, limit)
      .map((draft) => ({
        id: draft.id,
        company: draft.recipientCompany || draft.company || "Компания",
        subject: draft.subject || "Без темы",
        preview: draft.text || "Без текста",
        date: draft.date || "",
      }));
  },
};
