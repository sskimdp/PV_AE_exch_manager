import { request } from "./http";
import { mapCompany } from "./adapters";

export const companiesApi = {
  async list(params = {}) {
    const companies = await request("/companies/", { query: params });
    return Array.isArray(companies) ? companies.map(mapCompany) : [];
  },

  async listAdmin() {
    const companies = await request("/admin/companies/");
    return Array.isArray(companies) ? companies : [];
  },

  async getAdminById(companyId) {
    return request(`/admin/companies/${companyId}/`);
  },

  async createAdmin(payload) {
    return request("/admin/companies/", {
      method: "POST",
      body: payload,
    });
  },

  async updateAdmin(companyId, payload) {
    return request(`/admin/companies/${companyId}/`, {
      method: "PATCH",
      body: payload,
    });
  },

  async toggleAdminStatus(companyId) {
    return request(`/admin/companies/${companyId}/toggle-status/`, {
      method: "POST",
    });
  },
};