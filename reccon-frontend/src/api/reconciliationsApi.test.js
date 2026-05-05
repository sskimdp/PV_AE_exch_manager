import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./http", () => ({
  request: vi.fn(),
}));

import { request } from "./http";
import { reconciliationsApi, mapReconciliation } from "./reconciliationsApi";

describe("reconciliationsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    window.URL.createObjectURL = vi.fn(() => "blob:test");
    window.URL.revokeObjectURL = vi.fn();

    document.body.innerHTML = "";
  });

  it("list вызывает GET /reconciliations/ и маппит список", async () => {
    request.mockResolvedValue([
      {
        id: 1,
        slave_company: { name: "Slave Company" },
        master_company: { name: "Master Company" },
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        status: "active",
      },
    ]);

    const result = await reconciliationsApi.list();

    expect(request).toHaveBeenCalledWith("/reconciliations/");
    expect(result[0].id).toBe(1);
    expect(result[0].company).toBe("Slave Company");
    expect(result[0].status).toBe("Активна");
  });

  it("getById вызывает GET /reconciliations/{id}/", async () => {
    request.mockResolvedValue({
      id: 5,
      slave_company: { name: "Slave" },
      master_company: { name: "Master" },
    });

    const result = await reconciliationsApi.getById(5);

    expect(request).toHaveBeenCalledWith("/reconciliations/5/");
    expect(result.id).toBe(5);
  });

  it("create отправляет backend-поля и возвращает mapped reconciliation", async () => {
    request.mockResolvedValue({
      id: 10,
      slave_company: { name: "Slave" },
      master_company: { name: "Master" },
      status: "active",
    });

    const result = await reconciliationsApi.create({
      slaveCompanyId: 2,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });

    expect(request).toHaveBeenCalledWith("/reconciliations/", {
      method: "POST",
      body: {
        slave_company: 2,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
      },
    });
    expect(result.id).toBe(10);
  });

  it("bulkConfirm отправляет item_ids", async () => {
    await reconciliationsApi.bulkConfirm(3, [1, 2]);

    expect(request).toHaveBeenCalledWith("/reconciliations/3/bulk-confirm/", {
      method: "POST",
      body: { item_ids: [1, 2] },
    });
  });

  it("sendChatMessage отправляет text и stage_number", async () => {
    request.mockResolvedValue({
      id: 1,
      text: "hello",
      stage_number: 2,
    });

    const result = await reconciliationsApi.sendChatMessage(3, {
      text: "hello",
      stageNumber: 2,
    });

    expect(request).toHaveBeenCalledWith("/reconciliations/3/chat/", {
      method: "POST",
      body: {
        text: "hello",
        stage_number: 2,
      },
    });
    expect(result.text).toBe("hello");
    expect(result.stageNumber).toBe(2);
  });

  it("createNewStage вызывает endpoint нового этапа", async () => {
    request.mockResolvedValue({ id: 3, current_stage_number: 2 });

    await reconciliationsApi.createNewStage(3);

    expect(request).toHaveBeenCalledWith("/reconciliations/3/new-stage/", {
      method: "POST",
    });
  });

  it("finish вызывает endpoint завершения сверки", async () => {
    request.mockResolvedValue({ id: 3, status: "finished" });

    const result = await reconciliationsApi.finish(3);

    expect(request).toHaveBeenCalledWith("/reconciliations/3/finish/", {
      method: "POST",
    });
    expect(result.status).toBe("Завершена");
  });

  it("exportStage вызывает raw download с scope=stage", async () => {
    const blob = new Blob(["xlsx"]);
    request.mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="stage.xlsx"',
        },
      })
    );

    const link = document.createElement("a");
    const click = vi.spyOn(link, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue(link);

    await reconciliationsApi.exportStage(7, 2);

    expect(request).toHaveBeenCalledWith("/reconciliations/7/export/", {
      method: "GET",
      query: {
        scope: "stage",
        stage_number: 2,
      },
      raw: true,
    });
    expect(click).toHaveBeenCalled();
  });

  it("exportAllStages вызывает raw download с scope=all", async () => {
    const blob = new Blob(["xlsx"]);
    request.mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="all.xlsx"',
        },
      })
    );

    const link = document.createElement("a");
    const click = vi.spyOn(link, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue(link);

    await reconciliationsApi.exportAllStages(7);

    expect(request).toHaveBeenCalledWith("/reconciliations/7/export/", {
      method: "GET",
      query: {
        scope: "all",
      },
      raw: true,
    });
    expect(click).toHaveBeenCalled();
  });

  it("toBackendDate переводит dd.mm.yyyy в yyyy-mm-dd", () => {
    expect(reconciliationsApi.toBackendDate("08.05.2026")).toBe("2026-05-08");
    expect(reconciliationsApi.toBackendDate("wrong")).toBe("");
  });

  it("mapReconciliation отображает пустую тему как пустую строку на уровне API-маппера", () => {
    const result = mapReconciliation({
      id: 1,
      stages: [
        {
          stage_number: 1,
          items: [{ id: 1, subject: "", status: "pending" }],
        },
      ],
    });

    expect(result.stages[0].messages[0].subject).toBe("");
  });
});