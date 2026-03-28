import { request } from "./http";
import { tokenStorage } from "./tokenStorage";
import { mapBackendUserToAppUser } from "./adapters";

const resolveRawAvatarUrl = (user = {}) => {
  return (
    user?.avatarUrl ??
    user?.avatarDataUrl ??
    user?.avatar_data_url ??
    user?.avatar ??
    ""
  );
};

const resolveRawAvatarDataUrl = (user = {}) => {
  return (
    user?.avatarDataUrl ??
    user?.avatar_data_url ??
    user?.avatarUrl ??
    user?.avatar ??
    ""
  );
};

const mergeUserWithMapped = (rawUser = {}, mappedUser = {}) => {
  const rawAvatarUrl = resolveRawAvatarUrl(rawUser);
  const rawAvatarDataUrl = resolveRawAvatarDataUrl(rawUser);

  return {
    ...rawUser,
    ...mappedUser,
    avatarUrl: mappedUser?.avatarUrl || rawAvatarUrl || "",
    avatarDataUrl: mappedUser?.avatarDataUrl || rawAvatarDataUrl || "",
  };
};

export const authApi = {
  async login({ username, password }) {
    const payload = await request("/auth/login/", {
      method: "POST",
      auth: false,
      body: { username, password },
    });

    tokenStorage.setTokens({
      access: payload.access,
      refresh: payload.refresh,
    });

    return {
      ...payload,
      appUser: mergeUserWithMapped(
        payload.user,
        mapBackendUserToAppUser(payload.user)
      ),
    };
  },

  async me() {
    const user = await request("/auth/me/");
    return {
      user,
      appUser: mergeUserWithMapped(user, mapBackendUserToAppUser(user)),
    };
  },

  async updateMe(payload) {
    const user = await request("/auth/me/", {
      method: "PATCH",
      body: payload,
    });

    return {
      user,
      appUser: mergeUserWithMapped(user, mapBackendUserToAppUser(user)),
    };
  },

  async logout() {
    const refresh = tokenStorage.getRefreshToken();
    if (refresh) {
      try {
        await request("/auth/logout/", {
          method: "POST",
          body: { refresh },
        });
      } finally {
        tokenStorage.clear();
      }
      return;
    }

    tokenStorage.clear();
  },

  clearSession() {
    tokenStorage.clear();
  },
};