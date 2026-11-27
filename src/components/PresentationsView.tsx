import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Presentation, Trash2, Sparkles } from 'lucide-react';
import type { PresentationRecord, ProjectRecord } from '../types';
import { api } from '../lib/api';
import { exportPresentationPdf } from '../lib/pdf';

interface Props {
  onDataChanged: () => void;
}

export function PresentationsView({ onDataChanged }: Props) {
  const [decks, setDecks] = useState<PresentationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string>('');
  const [slideIdx, setSlideIdx] = useState(0);

  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('Early Customers & Stakeholders');
  const [objective, setObjective] = useState('');
  const [projectId, setProjectId] = useState('');
  const [slideCount, setSlideCount] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    const [dRes, pRes] = await Promise.all([api.listPresentations(), api.listProjects()]);
    setDecks(dRes.presentations);
    setProjects(pRes.projects);
    if (!activeDeckId && dRes.presentations[0]) {
      setActiveDeckId(dRes.presentations[0].id);
    }
  };

  useEffect(() => {
    loadAll().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load presentations'));
  }, []);

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null;
  const currentSlide = activeDeck?.slides[slideIdx] || null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !objective.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const linkedProj = projects.find((p) => p.id === projectId);
      const res = await api.generatePresentation({
        title: title.trim(),
        audience: audience.trim(),
        objective: objective.trim(),
        projectId: linkedProj?.id,
        context: linkedProj
          ? `Project: ${linkedProj.name}. Summary: ${linkedProj.prd?.executiveSummary || linkedProj.description}. Stack: ${linkedProj.techStack}.`
          : undefined,
        slideCount,
      });
      setTitle('');
      setObjective('');
      await loadAll();
      setActiveDeckId(res.presentation.id);
      setSlideIdx(0);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Presentation generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deletePresentation(id);
    const remaining = decks.filter((d) => d.id !== id);
    setDecks(remaining);
    if (activeDeckId === id) {
      setActiveDeckId(remaining[0]?.id || '');
      setSlideIdx(0);
    }
    onDataChanged();
  };

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="border-b border-slate-800/80 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Presentations</h1>
        <p className="mt-1 text-sm text-slate-400">
          Generate structured product pitches, investor decks, and stakeholder briefings with speaker notes and instant PDF export.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Generator Form */}
      <form onSubmit={handleGenerate} className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-5 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Presentation title (e.g., Q1 SaaS Launch Plan)"
            className="md:col-span-2 rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
          />
          <input
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Target audience"
            className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
          />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-200"
          >
            <option value="">Standalone Deck</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                Link Project: {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Deck objective & key message (e.g., Present MVP architecture, verified research evidence, and go-to-market plan)"
            className="flex-1 rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-100"
          />
          <select
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-[#0A0E14] px-3 py-2 text-xs text-slate-200"
          >
            <option value={5}>5 Slides</option>
            <option value={7}>7 Slides</option>
            <option value={10}>10 Slides</option>
          </select>
          <button
            type="submit"
            disabled={generating || !title.trim() || !objective.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{generating ? 'Generating Deck...' : 'Generate Presentation'}</span>
          </button>
        </div>
      </form>

      {/* Deck Library & Interactive Slide Canvas */}
      {decks.length === 0 ? (
        <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-10 text-center">
          <Presentation className="mx-auto h-7 w-7 text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">No presentations saved yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Generate your first slide deck above—it persists in automatic local JSON storage and exports cleanly to PDF.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-3 space-y-2">
            {decks.map((d) => (
              <div
                key={d.id}
                className={`flex items-center justify-between rounded-xl border p-3.5 text-xs transition-colors ${
                  d.id === activeDeck?.id
                    ? 'border-cyan-500/50 bg-[#111924] text-slate-100'
                    : 'border-slate-800/80 bg-[#0D1117] text-slate-300 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveDeckId(d.id);
                    setSlideIdx(0);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="font-medium truncate">{d.title}</div>
                  <div className="mt-1 text-slate-500 tabular-nums">
                    {d.slides.length} slides · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  aria-label="Delete presentation"
                  className="ml-2 text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {activeDeck && currentSlide && (
            <div className="lg:col-span-9 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-400 tabular-nums">
                  <strong className="text-slate-200">{activeDeck.title}</strong> · Audience: {activeDeck.audience} ·
                  Slide {slideIdx + 1} of {activeDeck.slides.length}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                    disabled={slideIdx === 0}
                    className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-cyan-500/40 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlideIdx((i) => Math.min(activeDeck.slides.length - 1, i + 1))}
                    disabled={slideIdx >= activeDeck.slides.length - 1}
                    className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-cyan-500/40 disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportPresentationPdf(activeDeck)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export PDF Deck</span>
                  </button>
                </div>
              </div>

              {/* 16:9 Slide Stage */}
              <div className="flex min-h-[380px] flex-col justify-between rounded-xl border border-slate-800 bg-[#0A0E16] p-8 md:p-10">
                <div>
                  <div className="text-xs font-mono text-cyan-400 tabular-nums">
                    Slide {String(currentSlide.slideNumber).padStart(2, '0')} · {currentSlide.layout}
                  </div>
                  <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight text-slate-100">
                    {currentSlide.title}
                  </h2>
                  <ul className="mt-6 space-y-3 text-sm md:text-base text-slate-200">
                    {currentSlide.keyPoints.map((pt, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 border-t border-slate-800/80 pt-4 text-xs text-slate-400">
                  <div>
                    <span className="font-medium text-slate-300">Visual Direction: </span>
                    {currentSlide.visualHint}
                  </div>
                  <div className="mt-1.5">
                    <span className="font-medium text-slate-300">Speaker Notes: </span>
                    {currentSlide.speakerNotes}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
