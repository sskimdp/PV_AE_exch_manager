import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sidebar from "./Sidebar";

vi.mock("../../utils/storage", () => ({
  storage: {
    getCurrentUser: vi.fn(() => ({ id: 1 })),
    updateUserAvatar: vi.fn(),
  },
}));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("показывает название компании и логин", () => {
    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
      />
    );

    expect(screen.getByText("Slave Company")).toBeInTheDocument();
    expect(screen.getByText("django")).toBeInTheDocument();
  });

  it("для slave показывает Отправленные, Сверка, Черновики и кнопку нового сообщения", () => {
    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
      />
    );

    expect(screen.getByText("Главная")).toBeInTheDocument();
    expect(screen.getByText("Отправленные")).toBeInTheDocument();
    expect(screen.getByText("Сверка")).toBeInTheDocument();
    expect(screen.getByText("Черновики")).toBeInTheDocument();
    expect(screen.getByText("+ Новое сообщение")).toBeInTheDocument();
  });

  it("для master показывает входящие, но не показывает кнопку нового сообщения", () => {
    render(
      <Sidebar
        companyType="master"
        companyName="Master Company"
        login="master"
      />
    );

    expect(screen.getByText("Главная")).toBeInTheDocument();
    expect(screen.getByText("Входящие")).toBeInTheDocument();
    expect(screen.getByText("Сверка")).toBeInTheDocument();
    expect(screen.queryByText("+ Новое сообщение")).not.toBeInTheDocument();
  });

  it("показывает счетчик черновиков", () => {
    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        counts={{ draftsCount: 6 }}
      />
    );

    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("показывает счетчик неподтвержденных входящих для master", () => {
    render(
      <Sidebar
        companyType="master"
        companyName="Master Company"
        login="master"
        counts={{ inboxUnconfirmed: 3 }}
      />
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("вызывает onNavigate при клике по пункту меню", () => {
    const onNavigate = vi.fn();

    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        onNavigate={onNavigate}
      />
    );

    fireEvent.click(screen.getByText("Отправленные"));

    expect(onNavigate).toHaveBeenCalledWith("sent");
  });

  it("вызывает onCreateMessage при клике по кнопке нового сообщения", () => {
    const onCreateMessage = vi.fn();

    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        onCreateMessage={onCreateMessage}
      />
    );

    fireEvent.click(screen.getByText("+ Новое сообщение"));

    expect(onCreateMessage).toHaveBeenCalled();
  });

  it("показывает пункт Администратор только для администратора", () => {
    const { rerender } = render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        isAdmin={false}
      />
    );

    expect(screen.queryByText("Администратор")).not.toBeInTheDocument();

    rerender(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        isAdmin
      />
    );

    expect(screen.getByText("Администратор")).toBeInTheDocument();
  });

  it("вызывает onLogout при клике на Выход", () => {
    const onLogout = vi.fn();

    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        onLogout={onLogout}
      />
    );

    fireEvent.click(screen.getByText("Выход"));

    expect(onLogout).toHaveBeenCalled();
  });

  it("открывает модалку аватара", () => {
    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
      />
    );

    fireEvent.click(screen.getByLabelText("Изменить аватар"));

    expect(screen.getByText("Изменить аватар")).toBeInTheDocument();
    expect(screen.getByText("Выбрать файл")).toBeInTheDocument();
  });

  it("показывает ошибку при выборе недопустимого аватара", async () => {
    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
      />
    );

    fireEvent.click(screen.getByLabelText("Изменить аватар"));

    const input = document.querySelector(".sidebar__fileInput");
    const file = new File(["bad"], "bad.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText("Можно загрузить только PNG, JPG или WebP.")
    ).toBeInTheDocument();
  });

  it("сохраняет аватар через onAvatarChange", async () => {
    const onAvatarChange = vi.fn().mockResolvedValue();

    class MockFileReader {
      readAsDataURL() {
        this.result = "data:image/png;base64,test";
        this.onload();
      }
    }

    vi.stubGlobal("FileReader", MockFileReader);

    render(
      <Sidebar
        companyType="slave"
        companyName="Slave Company"
        login="django"
        onAvatarChange={onAvatarChange}
      />
    );

    fireEvent.click(screen.getByLabelText("Изменить аватар"));

    const input = document.querySelector(".sidebar__fileInput");
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("avatar.png")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Установить"));

    await waitFor(() => {
      expect(onAvatarChange).toHaveBeenCalledWith("data:image/png;base64,test");
    });

    vi.unstubAllGlobals();
  });
});