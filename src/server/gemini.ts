import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import type {
  AiDiagnosticCheck,
  AiDiagnosticsReport,
  ApprovalItem,
  AutomationTask,
  ChatMessage,
  ExecutedToolAction,
  GeminiModelId,
  GroundingSource,
  OpportunityItem,
  PresentationSlide,
  ProductPRD,
  ProjectRecord,
} from '../types.ts';
import { getSelectedModel, isValidGeminiModelId, setSetting } from './db.ts';
import { getGeminiApiKeyOrThrow, getGeminiSecretStatus } from './secrets.ts';

const FALLBACK_MODEL_CHAIN: GeminiModelId[] = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

function getAiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKeyOrThrow();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractUpstreamErrorMessage(raw: string): string {
  try {
    const start = raw.indexOf('{');
    if (start >= 0) {
      const parsed = JSON.parse(raw.slice(start)) as { error?: { message?: string; status?: string; code?: number } };
      if (parsed.error?.message) {
        return `${parsed.error.message}${parsed.error.status ? ` (${parsed.error.status})` : ''}`;
      }
    }
  } catch {
    // not JSON
  }
  return raw;
}

export function normalizeGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = extractUpstreamErrorMessage(raw);
  if (raw.includes('GEMINI_API_KEY is not configured') || raw.includes('malformed')) {
    return raw;
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403') || raw.includes('401')) {
    return 'Gemini API authentication failed (invalid key or insufficient permissions). Verify your Gemini API key in Settings > Secrets (AI Studio) or re-run CONFIGURE-GEMINI-KEY.bat (Windows).';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Gemini API rate limit or quota reached (429 RESOURCE_EXHAUSTED). Wait briefly or use a billing-enabled API key.';
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return `Gemini model is temporarily overloaded (503 UNAVAILABLE): ${clean}. Switch to gemini-3.1-flash-lite in Settings or retry shortly.`;
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return `Requested Gemini model was not found or is unavailable on your API key (404): ${clean}. Select a supported model like gemini-3.1-flash-lite in Settings.`;
  }
  if (raw.includes('ENOTFOUND') || raw.includes('ECONNREFUSED') || raw.includes('fetch failed') || raw.includes('ECONNRESET')) {
    return 'Network error: unable to reach Google Gemini API servers. Check your internet connection or firewall.';
  }
  if (raw.includes('AbortError') || raw.includes('timeout')) {
    return 'Gemini API request timed out. Try again or switch to gemini-3.1-flash-lite for lower latency.';
  }
  return clean || 'Unexpected Gemini API error.';
}

async function generateWithFallback<T>(
  primaryModel: GeminiModelId,
  runner: (model: GeminiModelId) => Promise<T>
): Promise<{ result: T; modelUsed: GeminiModelId }> {
  const candidates = [primaryModel, ...FALLBACK_MODEL_CHAIN.filter((m) => m !== primaryModel)];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = await runner(candidate);
      return { result, modelUsed: candidate };
    } catch (err) {
      lastError = err;
      const raw = err instanceof Error ? err.message : String(err);
      const isOverloadedOrMissingModel =
        raw.includes('503') ||
        raw.includes('UNAVAILABLE') ||
        raw.includes('high demand') ||
        raw.includes('NOT_FOUND') ||
        raw.includes('404');

      // Retry once on transient 429/500 before falling back
      if (raw.includes('429') || raw.includes('500') || raw.includes('ECONNRESET')) {
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

function extractGroundingSources(response: unknown): GroundingSource[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const ch of chunks) {
    const uri = ch.web?.uri;
    const title = ch.web?.title || uri;
    if (uri && !seen.has(uri) && (uri.startsWith('https://') || uri.startsWith('http://'))) {
      seen.add(uri);
      sources.push({ uri, title: title || uri });
    }
  }
  return sources;
}

function parseJsonFromModelText<T>(rawText: string | undefined): T {
  const cleaned = (rawText ?? '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const startObj = candidate.indexOf('{');
  const startArr = candidate.indexOf('[');
  let start = -1;
  if (startObj !== -1 && startArr !== -1) start = Math.min(startObj, startArr);
  else start = Math.max(startObj, startArr);
  const sliced = start >= 0 ? candidate.slice(start) : candidate;
  return JSON.parse(sliced) as T;
}

export async function testGeminiConnection(model?: GeminiModelId): Promise<{
  ok: boolean;
  model: GeminiModelId;
  modelUsed?: GeminiModelId;
  latencyMs: number;
  reply?: string;
  error?: string;
}> {
  const requestedModel = model || getSelectedModel();
  if (!isValidGeminiModelId(requestedModel)) {
    return {
      ok: false,
      model: requestedModel,
      latencyMs: 0,
      error: `Model "${requestedModel}" is deprecated or invalid. Use gemini-3.1-flash-lite or gemini-4-hydrogen.`,
    };
  }
  const start = Date.now();
  try {
    const ai = getAiClient();
    const { result, modelUsed } = await generateWithFallback(requestedModel, (m) =>
      ai.models.generateContent({
        model: m,
        contents: 'Respond in one short sentence confirming STRANGE operator connection is live.',
      })
    );
    const latencyMs = Date.now() - start;
    const reply = result.text?.trim() || 'Connection verified.';
    setSetting('gemini_last_verified_at', new Date().toISOString());
    setSetting('gemini_last_status', 'connected');
    setSetting('gemini_last_error', '');
    return {
      ok: true,
      model: requestedModel,
      modelUsed,
      latencyMs,
      reply:
        modelUsed !== requestedModel
          ? `${reply} (Note: ${requestedModel} was temporarily busy; automatically served via ${modelUsed}.)`
          : reply,
    };
  } catch (err) {
    const error = normalizeGeminiError(err);
    setSetting('gemini_last_status', 'error');
    setSetting('gemini_last_error', error);
    return {
      ok: false,
      model: requestedModel,
      latencyMs: Date.now() - start,
      error,
    };
  }
}

export async function runFullAiDiagnostics(requestedModel?: GeminiModelId): Promise<AiDiagnosticsReport> {
  const started = Date.now();
  const configuredModel = requestedModel || getSelectedModel();
  const secretStatus = getGeminiSecretStatus();
  const checks: AiDiagnosticCheck[] = [];

  checks.push({
    id: 'provider_config',
    label: 'Provider configuration',
    status: 'pass',
    details: `Google Gemini (@google/genai SDK) selected with model "${configuredModel}".`,
  });

  checks.push({
    id: 'credential_saved',
    label: 'Credential availability',
    status: secretStatus.configured ? 'pass' : 'fail',
    details: secretStatus.configured
      ? `Credential detected via ${secretStatus.source === 'environment' ? 'server environment secret' : 'local .env file'} (value hidden).`
      : secretStatus.malformed
        ? secretStatus.warning || 'Configured credential appears malformed.'
        : 'No Gemini API key detected on backend. Set GEMINI_API_KEY in AI Studio Secrets or run CONFIGURE-GEMINI-KEY.bat on Windows.',
  });

  let backendRetrieved = false;
  if (secretStatus.configured) {
    try {
      getGeminiApiKeyOrThrow();
      backendRetrieved = true;
      checks.push({
        id: 'backend_retrieval',
        label: 'Backend credential retrieval',
        status: 'pass',
        details: 'Backend initialized GoogleGenAI client securely without exposing credentials to browser.',
      });
    } catch (err) {
      checks.push({
        id: 'backend_retrieval',
        label: 'Backend credential retrieval',
        status: 'fail',
        details: normalizeGeminiError(err),
      });
    }
  } else {
    checks.push({
      id: 'backend_retrieval',
      label: 'Backend credential retrieval',
      status: 'fail',
      details: 'Skipped because no credential is currently configured.',
    });
  }

  const modelSupported = isValidGeminiModelId(configuredModel);
  checks.push({
    id: 'model_supported',
    label: 'Configured model validation',
    status: modelSupported ? 'pass' : 'fail',
    details: modelSupported
      ? `Model "${configuredModel}" passes active Gemini model checks (automatic fallback ready if overloaded).`
      : `Model "${configuredModel}" is deprecated or unsupported. Choose gemini-3.1-flash-lite or gemini-4-hydrogen.`,
  });

  let liveTestOk = false;
  let activeModelUsed: string | null = null;
  if (backendRetrieved && modelSupported) {
    const testRes = await testGeminiConnection(configuredModel);
    liveTestOk = testRes.ok;
    activeModelUsed = testRes.modelUsed || configuredModel;
    checks.push({
      id: 'live_api_call',
      label: 'Live Gemini API test request',
      status: testRes.ok ? 'pass' : 'fail',
      details: testRes.ok
        ? `Succeeded in ${testRes.latencyMs}ms using ${activeModelUsed}: "${testRes.reply}"`
        : testRes.error || 'Live API call failed.',
    });
  } else {
    checks.push({
      id: 'live_api_call',
      label: 'Live Gemini API test request',
      status: 'fail',
      details: 'Cannot run live test until credential and model checks pass.',
    });
  }

  checks.push({
    id: 'chat_backend',
    label: 'Chat & automation tool backend',
    status: liveTestOk ? 'pass' : 'warn',
    details: liveTestOk
      ? 'Chat pipeline, local JSON memory, and real automation function-calling tools are operational.'
      : 'Chat routes are online, awaiting passing live Gemini API check.',
  });

  return {
    overallOk: checks.every((c) => c.status === 'pass'),
    provider: 'Google Gemini',
    configuredModel,
    activeModelUsed,
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
    checks,
  };
}

// --- Real STRANGE Operator Function Calling Tools ---
export interface OperatorToolExecutors {
  createAutomation: (args: {
    name: string;
    taskType: AutomationTask['taskType'];
    intervalMinutes: number;
    description: string;
  }) => Promise<{ automation: AutomationTask }>;
  listAutomations: () => Promise<{ automations: AutomationTask[] }>;
  runAutomation: (taskId: string) => Promise<{ automation: AutomationTask | null }>;
  queueApproval: (args: {
    category: ApprovalItem['category'];
    title: string;
    target: string;
    proposedAction: string;
    consequences: string;
  }) => Promise<{ approval: ApprovalItem }>;
  createBackup: (reason: string) => Promise<{ filename: string; sizeKb: number }>;
  runWeeklyMaintenance: () => Promise<{ inspectedCount: number }>;
}

const OPERATOR_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'create_automation',
    description:
      'Create and save a real scheduled background automation task in STRANGE Automation Centre (persisted to local JSON storage). Use this whenever the user asks to create, schedule, set up, or make an automation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Clear name for the automation task (e.g., "Hourly App Health Check" or "Daily Workspace Backup").',
        },
        taskType: {
          type: Type.STRING,
          description: 'Must be one of: "health_check", "backup_workspace", or "weekly_maintenance_scan".',
        },
        intervalMinutes: {
          type: Type.NUMBER,
          description: 'Interval in minutes between runs (minimum 5, e.g., 30, 60, 1440 for daily, 10080 for weekly).',
        },
        description: {
          type: Type.STRING,
          description: 'Short description of what this automation performs.',
        },
      },
      required: ['name', 'taskType', 'intervalMinutes'],
    },
  },
  {
    name: 'list_automations',
    description: 'List all currently configured automations in STRANGE Automation Centre.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'run_automation',
    description: 'Execute an existing approved automation immediately by its task ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: {
          type: Type.STRING,
          description: 'The ID of the automation task to run (e.g., auto_...).',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'queue_approval',
    description:
      'Queue a mandatory human-in-the-loop approval item in Automation Centre for sensitive external, commercial (Whop), deployment (Vercel), outreach, or upgrade actions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description:
            'One of: "product_build", "instagram_dm", "discord_post", "whop_change", "supabase_migration", "vercel_deploy", "maintenance_upgrade", "error_repair".',
        },
        title: { type: Type.STRING, description: 'Short title for the approval request.' },
        target: { type: Type.STRING, description: 'Target project, account, or listing.' },
        proposedAction: { type: Type.STRING, description: 'Exact proposed action or message.' },
        consequences: { type: Type.STRING, description: 'Impact and safeguards explained clearly.' },
      },
      required: ['category', 'title', 'target', 'proposedAction', 'consequences'],
    },
  },
  {
    name: 'create_local_backup',
    description: 'Create an immediate local JSON backup snapshot of all STRANGE data.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'Short label for the backup (e.g., "operator_request").' },
      },
    },
  },
  {
    name: 'run_weekly_maintenance',
    description: 'Inspect all registered projects, check health, and queue per-project maintenance approval plans.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

export async function generateOperatorReply(params: {
  history: ChatMessage[];
  userMessage: string;
  attachmentText?: string;
  contextSnapshot: string;
  useWebSearch?: boolean;
  tools?: OperatorToolExecutors;
}): Promise<{ text: string; sources: GroundingSource[]; executedTools: ExecutedToolAction[]; modelUsed: string }> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const recentHistory = params.history
    .slice(-14)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const prompt = [
    recentHistory ? `Conversation History:\n${recentHistory}` : '',
    params.attachmentText ? `Attached Document Content:\n${params.attachmentText.slice(0, 12000)}` : '',
    `Live Local CRM & Workspace State:\n${params.contextSnapshot}`,
    `User Request:\n${params.userMessage}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  const systemInstruction = `You are STRANGE, a personal Windows desktop AI operator and software architect running on a resource-conscious machine (Lenovo G570, 6 GB RAM).
Strict operating rules:
1. When the user asks you to create/schedule an automation, list or run automations, queue an approval, create a backup, or run weekly maintenance, IMMEDIATELY call the matching function tool rather than just explaining how to do it.
2. Never claim you executed a command, created an automation, deployed an app, or sent a message unless a tool call actually succeeded and returned confirmation.
3. Never invent metrics, revenue, follower counts, or test passes.
4. For financial, external messaging (Instagram/Discord), Whop listing changes, production DB changes, or deployment actions, queue an approval item via queue_approval so the user can approve it in Automation Centre.
5. Keep responses direct, structured, actionable, and concise.`;

  const isLocalOperatorIntent =
    /\b(automation|automations|schedule|scheduled|backup|backups|approval|approvals|maintenance|crm|projects?)\b/i.test(
      params.userMessage
    );
  const attachWebSearch = Boolean(params.useWebSearch && !isLocalOperatorIntent);

  const buildCallConfig = (withSearch: boolean) => {
    const tools: Array<Record<string, unknown>> = [];
    if (withSearch) {
      tools.push({ googleSearch: {} });
    }
    if (params.tools) {
      tools.push({ functionDeclarations: OPERATOR_TOOL_DECLARATIONS });
    }
    const hybrid = withSearch && params.tools ? { includeServerSideToolInvocations: true } : undefined;
    return {
      systemInstruction,
      ...(tools.length > 0 ? { tools: tools as never } : {}),
      ...(hybrid ? { toolConfig: hybrid as never } : {}),
    };
  };

  let firstResponse;
  let modelUsed: GeminiModelId;
  let activeWithSearch = attachWebSearch;

  try {
    const out = await generateWithFallback(primaryModel, (m) =>
      ai.models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: buildCallConfig(activeWithSearch),
      })
    );
    firstResponse = out.result;
    modelUsed = out.modelUsed;
  } catch (err) {
    // If Google Search grounding hits quota (429) or unsupported hybrid tool config (400),
    // gracefully fall back to direct Gemini + operator function tools so chat never breaks.
    if (activeWithSearch) {
      activeWithSearch = false;
      const fallbackOut = await generateWithFallback(primaryModel, (m) =>
        ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: buildCallConfig(false),
        })
      );
      firstResponse = fallbackOut.result;
      modelUsed = fallbackOut.modelUsed;
    } else {
      throw err;
    }
  }

  const executedTools: ExecutedToolAction[] = [];
  const allSources: GroundingSource[] = [...extractGroundingSources(firstResponse)];
  const calls = firstResponse.functionCalls || [];

  if (calls.length === 0 || !params.tools) {
    const text = firstResponse.text?.trim();
    if (!text) {
      throw new Error('Gemini returned an empty response. Please retry your message.');
    }
    return { text, sources: allSources, executedTools, modelUsed };
  }

  // Execute each requested backend tool truthfully
  const functionResponseParts: Array<{
    functionResponse: { id?: string; name: string; response: Record<string, unknown> };
  }> = [];

  for (const call of calls) {
    const name = call.name || '';
    const args = (call.args || {}) as Record<string, unknown>;
    try {
      let toolOutput: Record<string, unknown> = {};
      if (name === 'create_automation') {
        const rawType = String(args.taskType || 'health_check');
        const taskType: AutomationTask['taskType'] =
          rawType === 'backup_workspace' || rawType === 'weekly_maintenance_scan' ? rawType : 'health_check';
        const intervalMinutes = Math.max(5, Number(args.intervalMinutes || 60));
        const taskName = String(args.name || `Scheduled ${taskType.replace(/_/g, ' ')}`).slice(0, 100);
        const description = String(args.description || `${taskType.replace(/_/g, ' ')} every ${intervalMinutes} min`);
        const res = await params.tools.createAutomation({
          name: taskName,
          taskType,
          intervalMinutes,
          description,
        });
        toolOutput = { ok: true, automation: res.automation };
        executedTools.push({
          name,
          status: 'success',
          summary: `Created automation "${res.automation.name}" (${res.automation.taskType}, every ${res.automation.intervalMinutes} min, ID: ${res.automation.id})`,
        });
      } else if (name === 'list_automations') {
        const res = await params.tools.listAutomations();
        toolOutput = { ok: true, count: res.automations.length, automations: res.automations };
        executedTools.push({
          name,
          status: 'success',
          summary: `Listed ${res.automations.length} automation(s) from local storage`,
        });
      } else if (name === 'run_automation') {
        const res = await params.tools.runAutomation(String(args.taskId || ''));
        toolOutput = { ok: true, automation: res.automation };
        executedTools.push({
          name,
          status: 'success',
          summary: `Executed automation "${res.automation?.name || args.taskId}": ${res.automation?.lastResult || 'Completed'}`,
        });
      } else if (name === 'queue_approval') {
        const allowedCats = new Set([
          'product_build',
          'instagram_dm',
          'discord_post',
          'whop_change',
          'supabase_migration',
          'vercel_deploy',
          'maintenance_upgrade',
          'error_repair',
        ]);
        const cat = allowedCats.has(String(args.category))
          ? (String(args.category) as ApprovalItem['category'])
          : 'maintenance_upgrade';
        const res = await params.tools.queueApproval({
          category: cat,
          title: String(args.title || 'Operator Approval Request'),
          target: String(args.target || 'Workspace'),
          proposedAction: String(args.proposedAction || ''),
          consequences: String(args.consequences || 'Requires explicit user confirmation.'),
        });
        toolOutput = { ok: true, approval: res.approval };
        executedTools.push({
          name,
          status: 'success',
          summary: `Queued approval "${res.approval.title}" (ID: ${res.approval.id})`,
        });
      } else if (name === 'create_local_backup') {
        const res = await params.tools.createBackup(String(args.reason || 'chat_operator'));
        toolOutput = { ok: true, backup: res };
        executedTools.push({
          name,
          status: 'success',
          summary: `Created backup ${res.filename} (${res.sizeKb} KB)`,
        });
      } else if (name === 'run_weekly_maintenance') {
        const res = await params.tools.runWeeklyMaintenance();
        toolOutput = { ok: true, inspectedCount: res.inspectedCount };
        executedTools.push({
          name,
          status: 'success',
          summary: `Ran weekly maintenance across ${res.inspectedCount} project(s)`,
        });
      } else {
        toolOutput = { ok: false, error: `Unknown tool: ${name}` };
      }

      functionResponseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: toolOutput,
        },
      });
    } catch (toolErr) {
      const errMsg = toolErr instanceof Error ? toolErr.message : 'Tool execution failed';
      executedTools.push({ name, status: 'error', summary: errMsg });
      functionResponseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: { ok: false, error: errMsg },
        },
      });
    }
  }

  const previousContent = firstResponse.candidates?.[0]?.content;
  const followUpContents = previousContent
    ? [
        { role: 'user', parts: [{ text: prompt }] },
        previousContent,
        { role: 'user', parts: functionResponseParts },
      ]
    : [
        {
          role: 'user',
          parts: [
            {
              text: `${prompt}\n\nCompleted Tool Results:\n${JSON.stringify(executedTools, null, 2)}\n\nSummarize truthfully what was executed.`,
            },
          ],
        },
      ];

  let finalText = '';
  try {
    const { result: secondResponse } = await generateWithFallback(modelUsed, (m) =>
      ai.models.generateContent({
        model: m,
        contents: followUpContents as never,
        config: buildCallConfig(activeWithSearch),
      })
    );
    for (const s of extractGroundingSources(secondResponse)) {
      if (!allSources.some((x) => x.uri === s.uri)) allSources.push(s);
    }
    finalText = secondResponse.text?.trim() || '';
  } catch {
    // Tools already executed truthfully; return verified execution summary rather than failing with 502.
    finalText = '';
  }

  if (!finalText) {
    finalText = executedTools
      .map((t) => `${t.status === 'success' ? 'Completed' : 'Failed'}: ${t.summary}`)
      .join('\n');
  }

  return { text: finalText, sources: allSources, executedTools, modelUsed };
}

export async function discoverBusinessOpportunities(
  nicheQuery: string
): Promise<{
  opportunities: Omit<OpportunityItem, 'id' | 'batchId' | 'query' | 'createdAt' | 'priorityOrder' | 'status'>[];
  sources: GroundingSource[];
}> {
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

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    })
  );

  const sources = extractGroundingSources(res);
  const parsed = parseJsonFromModelText<{
    opportunities: Array<
      Omit<OpportunityItem, 'id' | 'batchId' | 'query' | 'createdAt' | 'priorityOrder' | 'status' | 'sources'>
    >;
  }>(res.text);

  const list = (parsed.opportunities || []).slice(0, 3);
  if (list.length !== 3) {
    throw new Error(`Discovery returned ${list.length} opportunities instead of the required 3. Please retry.`);
  }

  return {
    opportunities: list.map((item, idx) => ({
      ...item,
      rankIndex: idx + 1,
      coreFeatures: Array.isArray(item.coreFeatures) ? item.coreFeatures : [],
      technicalComplexity:
        item.technicalComplexity === 'Low' || item.technicalComplexity === 'High'
          ? item.technicalComplexity
          : 'Medium',
      isRecommended: Boolean(item.isRecommended),
      sources,
    })),
    sources,
  };
}

export async function generateProductPRD(opportunity: OpportunityItem): Promise<ProductPRD> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Create a thorough, pragmatic Product Requirements Document (PRD) for a solo founder building:
Product Idea: ${opportunity.productIdea}
Problem Solved: ${opportunity.problemSolved}
Verified Evidence: ${opportunity.verifiedEvidence}
Target Audience: ${opportunity.targetAudience}
Competitors: ${opportunity.competitors}
Proposed Solution: ${opportunity.proposedSolution}
Core Features: ${opportunity.coreFeatures.join(', ')}

Ensure the architecture is lightweight (clean HTML/CSS/JS + local JSON or optional Supabase), practical, and testable.`,
      config: {
        responseMimeType: 'application/json',
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
                  goal: { type: Type.STRING },
                },
                required: ['name', 'role', 'painPoint', 'goal'],
              },
            },
            userJourneys: { type: Type.ARRAY, items: { type: Type.STRING } },
            featureList: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['name', 'priority', 'description'],
              },
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
                  estimate: { type: Type.STRING },
                },
                required: ['phase', 'deliverables', 'estimate'],
              },
            },
            risksAndAssumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'productNames',
            'recommendedName',
            'executiveSummary',
            'targetAudience',
            'userPersonas',
            'userJourneys',
            'featureList',
            'competitorAnalysis',
            'uxPlan',
            'technicalArchitecture',
            'databaseDesign',
            'milestones',
            'risksAndAssumptions',
          ],
        },
      },
    })
  );

  return parseJsonFromModelText<ProductPRD>(res.text);
}

export async function generateProductSourceBundle(project: ProjectRecord): Promise<{
  indexHtml: string;
  stylesCss: string;
  appJs: string;
  logicMjs: string;
  unitTestMjs: string;
  readmeMd: string;
}> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Generate a complete, working, self-contained lightweight web application for the project "${project.name}".
Description: ${project.description}
PRD Summary: ${project.prd?.executiveSummary || project.description}
Core Features: ${(project.prd?.featureList || []).map((f) => f.name).join(', ')}

Requirements:
1. indexHtml: Complete valid HTML5 page referencing ./styles.css and ./app.js (using type="module"). Must have real interactive forms, lists, filters, localStorage persistence, and clean accessible dark UI. No inline event handlers.
2. stylesCss: Clean, responsive CSS with high contrast.
3. logicMjs: Pure ES module exporting core business logic functions (e.g., createItem, validateItem, calculateSummary, filterItems) with zero DOM dependencies so Node.js unit tests can import and test it directly.
4. appJs: Complete browser ES module importing from ./logic.mjs and wiring every button, form, search filter, and persistence state cleanly without dead clicks or innerHTML XSS sinks.
5. unitTestMjs: Genuine Node.js test file using 'node:test' and 'node:assert/strict' that imports from '../logic.mjs' and writes at least 4 thorough unit tests covering validation, state transformation, edge cases, and calculations.
6. readmeMd: Clear setup, architecture, and local preview instructions.

Return valid JSON only matching the schema.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            indexHtml: { type: Type.STRING },
            stylesCss: { type: Type.STRING },
            appJs: { type: Type.STRING },
            logicMjs: { type: Type.STRING },
            unitTestMjs: { type: Type.STRING },
            readmeMd: { type: Type.STRING },
          },
          required: ['indexHtml', 'stylesCss', 'appJs', 'logicMjs', 'unitTestMjs', 'readmeMd'],
        },
      },
    })
  );

  return parseJsonFromModelText(res.text);
}

export async function researchOutreachTargets(params: {
  platform: 'instagram' | 'discord';
  niche: string;
  productName: string;
  productDescription: string;
}): Promise<{
  targets: Array<{
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
  }>;
  sources: GroundingSource[];
}> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const prompt =
    params.platform === 'instagram'
      ? `Use Google Search to research 4 real public Instagram creators / influencers relevant to promoting "${params.productName}" (${params.productDescription}) in the niche "${params.niche}".
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
}`
      : `Use Google Search to research 4 real public Discord communities relevant to "${params.productName}" (${params.productDescription}) in the niche "${params.niche}".
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
      "promotionPermitted": "Yes (promo channel) / Unknown — check rules / No direct promo",
      "relevanceRank": 1,
      "draftMessage": "Customized respectful community post"
    }
  ]
}`;

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    })
  );

  const sources = extractGroundingSources(res);
  const parsed = parseJsonFromModelText<{ targets: Array<Record<string, unknown>> }>(res.text);

  const targets = (parsed.targets || []).map((t, idx) => ({
    name: String(t.name || 'Unnamed Target'),
    profileOrInviteUrl: String(t.profileOrInviteUrl || ''),
    niche: String(t.niche || params.niche),
    contentCategory: String(t.contentCategory || 'General'),
    publicFollowersOrSize: String(t.publicFollowersOrSize || 'Not publicly listed'),
    audienceRelevance: String(t.audienceRelevance || ''),
    publicContactOrRules: String(t.publicContactOrRules || 'Not publicly listed'),
    promotionPermitted: String(t.promotionPermitted || 'Verify rules before posting'),
    relevanceRank: Number(t.relevanceRank) || idx + 1,
    draftMessage: String(t.draftMessage || ''),
  }));

  return { targets, sources };
}

export async function generatePresentationDeck(params: {
  title: string;
  audience: string;
  objective: string;
  context?: string;
  slideCount?: number;
}): Promise<PresentationSlide[]> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();
  const count = Math.min(Math.max(params.slideCount || 7, 4), 12);

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Generate a professional ${count}-slide presentation deck.
Title: ${params.title}
Target Audience: ${params.audience}
Objective: ${params.objective}
Additional Context: ${params.context || 'None provided.'}

Do NOT invent fake traction, fake revenue, or fake testimonials. Use concrete structure, clear talking points, and realistic frameworks.`,
      config: {
        responseMimeType: 'application/json',
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
                  speakerNotes: { type: Type.STRING },
                },
                required: ['slideNumber', 'title', 'layout', 'keyPoints', 'visualHint', 'speakerNotes'],
              },
            },
          },
          required: ['slides'],
        },
      },
    })
  );

  const parsed = parseJsonFromModelText<{ slides: PresentationSlide[] }>(res.text);
  return (parsed.slides || []).map((s, idx) => ({
    ...s,
    slideNumber: idx + 1,
    layout: (['title', 'bullets', 'split', 'metrics', 'closing'].includes(s.layout)
      ? s.layout
      : 'bullets') as PresentationSlide['layout'],
  }));
}

export async function diagnoseProjectError(params: {
  project: ProjectRecord;
  component: string;
  errorMessage: string;
  fileSnapshot: Record<string, string>;
}): Promise<{
  diagnosis: string;
  affectedFile: string;
  proposedFixSummary: string;
  patchedFileContent: string;
}> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const filesText = Object.entries(params.fileSnapshot)
    .map(([name, content]) => `--- FILE: ${name} ---\n${content.slice(0, 6000)}`)
    .join('\n\n');

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Diagnose this application error and prepare a safe, minimal, reversible fix.
Project: ${params.project.name}
Component: ${params.component}
Error Message: ${params.errorMessage}

Workspace Files:
${filesText}

Choose the single most relevant existing file to patch (e.g., "app.js", "logic.mjs", "index.html", or "styles.css") and provide the complete corrected file content.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosis: { type: Type.STRING },
            affectedFile: { type: Type.STRING },
            proposedFixSummary: { type: Type.STRING },
            patchedFileContent: { type: Type.STRING },
          },
          required: ['diagnosis', 'affectedFile', 'proposedFixSummary', 'patchedFileContent'],
        },
      },
    })
  );

  return parseJsonFromModelText(res.text);
}

export async function generateMaintenancePlan(project: ProjectRecord): Promise<{
  healthSummary: string;
  dependencyNotes: string;
  proposedImprovements: { title: string; reason: string; riskLevel: 'Low' | 'Medium' | 'High' }[];
}> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Prepare a weekly maintenance & improvement plan for this registered application:
Name: ${project.name}
Tech Stack: ${project.techStack}
Status: ${project.status}
Health Status: ${project.healthStatus}
Recent Errors: ${project.recentErrors || 'None recorded'}
Deployment Status: ${project.deploymentStatus}
Description: ${project.description}

Identify concrete maintenance actions and 2-3 high-value feature or reliability improvements with explicit reasons and risk levels.`,
      config: {
        responseMimeType: 'application/json',
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
                  riskLevel: { type: Type.STRING },
                },
                required: ['title', 'reason', 'riskLevel'],
              },
            },
          },
          required: ['healthSummary', 'dependencyNotes', 'proposedImprovements'],
        },
      },
    })
  );

  return parseJsonFromModelText(res.text);
}

export async function generateSupabaseMigrationSql(
  projectName: string,
  schemaDescription: string
): Promise<{ upSql: string; downSql: string; notes: string }> {
  const ai = getAiClient();
  const primaryModel = getSelectedModel();

  const { result: res } = await generateWithFallback(primaryModel, (m) =>
    ai.models.generateContent({
      model: m,
      contents: `Generate a safe, reversible PostgreSQL / Supabase migration with Row Level Security (RLS) enabled for "${projectName}".
Requirements: ${schemaDescription}
Provide both UP migration SQL and reversible DOWN rollback SQL, plus concise security notes.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            upSql: { type: Type.STRING },
            downSql: { type: Type.STRING },
            notes: { type: Type.STRING },
          },
          required: ['upSql', 'downSql', 'notes'],
        },
      },
    })
  );

  return parseJsonFromModelText(res.text);
}
