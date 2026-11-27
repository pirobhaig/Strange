import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Database,
  Download,
  ExternalLink,
  FolderGit2,
  Play,
  Rocket,
  Save,
  ShieldCheck,
  TestTube2,
} from 'lucide-react';
import type { ProjectRecord, WorkspaceSection } from '../types';
import { api } from '../lib/api';
import { exportProductHandoverPdf } from '../lib/pdf';

interface Props {
  onNavigate: (section: WorkspaceSection) => void;
  onDataChanged: () => void;
}

type ProjectTab = 'prd' | 'files' | 'tests' | 'handover';

export function ProjectsView({ onNavigate, onDataChanged }: Props) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ProjectTab>('prd');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>('index.html');
  const [editorContent, setEditorContent] = useState<string>('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Supabase SQL Migration generator state
  const [schemaPrompt, setSchemaPrompt] = useState('');
  const [migrationSql, setMigrationSql] = useState<{ upSql: string; downSql: string; notes: string } | null>(null);

  const loadProjects = async () => {
    const { projects: list } = await api.listProjects();
    setProjects(list);
    if (!selectedId && list[0]) {
      setSelectedId(list[0].id);
    }
  };

  useEffect(() => {
    loadProjects().catch((e) => setStatusMessage(e instanceof Error ? e.message : 'Failed to load projects'));
  }, []);

  const selected = projects.find((p) => p.id === selectedId) || null;

  useEffect(() => {
    if (!selected) return;
    api
      .getProjectFiles(selected.id)
      .then(({ files: map }) => {
        setFiles(map);
        const firstKey = Object.keys(map)[0] || 'index.html';
        setActiveFile(firstKey);
        setEditorContent(map[firstKey] || '');
      })
      .catch(() => {
        setFiles({});
        setEditorContent('');
      });
  }, [selected?.id, selected?.updatedAt]);

  const handleBuildWorkspace = async () => {
    if (!selected) return;
    setBusyAction('build');
    setStatusMessage('Stage B: Generating isolated workspace files and local preview...');
    try {
      const res = await api.buildProject(selected.id);
      setFiles(res.files);
      const firstKey = Object.keys(res.files)[0] || 'index.html';
      setActiveFile(firstKey);
      setEditorContent(res.files[firstKey] || '');
      setActiveTab('files');
      setStatusMessage(`Isolated workspace built cleanly. Live preview active at ${res.project.previewUrl}.`);
      await loadProjects();
      onDataChanged();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Workspace build failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunTests = async () => {
    if (!selected) return;
    setBusyAction('test');
    setStatusMessage('Stage C: Running Pass 1 (Syntax & Unit Tests), Pass 2 (HTTP Integration), and Pass 3 (DOM & Playwright Audit)...');
    try {
      await api.testProject(selected.id);
      setActiveTab('tests');
      setStatusMessage('All 3 testing passes executed and recorded truthfully.');
      await loadProjects();
      onDataChanged();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Test run failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveFile = async () => {
    if (!selected || !activeFile) return;
    setBusyAction('save_file');
    try {
      const res = await api.saveProjectFile(selected.id, activeFile, editorContent);
      setFiles(res.files);
      setStatusMessage(`Saved ${activeFile} (automatic backup created before write).`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setBusyAction(null);
    }
  };

  const handleApproveMarketing = async () => {
    if (!selected) return;
    setBusyAction('approve_marketing');
    try {
      await api.approveProjectMarketing(selected.id);
      setStatusMessage(`Product "${selected.name}" approved. Influencer & Discord outreach is now unlocked in Research Centre.`);
      await loadProjects();
      onDataChanged();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleQueueVercelDeploy = async () => {
    if (!selected) return;
    setBusyAction('vercel');
    try {
      await api.createApproval({
        category: 'vercel_deploy',
        title: `Deploy to Vercel: ${selected.name}`,
        target: `${selected.name} (${selected.folderPath})`,
        proposedAction: `Deploy verified build artifacts from isolated workspace "${selected.slug}" to Vercel production.`,
        consequences:
          'Makes the application publicly reachable on Vercel. Requires VERCEL_TOKEN configured on the server and post-deployment URL verification.',
        payload: { projectId: selected.id, slug: selected.slug },
      });
      setStatusMessage('Deployment approval queued. Review and confirm in Automation Centre before deploying.');
      onDataChanged();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Could not queue deployment approval');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateMigration = async () => {
    if (!selected || !schemaPrompt.trim()) return;
    setBusyAction('migration');
    try {
      const sql = await api.generateSupabaseMigration(selected.name, schemaPrompt.trim());
      setMigrationSql(sql);
      setStatusMessage('Generated reversible UP/DOWN Supabase SQL migration with Row Level Security.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Migration generation failed');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">My Projects</h1>
          <p className="mt-1 text-sm text-slate-400">
            End-to-end engineering workspaces: Stage A (PRD) · Stage B (Isolated Build) · Stage C (3-Pass Testing) · Stage D (PDF Handover & Approval).
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('research')}
          className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 whitespace-nowrap shrink-0"
        >
          Discover New Opportunity
        </button>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-200">
          {statusMessage}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-10 text-center">
          <FolderGit2 className="mx-auto h-8 w-8 text-slate-600" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">No projects created yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            STRANGE never starts building a product before you review opportunities and select which one to build first.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('research')}
            className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Run Business Discovery Engine
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Project List */}
          <div className="lg:col-span-3 space-y-2">
            {projects.map((p) => {
              const active = p.id === selected?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-cyan-500/50 bg-[#111924] text-slate-100'
                      : 'border-slate-800/80 bg-[#0D1117] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{p.status.replace(/_/g, ' ')}</span>
                    <span aria-hidden="true">·</span>
                    <span className={p.healthStatus === 'healthy' ? 'text-emerald-400' : 'text-slate-400'}>
                      {p.healthStatus}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Project Workspace */}
          {selected && (
            <div className="lg:col-span-9 space-y-5">
              {/* Project Action Header */}
              <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">{selected.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono">{selected.slug}</span>
                      <span aria-hidden="true">·</span>
                      <span>Stage: {selected.status.replace(/_/g, ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selected.userApprovedForMarketing ? 'Marketing unlocked' : 'Marketing locked until approved'}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBuildWorkspace}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{busyAction === 'build' ? 'Building...' : 'Stage B: Build Workspace'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRunTests}
                      disabled={busyAction !== null || Object.keys(files).length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0A0E14] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 disabled:opacity-40 whitespace-nowrap"
                    >
                      <TestTube2 className="h-3.5 w-3.5 text-cyan-400" />
                      <span>{busyAction === 'test' ? 'Testing...' : 'Stage C: Run 3-Pass Tests'}</span>
                    </button>
                    {selected.previewUrl && (
                      <a
                        href={selected.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-cyan-300 hover:border-cyan-500/40 whitespace-nowrap"
                      >
                        <span>Open Live Preview</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Stage Tabs */}
                <div className="mt-5 flex flex-wrap items-center gap-1 rounded-lg bg-[#080B10] p-1 border border-slate-800/80 w-fit">
                  {(
                    [
                      ['prd', 'Stage A: PRD'],
                      ['files', `Stage B: Workspace Files (${Object.keys(files).length})`],
                      ['tests', `Stage C: 3-Pass Tests (${selected.testResults.length})`],
                      ['handover', 'Stage D: Handover & Deploy'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveTab(key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeTab === key
                          ? 'bg-[#16202C] text-cyan-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab 1: PRD */}
              {activeTab === 'prd' && selected.prd && (
                <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-6 space-y-5 text-sm">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">Executive Summary</h3>
                    <p className="mt-1.5 text-slate-300 leading-relaxed">{selected.prd.executiveSummary}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Name suggestions: {selected.prd.productNames.join(' · ')}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 border-t border-slate-800/80 pt-5">
                    <div>
                      <h4 className="text-xs font-semibold text-cyan-400">User Personas</h4>
                      <div className="mt-2 space-y-2.5">
                        {selected.prd.userPersonas.map((per, i) => (
                          <div key={i} className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3 text-xs">
                            <div className="font-medium text-slate-100">
                              {per.name} — {per.role}
                            </div>
                            <div className="mt-1 text-slate-400">Pain: {per.painPoint}</div>
                            <div className="mt-0.5 text-slate-300">Goal: {per.goal}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-cyan-400">Core Feature Scope</h4>
                      <div className="mt-2 space-y-2">
                        {selected.prd.featureList.map((f, i) => (
                          <div key={i} className="border-b border-slate-800/60 pb-2 text-xs last:border-0">
                            <div className="font-medium text-slate-100">
                              {f.name} · <span className="text-slate-400">{f.priority}</span>
                            </div>
                            <div className="mt-0.5 text-slate-400">{f.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 border-t border-slate-800/80 pt-5 text-xs">
                    <div>
                      <h4 className="font-semibold text-slate-200">Technical Architecture</h4>
                      <p className="mt-1 text-slate-400 leading-relaxed">{selected.prd.technicalArchitecture}</p>
                      <h4 className="mt-4 font-semibold text-slate-200">Database Design</h4>
                      <p className="mt-1 text-slate-400 leading-relaxed">{selected.prd.databaseDesign}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-200">Competitor Analysis & UX Plan</h4>
                      <p className="mt-1 text-slate-400 leading-relaxed">{selected.prd.competitorAnalysis}</p>
                      <p className="mt-2 text-slate-400 leading-relaxed">{selected.prd.uxPlan}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Isolated Workspace Source Files */}
              {activeTab === 'files' && (
                <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
                  {Object.keys(files).length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Workspace has not been generated yet. Click <strong>Stage B: Build Workspace</strong> above to generate runnable source code.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {Object.keys(files).map((fileName) => (
                            <button
                              key={fileName}
                              type="button"
                              onClick={() => {
                                setActiveFile(fileName);
                                setEditorContent(files[fileName] || '');
                              }}
                              className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                                activeFile === fileName
                                  ? 'bg-[#16202C] text-cyan-300'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {fileName}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={handleSaveFile}
                          disabled={busyAction === 'save_file' || activeFile === 'package.json'}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span>Save File (Auto-Backup)</span>
                        </button>
                      </div>
                      <textarea
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        rows={18}
                        spellCheck={false}
                        className="w-full rounded-lg border border-slate-800 bg-[#07090D] p-4 font-mono text-xs leading-relaxed text-slate-200 focus:border-cyan-500/50 focus:outline-none"
                      />
                    </>
                  )}
                </div>
              )}

              {/* Tab 3: Honest 3-Pass Testing Results */}
              {activeTab === 'tests' && (
                <div className="space-y-4">
                  {selected.testResults.length === 0 ? (
                    <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-8 text-center text-xs text-slate-400">
                      No test passes executed yet. Build the workspace first, then run Stage C: 3-Pass Tests.
                    </div>
                  ) : (
                    selected.testResults.map((pass) => (
                      <div key={pass.passNumber} className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                          <h3 className="text-sm font-semibold text-slate-100">{pass.name}</h3>
                          <span
                            className={`text-xs font-semibold ${
                              pass.status === 'passed'
                                ? 'text-emerald-400'
                                : pass.status === 'failed'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                            }`}
                          >
                            {pass.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-300">{pass.summary}</p>
                        <div className="mt-3 space-y-2">
                          {pass.checks.map((chk, idx) => (
                            <div
                              key={idx}
                              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800/70 bg-[#0A0E14] px-3 py-2 text-xs"
                            >
                              <div className="font-medium text-slate-200">{chk.name}</div>
                              <div
                                className={`font-mono text-[11px] ${
                                  chk.status === 'passed'
                                    ? 'text-emerald-400'
                                    : chk.status === 'failed'
                                      ? 'text-red-400'
                                      : 'text-amber-400'
                                }`}
                              >
                                {chk.status.toUpperCase()}
                              </div>
                              <div className="w-full font-mono text-[11px] text-slate-400">{chk.details}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 4: Stage D Handover, PDF, Supabase Migration & Vercel Approval */}
              {activeTab === 'handover' && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
                    <h3 className="text-base font-semibold text-slate-100">Stage D: Product Handover & Release Gate</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Download the complete PDF Product Handover & Testing Guide, verify the preview, and explicitly approve the product before starting influencer or Discord marketing.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => exportProductHandoverPdf(selected)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0A0E14] px-4 py-2 text-xs font-medium text-slate-100 hover:border-cyan-500/40"
                      >
                        <Download className="h-4 w-4 text-cyan-400" />
                        <span>Download PDF Handover Guide</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleQueueVercelDeploy}
                        disabled={busyAction === 'vercel'}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0A0E14] px-4 py-2 text-xs font-medium text-slate-100 hover:border-cyan-500/40"
                      >
                        <Rocket className="h-4 w-4 text-cyan-400" />
                        <span>Request Vercel Deployment Approval</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleApproveMarketing}
                        disabled={selected.userApprovedForMarketing || busyAction === 'approve_marketing'}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {selected.userApprovedForMarketing ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Approved — Marketing Unlocked</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-4 w-4" />
                            <span>Approve Product & Unlock Marketing</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Reversible Supabase SQL Migration Generator */}
                  <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-cyan-400" />
                      <h3 className="text-sm font-semibold text-slate-100">
                        Supabase Reversible Migration & RLS Generator
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400">
                      Generate reversible UP/DOWN PostgreSQL migrations with Row Level Security policies. Destructive production queries are never run automatically.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={schemaPrompt}
                        onChange={(e) => setSchemaPrompt(e.target.value)}
                        placeholder="Describe tables & relationships (e.g., users_profiles, subscriptions, workspace_items)"
                        className="flex-1 rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100 placeholder-slate-500"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateMigration}
                        disabled={busyAction === 'migration' || !schemaPrompt.trim()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40 whitespace-nowrap"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        <span>{busyAction === 'migration' ? 'Generating SQL...' : 'Generate Migration SQL'}</span>
                      </button>
                    </div>

                    {migrationSql && (
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-medium text-emerald-400">UP Migration (with RLS)</div>
                          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-[#07090D] p-3 font-mono text-[11px] text-slate-200">
                            {migrationSql.upSql}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-amber-400">DOWN Rollback SQL</div>
                          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-[#07090D] p-3 font-mono text-[11px] text-slate-200">
                            {migrationSql.downSql}
                          </pre>
                        </div>
                        <p className="md:col-span-2 text-xs text-slate-400">{migrationSql.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
