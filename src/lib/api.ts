import type {
  ActivityLog,
  AiDiagnosticsReport,
  ApprovalItem,
  AutomationTask,
  BackupRecord,
  ChatMessage,
  Conversation,
  CrmMetrics,
  ErrorReport,
  GeminiModelId,
  IntegrationStatus,
  OpportunityItem,
  OutreachTarget,
  PresentationRecord,
  ProjectRecord,
  StorageHealthInfo,
  TestPassResult,
  WhopAnalytics,
} from '../types';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  getStatus: () =>
    requestJson<{
      integrations: IntegrationStatus;
      settings: Record<string, string>;
      metrics: CrmMetrics;
    }>('/api/status'),

  saveSettings: (patch: Record<string, string | number | boolean>) =>
    requestJson<{ ok: boolean; settings: Record<string, string>; integrations: IntegrationStatus }>(
      '/api/settings',
      { method: 'POST', body: JSON.stringify(patch) }
    ),

  testGemini: (model?: GeminiModelId) =>
    requestJson<{
      ok: boolean;
      model: GeminiModelId;
      modelUsed?: GeminiModelId;
      latencyMs: number;
      reply?: string;
      error?: string;
    }>('/api/ai/test', { method: 'POST', body: JSON.stringify({ model }) }),

  runAiDiagnostics: (model?: GeminiModelId) =>
    requestJson<AiDiagnosticsReport>('/api/ai/diagnostics', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),

  // Conversations & Chat
  listConversations: () => requestJson<{ conversations: Conversation[] }>('/api/conversations'),
  createConversation: (title?: string) =>
    requestJson<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  listMessages: (conversationId: string) =>
    requestJson<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`),
  sendChat: (payload: {
    conversationId: string;
    content: string;
    attachmentName?: string;
    attachmentText?: string;
    useWebSearch?: boolean;
  }) =>
    requestJson<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Research & Discovery
  listOpportunities: () => requestJson<{ opportunities: OpportunityItem[] }>('/api/research/opportunities'),
  discoverOpportunities: (query: string) =>
    requestJson<{ batchId: string; opportunities: OpportunityItem[] }>('/api/research/discover', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  selectOpportunity: (id: string, priorityOrder: number) =>
    requestJson<{ project: ProjectRecord }>(`/api/research/opportunities/${id}/select`, {
      method: 'POST',
      body: JSON.stringify({ priorityOrder }),
    }),

  // Projects & 3-Pass Testing
  listProjects: () => requestJson<{ projects: ProjectRecord[] }>('/api/projects'),
  buildProject: (id: string) =>
    requestJson<{ project: ProjectRecord; files: Record<string, string> }>(`/api/projects/${id}/build`, {
      method: 'POST',
    }),
  testProject: (id: string) =>
    requestJson<{ project: ProjectRecord; testResults: TestPassResult[] }>(`/api/projects/${id}/test`, {
      method: 'POST',
    }),
  getProjectFiles: (id: string) => requestJson<{ files: Record<string, string> }>(`/api/projects/${id}/files`),
  saveProjectFile: (id: string, file: string, content: string) =>
    requestJson<{ ok: boolean; files: Record<string, string> }>(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: JSON.stringify({ file, content }),
    }),
  approveProjectMarketing: (id: string) =>
    requestJson<{ project: ProjectRecord }>(`/api/projects/${id}/approve-marketing`, {
      method: 'POST',
    }),
  checkProjectHealth: (id: string) =>
    requestJson<{
      project: ProjectRecord;
      check: { ok: boolean; statusCode: number | null; target: string; error?: string };
    }>(`/api/projects/${id}/health-check`, { method: 'POST' }),

  // Error Diagnosis & Repair
  listErrors: () => requestJson<{ errors: ErrorReport[] }>('/api/errors'),
  logProjectError: (projectId: string, component: string, errorMessage: string) =>
    requestJson<{ report: ErrorReport }>(`/api/projects/${projectId}/errors`, {
      method: 'POST',
      body: JSON.stringify({ component, errorMessage }),
    }),
  diagnoseError: (errorId: string) =>
    requestJson<{ report: ErrorReport; approval: ApprovalItem }>(`/api/errors/${errorId}/diagnose`, {
      method: 'POST',
    }),
  rollbackError: (errorId: string) =>
    requestJson<{ report: ErrorReport }>(`/api/errors/${errorId}/rollback`, { method: 'POST' }),

  // Outreach (Instagram & Discord)
  listOutreach: (platform?: 'instagram' | 'discord') =>
    requestJson<{ targets: OutreachTarget[] }>(
      platform ? `/api/outreach?platform=${platform}` : '/api/outreach'
    ),
  researchOutreach: (payload: {
    platform: 'instagram' | 'discord';
    niche: string;
    projectId?: string;
    productName?: string;
    productDescription?: string;
  }) =>
    requestJson<{ targets: OutreachTarget[] }>('/api/outreach/research', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOutreach: (
    id: string,
    patch: Partial<Pick<OutreachTarget, 'draftMessage' | 'followStatus' | 'deliveryStatus'>>
  ) =>
    requestJson<{ target: OutreachTarget }>(`/api/outreach/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  requestOutreachApproval: (id: string) =>
    requestJson<{ approval: ApprovalItem }>(`/api/outreach/${id}/request-approval`, {
      method: 'POST',
    }),

  // Approvals
  listApprovals: () => requestJson<{ approvals: ApprovalItem[] }>('/api/approvals'),
  createApproval: (payload: {
    category: ApprovalItem['category'];
    title: string;
    target: string;
    proposedAction: string;
    consequences: string;
    payload?: Record<string, unknown>;
  }) =>
    requestJson<{ approval: ApprovalItem }>('/api/approvals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideApproval: (id: string, decision: 'approve' | 'reject') =>
    requestJson<{ approval: ApprovalItem }>(`/api/approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),

  // Integrations
  getWhopAnalytics: () => requestJson<WhopAnalytics>('/api/integrations/whop/analytics'),
  testSupabase: () =>
    requestJson<{ connected: boolean; message: string; projectHost?: string }>(
      '/api/integrations/supabase/test',
      { method: 'POST' }
    ),
  generateSupabaseMigration: (projectName: string, schemaDescription: string) =>
    requestJson<{ upSql: string; downSql: string; notes: string }>(
      '/api/integrations/supabase/migration',
      { method: 'POST', body: JSON.stringify({ projectName, schemaDescription }) }
    ),
  listVercelProjects: () =>
    requestJson<{
      connected: boolean;
      projects: Array<{ id: string; name: string; framework: string | null; updatedAt: number; liveUrl: string | null }>;
      error?: string;
    }>('/api/integrations/vercel/projects'),

  // Presentations
  listPresentations: () => requestJson<{ presentations: PresentationRecord[] }>('/api/presentations'),
  generatePresentation: (payload: {
    title: string;
    audience: string;
    objective: string;
    context?: string;
    slideCount?: number;
    projectId?: string;
  }) =>
    requestJson<{ presentation: PresentationRecord }>('/api/presentations/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deletePresentation: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/presentations/${id}`, { method: 'DELETE' }),

  // Automations & Weekly Maintenance
  listAutomations: () => requestJson<{ automations: AutomationTask[] }>('/api/automations'),
  createAutomation: (payload: {
    name: string;
    description: string;
    taskType: AutomationTask['taskType'];
    intervalMinutes: number;
    approvedByUser: boolean;
  }) =>
    requestJson<{ automation: AutomationTask }>('/api/automations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAutomation: (id: string, patch: { enabled?: boolean; approvedByUser?: boolean }) =>
    requestJson<{ automation: AutomationTask }>(`/api/automations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  runAutomation: (id: string) =>
    requestJson<{ automation: AutomationTask }>(`/api/automations/${id}/run`, { method: 'POST' }),
  runWeeklyMaintenance: () =>
    requestJson<{
      inspectedCount: number;
      plans: Array<{
        projectId: string;
        projectName: string;
        healthStatus: string;
        healthSummary: string;
        dependencyNotes: string;
        proposedImprovements: { title: string; reason: string; riskLevel: string }[];
        approvalsCreated: number;
      }>;
    }>('/api/maintenance/run-all', { method: 'POST' }),

  // CRM & Activity
  getCrmSummary: () =>
    requestJson<{
      metrics: CrmMetrics;
      projects: ProjectRecord[];
      approvals: ApprovalItem[];
      errors: ErrorReport[];
      activity: ActivityLog[];
    }>('/api/crm/summary'),
  listActivity: (limit = 120) => requestJson<{ logs: ActivityLog[] }>(`/api/activity?limit=${limit}`),

  // Local JSON Storage, Backups & Portable Export/Restore
  getStorageInfo: () => requestJson<{ storage: StorageHealthInfo }>('/api/storage/info'),
  createStorageBackup: (reason = 'manual') =>
    requestJson<{ backup: BackupRecord; storage: StorageHealthInfo }>('/api/storage/backup', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  restoreLocalBackup: (filename: string) =>
    requestJson<{ ok: boolean; restoredCollections: number; safetyBackup: BackupRecord; storage: StorageHealthInfo }>(
      '/api/storage/restore',
      { method: 'POST', body: JSON.stringify({ filename }) }
    ),
  importPortableArchive: (archive: unknown) =>
    requestJson<{ ok: boolean; restoredCollections: number; safetyBackup: BackupRecord; storage: StorageHealthInfo }>(
      '/api/storage/import',
      { method: 'POST', body: JSON.stringify(archive) }
    ),
};
