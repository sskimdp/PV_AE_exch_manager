const ACCESS_TOKEN_KEY = "reccon_access_token";
const REFRESH_TOKEN_KEY = "reccon_refresh_token";

export const tokenStorage = {
  getAccessToken() {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  },

  getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || "";
  },

  setTokens({ access = "", refresh = "" } = {}) {
    if (access) {
      localStorage.setItem(ACCESS_TOKEN_KEY, access);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    }

    if (refresh) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },

  clear() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};
