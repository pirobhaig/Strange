import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  HardDrive,
  RotateCcw,
  Shield,
  Upload,
  Volume2,
  XCircle,
} from 'lucide-react';
import type { AiDiagnosticsReport, GeminiModelId, IntegrationStatus, StorageHealthInfo } from '../types';
import { api } from '../lib/api';
import { listAvailableVoices, speakText, stopSpeaking, type VoiceSettings } from '../lib/voice';

interface Props {
  integrations: IntegrationStatus;
  voiceSettings: VoiceSettings;
  onVoiceSettingsChange: (next: VoiceSettings) => void;
  onDataChanged: () => void;
}

export function SettingsView({
  integrations,
  voiceSettings,
  onVoiceSettingsChange,
  onDataChanged,
}: Props) {
  const [model, setModel] = useState<GeminiModelId>(integrations.gemini.model);
  const [customModelInput, setCustomModelInput] = useState<string>(integrations.gemini.model);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testingGemini, setTestingGemini] = useState(false);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AiDiagnosticsReport | null>(null);
  const [geminiResult, setGeminiResult] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [supabaseResult, setSupabaseResult] = useState<string | null>(null);
  const [vercelResult, setVercelResult] = useState<string | null>(null);
  const [whopResult, setWhopResult] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Local JSON Storage & Portable Backup state
  const [storageInfo, setStorageInfo] = useState<StorageHealthInfo | null>(null);
  const [storageBusy, setStorageBusy] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadStorageInfo = async () => {
    try {
      const res = await api.getStorageInfo();
      setStorageInfo(res.storage);
    } catch (err) {
      setStorageMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to inspect local JSON storage.',
      });
    }
  };

  useEffect(() => {
    const refreshVoices = () => setVoices(listAvailableVoices());
    refreshVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    loadStorageInfo();
  }, []);

  const handleSaveModel = async (nextModel: GeminiModelId) => {
    const trimmed = nextModel.trim();
    if (!trimmed) return;
    setModelError(null);
    try {
      await api.saveSettings({ gemini_model: trimmed });
      setModel(trimmed);
      setCustomModelInput(trimmed);
      setSavedToast(`Default Gemini model updated to ${trimmed}.`);
      onDataChanged();
    } catch (err) {
      setModelError(err instanceof Error ? err.message : 'Failed to update Gemini model.');
    }
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiResult(null);
    try {
      const res = await api.testGemini(model);
      const servedBy = res.modelUsed && res.modelUsed !== res.model ? `${res.model} -> ${res.modelUsed}` : res.model;
      setGeminiResult(`Verified (${servedBy}, ${res.latencyMs}ms): ${res.reply}`);
      onDataChanged();
    } catch (err) {
      setGeminiResult(err instanceof Error ? err.message : 'Gemini test failed');
    } finally {
      setTestingGemini(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setRunningDiagnostics(true);
    setDiagnostics(null);
    try {
      const report = await api.runAiDiagnostics(model);
      setDiagnostics(report);
      onDataChanged();
    } catch (err) {
      setGeminiResult(err instanceof Error ? err.message : 'Diagnostic check failed');
    } finally {
      setRunningDiagnostics(false);
    }
  };

  const handleTestSupabase = async () => {
    const res = await api.testSupabase();
    setSupabaseResult(res.message);
    onDataChanged();
  };

  const handleTestVercel = async () => {
    const res = await api.listVercelProjects();
    setVercelResult(
      res.connected
        ? `Connected to Vercel API. Found ${res.projects.length} project(s).`
        : res.error || 'Vercel disconnected.'
    );
    onDataChanged();
  };

  const handleTestWhop = async () => {
    const res = await api.getWhopAnalytics();
    setWhopResult(
      res.connected
        ? `Connected to Whop API. Loaded ${res.products.length} product(s) and ${res.metrics.transactions ?? 0} recent transaction(s).`
        : res.error || 'Whop disconnected.'
    );
    onDataChanged();
  };

  const handleCreateBackup = async () => {
    setStorageBusy('backup');
    setStorageMessage(null);
    try {
      const res = await api.createStorageBackup('manual');
      setStorageInfo(res.storage);
      setStorageMessage({
        type: 'info',
        text: `Backup created safely: ${res.backup.filename} (${res.backup.sizeKb} KB). API credentials were excluded.`,
      });
      onDataChanged();
    } catch (err) {
      setStorageMessage({ type: 'error', text: err instanceof Error ? err.message : 'Backup failed.' });
    } finally {
      setStorageBusy(null);
    }
  };

  const handleRestoreLocalBackup = async (filename: string) => {
    setStorageBusy(filename);
    setStorageMessage(null);
    try {
      const res = await api.restoreLocalBackup(filename);
      setStorageInfo(res.storage);
      setStorageMessage({
        type: 'info',
        text: `Restored ${res.restoredCollections} JSON collections from ${filename}. Automatic safety backup saved as ${res.safetyBackup.filename}.`,
      });
      onDataChanged();
    } catch (err) {
      setStorageMessage({ type: 'error', text: err instanceof Error ? err.message : 'Restore failed.' });
    } finally {
      setStorageBusy(null);
    }
  };

  const handleExportPortable = () => {
    window.location.href = '/api/storage/export';
    setStorageMessage({
      type: 'info',
      text: 'Downloaded portable STRANGE v1.0 JSON archive. API credentials are never exported and remain protected separately.',
    });
  };

  const handleImportPortableFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStorageBusy('import');
    setStorageMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const res = await api.importPortableArchive(parsed);
      setStorageInfo(res.storage);
      setStorageMessage({
        type: 'info',
        text: `Imported and validated ${res.restoredCollections} collections from ${file.name}. Pre-import safety backup saved as ${res.safetyBackup.filename}.`,
      });
      onDataChanged();
    } catch (err) {
      setStorageMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not validate or restore JSON archive.',
      });
    } finally {
      setStorageBusy(null);
    }
  };

  const updateVoice = async (patch: Partial<VoiceSettings>) => {
    const next = { ...voiceSettings, ...patch };
    onVoiceSettingsChange(next);
    await api.saveSettings({
      voice_enabled: String(next.enabled),
      voice_rate: String(next.rate),
      voice_volume: String(next.volume),
      voice_lang: next.lang,
      voice_name: next.voiceName,
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="border-b border-slate-800/80 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Settings & Integrations</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure AI providers, local JSON backups and laptop migration, voice preferences, third-party integrations, and Windows desktop packaging.
        </p>
      </div>

      {savedToast && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-2.5 text-xs text-cyan-200">
          {savedToast}
        </div>
      )}

      {/* Local JSON Storage, Automatic Backups & Portable Migration (v1.0) */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Local JSON Storage, Automatic Backups & Migration (v1.0)
            </h2>
          </div>
          <span className="text-xs font-medium text-emerald-400">Zero Database Setup Required</span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          STRANGE v1.0 automatically creates and manages lightweight local JSON files with atomic temp-file writes, schema validation, and rotating local backups—no MySQL, PostgreSQL, MongoDB, Docker, or Supabase required for core operation. API credentials are stored separately in Windows secure storage (DPAPI) or server Secrets and are never included in JSON data files or portable exports.
        </p>

        {storageMessage && (
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs ${
              storageMessage.type === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200'
            }`}
          >
            {storageMessage.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={storageBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>{storageBusy === 'backup' ? 'Creating Backup...' : 'Create Backup Now'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportPortable}
            disabled={storageBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0A0E14] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 text-cyan-400" />
            <span>Export Portable Data (.json)</span>
          </button>

          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportPortableFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={storageBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0A0E14] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5 text-cyan-400" />
            <span>{storageBusy === 'import' ? 'Validating & Restoring...' : 'Import & Restore (.json)'}</span>
          </button>
        </div>

        {storageInfo && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 pt-1">
            {/* Managed JSON Files */}
            <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Managed Local JSON Files</span>
                <span className="font-mono text-slate-400 tabular-nums">
                  {(storageInfo.totalBytes / 1024).toFixed(1)} KB total
                </span>
              </div>
              <div className="mt-2.5 space-y-1.5 max-h-48 overflow-y-auto pr-1 text-xs">
                {storageInfo.files.map((f) => (
                  <div
                    key={f.filename}
                    className="flex items-center justify-between border-b border-slate-800/50 pb-1 last:border-0 tabular-nums"
                  >
                    <span className="font-mono text-slate-300">{f.filename}</span>
                    <span className="text-slate-400">
                      {f.recordCount} {f.collection === 'settings' ? 'keys' : 'items'} · {(f.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Automatic & Manual Local Backups */}
            <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Local Backup Snapshots ({storageInfo.backupCount})
                </span>
                <span className="text-slate-500">Auto-rotating (max 20)</span>
              </div>
              <div className="mt-2.5 space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
                {storageInfo.backups.length === 0 ? (
                  <p className="text-slate-500">No backups created yet.</p>
                ) : (
                  storageInfo.backups.map((b) => (
                    <div
                      key={b.filename}
                      className="flex items-center justify-between gap-2 border-b border-slate-800/50 pb-1.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[11px] text-slate-200">{b.filename}</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {new Date(b.createdAt).toLocaleString()} · {b.sizeKb} KB · {b.reason}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreLocalBackup(b.filename)}
                        disabled={storageBusy !== null}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:border-amber-500/40 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{storageBusy === b.filename ? 'Restoring...' : 'Restore'}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* AI Provider Configuration & 6-Point Diagnostics */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">AI Intelligence Providers & Connection Diagnostic</h2>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className={integrations.gemini.configured ? 'text-emerald-400' : 'text-amber-400'}>
              {integrations.gemini.configured
                ? integrations.gemini.credentialSource === 'local_env_file'
                  ? 'Gemini Key Active (Local .env)'
                  : 'Gemini Key Active (Server Secret)'
                : 'Gemini Key Unset'}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3.5 text-xs text-slate-300 space-y-1.5">
          <div className="font-semibold text-slate-100">Where to Configure Your Gemini API Key (Backend-Only Security)</div>
          <p className="text-slate-400 leading-relaxed">
            For security, API keys are never typed into browser forms, never sent to frontend JavaScript, and never saved in JSON backups.
          </p>
          <ul className="list-disc pl-4 space-y-1 text-slate-400">
            <li>
              <strong className="text-slate-200">On Windows Localhost:</strong> Double-click{' '}
              <code className="font-mono text-cyan-300">CONFIGURE-GEMINI-KEY.bat</code> in your STRANGE folder to save, update, or remove your key with masked input and user-only file permissions (reloads automatically without editing code).
            </li>
            <li>
              <strong className="text-slate-200">In Google AI Studio Preview:</strong> Add{' '}
              <code className="font-mono text-cyan-300">GEMINI_API_KEY</code> in <strong>Settings &gt; Secrets</strong>.
            </li>
            <li>
              <strong className="text-slate-200">In Packaged Windows Electron App:</strong> Stored encrypted via Windows DPAPI (<code className="font-mono text-slate-300">electron.safeStorage</code>).
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as GeminiModelId[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleSaveModel(m)}
              className={`rounded-lg border p-3.5 text-left transition-colors ${
                model === m
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-slate-100'
                  : 'border-slate-800 bg-[#0A0E14] text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium">{m}</span>
                {m === 'gemini-3.1-flash-lite' && (
                  <span className="text-[11px] font-medium text-emerald-400">Recommended Default</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {m === 'gemini-3.1-flash-lite'
                  ? 'Fast, reliable default for live chat, automation tools, web grounding, and low-RAM Windows laptops.'
                  : 'Higher-capacity model with automatic fallback to gemini-3.1-flash-lite if temporarily busy (503).'}
              </div>
            </button>
          ))}
        </div>

        {/* Configurable Active Model ID */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="custom-gemini-model" className="text-slate-400">
            Active Model ID:
          </label>
          <input
            id="custom-gemini-model"
            type="text"
            value={customModelInput}
            onChange={(e) => setCustomModelInput(e.target.value)}
            placeholder="e.g. gemini-3.1-flash-lite"
            className="w-60 rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleSaveModel(customModelInput)}
            className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-1.5 font-medium text-slate-200 hover:border-cyan-500/40"
          >
            Save Model
          </button>
          {modelError && <span className="text-red-400">{modelError}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRunDiagnostics}
            disabled={runningDiagnostics || testingGemini}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>{runningDiagnostics ? 'Running 6-Point Check...' : 'Run 6-Point AI Diagnostic'}</span>
          </button>
          <button
            type="button"
            onClick={handleTestGemini}
            disabled={testingGemini || runningDiagnostics}
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {testingGemini ? 'Verifying...' : 'Quick Live Ping'}
          </button>
          {geminiResult && <span className="text-xs text-slate-300">{geminiResult}</span>}
        </div>

        {diagnostics && (
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
              <div className="font-semibold text-slate-100">
                AI Connection Diagnostic —{' '}
                <span className={diagnostics.overallOk ? 'text-emerald-400' : 'text-red-400'}>
                  {diagnostics.overallOk ? 'All 6 Checks Operational' : 'Action Needed'}
                </span>
              </div>
              <div className="font-mono text-slate-400 tabular-nums">
                {diagnostics.activeModelUsed || diagnostics.configuredModel} · {diagnostics.latencyMs}ms
              </div>
            </div>
            <div className="space-y-1.5">
              {diagnostics.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="flex items-start gap-2.5 border-b border-slate-800/40 pb-1.5 last:border-0 last:pb-0"
                >
                  {chk.status === 'pass' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : chk.status === 'warn' ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  )}
                  <div className="min-w-0">
                    <span className="font-medium text-slate-200">{chk.label}: </span>
                    <span className="text-slate-400">{chk.details}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modular Secondary Provider: FreeModel.in */}
        <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-200">Secondary Provider Slot: FreeModel.in</span>
            <span className="text-amber-400 font-medium">Documentation Inspection Required</span>
          </div>
          <p className="mt-1.5 text-slate-400 leading-relaxed">{integrations.freemodel.note}</p>
        </div>
      </section>

      {/* Voice System Configuration */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">Voice Input & Text-to-Speech</h2>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={voiceSettings.enabled}
              onChange={(e) => updateVoice({ enabled: e.target.checked })}
            />
            <span>Auto-speak STRANGE replies</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">System Voice</label>
            <select
              value={voiceSettings.voiceName}
              onChange={(e) => updateVoice({ voiceName: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-200"
            >
              <option value="">System Default Voice</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Speech Recognition & Output Language</label>
            <select
              value={voiceSettings.lang}
              onChange={(e) => updateVoice({ lang: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-200"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-IN">English (India)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1 tabular-nums">
              Speech Speed: {voiceSettings.rate.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={voiceSettings.rate}
              onChange={(e) => updateVoice({ rate: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1 tabular-nums">
              Volume: {Math.round(voiceSettings.volume * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voiceSettings.volume}
              onChange={(e) => updateVoice({ volume: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => speakText('STRANGE voice synthesis is operational.', voiceSettings)}
            className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs text-slate-200 hover:border-cyan-500/40"
          >
            Test Voice Output
          </button>
          <button
            type="button"
            onClick={() => stopSpeaking()}
            className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Stop Speaking
          </button>
        </div>
      </section>

      {/* Third-Party Integrations Status */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">Optional External Integrations (For Built Products)</h2>
          </div>
          <span className="text-xs text-slate-500">Not required for STRANGE core</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
          {/* Whop */}
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">Whop</span>
              <span className={integrations.whop.configured ? 'text-emerald-400' : 'text-slate-500'}>
                {integrations.whop.configured ? 'Key Set' : 'Not Connected'}
              </span>
            </div>
            <p className="text-slate-400">
              Set <code className="font-mono text-slate-300">WHOP_API_KEY</code> in server Secrets to pull live sales, subscriptions, and product performance.
            </p>
            <button
              type="button"
              onClick={handleTestWhop}
              className="w-full rounded-md border border-slate-700 py-1.5 text-slate-200 hover:border-cyan-500/40"
            >
              Test Whop Connection
            </button>
            {whopResult && <div className="text-[11px] text-slate-300">{whopResult}</div>}
          </div>

          {/* Supabase */}
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">Supabase (Optional)</span>
              <span className={integrations.supabase.configured ? 'text-emerald-400' : 'text-slate-500'}>
                {integrations.supabase.configured ? 'Configured' : 'Not Connected'}
              </span>
            </div>
            <p className="text-slate-400">
              Optional external database for products you build. STRANGE itself runs entirely on local JSON files.
            </p>
            <button
              type="button"
              onClick={handleTestSupabase}
              className="w-full rounded-md border border-slate-700 py-1.5 text-slate-200 hover:border-cyan-500/40"
            >
              Test Supabase Connection
            </button>
            {supabaseResult && <div className="text-[11px] text-slate-300">{supabaseResult}</div>}
          </div>

          {/* Vercel */}
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">Vercel</span>
              <span className={integrations.vercel.configured ? 'text-emerald-400' : 'text-slate-500'}>
                {integrations.vercel.configured ? 'Token Set' : 'Not Connected'}
              </span>
            </div>
            <p className="text-slate-400">
              Set <code className="font-mono text-slate-300">VERCEL_TOKEN</code> in server Secrets to inspect projects and deployment health.
            </p>
            <button
              type="button"
              onClick={handleTestVercel}
              className="w-full rounded-md border border-slate-700 py-1.5 text-slate-200 hover:border-cyan-500/40"
            >
              Test Vercel Connection
            </button>
            {vercelResult && <div className="text-[11px] text-slate-300">{vercelResult}</div>}
          </div>
        </div>
      </section>

      {/* Runtime & Windows 10 Packaging Readiness */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3 text-xs">
        <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
          <HardDrive className="h-4 w-4 text-cyan-400" />
          <h2 className="text-base font-semibold text-slate-100">Hardware & Windows 10 Electron Packaging</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 tabular-nums">
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3">
            <div className="text-slate-400">Node Runtime</div>
            <div className="mt-1 font-mono text-slate-100">{integrations.runtime.nodeVersion}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3">
            <div className="text-slate-400">Storage Engine</div>
            <div className="mt-1 font-mono text-emerald-400">Local JSON v1.0</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3">
            <div className="text-slate-400">Server RSS RAM</div>
            <div className="mt-1 font-mono text-slate-100">{integrations.runtime.memoryUsageMb} MB</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3">
            <div className="text-slate-400">Electron Shell</div>
            <div className="mt-1 font-mono text-slate-100">
              {integrations.runtime.electronDetected ? 'Desktop Active' : 'Web Preview Mode'}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#0A0E14] p-3.5 text-slate-300">
          {integrations.runtime.electronDetected ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          )}
          <div className="space-y-1">
            <div className="font-medium text-slate-100">
              Independent Windows 10 Installer Ready (<code className="font-mono">electron/main.cjs</code>,{' '}
              <code className="font-mono">electron/preload.cjs</code>,{' '}
              <code className="font-mono">electron/electron-builder.yml</code>)
            </div>
            <p className="text-slate-400 leading-relaxed">
              Because v1.0 uses pure local JSON files with no native database bindings, packaging on Windows 10 requires zero database or C++ setup. Run <code className="font-mono">npm run electron:build:win</code> on Windows 10 (see <code className="font-mono">WINDOWS_BUILD_GUIDE.md</code>) and transfer data between laptops using Export/Import above.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-500">
          <Shield className="h-3.5 w-3.5" />
          <span>Local JSON Store Path: {integrations.runtime.storagePath}</span>
        </div>
      </section>
    </div>
  );
}
