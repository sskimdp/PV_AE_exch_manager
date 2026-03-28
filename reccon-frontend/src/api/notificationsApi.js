import { request } from "./http";

const DEFAULT_INTERVAL_LABEL = "30 мин.";
const DEFAULT_INTERVAL_MINUTES = 30;

const INTERVAL_LABEL_TO_MINUTES = {
  "30 мин.": 30,
  "1 час": 60,
  "2 часа": 120,
  "6 часов": 360,
  "12 часов": 720,
  "24 часа": 1440,
};

const INTERVAL_MINUTES_TO_LABEL = Object.fromEntries(
  Object.entries(INTERVAL_LABEL_TO_MINUTES).map(([label, minutes]) => [
    String(minutes),
    label,
  ])
);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractPayload = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

  if (raw.data && typeof raw.data === "object") return raw.data;
  if (raw.result && typeof raw.result === "object") return raw.result;
  if (raw.settings && typeof raw.settings === "object") return raw.settings;

  return raw;
};

const intervalLabelToMinutes = (label) => {
  return (
    INTERVAL_LABEL_TO_MINUTES[String(label || "").trim()] ||
    DEFAULT_INTERVAL_MINUTES
  );
};

const intervalMinutesToLabel = (minutes) => {
  return (
    INTERVAL_MINUTES_TO_LABEL[String(minutes)] || DEFAULT_INTERVAL_LABEL
  );
};

const normalizeReminderSettings = (raw, fallbackCompanyName = "") => {
  const source = extractPayload(raw) || {};

  const intervalMinutes =
    toNumber(source.intervalMinutes) ??
    toNumber(source.interval_minutes) ??
    toNumber(source.reminderIntervalMinutes) ??
    toNumber(source.reminder_interval_minutes) ??
    toNumber(source.interval) ??
    intervalLabelToMinutes(
      source.intervalLabel ??
        source.interval_label ??
        source.reminderIntervalLabel
    );

  const intervalLabel =
    source.intervalLabel ??
    source.interval_label ??
    source.reminderIntervalLabel ??
    intervalMinutesToLabel(intervalMinutes);

  return {
    companyName:
      source.companyName ??
      source.company_name ??
      source.company ??
      source.company_title ??
      fallbackCompanyName ??
      "",
    enabled: Boolean(
      source.enabled ??
        source.isEnabled ??
        source.is_enabled ??
        source.remindersEnabled ??
        true
    ),
    intervalLabel,
    intervalMinutes,
    channels: {
      inside: Boolean(
        source.channels?.inside ??
          source.channels?.system ??
          source.inside ??
          source.in_app ??
          source.inApp ??
          source.system ??
          source.inside_enabled ??
          source.in_app_enabled ??
          source.system_enabled ??
          true
      ),
      email: Boolean(
        source.channels?.email ??
          source.email ??
          source.email_enabled ??
          source.send_email ??
          source.sendEmail ??
          false
      ),
    },
  };
};

const buildReminderPayload = (payload) => {
  const normalized = normalizeReminderSettings(payload, payload?.companyName);

  return {
    companyName: normalized.companyName,
    enabled: normalized.enabled,
    intervalLabel: normalized.intervalLabel,
    intervalMinutes: normalized.intervalMinutes,
    channels: {
      inside: normalized.channels.inside,
      email: normalized.channels.email,
    },
  };
};

const normalizeUnreadCount = (raw) => {
  if (typeof raw === "number") return raw;

  const source = extractPayload(raw) || {};

  return (
    toNumber(source.unreadCount) ??
    toNumber(source.unread_count) ??
    toNumber(source.count) ??
    toNumber(source.total) ??
    0
  );
};

export const notificationsApi = {
  async list() {
    const result = await request("/notifications/");
    const payload = extractPayload(result);
    return Array.isArray(payload) ? payload : [];
  },

  async getUnreadCount() {
    const result = await request("/notifications/unread-count/");
    return normalizeUnreadCount(result);
  },

  async markRead(notificationId) {
    return request(`/notifications/${notificationId}/mark-read/`, {
      method: "POST",
    });
  },

  async getReminderSettings(params = {}) {
    const result = await request("/admin/reminder-settings/", {
      query: params,
    });

    return normalizeReminderSettings(result, params.companyName);
  },

  async updateReminderSettings(payload) {
    const requestBody = buildReminderPayload(payload);

    const result = await request("/admin/reminder-settings/", {
      method: "PUT",
      body: requestBody,
    });

    return normalizeReminderSettings(result || requestBody, payload?.companyName);
  },
};

export {
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_INTERVAL_MINUTES,
  intervalLabelToMinutes,
  intervalMinutesToLabel,
  normalizeReminderSettings,
  normalizeUnreadCount,
};