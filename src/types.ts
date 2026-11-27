export type WorkspaceSection =
  | 'assistant'
  | 'crm'
  | 'projects'
  | 'research'
  | 'automation'
  | 'presentations'
  | 'history'
  | 'settings';

export type AgentTaskState =
  | 'idle'
  | 'thinking'
  | 'researching'
  | 'waiting_for_approval'
  | 'executing'
  | 'testing'
  | 'completed'
  | 'failed'
  | 'paused';

export type GeminiModelId = 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen' | string;

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ExecutedToolAction {
  name: string;
  summary: string;
  status: 'success' | 'error';
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  taskState?: AgentTaskState;
  sources?: GroundingSource[];
  executedTools?: ExecutedToolAction[];
  modelUsed?: string;
  attachmentName?: string;
  createdAt: string;
}

export interface OpportunityItem {
  id: string;
  batchId: string;
  query: string;
  rankIndex: number;
  productIdea: string;
  problemSolved: string;
  verifiedEvidence: string;
  assumptionsAndEstimates: string;
  targetAudience: string;
  competitors: string;
  proposedSolution: string;
  coreFeatures: string[];
  technicalComplexity: 'Low' | 'Medium' | 'High';
  estimatedEffort: string;
  monetizationStrategy: string;
  risks: string;
  whyWorthBuilding: string;
  isRecommended: boolean;
  recommendationReason: string;
  sources: GroundingSource[];
  priorityOrder: number | null;
  status: 'discovered' | 'selected' | 'in_development' | 'completed';
  createdAt: string;
}

export interface ProductPRD {
  productNames: string[];
  recommendedName: string;
  executiveSummary: string;
  targetAudience: string;
  userPersonas: { name: string; role: string; painPoint: string; goal: string }[];
  userJourneys: string[];
  featureList: { name: string; priority: 'Core' | 'Secondary'; description: string }[];
  competitorAnalysis: string;
  uxPlan: string;
  technicalArchitecture: string;
  databaseDesign: string;
  milestones: { phase: string; deliverables: string; estimate: string }[];
  risksAndAssumptions: string[];
}

export interface TestPassResult {
  passNumber: 1 | 2 | 3;
  name: string;
  status: 'passed' | 'failed' | 'partial' | 'skipped' | 'not_run';
  executedAt: string;
  checks: { name: string; status: 'passed' | 'failed' | 'skipped'; details: string }[];
  summary: string;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  opportunityId: string | null;
  description: string;
  folderPath: string;
  techStack: string;
  status: 'prd_review' | 'building' | 'testing' | 'handover_ready' | 'approved' | 'deployed' | 'error';
  prd: ProductPRD | null;
  liveUrl: string | null;
  previewUrl: string | null;
  deploymentStatus: 'not_deployed' | 'pending_approval' | 'deployed' | 'failed';
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'error';
  lastHealthCheck: string | null;
  dbStatus: 'not_configured' | 'local_json' | 'supabase_connected' | 'error';
  recentErrors: string | null;
  testResults: TestPassResult[];
  userApprovedForMarketing: boolean;
  lastDeployedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachTarget {
  id: string;
  projectId: string | null;
  platform: 'instagram' | 'discord';
  name: string;
  profileOrInviteUrl: string;
  niche: string;
  contentCategory: string;
  publicFollowersOrSize: string;
  audienceRelevance: string;
  publicContactOrRules: string;
  promotionPermitted: string;
  relevanceRank: number;
  draftMessage: string;
  followStatus: 'not_started' | 'manual_required' | 'verified';
  deliveryStatus:
    | 'researched'
    | 'draft_ready'
    | 'pending_approval'
    | 'approved_for_manual_send'
    | 'sent_verified'
    | 'rejected';
  sources: GroundingSource[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalItem {
  id: string;
  category:
    | 'product_build'
    | 'instagram_dm'
    | 'discord_post'
    | 'whop_change'
    | 'supabase_migration'
    | 'vercel_deploy'
    | 'maintenance_upgrade'
    | 'error_repair';
  title: string;
  target: string;
  proposedAction: string;
  consequences: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  executionResult: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PresentationSlide {
  slideNumber: number;
  title: string;
  layout: 'title' | 'bullets' | 'split' | 'metrics' | 'closing';
  keyPoints: string[];
  visualHint: string;
  speakerNotes: string;
}

export interface PresentationRecord {
  id: string;
  projectId: string | null;
  title: string;
  audience: string;
  objective: string;
  slides: PresentationSlide[];
  createdAt: string;
}

export interface AutomationTask {
  id: string;
  name: string;
  description: string;
  taskType: 'health_check' | 'weekly_maintenance_scan' | 'backup_workspace';
  intervalMinutes: number;
  enabled: boolean;
  approvedByUser: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
  lastStatus: 'never_run' | 'success' | 'failed' | 'paused';
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  category: string;
  action: string;
  details: string;
  status: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
}

export interface ErrorReport {
  id: string;
  projectId: string;
  projectName: string;
  component: string;
  errorMessage: string;
  diagnosis: string | null;
  backupPath: string | null;
  proposedFixFile: string | null;
  proposedFixSummary: string | null;
  status: 'open' | 'diagnosed' | 'repaired' | 'rolled_back';
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationStatus {
  gemini: {
    configured: boolean;
    credentialSource: 'environment' | 'local_env_file' | 'unset';
    model: GeminiModelId;
    lastVerifiedAt: string | null;
    lastStatus: 'untested' | 'connected' | 'error';
    lastError: string | null;
  };
  whop: {
    configured: boolean;
    lastVerifiedAt: string | null;
    status: 'disconnected' | 'connected' | 'error';
    error: string | null;
  };
  supabase: {
    configured: boolean;
    urlConfigured: boolean;
    serviceRoleConfigured: boolean;
    status: 'disconnected' | 'connected' | 'error';
    error: string | null;
  };
  vercel: {
    configured: boolean;
    status: 'disconnected' | 'connected' | 'error';
    error: string | null;
  };
  freemodel: {
    status: 'documentation_required';
    note: string;
  };
  instagram: {
    authorizedAccount: string;
    mode: 'guided_manual';
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    electronDetected: boolean;
    memoryUsageMb: number;
    storageEngine: string;
    storagePath: string;
  };
}

export interface BackupRecord {
  filename: string;
  reason: string;
  createdAt: string;
  sizeKb: number;
}

export interface StorageHealthInfo {
  engine: string;
  storeDir: string;
  backupsDir: string;
  totalBytes: number;
  backupCount: number;
  lastBackupAt: string | null;
  files: {
    collection: string;
    filename: string;
    exists: boolean;
    sizeBytes: number;
    recordCount: number;
  }[];
  backups: BackupRecord[];
}

export interface CrmMetrics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  deployedApps: number;
  appsWithErrors: number;
  pendingApprovals: number;
  outreachTotal: number;
  outreachSent: number;
  presentationsCreated: number;
  opportunitiesDiscovered: number;
}

export interface WhopAnalytics {
  connected: boolean;
  reportingPeriod: string;
  lastRefreshedAt: string | null;
  error: string | null;
  products: { id: string; name: string; visibility?: string; planCount?: number }[];
  metrics: {
    totalSales: number | null;
    transactions: number | null;
    revenueUsd: number | null;
    activeSubscriptions: number | null;
    cancellations: number | null;
    refunds: number | null;
  };
}

export interface AiDiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn';
  details: string;
}

export interface AiDiagnosticsReport {
  overallOk: boolean;
  provider: string;
  configuredModel: string;
  activeModelUsed: string | null;
  latencyMs: number;
  checkedAt: string;
  checks: AiDiagnosticCheck[];
}
