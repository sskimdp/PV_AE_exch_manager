import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config", () => ({
  API_BASE_URL: "https://example.com/api",
}));

vi.mock("./tokenStorage", () => ({
  tokenStorage: {
    getAccessToken: vi.fn(),
    getRefreshToken: vi.fn(),
    setTokens: vi.fn(),
    clear: vi.fn(),
  },
}));

import { request, ApiError } from "./http";
import { tokenStorage } from "./tokenStorage";

describe("http request helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("добавляет Authorization header, если есть access token", async () => {
    tokenStorage.getAccessToken.mockReturnValue("access-token");

    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await request("/messages/summary/");

    const [, options] = fetch.mock.calls[0];
    expect(options.headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("JSON body отправляется с Content-Type application/json", async () => {
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await request("/test/", {
      method: "POST",
      body: { a: 1 },
    });

    const [, options] = fetch.mock.calls[0];
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(options.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("FormData отправляется без ручного Content-Type", async () => {
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const formData = new FormData();
    formData.append("file", new File(["x"], "x.pdf"));

    await request("/upload/", {
      method: "POST",
      body: formData,
    });

    const [, options] = fetch.mock.calls[0];
    expect(options.headers.has("Content-Type")).toBe(false);
    expect(options.body).toBe(formData);
  });

  it("возвращает data из backend-обертки { ok, data }", async () => {
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { value: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await request("/wrapped/");

    expect(result).toEqual({ value: 123 });
  });

  it("возвращает payload как есть, если нет обертки", async () => {
    fetch.mockResolvedValue(
      new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await request("/list/");

    expect(result).toEqual([{ id: 1 }]);
  });

  it("при ошибке выбрасывает ApiError со статусом", async () => {
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(request("/forbidden/")).rejects.toBeInstanceOf(ApiError);
    await expect(request("/forbidden/")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("при 401 обновляет access token и повторяет запрос", async () => {
    tokenStorage.getAccessToken.mockReturnValue("old-access");
    tokenStorage.getRefreshToken.mockReturnValue("refresh-token");

    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access: "new-access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const result = await request("/protected/");

    expect(result).toEqual({ ok: true });
    expect(tokenStorage.setTokens).toHaveBeenCalledWith({
      access: "new-access",
      refresh: "refresh-token",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("если refresh не удался, очищает токены", async () => {
    tokenStorage.getAccessToken.mockReturnValue("old-access");
    tokenStorage.getRefreshToken.mockReturnValue("refresh-token");

    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Refresh failed" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      );

    await expect(request("/protected/")).rejects.toBeInstanceOf(ApiError);
    expect(tokenStorage.clear).toHaveBeenCalled();
  });

  it("при ACCOUNT_DEACTIVATED отправляет событие", async () => {
    const listener = vi.fn();
    window.addEventListener("reccon:account-deactivated", listener);

    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "ACCOUNT_DEACTIVATED",
          detail: "Вы были деактивированы от системы",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        }
      )
    );

    await expect(request("/me/")).rejects.toBeInstanceOf(ApiError);

    expect(listener).toHaveBeenCalled();

    window.removeEventListener("reccon:account-deactivated", listener);
  });
});