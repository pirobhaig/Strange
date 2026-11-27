import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ActivityLog,
  ApprovalItem,
  AutomationTask,
  BackupRecord,
  ChatMessage,
  Conversation,
  CrmMetrics,
  ErrorReport,
  GeminiModelId,
  OpportunityItem,
  OutreachTarget,
  PresentationRecord,
  ProjectRecord,
  StorageHealthInfo,
} from '../types.ts';

export const DATA_DIR = process.env.STRANGE_DATA_DIR
  ? path.resolve(process.env.STRANGE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const STORE_DIR = path.join(DATA_DIR, 'store');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const DB_PATH = STORE_DIR;

fs.mkdirSync(STORE_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

interface StoreSchema {
  settings: Record<string, string>;
  conversations: Conversation[];
  messages: ChatMessage[];
  opportunities: OpportunityItem[];
  projects: ProjectRecord[];
  outreach: OutreachTarget[];
  approvals: ApprovalItem[];
  presentations: PresentationRecord[];
  automations: AutomationTask[];
  activity: ActivityLog[];
  errors: ErrorReport[];
}

type CollectionKey = keyof StoreSchema;

const COLLECTION_FILES: Record<CollectionKey, string> = {
  settings: 'settings.json',
  conversations: 'conversations.json',
  messages: 'messages.json',
  opportunities: 'opportunities.json',
  projects: 'projects.json',
  outreach: 'outreach.json',
  approvals: 'approvals.json',
  presentations: 'presentations.json',
  automations: 'automations.json',
  activity: 'activity.json',
  errors: 'errors.json',
};

// Keys explicitly allowed in non-secret settings.json (API keys are NEVER stored here)
const FORBIDDEN_SECRET_PATTERNS = /api[_-]?key|secret|token|password|service[_-]?role/i;

function getDefaultCollection<K extends CollectionKey>(key: K): StoreSchema[K] {
  if (key === 'settings') return {} as StoreSchema[K];
  return [] as unknown as StoreSchema[K];
}

function validateCollectionData<K extends CollectionKey>(key: K, value: unknown): value is StoreSchema[K] {
  if (key === 'settings') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v !== 'string') return false;
      if (FORBIDDEN_SECRET_PATTERNS.test(k)) return false;
    }
    return true;
  }
  return Array.isArray(value);
}

function resolveStoreFile(key: CollectionKey): string {
  const full = path.resolve(STORE_DIR, COLLECTION_FILES[key]);
  if (!full.startsWith(STORE_DIR + path.sep)) {
    throw new Error('Storage path confinement violation.');
  }
  return full;
}

/**
 * Safe atomic JSON writer:
 * Writes UTF-8 JSON to a unique temp file in the same directory, flushes to disk,
 * and atomically renames over the target file to prevent partial/corrupted writes.
 */
function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized = JSON.stringify(data, null, 2);
  // Validate round-trip JSON before touching disk
  JSON.parse(serialized);
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeSync(fd, serialized, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

function loadCollectionFromDisk<K extends CollectionKey>(key: K): StoreSchema[K] {
  const filePath = resolveStoreFile(key);
  if (!fs.existsSync(filePath)) {
    const initial = getDefaultCollection(key);
    atomicWriteJson(filePath, initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!validateCollectionData(key, parsed)) {
      throw new Error(`Invalid schema in ${COLLECTION_FILES[key]}`);
    }
    return parsed;
  } catch {
    // Attempt automatic recovery from latest valid backup snapshot
    const recovered = tryRecoverCollectionFromLatestBackup(key);
    if (recovered !== null) {
      atomicWriteJson(filePath, recovered);
      return recovered;
    }
    // Preserve corrupted file for forensic inspection and reinitialize cleanly
    try {
      fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      // ignore
    }
    const fallback = getDefaultCollection(key);
    atomicWriteJson(filePath, fallback);
    return fallback;
  }
}

function tryRecoverCollectionFromLatestBackup<K extends CollectionKey>(key: K): StoreSchema[K] | null {
  try {
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const file of files) {
      const full = path.resolve(BACKUPS_DIR, file);
      if (!full.startsWith(BACKUPS_DIR + path.sep)) continue;
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as { data?: Partial<StoreSchema> };
      const candidate = parsed?.data?.[key];
      if (validateCollectionData(key, candidate)) {
        return candidate;
      }
    }
  } catch {
    // no valid backup found
  }
  return null;
}

// In-memory hydrated cache backed immediately by atomic disk writes
const store: StoreSchema = {
  settings: loadCollectionFromDisk('settings'),
  conversations: loadCollectionFromDisk('conversations'),
  messages: loadCollectionFromDisk('messages'),
  opportunities: loadCollectionFromDisk('opportunities'),
  projects: loadCollectionFromDisk('projects'),
  outreach: loadCollectionFromDisk('outreach'),
  approvals: loadCollectionFromDisk('approvals'),
  presentations: loadCollectionFromDisk('presentations'),
  automations: loadCollectionFromDisk('automations'),
  activity: loadCollectionFromDisk('activity'),
  errors: loadCollectionFromDisk('errors'),
};

let lastAutoBackupMs = 0;
const AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LOCAL_BACKUPS = 20;

function persist<K extends CollectionKey>(key: K, triggerAutoBackup = true): void {
  atomicWriteJson(resolveStoreFile(key), store[key]);
  if (triggerAutoBackup && Date.now() - lastAutoBackupMs >= AUTO_BACKUP_INTERVAL_MS) {
    try {
      createAutomaticBackup('auto');
    } catch {
      // keep main operation resilient
    }
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// --- Portable Export, Automatic Backups & Restoration ---
export interface PortableDataBundle {
  format: 'strange-local-json-v1';
  exportedAt: string;
  note: string;
  data: StoreSchema;
}

function sanitizeSettingsForStorage(raw: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!FORBIDDEN_SECRET_PATTERNS.test(k) && typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

export function exportPortableDataBundle(): PortableDataBundle {
  return {
    format: 'strange-local-json-v1',
    exportedAt: nowIso(),
    note: 'Portable STRANGE v1.0 data archive. API credentials are intentionally excluded and stay protected separately in Windows secure storage or server Secrets.',
    data: {
      ...store,
      settings: sanitizeSettingsForStorage(store.settings),
    },
  };
}

export function createAutomaticBackup(reason = 'manual'): BackupRecord {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'snapshot';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup_${stamp}_${safeReason}.json`;
  const fullPath = path.resolve(BACKUPS_DIR, filename);
  if (!fullPath.startsWith(BACKUPS_DIR + path.sep)) {
    throw new Error('Backup path confinement check failed.');
  }
  const bundle = exportPortableDataBundle();
  atomicWriteJson(fullPath, bundle);
  lastAutoBackupMs = Date.now();

  // Prune old backups beyond MAX_LOCAL_BACKUPS
  const all = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const stale of all.slice(MAX_LOCAL_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, stale));
    } catch {
      // ignore
    }
  }

  const stat = fs.statSync(fullPath);
  return {
    filename,
    reason: safeReason,
    createdAt: bundle.exportedAt,
    sizeKb: Math.max(1, Math.round(stat.size / 1024)),
  };
}

export function listBackups(): BackupRecord[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const full = path.join(BACKUPS_DIR, filename);
    const stat = fs.statSync(full);
    const match = filename.match(/^backup_(.+)_([a-z0-9_-]+)\.json$/i);
    const reason = match?.[2] || 'snapshot';
    return {
      filename,
      reason,
      createdAt: stat.mtime.toISOString(),
      sizeKb: Math.max(1, Math.round(stat.size / 1024)),
    };
  });
}

export function validateAndImportBundle(rawBundle: unknown, backupReason = 'pre_import'): {
  restoredCollections: number;
  safetyBackup: BackupRecord;
} {
  if (!rawBundle || typeof rawBundle !== 'object') {
    throw new Error('Invalid backup archive: expected JSON object.');
  }
  const candidate = rawBundle as Partial<PortableDataBundle>;
  if (candidate.format !== 'strange-local-json-v1' || !candidate.data || typeof candidate.data !== 'object') {
    throw new Error('Unsupported archive format. Expected format "strange-local-json-v1".');
  }

  const keys = Object.keys(COLLECTION_FILES) as CollectionKey[];
  const dataRecord = candidate.data as unknown as Record<string, unknown>;
  for (const key of keys) {
    const col = dataRecord[key];
    if (col === undefined) continue;
    if (key === 'settings') {
      if (!col || typeof col !== 'object' || Array.isArray(col)) {
        throw new Error('Validation failed for settings collection.');
      }
    } else if (!Array.isArray(col)) {
      throw new Error(`Validation failed for collection "${key}": expected an array.`);
    }
  }

  // Always snapshot current live data before overwriting
  const safetyBackup = createAutomaticBackup(backupReason);

  let restoredCollections = 0;
  for (const key of keys) {
    const incoming = dataRecord[key];
    if (incoming === undefined) continue;
    if (key === 'settings') {
      store.settings = sanitizeSettingsForStorage(incoming as Record<string, string>);
    } else {
      (store as unknown as Record<string, unknown>)[key] = incoming;
    }
    atomicWriteJson(resolveStoreFile(key), store[key]);
    restoredCollections += 1;
  }

  logActivity(
    'storage',
    'Restored STRANGE local JSON data archive',
    `Validated and restored ${restoredCollections} collections. Safety backup saved as ${safetyBackup.filename}.`,
    'success'
  );

  return { restoredCollections, safetyBackup };
}

export function restoreFromLocalBackup(filename: string): {
  restoredCollections: number;
  safetyBackup: BackupRecord;
} {
  if (!/^backup_[a-z0-9_.-]+\.json$/i.test(filename)) {
    throw new Error('Invalid backup filename.');
  }
  const full = path.resolve(BACKUPS_DIR, filename);
  if (!full.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(full)) {
    throw new Error('Selected backup file does not exist.');
  }
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
  return validateAndImportBundle(parsed, 'pre_restore');
}

export function getStorageHealthInfo(): StorageHealthInfo {
  const keys = Object.keys(COLLECTION_FILES) as CollectionKey[];
  const files = keys.map((key) => {
    const filePath = resolveStoreFile(key);
    const exists = fs.existsSync(filePath);
    const sizeBytes = exists ? fs.statSync(filePath).size : 0;
    const count =
      key === 'settings' ? Object.keys(store.settings).length : (store[key] as unknown[]).length;
    return {
      collection: key,
      filename: COLLECTION_FILES[key],
      exists,
      sizeBytes,
      recordCount: count,
    };
  });
  const backups = listBackups();
  return {
    engine: 'Local JSON Files (v1.0 — Zero Database Required)',
    storeDir: STORE_DIR,
    backupsDir: BACKUPS_DIR,
    totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    backupCount: backups.length,
    lastBackupAt: backups[0]?.createdAt || null,
    files,
    backups,
  };
}

// Create an initial baseline backup on first launch if none exist yet
if (listBackups().length === 0) {
  try {
    createAutomaticBackup('initial');
  } catch {
    // ignore
  }
}

// --- Settings ---
export function getSetting(key: string, defaultValue = ''): string {
  return store.settings[key] ?? defaultValue;
}

export function setSetting(key: string, value: string): void {
  if (FORBIDDEN_SECRET_PATTERNS.test(key)) {
    throw new Error('API credentials cannot be stored in settings.json; use Windows secure storage or server Secrets.');
  }
  store.settings[key] = value;
  persist('settings', false);
}

export function getAllSettings(): Record<string, string> {
  return { ...store.settings };
}

const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function isValidGeminiModelId(model: string): boolean {
  const trimmed = model.trim();
  if (!trimmed || DEPRECATED_MODELS.has(trimmed)) return false;
  return /^gemini-[a-z0-9.-]+$/i.test(trimmed);
}

export function getSelectedModel(): GeminiModelId {
  const saved = getSetting('gemini_model', 'gemini-3.1-flash-lite');
  if (isValidGeminiModelId(saved)) {
    return saved;
  }
  return 'gemini-3.1-flash-lite';
}

// --- Activity Logs ---
export function logActivity(
  category: string,
  action: string,
  details: string,
  status: ActivityLog['status'] = 'info'
): ActivityLog {
  const item: ActivityLog = {
    id: newId('act'),
    category,
    action,
    details,
    status,
    createdAt: nowIso(),
  };
  store.activity.unshift(item);
  if (store.activity.length > 500) {
    store.activity = store.activity.slice(0, 500);
  }
  persist('activity', false);
  return item;
}

export function listActivityLogs(limit = 100): ActivityLog[] {
  return store.activity.slice(0, limit);
}

// --- Conversations & Messages ---
export function listConversations(): Conversation[] {
  return [...store.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createConversation(title = 'New Operator Session'): Conversation {
  const now = nowIso();
  const conv: Conversation = {
    id: newId('conv'),
    title: title.slice(0, 120),
    createdAt: now,
    updatedAt: now,
  };
  store.conversations.unshift(conv);
  persist('conversations');
  return conv;
}

export function deleteConversation(id: string): void {
  store.conversations = store.conversations.filter((c) => c.id !== id);
  store.messages = store.messages.filter((m) => m.conversationId !== id);
  persist('conversations');
  persist('messages', false);
}

export function listMessages(conversationId: string): ChatMessage[] {
  return store.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  const now = nowIso();
  const full: ChatMessage = {
    id: newId('msg'),
    ...msg,
    createdAt: now,
  };
  store.messages.push(full);
  const conv = store.conversations.find((c) => c.id === msg.conversationId);
  if (conv) {
    conv.updatedAt = now;
    persist('conversations', false);
  }
  persist('messages');
  return full;
}

export function updateConversationTitle(id: string, title: string): void {
  const conv = store.conversations.find((c) => c.id === id);
  if (!conv) return;
  conv.title = title.slice(0, 120);
  conv.updatedAt = nowIso();
  persist('conversations', false);
}

// --- Opportunities ---
export function saveOpportunities(items: Omit<OpportunityItem, 'id' | 'createdAt'>[]): OpportunityItem[] {
  const createdAt = nowIso();
  const saved: OpportunityItem[] = items.map((item) => ({
    ...item,
    id: newId('opp'),
    createdAt,
  }));
  store.opportunities.unshift(...saved);
  persist('opportunities');
  return saved;
}

export function listOpportunities(): OpportunityItem[] {
  return [...store.opportunities].sort((a, b) => {
    const timeDiff = b.createdAt.localeCompare(a.createdAt);
    return timeDiff !== 0 ? timeDiff : a.rankIndex - b.rankIndex;
  });
}

export function getOpportunity(id: string): OpportunityItem | null {
  return store.opportunities.find((o) => o.id === id) || null;
}

export function updateOpportunitySelection(
  id: string,
  status: OpportunityItem['status'],
  priorityOrder: number | null
): void {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) return;
  opp.status = status;
  opp.priorityOrder = priorityOrder;
  persist('opportunities');
}

// --- Projects ---
export function listProjects(): ProjectRecord[] {
  return [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): ProjectRecord | null {
  return store.projects.find((p) => p.id === id) || null;
}

export function createProject(
  p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>
): ProjectRecord {
  const now = nowIso();
  const full: ProjectRecord = {
    ...p,
    id: newId('proj'),
    createdAt: now,
    updatedAt: now,
  };
  store.projects.unshift(full);
  persist('projects');
  return full;
}

export function updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord | null {
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const merged: ProjectRecord = {
    ...store.projects[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  store.projects[idx] = merged;
  persist('projects');
  return merged;
}

// --- Outreach Targets ---
export function listOutreachTargets(platform?: 'instagram' | 'discord'): OutreachTarget[] {
  const filtered = platform
    ? store.outreach.filter((t) => t.platform === platform)
    : store.outreach;
  return [...filtered].sort((a, b) => {
    const timeDiff = b.createdAt.localeCompare(a.createdAt);
    return timeDiff !== 0 ? timeDiff : a.relevanceRank - b.relevanceRank;
  });
}

export function saveOutreachTargets(
  items: Omit<OutreachTarget, 'id' | 'createdAt' | 'updatedAt'>[]
): OutreachTarget[] {
  const now = nowIso();
  const saved: OutreachTarget[] = items.map((item) => ({
    ...item,
    id: newId('out'),
    createdAt: now,
    updatedAt: now,
  }));
  store.outreach.unshift(...saved);
  persist('outreach');
  return saved;
}

export function updateOutreachTarget(
  id: string,
  patch: Partial<Pick<OutreachTarget, 'draftMessage' | 'followStatus' | 'deliveryStatus'>>
): OutreachTarget | null {
  const idx = store.outreach.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated: OutreachTarget = {
    ...store.outreach[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  store.outreach[idx] = updated;
  persist('outreach');
  return updated;
}

// --- Approvals ---
export function listApprovals(): ApprovalItem[] {
  return [...store.approvals].sort((a, b) => {
    const aPend = a.status === 'pending' ? 0 : 1;
    const bPend = b.status === 'pending' ? 0 : 1;
    if (aPend !== bPend) return aPend - bPend;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function getApproval(id: string): ApprovalItem | null {
  return store.approvals.find((a) => a.id === id) || null;
}

export function createApproval(
  item: Omit<ApprovalItem, 'id' | 'status' | 'executionResult' | 'createdAt' | 'resolvedAt'>
): ApprovalItem {
  const full: ApprovalItem = {
    id: newId('apr'),
    ...item,
    status: 'pending',
    executionResult: null,
    createdAt: nowIso(),
    resolvedAt: null,
  };
  store.approvals.unshift(full);
  persist('approvals');
  return full;
}

export function resolveApproval(
  id: string,
  status: 'approved' | 'rejected' | 'executed',
  executionResult?: string
): ApprovalItem | null {
  const item = store.approvals.find((a) => a.id === id);
  if (!item) return null;
  item.status = status;
  item.executionResult = executionResult ?? null;
  item.resolvedAt = nowIso();
  persist('approvals');
  return item;
}

// --- Presentations ---
export function listPresentations(): PresentationRecord[] {
  return [...store.presentations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createPresentation(
  p: Omit<PresentationRecord, 'id' | 'createdAt'>
): PresentationRecord {
  const full: PresentationRecord = {
    id: newId('deck'),
    ...p,
    createdAt: nowIso(),
  };
  store.presentations.unshift(full);
  persist('presentations');
  return full;
}

export function deletePresentation(id: string): void {
  store.presentations = store.presentations.filter((d) => d.id !== id);
  persist('presentations');
}

// --- Automations ---
export function listAutomations(): AutomationTask[] {
  return [...store.automations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createAutomation(
  task: Omit<AutomationTask, 'id' | 'lastRunAt' | 'lastResult' | 'lastStatus' | 'createdAt'>
): AutomationTask {
  const full: AutomationTask = {
    id: newId('auto'),
    ...task,
    lastRunAt: null,
    lastResult: null,
    lastStatus: 'never_run',
    createdAt: nowIso(),
  };
  store.automations.unshift(full);
  persist('automations');
  return full;
}

export function updateAutomation(
  id: string,
  patch: Partial<Pick<AutomationTask, 'enabled' | 'approvedByUser' | 'lastRunAt' | 'lastResult' | 'lastStatus'>>
): AutomationTask | null {
  const idx = store.automations.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated: AutomationTask = {
    ...store.automations[idx],
    ...patch,
  };
  store.automations[idx] = updated;
  persist('automations');
  return updated;
}

// --- Error Reports ---
export function listErrorReports(): ErrorReport[] {
  return [...store.errors].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createErrorReport(
  item: Pick<ErrorReport, 'projectId' | 'projectName' | 'component' | 'errorMessage'>
): ErrorReport {
  const now = nowIso();
  const full: ErrorReport = {
    id: newId('err'),
    ...item,
    diagnosis: null,
    backupPath: null,
    proposedFixFile: null,
    proposedFixSummary: null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  store.errors.unshift(full);
  persist('errors');
  return full;
}

export function updateErrorReport(
  id: string,
  patch: Partial<Pick<ErrorReport, 'diagnosis' | 'backupPath' | 'proposedFixFile' | 'proposedFixSummary' | 'status'>>
): ErrorReport | null {
  const idx = store.errors.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated: ErrorReport = {
    ...store.errors[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  store.errors[idx] = updated;
  persist('errors');
  return updated;
}

// --- Real CRM Metrics (Never Fabricated) ---
export function getCrmMetrics(): CrmMetrics {
  return {
    totalProjects: store.projects.length,
    activeProjects: store.projects.filter((p) =>
      ['prd_review', 'building', 'testing', 'handover_ready', 'approved'].includes(p.status)
    ).length,
    completedProjects: store.projects.filter((p) => ['approved', 'deployed'].includes(p.status)).length,
    deployedApps: store.projects.filter((p) => p.deploymentStatus === 'deployed').length,
    appsWithErrors: store.projects.filter((p) => p.healthStatus === 'error' || Boolean(p.recentErrors)).length,
    pendingApprovals: store.approvals.filter((a) => a.status === 'pending').length,
    outreachTotal: store.outreach.length,
    outreachSent: store.outreach.filter((o) => o.deliveryStatus === 'sent_verified').length,
    presentationsCreated: store.presentations.length,
    opportunitiesDiscovered: store.opportunities.length,
  };
}
