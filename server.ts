import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  applyWorkspaceFilePatch,
  backupWorkspace,
  readProjectFiles,
  resolveSafeWorkspaceDir,
  resolveSafeWorkspaceFile,
  restoreWorkspaceFromBackup,
  runThreeTestingPasses,
  slugifyProjectName,
  writeProjectFiles,
} from './src/server/builder.ts';
import {
  addMessage,
  createApproval,
  createAutomaticBackup,
  createAutomation,
  createConversation,
  createErrorReport,
  createPresentation,
  createProject,
  deleteConversation,
  deletePresentation,
  exportPortableDataBundle,
  getAllSettings,
  getApproval,
  getCrmMetrics,
  getOpportunity,
  getProject,
  getStorageHealthInfo,
  isValidGeminiModelId,
  listActivityLogs,
  listApprovals,
  listAutomations,
  listConversations,
  listErrorReports,
  listMessages,
  listOpportunities,
  listOutreachTargets,
  listPresentations,
  listProjects,
  logActivity,
  newId,
  nowIso,
  resolveApproval,
  restoreFromLocalBackup,
  saveOpportunities,
  saveOutreachTargets,
  setSetting,
  updateAutomation,
  updateConversationTitle,
  updateErrorReport,
  updateOpportunitySelection,
  updateOutreachTarget,
  updateProject,
  validateAndImportBundle,
} from './src/server/db.ts';
import {
  diagnoseProjectError,
  discoverBusinessOpportunities,
  generateMaintenancePlan,
  generateOperatorReply,
  generatePresentationDeck,
  generateProductPRD,
  generateProductSourceBundle,
  generateSupabaseMigrationSql,
  researchOutreachTargets,
  runFullAiDiagnostics,
  testGeminiConnection,
} from './src/server/gemini.ts';
import {
  fetchWhopAnalytics,
  getIntegrationStatusSnapshot,
  listVercelProjects,
  runSafeProjectHealthCheck,
  testSupabaseConnection,
} from './src/server/integrations.ts';
import type { GeminiModelId } from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const LOCAL_BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_PROD = process.env.NODE_ENV === 'production';

async function executeWeeklyMaintenanceAcrossAllProjects(): Promise<{
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
}> {
  const projects = listProjects();
  const plans = [];

  for (const project of projects) {
    const health = await runSafeProjectHealthCheck(project.liveUrl, project.slug, LOCAL_BASE_URL);
    const nextHealth = health.ok ? 'healthy' : 'error';
    const updated = updateProject(project.id, {
      healthStatus: nextHealth,
      lastHealthCheck: nowIso(),
      recentErrors: health.ok ? null : health.error || `HTTP ${health.statusCode}`,
    });

    const plan = await generateMaintenancePlan(updated || project);
    let approvalsCreated = 0;
    for (const imp of plan.proposedImprovements) {
      createApproval({
        category: 'maintenance_upgrade',
        title: `Maintenance Upgrade: ${imp.title}`,
        target: `${project.name} (${project.slug})`,
        proposedAction: `Back up workspace, implement "${imp.title}", and execute all 3 testing passes.`,
        consequences: `Reason: ${imp.reason}. Risk level: ${imp.riskLevel}. Production deployment remains gated behind a separate deployment approval.`,
        payload: {
          projectId: project.id,
          improvementTitle: imp.title,
          reason: imp.reason,
          riskLevel: imp.riskLevel,
        },
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
      approvalsCreated,
    });
  }

  logActivity(
    'maintenance',
    'Executed weekly application maintenance scan',
    `Inspected ${projects.length} registered project(s) and queued approval plans for proposed improvements.`,
    'success'
  );

  return { inspectedCount: projects.length, plans };
}

async function runAutomationTaskById(taskId: string) {
  const tasks = listAutomations();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error('Automation task not found.');
  if (!task.approvedByUser) {
    throw new Error('Automation must be explicitly approved by the user before running.');
  }

  const projects = listProjects();
  let summary = '';

  if (task.taskType === 'health_check') {
    let okCount = 0;
    let errCount = 0;
    for (const p of projects) {
      const check = await runSafeProjectHealthCheck(p.liveUrl, p.slug, LOCAL_BASE_URL);
      updateProject(p.id, {
        healthStatus: check.ok ? 'healthy' : 'error',
        lastHealthCheck: nowIso(),
        recentErrors: check.ok ? null : check.error || `HTTP ${check.statusCode}`,
      });
      if (check.ok) okCount++;
      else errCount++;
    }
    summary =
      projects.length === 0
        ? 'No registered projects to check.'
        : `Checked ${projects.length} app(s): ${okCount} healthy, ${errCount} reporting errors.`;
  } else if (task.taskType === 'backup_workspace') {
    let backedUp = 0;
    for (const p of projects) {
      try {
        const dir = resolveSafeWorkspaceDir(p.slug);
        if (fs.existsSync(dir)) {
          backupWorkspace(p.slug, 'scheduled');
          backedUp++;
        }
      } catch {
        // skip unbuilt project
      }
    }
    summary = `Created local workspace backups for ${backedUp} built project(s).`;
  } else if (task.taskType === 'weekly_maintenance_scan') {
    const res = await executeWeeklyMaintenanceAcrossAllProjects();
    summary = `Inspected ${res.inspectedCount} project(s) and queued improvement approvals.`;
  }

  const updated = updateAutomation(task.id, {
    lastRunAt: nowIso(),
    lastResult: summary,
    lastStatus: 'success',
  });
  logActivity('automation', `Ran scheduled task: ${task.name}`, summary, 'success');
  return updated;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // --- Safe isolated workspace preview server ---
  app.get('/preview/:slug/*', (req, res) => {
    try {
      const slug = String(req.params.slug || '');
      const rel = String((req.params as Record<string, string>)[0] || 'index.html');
      const targetRel = rel === '' ? 'index.html' : rel;
      const fullPath = resolveSafeWorkspaceFile(slug, targetRel);
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        res.status(404).type('text/plain').send('Workspace preview file not found.');
        return;
      }
      res.sendFile(fullPath);
    } catch {
      res.status(400).type('text/plain').send('Invalid workspace preview request.');
    }
  });

  app.get('/preview/:slug', (req, res) => {
    try {
      const slug = String(req.params.slug || '');
      const fullPath = resolveSafeWorkspaceFile(slug, 'index.html');
      if (!fs.existsSync(fullPath)) {
        res.status(404).type('text/plain').send('Workspace has not been built yet.');
        return;
      }
      res.sendFile(fullPath);
    } catch {
      res.status(400).type('text/plain').send('Invalid workspace preview request.');
    }
  });

  // --- System, Settings & Onboarding ---
  app.get('/api/status', (_req, res) => {
    res.json({
      integrations: getIntegrationStatusSnapshot(),
      settings: getAllSettings(),
      metrics: getCrmMetrics(),
    });
  });

  app.post('/api/settings', (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body && typeof body.gemini_model === 'string' && !isValidGeminiModelId(body.gemini_model)) {
      res.status(400).json({
        error: `Model "${body.gemini_model}" is deprecated or invalid. Use an active Gemini model such as gemini-3.1-flash-lite or gemini-4-hydrogen.`,
      });
      return;
    }
    const allowedKeys = new Set([
      'gemini_model',
      'onboarding_completed',
      'voice_enabled',
      'voice_rate',
      'voice_volume',
      'voice_lang',
      'voice_name',
      'instagram_authorized_account',
      'operator_name',
    ]);
    for (const [k, v] of Object.entries(body || {})) {
      if (allowedKeys.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        setSetting(k, String(v).trim());
      }
    }
    logActivity('settings', 'Updated STRANGE preferences', Object.keys(body || {}).join(', '), 'info');
    res.json({ ok: true, settings: getAllSettings(), integrations: getIntegrationStatusSnapshot() });
  });

  app.post('/api/ai/test', async (req, res) => {
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
    const model = rawModel ? (rawModel as GeminiModelId) : undefined;
    if (model && !isValidGeminiModelId(model)) {
      res.status(400).json({
        ok: false,
        error: `Model "${model}" is deprecated or invalid. Use an active Gemini model such as gemini-3.1-flash-lite or gemini-4-hydrogen.`,
      });
      return;
    }
    const result = await testGeminiConnection(model);
    logActivity(
      'ai',
      'Tested Gemini API connection',
      result.ok
        ? `Connected (${result.modelUsed || result.model}, ${result.latencyMs}ms)`
        : result.error || 'Connection failed',
      result.ok ? 'success' : 'error'
    );
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post('/api/ai/diagnostics', async (req, res) => {
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
    const report = await runFullAiDiagnostics(rawModel || undefined);
    logActivity(
      'ai',
      'Ran 6-point AI connection diagnostic',
      report.overallOk
        ? `All 6 checks passed (${report.activeModelUsed || report.configuredModel}, ${report.latencyMs}ms)`
        : `Diagnostic completed with failures (${report.checks.filter((c) => c.status === 'fail').length} failed)`,
      report.overallOk ? 'success' : 'warning'
    );
    res.status(200).json(report);
  });

  // --- Conversations & Main AI Operator Workspace ---
  app.get('/api/conversations', (_req, res) => {
    let list = listConversations();
    if (list.length === 0) {
      const initial = createConversation('Primary Command Session');
      list = [initial];
    }
    res.json({ conversations: list });
  });

  app.post('/api/conversations', (req, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'New Operator Session';
    const conv = createConversation(title);
    res.status(201).json({ conversation: conv });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    deleteConversation(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/conversations/:id/messages', (req, res) => {
    res.json({ messages: listMessages(req.params.id) });
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const conversationId = String(req.body?.conversationId || '');
      const content = String(req.body?.content || '').trim();
      const attachmentName = typeof req.body?.attachmentName === 'string' ? req.body.attachmentName.slice(0, 120) : undefined;
      const attachmentText = typeof req.body?.attachmentText === 'string' ? req.body.attachmentText : undefined;
      const useWebSearch = Boolean(req.body?.useWebSearch);

      if (!conversationId || !content) {
        res.status(400).json({ error: 'conversationId and content are required.' });
        return;
      }

      const historyBefore = listMessages(conversationId);
      const userMsg = addMessage({
        conversationId,
        role: 'user',
        content,
        attachmentName,
      });

      if (historyBefore.length === 0) {
        updateConversationTitle(conversationId, content.slice(0, 56));
      }

      // Built-in Operator Command: Weekly Application Maintenance ("STRANGE, update all my applications.")
      if (/strange[\s,:-]*update all my applications/i.test(content)) {
        const result = await executeWeeklyMaintenanceAcrossAllProjects();
        const replyBody =
          result.inspectedCount === 0
            ? 'Weekly maintenance check completed: no registered projects exist in local storage yet. Discover a business opportunity in the Research Centre and create a project first.'
            : [
                `Weekly maintenance scan completed across ${result.inspectedCount} registered project(s):`,
                '',
                ...result.plans.map(
                  (p, i) =>
                    `${i + 1}. ${p.projectName} — Health: ${p.healthStatus}\n   Summary: ${p.healthSummary}\n   Dependencies: ${p.dependencyNotes}\n   Queued ${p.approvalsCreated} feature/maintenance approval item(s) for your review before any code changes are applied.`
                ),
                '',
                'Review and approve individual upgrades in the Automation Centre / Approval Queue.',
              ].join('\n');

        const assistantMsg = addMessage({
          conversationId,
          role: 'assistant',
          content: replyBody,
          taskState: result.inspectedCount > 0 ? 'waiting_for_approval' : 'completed',
        });
        res.json({ userMessage: userMsg, assistantMessage: assistantMsg, maintenance: result });
        return;
      }

      const metrics = getCrmMetrics();
      const projects = listProjects();
      const pendingApprovals = listApprovals().filter((a) => a.status === 'pending');
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
            recentErrors: p.recentErrors,
          })),
          automations: automations.map((a) => ({
            id: a.id,
            name: a.name,
            taskType: a.taskType,
            intervalMinutes: a.intervalMinutes,
            enabled: a.enabled,
            lastStatus: a.lastStatus,
          })),
          pendingApprovals: pendingApprovals.map((a) => ({
            id: a.id,
            category: a.category,
            title: a.title,
            target: a.target,
          })),
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
              approvedByUser: true,
            });
            logActivity(
              'automation',
              `Created scheduled task via chat: ${automation.name}`,
              `Type: ${automation.taskType}, every ${automation.intervalMinutes} min`,
              'success'
            );
            return { automation };
          },
          listAutomations: async () => ({ automations: listAutomations() }),
          runAutomation: async (taskId: string) => {
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
              payload: { source: 'chat_operator' },
            });
            logActivity('approval', `Queued approval via chat: ${approval.title}`, `Target: ${approval.target}`, 'info');
            return { approval };
          },
          createBackup: async (reason: string) => {
            const backup = createAutomaticBackup(reason || 'chat_operator');
            logActivity(
              'storage',
              'Created local JSON backup via chat',
              `${backup.filename} (${backup.sizeKb} KB)`,
              'success'
            );
            return { filename: backup.filename, sizeKb: backup.sizeKb };
          },
          runWeeklyMaintenance: async () => {
            const res = await executeWeeklyMaintenanceAcrossAllProjects();
            return { inspectedCount: res.inspectedCount };
          },
        },
      });

      const waitingForApproval = aiResult.executedTools.some(
        (t) => t.name === 'queue_approval' && t.status === 'success'
      );

      const assistantMsg = addMessage({
        conversationId,
        role: 'assistant',
        content: aiResult.text,
        sources: aiResult.sources,
        executedTools: aiResult.executedTools.length > 0 ? aiResult.executedTools : undefined,
        modelUsed: aiResult.modelUsed,
        taskState: waitingForApproval ? 'waiting_for_approval' : 'completed',
      });

      res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process message';
      logActivity('ai', 'Assistant request failed', message, 'error');
      res.status(502).json({ error: message });
    }
  });

  // --- Business Problem Discovery Engine (Section 7) ---
  app.get('/api/research/opportunities', (_req, res) => {
    res.json({ opportunities: listOpportunities() });
  });

  app.post('/api/research/discover', async (req, res) => {
    try {
      const query = String(req.body?.query || '').trim();
      if (!query) {
        res.status(400).json({ error: 'Research topic or niche query is required.' });
        return;
      }
      const batchId = newId('batch');
      const { opportunities, sources } = await discoverBusinessOpportunities(query);
      const saved = saveOpportunities(
        opportunities.map((o) => ({
          ...o,
          batchId,
          query,
          priorityOrder: null,
          status: 'discovered',
        }))
      );
      logActivity(
        'research',
        `Discovered 3 business opportunities for "${query}"`,
        `Verified ${sources.length} public web source(s) via Google Search grounding.`,
        'success'
      );
      res.status(201).json({ batchId, opportunities: saved, sources });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Discovery failed';
      logActivity('research', 'Business discovery failed', msg, 'error');
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/research/opportunities/:id/select', async (req, res) => {
    try {
      const opp = getOpportunity(req.params.id);
      if (!opp) {
        res.status(404).json({ error: 'Opportunity not found.' });
        return;
      }
      const priorityOrder = typeof req.body?.priorityOrder === 'number' ? req.body.priorityOrder : 1;
      updateOpportunitySelection(opp.id, 'selected', priorityOrder);

      // Stage A: Conduct deeper product research & generate PRD before implementation
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
        techStack: 'HTML5, CSS3, ES Modules, Node.js Test Runner, Local Persistence',
        status: 'prd_review',
        prd,
        liveUrl: null,
        previewUrl: null,
        deploymentStatus: 'not_deployed',
        healthStatus: 'unknown',
        lastHealthCheck: null,
        dbStatus: 'local_json',
        recentErrors: null,
        testResults: [],
        userApprovedForMarketing: false,
        lastDeployedAt: null,
      });

      logActivity(
        'project',
        `Stage A PRD generated for ${project.name}`,
        `User selected opportunity #${opp.rankIndex} (priority ${priorityOrder}). Awaiting PRD review before building.`,
        'success'
      );
      res.status(201).json({ project });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate PRD';
      res.status(502).json({ error: msg });
    }
  });

  // --- Product Engineering, 3-Pass Testing & Error Repair (Sections 8 & 14) ---
  app.get('/api/projects', (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.post('/api/projects/:id/build', async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      updateProject(project.id, { status: 'building' });
      const bundle = await generateProductSourceBundle(project);
      writeProjectFiles(project.slug, bundle, project.name);

      if (project.opportunityId) {
        updateOpportunitySelection(project.opportunityId, 'in_development', 1);
      }

      const previewUrl = `/preview/${project.slug}/`;
      const updated = updateProject(project.id, {
        status: 'testing',
        previewUrl,
        healthStatus: 'healthy',
        lastHealthCheck: nowIso(),
        recentErrors: null,
      });

      logActivity(
        'project',
        `Stage B built isolated workspace for ${project.name}`,
        `Generated runnable files in ${project.folderPath} and live preview at ${previewUrl}`,
        'success'
      );

      res.json({ project: updated, files: readProjectFiles(project.slug) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Build failed';
      updateProject(req.params.id, { status: 'error', recentErrors: msg });
      logActivity('project', 'Product build failed', msg, 'error');
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/projects/:id/test', async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const results = await runThreeTestingPasses(project, LOCAL_BASE_URL);
      const anyFailed = results.some((r) => r.status === 'failed');
      const updated = updateProject(project.id, {
        testResults: results,
        status: anyFailed ? 'error' : 'handover_ready',
        healthStatus: anyFailed ? 'degraded' : 'healthy',
        lastHealthCheck: nowIso(),
        recentErrors: anyFailed ? results.find((r) => r.status === 'failed')?.summary || 'Test failure' : null,
      });
      res.json({ project: updated, testResults: results });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Testing pass execution failed' });
    }
  });

  app.get('/api/projects/:id/files', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ files: readProjectFiles(project.slug) });
  });

  app.put('/api/projects/:id/files', (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const file = String(req.body?.file || '');
      const content = String(req.body?.content ?? '');
      backupWorkspace(project.slug, 'manual_edit');
      applyWorkspaceFilePatch(project.slug, file, content);
      logActivity('project', `Updated ${file} in ${project.name}`, 'Backup created automatically before saving.', 'info');
      res.json({ ok: true, files: readProjectFiles(project.slug) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update file' });
    }
  });

  app.post('/api/projects/:id/approve-marketing', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const updated = updateProject(project.id, {
      userApprovedForMarketing: true,
      status: project.deploymentStatus === 'deployed' ? 'deployed' : 'approved',
    });
    if (project.opportunityId) {
      updateOpportunitySelection(project.opportunityId, 'completed', 1);
    }
    logActivity(
      'project',
      `Product approved by user: ${project.name}`,
      'Handover accepted. Influencer & Discord outreach unlocked for this product.',
      'success'
    );
    res.json({ project: updated });
  });

  app.post('/api/projects/:id/health-check', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const result = await runSafeProjectHealthCheck(project.liveUrl, project.slug, LOCAL_BASE_URL);
    const updated = updateProject(project.id, {
      healthStatus: result.ok ? 'healthy' : 'error',
      lastHealthCheck: nowIso(),
      recentErrors: result.ok ? null : result.error || `HTTP ${result.statusCode}`,
    });
    logActivity(
      'monitoring',
      `Health check: ${project.name}`,
      result.ok ? `Healthy (HTTP ${result.statusCode}) at ${result.target}` : result.error || `HTTP ${result.statusCode}`,
      result.ok ? 'success' : 'error'
    );
    res.json({ project: updated, check: result });
  });

  // --- Error Reporting, Diagnosis, Backup, Repair & Rollback (Section 14) ---
  app.get('/api/errors', (_req, res) => {
    res.json({ errors: listErrorReports() });
  });

  app.post('/api/projects/:id/errors', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const component = String(req.body?.component || 'runtime').slice(0, 80);
    const errorMessage = String(req.body?.errorMessage || '').trim();
    if (!errorMessage) {
      res.status(400).json({ error: 'errorMessage is required.' });
      return;
    }
    const report = createErrorReport({
      projectId: project.id,
      projectName: project.name,
      component,
      errorMessage,
    });
    updateProject(project.id, { healthStatus: 'error', recentErrors: errorMessage });
    logActivity('monitoring', `Logged error for ${project.name}`, `${component}: ${errorMessage}`, 'error');
    res.status(201).json({ report });
  });

  app.post('/api/errors/:id/diagnose', async (req, res) => {
    try {
      const report = listErrorReports().find((e) => e.id === req.params.id);
      if (!report) {
        res.status(404).json({ error: 'Error report not found.' });
        return;
      }
      const project = getProject(report.projectId);
      if (!project) {
        res.status(404).json({ error: 'Associated project not found.' });
        return;
      }
      const files = readProjectFiles(project.slug);
      const backupPath = backupWorkspace(project.slug, 'pre_repair');
      const diag = await diagnoseProjectError({
        project,
        component: report.component,
        errorMessage: report.errorMessage,
        fileSnapshot: files,
      });

      const updatedReport = updateErrorReport(report.id, {
        diagnosis: diag.diagnosis,
        backupPath,
        proposedFixFile: diag.affectedFile,
        proposedFixSummary: diag.proposedFixSummary,
        status: 'diagnosed',
      });

      const approval = createApproval({
        category: 'error_repair',
        title: `Apply Reversible Repair: ${project.name}`,
        target: `${project.name} / ${diag.affectedFile}`,
        proposedAction: diag.proposedFixSummary,
        consequences: `Backup saved to ${backupPath}. Approving will patch ${diag.affectedFile} and automatically rerun the 3-pass test suite.`,
        payload: {
          errorReportId: report.id,
          projectId: project.id,
          affectedFile: diag.affectedFile,
          patchedFileContent: diag.patchedFileContent,
          backupPath,
        },
      });

      logActivity('repair', `Diagnosed error in ${project.name}`, diag.diagnosis.slice(0, 200), 'info');
      res.json({ report: updatedReport, approval });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Diagnosis failed' });
    }
  });

  app.post('/api/errors/:id/rollback', (req, res) => {
    try {
      const report = listErrorReports().find((e) => e.id === req.params.id);
      if (!report || !report.backupPath) {
        res.status(404).json({ error: 'Error report or backup path not found.' });
        return;
      }
      const project = getProject(report.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      restoreWorkspaceFromBackup(project.slug, report.backupPath);
      const updated = updateErrorReport(report.id, { status: 'rolled_back' });
      logActivity('repair', `Rolled back repair for ${project.name}`, `Restored workspace from ${report.backupPath}`, 'warning');
      res.json({ report: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rollback failed' });
    }
  });

  // --- Influencer & Discord Outreach (Sections 9 & 10) ---
  app.get('/api/outreach', (req, res) => {
    const platform = req.query.platform === 'instagram' || req.query.platform === 'discord' ? req.query.platform : undefined;
    res.json({ targets: listOutreachTargets(platform) });
  });

  app.post('/api/outreach/research', async (req, res) => {
    try {
      const platform = req.body?.platform === 'discord' ? 'discord' : 'instagram';
      const niche = String(req.body?.niche || '').trim();
      const projectId = typeof req.body?.projectId === 'string' && req.body.projectId ? req.body.projectId : null;

      if (!niche) {
        res.status(400).json({ error: 'Niche or topic is required.' });
        return;
      }

      let productName = String(req.body?.productName || 'Selected Product');
      let productDescription = String(req.body?.productDescription || niche);
      if (projectId) {
        const project = getProject(projectId);
        if (project) {
          if (!project.userApprovedForMarketing) {
            res.status(403).json({
              error: `Product "${project.name}" has not been approved for marketing yet. Approve it in My Projects (Stage D) before starting outreach.`,
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
        productDescription,
      });

      const saved = saveOutreachTargets(
        targets.map((t) => ({
          ...t,
          projectId,
          platform,
          followStatus: platform === 'instagram' ? 'manual_required' : 'not_started',
          deliveryStatus: 'draft_ready',
          sources,
        }))
      );

      logActivity(
        'outreach',
        `Researched ${saved.length} ${platform} targets`,
        `Niche: ${niche}. Grounded with ${sources.length} public web source(s).`,
        'success'
      );

      res.status(201).json({ targets: saved, sources });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Outreach research failed' });
    }
  });

  app.patch('/api/outreach/:id', (req, res) => {
    const updated = updateOutreachTarget(req.params.id, {
      ...(typeof req.body?.draftMessage === 'string' ? { draftMessage: req.body.draftMessage } : {}),
      ...(req.body?.followStatus ? { followStatus: req.body.followStatus } : {}),
      ...(req.body?.deliveryStatus ? { deliveryStatus: req.body.deliveryStatus } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'Outreach target not found.' });
      return;
    }
    if (req.body?.deliveryStatus === 'sent_verified') {
      logActivity('outreach', `Verified manual delivery to ${updated.name}`, `Platform: ${updated.platform}`, 'success');
    }
    res.json({ target: updated });
  });

  app.post('/api/outreach/:id/request-approval', (req, res) => {
    const target = listOutreachTargets().find((t) => t.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Outreach target not found.' });
      return;
    }
    updateOutreachTarget(target.id, { deliveryStatus: 'pending_approval' });
    const approval = createApproval({
      category: target.platform === 'instagram' ? 'instagram_dm' : 'discord_post',
      title: `${target.platform === 'instagram' ? 'Instagram DM' : 'Discord Post'} Approval: ${target.name}`,
      target: `${target.name} (${target.profileOrInviteUrl})`,
      proposedAction: target.draftMessage,
      consequences:
        target.platform === 'instagram'
          ? 'Guided manual workflow: automated Instagram following/DMing is restricted by platform anti-bot policy. Approving unlocks copy-and-open handoff for your authorized Instagram account and records delivery in CRM.'
          : 'Respects Discord server rules and rate limits. Approving prepares the verified post for manual or authorized webhook delivery and logs it in CRM.',
      payload: { outreachId: target.id, platform: target.platform },
    });
    logActivity('outreach', `Queued approval for ${target.name}`, `Platform: ${target.platform}`, 'info');
    res.status(201).json({ approval });
  });

  // --- Mandatory Approval Queue (Sections 9, 10, 11, 12, 13, 14, 15) ---
  app.get('/api/approvals', (_req, res) => {
    res.json({ approvals: listApprovals() });
  });

  app.post('/api/approvals', (req, res) => {
    const { category, title, target, proposedAction, consequences, payload } = req.body || {};
    if (!category || !title || !target || !proposedAction) {
      res.status(400).json({ error: 'category, title, target, and proposedAction are required.' });
      return;
    }
    const item = createApproval({
      category,
      title: String(title),
      target: String(target),
      proposedAction: String(proposedAction),
      consequences: String(consequences || 'Requires explicit user confirmation before execution.'),
      payload: typeof payload === 'object' && payload ? payload : {},
    });
    logActivity('approval', `Queued approval: ${item.title}`, `Target: ${item.target}`, 'info');
    res.status(201).json({ approval: item });
  });

  app.post('/api/approvals/:id/decision', async (req, res) => {
    try {
      const approval = getApproval(req.params.id);
      if (!approval) {
        res.status(404).json({ error: 'Approval item not found.' });
        return;
      }
      const decision = req.body?.decision === 'approve' ? 'approve' : 'reject';

      if (decision === 'reject') {
        const resolved = resolveApproval(approval.id, 'rejected', 'Rejected by user. No external or code mutation was performed.');
        if (typeof approval.payload?.outreachId === 'string') {
          updateOutreachTarget(approval.payload.outreachId, { deliveryStatus: 'rejected' });
        }
        logActivity('approval', `Rejected: ${approval.title}`, approval.target, 'warning');
        res.json({ approval: resolved });
        return;
      }

      // Execute approved action truthfully based on category
      let executionResult = 'Approved by user.';
      if (approval.category === 'instagram_dm' || approval.category === 'discord_post') {
        if (typeof approval.payload?.outreachId === 'string') {
          updateOutreachTarget(approval.payload.outreachId, { deliveryStatus: 'approved_for_manual_send' });
        }
        executionResult =
          'Approved for guided manual handoff. Open the verified profile/invite link, send from your authorized account, then click "Mark Sent & Verified" in Research Centre.';
      } else if (approval.category === 'error_repair') {
        const projectId = String(approval.payload?.projectId || '');
        const affectedFile = String(approval.payload?.affectedFile || '');
        const patchedContent = String(approval.payload?.patchedFileContent || '');
        const reportId = String(approval.payload?.errorReportId || '');
        const project = getProject(projectId);
        if (project && affectedFile && patchedContent) {
          applyWorkspaceFilePatch(project.slug, affectedFile, patchedContent);
          const testResults = await runThreeTestingPasses(project, LOCAL_BASE_URL);
          const failed = testResults.some((t) => t.status === 'failed');
          updateProject(project.id, {
            testResults,
            healthStatus: failed ? 'degraded' : 'healthy',
            recentErrors: failed ? 'Post-repair test check failed; rollback available.' : null,
          });
          if (reportId) {
            updateErrorReport(reportId, { status: 'repaired' });
          }
          executionResult = failed
            ? `Patch applied to ${affectedFile}, but a post-repair test failed. You can roll back from backup in CRM.`
            : `Patch applied to ${affectedFile} and verified with 3-pass test suite.`;
        }
      } else if (approval.category === 'vercel_deploy') {
        const projectId = String(approval.payload?.projectId || '');
        const project = getProject(projectId);
        if (!process.env.VERCEL_TOKEN) {
          executionResult =
            'Approval recorded, but VERCEL_TOKEN is not configured in server secrets. Configure VERCEL_TOKEN or deploy from the workspace folder via `npx vercel --prod`.';
        } else if (project) {
          updateProject(project.id, { deploymentStatus: 'pending_approval' });
          executionResult =
            'Deployment approved. Run `vercel --prod` inside the isolated project workspace folder (or connect Git repo in Vercel) and record the verified deployment URL in My Projects.';
        }
      } else if (approval.category === 'whop_change') {
        executionResult = process.env.WHOP_API_KEY
          ? 'Whop product modification approved and logged. Verify final pricing & checkout visibility in your Whop dashboard.'
          : 'Approval recorded, but WHOP_API_KEY is not configured in server secrets. No live Whop listing was altered.';
      } else if (approval.category === 'maintenance_upgrade') {
        const projectId = String(approval.payload?.projectId || '');
        const project = getProject(projectId);
        if (project) {
          try {
            backupWorkspace(project.slug, 'maintenance_approved');
            executionResult = `Workspace backed up for ${project.name}. Upgrade approved and ready for implementation and 3-pass re-testing.`;
          } catch {
            executionResult = `Upgrade approved for ${project.name}. Build the workspace first to apply file upgrades.`;
          }
        }
      }

      const resolved = resolveApproval(approval.id, 'executed', executionResult);
      logActivity('approval', `Approved & processed: ${approval.title}`, executionResult, 'success');
      res.json({ approval: resolved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Approval execution failed' });
    }
  });

  // --- Whop, Supabase & Vercel Integrations (Sections 11, 12, 13) ---
  app.get('/api/integrations/whop/analytics', async (_req, res) => {
    const analytics = await fetchWhopAnalytics();
    res.json(analytics);
  });

  app.post('/api/integrations/supabase/test', async (_req, res) => {
    const result = await testSupabaseConnection();
    res.json(result);
  });

  app.post('/api/integrations/supabase/migration', async (req, res) => {
    try {
      const projectName = String(req.body?.projectName || 'STRANGE Project');
      const schemaDescription = String(req.body?.schemaDescription || '').trim();
      if (!schemaDescription) {
        res.status(400).json({ error: 'schemaDescription is required.' });
        return;
      }
      const sql = await generateSupabaseMigrationSql(projectName, schemaDescription);
      logActivity('supabase', `Generated reversible SQL migration for ${projectName}`, 'UP and DOWN migrations generated with RLS.', 'success');
      res.json(sql);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to generate migration SQL' });
    }
  });

  app.get('/api/integrations/vercel/projects', async (_req, res) => {
    const data = await listVercelProjects();
    res.json(data);
  });

  // --- Presentations ---
  app.get('/api/presentations', (_req, res) => {
    res.json({ presentations: listPresentations() });
  });

  app.post('/api/presentations/generate', async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const audience = String(req.body?.audience || 'Founders & Stakeholders').trim();
      const objective = String(req.body?.objective || '').trim();
      const context = typeof req.body?.context === 'string' ? req.body.context : '';
      const slideCount = Number(req.body?.slideCount || 7);
      const projectId = typeof req.body?.projectId === 'string' && req.body.projectId ? req.body.projectId : null;

      if (!title || !objective) {
        res.status(400).json({ error: 'title and objective are required.' });
        return;
      }

      const slides = await generatePresentationDeck({ title, audience, objective, context, slideCount });
      const deck = createPresentation({ projectId, title, audience, objective, slides });
      logActivity('presentations', `Generated presentation: ${title}`, `${slides.length} slides created`, 'success');
      res.status(201).json({ presentation: deck });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Presentation generation failed' });
    }
  });

  app.delete('/api/presentations/:id', (req, res) => {
    deletePresentation(req.params.id);
    res.json({ ok: true });
  });

  // --- Automations & Weekly Maintenance ---
  app.get('/api/automations', (_req, res) => {
    res.json({ automations: listAutomations() });
  });

  app.post('/api/automations', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const taskType = req.body?.taskType;
    const intervalMinutes = Math.max(5, Number(req.body?.intervalMinutes || 60));
    const approvedByUser = Boolean(req.body?.approvedByUser);

    if (!name || !['health_check', 'weekly_maintenance_scan', 'backup_workspace'].includes(taskType)) {
      res.status(400).json({ error: 'Valid name and taskType are required.' });
      return;
    }

    const task = createAutomation({
      name,
      description: description || name,
      taskType,
      intervalMinutes,
      enabled: approvedByUser,
      approvedByUser,
    });
    logActivity('automation', `Created scheduled task: ${name}`, `Interval: every ${intervalMinutes} min`, 'info');
    res.status(201).json({ automation: task });
  });

  app.patch('/api/automations/:id', (req, res) => {
    const updated = updateAutomation(req.params.id, {
      ...(typeof req.body?.enabled === 'boolean' ? { enabled: req.body.enabled } : {}),
      ...(typeof req.body?.approvedByUser === 'boolean' ? { approvedByUser: req.body.approvedByUser } : {}),
      ...(req.body?.enabled === false ? { lastStatus: 'paused' } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'Automation task not found.' });
      return;
    }
    res.json({ automation: updated });
  });

  app.post('/api/automations/:id/run', async (req, res) => {
    try {
      const updated = await runAutomationTaskById(req.params.id);
      res.json({ automation: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Automation execution failed' });
    }
  });

  app.post('/api/maintenance/run-all', async (_req, res) => {
    try {
      const result = await executeWeeklyMaintenanceAcrossAllProjects();
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Weekly maintenance scan failed' });
    }
  });

  // --- CRM Summary & Activity History ---
  app.get('/api/crm/summary', async (_req, res) => {
    const metrics = getCrmMetrics();
    const projects = listProjects();
    const approvals = listApprovals();
    const errors = listErrorReports();
    const activity = listActivityLogs(25);
    res.json({ metrics, projects, approvals, errors, activity });
  });

  app.get('/api/activity', (req, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
    res.json({ logs: listActivityLogs(limit) });
  });

  // --- Local JSON Storage, Automatic Backups & Portable Export/Restore ---
  app.get('/api/storage/info', (_req, res) => {
    res.json({ storage: getStorageHealthInfo() });
  });

  app.post('/api/storage/backup', (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual';
      const backup = createAutomaticBackup(reason);
      logActivity('storage', 'Created local JSON backup', `${backup.filename} (${backup.sizeKb} KB)`, 'success');
      res.status(201).json({ backup, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backup creation failed' });
    }
  });

  app.post('/api/storage/restore', (req, res) => {
    try {
      const filename = String(req.body?.filename || '').trim();
      if (!filename) {
        res.status(400).json({ error: 'Backup filename is required.' });
        return;
      }
      const result = restoreFromLocalBackup(filename);
      res.json({ ok: true, ...result, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Backup restore failed' });
    }
  });

  app.get('/api/storage/export', (_req, res) => {
    const bundle = exportPortableDataBundle();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="strange-data-export-${stamp}.json"`);
    res.json(bundle);
  });

  app.post('/api/storage/import', (req, res) => {
    try {
      const result = validateAndImportBundle(req.body, 'pre_import');
      res.json({ ok: true, ...result, storage: getStorageHealthInfo() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid STRANGE export archive' });
    }
  });

  // Lightweight background scheduler for approved tasks (checks once per 60s — minimal CPU/RAM)
  setInterval(async () => {
    try {
      const tasks = listAutomations().filter((t) => t.enabled && t.approvedByUser);
      const now = Date.now();
      for (const task of tasks) {
        const lastMs = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
        if (now - lastMs >= task.intervalMinutes * 60 * 1000) {
          await runAutomationTaskById(task.id);
        }
      }
    } catch {
      // ignore transient background error; logged inside task runner
    }
  }, 60_000).unref();

  // --- Vite Dev Middleware / Static Production Assets ---
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = process.env.STRANGE_DIST_DIR
      ? path.resolve(process.env.STRANGE_DIST_DIR)
      : path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`STRANGE backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start STRANGE server:', err);
  process.exit(1);
});
