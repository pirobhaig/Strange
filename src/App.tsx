import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  LayoutDashboard,
  FolderKanban,
  Compass,
  Workflow,
  Presentation,
  History,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import type { CrmMetrics, IntegrationStatus, WorkspaceSection } from './types';
import { api } from './lib/api';
import type { VoiceSettings } from './lib/voice';
import { OnboardingModal } from './components/OnboardingModal';
import { AssistantView } from './components/AssistantView';
import { CrmDashboardView } from './components/CrmDashboardView';
import { ProjectsView } from './components/ProjectsView';
import { ResearchCentreView } from './components/ResearchCentreView';
import { AutomationCentreView } from './components/AutomationCentreView';
import { PresentationsView } from './components/PresentationsView';
import { ActivityHistoryView } from './components/ActivityHistoryView';
import { SettingsView } from './components/SettingsView';

const NAV_ITEMS: Array<{
  id: WorkspaceSection;
  label: string;
  subtitle: string;
  icon: typeof Bot;
}> = [
  { id: 'assistant', label: 'STRANGE', subtitle: 'AI Assistant', icon: Bot },
  { id: 'crm', label: 'CRM / Dashboard', subtitle: 'Metrics & Health', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', subtitle: 'Build & 3-Pass QA', icon: FolderKanban },
  { id: 'research', label: 'Research Centre', subtitle: 'Discovery & Outreach', icon: Compass },
  { id: 'automation', label: 'Automation Centre', subtitle: 'Approvals & Cron', icon: Workflow },
  { id: 'presentations', label: 'Presentations', subtitle: 'Decks & PDF', icon: Presentation },
  { id: 'history', label: 'Activity History', subtitle: 'Audit Ledger', icon: History },
  { id: 'settings', label: 'Settings', subtitle: 'Providers & Voice', icon: Settings },
];

export default function App() {
  const [section, setSection] = useState<WorkspaceSection>('assistant');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [metrics, setMetrics] = useState<CrmMetrics | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    enabled: false,
    rate: 1.0,
    volume: 1.0,
    lang: 'en-US',
    voiceName: '',
  });

  const refreshSystemStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setIntegrations(data.integrations);
      setMetrics(data.metrics);
      setShowOnboarding(data.settings.onboarding_completed !== 'true');
      setVoiceSettings({
        enabled: data.settings.voice_enabled === 'true',
        rate: Number(data.settings.voice_rate || 1.0),
        volume: Number(data.settings.voice_volume ?? 1.0),
        lang: data.settings.voice_lang || 'en-US',
        voiceName: data.settings.voice_name || '',
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to reach local STRANGE backend.');
    }
  }, []);

  useEffect(() => {
    refreshSystemStatus();
  }, [refreshSystemStatus]);

  const activeNav = NAV_ITEMS.find((n) => n.id === section) || NAV_ITEMS[0];
  const pendingApprovals = metrics?.pendingApprovals ?? 0;

  return (
    <div className="flex min-h-screen bg-[#07090D] text-[#E6EDF3]">
      {/* Permanent Left Sidebar (Desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-[#0A0E14] md:flex">
        <div className="flex h-14 items-center gap-3 border-b border-slate-800/80 px-5">
          {/* Custom Geometric STRANGE Insignia */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <polygon
              points="12,2 21,7 21,17 12,22 3,17 3,7"
              stroke="#22D3EE"
              strokeWidth="1.6"
              fill="rgba(6, 182, 212, 0.08)"
            />
            <circle cx="12" cy="12" r="3" fill="#22D3EE" />
          </svg>
          <span
            className="text-base font-bold tracking-[0.14em] text-slate-100 whitespace-nowrap"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            STRANGE
          </span>
        </div>

        <nav aria-label="Primary Navigation" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'bg-[#121B26] text-cyan-300'
                    : 'text-slate-400 hover:bg-[#10151E] hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span className="truncate text-sm font-medium">{item.label}</span>
                </span>
                {item.id === 'automation' && pendingApprovals > 0 && (
                  <span className="font-mono text-xs font-semibold text-amber-400 tabular-nums">
                    {pendingApprovals}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Honest Runtime Footer (Real Data Only) */}
        <div className="border-t border-slate-800/80 px-5 py-3.5 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span>Gemini API</span>
            <span className={integrations?.gemini.configured ? 'text-emerald-400' : 'text-amber-400'}>
              {integrations?.gemini.configured ? 'Ready' : 'Key Unset'}
            </span>
          </div>
          {integrations && (
            <div className="mt-1 flex items-center justify-between tabular-nums">
              <span>Local RSS RAM</span>
              <span className="font-mono text-slate-400">{integrations.runtime.memoryUsageMb} MB</span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex w-64 flex-col border-r border-slate-800 bg-[#0A0E14]">
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-5">
              <span className="text-base font-bold tracking-[0.14em] text-slate-100">STRANGE</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active ? 'bg-[#121B26] text-cyan-300' : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-800/80 bg-[#07090D]/95 px-5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-100 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500">STRANGE</span>
              <span className="text-slate-600">/</span>
              <span className="font-semibold text-slate-100 truncate">{activeNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {pendingApprovals > 0 && section !== 'automation' && (
              <button
                type="button"
                onClick={() => setSection('automation')}
                className="text-xs font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
              >
                {pendingApprovals} Pending Approval{pendingApprovals > 1 ? 's' : ''}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSection(section === 'research' ? 'projects' : 'research')}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 whitespace-nowrap shrink-0 transition-colors"
            >
              {section === 'research' ? 'My Projects' : 'New Discovery'}
            </button>
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="flex-1 overflow-y-auto">
          {loadError ? (
            <div className="mx-auto max-w-xl p-8 text-center">
              <p className="text-sm text-red-300">{loadError}</p>
              <button
                type="button"
                onClick={refreshSystemStatus}
                className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950"
              >
                Retry Connection
              </button>
            </div>
          ) : !integrations ? (
            <div className="p-8 text-xs text-slate-500">Loading STRANGE local workspace...</div>
          ) : (
            <>
              {section === 'assistant' && (
                <AssistantView
                  integrations={integrations}
                  voiceSettings={voiceSettings}
                  pendingApprovalCount={pendingApprovals}
                  onNavigate={setSection}
                  onDataChanged={refreshSystemStatus}
                />
              )}
              {section === 'crm' && (
                <CrmDashboardView onNavigate={setSection} onDataChanged={refreshSystemStatus} />
              )}
              {section === 'projects' && (
                <ProjectsView onNavigate={setSection} onDataChanged={refreshSystemStatus} />
              )}
              {section === 'research' && (
                <ResearchCentreView
                  integrations={integrations}
                  onNavigate={setSection}
                  onDataChanged={refreshSystemStatus}
                />
              )}
              {section === 'automation' && (
                <AutomationCentreView onDataChanged={refreshSystemStatus} />
              )}
              {section === 'presentations' && (
                <PresentationsView onDataChanged={refreshSystemStatus} />
              )}
              {section === 'history' && <ActivityHistoryView />}
              {section === 'settings' && (
                <SettingsView
                  integrations={integrations}
                  voiceSettings={voiceSettings}
                  onVoiceSettingsChange={setVoiceSettings}
                  onDataChanged={refreshSystemStatus}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* First-Run Onboarding Setup Modal */}
      {showOnboarding && integrations && (
        <OnboardingModal
          integrations={integrations}
          onComplete={() => {
            setShowOnboarding(false);
            refreshSystemStatus();
          }}
        />
      )}
    </div>
  );
}
