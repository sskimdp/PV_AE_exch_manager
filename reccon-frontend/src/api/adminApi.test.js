import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./http", () => ({
  request: vi.fn(),
}));

vi.mock("./adapters", () => ({
  mapCompany: (company) => ({
    id: company.id,
    name: company.name,
    companyType: company.company_type || company.companyType,
  }),
}));

import { request } from "./http";
import { usersApi } from "./usersApi";
import { companiesApi } from "./companiesApi";
import {
  notificationsApi,
  intervalLabelToMinutes,
  intervalMinutesToLabel,
  normalizeReminderSettings,
  normalizeUnreadCount,
} from "./notificationsApi";

describe("admin/users/companies/notifications API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usersApi.listAdmin возвращает список пользователей", async () => {
    request.mockResolvedValue([{ id: 1, login: "admin" }]);

    const result = await usersApi.listAdmin();

    expect(request).toHaveBeenCalledWith("/admin/users/");
    expect(result).toEqual([{ id: 1, login: "admin" }]);
  });

  it("usersApi.createAdmin отправляет POST /admin/users/", async () => {
    const payload = { login: "new_user" };

    await usersApi.createAdmin(payload);

    expect(request).toHaveBeenCalledWith("/admin/users/", {
      method: "POST",
      body: payload,
    });
  });

  it("usersApi.updateAdmin отправляет PATCH /admin/users/{id}/", async () => {
    const payload = { login: "updated" };

    await usersApi.updateAdmin(5, payload);

    expect(request).toHaveBeenCalledWith("/admin/users/5/", {
      method: "PATCH",
      body: payload,
    });
  });

  it("usersApi.toggleAdminStatus вызывает endpoint toggle-status", async () => {
    await usersApi.toggleAdminStatus(5);

    expect(request).toHaveBeenCalledWith("/admin/users/5/toggle-status/", {
      method: "POST",
    });
  });

  it("companiesApi.listAdmin возвращает список компаний", async () => {
    request.mockResolvedValue([{ id: 1, name: "Company" }]);

    const result = await companiesApi.listAdmin();

    expect(request).toHaveBeenCalledWith("/admin/companies/");
    expect(result).toEqual([{ id: 1, name: "Company" }]);
  });

  it("companiesApi.createAdmin отправляет POST /admin/companies/", async () => {
    const payload = { name: "New Company" };

    await companiesApi.createAdmin(payload);

    expect(request).toHaveBeenCalledWith("/admin/companies/", {
      method: "POST",
      body: payload,
    });
  });

  it("companiesApi.updateAdmin отправляет PATCH /admin/companies/{id}/", async () => {
    const payload = { name: "Updated Company" };

    await companiesApi.updateAdmin(3, payload);

    expect(request).toHaveBeenCalledWith("/admin/companies/3/", {
      method: "PATCH",
      body: payload,
    });
  });

  it("companiesApi.toggleAdminStatus вызывает endpoint toggle-status", async () => {
    await companiesApi.toggleAdminStatus(3);

    expect(request).toHaveBeenCalledWith("/admin/companies/3/toggle-status/", {
      method: "POST",
    });
  });

  it("notificationsApi.getUnreadCount нормализует unread_count", async () => {
    request.mockResolvedValue({ unread_count: 4 });

    const result = await notificationsApi.getUnreadCount();

    expect(request).toHaveBeenCalledWith("/notifications/unread-count/");
    expect(result).toBe(4);
  });

  it("notificationsApi.updateReminderSettings отправляет настройки напоминаний", async () => {
    request.mockResolvedValue({
      enabled: true,
      intervalLabel: "1 час",
      channels: { inside: true, email: true },
    });

    await notificationsApi.updateReminderSettings({
      companyName: "Master",
      enabled: true,
      intervalLabel: "1 час",
      channels: { inside: true, email: true },
    });

    expect(request).toHaveBeenCalledWith("/admin/reminder-settings/", {
      method: "PUT",
      body: {
        companyName: "Master",
        enabled: true,
        intervalLabel: "1 час",
        intervalMinutes: 60,
        channels: {
          inside: true,
          email: true,
        },
      },
    });
  });

  it("intervalLabelToMinutes переводит подпись в минуты", () => {
    expect(intervalLabelToMinutes("30 мин.")).toBe(30);
    expect(intervalLabelToMinutes("1 час")).toBe(60);
    expect(intervalLabelToMinutes("неизвестно")).toBe(30);
  });

  it("intervalMinutesToLabel переводит минуты в подпись", () => {
    expect(intervalMinutesToLabel(30)).toBe("30 мин.");
    expect(intervalMinutesToLabel(60)).toBe("1 час");
    expect(intervalMinutesToLabel(999)).toBe("30 мин.");
  });

  it("normalizeReminderSettings нормализует разные форматы ответа", () => {
    const result = normalizeReminderSettings({
      company_name: "Master",
      enabled: true,
      interval_minutes: 60,
      send_inside: true,
      send_email: false,
    });

    expect(result).toEqual({
      companyName: "Master",
      enabled: true,
      intervalLabel: "1 час",
      intervalMinutes: 60,
      channels: {
        inside: true,
        email: false,
      },
    });
  });

  it("normalizeUnreadCount понимает разные форматы счетчика", () => {
    expect(normalizeUnreadCount(3)).toBe(3);
    expect(normalizeUnreadCount({ unread_count: 5 })).toBe(5);
    expect(normalizeUnreadCount({ unreadCount: 6 })).toBe(6);
    expect(normalizeUnreadCount({ total: 7 })).toBe(7);
    expect(normalizeUnreadCount({})).toBe(0);
  });
});