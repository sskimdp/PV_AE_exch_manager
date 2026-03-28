import { API_BASE_URL } from "./config";
import { tokenStorage } from "./tokenStorage";

class ApiError extends Error {
  constructor(message, { status = 500, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const buildUrl = (path, query) => {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${cleanPath}`, window.location.origin);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
};

const tryParseJson = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
};

const extractErrorMessage = (payload, fallback) => {
  if (!payload) return fallback;

  if (typeof payload === "string") return payload;
  if (payload.detail) return String(payload.detail);
  if (payload.message) return String(payload.message);

  const firstValue = Object.values(payload)[0];
  if (Array.isArray(firstValue) && firstValue.length > 0) {
    return String(firstValue[0]);
  }

  if (typeof firstValue === "string") return firstValue;
  return fallback;
};

const refreshAccessToken = async () => {
  const refresh = tokenStorage.getRefreshToken();
  if (!refresh) {
    throw new ApiError("Сессия истекла.", { status: 401 });
  }

  const response = await fetch(buildUrl('/auth/refresh/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });

  const payload = await tryParseJson(response);
  if (!response.ok || !payload?.access) {
    tokenStorage.clear();
    throw new ApiError(extractErrorMessage(payload, 'Не удалось обновить сессию.'), {
      status: response.status || 401,
      details: payload,
    });
  }

  tokenStorage.setTokens({ access: payload.access, refresh });
  return payload.access;
};

export const request = async (path, options = {}) => {
  const {
    method = 'GET',
    body,
    query,
    headers = {},
    auth = true,
    raw = false,
    retry = true,
  } = options;

  const finalHeaders = new Headers(headers);
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (!isFormData && body != null && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  if (auth) {
    const access = tokenStorage.getAccessToken();
    if (access) {
      finalHeaders.set('Authorization', `Bearer ${access}`);
    }
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: finalHeaders,
    body: body == null ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (response.status === 401 && auth && retry && tokenStorage.getRefreshToken()) {
    try {
      const nextAccess = await refreshAccessToken();
      return request(path, {
        ...options,
        retry: false,
        headers: { ...headers, Authorization: `Bearer ${nextAccess}` },
      });
    } catch (error) {
      tokenStorage.clear();
      throw error;
    }
  }

  if (raw) {
    if (!response.ok) {
      const payload = await tryParseJson(response);
      throw new ApiError(extractErrorMessage(payload, 'Ошибка запроса.'), {
        status: response.status,
        details: payload,
      });
    }
    return response;
  }

  const payload = await tryParseJson(response);

  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, 'Ошибка запроса.'), {
      status: response.status,
      details: payload,
    });
  }

  if (payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload) {
    return payload.data;
  }

  return payload;
};

export { ApiError };
