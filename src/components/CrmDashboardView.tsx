import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  Wrench,
  ExternalLink,
  Plus,
} from 'lucide-react';
import type {
  ActivityLog,
  ApprovalItem,
  CrmMetrics,
  ErrorReport,
  ProjectRecord,
  WhopAnalytics,
  WorkspaceSection,
} from '../types';
import { api } from '../lib/api';

interface Props {
  onNavigate: (section: WorkspaceSection) => void;
  onDataChanged: () => void;
}

export function CrmDashboardView({ onNavigate, onDataChanged }: Props) {
  const [metrics, setMetrics] = useState<CrmMetrics | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [errors, setErrors] = useState<ErrorReport[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [whop, setWhop] = useState<WhopAnalytics | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Inline Error Report form state
  const [errorFormProjectId, setErrorFormProjectId] = useState('');
  const [errorComponent, setErrorComponent] = useState('app.js');
  const [errorMessage, setErrorMessage] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [summary, whopData] = await Promise.all([api.getCrmSummary(), api.getWhopAnalytics()]);
      setMetrics(summary.metrics);
      setProjects(summary.projects);
      setApprovals(summary.approvals);
      setErrors(summary.errors);
      setActivity(summary.activity);
      setWhop(whopData);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to load CRM summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleHealthCheck = async (projectId: string) => {
    setBusyId(projectId);
    setFeedback(null);
    try {
      const res = await api.checkProjectHealth(projectId);
      setFeedback(
        res.check.ok
          ? `Health check passed (HTTP ${res.check.statusCode}) at ${res.check.target}`
          : `Health check failed: ${res.check.error || `HTTP ${res.check.statusCode}`}`
      );
      await loadAll();
      onDataChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleLogError = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!errorFormProjectId || !errorMessage.trim()) return;
    setBusyId('log_err');
    try {
      await api.logProjectError(errorFormProjectId, errorComponent.trim() || 'runtime', errorMessage.trim());
      setErrorMessage('');
      setErrorFormProjectId('');
      setFeedback('Error logged in CRM. Click "Diagnose & Prepare Repair" to generate a backed-up fix.');
      await loadAll();
      onDataChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not log error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDiagnoseError = async (errorId: string) => {
    setBusyId(errorId);
    setFeedback(null);
    try {
      await api.diagnoseError(errorId);
      setFeedback('Root-cause diagnosis complete, workspace backed up, and reversible repair queued in Approval Queue.');
      await loadAll();
      onDataChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Diagnosis failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleRollback = async (errorId: string) => {
    setBusyId(errorId);
    try {
      await api.rollbackError(errorId);
      setFeedback('Workspace restored from pre-repair backup.');
      await loadAll();
      onDataChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setBusyId(null);
    }
  };

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">CRM & Business Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time operational metrics from automatic local JSON storage and verified integrations. Disconnected sources remain explicitly unavailable.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1117] px-4 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap shrink-0 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Live Data</span>
        </button>
      </div>

      {feedback && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-200">
          {feedback}
        </div>
      )}

      {/* Real KPI Strip */}
      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {[
            { label: 'Total Projects', value: metrics?.totalProjects ?? 0, sub: `${metrics?.activeProjects ?? 0} active` },
            { label: 'Completed / Approved', value: metrics?.completedProjects ?? 0, sub: `${metrics?.deployedApps ?? 0} deployed` },
            {
              label: 'Apps Reporting Errors',
              value: metrics?.appsWithErrors ?? 0,
              sub: metrics?.appsWithErrors ? 'Requires diagnosis' : 'All monitored nominal',
              alert: (metrics?.appsWithErrors ?? 0) > 0,
            },
            {
              label: 'Pending Approvals',
              value: metrics?.pendingApprovals ?? 0,
              sub: 'Human gate active',
              alert: (metrics?.pendingApprovals ?? 0) > 0,
            },
            {
              label: 'Outreach Verified',
              value: `${metrics?.outreachSent ?? 0}/${metrics?.outreachTotal ?? 0}`,
              sub: `${metrics?.presentationsCreated ?? 0} presentations`,
            },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-4">
              <div className="text-xs text-slate-400">{kpi.label}</div>
              <div
                className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
                  kpi.alert ? 'text-amber-400' : 'text-slate-100'
                }`}
              >
                {kpi.value}
              </div>
              <div className="mt-1 text-xs text-slate-500">{kpi.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Whop Business Analytics (Strictly Real or Explicitly Unavailable) */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Whop Sales & Subscription Analytics</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
              <span>Period: {whop?.reportingPeriod || 'Loading...'}</span>
              <span aria-hidden="true">·</span>
              <span>
                Last refresh: {whop?.lastRefreshedAt ? new Date(whop.lastRefreshedAt).toLocaleString() : 'Not refreshed'}
              </span>
            </div>
          </div>
          <span className={`text-xs font-medium ${whop?.connected ? 'text-emerald-400' : 'text-slate-400'}`}>
            {whop?.connected ? 'Whop API Connected' : 'Whop Disconnected'}
          </span>
        </div>

        {!whop?.connected ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
            <div className="text-xs text-slate-400 max-w-2xl">
              <span className="font-medium text-slate-200">Data Unavailable: </span>
              {whop?.error || 'Whop integration is not connected. No placeholder sales figures are shown.'}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap shrink-0"
            >
              Inspect Whop Setup
            </button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Revenue (USD)', value: `$${whop.metrics.revenueUsd?.toFixed(2) ?? '0.00'}` },
              { label: 'Paid Sales', value: whop.metrics.totalSales ?? 0 },
              { label: 'Transactions', value: whop.metrics.transactions ?? 0 },
              { label: 'Active Subscriptions', value: whop.metrics.activeSubscriptions ?? 0 },
              { label: 'Cancellations', value: whop.metrics.cancellations ?? 0 },
              { label: 'Refunds', value: whop.metrics.refunds ?? 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3">
                <div className="text-xs text-slate-400">{item.label}</div>
                <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100 tabular-nums">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Application Monitoring Table */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0D1117]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Application Monitoring</h2>
            <p className="text-xs text-slate-400">
              Lightweight HTTP health checks, deployment status, database status, and error tracking across registered workspaces.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('projects')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap shrink-0"
          >
            Open My Projects
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-400">No applications registered yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Discover a business opportunity in Research Centre and select a product to create your first monitored project.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('research')}
              className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
            >
              Go to Research Centre
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="px-5 py-3 font-medium">Product & Workspace</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Health & Last Check</th>
                  <th className="px-4 py-3 font-medium">Database</th>
                  <th className="px-4 py-3 font-medium">URL</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {projects.map((p) => (
                  <tr key={p.id} className="hover:bg-[#111722] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-100">{p.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500 truncate max-w-xs">
                        {p.folderPath}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      <div>{p.status.replace(/_/g, ' ')}</div>
                      <div className="text-[11px] text-slate-500">Deploy: {p.deploymentStatus.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">
                      <div
                        className={
                          p.healthStatus === 'healthy'
                            ? 'font-medium text-emerald-400'
                            : p.healthStatus === 'error'
                              ? 'font-medium text-red-400'
                              : 'text-slate-400'
                        }
                      >
                        {p.healthStatus}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.lastHealthCheck ? new Date(p.lastHealthCheck).toLocaleTimeString() : 'Never checked'}
                      </div>
                      {p.recentErrors && (
                        <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-300">{p.recentErrors}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{p.dbStatus.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3.5">
                      {p.liveUrl || p.previewUrl ? (
                        <a
                          href={p.liveUrl || p.previewUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                        >
                          <span>{p.liveUrl ? 'Live' : 'Preview'}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500">Not built</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleHealthCheck(p.id)}
                          disabled={busyId === p.id}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-cyan-500/40 whitespace-nowrap"
                        >
                          <Activity className="h-3 w-3 text-cyan-400" />
                          <span>Check</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setErrorFormProjectId(p.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-amber-500/40 whitespace-nowrap"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Log Error</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Error Diagnosis & Reversible Repair */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Error Diagnosis & Reversible Repair</h2>
              <p className="text-xs text-slate-400">
                Inspects workspace source files, creates timestamped backups, diagnoses root cause, queues approval, and supports one-click rollback.
              </p>
            </div>
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          </div>

          {errorFormProjectId && (
            <form onSubmit={handleLogError} className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
              <div className="text-xs font-medium text-slate-200">
                Record Runtime or Build Error for Diagnosis
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  value={errorComponent}
                  onChange={(e) => setErrorComponent(e.target.value)}
                  placeholder="Affected file/component (e.g. app.js)"
                  className="rounded-lg border border-slate-700 bg-[#0D1117] px-3 py-2 text-xs text-slate-100"
                />
                <input
                  type="text"
                  value={errorMessage}
                  onChange={(e) => setErrorMessage(e.target.value)}
                  placeholder="Exact error stack or symptom"
                  className="sm:col-span-2 rounded-lg border border-slate-700 bg-[#0D1117] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setErrorFormProjectId('')}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === 'log_err'}
                  className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Save Error Report
                </button>
              </div>
            </form>
          )}

          <div className="mt-4 space-y-3">
            {errors.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No application error reports recorded.
              </p>
            ) : (
              errors.map((err) => (
                <div key={err.id} className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">
                      {err.projectName} · <span className="font-mono text-slate-400">{err.component}</span>
                    </div>
                    <span className="font-medium text-amber-400">{err.status}</span>
                  </div>
                  <p className="mt-1.5 font-mono text-red-300">{err.errorMessage}</p>
                  {err.diagnosis && (
                    <div className="mt-2.5 border-t border-slate-800/80 pt-2.5 text-slate-300">
                      <span className="font-medium text-cyan-400">Diagnosis: </span>
                      {err.diagnosis}
                      {err.proposedFixSummary && (
                        <div className="mt-1 text-slate-400">
                          Proposed repair ({err.proposedFixFile}): {err.proposedFixSummary}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {err.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => handleDiagnoseError(err.id)}
                        disabled={busyId === err.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 border border-cyan-500/40 px-3 py-1.5 font-medium text-cyan-300 hover:bg-cyan-500/25"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        <span>{busyId === err.id ? 'Diagnosing...' : 'Diagnose, Back Up & Queue Repair'}</span>
                      </button>
                    )}
                    {err.backupPath && (
                      <button
                        type="button"
                        onClick={() => handleRollback(err.id)}
                        disabled={busyId === err.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-amber-500/40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Roll Back Backup</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity & Pending Approvals Sidebar */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="text-base font-semibold text-slate-100">Recent Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              View all
            </button>
          </div>
          {pendingApprovals.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <div className="font-medium text-amber-300">
                {pendingApprovals.length} pending approval{pendingApprovals.length > 1 ? 's' : ''}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('automation')}
                className="mt-1 text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                Review in Approval Queue
              </button>
            </div>
          )}
          <div className="mt-3 space-y-3 max-h-80 overflow-y-auto pr-1">
            {activity.length === 0 ? (
              <p className="text-xs text-slate-500">No logged activity yet.</p>
            ) : (
              activity.slice(0, 10).map((log) => (
                <div key={log.id} className="border-b border-slate-800/60 pb-2.5 last:border-0 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{log.action}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-400 line-clamp-2">{log.details}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
