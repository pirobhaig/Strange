import { GoogleGenAI, Type } from '@google/genai';
import type {
  ChatMessage,
  GeminiModelId,
  GroundingSource,
  OpportunityItem,
  PresentationSlide,
  ProductPRD,
  ProjectRecord,
} from '../types.ts';
import { getSelectedModel, setSetting } from './db.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in server environment secrets. Add your Gemini API key in Settings > Secrets and restart.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeGeminiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return 'Gemini API authentication failed (PERMISSION_DENIED / API_KEY_INVALID). Check your GEMINI_API_KEY in Settings > Secrets.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'Gemini API rate limit or quota reached (RESOURCE_EXHAUSTED). Wait briefly or switch to a billing-enabled API key in Settings > Secrets.';
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return 'Requested Gemini model was not found (404). Verify the selected model in Settings.';
  }
  if (msg.includes('AbortError') || msg.includes('timeout')) {
    return 'Gemini request timed out. Try again or switch to gemini-3.1-flash-lite for lower latency.';
  }
  return msg;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = msg.includes('429') || msg.includes('503') || msg.includes('500') || msg.includes('ECONNRESET');
      if (!retryable || attempt === maxAttempts) {
        throw new Error(normalizeGeminiError(err));
      }
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
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
  latencyMs: number;
  reply?: string;
  error?: string;
}> {
  const activeModel = model || getSelectedModel();
  const start = Date.now();
  try {
    const ai = getAiClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: activeModel,
        contents: 'Respond in one short sentence confirming STRANGE operator connection is live.',
      })
    );
    const latencyMs = Date.now() - start;
    setSetting('gemini_last_verified_at', new Date().toISOString());
    setSetting('gemini_last_status', 'connected');
    setSetting('gemini_last_error', '');
    return {
      ok: true,
      model: activeModel,
      latencyMs,
      reply: res.text?.trim() || 'Connection verified.',
    };
  } catch (err) {
    const error = normalizeGeminiError(err);
    setSetting('gemini_last_status', 'error');
    setSetting('gemini_last_error', error);
    return {
      ok: false,
      model: activeModel,
      latencyMs: Date.now() - start,
      error,
    };
  }
}

export async function generateOperatorReply(params: {
  history: ChatMessage[];
  userMessage: string;
  attachmentText?: string;
  contextSnapshot: string;
  useWebSearch?: boolean;
}): Promise<{ text: string; sources: GroundingSource[] }> {
  const ai = getAiClient();
  const model = getSelectedModel();

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
1. Never claim you executed a command, deployed an app, sent a DM, or modified Whop/Supabase/Vercel unless the backend actually performed it and confirmed it in Live Local CRM & Workspace State.
2. Never invent metrics, revenue, follower counts, or test passes.
3. For financial, external messaging (Instagram/Discord), Whop listing changes, production DB changes, or deployment actions, instruct the user to approve the queued item in the Approval Queue or explain the exact step required.
4. Keep responses direct, structured, actionable, and concise—like a capable operator, not a verbose chatbot.`;

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        ...(params.useWebSearch ? { tools: [{ googleSearch: {} }] } : {}),
      },
    })
  );

  return {
    text: res.text?.trim() || 'No response text returned by Gemini.',
    sources: extractGroundingSources(res),
  };
}

export async function discoverBusinessOpportunities(
  nicheQuery: string
): Promise<{
  opportunities: Omit<OpportunityItem, 'id' | 'batchId' | 'query' | 'createdAt' | 'priorityOrder' | 'status'>[];
  sources: GroundingSource[];
}> {
  const ai = getAiClient();
  const model = getSelectedModel();

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

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: `Create a thorough, pragmatic Product Requirements Document (PRD) for a solo founder building:
Product Idea: ${opportunity.productIdea}
Problem Solved: ${opportunity.problemSolved}
Verified Evidence: ${opportunity.verifiedEvidence}
Target Audience: ${opportunity.targetAudience}
Competitors: ${opportunity.competitors}
Proposed Solution: ${opportunity.proposedSolution}
Core Features: ${opportunity.coreFeatures.join(', ')}

Ensure the architecture is lightweight (clean HTML/CSS/JS + Node/SQLite or Supabase optional), practical, and testable.`,
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
  const model = getSelectedModel();

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();

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

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();
  const count = Math.min(Math.max(params.slideCount || 7, 4), 12);

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();

  const filesText = Object.entries(params.fileSnapshot)
    .map(([name, content]) => `--- FILE: ${name} ---\n${content.slice(0, 6000)}`)
    .join('\n\n');

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
  const model = getSelectedModel();

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
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
