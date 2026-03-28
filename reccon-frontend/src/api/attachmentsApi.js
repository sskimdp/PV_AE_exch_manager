import { request } from "./http";

export const attachmentsApi = {
  async list() {
    const result = await request('/attachments/');
    return Array.isArray(result) ? result : [];
  },

  async delete(attachmentId) {
    return request(`/attachments/${attachmentId}/`, { method: 'DELETE' });
  },

  async download(attachmentId) {
    const response = await request(`/attachments/${attachmentId}/download/`, { raw: true });
    return response.blob();
  },
};
