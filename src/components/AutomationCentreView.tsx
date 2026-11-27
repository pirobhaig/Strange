import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { ApprovalItem, AutomationTask } from '../types';
import { api } from '../lib/api';

interface Props {
  onDataChanged: () => void;
}

export function AutomationCentreView({ onDataChanged }: Props) {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [automations, setAutomations] = useState<AutomationTask[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Create automation form
  const [name, setName] = useState('');
  const [taskType, setTaskType] = useState<AutomationTask['taskType']>('health_check');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [approvedByUser, setApprovedByUser] = useState(true);

  // Queue Whop Change Approval helper form
  const [whopTarget, setWhopTarget] = useState('');
  const [whopProposal, setWhopProposal] = useState('');

  const loadAll = async () => {
    const [aRes, tRes] = await Promise.all([api.listApprovals(), api.listAutomations()]);
    setApprovals(aRes.approvals);
    setAutomations(tRes.automations);
  };

  useEffect(() => {
    loadAll().catch((e) => setBanner(e instanceof Error ? e.message : 'Failed to load automation centre'));
  }, []);

  const handleDecision = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id);
    setBanner(null);
    try {
      const res = await api.decideApproval(id, decision);
      setBanner(res.approval.executionResult || `Approval ${decision}d.`);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleRunWeeklyMaintenance = async () => {
    setBusyId('weekly');
    setBanner('Running weekly maintenance inspection across all registered projects...');
    try {
      const res = await api.runWeeklyMaintenance();
      setBanner(
        res.inspectedCount === 0
          ? 'No registered projects found to inspect. Create a project first.'
          : `Inspected ${res.inspectedCount} project(s) and queued per-project maintenance/feature approval items below.`
      );
      await loadAll();
      onDataChanged();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Maintenance scan failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusyId('create_auto');
    try {
      await api.createAutomation({
        name: name.trim(),
        description: `${taskType.replace(/_/g, ' ')} every ${intervalMinutes} minute(s)`,
        taskType,
        intervalMinutes,
        approvedByUser,
      });
      setName('');
      setBanner('Scheduled background task created and stored in local JSON storage.');
      await loadAll();
      onDataChanged();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleAutomation = async (task: AutomationTask) => {
    setBusyId(task.id);
    try {
      await api.updateAutomation(task.id, { enabled: !task.enabled, approvedByUser: true });
      await loadAll();
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const handleRunAutomationNow = async (task: AutomationTask) => {
    setBusyId(task.id);
    setBanner(null);
    try {
      const res = await api.runAutomation(task.id);
      setBanner(res.automation.lastResult || `Executed "${task.name}".`);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Task execution failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleQueueWhopApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whopTarget.trim() || !whopProposal.trim()) return;
    setBusyId('whop_q');
    try {
      await api.createApproval({
        category: 'whop_change',
        title: `Whop Listing Change: ${whopTarget.trim()}`,
        target: whopTarget.trim(),
        proposedAction: whopProposal.trim(),
        consequences:
          'Modifies commercial listing details or pricing. STRANGE never decides pricing, trials, discounts, or payment settings without explicit approval.',
      });
      setWhopTarget('');
      setWhopProposal('');
      setBanner('Whop change request added to Approval Queue.');
      await loadAll();
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const resolvedApprovals = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Automation Centre</h1>
          <p className="mt-1 text-sm text-slate-400">
            Mandatory human-in-the-loop approval queue, approved background schedulers, and weekly maintenance across all applications.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRunWeeklyMaintenance}
          disabled={busyId === 'weekly'}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busyId === 'weekly' ? 'animate-spin' : ''}`} />
          <span>{busyId === 'weekly' ? 'Scanning Projects...' : 'Run Weekly App Maintenance'}</span>
        </button>
      </div>

      {banner && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-200">
          {banner}
        </div>
      )}

      {/* Pending Approvals */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">
            Pending Approvals ({pendingApprovals.length})
          </h2>
          <span className="text-xs text-slate-400">
            Required for Instagram DMs, Discord posts, Whop edits, Vercel deployments, repairs, and feature upgrades
          </span>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-8 text-center">
            <ShieldCheck className="mx-auto h-7 w-7 text-emerald-500/70" />
            <p className="mt-2 text-sm text-slate-300">No actions awaiting approval.</p>
            <p className="mt-1 text-xs text-slate-500">
              Any sensitive external, financial, deployment, or code-repair action will appear here for your explicit review first.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map((item) => (
              <div key={item.id} className="rounded-xl border border-amber-500/30 bg-[#0D1117] p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-amber-400 font-medium">
                      {item.category.replace(/_/g, ' ')} · Target: {item.target}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-slate-100">{item.title}</h3>
                  </div>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3 text-xs text-slate-200 whitespace-pre-wrap">
                  <div className="mb-1 text-[11px] font-medium text-slate-400">Exact Proposed Action / Message</div>
                  {item.proposedAction}
                </div>

                <p className="text-xs text-slate-400">
                  <strong className="text-slate-300">Consequences & Safeguards: </strong>
                  {item.consequences}
                </p>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleDecision(item.id, 'reject')}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-red-500/50 hover:text-red-300"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecision(item.id, 'approve')}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{busyId === item.id ? 'Executing...' : 'Approve & Execute'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Scheduled Background Tasks + Whop Commercial Gate */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Approved Scheduled Tasks</h2>
              <p className="text-xs text-slate-400">Lightweight single-process interval runner (low RAM footprint).</p>
            </div>
            <Clock className="h-4 w-4 text-cyan-400" />
          </div>

          <form onSubmit={handleCreateAutomation} className="space-y-3 rounded-lg border border-slate-800 bg-[#0A0E14] p-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Task name (e.g., Hourly App Health Check)"
              className="w-full rounded-lg border border-slate-700 bg-[#0D1117] px-3 py-2 text-xs text-slate-100"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as AutomationTask['taskType'])}
                className="rounded-lg border border-slate-700 bg-[#0D1117] px-3 py-2 text-xs text-slate-200"
              >
                <option value="health_check">HTTP Health Check (All Apps)</option>
                <option value="backup_workspace">Workspace Backup Snapshot</option>
                <option value="weekly_maintenance_scan">Weekly Maintenance Scan</option>
              </select>
              <input
                type="number"
                min={5}
                max={10080}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-[#0D1117] px-3 py-2 text-xs text-slate-100 tabular-nums"
                placeholder="Minutes"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={approvedByUser}
                  onChange={(e) => setApprovedByUser(e.target.checked)}
                />
                <span>Explicitly approve background execution</span>
              </label>
              <button
                type="submit"
                disabled={busyId === 'create_auto' || !name.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Task</span>
              </button>
            </div>
          </form>

          <div className="space-y-2.5">
            {automations.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">No scheduled tasks configured yet.</p>
            ) : (
              automations.map((task) => (
                <div key={task.id} className="rounded-lg border border-slate-800 bg-[#0A0E14] p-3.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">{task.name}</div>
                    <span className={task.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                      {task.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-400 tabular-nums">
                    Every {task.intervalMinutes} min · Last run:{' '}
                    {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : 'Never'}
                  </div>
                  {task.lastResult && <div className="mt-1 text-slate-300">{task.lastResult}</div>}
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleAutomation(task)}
                      disabled={busyId === task.id}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-cyan-500/40"
                    >
                      {task.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      <span>{task.enabled ? 'Pause' : 'Resume'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunAutomationNow(task)}
                      disabled={busyId === task.id || !task.approvedByUser}
                      className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                    >
                      Run Now
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Whop Commercial Change Gate + Resolved Approvals */}
        <div className="space-y-6">
          <form
            onSubmit={handleQueueWhopApproval}
            className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3"
          >
            <h2 className="text-base font-semibold text-slate-100">Queue Whop Product / Pricing Change</h2>
            <p className="text-xs text-slate-400">
              Commercial changes (new listings, pricing, plans, trials, discounts) always pass through explicit approval before execution.
            </p>
            <input
              type="text"
              value={whopTarget}
              onChange={(e) => setWhopTarget(e.target.value)}
              placeholder="Exact Whop product name or ID"
              className="w-full rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
            />
            <textarea
              rows={2}
              value={whopProposal}
              onChange={(e) => setWhopProposal(e.target.value)}
              placeholder="Proposed exact change (e.g., Publish Pro tier at $19/mo with no free trial)"
              className="w-full rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
            />
            <button
              type="submit"
              disabled={busyId === 'whop_q' || !whopTarget.trim() || !whopProposal.trim()}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              Submit to Approval Queue
            </button>
          </form>

          <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
            <h2 className="text-sm font-semibold text-slate-100">Recently Resolved Approvals</h2>
            <div className="mt-3 space-y-2.5 max-h-64 overflow-y-auto">
              {resolvedApprovals.length === 0 ? (
                <p className="text-xs text-slate-500">No resolved approvals yet.</p>
              ) : (
                resolvedApprovals.slice(0, 12).map((item) => (
                  <div key={item.id} className="border-b border-slate-800/60 pb-2.5 last:border-0 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-200">{item.title}</span>
                      <span className={item.status === 'rejected' ? 'text-red-400' : 'text-emerald-400'}>
                        {item.status}
                      </span>
                    </div>
                    {item.executionResult && <p className="mt-1 text-slate-400">{item.executionResult}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
