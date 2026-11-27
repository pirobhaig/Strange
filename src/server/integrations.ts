import type { IntegrationStatus, WhopAnalytics } from '../types.ts';
import { getSelectedModel, getSetting, logActivity, nowIso } from './db.ts';
import { DB_PATH } from './db.ts';
import { getGeminiSecretStatus } from './secrets.ts';

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

export function validatePublicHealthUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https URLs are allowed for health checks.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      throw new Error('Health checks cannot target loopback, private, or link-local addresses.');
    }
  }
  return parsed;
}

export async function runSafeProjectHealthCheck(
  liveUrl: string | null,
  previewSlug: string,
  localServerBaseUrl: string
): Promise<{ ok: boolean; statusCode: number | null; target: string; error?: string }> {
  try {
    if (liveUrl) {
      const safe = validatePublicHealthUrl(liveUrl);
      const res = await fetch(safe.toString(), { method: 'GET', signal: AbortSignal.timeout(6000) });
      return { ok: res.ok, statusCode: res.status, target: safe.toString() };
    }
    if (!/^[a-z0-9-]+$/.test(previewSlug)) {
      return { ok: false, statusCode: null, target: 'invalid', error: 'Invalid project slug.' };
    }
    const localUrl = `${localServerBaseUrl}/preview/${previewSlug}/`;
    const res = await fetch(localUrl, { method: 'GET', signal: AbortSignal.timeout(4000) });
    return { ok: res.ok, statusCode: res.status, target: localUrl };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      target: liveUrl || `/preview/${previewSlug}/`,
      error: err instanceof Error ? err.message : 'Health check failed',
    };
  }
}

export function getIntegrationStatusSnapshot(): IntegrationStatus {
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
      lastVerifiedAt: getSetting('gemini_last_verified_at') || null,
      lastStatus: (getSetting('gemini_last_status', 'untested') as IntegrationStatus['gemini']['lastStatus']),
      lastError: geminiSecret.warning || getSetting('gemini_last_error') || null,
    },
    whop: {
      configured: whopConfigured,
      lastVerifiedAt: getSetting('whop_last_verified_at') || null,
      status: whopConfigured
        ? ((getSetting('whop_last_status', 'connected') as IntegrationStatus['whop']['status']))
        : 'disconnected',
      error: getSetting('whop_last_error') || null,
    },
    supabase: {
      configured: supabaseConfigured,
      urlConfigured: supabaseUrlConfigured,
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      status: supabaseConfigured
        ? ((getSetting('supabase_last_status', 'connected') as IntegrationStatus['supabase']['status']))
        : 'disconnected',
      error: getSetting('supabase_last_error') || null,
    },
    vercel: {
      configured: vercelConfigured,
      status: vercelConfigured
        ? ((getSetting('vercel_last_status', 'connected') as IntegrationStatus['vercel']['status']))
        : 'disconnected',
      error: getSetting('vercel_last_error') || null,
    },
    freemodel: {
      status: 'documentation_required',
      note: 'FreeModel.in is registered in the modular provider interface, but not yet wired. Official documentation (base URL, auth header format, models, streaming spec) must be inspected before enabling—never assumed to be OpenAI-compatible.',
    },
    instagram: {
      authorizedAccount: getSetting('instagram_authorized_account', ''),
      mode: 'guided_manual',
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      electronDetected: Boolean(process.versions.electron),
      memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      storageEngine: 'Local JSON Files (v1.0)',
      storagePath: DB_PATH,
    },
  };
}

// --- Real Official Whop REST API Proxy ---
export async function fetchWhopAnalytics(): Promise<WhopAnalytics> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    return {
      connected: false,
      reportingPeriod: 'Unavailable (Whop not connected)',
      lastRefreshedAt: null,
      error: 'Configure WHOP_API_KEY in Settings > Secrets to pull live Whop sales, subscriptions, and product metrics.',
      products: [],
      metrics: {
        totalSales: null,
        transactions: null,
        revenueUsd: null,
        activeSubscriptions: null,
        cancellations: null,
        refunds: null,
      },
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  try {
    const [prodRes, memRes, payRes] = await Promise.all([
      fetch('https://api.whop.com/api/v2/products', { headers, signal: AbortSignal.timeout(8000) }),
      fetch('https://api.whop.com/api/v2/memberships', { headers, signal: AbortSignal.timeout(8000) }),
      fetch('https://api.whop.com/api/v2/payments', { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    if (!prodRes.ok) {
      throw new Error(`Whop API returned HTTP ${prodRes.status}. Verify WHOP_API_KEY permissions.`);
    }

    const prodJson = (await prodRes.json()) as { data?: Array<{ id: string; name?: string; title?: string; visibility?: string }> };
    const memJson = memRes.ok
      ? ((await memRes.json()) as { data?: Array<{ status?: string; cancel_at_period_end?: boolean }> })
      : { data: [] };
    const payJson = payRes.ok
      ? ((await payRes.json()) as { data?: Array<{ status?: string; final_amount?: number; refunded_amount?: number }> })
      : { data: [] };

    const payments = payJson.data ?? [];
    const memberships = memJson.data ?? [];
    const products = (prodJson.data ?? []).map((p) => ({
      id: p.id,
      name: p.name || p.title || p.id,
      visibility: p.visibility,
    }));

    const paidPayments = payments.filter((p) => p.status === 'paid' || p.status === 'succeeded');
    const revenueUsd = paidPayments.reduce((sum, p) => sum + (Number(p.final_amount) || 0) / 100, 0);
    const refunds = payments.filter((p) => (Number(p.refunded_amount) || 0) > 0 || p.status === 'refunded').length;
    const activeSubscriptions = memberships.filter((m) => m.status === 'active' || m.status === 'trialing').length;
    const cancellations = memberships.filter((m) => m.status === 'canceled' || m.cancel_at_period_end).length;

    const refreshed = nowIso();
    logActivity('whop', 'Refreshed live Whop analytics', `Loaded ${products.length} products and ${payments.length} payments`, 'success');

    return {
      connected: true,
      reportingPeriod: 'Current API Page (Latest Records)',
      lastRefreshedAt: refreshed,
      error: null,
      products,
      metrics: {
        totalSales: paidPayments.length,
        transactions: payments.length,
        revenueUsd: Number(revenueUsd.toFixed(2)),
        activeSubscriptions,
        cancellations,
        refunds,
      },
    };
  } catch (err) {
    return {
      connected: false,
      reportingPeriod: 'Unavailable',
      lastRefreshedAt: nowIso(),
      error: err instanceof Error ? err.message : 'Failed to query Whop API',
      products: [],
      metrics: {
        totalSales: null,
        transactions: null,
        revenueUsd: null,
        activeSubscriptions: null,
        cancellations: null,
        refunds: null,
      },
    };
  }
}

// --- Real Official Supabase Connection Test ---
export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  message: string;
  projectHost?: string;
}> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      connected: false,
      message: 'SUPABASE_URL and SUPABASE_ANON_KEY are not configured in server environment secrets.',
    };
  }
  try {
    const parsed = validatePublicHealthUrl(url);
    const res = await fetch(`${parsed.origin}/rest/v1/`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      return {
        connected: false,
        message: `Supabase REST endpoint returned HTTP ${res.status}. Verify project URL and anon key.`,
        projectHost: parsed.host,
      };
    }
    logActivity('supabase', 'Verified Supabase REST connection', `Host: ${parsed.host}`, 'success');
    return {
      connected: true,
      message: `Connected to Supabase REST API at ${parsed.host}. Service-role key stays strictly server-side.`,
      projectHost: parsed.host,
    };
  } catch (err) {
    return {
      connected: false,
      message: err instanceof Error ? err.message : 'Supabase connection test failed.',
    };
  }
}

// --- Real Official Vercel API Proxy ---
export async function listVercelProjects(): Promise<{
  connected: boolean;
  projects: Array<{ id: string; name: string; framework: string | null; updatedAt: number; liveUrl: string | null }>;
  error?: string;
}> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      connected: false,
      projects: [],
      error: 'VERCEL_TOKEN is not configured in server environment secrets.',
    };
  }
  try {
    const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects${teamQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        connected: false,
        projects: [],
        error: `Vercel API returned HTTP ${res.status}. Verify VERCEL_TOKEN.`,
      };
    }
    const data = (await res.json()) as {
      projects?: Array<{
        id: string;
        name: string;
        framework?: string | null;
        updatedAt?: number;
        latestDeployments?: Array<{ url?: string }>;
      }>;
    };
    const projects = (data.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework || null,
      updatedAt: p.updatedAt || Date.now(),
      liveUrl: p.latestDeployments?.[0]?.url ? `https://${p.latestDeployments[0].url}` : null,
    }));
    logActivity('vercel', 'Inspected Vercel projects', `Found ${projects.length} project(s)`, 'success');
    return { connected: true, projects };
  } catch (err) {
    return {
      connected: false,
      projects: [],
      error: err instanceof Error ? err.message : 'Failed to reach Vercel API',
    };
  }
}
