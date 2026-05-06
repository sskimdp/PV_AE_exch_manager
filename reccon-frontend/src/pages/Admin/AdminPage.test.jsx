import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminPage from "./AdminPage";
import { usersApi } from "../../api/usersApi";
import { companiesApi } from "../../api/companiesApi";
import { notificationsApi } from "../../api/notificationsApi";

const navigateMock = vi.fn();

let outletUser = {
  id: 1,
  companyType: "master",
  companyName: "Master Company",
  login: "master_admin",
};

let locationMock = {
  key: "admin-test-key",
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => locationMock,
    useOutletContext: () => ({
      user: outletUser,
    }),
  };
});

vi.mock("../../api/usersApi", () => ({
  usersApi: {
    listAdmin: vi.fn(),
    toggleAdminStatus: vi.fn(),
  },
}));

vi.mock("../../api/companiesApi", () => ({
  companiesApi: {
    listAdmin: vi.fn(),
    toggleAdminStatus: vi.fn(),
  },
}));

vi.mock("../../api/notificationsApi", () => ({
  notificationsApi: {
    getReminderSettings: vi.fn(),
    updateReminderSettings: vi.fn(),
  },
}));

const usersFixture = [
  {
    id: 1,
    companyName: "Master Company",
    login: "master_admin",
    role: "Администратор",
    roleKey: "admin",
    status: "активен",
  },
  {
    id: 2,
    companyName: "Slave Company",
    login: "slave_user",
    role: "Пользователь",
    roleKey: "user",
    status: "активен",
  },
];

const companiesFixture = [
  {
    id: 2,
    name: "Slave Company",
    adminLogin: "slave_admin",
    usersCount: 3,
    status: "активен",
  },
];

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    outletUser = {
      id: 1,
      companyType: "master",
      companyName: "Master Company",
      login: "master_admin",
    };

    locationMock = {
      key: "admin-test-key",
    };

    usersApi.listAdmin.mockResolvedValue(usersFixture);
    companiesApi.listAdmin.mockResolvedValue(companiesFixture);

    usersApi.toggleAdminStatus.mockImplementation(async (id) => ({
      ...usersFixture.find((user) => String(user.id) === String(id)),
      status: "неактивен",
    }));

    companiesApi.toggleAdminStatus.mockImplementation(async (id) => ({
      ...companiesFixture.find((company) => String(company.id) === String(id)),
      status: "неактивен",
    }));

    notificationsApi.getReminderSettings.mockResolvedValue({
      companyName: "Master Company",
      enabled: true,
      intervalLabel: "30 мин.",
      intervalMinutes: 30,
      channels: {
        inside: true,
        email: false,
      },
    });

    notificationsApi.updateReminderSettings.mockImplementation(async (payload) => payload);
  });

  it("master admin видит пользователей и вкладку компаний", async () => {
    render(<AdminPage />);

    expect(await screen.findByText("master_admin")).toBeInTheDocument();
    expect(screen.getByText("slave_user")).toBeInTheDocument();
    expect(screen.getByText("Компании")).toBeInTheDocument();

    expect(usersApi.listAdmin).toHaveBeenCalled();
    expect(companiesApi.listAdmin).toHaveBeenCalled();
  });

  it("slave admin не видит вкладку компаний и видит только пользователей своей компании", async () => {
    outletUser = {
      id: 3,
      companyType: "slave",
      companyName: "Slave Company",
      login: "slave_admin",
    };

    render(<AdminPage />);

    expect(await screen.findByText("slave_user")).toBeInTheDocument();
    expect(screen.queryByText("master_admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Компании")).not.toBeInTheDocument();

    expect(companiesApi.listAdmin).not.toHaveBeenCalled();
  });

  it("кнопка добавления пользователя ведёт на /admin/users/new", async () => {
    render(<AdminPage />);

    await screen.findByText("master_admin");

    fireEvent.click(screen.getByText("+ Добавить пользователя"));

    expect(navigateMock).toHaveBeenCalledWith("/admin/users/new");
  });

  it("кнопка Изменить пользователя ведёт на форму редактирования", async () => {
    render(<AdminPage />);

    await screen.findByText("slave_user");

    const editButtons = screen.getAllByText("Изменить");
    fireEvent.click(editButtons[1]);

    expect(navigateMock).toHaveBeenCalledWith("/admin/users/new?userId=2");
  });

  it("toggle статуса пользователя вызывает usersApi.toggleAdminStatus", async () => {
    render(<AdminPage />);

    await screen.findByText("slave_user");

    const statusButtons = screen.getAllByTitle("Переключить статус");
    fireEvent.click(statusButtons[1]);

    await waitFor(() => {
      expect(usersApi.toggleAdminStatus).toHaveBeenCalledWith(2);
    });
  });

  it("master admin открывает вкладку компаний и видит список компаний", async () => {
    render(<AdminPage />);

    await screen.findByText("master_admin");

    fireEvent.click(screen.getByText("Компании"));

    expect(await screen.findByText("Slave Company")).toBeInTheDocument();
    expect(screen.getByText("slave_admin")).toBeInTheDocument();
    expect(screen.getByText("+ Добавить компанию")).toBeInTheDocument();
  });

  it("кнопка добавления компании ведёт на /admin/companies/new", async () => {
    render(<AdminPage />);

    await screen.findByText("master_admin");

    fireEvent.click(screen.getByText("Компании"));
    fireEvent.click(screen.getByText("+ Добавить компанию"));

    expect(navigateMock).toHaveBeenCalledWith("/admin/companies/new");
  });

  it("toggle статуса компании вызывает companiesApi.toggleAdminStatus", async () => {
    render(<AdminPage />);

    await screen.findByText("master_admin");

    fireEvent.click(screen.getByText("Компании"));

    const statusButton = screen.getByTitle("Переключить статус");
    fireEvent.click(statusButton);

    await waitFor(() => {
      expect(companiesApi.toggleAdminStatus).toHaveBeenCalledWith(2);
    });
  });

  it("загружает настройки напоминаний для master", async () => {
    render(<AdminPage />);

    expect(await screen.findByText("Напоминания")).toBeInTheDocument();

    expect(notificationsApi.getReminderSettings).toHaveBeenCalledWith({
      companyName: "Master Company",
    });
  });

  it("изменение интервала напоминаний сохраняет настройки", async () => {
    render(<AdminPage />);

    await screen.findByText("Напоминания");

    fireEvent.click(screen.getByText("1 час"));

    await waitFor(() => {
      expect(notificationsApi.updateReminderSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          intervalLabel: "1 час",
          intervalMinutes: 60,
          channels: expect.objectContaining({
            inside: true,
            email: false,
          }),
        })
      );
    });
  });
});