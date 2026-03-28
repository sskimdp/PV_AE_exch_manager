const pad = (value) => String(value).padStart(2, '0');

const norm = (value) => String(value || '').trim().toLowerCase();

export const formatDisplayDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};

export const formatDisplayDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDisplayDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const mapBackendUserToAppUser = (user) => {
  const companyName =
    user?.company?.name ??
    user?.company_name ??
    user?.companyName ??
    '—';

  const companyId =
    user?.company?.id ??
    user?.company_id ??
    user?.companyId ??
    null;

  const rawCompanyType =
    user?.company?.company_type ??
    user?.company_type ??
    user?.companyType ??
    user?.company?.type ??
    '';

  return {
    id: user?.id ?? null,
    login: user?.username || '',
    username: user?.username || '',
    companyName,
    company: companyName,
    companyId,
    companyType: norm(rawCompanyType),
    isAdmin: Boolean(user?.is_company_admin),
    isCompanyAdmin: Boolean(user?.is_company_admin),
    avatarUrl:
      user?.avatar_data_url ??
      user?.avatarDataUrl ??
      user?.avatarUrl ??
      user?.avatar ??
      '',
    avatarDataUrl:
      user?.avatar_data_url ??
      user?.avatarDataUrl ??
      user?.avatarUrl ??
      user?.avatar ??
      '',
  };
};

const mapAttachment = (attachment) => ({
  id: attachment.id,
  name: attachment.filename,
  filename: attachment.filename,
  size: attachment.size,
  status: attachment.status,
  url: `/api/attachments/${attachment.id}/download/`,
  downloadUrl: `/api/attachments/${attachment.id}/download/`,
});

const mapMessageStatus = (status) => {
  switch (status) {
    case 'draft':
      return 'Черновик';
    case 'pending':
      return 'Ожидает подтверждения';
    case 'read':
      return 'Прочитано';
    case 'confirmed':
      return 'Подтверждено';
    default:
      return status || '';
  }
};

export const mapInboxMessage = (message) => ({
  id: message.id,
  company: message.sender_company_name || '',
  senderCompany: message.sender_company_name || '',
  recipientCompany: '',
  subject: message.subject || '',
  text: message.body || '',
  bodyPreview: message.body_preview || '',
  status: mapMessageStatus(message.status),
  number: message.display_number || '',
  outgoingNumber: message.sender_number || '',
  incomingNumber: message.receiver_number || '',
  sentAt: message.created_at || '',
  readAt: message.read_at || '',
  confirmedAt: message.confirmed_at || '',
  updatedAt: message.confirmed_at || message.read_at || message.created_at || '',
  statusChangedAt: message.confirmed_at || message.read_at || message.created_at || '',
  date: formatDisplayDate(message.created_at),
  attachments: Array.isArray(message.attachments) ? message.attachments.map(mapAttachment) : [],
});

export const mapSentMessage = (message) => ({
  id: message.id,
  company: message.receiver_company_name || '',
  senderCompany: '',
  recipientCompany: message.receiver_company_name || '',
  subject: message.subject || '',
  text: message.body || '',
  bodyPreview: message.body_preview || '',
  status: mapMessageStatus(message.status),
  number: message.display_number || '',
  outgoingNumber: message.sender_number || '',
  incomingNumber: message.receiver_number || '',
  sentAt: message.created_at || '',
  readAt: message.read_at || '',
  confirmedAt: message.confirmed_at || '',
  updatedAt: message.confirmed_at || message.read_at || message.created_at || '',
  statusChangedAt: message.confirmed_at || message.read_at || message.created_at || '',
  date: formatDisplayDate(message.created_at),
  attachments: Array.isArray(message.attachments) ? message.attachments.map(mapAttachment) : [],
});

export const mapDraft = (draft, companyName = '') => ({
  id: draft.id,
  company: companyName,
  recipientCompany: '',
  subject: draft.subject || '',
  text: draft.body || '',
  html: draft.body || '',
  status: 'Черновик',
  createdAt: draft.created_at || '',
  updatedAt: draft.updated_at || draft.created_at || '',
  date: formatDisplayDate(draft.updated_at || draft.created_at),
  attachments: Array.isArray(draft.attachments) ? draft.attachments.map(mapAttachment) : [],
});

export const mapCompany = (company) => ({
  id: company.id,
  name: company.name,
  companyType: company.company_type,
  masterPartnerId: company.master_partner_id ?? null,
  masterPartnerName: company.master_partner_name || '',
  createdAt: company.created_at || '',
});

export const mapReconciliation = (reconciliation) => ({
  id: reconciliation.id,
  company: reconciliation.slave_company?.name || '',
  initiator: reconciliation.master_company?.name || '',
  periodFrom: formatDisplayDate(reconciliation.period_start),
  periodTo: formatDisplayDate(reconciliation.period_end),
  status: reconciliation.status === 'finished' ? 'завершена' : 'активна',
  currentStageNumber: reconciliation.current_stage_number || reconciliation.current_stage?.stage_number || 1,
  createdAt: reconciliation.created_at || '',
  updatedAt: reconciliation.finished_at || reconciliation.created_at || '',
  finishedAt: reconciliation.finished_at || '',
  date: formatDisplayDate(reconciliation.created_at),
  stages: Array.isArray(reconciliation.stages)
    ? reconciliation.stages.map((stage) => ({
        number: stage.stage_number,
        createdAt: stage.created_at || '',
        isCompleted: stage.status === 'finished',
        completedAt: stage.finished_at || '',
        messages: Array.isArray(stage.items)
          ? stage.items.map((item) => ({
              id: item.id,
              number: '',
              subject: item.subject_snapshot || '',
              text: '',
              status: mapMessageStatus(item.status_snapshot),
              sentAt: formatDisplayDateTime(item.sent_at_snapshot),
              confirmedAt: item.confirmed_at_snapshot ? formatDisplayDateTime(item.confirmed_at_snapshot) : '',
              stageReviewed: Boolean(item.confirmed_by_slave),
              stageReviewedAt: item.confirmed_by_slave_at || '',
              stageNumber: stage.stage_number,
              isLateForPeriod: false,
            }))
          : [],
      }))
    : [],
  chatMessages: Array.isArray(reconciliation.chat_messages) ? reconciliation.chat_messages : [],
});