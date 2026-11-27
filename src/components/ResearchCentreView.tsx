import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  IntegrationStatus,
  OpportunityItem,
  OutreachTarget,
  ProjectRecord,
  WorkspaceSection,
} from '../types';
import { api } from '../lib/api';

interface Props {
  integrations: IntegrationStatus;
  onNavigate: (section: WorkspaceSection) => void;
  onDataChanged: () => void;
}

type ResearchTab = 'discovery' | 'instagram' | 'discord';

export function ResearchCentreView({ integrations, onNavigate, onDataChanged }: Props) {
  const [tab, setTab] = useState<ResearchTab>('discovery');

  // Business Discovery State
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>([]);
  const [priorityOrderMap, setPriorityOrderMap] = useState<Record<string, number>>({});
  const [discovering, setDiscovering] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  // Outreach State
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [outreachTargets, setOutreachTargets] = useState<OutreachTarget[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [outreachNiche, setOutreachNiche] = useState('');
  const [researchingOutreach, setResearchingOutreach] = useState(false);
  const [igHandleInput, setIgHandleInput] = useState(integrations.instagram.authorizedAccount || '');
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});

  const [banner, setBanner] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    const [oppsRes, projRes, outRes] = await Promise.all([
      api.listOpportunities(),
      api.listProjects(),
      api.listOutreach(),
    ]);
    setOpportunities(oppsRes.opportunities);
    setProjects(projRes.projects);
    setOutreachTargets(outRes.targets);
    const edits: Record<string, string> = {};
    for (const t of outRes.targets) edits[t.id] = t.draftMessage;
    setDraftEdits(edits);
  };

  useEffect(() => {
    loadData().catch((e) => setBanner({ type: 'error', text: e instanceof Error ? e.message : 'Load failed' }));
  }, []);

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discoveryQuery.trim()) return;
    setDiscovering(true);
    setBanner(null);
    try {
      await api.discoverOpportunities(discoveryQuery.trim());
      setBanner({
        type: 'info',
        text: 'Discovery completed with live Google Search citations. Review the 3 opportunities below and choose which product to build first.',
      });
      await loadData();
      onDataChanged();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Discovery failed' });
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectOpportunity = async (opp: OpportunityItem) => {
    setSelectingId(opp.id);
    setBanner(null);
    try {
      const order = priorityOrderMap[opp.id] || 1;
      const res = await api.selectOpportunity(opp.id, order);
      setBanner({
        type: 'info',
        text: `Stage A PRD generated for "${res.project.name}". Opening My Projects to review the plan before building.`,
      });
      await loadData();
      onDataChanged();
      onNavigate('projects');
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Selection failed' });
    } finally {
      setSelectingId(null);
    }
  };

  const handleSaveInstagramHandle = async () => {
    if (!igHandleInput.trim()) return;
    await api.saveSettings({ instagram_authorized_account: igHandleInput.trim() });
    setBanner({
      type: 'info',
      text: `Authorized Instagram account reference saved (${igHandleInput.trim()}). STRANGE never asks for or stores Instagram passwords.`,
    });
    onDataChanged();
  };

  const handleResearchOutreach = async (platform: 'instagram' | 'discord') => {
    if (!outreachNiche.trim()) return;
    setResearchingOutreach(true);
    setBanner(null);
    try {
      const selectedProj = projects.find((p) => p.id === selectedProjectId);
      await api.researchOutreach({
        platform,
        niche: outreachNiche.trim(),
        projectId: selectedProj?.id,
        productName: selectedProj?.name || outreachNiche.trim(),
        productDescription: selectedProj?.description || outreachNiche.trim(),
      });
      setBanner({
        type: 'info',
        text: `Researched ${platform} targets using live web search. Review drafts and submit each message for explicit approval before sending.`,
      });
      await loadData();
      onDataChanged();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Outreach research failed' });
    } finally {
      setResearchingOutreach(false);
    }
  };

  const handleQueueOutreachApproval = async (target: OutreachTarget) => {
    try {
      const edited = draftEdits[target.id];
      if (edited !== undefined && edited !== target.draftMessage) {
        await api.updateOutreach(target.id, { draftMessage: edited });
      }
      await api.requestOutreachApproval(target.id);
      setBanner({
        type: 'info',
        text: `Message to ${target.name} queued in Approval Queue. Approve explicitly in Automation Centre before handoff.`,
      });
      await loadData();
      onDataChanged();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to queue approval' });
    }
  };

  const handleMarkSentVerified = async (target: OutreachTarget) => {
    await api.updateOutreach(target.id, {
      followStatus: 'verified',
      deliveryStatus: 'sent_verified',
    });
    setBanner({ type: 'info', text: `Recorded verified outreach delivery to ${target.name} in CRM.` });
    await loadData();
    onDataChanged();
  };

  // Group latest 3 opportunities batch first
  const latestBatchId = opportunities[0]?.batchId || null;
  const latestBatch = latestBatchId ? opportunities.filter((o) => o.batchId === latestBatchId) : [];
  const filteredTargets = outreachTargets.filter((t) => t.platform === tab);

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Research Centre</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live Google Search-grounded business problem discovery, influencer discovery, and Discord community research with strict evidence separation.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0A0E14] p-1">
          {(
            [
              ['discovery', 'Business Discovery'],
              ['instagram', 'Instagram Influencers'],
              ['discord', 'Discord Communities'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                tab === key ? 'bg-[#16202C] text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            banner.type === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-200'
              : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* TAB 1: BUSINESS PROBLEM DISCOVERY ENGINE */}
      {tab === 'discovery' && (
        <div className="space-y-6">
          <form
            onSubmit={handleDiscover}
            className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3"
          >
            <label className="block text-sm font-semibold text-slate-100">
              Discover Three Real-World Software Opportunities
            </label>
            <p className="text-xs text-slate-400">
              STRANGE searches real Reddit discussions, customer reviews, public forums, and competitor websites, separating verified evidence from estimates and presenting exactly 3 buildable opportunities.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={discoveryQuery}
                onChange={(e) => setDiscoveryQuery(e.target.value)}
                placeholder="Enter domain or audience (e.g., freelance video editors, Shopify store ops, solo bookkeepers)"
                className="flex-1 rounded-lg border border-slate-700 bg-[#0A0E14] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={discovering || !discoveryQuery.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Search className="h-4 w-4" />
                <span>{discovering ? 'Researching Live Web...' : 'Run Discovery'}</span>
              </button>
            </div>
          </form>

          {latestBatch.length === 0 ? (
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-10 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-slate-600" />
              <p className="mt-3 text-sm text-slate-300">No business discovery runs recorded yet.</p>
              <p className="mt-1 text-xs text-slate-500">
                Enter a niche above to research 3 grounded web app, SaaS, or productivity tool opportunities.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  Latest Discovery Query: <strong className="text-slate-200">{latestBatch[0].query}</strong>
                </span>
                <span>Select which product to build first and assign build order (1st, 2nd, 3rd).</span>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {latestBatch.map((opp) => (
                  <article
                    key={opp.id}
                    className={`flex flex-col rounded-xl border bg-[#0D1117] p-5 ${
                      opp.isRecommended ? 'border-cyan-500/50' : 'border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-slate-400">Opportunity 0{opp.rankIndex}</span>
                      {opp.isRecommended && (
                        <span className="font-semibold text-cyan-400">Recommended Top Pick</span>
                      )}
                    </div>

                    <h3 className="mt-2 text-lg font-semibold text-slate-100">{opp.productIdea}</h3>
                    <div className="mt-1 text-xs text-slate-400">
                      Complexity: {opp.technicalComplexity} · Effort: {opp.estimatedEffort}
                    </div>

                    <div className="mt-4 flex-1 space-y-3 text-xs leading-relaxed">
                      <div>
                        <div className="font-semibold text-slate-200">Problem Solved</div>
                        <p className="mt-0.5 text-slate-400">{opp.problemSolved}</p>
                      </div>
                      <div>
                        <div className="font-semibold text-emerald-400">Verified Evidence</div>
                        <p className="mt-0.5 text-slate-300">{opp.verifiedEvidence}</p>
                      </div>
                      <div>
                        <div className="font-semibold text-amber-400">Assumptions & Estimates</div>
                        <p className="mt-0.5 text-slate-400">{opp.assumptionsAndEstimates}</p>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200">Target Audience & Competitors</div>
                        <p className="mt-0.5 text-slate-400">
                          {opp.targetAudience} — Competitors: {opp.competitors}
                        </p>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200">Proposed Solution & Core Features</div>
                        <p className="mt-0.5 text-slate-400">{opp.proposedSolution}</p>
                        <ul className="mt-1 list-disc pl-4 text-slate-300 space-y-0.5">
                          {opp.coreFeatures.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200">Monetization & Risks</div>
                        <p className="mt-0.5 text-slate-400">
                          {opp.monetizationStrategy} · Risks: {opp.risks}
                        </p>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200">Why Worth Building</div>
                        <p className="mt-0.5 text-slate-300">{opp.whyWorthBuilding}</p>
                        {opp.isRecommended && (
                          <p className="mt-1 text-cyan-300">{opp.recommendationReason}</p>
                        )}
                      </div>

                      {opp.sources.length > 0 && (
                        <div className="border-t border-slate-800/80 pt-2.5">
                          <div className="font-medium text-slate-400">Citations</div>
                          <div className="mt-1 flex flex-col gap-1">
                            {opp.sources.slice(0, 4).map((s) => (
                              <a
                                key={s.uri}
                                href={s.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 truncate"
                              >
                                <span className="truncate">{s.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex items-center gap-2 border-t border-slate-800/80 pt-4">
                      <select
                        value={priorityOrderMap[opp.id] || opp.rankIndex}
                        onChange={(e) =>
                          setPriorityOrderMap((prev) => ({ ...prev, [opp.id]: Number(e.target.value) }))
                        }
                        aria-label="Priority order"
                        className="rounded-lg border border-slate-700 bg-[#0A0E14] px-2.5 py-2 text-xs text-slate-200"
                      >
                        <option value={1}>Build 1st</option>
                        <option value={2}>Build 2nd</option>
                        <option value={3}>Build 3rd</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleSelectOpportunity(opp)}
                        disabled={selectingId !== null}
                        className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
                      >
                        {selectingId === opp.id ? 'Generating PRD...' : 'Select & Create PRD (Stage A)'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2 & 3: INSTAGRAM INFLUENCERS & DISCORD COMMUNITIES */}
      {(tab === 'instagram' || tab === 'discord') && (
        <div className="space-y-6">
          {tab === 'instagram' && (
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Authorized Instagram Account Setup (Guided Manual Workflow)
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Save the Instagram handle you intend to outreach from. STRANGE never requests or stores passwords and never bypasses Instagram anti-bot controls.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={igHandleInput}
                    onChange={(e) => setIgHandleInput(e.target.value)}
                    placeholder="@your_authorized_handle"
                    className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleSaveInstagramHandle}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 whitespace-nowrap"
                  >
                    Save Handle
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Research Form */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {tab === 'instagram'
                  ? 'Research Relevant Public Instagram Creators'
                  : 'Research Relevant Public Discord Communities'}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-200"
              >
                <option value="">General Research (No linked project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.userApprovedForMarketing ? '(Approved)' : '(Locked — Approve in Stage D)'}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={outreachNiche}
                onChange={(e) => setOutreachNiche(e.target.value)}
                placeholder={
                  tab === 'instagram'
                    ? 'Creator niche (e.g., indie SaaS builders, productivity setups)'
                    : 'Community niche (e.g., solo founders, Notion workflows, AI automation)'
                }
                className="md:col-span-2 rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={() => handleResearchOutreach(tab)}
                disabled={researchingOutreach || !outreachNiche.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{researchingOutreach ? 'Searching...' : 'Find & Draft Outreach'}</span>
              </button>
            </div>
          </div>

          {/* Researched Targets */}
          {filteredTargets.length === 0 ? (
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-8 text-center text-xs text-slate-500">
              No {tab} targets researched yet. Run a grounded search above to populate ranked targets and personalized drafts.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTargets.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono text-cyan-400">Rank #{t.relevanceRank}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t.niche}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t.publicFollowersOrSize}</span>
                      </div>
                      <h3 className="mt-1 text-base font-semibold text-slate-100">{t.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        {t.profileOrInviteUrl.startsWith('http') && (
                          <a
                            href={t.profileOrInviteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                          >
                            <span>Open Profile / Invite</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <span>Contact / Rules: {t.publicContactOrRules}</span>
                        <span>Policy: {t.promotionPermitted}</span>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        t.deliveryStatus === 'sent_verified'
                          ? 'text-emerald-400'
                          : t.deliveryStatus === 'approved_for_manual_send'
                            ? 'text-cyan-400'
                            : t.deliveryStatus === 'pending_approval'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                      }`}
                    >
                      {t.deliveryStatus.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">{t.audienceRelevance}</p>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Personalized Message Draft (Requires explicit approval before sending)
                    </label>
                    <textarea
                      rows={3}
                      value={draftEdits[t.id] ?? t.draftMessage}
                      onChange={(e) => setDraftEdits((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-800 bg-[#0A0E14] p-3 text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                      <span>Zero unsolicited bulk automation · Guided compliant handoff</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(t.deliveryStatus === 'draft_ready' || t.deliveryStatus === 'researched') && (
                        <button
                          type="button"
                          onClick={() => handleQueueOutreachApproval(t)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Request Explicit Send Approval</span>
                        </button>
                      )}
                      {t.deliveryStatus === 'approved_for_manual_send' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(draftEdits[t.id] ?? t.draftMessage);
                              setBanner({ type: 'info', text: `Copied approved message for ${t.name} to clipboard.` });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-500/40"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Approved Message</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkSentVerified(t)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Mark Sent & Record in CRM</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
