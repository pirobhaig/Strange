import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Cpu, ShieldCheck, Volume2, ArrowRight } from 'lucide-react';
import type { GeminiModelId, IntegrationStatus } from '../types';
import { api } from '../lib/api';

interface Props {
  integrations: IntegrationStatus;
  onComplete: () => void;
}

export function OnboardingModal({ integrations, onComplete }: Props) {
  const [selectedModel, setSelectedModel] = useState<GeminiModelId>(integrations.gemini.model);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await api.saveSettings({ gemini_model: selectedModel });
      const res = await api.testGemini(selectedModel);
      setTestResult({
        ok: res.ok,
        message: res.reply || 'Gemini API connection verified.',
        latencyMs: res.latencyMs,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection verification failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        gemini_model: selectedModel,
        onboarding_completed: 'true',
      });
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0D1117] p-6 md:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <p className="text-xs font-medium text-cyan-400">First-Run Operator Setup</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
              Initialize STRANGE Workspace
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Verify your AI provider connection, choose your default Gemini model, and review local security safeguards before opening the dashboard.
            </p>
          </div>
          <Cpu className="h-6 w-6 shrink-0 text-cyan-400" />
        </div>

        <div className="mt-6 space-y-5">
          {/* Step 1: AI Provider & Credential Security */}
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
                <h3 className="text-sm font-semibold text-slate-100">1. Default AI Provider — Google Gemini</h3>
              </div>
              <span
                className={`text-xs font-medium ${
                  integrations.gemini.configured ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {integrations.gemini.configured ? 'Server secret detected' : 'Secret not detected'}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Credentials stay strictly on the server (managed via Settings &gt; Secrets in AI Studio,{' '}
              <span className="font-mono text-cyan-300">CONFIGURE-GEMINI-KEY.bat</span> on Windows localhost, or Windows DPAPI Electron safeStorage) and are never exposed to the browser or saved in chat memory.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelectedModel('gemini-3.1-flash-lite')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedModel === 'gemini-3.1-flash-lite'
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-slate-100'
                    : 'border-slate-800 bg-[#0D1117] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">gemini-3.1-flash-lite</span>
                  <span className="text-[11px] font-medium text-emerald-400">Recommended</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Fast, reliable default for chat, automation tools, and low-RAM Windows laptops
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel('gemini-4-hydrogen')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedModel === 'gemini-4-hydrogen'
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-slate-100'
                    : 'border-slate-800 bg-[#0D1117] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-sm font-medium">gemini-4-hydrogen</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Higher-capacity mode with automatic fallback to flash-lite if temporarily busy
                </div>
              </button>
            </div>
          </div>

          {/* Step 2: Live Connection Test */}
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">2. Validate Live Connection</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Send a real verification prompt to confirm model availability and quota status.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
              >
                {testing ? 'Testing Connection...' : 'Test Gemini Connection'}
              </button>
            </div>

            {testResult && (
              <div
                className={`mt-3 flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                  testResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                    : 'border-red-500/30 bg-red-500/5 text-red-300'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <div className="font-medium">
                    {testResult.ok
                      ? `Connected (${testResult.latencyMs}ms)`
                      : 'Connection check failed'}
                  </div>
                  <div className="mt-0.5 text-slate-300">{testResult.message}</div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Local JSON Storage & Hardware Note */}
          <div className="flex items-start gap-3 text-xs text-slate-400">
            <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p>
              Zero-database local JSON storage is automatically managed at{' '}
              <span className="font-mono text-slate-300">{integrations.runtime.storagePath}</span> with atomic writes and automatic backups. Voice, integrations, and portable data export/restore are ready in Settings.
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3 border-t border-slate-800/80 pt-5">
          <button
            type="button"
            onClick={handleFinish}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
          >
            <span>{saving ? 'Opening...' : 'Open STRANGE Dashboard'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
