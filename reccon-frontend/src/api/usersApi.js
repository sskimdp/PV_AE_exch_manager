import { request } from "./http";

export const usersApi = {
  async listAdmin() {
    const users = await request("/admin/users/");
    return Array.isArray(users) ? users : [];
  },

  async getAdminById(userId) {
    return request(`/admin/users/${userId}/`);
  },

  async createAdmin(payload) {
    return request("/admin/users/", {
      method: "POST",
      body: payload,
    });
  },

  async updateAdmin(userId, payload) {
    return request(`/admin/users/${userId}/`, {
      method: "PATCH",
      body: payload,
    });
  },

  async toggleAdminStatus(userId) {
    return request(`/admin/users/${userId}/toggle-status/`, {
      method: "POST",
    });
  },
};