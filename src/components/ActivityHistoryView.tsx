import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { ActivityLog } from '../types';
import { api } from '../lib/api';

export function ActivityHistoryView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await api.listActivity(200);
      setLogs(res.logs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const categories = ['all', ...Array.from(new Set(logs.map((l) => l.category)))];
  const filtered = logs.filter((l) => {
    if (categoryFilter !== 'all' && l.category !== categoryFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q) ||
      l.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Activity History</h1>
          <p className="mt-1 text-sm text-slate-400">
            Auditable local JSON ledger of real commands, discoveries, builds, test passes, approvals, and integration checks.
          </p>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1117] px-4 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter activity logs..."
            className="w-full rounded-lg border border-slate-800 bg-[#0D1117] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#0A0E14] p-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                categoryFilter === cat ? 'bg-[#16202C] text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No matching activity records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-5 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-[#111722]">
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 capitalize whitespace-nowrap">{log.category}</td>
                    <td className="px-4 py-3 font-medium text-slate-100">{log.action}</td>
                    <td className="px-4 py-3 text-slate-400 max-w-xl">{log.details}</td>
                    <td
                      className={`px-5 py-3 text-right font-medium whitespace-nowrap ${
                        log.status === 'success'
                          ? 'text-emerald-400'
                          : log.status === 'error'
                            ? 'text-red-400'
                            : log.status === 'warning'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                      }`}
                    >
                      {log.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
