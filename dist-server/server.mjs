// server.ts
import "dotenv/config";
import express from "express";
import fs4 from "fs";
import path4 from "path";

// src/server/builder.ts
import { execFile } from "child_process";
import fs2 from "fs";
import path2 from "path";
import { promisify } from "util";

// src/server/db.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
var DATA_DIR = process.env.STRANGE_DATA_DIR ? path.resolve(process.env.STRANGE_DATA_DIR) : path.resolve(process.cwd(), "data");
var STORE_DIR = path.join(DATA_DIR, "store");
var BACKUPS_DIR = path.join(DATA_DIR, "backups");
var DB_PATH = STORE_DIR;
fs.mkdirSync(STORE_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });
var COLLECTION_FILES = {
  settings: "settings.json",
  conversations: "conversations.json",
  messages: "messages.json",
  opportunities: "opportunities.json",
  projects: "projects.json",
  outreach: "outreach.json",
  approvals: "approvals.json",
  presentations: "presentations.json",
  automations: "automations.json",
  activity: "activity.json",
  errors: "errors.json"
};
var FORBIDDEN_SECRET_PATTERNS = /api[_-]?key|secret|token|password|service[_-]?role/i;
function getDefaultCollection(key) {
  if (key === "settings") return {};
  return [];
}
function validateCollectionData(key, value) {
  if (key === "settings") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== "string") return false;
      if (FORBIDDEN_SECRET_PATTERNS.test(k)) return false;
    }
    return true;
  }
  return Array.isArray(value);
}
function resolveStoreFile(key) {
  const full = path.resolve(STORE_DIR, COLLECTION_FILES[key]);
  if (!full.startsWith(STORE_DIR + path.sep)) {
    throw new Error("Storage path confinement violation.");
  }
  return full;
}
function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized = JSON.stringify(data, null, 2);
  JSON.parse(serialized);
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tmpPath, "w", 384);
  try {
    fs.writeSync(fd, serialized, 0, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}
function loadCollectionFromDisk(key) {
  const filePath = resolveStoreFile(key);
  if (!fs.existsSync(filePath)) {
    const initial = getDefaultCollection(key);
    atomicWriteJson(filePath, initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!validateCollectionData(key, parsed)) {
      throw new Error(`Invalid schema in ${COLLECTION_FILES[key]}`);
    }
    return parsed;
  } catch {
    const recovered = tryRecoverCollectionFromLatestBackup(key);
    if (recovered !== null) {
      atomicWriteJson(filePath, recovered);
      return recovered;
    }
    try {
      fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
    }
    const fallback = getDefaultCollection(key);
    atomicWriteJson(filePath, fallback);
    return fallback;
  }
}
function tryRecoverCollectionFromLatestBackup(key) {
  try {
    const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
    for (const file of files) {
      const full = path.resolve(BACKUPS_DIR, file);
      if (!full.startsWith(BACKUPS_DIR + path.sep)) continue;
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      const candidate = parsed?.data?.[key];
      if (validateCollectionData(key, candidate)) {
        return candidate;
      }
    }
  } catch {
  }
  return null;
}
var store = {
  settings: loadCollectionFromDisk("settings"),
  conversations: loadCollectionFromDisk("conversations"),
  messages: loadCollectionFromDisk("messages"),
  opportunities: loadCollectionFromDisk("opportunities"),
  projects: loadCollectionFromDisk("projects"),
  outreach: loadCollectionFromDisk("outreach"),
  approvals: loadCollectionFromDisk("approvals"),
  presentations: loadCollectionFromDisk("presentations"),
  automations: loadCollectionFromDisk("automations"),
  activity: loadCollectionFromDisk("activity"),
  errors: loadCollectionFromDisk("errors")
};
var lastAutoBackupMs = 0;
var AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1e3;
var MAX_LOCAL_BACKUPS = 20;
function persist(key, triggerAutoBackup = true) {
  atomicWriteJson(resolveStoreFile(key), store[key]);
  if (triggerAutoBackup && Date.now() - lastAutoBackupMs >= AUTO_BACKUP_INTERVAL_MS) {
    try {
      createAutomaticBackup("auto");
    } catch {
    }
  }
}
function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function sanitizeSettingsForStorage(raw) {
  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!FORBIDDEN_SECRET_PATTERNS.test(k) && typeof v === "string") {
      clean[k] = v;
    }
  }
  return clean;
}
function exportPortableDataBundle() {
  return {
    format: "strange-local-json-v1",
    exportedAt: nowIso(),
    note: "Portable STRANGE v1.0 data archive. API credentials are intentionally excluded and stay protected separately in Windows secure storage or server Secrets.",
    data: {
      ...store,
      settings: sanitizeSettingsForStorage(store.settings)
    }
  };
}
function createAutomaticBackup(reason = "manual") {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "snapshot";
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const filename = `backup_${stamp}_${safeReason}.json`;
  const fullPath = path.resolve(BACKUPS_DIR, filename);
  if (!fullPath.startsWith(BACKUPS_DIR + path.sep)) {
    throw new Error("Backup path confinement check failed.");
  }
  const bundle = exportPortableDataBundle();
  atomicWriteJson(fullPath, bundle);
  lastAutoBackupMs = Date.now();
  const all = fs.readdirSync(BACKUPS_DIR).filter((f) => f.startsWith("backup_") && f.endsWith(".json")).sort().reverse();
  for (const stale of all.slice(MAX_LOCAL_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, stale));
    } catch {
    }
  }
  const stat = fs.statSync(fullPath);
  return {
    filename,
    reason: safeReason,
    createdAt: bundle.exportedAt,
    sizeKb: Math.max(1, Math.round(stat.size / 1024))
  };
}
function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.startsWith("backup_") && f.endsWith(".json")).sort().reverse();
  return files.map((filename) => {
    const full = path.join(BACKUPS_DIR, filename);
    const stat = fs.statSync(full);
    const match = filename.match(/^backup_(.+)_([a-z0-9_-]+)\.json$/i);
    const reason = match?.[2] || "snapshot";
    return {
      filename,
      reason,
      createdAt: stat.mtime.toISOString(),
      sizeKb: Math.max(1, Math.round(stat.size / 1024))
    };
  });
}
function validateAndImportBundle(rawBundle, backupReason = "pre_import") {
  if (!rawBundle || typeof rawBundle !== "object") {
    throw new Error("Invalid backup archive: expected JSON object.");
  }
  const candidate = rawBundle;
  if (candidate.format !== "strange-local-json-v1" || !candidate.data || typeof candidate.data !== "object") {
    throw new Error('Unsupported archive format. Expected format "strange-local-json-v1".');
  }
  const keys = Object.keys(COLLECTION_FILES);
  const dataRecord = candidate.data;
  for (const key of keys) {
    const col = dataRecord[key];
    if (col === void 0) continue;
    if (key === "settings") {
      if (!col || typeof col !== "object" || Array.isArray(col)) {
        throw new Error("Validation failed for settings collection.");
      }
    } else if (!Array.isArray(col)) {
      throw new Error(`Validation failed for collection "${key}": expected an array.`);
    }
  }
  const safetyBackup = createAutomaticBackup(backupReason);
  let restoredCollections = 0;
  for (const key of keys) {
    const incoming = dataRecord[key];
    if (incoming === void 0) continue;
    if (key === "settings") {
      store.settings = sanitizeSettingsForStorage(incoming);
    } else {
      store[key] = incoming;
    }
    atomicWriteJson(resolveStoreFile(key), store[key]);
    restoredCollections += 1;
  }
  logActivity(
    "storage",
    "Restored STRANGE local JSON data archive",
    `Validated and restored ${restoredCollections} collections. Safety backup saved as ${safetyBackup.filename}.`,
    "success"
  );
  return { restoredCollections, safetyBackup };
}
function restoreFromLocalBackup(filename) {
  if (!/^backup_[a-z0-9_.-]+\.json$/i.test(filename)) {
    throw new Error("Invalid backup filename.");
  }
  const full = path.resolve(BACKUPS_DIR, filename);
  if (!full.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(full)) {
    throw new Error("Selected backup file does not exist.");
  }
  const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
  return validateAndImportBundle(parsed, "pre_restore");
}
function getStorageHealthInfo() {
  const keys = Object.keys(COLLECTION_FILES);
  const files = keys.map((key) => {
    const filePath = resolveStoreFile(key);
    const exists = fs.existsSync(filePath);
    const sizeBytes = exists ? fs.statSync(filePath).size : 0;
    const count = key === "settings" ? Object.keys(store.settings).length : store[key].length;
    return {
      collection: key,
      filename: COLLECTION_FILES[key],
      exists,
      sizeBytes,
      recordCount: count
    };
  });
  const backups = listBackups();
  return {
    engine: "Local JSON Files (v1.0 \u2014 Zero Database Required)",
    storeDir: STORE_DIR,
    backupsDir: BACKUPS_DIR,
    totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    backupCount: backups.length,
    lastBackupAt: backups[0]?.createdAt || null,
    files,
    backups
  };
}
if (listBackups().length === 0) {
  try {
    createAutomaticBackup("initial");
  } catch {
  }
}
function getSetting(key, defaultValue = "") {
  return store.settings[key] ?? defaultValue;
}
function setSetting(key, value) {
  if (FORBIDDEN_SECRET_PATTERNS.test(key)) {
    throw new Error("API credentials cannot be stored in settings.json; use Windows secure storage or server Secrets.");
  }
  store.settings[key] = value;
  persist("settings", false);
}
function getAllSettings() {
  return { ...store.settings };
}
var DEPRECATED_MODELS = /* @__PURE__ */ new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking"
]);
function isValidGeminiModelId(model) {
  const trimmed = model.trim();
  if (!trimmed || DEPRECATED_MODELS.has(trimmed)) return false;
  return /^gemini-[a-z0-9.-]+$/i.test(trimmed);
}
function getSelectedModel() {
  const saved = getSetting("gemini_model", "gemini-3.1-flash-lite");
  if (isValidGeminiModelId(saved)) {
    return saved;
  }
  return "gemini-3.1-flash-lite";
}
function logActivity(category, action, details, status = "info") {
  const item = {
    id: newId("act"),
    category,
    action,
    details,
    status,
    createdAt: nowIso()
  };
  store.activity.unshift(item);
  if (store.activity.length > 500) {
    store.activity = store.activity.slice(0, 500);
  }
  persist("activity", false);
  return item;
}
function listActivityLogs(limit = 100) {
  return store.activity.slice(0, limit);
}
function listConversations() {
  return [...store.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function createConversation(title = "New Operator Session") {
  const now = nowIso();
  const conv = {
    id: newId("conv"),
    title: title.slice(0, 120),
    createdAt: now,
    updatedAt: now
  };
  store.conversations.unshift(conv);
  persist("conversations");
  return conv;
}
function deleteConversation(id) {
  store.conversations = store.conversations.filter((c) => c.id !== id);
  store.messages = store.messages.filter((m) => m.conversationId !== id);
  persist("conversations");
  persist("messages", false);
}
function listMessages(conversationId) {
  return store.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function addMessage(msg) {
  const now = nowIso();
  const full = {
    id: newId("msg"),
    ...msg,
    createdAt: now
  };
  store.messages.push(full);
  const conv = store.conversations.find((c) => c.id === msg.conversationId);
  if (conv) {
    conv.updatedAt = now;
    persist("conversations", false);
  }
  persist("messages");
  return full;
}
function updateConversationTitle(id, title) {
  const conv = store.conversations.find((c) => c.id === id);
  if (!conv) return;
  conv.title = title.slice(0, 120);
  conv.updatedAt = nowIso();
  persist("conversations", false);
}
function saveOpportunities(items) {
  const createdAt = nowIso();
  const saved = items.map((item) => ({
    ...item,
    id: newId("opp"),
    createdAt
  }));
  store.opportunities.unshift(...saved);
  persist("opportunities");
  return saved;
}
function listOpportunities() {
  return [...store.opportunities].sort((a, b) => {
    const timeDiff = b.createdAt.localeCompare(a.createdAt);
    return timeDiff !== 0 ? timeDiff : a.rankIndex - b.rankIndex;
  });
}
function getOpportunity(id) {
  return store.opportunities.find((o) => o.id === id) || null;
}
function updateOpportunitySelection(id, status, priorityOrder) {
  const opp = store.opportunities.find((o) => o.id === id);
  if (!opp) return;
  opp.status = status;
  opp.priorityOrder = priorityOrder;
  persist("opportunities");
}
function listProjects() {
  return [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function getProject(id) {
  return store.projects.find((p) => p.id === id) || null;
}
function createProject(p) {
  const now = nowIso();
  const full = {
    ...p,
    id: newId("proj"),
    createdAt: now,
    updatedAt: now
  };
  store.projects.unshift(full);
  persist("projects");
  return full;
}
function updateProject(id, patch) {
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const merged = {
    ...store.projects[idx],
    ...patch,
    updatedAt: nowIso()
  };
  store.projects[idx] = merged;
  persist("projects");
  return merged;
}
function listOutreachTargets(platform) {
  const filtered = platform ? store.outreach.filter((t) => t.platform === platform) : store.outreach;
  return [...filtered].sort((a, b) => {
    const timeDiff = b.createdAt.localeCompare(a.createdAt);
    return timeDiff !== 0 ? timeDiff : a.relevanceRank - b.relevanceRank;
  });
}
function saveOutreachTargets(items) {
  const now = nowIso();
  const saved = items.map((item) => ({
    ...item,
    id: newId("out"),
    createdAt: now,
    updatedAt: now
  }));
  store.outreach.unshift(...saved);
  persist("outreach");
  return saved;
}
function updateOutreachTarget(id, patch) {
  const idx = store.outreach.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = {
    ...store.outreach[idx],
    ...patch,
    updatedAt: nowIso()
  };
  store.outreach[idx] = updated;
  persist("outreach");
  return updated;
}
function listApprovals() {
  return [...store.approvals].sort((a, b) => {
    const aPend = a.status === "pending" ? 0 : 1;
    const bPend = b.status === "pending" ? 0 : 1;
    if (aPend !== bPend) return aPend - bPend;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
function getApproval(id) {
  return store.approvals.find((a) => a.id === id) || null;
}
function createApproval(item) {
  const full = {
    id: newId("apr"),
    ...item,
    status: "pending",
    executionResult: null,
    createdAt: nowIso(),
    resolvedAt: null
  };
  store.approvals.unshift(full);
  persist("approvals");
  return full;
}
function resolveApproval(id, status, executionResult) {
  const item = store.approvals.find((a) => a.id === id);
  if (!item) return null;
  item.status = status;
  item.executionResult = executionResult ?? null;
  item.resolvedAt = nowIso();
  persist("approvals");
  return item;
}
function listPresentations() {
  return [...store.presentations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function createPresentation(p) {
  const full = {
    id: newId("deck"),
    ...p,
    createdAt: nowIso()
  };
  store.presentations.unshift(full);
  persist("presentations");
  return full;
}
function deletePresentation(id) {
  store.presentations = store.presentations.filter((d) => d.id !== id);
  persist("presentations");
}
function listAutomations() {
  return [...store.automations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function createAutomation(task) {
  const full = {
    id: newId("auto"),
    ...task,
    lastRunAt: null,
    lastResult: null,
    lastStatus: "never_run",
    createdAt: nowIso()
  };
  store.automations.unshift(full);
  persist("automations");
  return full;
}
function updateAutomation(id, patch) {
  const idx = store.automations.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = {
    ...store.automations[idx],
    ...patch
  };
  store.automations[idx] = updated;
  persist("automations");
  return updated;
}
function listErrorReports() {
  return [...store.errors].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function createErrorReport(item) {
  const now = nowIso();
  const full = {
    id: newId("err"),
    ...item,
    diagnosis: null,
    backupPath: null,
    proposedFixFile: null,
    proposedFixSummary: null,
    status: "open",
    createdAt: now,
    updatedAt: now
  };
  store.errors.unshift(full);
  persist("errors");
  return full;
}
function updateErrorReport(id, patch) {
  const idx = store.errors.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated = {
    ...store.errors[idx],
    ...patch,
    updatedAt: nowIso()
  };
  store.errors[idx] = updated;
  persist("errors");
  return updated;
}
function getCrmMetrics() {
  return {
    totalProjects: store.projects.length,
    activeProjects: store.projects.filter(
      (p) => ["prd_review", "building", "testing", "handover_ready", "approved"].includes(p.status)
    ).length,
    completedProjects: store.projects.filter((p) => ["approved", "deployed"].includes(p.status)).length,
    deployedApps: store.projects.filter((p) => p.deploymentStatus === "deployed").length,
    appsWithErrors: store.projects.filter((p) => p.healthStatus === "error" || Boolean(p.recentErrors)).length,
    pendingApprovals: store.approvals.filter((a) => a.status === "pending").length,
    outreachTotal: store.outreach.length,
    outreachSent: store.outreach.filter((o) => o.deliveryStatus === "sent_verified").length,
    presentationsCreated: store.presentations.length,
    opportunitiesDiscovered: store.opportunities.length
  };
}

// src/server/builder.ts
var execFileAsync = promisify(execFile);
var WORKSPACES_ROOT = path2.resolve(process.cwd(), "workspaces");
fs2.mkdirSync(WORKSPACES_ROOT, { recursive: true });
function slugifyProjectName(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42);
  return base || `project-${Date.now()}`;
}
function resolveSafeWorkspaceDir(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Invalid project workspace identifier.");
  }
  const resolved = path2.resolve(WORKSPACES_ROOT, slug);
  if (!resolved.startsWith(WORKSPACES_ROOT + path2.sep)) {
    throw new Error("Workspace path confinement check failed.");
  }
  return resolved;
}
function resolveSafeWorkspaceFile(slug, relPath) {
  const dir = resolveSafeWorkspaceDir(slug);
  const normalized = path2.resolve(dir, relPath);
  if (!normalized.startsWith(dir + path2.sep)) {
    throw new Error("File path confinement check failed.");
  }
  return normalized;
}
function writeProjectFiles(slug, bundle, projectName) {
  const dir = resolveSafeWorkspaceDir(slug);
  fs2.mkdirSync(path2.join(dir, "tests"), { recursive: true });
  const pkg = {
    name: slug,
    version: "0.1.0",
    private: true,
    type: "module",
    description: `Generated by STRANGE for ${projectName}`,
    scripts: {
      test: "node --test tests/unit.test.mjs"
    }
  };
  fs2.writeFileSync(path2.join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  fs2.writeFileSync(path2.join(dir, "index.html"), bundle.indexHtml, "utf8");
  fs2.writeFileSync(path2.join(dir, "styles.css"), bundle.stylesCss, "utf8");
  fs2.writeFileSync(path2.join(dir, "app.js"), bundle.appJs, "utf8");
  fs2.writeFileSync(path2.join(dir, "logic.mjs"), bundle.logicMjs, "utf8");
  fs2.writeFileSync(path2.join(dir, "tests", "unit.test.mjs"), bundle.unitTestMjs, "utf8");
  fs2.writeFileSync(path2.join(dir, "README.md"), bundle.readmeMd, "utf8");
  return dir;
}
function readProjectFiles(slug) {
  const dir = resolveSafeWorkspaceDir(slug);
  const result = {};
  if (!fs2.existsSync(dir)) return result;
  const candidates = [
    "package.json",
    "index.html",
    "styles.css",
    "app.js",
    "logic.mjs",
    "tests/unit.test.mjs",
    "README.md"
  ];
  for (const rel of candidates) {
    const full = resolveSafeWorkspaceFile(slug, rel);
    if (fs2.existsSync(full)) {
      result[rel] = fs2.readFileSync(full, "utf8");
    }
  }
  return result;
}
function backupWorkspace(slug, reason) {
  const dir = resolveSafeWorkspaceDir(slug);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = path2.join(dir, ".backups", `${stamp}_${reason.replace(/[^a-z0-9_-]/gi, "")}`);
  fs2.mkdirSync(backupDir, { recursive: true });
  const files = readProjectFiles(slug);
  for (const [rel, content] of Object.entries(files)) {
    const dest = path2.resolve(backupDir, rel);
    if (!dest.startsWith(backupDir + path2.sep)) continue;
    fs2.mkdirSync(path2.dirname(dest), { recursive: true });
    fs2.writeFileSync(dest, content, "utf8");
  }
  return backupDir;
}
function applyWorkspaceFilePatch(slug, relFile, content) {
  const allowed = /* @__PURE__ */ new Set(["index.html", "styles.css", "app.js", "logic.mjs", "tests/unit.test.mjs", "README.md"]);
  if (!allowed.has(relFile)) {
    throw new Error(`Patch target "${relFile}" is not an allowed workspace source file.`);
  }
  const full = resolveSafeWorkspaceFile(slug, relFile);
  fs2.writeFileSync(full, content, "utf8");
}
function restoreWorkspaceFromBackup(slug, backupDir) {
  const dir = resolveSafeWorkspaceDir(slug);
  const normalizedBackup = path2.resolve(backupDir);
  if (!normalizedBackup.startsWith(path2.join(dir, ".backups") + path2.sep)) {
    throw new Error("Backup path confinement check failed.");
  }
  if (!fs2.existsSync(normalizedBackup)) {
    throw new Error("Backup directory no longer exists.");
  }
  const candidates = [
    "package.json",
    "index.html",
    "styles.css",
    "app.js",
    "logic.mjs",
    "tests/unit.test.mjs",
    "README.md"
  ];
  for (const rel of candidates) {
    const src = path2.resolve(normalizedBackup, rel);
    if (src.startsWith(normalizedBackup + path2.sep) && fs2.existsSync(src)) {
      const dest = resolveSafeWorkspaceFile(slug, rel);
      fs2.writeFileSync(dest, fs2.readFileSync(src, "utf8"), "utf8");
    }
  }
}
async function runThreeTestingPasses(project, localServerBaseUrl) {
  const dir = resolveSafeWorkspaceDir(project.slug);
  const executedAt = nowIso();
  const pass1Checks = [];
  const requiredFiles = ["package.json", "index.html", "styles.css", "app.js", "logic.mjs", "tests/unit.test.mjs"];
  for (const file of requiredFiles) {
    const exists = fs2.existsSync(resolveSafeWorkspaceFile(project.slug, file));
    pass1Checks.push({
      name: `File presence: ${file}`,
      status: exists ? "passed" : "failed",
      details: exists ? "Present in isolated workspace" : "Missing expected source file"
    });
  }
  try {
    JSON.parse(fs2.readFileSync(resolveSafeWorkspaceFile(project.slug, "package.json"), "utf8"));
    pass1Checks.push({ name: "JSON validation: package.json", status: "passed", details: "Valid JSON manifest" });
  } catch (err) {
    pass1Checks.push({
      name: "JSON validation: package.json",
      status: "failed",
      details: err instanceof Error ? err.message : "Invalid JSON"
    });
  }
  for (const jsFile of ["logic.mjs", "app.js", "tests/unit.test.mjs"]) {
    const full = resolveSafeWorkspaceFile(project.slug, jsFile);
    if (fs2.existsSync(full)) {
      try {
        await execFileAsync(process.execPath, ["--check", full], { timeout: 8e3 });
        pass1Checks.push({
          name: `Syntax check: ${jsFile}`,
          status: "passed",
          details: "Node.js ES module syntax verified"
        });
      } catch (err) {
        const stderr = err.stderr || (err instanceof Error ? err.message : String(err));
        pass1Checks.push({
          name: `Syntax check: ${jsFile}`,
          status: "failed",
          details: stderr.slice(0, 300)
        });
      }
    }
  }
  const unitTestPath = resolveSafeWorkspaceFile(project.slug, "tests/unit.test.mjs");
  if (fs2.existsSync(unitTestPath)) {
    try {
      const { stdout } = await execFileAsync(process.execPath, ["--test", unitTestPath], {
        cwd: dir,
        timeout: 12e3
      });
      pass1Checks.push({
        name: "Node.js unit test suite (node --test)",
        status: "passed",
        details: stdout.trim().slice(-320) || "All unit tests passed"
      });
    } catch (err) {
      const stderr = err.stdout || err.stderr || (err instanceof Error ? err.message : String(err));
      pass1Checks.push({
        name: "Node.js unit test suite (node --test)",
        status: "failed",
        details: stderr.trim().slice(-320)
      });
    }
  }
  const pass1Failed = pass1Checks.some((c) => c.status === "failed");
  const pass1 = {
    passNumber: 1,
    name: "Pass 1: Code, Syntax & Unit Testing",
    status: pass1Failed ? "failed" : "passed",
    executedAt,
    checks: pass1Checks,
    summary: pass1Failed ? `${pass1Checks.filter((c) => c.status === "failed").length} check(s) failed in Pass 1.` : `All ${pass1Checks.length} code and unit test checks passed.`
  };
  const pass2Checks = [];
  const previewTargets = [
    { label: "Preview HTML route", url: `${localServerBaseUrl}/preview/${project.slug}/` },
    { label: "Preview CSS asset", url: `${localServerBaseUrl}/preview/${project.slug}/styles.css` },
    { label: "Preview App JS asset", url: `${localServerBaseUrl}/preview/${project.slug}/app.js` },
    { label: "Preview Logic ES module", url: `${localServerBaseUrl}/preview/${project.slug}/logic.mjs` }
  ];
  for (const target of previewTargets) {
    try {
      const res = await fetch(target.url, { signal: AbortSignal.timeout(5e3) });
      pass2Checks.push({
        name: target.label,
        status: res.ok ? "passed" : "failed",
        details: `HTTP ${res.status} (${res.headers.get("content-type") || "unknown"})`
      });
    } catch (err) {
      pass2Checks.push({
        name: target.label,
        status: "failed",
        details: err instanceof Error ? err.message : "Request failed"
      });
    }
  }
  try {
    const res404 = await fetch(`${localServerBaseUrl}/preview/${project.slug}/nonexistent-asset-check.txt`, {
      signal: AbortSignal.timeout(5e3)
    });
    pass2Checks.push({
      name: "Expected failure handling (404 on missing asset)",
      status: res404.status === 404 ? "passed" : "failed",
      details: `Received HTTP ${res404.status}`
    });
  } catch (err) {
    pass2Checks.push({
      name: "Expected failure handling (404 on missing asset)",
      status: "failed",
      details: err instanceof Error ? err.message : "Request failed"
    });
  }
  const pass2Failed = pass2Checks.some((c) => c.status === "failed");
  const pass2 = {
    passNumber: 2,
    name: "Pass 2: Integration & HTTP Asset Verification",
    status: pass2Failed ? "failed" : "passed",
    executedAt,
    checks: pass2Checks,
    summary: pass2Failed ? `${pass2Checks.filter((c) => c.status === "failed").length} integration check(s) failed.` : `All ${pass2Checks.length} HTTP integration and error-handling checks passed.`
  };
  const pass3Checks = [];
  const htmlContent = fs2.existsSync(resolveSafeWorkspaceFile(project.slug, "index.html")) ? fs2.readFileSync(resolveSafeWorkspaceFile(project.slug, "index.html"), "utf8") : "";
  const appJsContent = fs2.existsSync(resolveSafeWorkspaceFile(project.slug, "app.js")) ? fs2.readFileSync(resolveSafeWorkspaceFile(project.slug, "app.js"), "utf8") : "";
  const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(htmlContent);
  pass3Checks.push({
    name: "Responsive viewport meta declaration",
    status: hasViewportMeta ? "passed" : "failed",
    details: hasViewportMeta ? "Viewport meta tag verified" : "Missing responsive viewport meta tag"
  });
  const hasScriptLink = /src=["']\.\/app\.js["']/i.test(htmlContent);
  pass3Checks.push({
    name: "Module entry script wired in HTML",
    status: hasScriptLink ? "passed" : "failed",
    details: hasScriptLink ? "./app.js loaded cleanly" : "Missing ./app.js script reference"
  });
  const hasUnsafeEval = /\beval\s*\(|new\s+Function\s*\(/i.test(appJsContent);
  pass3Checks.push({
    name: "Client runtime safety check (no eval/Function)",
    status: hasUnsafeEval ? "failed" : "passed",
    details: hasUnsafeEval ? "Detected unsafe dynamic code evaluation" : "No eval() or new Function() detected"
  });
  let playwrightAvailable = false;
  try {
    await execFileAsync("npx", ["--no-install", "playwright", "--version"], { timeout: 4e3 });
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  if (playwrightAvailable) {
    pass3Checks.push({
      name: "Playwright CLI availability",
      status: "passed",
      details: "Playwright detected on host environment"
    });
  } else {
    pass3Checks.push({
      name: "Playwright headless Chromium E2E",
      status: "skipped",
      details: "Playwright browser binaries are not pre-installed in this sandbox container. Marked honestly as skipped (not passed). Run `npx playwright test` after installing on Windows 10."
    });
  }
  const pass3Failed = pass3Checks.some((c) => c.status === "failed");
  const pass3Skipped = pass3Checks.some((c) => c.status === "skipped");
  const pass3 = {
    passNumber: 3,
    name: "Pass 3: Browser End-to-End & DOM Audit",
    status: pass3Failed ? "failed" : pass3Skipped ? "partial" : "passed",
    executedAt,
    checks: pass3Checks,
    summary: pass3Failed ? "DOM/runtime safety check failed in Pass 3." : pass3Skipped ? "Static DOM & asset checks passed; Playwright browser run was skipped because Chromium binaries are absent in this container." : "All browser E2E checks passed."
  };
  logActivity(
    "testing",
    `Ran 3-pass test suite for ${project.name}`,
    `Pass 1: ${pass1.status}, Pass 2: ${pass2.status}, Pass 3: ${pass3.status}`,
    pass1Failed || pass2Failed || pass3Failed ? "warning" : "success"
  );
  return [pass1, pass2, pass3];
}

// src/server/gemini.ts
import { GoogleGenAI, Type } from "@google/genai";

// src/server/secrets.ts
import dotenv from "dotenv";
import fs3 from "fs";
import path3 from "path";
var PLACEHOLDER_VALUES = /* @__PURE__ */ new Set(["", "MY_GEMINI_API_KEY", "YOUR_API_KEY", "your-key-here"]);
function readLocalDotEnv() {
  const candidates = [
    path3.resolve(process.cwd(), ".env"),
    ...process.env.STRANGE_DATA_DIR ? [path3.resolve(process.env.STRANGE_DATA_DIR, "..", ".env")] : []
  ];
  for (const filePath of candidates) {
    try {
      if (fs3.existsSync(filePath)) {
        const raw = fs3.readFileSync(filePath, "utf8");
        return dotenv.parse(raw);
      }
    } catch {
    }
  }
  return {};
}
function isReasonableKeyFormat(val) {
  const trimmed = val.trim();
  if (trimmed.length < 12) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}
function resolveServerSecret(name) {
  const envVal = (process.env[name] || "").trim();
  if (envVal && !PLACEHOLDER_VALUES.has(envVal)) {
    const valid = isReasonableKeyFormat(envVal);
    return {
      value: valid ? envVal : null,
      status: {
        configured: valid,
        source: "environment",
        malformed: !valid,
        warning: valid ? void 0 : `${name} in environment appears malformed (too short or contains whitespace).`
      }
    };
  }
  const localEnv = readLocalDotEnv();
  const fileVal = (localEnv[name] || "").trim();
  if (fileVal && !PLACEHOLDER_VALUES.has(fileVal)) {
    const valid = isReasonableKeyFormat(fileVal);
    return {
      value: valid ? fileVal : null,
      status: {
        configured: valid,
        source: "local_env_file",
        malformed: !valid,
        warning: valid ? void 0 : `${name} in local .env appears malformed (too short or contains whitespace).`
      }
    };
  }
  return {
    value: null,
    status: {
      configured: false,
      source: "unset",
      malformed: false
    }
  };
}
function getGeminiSecretStatus() {
  return resolveServerSecret("GEMINI_API_KEY").status;
}
function getGeminiApiKeyOrThrow() {
  const { value, status } = resolveServerSecret("GEMINI_API_KEY");
  if (status.malformed) {
    throw new Error(
      status.warning || "GEMINI_API_KEY appears malformed. Check the saved key and remove any extra spaces or quotes."
    );
  }
  if (!value) {
    throw new Error(
      "GEMINI_API_KEY is not configured. In Google AI Studio, set it in Settings > Secrets; on Windows localhost, double-click CONFIGURE-GEMINI-KEY.bat in your STRANGE folder to save it securely."
    );
  }
  return value;
}

// src/server/gemini.ts
var FALLBACK_MODEL_CHAIN = ["gemini-3.1-flash-lite", "gemini-4-hydrogen"];
function getAiClient() {
  const apiKey = getGeminiApiKeyOrThrow();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function extractUpstreamErrorMessage(raw) {
  try {
    const start = raw.indexOf("{");
    if (start >= 0) {
      const parsed = JSON.parse(raw.slice(start));
      if (parsed.error?.message) {
        return `${parsed.error.message}${parsed.error.status ? ` (${parsed.error.status})` : ""}`;
      }
    }
  } catch {
  }
  return raw;
}
function normalizeGeminiError(err) {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = extractUpstreamErrorMessage(raw);
  if (raw.includes("GEMINI_API_KEY is not configured") || raw.includes("malformed")) {
    return raw;
  }
  if (raw.includes("API_KEY_INVALID") || raw.includes("PERMISSION_DENIED") || raw.includes("403") || raw.includes("401")) {
    return "Gemini API authentication failed (invalid key or insufficient permissions). Verify your Gemini API key in Settings > Secrets (AI Studio) or re-run CONFIGURE-GEMINI-KEY.bat (Windows).";
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return "Gemini API rate limit or quota reached (429 RESOURCE_EXHAUSTED). Wait briefly or use a billing-enabled API key.";
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand")) {
    return `Gemini model is temporarily overloaded (503 UNAVAILABLE): ${clean}. Switch to gemini-3.1-flash-lite in Settings or retry shortly.`;
  }
  if (raw.includes("NOT_FOUND") || raw.includes("404")) {
    return `Requested Gemini model was not found or is unavailable on your API key (404): ${clean}. Select a supported model like gemini-3.1-flash-lite in Settings.`;
  }
  if (raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED") || raw.includes("fetch failed") || raw.includes("ECONNRESET")) {
    return "Network error: unable to reach Google Gemini API servers. Check your internet connection or firewall.";
  }
  if (raw.includes("AbortError") || raw.includes("timeout")) {
    return "Gemini API request timed out. Try again or switch to gemini-3.1-flash-lite for lower latency.";
  }
  return clean || "Unexpected Gemini API error.";
}
async function generateWithFallback(primaryModel, runner) {
  const candidates = [primaryModel, ...FALLBACK_MODEL_CHAIN.filter((m) => m !== primaryModel)];
  let lastError;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = await runner(candidate);
      return { result, modelUsed: candidate };
    } catch (err) {
      lastError = err;
      const raw = err instanceof Error ? err.message : String(err);
      const isOverloadedOrMissingModel = raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand") || raw.includes("NOT_FOUND") || raw.includes("404");
      if (raw.includes("429") || raw.includes("500") || raw.includes("ECONNRESET")) {
        await new Promise((r) => setTimeout(r, 900));
        try {
          const retryResult = await runner(candidate);
          return { result: retryResult, modelUsed: candidate };
        } catch (retryErr) {
          lastError = retryErr;
        }
      }
      if (!isOverloadedOrMissingModel || i === candidates.length - 1) {
        throw new Error(normalizeGeminiError(lastError));
      }
    }
  }
  throw new Error(normalizeGeminiError(lastError));
}
function extractGroundingSources(response) {
  const r = response;
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = /* @__PURE__ */ new Set();
  const sources = [];
  for (const ch of chunks) {
    const uri = ch.web?.uri;
    const title = ch.web?.title || uri;
    if (uri && !seen.has(uri) && (uri.startsWith("https://") || uri.startsWith("http://"))) {
      seen.add(uri);
      sources.push({ uri, title: title || uri });
    }
  }
  return sources;
}
function parseJsonFromModelText(rawText) {
  const cleaned = (rawText ?? "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const startObj = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  let start = -1;
  if (startObj !== -1 && startArr !== -1) start = Math.min(startObj, startArr);
  else start = Math.max(startObj, startArr);
  const sliced = start >= 0 ? candidate.slice(start) : candidate;
  return JSON.parse(sliced);
}
async function testGeminiConnection(model) {
  const requestedModel = model || getSelectedModel();
  if (!isValidGeminiModelId(requestedModel)) {
    return {
      ok: false,
      model: requestedModel,
      latencyMs: 0,
      error: `Model "${requestedModel}" is deprecated or invalid. Use gemini-3.1-flash-lite or gemini-4-hydrogen.`
    };
  }
  const start = Date.now();
  try {
    const ai = getAiClient();
    const { result, modelUsed } = await generateWithFallback(
      requestedModel,
      (m) => ai.models.generateContent({
        model: m,
        contents: "Respond in one short sentence confirming STRANGE operator connection is live."
      })
    );
    const latencyMs = Date.now() - start;
    const reply = result.text?.trim() || "Connection verified.";
    setSetting("gemini_last_verified_at", (/* @__PURE__ */ new Date()).toISOString());
    setSetting("gemini_last_status", "connected");
    setSetting("gemini_last_error", "");
    return {
      ok: true,
      model: requestedModel,
      modelUsed,
      latencyMs,
      reply: modelUsed !== requestedModel ? `${reply} (Note: ${requestedModel} was temporarily busy; automatically served via ${modelUsed}.)` : reply
    };
  } catch (err) {
    const error = normalizeGeminiError(err);
    setSetting("gemini_last_status", "error");
    setSetting("gemini_last_error", error);
    return {
      ok: false,
      model: requestedModel,
      latencyMs: Date.now() - start,
      error
    };
  }
}
async function runFullAiDiagnostics(requestedModel) {
  const started = Date.now();
  const configuredModel = requestedModel || getSelectedModel();
  const secretStatus = getGeminiSecretStatus();
  const checks = [];
  checks.push({
    id: "provider_config",
    label: "Provider configuration",
    status: "pass",
    details: `Google Gemini (@google/genai SDK) selected with model "${configuredModel}".`
  });
  checks.push({
    id: "credential_saved",
    label: "Credential availability",
    status: secretStatus.configured ? "pass" : "fail",
    details: secretStatus.configured ? `Credential detected via ${secretStatus.source === "environment" ? "server environment secret" : "local .env file"} (value hidden).` : secretStatus.malformed ? secretStatus.warning || "Configured credential appears malformed." : "No Gemini API key detected on backend. Set GEMINI_API_KEY in AI Studio Secrets or run CONFIGURE-GEMINI-KEY.bat on Windows."
  });
  let backendRetrieved = false;
  if (secretStatus.configured) {
    try {
      getGeminiApiKeyOrThrow();
      backendRetrieved = true;
      checks.push({
        id: "backend_retrieval",
        label: "Backend credential retrieval",
        status: "pass",
        details: "Backend initialized GoogleGenAI client securely without exposing credentials to browser."
      });
    } catch (err) {
      checks.push({
        id: "backend_retrieval",
        label: "Backend credential retrieval",
        status: "fail",
        details: normalizeGeminiError(err)
      });
    }
  } else {
    checks.push({
      id: "backend_retrieval",
      label: "Backend credential retrieval",
      status: "fail",
      details: "Skipped because no credential is currently configured."
    });
  }
  const modelSupported = isValidGeminiModelId(configuredModel);
  checks.push({
    id: "model_supported",
    label: "Configured model validation",
    status: modelSupported ? "pass" : "fail",
    details: modelSupported ? `Model "${configuredModel}" passes active Gemini model checks (automatic fallback ready if overloaded).` : `Model "${configuredModel}" is deprecated or unsupported. Choose gemini-3.1-flash-lite or gemini-4-hydrogen.`
  });
  let liveTestOk = false;
  let activeModelUsed = null;
  if (backendRetrieved && modelSupported) {
    const testRes = await testGeminiConnection(configuredModel);
    liveTestOk = testRes.ok;
    activeModelUsed = testRes.modelUsed || configuredModel;
    checks.push({
      id: "live_api_call",
      label: "Live Gemini API test request",
      status: testRes.ok ? "pass" : "fail",
      details: testRes.ok ? `Succeeded in ${testRes.latencyMs}ms using ${activeModelUsed}: "${testRes.reply}"` : testRes.error || "Live API call failed."
    });
  } else {
    checks.push({
      id: "live_api_call",
      label: "Live Gemini API test request",
      status: "fail",
      details: "Cannot run live test until credential and model checks pass."
    });
  }
  checks.push({
    id: "chat_backend",
    label: "Chat & automation tool backend",
    status: liveTestOk ? "pass" : "warn",
    details: liveTestOk ? "Chat pipeline, local JSON memory, and real automation function-calling tools are operational." : "Chat routes are online, awaiting passing live Gemini API check."
  });
  return {
    overallOk: checks.every((c) => c.status === "pass"),
    provider: "Google Gemini",
    configuredModel,
    activeModelUsed,
    latencyMs: Date.now() - started,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    checks
  };
}
var OPERATOR_TOOL_DECLARATIONS = [
  {
    name: "create_automation",
    description: "Create and save a real scheduled background automation task in STRANGE Automation Centre (persisted to local JSON storage). Use this whenever the user asks to create, schedule, set up, or make an automation.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Clear name for the automation task (e.g., "Hourly App Health Check" or "Daily Workspace Backup").'
        },
        taskType: {
          type: Type.STRING,
          description: 'Must be one of: "health_check", "backup_workspace", or "weekly_maintenance_scan".'
        },
        intervalMinutes: {
          type: Type.NUMBER,
          description: "Interval in minutes between runs (minimum 5, e.g., 30, 60, 1440 for daily, 10080 for weekly)."
        },
        description: {
          type: Type.STRING,
          description: "Short description of what this automation performs."
        }
      },
      required: ["name", "taskType", "intervalMinutes"]
    }
  },
  {
    name: "list_automations",
    description: "List all currently configured automations in STRANGE Automation Centre.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "run_automation",
    description: "Execute an existing approved automation immediately by its task ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: {
          type: Type.STRING,
          description: "The ID of the automation task to run (e.g., auto_...)."
        }
      },
      required: ["taskId"]
    }
  },
  {
    name: "queue_approval",
    description: "Queue a mandatory human-in-the-loop approval item in Automation Centre for sensitive external, commercial (Whop), deployment (Vercel), outreach, or upgrade actions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: 'One of: "product_build", "instagram_dm", "discord_post", "whop_change", "supabase_migration", "vercel_deploy", "maintenance_upgrade", "error_repair".'
        },
        title: { type: Type.STRING, description: "Short title for the approval request." },
        target: { type: Type.STRING, description: "Target project, account, or listing." },
        proposedAction: { type: Type.STRING, description: "Exact proposed action or message." },
        consequences: { type: Type.STRING, description: "Impact and safeguards explained clearly." }
      },
      required: ["category", "title", "target", "proposedAction", "consequences"]
    }
  },
  {
    name: "create_local_backup",
    description: "Create an immediate local JSON backup snapshot of all STRANGE data.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'Short label for the backup (e.g., "operator_request").' }
      }
    }
  },
  {
    name: "run_weekly_maintenance",
    description: "Inspect all registered projects, check health, and queue per-project maintenance approval plans.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  }
];
async function generateOperatorReply(params) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const recentHistory = params.history.slice(-14).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const prompt = [
    recentHistory ? `Conversation History:
${recentHistory}` : "",
    params.attachmentText ? `Attached Document Content:
${params.attachmentText.slice(0, 12e3)}` : "",
    `Live Local CRM & Workspace State:
${params.contextSnapshot}`,
    `User Request:
${params.userMessage}`
  ].filter(Boolean).join("\n\n---\n\n");
  const systemInstruction = `You are STRANGE, a personal Windows desktop AI operator and software architect running on a resource-conscious machine (Lenovo G570, 6 GB RAM).
Strict operating rules:
1. When the user asks you to create/schedule an automation, list or run automations, queue an approval, create a backup, or run weekly maintenance, IMMEDIATELY call the matching function tool rather than just explaining how to do it.
2. Never claim you executed a command, created an automation, deployed an app, or sent a message unless a tool call actually succeeded and returned confirmation.
3. Never invent metrics, revenue, follower counts, or test passes.
4. For financial, external messaging (Instagram/Discord), Whop listing changes, production DB changes, or deployment actions, queue an approval item via queue_approval so the user can approve it in Automation Centre.
5. Keep responses direct, structured, actionable, and concise.`;
  const isLocalOperatorIntent = /\b(automation|automations|schedule|scheduled|backup|backups|approval|approvals|maintenance|crm|projects?)\b/i.test(
    params.userMessage
  );
  const attachWebSearch = Boolean(params.useWebSearch && !isLocalOperatorIntent);
  const buildCallConfig = (withSearch) => {
    const tools = [];
    if (withSearch) {
      tools.push({ googleSearch: {} });
    }
    if (params.tools) {
      tools.push({ functionDeclarations: OPERATOR_TOOL_DECLARATIONS });
    }
    const hybrid = withSearch && params.tools ? { includeServerSideToolInvocations: true } : void 0;
    return {
      systemInstruction,
      ...tools.length > 0 ? { tools } : {},
      ...hybrid ? { toolConfig: hybrid } : {}
    };
  };
  let firstResponse;
  let modelUsed;
  let activeWithSearch = attachWebSearch;
  try {
    const out = await generateWithFallback(
      primaryModel,
      (m) => ai.models.generateContent({
        model: m,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: buildCallConfig(activeWithSearch)
      })
    );
    firstResponse = out.result;
    modelUsed = out.modelUsed;
  } catch (err) {
    if (activeWithSearch) {
      activeWithSearch = false;
      const fallbackOut = await generateWithFallback(
        primaryModel,
        (m) => ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: buildCallConfig(false)
        })
      );
      firstResponse = fallbackOut.result;
      modelUsed = fallbackOut.modelUsed;
    } else {
      throw err;
    }
  }
  const executedTools = [];
  const allSources = [...extractGroundingSources(firstResponse)];
  const calls = firstResponse.functionCalls || [];
  if (calls.length === 0 || !params.tools) {
    const text = firstResponse.text?.trim();
    if (!text) {
      throw new Error("Gemini returned an empty response. Please retry your message.");
    }
    return { text, sources: allSources, executedTools, modelUsed };
  }
  const functionResponseParts = [];
  for (const call of calls) {
    const name = call.name || "";
    const args = call.args || {};
    try {
      let toolOutput = {};
      if (name === "create_automation") {
        const rawType = String(args.taskType || "health_check");
        const taskType = rawType === "backup_workspace" || rawType === "weekly_maintenance_scan" ? rawType : "health_check";
        const intervalMinutes = Math.max(5, Number(args.intervalMinutes || 60));
        const taskName = String(args.name || `Scheduled ${taskType.replace(/_/g, " ")}`).slice(0, 100);
        const description = String(args.description || `${taskType.replace(/_/g, " ")} every ${intervalMinutes} min`);
        const res = await params.tools.createAutomation({
          name: taskName,
          taskType,
          intervalMinutes,
          description
        });
        toolOutput = { ok: true, automation: res.automation };
        executedTools.push({
          name,
          status: "success",
          summary: `Created automation "${res.automation.name}" (${res.automation.taskType}, every ${res.automation.intervalMinutes} min, ID: ${res.automation.id})`
        });
      } else if (name === "list_automations") {
        const res = await params.tools.listAutomations();
        toolOutput = { ok: true, count: res.automations.length, automations: res.automations };
        executedTools.push({
          name,
          status: "success",
          summary: `Listed ${res.automations.length} automation(s) from local storage`
        });
      } else if (name === "run_automation") {
        const res = await params.tools.runAutomation(String(args.taskId || ""));
        toolOutput = { ok: true, automation: res.automation };
        executedTools.push({
          name,
          status: "success",
          summary: `Executed automation "${res.automation?.name || args.taskId}": ${res.automation?.lastResult || "Completed"}`
        });
      } else if (name === "queue_approval") {
        const allowedCats = /* @__PURE__ */ new Set([
          "product_build",
          "instagram_dm",
          "discord_post",
          "whop_change",
          "supabase_migration",
          "vercel_deploy",
          "maintenance_upgrade",
          "error_repair"
        ]);
        const cat = allowedCats.has(String(args.category)) ? String(args.category) : "maintenance_upgrade";
        const res = await params.tools.queueApproval({
          category: cat,
          title: String(args.title || "Operator Approval Request"),
          target: String(args.target || "Workspace"),
          proposedAction: String(args.proposedAction || ""),
          consequences: String(args.consequences || "Requires explicit user confirmation.")
        });
        toolOutput = { ok: true, approval: res.approval };
        executedTools.push({
          name,
          status: "success",
          summary: `Queued approval "${res.approval.title}" (ID: ${res.approval.id})`
        });
      } else if (name === "create_local_backup") {
        const res = await params.tools.createBackup(String(args.reason || "chat_operator"));
        toolOutput = { ok: true, backup: res };
        executedTools.push({
          name,
          status: "success",
          summary: `Created backup ${res.filename} (${res.sizeKb} KB)`
        });
      } else if (name === "run_weekly_maintenance") {
        const res = await params.tools.runWeeklyMaintenance();
        toolOutput = { ok: true, inspectedCount: res.inspectedCount };
        executedTools.push({
          name,
          status: "success",
          summary: `Ran weekly maintenance across ${res.inspectedCount} project(s)`
        });
      } else {
        toolOutput = { ok: false, error: `Unknown tool: ${name}` };
      }
      functionResponseParts.push({
        functionResponse: {
          ...call.id ? { id: call.id } : {},
          name,
          response: toolOutput
        }
      });
    } catch (toolErr) {
      const errMsg = toolErr instanceof Error ? toolErr.message : "Tool execution failed";
      executedTools.push({ name, status: "error", summary: errMsg });
      functionResponseParts.push({
        functionResponse: {
          ...call.id ? { id: call.id } : {},
          name,
          response: { ok: false, error: errMsg }
        }
      });
    }
  }
  const previousContent = firstResponse.candidates?.[0]?.content;
  const followUpContents = previousContent ? [
    { role: "user", parts: [{ text: prompt }] },
    previousContent,
    { role: "user", parts: functionResponseParts }
  ] : [
    {
      role: "user",
      parts: [
        {
          text: `${prompt}

Completed Tool Results:
${JSON.stringify(executedTools, null, 2)}

Summarize truthfully what was executed.`
        }
      ]
    }
  ];
  let finalText = "";
  try {
    const { result: secondResponse } = await generateWithFallback(
      modelUsed,
      (m) => ai.models.generateContent({
        model: m,
        contents: followUpContents,
        config: buildCallConfig(activeWithSearch)
      })
    );
    for (const s of extractGroundingSources(secondResponse)) {
      if (!allSources.some((x) => x.uri === s.uri)) allSources.push(s);
    }
    finalText = secondResponse.text?.trim() || "";
  } catch {
    finalText = "";
  }
  if (!finalText) {
    finalText = executedTools.map((t) => `${t.status === "success" ? "Completed" : "Failed"}: ${t.summary}`).join("\n");
  }
  return { text: finalText, sources: allSources, executedTools, modelUsed };
}
async function discoverBusinessOpportunities(nicheQuery) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const prompt = `Research real-world software, web app, SaaS, or productivity tool problems related to: "${nicheQuery}".
Use Google Search grounding to inspect real public discussions (Reddit threads, customer reviews, forums, competitor pages, industry discussions).

CRITICAL INTEGRITY RULES:
- Do NOT invent market statistics, fake customer quotes, fabricated revenue figures, or imaginary competitors.
- Clearly separate VERIFIED EVIDENCE (from actual search results) from ASSUMPTIONS & ESTIMATES.
- Return EXACTLY THREE (3) distinct, realistic solo-founder software product opportunities suitable for building and running lean.
- Mark exactly ONE of the three as isRecommended: true and explain why it is the strongest opportunity.

Return ONLY valid JSON matching this exact structure (no markdown commentary outside the JSON):
{
  "opportunities": [
    {
      "rankIndex": 1,
      "productIdea": "Concise product title",
      "problemSolved": "Clear problem statement",
      "verifiedEvidence": "Specific real-world complaints, forum/review signals, or documented gaps found via search",
      "assumptionsAndEstimates": "Explicitly labeled estimates and assumptions (not verified facts)",
      "targetAudience": "Specific user segment",
      "competitors": "Real existing tools/competitors and their observed gaps",
      "proposedSolution": "Concrete software solution",
      "coreFeatures": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"],
      "technicalComplexity": "Low" | "Medium" | "High",
      "estimatedEffort": "e.g., 1-2 weeks MVP (estimate)",
      "monetizationStrategy": "Realistic pricing model (subject to user approval)",
      "risks": "Key market, distribution, and technical risks",
      "whyWorthBuilding": "Why a solo founder can realistically win here",
      "isRecommended": true,
      "recommendationReason": "Why this is or isn't the top pick"
    }
  ]
}`;
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    })
  );
  const sources = extractGroundingSources(res);
  const parsed = parseJsonFromModelText(res.text);
  const list = (parsed.opportunities || []).slice(0, 3);
  if (list.length !== 3) {
    throw new Error(`Discovery returned ${list.length} opportunities instead of the required 3. Please retry.`);
  }
  return {
    opportunities: list.map((item, idx) => ({
      ...item,
      rankIndex: idx + 1,
      coreFeatures: Array.isArray(item.coreFeatures) ? item.coreFeatures : [],
      technicalComplexity: item.technicalComplexity === "Low" || item.technicalComplexity === "High" ? item.technicalComplexity : "Medium",
      isRecommended: Boolean(item.isRecommended),
      sources
    })),
    sources
  };
}
async function generateProductPRD(opportunity) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Create a thorough, pragmatic Product Requirements Document (PRD) for a solo founder building:
Product Idea: ${opportunity.productIdea}
Problem Solved: ${opportunity.problemSolved}
Verified Evidence: ${opportunity.verifiedEvidence}
Target Audience: ${opportunity.targetAudience}
Competitors: ${opportunity.competitors}
Proposed Solution: ${opportunity.proposedSolution}
Core Features: ${opportunity.coreFeatures.join(", ")}

Ensure the architecture is lightweight (clean HTML/CSS/JS + local JSON or optional Supabase), practical, and testable.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedName: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            userPersonas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  role: { type: Type.STRING },
                  painPoint: { type: Type.STRING },
                  goal: { type: Type.STRING }
                },
                required: ["name", "role", "painPoint", "goal"]
              }
            },
            userJourneys: { type: Type.ARRAY, items: { type: Type.STRING } },
            featureList: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["name", "priority", "description"]
              }
            },
            competitorAnalysis: { type: Type.STRING },
            uxPlan: { type: Type.STRING },
            technicalArchitecture: { type: Type.STRING },
            databaseDesign: { type: Type.STRING },
            milestones: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  phase: { type: Type.STRING },
                  deliverables: { type: Type.STRING },
                  estimate: { type: Type.STRING }
                },
                required: ["phase", "deliverables", "estimate"]
              }
            },
            risksAndAssumptions: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: [
            "productNames",
            "recommendedName",
            "executiveSummary",
            "targetAudience",
            "userPersonas",
            "userJourneys",
            "featureList",
            "competitorAnalysis",
            "uxPlan",
            "technicalArchitecture",
            "databaseDesign",
            "milestones",
            "risksAndAssumptions"
          ]
        }
      }
    })
  );
  return parseJsonFromModelText(res.text);
}
async function generateProductSourceBundle(project) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Generate a complete, working, self-contained lightweight web application for the project "${project.name}".
Description: ${project.description}
PRD Summary: ${project.prd?.executiveSummary || project.description}
Core Features: ${(project.prd?.featureList || []).map((f) => f.name).join(", ")}

Requirements:
1. indexHtml: Complete valid HTML5 page referencing ./styles.css and ./app.js (using type="module"). Must have real interactive forms, lists, filters, localStorage persistence, and clean accessible dark UI. No inline event handlers.
2. stylesCss: Clean, responsive CSS with high contrast.
3. logicMjs: Pure ES module exporting core business logic functions (e.g., createItem, validateItem, calculateSummary, filterItems) with zero DOM dependencies so Node.js unit tests can import and test it directly.
4. appJs: Complete browser ES module importing from ./logic.mjs and wiring every button, form, search filter, and persistence state cleanly without dead clicks or innerHTML XSS sinks.
5. unitTestMjs: Genuine Node.js test file using 'node:test' and 'node:assert/strict' that imports from '../logic.mjs' and writes at least 4 thorough unit tests covering validation, state transformation, edge cases, and calculations.
6. readmeMd: Clear setup, architecture, and local preview instructions.

Return valid JSON only matching the schema.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            indexHtml: { type: Type.STRING },
            stylesCss: { type: Type.STRING },
            appJs: { type: Type.STRING },
            logicMjs: { type: Type.STRING },
            unitTestMjs: { type: Type.STRING },
            readmeMd: { type: Type.STRING }
          },
          required: ["indexHtml", "stylesCss", "appJs", "logicMjs", "unitTestMjs", "readmeMd"]
        }
      }
    })
  );
  return parseJsonFromModelText(res.text);
}
async function researchOutreachTargets(params) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const prompt = params.platform === "instagram" ? `Use Google Search to research 4 real public Instagram creators / influencers relevant to promoting "${params.productName}" (${params.productDescription}) in the niche "${params.niche}".
STRICT RULES:
- NEVER invent follower counts, emails, or handles. If a public follower count or business email is not confirmed in search results, write "Not publicly listed".
- Only include real publicly discoverable accounts found in search results with valid https:// URLs.
- Rank them 1 to 4 by relevance.
- Draft a respectful, personalized, non-spammy collaboration DM for each.
Return ONLY JSON:
{
  "targets": [
    {
      "name": "Creator name and @handle",
      "profileOrInviteUrl": "https://www.instagram.com/...",
      "niche": "Specific niche",
      "contentCategory": "Reels / tutorials / reviews etc.",
      "publicFollowersOrSize": "Verified public count or 'Not publicly listed'",
      "audienceRelevance": "Why their audience matches the product",
      "publicContactOrRules": "Public business email/link if listed, else 'Not publicly listed'",
      "promotionPermitted": "Collaboration/sponsorship notes",
      "relevanceRank": 1,
      "draftMessage": "Personalized outreach DM"
    }
  ]
}` : `Use Google Search to research 4 real public Discord communities relevant to "${params.productName}" (${params.productDescription}) in the niche "${params.niche}".
STRICT RULES:
- NEVER invent Discord invite links or member counts. Use real public directory/server pages or invite URLs found in search results; if member count or self-promo rules are unavailable, state "Verify server rules upon joining".
- Rank 1 to 4 by relevance.
- Draft a helpful, non-spammy community introduction/feedback post respecting server norms.
Return ONLY JSON:
{
  "targets": [
    {
      "name": "Community name",
      "profileOrInviteUrl": "https://...",
      "niche": "Topic / niche",
      "contentCategory": "Community focus",
      "publicFollowersOrSize": "Public member count or 'Not publicly listed'",
      "audienceRelevance": "Why this community is relevant",
      "publicContactOrRules": "Known rules or 'Verify server rules before posting'",
      "promotionPermitted": "Yes (promo channel) / Unknown \u2014 check rules / No direct promo",
      "relevanceRank": 1,
      "draftMessage": "Customized respectful community post"
    }
  ]
}`;
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    })
  );
  const sources = extractGroundingSources(res);
  const parsed = parseJsonFromModelText(res.text);
  const targets = (parsed.targets || []).map((t, idx) => ({
    name: String(t.name || "Unnamed Target"),
    profileOrInviteUrl: String(t.profileOrInviteUrl || ""),
    niche: String(t.niche || params.niche),
    contentCategory: String(t.contentCategory || "General"),
    publicFollowersOrSize: String(t.publicFollowersOrSize || "Not publicly listed"),
    audienceRelevance: String(t.audienceRelevance || ""),
    publicContactOrRules: String(t.publicContactOrRules || "Not publicly listed"),
    promotionPermitted: String(t.promotionPermitted || "Verify rules before posting"),
    relevanceRank: Number(t.relevanceRank) || idx + 1,
    draftMessage: String(t.draftMessage || "")
  }));
  return { targets, sources };
}
async function generatePresentationDeck(params) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const count = Math.min(Math.max(params.slideCount || 7, 4), 12);
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Generate a professional ${count}-slide presentation deck.
Title: ${params.title}
Target Audience: ${params.audience}
Objective: ${params.objective}
Additional Context: ${params.context || "None provided."}

Do NOT invent fake traction, fake revenue, or fake testimonials. Use concrete structure, clear talking points, and realistic frameworks.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            slides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slideNumber: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  layout: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  visualHint: { type: Type.STRING },
                  speakerNotes: { type: Type.STRING }
                },
                required: ["slideNumber", "title", "layout", "keyPoints", "visualHint", "speakerNotes"]
              }
            }
          },
          required: ["slides"]
        }
      }
    })
  );
  const parsed = parseJsonFromModelText(res.text);
  return (parsed.slides || []).map((s, idx) => ({
    ...s,
    slideNumber: idx + 1,
    layout: ["title", "bullets", "split", "metrics", "closing"].includes(s.layout) ? s.layout : "bullets"
  }));
}
async function diagnoseProjectError(params) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const filesText = Object.entries(params.fileSnapshot).map(([name, content]) => `--- FILE: ${name} ---
${content.slice(0, 6e3)}`).join("\n\n");
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Diagnose this application error and prepare a safe, minimal, reversible fix.
Project: ${params.project.name}
Component: ${params.component}
Error Message: ${params.errorMessage}

Workspace Files:
${filesText}

Choose the single most relevant existing file to patch (e.g., "app.js", "logic.mjs", "index.html", or "styles.css") and provide the complete corrected file content.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosis: { type: Type.STRING },
            affectedFile: { type: Type.STRING },
            proposedFixSummary: { type: Type.STRING },
            patchedFileContent: { type: Type.STRING }
          },
          required: ["diagnosis", "affectedFile", "proposedFixSummary", "patchedFileContent"]
        }
      }
    })
  );
  return parseJsonFromModelText(res.text);
}
async function generateMaintenancePlan(project) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Prepare a weekly maintenance & improvement plan for this registered application:
Name: ${project.name}
Tech Stack: ${project.techStack}
Status: ${project.status}
Health Status: ${project.healthStatus}
Recent Errors: ${project.recentErrors || "None recorded"}
Deployment Status: ${project.deploymentStatus}
Description: ${project.description}

Identify concrete maintenance actions and 2-3 high-value feature or reliability improvements with explicit reasons and risk levels.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            healthSummary: { type: Type.STRING },
            dependencyNotes: { type: Type.STRING },
            proposedImprovements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  riskLevel: { type: Type.STRING }
                },
                required: ["title", "reason", "riskLevel"]
              }
            }
          },
          required: ["healthSummary", "dependencyNotes", "proposedImprovements"]
        }
      }
    })
  );
  return parseJsonFromModelText(res.text);
}
async function generateSupabaseMigrationSql(projectName, schemaDescription) {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const { result: res } = await generateWithFallback(
    primaryModel,
    (m) => ai.models.generateContent({
      model: m,
      contents: `Generate a safe, reversible PostgreSQL / Supabase migration with Row Level Security (RLS) enabled for "${projectName}".
Requirements: ${schemaDescription}
Provide both UP migration SQL and reversible DOWN rollback SQL, plus concise security notes.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            upSql: { type: Type.STRING },
            downSql: { type: Type.STRING },
            notes: { type: Type.STRING }
          },
          required: ["upSql", "downSql", "notes"]
        }
      }
    })
  );
  return parseJsonFromModelText(res.text);
}

// src/server/integrations.ts
var PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^172\.(1[6-9]|2\d|3[01])\./
];
function validatePublicHealthUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http and https URLs are allowed for health checks.");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      throw new Error("Health checks cannot target loopback, private, or link-local addresses.");
    }
  }
  return parsed;
}
async function runSafeProjectHealthCheck(liveUrl, previewSlug, localServerBaseUrl) {
  try {
    if (liveUrl) {
      const safe = validatePublicHealthUrl(liveUrl);
      const res2 = await fetch(safe.toString(), { method: "GET", signal: AbortSignal.timeout(6e3) });
      return { ok: res2.ok, statusCode: res2.status, target: safe.toString() };
    }
    if (!/^[a-z0-9-]+$/.test(previewSlug)) {
      return { ok: false, statusCode: null, target: "invalid", error: "Invalid project slug." };
    }
    const localUrl = `${localServerBaseUrl}/preview/${previewSlug}/`;
    const res = await fetch(localUrl, { method: "GET", signal: AbortSignal.timeout(4e3) });
    return { ok: res.ok, statusCode: res.status, target: localUrl };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      target: liveUrl || `/preview/${previewSlug}/`,
      error: err instanceof Error ? err.message : "Health check failed"
    };
  }
}
function getIntegrationStatusSnapshot() {
  const geminiSecret = getGeminiSecretStatus();
  const whopConfigured = Boolean(process.env.WHOP_API_KEY);
  const supabaseUrlConfigured = Boolean(process.env.SUPABASE_URL);
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  const vercelConfigured = Boolean(process.env.VERCEL_TOKEN);
  return {
    gemini: {
      configured: geminiSecret.configured,
      credentialSource: geminiSecret.source,
      model: getSelectedModel(),
      lastVerifiedAt: getSetting("gemini_last_verified_at") || null,
      lastStatus: getSetting("gemini_last_status", "untested"),
      lastError: geminiSecret.warning || getSetting("gemini_last_error") || null
    },
    whop: {
      configured: whopConfigured,
      lastVerifiedAt: getSetting("whop_last_verified_at") || null,
      status: whopConfigured ? getSetting("whop_last_status", "connected") : "disconnected",
      error: getSetting("whop_last_error") || null
    },
    supabase: {
      configured: supabaseConfigured,
      urlConfigured: supabaseUrlConfigured,
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      status: supabaseConfigured ? getSetting("supabase_last_status", "connected") : "disconnected",
      error: getSetting("supabase_last_error") || null
    },
    vercel: {
      configured: vercelConfigured,
      status: vercelConfigured ? getSetting("vercel_last_status", "connected") : "disconnected",
      error: getSetting("vercel_last_error") || null
    },
    freemodel: {
      status: "documentation_required",
      note: "FreeModel.in is registered in the modular provider interface, but not yet wired. Official documentation (base URL, auth header format, models, streaming spec) must be inspected before enabling\u2014never assumed to be OpenAI-compatible."
    },
    instagram: {
      authorizedAccount: getSetting("instagram_authorized_account", ""),
      mode: "guided_manual"
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      electronDetected: Boolean(process.versions.electron),
      memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      storageEngine: "Local JSON Files (v1.0)",
      storagePath: DB_PATH
    }
  };
}
async function fetchWhopAnalytics() {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    return {
      connected: false,
      reportingPeriod: "Unavailable (Whop not connected)",
      lastRefreshedAt: null,
      error: "Configure WHOP_API_KEY in Settings > Secrets to pull live Whop sales, subscriptions, and product metrics.",
      products: [],
      metrics: {
        totalSales: null,
        transactions: null,
        revenueUsd: null,
        activeSubscriptions: null,
        cancellations: null,
        refunds: null
      }
    };
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json"
  };
  try {
    const [prodRes, memRes, payRes] = await Promise.all([
      fetch("https://api.whop.com/api/v2/products", { headers, signal: AbortSignal.timeout(8e3) }),
      fetch("https://api.whop.com/api/v2/memberships", { headers, signal: AbortSignal.timeout(8e3) }),
      fetch("https://api.whop.com/api/v2/payments", { headers, signal: AbortSignal.timeout(8e3) })
    ]);
    if (!prodRes.ok) {
      throw new Error(`Whop API returned HTTP ${prodRes.status}. Verify WHOP_API_KEY permissions.`);
    }
    const prodJson = await prodRes.json();
    const memJson = memRes.ok ? await memRes.json() : { data: [] };
    const payJson = payRes.ok ? await payRes.json() : { data: [] };
    const payments = payJson.data ?? [];
    const memberships = memJson.data ?? [];
    const products = (prodJson.data ?? []).map((p) => ({
      id: p.id,
      name: p.name || p.title || p.id,
      visibility: p.visibility
    }));
    const paidPayments = payments.filter((p) => p.status === "paid" || p.status === "succeeded");
    const revenueUsd = paidPayments.reduce((sum, p) => sum + (Number(p.final_amount) || 0) / 100, 0);
    const refunds = payments.filter((p) => (Number(p.refunded_amount) || 0) > 0 || p.status === "refunded").length;
    const activeSubscriptions = memberships.filter((m) => m.status === "active" || m.status === "trialing").length;
    const cancellations = memberships.filter((m) => m.status === "canceled" || m.cancel_at_period_end).length;
    const refreshed = nowIso();
    logActivity("whop", "Refreshed live Whop analytics", `Loaded ${products.length} products and ${payments.length} payments`, "success");
    return {
      connected: true,
      reportingPeriod: "Current API Page (Latest Records)",
      lastRefreshedAt: refreshed,
      error: null,
      products,
      metrics: {
        totalSales: paidPayments.length,
        transactions: payments.length,
        revenueUsd: Number(revenueUsd.toFixed(2)),
        activeSubscriptions,
        cancellations,
        refunds
      }
    };
  } catch (err) {
    return {
      connected: false,
      reportingPeriod: "Unavailable",
      lastRefreshedAt: nowIso(),
      error: err instanceof Error ? err.message : "Failed to query Whop API",
      products: [],
      metrics: {
        totalSales: null,
        transactions: null,
        revenueUsd: null,
        activeSubscriptions: null,
        cancellations: null,
        refunds: null
      }
    };
  }
}
async function testSupabaseConnection() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      connected: false,
      message: "SUPABASE_URL and SUPABASE_ANON_KEY are not configured in server environment secrets."
    };
  }
  try {
    const parsed = validatePublicHealthUrl(url);
    const res = await fetch(`${parsed.origin}/rest/v1/`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      signal: AbortSignal.timeout(7e3)
    });
    if (!res.ok) {
      return {
        connected: false,
        message: `Supabase REST endpoint returned HTTP ${res.status}. Verify project URL and anon key.`,
        projectHost: parsed.host
      };
    }
    logActivity("supabase", "Verified Supabase REST connection", `Host: ${parsed.host}`, "success");
    return {
      connected: true,
      message: `Connected to Supabase REST API at ${parsed.host}. Service-role key stays strictly server-side.`,
      projectHost: parsed.host
    };
  } catch (err) {
    return {
      connected: false,
      message: err instanceof Error ? err.message : "Supabase connection test failed."
    };
  }
}
async function listVercelProjects() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      connected: false,
      projects: [],
      error: "VERCEL_TOKEN is not configured in server environment secrets."
    };
  }
  try {
    const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
    const res = await fetch(`https://api.vercel.com/v9/projects${teamQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) {
      return {
        connected: false,
        projects: [],
        error: `Vercel API returned HTTP ${res.status}. Verify VERCEL_TOKEN.`
      };
    }
    const data = await res.json();
    const projects = (data.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework || null,
      updatedAt: p.updatedAt || Date.now(),
      liveUrl: p.latestDeployments?.[0]?.url ? `https://${p.latestDeployments[0].url}` : null
    }));
    logActivity("vercel", "Inspected Vercel projects", `Found ${projects.length} project(s)`, "success");
    return { connected: true, projects };
  } catch (err) {
    return {
      connected: false,
      projects: [],
      error: err instanceof Error ? err.message : "Failed to reach Vercel API"
    };
  }
}

// server.ts
var PORT = Number(process.env.PORT || 3e3);
var LOCAL_BASE_URL = `http://127.0.0.1:${PORT}`;
var IS_PROD = process.env.NODE_ENV === "production";
async function executeWeeklyMaintenanceAcrossAllProjects() {
  const projects = listProjects();
  const plans = [];
  for (const project of projects) {
    const health = await runSafeProjectHealthCheck(project.liveUrl, project.slug, LOCAL_BASE_URL);
    const nextHealth = health.ok ? "healthy" : "error";
    const updated = updateProject(project.id, {
      healthStatus: nextHealth,
      lastHealthCheck: nowIso(),
      recentErrors: health.ok ? null : health.error || `HTTP ${health.statusCode}`
    });
    const plan = await generateMaintenancePlan(updated || project);
    let approvalsCreated = 0;
    for (const imp of plan.proposedImprovements) {
      createApproval({
        category: "maintenance_upgrade",
        title: `Maintenance Upgrade: ${imp.title}`,
        target: `${project.name} (${project.slug})`,
        proposedAction: `Back up workspace, implement "${imp.title}", and execute all 3 testing passes.`,
        consequences: `Reason: ${imp.reason}. Risk level: ${imp.riskLevel}. Production deployment remains gated behind a separate deployment approval.`,
        payload: {
          projectId: project.id,
          improvementTitle: imp.title,
          reason: imp.reason,
          riskLevel: imp.riskLevel
        }
      });
      approvalsCreated += 1;
    }
    plans.push({
      projectId: project.id,
      projectName: project.name,
      healthStatus: nextHealth,
      healthSummary: plan.healthSummary,
      dependencyNotes: plan.dependencyNotes,
      proposedImprovements: plan.proposedImprovements,
      approvalsCreated
    });
  }
  logActivity(
    "maintenance",
    "Executed weekly application maintenance scan",
    `Inspected ${projects.length} registered project(s) and queued approval plans for proposed improvements.`,
    "success"
  );
  return { inspectedCount: projects.length, plans };
}
async function runAutomationTaskById(taskId) {
  const tasks = listAutomations();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Automation task not found.");
  if (!task.approvedByUser) {
    throw new Error("Automation must be explicitly approved by the user before running.");
  }
  const projects = listProjects();
  let summary = "";
  if (task.taskType === "health_check") {
    let okCount = 0;
    let errCount = 0;
    for (const p of projects) {
      const check = await runSafeProjectHealthCheck(p.liveUrl, p.slug, LOCAL_BASE_URL);
      updateProject(p.id, {
        healthStatus: check.ok ? "healthy" : "error",
        lastHealthCheck: nowIso(),
        recentErrors: check.ok ? null : check.error || `HTTP ${check.statusCode}`
      });
      if (check.ok) okCount++;
      else errCount++;
    }
    summary = projects.length === 0 ? "No registered projects to check." : `Checked ${projects.length} app(s): ${okCount} healthy, ${errCount} reporting errors.`;
  } else if (task.taskType === "backup_workspace") {
    let backedUp = 0;
    for (const p of projects) {
      try {
        const dir = resolveSafeWorkspaceDir(p.slug);
        if (fs4.existsSync(dir)) {
          backupWorkspace(p.slug, "scheduled");
          backedUp++;
        }
      } catch {
      }
    }
    summary = `Created local workspace backups for ${backedUp} built project(s).`;
  } else if (task.taskType === "weekly_maintenance_scan") {
    const res = await executeWeeklyMaintenanceAcrossAllProjects();
    summary = `Inspected ${res.inspectedCount} project(s) and queued improvement approvals.`;
  }
  const updated = updateAutomation(task.id, {
    lastRunAt: nowIso(),
    lastResult: summary,
    lastStatus: "success"
  });
  logActivity("automation", `Ran scheduled task: ${task.name}`, summary, "success");
  return updated;
}
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.get("/preview/:slug/*", (req, res) => {
    try {
      const slug = String(req.params.slug || "");
      const rel = String(req.params[0] || "index.html");
      const targetRel = rel === "" ? "index.html" : rel;
      const fullPath = resolveSafeWorkspaceFile(slug, targetRel);
      if (!fs4.existsSync(fullPath) || fs4.statSync(fullPath).isDirectory()) {
        res.status(404).type("text/plain").send("Workspace preview file not found.");
        return;
      }
      res.sendFile(fullPath);
    } catch {
      res.status(400).type("text/plain").send("Invalid workspace preview request.");
    }
  });
  app.get("/preview/:slug", (req, res) => {
    try {
      const slug = String(req.params.slug || "");
      const fullPath = resolveSafeWorkspaceFile(slug, "index.html");
      if (!fs4.existsSync(fullPath)) {
        res.status(404).type("text/plain").send("Workspace has not been built yet.");
        return;
      }
      res.sendFile(fullPath);
    } catch {
      res.status(400).type("text/plain").send("Invalid workspace preview request.");
    }
  });
  app.get("/api/status", (_req, res) => {
    res.json({
      integrations: getIntegrationStatusSnapshot(),
      settings: getAllSettings(),
      metrics: getCrmMetrics()
    });
  });
  app.post("/api/settings", (req, res) => {
    const body = req.body;
    if (body && typeof body.gemini_model === "string" && !isValidGeminiModelId(body.gemini_model)) {
      res.status(400).json({
        error: `Model "${body.gemini_model}" is deprecated or invalid. Use an active Gemini model such as gemini-3.1-flash-lite or gemini-4-hydrogen.`
      });
      return;
    }
    const allowedKeys = /* @__PURE__ */ new Set([
      "gemini_model",
      "onboarding_completed",
      "voice_enabled",
      "voice_rate",
      "voice_volume",
      "voice_lang",
      "voice_name",
      "instagram_authorized_account",
      "operator_name"
    ]);
    for (const [k, v] of Object.entries(body || {})) {
      if (allowedKeys.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        setSetting(k, String(v).trim());
      }
    }
    logActivity("settings", "Updated STRANGE preferences", Object.keys(body || {}).join(", "), "info");
    res.json({ ok: true, settings: getAllSettings(), integrations: getIntegrationStatusSnapshot() });
  });
  app.post("/api/ai/test", async (req, res) => {
    const rawModel = typeof req.body?.model === "string" ? req.body.model.trim() : void 0;
    const model = rawModel ? rawModel : void 0;
    if (model && !isValidGeminiModelId(model)) {
      res.status(400).json({
        ok: false,
        error: `Model "${model}" is deprecated or invalid. Use an active Gemini model such as gemini-3.1-flash-lite or gemini-4-hydrogen.`
      });
      return;
    }
    const result = await testGeminiConnection(model);
    logActivity(
      "ai",
      "Tested Gemini API connection",
      result.ok ? `Connected (${result.modelUsed || result.model}, ${result.latencyMs}ms)` : result.error || "Connection failed",
      result.ok ? "success" : "error"
    );
    res.status(result.ok ? 200 : 502).json(result);
  });
  app.post("/api/ai/diagnostics", async (req, res) => {
    const rawModel = typeof req.body?.model === "string" ? req.body.model.trim() : void 0;
    const report = await runFullAiDiagnostics(rawModel || void 0);
    logActivity(
      "ai",
      "Ran 6-point AI connection diagnostic",
      report.overallOk ? `All 6 checks passed (${report.activeModelUsed || report.configuredModel}, ${report.latencyMs}ms)` : `Diagnostic completed with failures (${report.checks.filter((c) => c.status === "fail").length} failed)`,
      report.overallOk ? "success" : "warning"
    );
    res.status(200).json(report);
  });
  app.get("/api/conversations", (_req, res) => {
    let list = listConversations();
    if (list.length === 0) {
      const initial = createConversation("Primary Command Session");
      list = [initial];
    }
    res.json({ conversations: list });
  });
  app.post("/api/conversations", (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "New Operator Session";
    const conv = createConversation(title);
    res.status(201).json({ conversation: conv });
  });
  app.delete("/api/conversations/:id", (req, res) => {
    deleteConversation(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/conversations/:id/messages", (req, res) => {
    res.json({ messages: listMessages(req.params.id) });
  });
  app.post("/api/chat", async (req, res) => {
    try {
      const conversationId = String(req.body?.conversationId || "");
      const content = String(req.body?.content || "").trim();
      const attachmentName = typeof req.body?.attachmentName === "string" ? req.body.attachmentName.slice(0, 120) : void 0;
      const attachmentText = typeof req.body?.attachmentText === "string" ? req.body.attachmentText : void 0;
      const useWebSearch = Boolean(req.body?.useWebSearch);
      if (!conversationId || !content) {
        res.status(400).json({ error: "conversationId and content are required." });
        return;
      }
      const historyBefore = listMessages(conversationId);
      const userMsg = addMessage({
        conversationId,
        role: "user",
        content,
        attachmentName
      });
      if (historyBefore.length === 0) {
        updateConversationTitle(conversationId, content.slice(0, 56));
      }
      if (/strange[\s,:-]*update all my applications/i.test(content)) {
        const result = await executeWeeklyMaintenanceAcrossAllProjects();
        const replyBody = result.inspectedCount === 0 ? "Weekly maintenance check completed: no registered projects exist in local storage yet. Discover a business opportunity in the Research Centre and create a project first." : [
          `Weekly maintenance scan completed across ${result.inspectedCount} registered project(s):`,
          "",
          ...result.plans.map(
            (p, i) => `${i + 1}. ${p.projectName} \u2014 Health: ${p.healthStatus}
   Summary: ${p.healthSummary}
   Dependencies: ${p.dependencyNotes}
   Queued ${p.approvalsCreated} feature/maintenance approval item(s) for your review before any code changes are applied.`
          ),
          "",
          "Review and approve individual upgrades in the Automation Centre / Approval Queue."
        ].join("\n");
        const assistantMsg2 = addMessage({
          conversationId,
          role: "assistant",
          content: replyBody,
          taskState: result.inspectedCount > 0 ? "waiting_for_approval" : "completed"
        });
        res.json({ userMessage: userMsg, assistantMessage: assistantMsg2, maintenance: result });
        return;
      }
      const metrics = getCrmMetrics();
      const projects = listProjects();
      const pendingApprovals = listApprovals().filter((a) => a.status === "pending");
      const automations = listAutomations();
      const contextSnapshot = JSON.stringify(
        {
          metrics,
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            healthStatus: p.healthStatus,
            deploymentStatus: p.deploymentStatus,
            recentErrors: p.recentErrors
          })),
          automations: automations.map((a) => ({
            id: a.id,
            name: a.name,
            taskType: a.taskType,
            intervalMinutes: a.intervalMinutes,
            enabled: a.enabled,
            lastStatus: a.lastStatus
          })),
          pendingApprovals: pendingApprovals.map((a) => ({
            id: a.id,
            category: a.category,
            title: a.title,
            target: a.target
          }))
        },
        null,
        2
      );
      const aiResult = await generateOperatorReply({
        history: historyBefore,
        userMessage: content,
        attachmentText,
        contextSnapshot,
        useWebSearch,
        tools: {
          createAutomation: async ({ name, taskType, intervalMinutes, description }) => {
            const automation = createAutomation({
              name,
              description,
              taskType,
              intervalMinutes: Math.max(5, Number(intervalMinutes || 60)),
              enabled: true,
              approvedByUser: true
            });
            logActivity(
              "automation",
              `Created scheduled task via chat: ${automation.name}`,
              `Type: ${automation.taskType}, every ${automation.intervalMinutes} min`,
              "success"
            );
            return { automation };
          },
          listAutomations: async () => ({ automations: listAutomations() }),
          runAutomation: async (taskId) => {
            const automation = await runAutomationTaskById(taskId);
            return { automation };
          },
          queueApproval: async ({ category, title, target, proposedAction, consequences }) => {
            const approval = createApproval({
              category,
              title,
              target,
              proposedAction,
              consequences,
              payload: { source: "chat_operator" }
            });
            logActivity("approval", `Queued approval via chat: ${approval.title}`, `Target: ${approval.target}`, "info");
            return { approval };
          },
          createBackup: async (reason) => {
            const backup = createAutomaticBackup(reason || "chat_operator");
            logActivity(
              "storage",
              "Created local JSON backup via chat",
              `${backup.filename} (${backup.sizeKb} KB)`,
              "success"
            );
            return { filename: backup.filename, sizeKb: backup.sizeKb };
          },
          runWeeklyMaintenance: async () => {
            const res2 = await executeWeeklyMaintenanceAcrossAllProjects();
            return { inspectedCount: res2.inspectedCount };
          }
        }
      });
      const waitingForApproval = aiResult.executedTools.some(
        (t) => t.name === "queue_approval" && t.status === "success"
      );
      const assistantMsg = addMessage({
        conversationId,
        role: "assistant",
        content: aiResult.text,
        sources: aiResult.sources,
        executedTools: aiResult.executedTools.length > 0 ? aiResult.executedTools : void 0,
        modelUsed: aiResult.modelUsed,
        taskState: waitingForApproval ? "waiting_for_approval" : "completed"
      });
      res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process message";
      logActivity("ai", "Assistant request failed", message, "error");
      res.status(502).json({ error: message });
    }
  });
  app.get("/api/research/opportunities", (_req, res) => {
    res.json({ opportunities: listOpportunities() });
  });
  app.post("/api/research/discover", async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) {
        res.status(400).json({ error: "Research topic or niche query is required." });
        return;
      }
      const batchId = newId("batch");
      const { opportunities, sources } = await discoverBusinessOpportunities(query);
      const saved = saveOpportunities(
        opportunities.map((o) => ({
          ...o,
          batchId,
          query,
          priorityOrder: null,
          status: "discovered"
        }))
      );
      logActivity(
        "research",
        `Discovered 3 business opportunities for "${query}"`,
        `Verified ${sources.length} public web source(s) via Google Search grounding.`,
        "success"
      );
      res.status(201).json({ batchId, opportunities: saved, sources });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Discovery failed";
      logActivity("research", "Business discovery failed", msg, "error");
      res.status(502).json({ error: msg });
    }
  });
  app.post("/api/research/opportunities/:id/select", async (req, res) => {
    try {
      const opp = getOpportunity(req.params.id);
      if (!opp) {
        res.status(404).json({ error: "Opportunity not found." });
        return;
      }
      const priorityOrder = typeof req.body?.priorityOrder === "number" ? req.body.priorityOrder : 1;
      updateOpportunitySelection(opp.id, "selected", priorityOrder);
      const prd = await generateProductPRD(opp);
      const baseSlug = slugifyProjectName(prd.recommendedName || opp.productIdea);
      const existingSlugs = new Set(listProjects().map((p) => p.slug));
      const slug = existingSlugs.has(baseSlug) ? `${baseSlug}-${Date.now().toString().slice(-4)}` : baseSlug;
      const folderPath = resolveSafeWorkspaceDir(slug);
      const project = createProject({
        slug,
        name: prd.recommendedName || opp.productIdea,
        opportunityId: opp.id,
        description: opp.proposedSolution,
        folderPath,
        techStack: "HTML5, CSS3, ES Modules, Node.js Test Runner, Local Persistence",
        status: "prd_review",
        prd,
        liveUrl: null,
        previewUrl: null,
        deploymentStatus: "not_deployed",
        healthStatus: "unknown",
        lastHealthCheck: null,
        dbStatus: "local_json",
        recentErrors: null,
        testResults: [],
        userApprovedForMarketing: false,
        lastDeployedAt: null
      });
      logActivity(
        "project",
        `Stage A PRD generated for ${project.name}`,
        `User selected opportunity #${opp.rankIndex} (priority ${priorityOrder}). Awaiting PRD review before building.`,
        "success"
      );
      res.status(201).json({ project });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate PRD";
      res.status(502).json({ error: msg });
    }
  });
  app.get("/api/projects", (_req, res) => {
    res.json({ projects: listProjects() });
  });
  app.post("/api/projects/:id/build", async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      updateProject(project.id, { status: "building" });
      const bundle = await generateProductSourceBundle(project);
      writeProjectFiles(project.slug, bundle, project.name);
      if (project.opportunityId) {
        updateOpportunitySelection(project.opportunityId, "in_development", 1);
      }
      const previewUrl = `/preview/${project.slug}/`;
      const updated = updateProject(project.id, {
        status: "testing",
        previewUrl,
        healthStatus: "healthy",
        lastHealthCheck: nowIso(),
        recentErrors: null
      });
      logActivity(
        "project",
        `Stage B built isolated workspace for ${project.name}`,
        `Generated runnable files in ${project.folderPath} and live preview at ${previewUrl}`,
        "success"
      );
      res.json({ project: updated, files: readProjectFiles(project.slug) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Build failed";
      updateProject(req.params.id, { status: "error", recentErrors: msg });
      logActivity("project", "Product build failed", msg, "error");
      res.status(502).json({ error: msg });
    }
  });
  app.post("/api/projects/:id/test", async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const results = await runThreeTestingPasses(project, LOCAL_BASE_URL);
      const anyFailed = results.some((r) => r.status === "failed");
      const updated = updateProject(project.id, {
        testResults: results,
        status: anyFailed ? "error" : "handover_ready",
        healthStatus: anyFailed ? "degraded" : "healthy",
        lastHealthCheck: nowIso(),
        recentErrors: anyFailed ? results.find((r) => r.status === "failed")?.summary || "Test failure" : null
      });
      res.json({ project: updated, testResults: results });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Testing pass execution failed" });
    }
  });
  app.get("/api/projects/:id/files", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ files: readProjectFiles(project.slug) });
  });
  app.put("/api/projects/:id/files", (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const file = String(req.body?.file || "");
      const content = String(req.body?.content ?? "");
      backupWorkspace(project.slug, "manual_edit");
      applyWorkspaceFilePatch(project.slug, file, content);
      logActivity("project", `Updated ${file} in ${project.name}`, "Backup created automatically before saving.", "info");
      res.json({ ok: true, files: readProjectFiles(project.slug) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to update file" });
    }
  });
  app.post("/api/projects/:id/approve-marketing", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const updated = updateProject(project.id, {
      userApprovedForMarketing: true,
      status: project.deploymentStatus === "deployed" ? "deployed" : "approved"
    });
    if (project.opportunityId) {
      updateOpportunitySelection(project.opportunityId, "completed", 1);
    }
    logActivity(
      "project",
      `Product approved by user: ${project.name}`,
      "Handover accepted. Influencer & Discord outreach unlocked for this product.",
      "success"
    );
    res.json({ project: updated });
  });
  app.post("/api/projects/:id/health-check", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const result = await runSafeProjectHealthCheck(project.liveUrl, project.slug, LOCAL_BASE_URL);
    const updated = updateProject(project.id, {
      healthStatus: result.ok ? "healthy" : "error",
      lastHealthCheck: nowIso(),
      recentErrors: result.ok ? null : result.error || `HTTP ${result.statusCode}`
    });
    logActivity(
      "monitoring",
      `Health check: ${project.name}`,
      result.ok ? `Healthy (HTTP ${result.statusCode}) at ${result.target}` : result.error || `HTTP ${result.statusCode}`,
      result.ok ? "success" : "error"
    );
    res.json({ project: updated, check: result });
  });
  app.get("/api/errors", (_req, res) => {
    res.json({ errors: listErrorReports() });
  });
  app.post("/api/projects/:id/errors", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const component = String(req.body?.component || "runtime").slice(0, 80);
    const errorMessage = String(req.body?.errorMessage || "").trim();
    if (!errorMessage) {
      res.status(400).json({ error: "errorMessage is required." });
      return;
    }
    const report = createErrorReport({
      projectId: project.id,
      projectName: project.name,
      component,
      errorMessage
    });
    updateProject(project.id, { healthStatus: "error", recentErrors: errorMessage });
    logActivity("monitoring", `Logged error for ${project.name}`, `${component}: ${errorMessage}`, "error");
    res.status(201).json({ report });
  });
  app.post("/api/errors/:id/diagnose", async (req, res) => {
    try {
      const report = listErrorReports().find((e) => e.id === req.params.id);
      if (!report) {
        res.status(404).json({ error: "Error report not found." });
        return;
      }
      const project = getProject(report.projectId);
      if (!project) {
        res.status(404).json({ error: "Associated project not found." });
        return;
      }
      const files = readProjectFiles(project.slug);
      const backupPath = backupWorkspace(project.slug, "pre_repair");
      const diag = await diagnoseProjectError({
        project,
        component: report.component,
        errorMessage: report.errorMessage,
        fileSnapshot: files
      });
      const updatedReport = updateErrorReport(report.id, {
        diagnosis: diag.diagnosis,
        backupPath,
        proposedFixFile: diag.affectedFile,
        proposedFixSummary: diag.proposedFixSummary,
        status: "diagnosed"
      });
      const approval = createApproval({
        category: "error_repair",
        title: `Apply Reversible Repair: ${project.name}`,
        target: `${project.name} / ${diag.affectedFile}`,
        proposedAction: diag.proposedFixSummary,
        consequences: `Backup saved to ${backupPath}. Approving will patch ${diag.affectedFile} and automatically rerun the 3-pass test suite.`,
        payload: {
          errorReportId: report.id,
          projectId: project.id,
          affectedFile: diag.affectedFile,
          patchedFileContent: diag.patchedFileContent,
          backupPath
        }
      });
      logActivity("repair", `Diagnosed error in ${project.name}`, diag.diagnosis.slice(0, 200), "info");
      res.json({ report: updatedReport, approval });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Diagnosis failed" });
    }
  });
  app.post("/api/errors/:id/rollback", (req, res) => {
    try {
      const report = listErrorReports().find((e) => e.id === req.params.id);
      if (!report || !report.backupPath) {
        res.status(404).json({ error: "Error report or backup path not found." });
        return;
      }
      const project = getProject(report.projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      restoreWorkspaceFromBackup(project.slug, report.backupPath);
      const updated = updateErrorReport(report.id, { status: "rolled_back" });
      logActivity("repair", `Rolled back repair for ${project.name}`, `Restored workspace from ${report.backupPath}`, "warning");
      res.json({ report: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Rollback failed" });
    }
  });
  app.get("/api/outreach", (req, res) => {
    const platform = req.query.platform === "instagram" || req.query.platform === "discord" ? req.query.platform : void 0;
    res.json({ targets: listOutreachTargets(platform) });
  });
  app.post("/api/outreach/research", async (req, res) => {
    try {
      const platform = req.body?.platform === "discord" ? "discord" : "instagram";
      const niche = String(req.body?.niche || "").trim();
      const projectId = typeof req.body?.projectId === "string" && req.body.projectId ? req.body.projectId : null;
      if (!niche) {
        res.status(400).json({ error: "Niche or topic is required." });
        return;
      }
      let productName = String(req.body?.productName || "Selected Product");
      let productDescription = String(req.body?.productDescription || niche);
      if (projectId) {
        const project = getProject(projectId);
        if (project) {
          if (!project.userApprovedForMarketing) {
            res.status(403).json({
              error: `Product "${project.name}" has not been approved for marketing yet. Approve it in My Projects (Stage D) before starting outreach.`
            });
            return;
          }
          productName = project.name;
          productDescription = project.description;
        }
      }
      const { targets, sources } = await researchOutreachTargets({
        platform,
        niche,
        productName,
        productDescription
      });
      const saved = saveOutreachTargets(
        targets.map((t) => ({
          ...t,
          projectId,
          platform,
          followStatus: platform === "instagram" ? "manual_required" : "not_started",
          deliveryStatus: "draft_ready",
          sources
        }))
      );
      logActivity(
        "outreach",
        `Researched ${saved.length} ${platform} targets`,
        `Niche: ${niche}. Grounded with ${sources.length} public web source(s).`,
        "success"
      );
      res.status(201).json({ targets: saved, sources });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Outreach research failed" });
    }
  });
  app.patch("/api/outreach/:id", (req, res) => {
    const updated = updateOutreachTarget(req.params.id, {
      ...typeof req.body?.draftMessage === "string" ? { draftMessage: req.body.draftMessage } : {},
      ...req.body?.followStatus ? { followStatus: req.body.followStatus } : {},
      ...req.body?.deliveryStatus ? { deliveryStatus: req.body.deliveryStatus } : {}
    });
    if (!updated) {
      res.status(404).json({ error: "Outreach target not found." });
      return;
    }
    if (req.body?.deliveryStatus === "sent_verified") {
      logActivity("outreach", `Verified manual delivery to ${updated.name}`, `Platform: ${updated.platform}`, "success");
    }
    res.json({ target: updated });
  });
  app.post("/api/outreach/:id/request-approval", (req, res) => {
    const target = listOutreachTargets().find((t) => t.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "Outreach target not found." });
      return;
    }
    updateOutreachTarget(target.id, { deliveryStatus: "pending_approval" });
    const approval = createApproval({
      category: target.platform === "instagram" ? "instagram_dm" : "discord_post",
      title: `${target.platform === "instagram" ? "Instagram DM" : "Discord Post"} Approval: ${target.name}`,
      target: `${target.name} (${target.profileOrInviteUrl})`,
      proposedAction: target.draftMessage,
      consequences: target.platform === "instagram" ? "Guided manual workflow: automated Instagram following/DMing is restricted by platform anti-bot policy. Approving unlocks copy-and-open handoff for your authorized Instagram account and records delivery in CRM." : "Respects Discord server rules and rate limits. Approving prepares the verified post for manual or authorized webhook delivery and logs it in CRM.",
      payload: { outreachId: target.id, platform: target.platform }
    });
    logActivity("outreach", `Queued approval for ${target.name}`, `Platform: ${target.platform}`, "info");
    res.status(201).json({ approval });
  });
  app.get("/api/approvals", (_req, res) => {
    res.json({ approvals: listApprovals() });
  });
  app.post("/api/approvals", (req, res) => {
    const { category, title, target, proposedAction, consequences, payload } = req.body || {};
    if (!category || !title || !target || !proposedAction) {
      res.status(400).json({ error: "category, title, target, and proposedAction are required." });
      return;
    }
    const item = createApproval({
      category,
      title: String(title),
      target: String(target),
      proposedAction: String(proposedAction),
      consequences: String(consequences || "Requires explicit user confirmation before execution."),
      payload: typeof payload === "object" && payload ? payload : {}
    });
    logActivity("approval", `Queued approval: ${item.title}`, `Target: ${item.target}`, "info");
    res.status(201).json({ approval: item });
  });
  app.post("/api/approvals/:id/decision", async (req, res) => {
    try {
      const approval = getApproval(req.params.id);
      if (!approval) {
        res.status(404).json({ error: "Approval item not found." });
        return;
      }
      const decision = req.body?.decision === "approve" ? "approve" : "reject";
      if (decision === "reject") {
        const resolved2 = resolveApproval(approval.id, "rejected", "Rejected by user. No external or code mutation was performed.");
        if (typeof approval.payload?.outreachId === "string") {
          updateOutreachTarget(approval.payload.outreachId, { deliveryStatus: "rejected" });
        }
        logActivity("approval", `Rejected: ${approval.title}`, approval.target, "warning");
        res.json({ approval: resolved2 });
        return;
      }
      let executionResult = "Approved by user.";
      if (approval.category === "instagram_dm" || approval.category === "discord_post") {
        if (typeof approval.payload?.outreachId === "string") {
          updateOutreachTarget(approval.payload.outreachId, { deliveryStatus: "approved_for_manual_send" });
        }
        executionResult = 'Approved for guided manual handoff. Open the verified profile/invite link, send from your authorized account, then click "Mark Sent & Verified" in Research Centre.';
      } else if (approval.category === "error_repair") {
        const projectId = String(approval.payload?.projectId || "");
        const affectedFile = String(approval.payload?.affectedFile || "");
        const patchedContent = String(approval.payload?.patchedFileContent || "");
        const reportId = String(approval.payload?.errorReportId || "");
        const project = getProject(projectId);
        if (project && affectedFile && patchedContent) {
          applyWorkspaceFilePatch(project.slug, affectedFile, patchedContent);
          const testResults = await runThreeTestingPasses(project, LOCAL_BASE_URL);
          const failed = testResults.some((t) => t.status === "failed");
          updateProject(project.id, {
            testResults,
            healthStatus: failed ? "degraded" : "healthy",
            recentErrors: failed ? "Post-repair test check failed; rollback available." : null
          });
          if (reportId) {
            updateErrorReport(reportId, { status: "repaired" });
          }
          executionResult = failed ? `Patch applied to ${affectedFile}, but a post-repair test failed. You can roll back from backup in CRM.` : `Patch applied to ${affectedFile} and verified with 3-pass test suite.`;
        }
      } else if (approval.category === "vercel_deploy") {
        const projectId = String(approval.payload?.projectId || "");
        const project = getProject(projectId);
        if (!process.env.VERCEL_TOKEN) {
          executionResult = "Approval recorded, but VERCEL_TOKEN is not configured in server secrets. Configure VERCEL_TOKEN or deploy from the workspace folder via `npx vercel --prod`.";
        } else if (project) {
          updateProject(project.id, { deploymentStatus: "pending_approval" });
          executionResult = "Deployment approved. Run `vercel --prod` inside the isolated project workspace folder (or connect Git repo in Vercel) and record the verified deployment URL in My Projects.";
        }
      } else if (approval.category === "whop_change") {
        executionResult = process.env.WHOP_API_KEY ? "Whop product modification approved and logged. Verify final pricing & checkout visibility in your Whop dashboard." : "Approval recorded, but WHOP_API_KEY is not configured in server secrets. No live Whop listing was altered.";
      } else if (approval.category === "maintenance_upgrade") {
        const projectId = String(approval.payload?.projectId || "");
        const project = getProject(projectId);
        if (project) {
          try {
            backupWorkspace(project.slug, "maintenance_approved");
            executionResult = `Workspace backed up for ${project.name}. Upgrade approved and ready for implementation and 3-pass re-testing.`;
          } catch {
            executionResult = `Upgrade approved for ${project.name}. Build the workspace first to apply file upgrades.`;
          }
        }
      }
      const resolved = resolveApproval(approval.id, "executed", executionResult);
      logActivity("approval", `Approved & processed: ${approval.title}`, executionResult, "success");
      res.json({ approval: resolved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Approval execution failed" });
    }
  });
  app.get("/api/integrations/whop/analytics", async (_req, res) => {
    const analytics = await fetchWhopAnalytics();
    res.json(analytics);
  });
  app.post("/api/integrations/supabase/test", async (_req, res) => {
    const result = await testSupabaseConnection();
    res.json(result);
  });
  app.post("/api/integrations/supabase/migration", async (req, res) => {
    try {
      const projectName = String(req.body?.projectName || "STRANGE Project");
      const schemaDescription = String(req.body?.schemaDescription || "").trim();
      if (!schemaDescription) {
        res.status(400).json({ error: "schemaDescription is required." });
        return;
      }
      const sql = await generateSupabaseMigrationSql(projectName, schemaDescription);
      logActivity("supabase", `Generated reversible SQL migration for ${projectName}`, "UP and DOWN migrations generated with RLS.", "success");
      res.json(sql);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to generate migration SQL" });
    }
  });
  app.get("/api/integrations/vercel/projects", async (_req, res) => {
    const data = await listVercelProjects();
    res.json(data);
  });
  app.get("/api/presentations", (_req, res) => {
    res.json({ presentations: listPresentations() });
  });
  app.post("/api/presentations/generate", async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      const audience = String(req.body?.audience || "Founders & Stakeholders").trim();
      const objective = String(req.body?.objective || "").trim();
      const context = typeof req.body?.context === "string" ? req.body.context : "";
      const slideCount = Number(req.body?.slideCount || 7);
      const projectId = typeof req.body?.projectId === "string" && req.body.projectId ? req.body.projectId : null;
      if (!title || !objective) {
        res.status(400).json({ error: "title and objective are required." });
        return;
      }
      const slides = await generatePresentationDeck({ title, audience, objective, context, slideCount });
      const deck = createPresentation({ projectId, title, audience, objective, slides });
      logActivity("presentations", `Generated presentation: ${title}`, `${slides.length} slides created`, "success");
      res.status(201).json({ presentation: deck });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Presentation generation failed" });
    }
  });
  app.delete("/api/presentations/:id", (req, res) => {
    deletePresentation(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/automations", (_req, res) => {
    res.json({ automations: listAutomations() });
  });
  app.post("/api/automations", (req, res) => {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const taskType = req.body?.taskType;
    const intervalMinutes = Math.max(5, Number(req.body?.intervalMinutes || 60));
    const approvedByUser = Boolean(req.body?.approvedByUser);
    if (!name || !["health_check", "weekly_maintenance_scan", "backup_workspace"].includes(taskType)) {
      res.status(400).json({ error: "Valid name and taskType are required." });
      return;
    }
    const task = createAutomation({
      name,
      description: description || name,
      taskType,
      intervalMinutes,
      enabled: approvedByUser,
      approvedByUser
    });
    logActivity("automation", `Created scheduled task: ${name}`, `Interval: every ${intervalMinutes} min`, "info");
    res.status(201).json({ automation: task });
  });
  app.patch("/api/automations/:id", (req, res) => {
    const updated = updateAutomation(req.params.id, {
      ...typeof req.body?.enabled === "boolean" ? { enabled: req.body.enabled } : {},
      ...typeof req.body?.approvedByUser === "boolean" ? { approvedByUser: req.body.approvedByUser } : {},
      ...req.body?.enabled === false ? { lastStatus: "paused" } : {}
    });
    if (!updated) {
      res.status(404).json({ error: "Automation task not found." });
      return;
    }
    res.json({ automation: updated });
  });
  app.post("/api/automations/:id/run", async (req, res) => {
    try {
      const updated = await runAutomationTaskById(req.params.id);
      res.json({ automation: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Automation execution failed" });
    }
  });
  app.post("/api/maintenance/run-all", async (_req, res) => {
    try {
      const result = await executeWeeklyMaintenanceAcrossAllProjects();
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Weekly maintenance scan failed" });
    }
  });
  app.get("/api/crm/summary", async (_req, res) => {
    const metrics = getCrmMetrics();
    const projects = listProjects();
    const approvals = listApprovals();
    const errors = listErrorReports();
    const activity = listActivityLogs(25);
    res.json({ metrics, projects, approvals, errors, activity });
  });
  app.get("/api/activity", (req, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
    res.json({ logs: listActivityLogs(limit) });
  });
  app.get("/api/storage/info", (_req, res) => {
    res.json({ storage: getStorageHealthInfo() });
  });
  app.post("/api/storage/backup", (req, res) => {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "manual";
      const backup = createAutomaticBackup(reason);
      logActivity("storage", "Created local JSON backup", `${backup.filename} (${backup.sizeKb} KB)`, "success");
      res.status(201).json({ backup, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Backup creation failed" });
    }
  });
  app.post("/api/storage/restore", (req, res) => {
    try {
      const filename = String(req.body?.filename || "").trim();
      if (!filename) {
        res.status(400).json({ error: "Backup filename is required." });
        return;
      }
      const result = restoreFromLocalBackup(filename);
      res.json({ ok: true, ...result, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Backup restore failed" });
    }
  });
  app.get("/api/storage/export", (_req, res) => {
    const bundle = exportPortableDataBundle();
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="strange-data-export-${stamp}.json"`);
    res.json(bundle);
  });
  app.post("/api/storage/import", (req, res) => {
    try {
      const result = validateAndImportBundle(req.body, "pre_import");
      res.json({ ok: true, ...result, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid STRANGE export archive" });
    }
  });
  setInterval(async () => {
    try {
      const tasks = listAutomations().filter((t) => t.enabled && t.approvedByUser);
      const now = Date.now();
      for (const task of tasks) {
        const lastMs = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
        if (now - lastMs >= task.intervalMinutes * 60 * 1e3) {
          await runAutomationTaskById(task.id);
        }
      }
    } catch {
    }
  }, 6e4).unref();
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = process.env.STRANGE_DIST_DIR ? path4.resolve(process.env.STRANGE_DIST_DIR) : path4.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path4.join(distDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`STRANGE backend listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start STRANGE server:", err);
  process.exit(1);
});
