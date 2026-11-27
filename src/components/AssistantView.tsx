import { useEffect, useRef, useState } from 'react';
import {
  Globe,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  AlertCircle,
  ExternalLink,
  X,
} from 'lucide-react';
import type {
  AgentTaskState,
  ChatMessage,
  Conversation,
  IntegrationStatus,
  WorkspaceSection,
} from '../types';
import { api } from '../lib/api';
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  speakText,
  stopSpeaking,
  type SpeechRecognitionLike,
  type VoiceSettings,
} from '../lib/voice';

interface Props {
  integrations: IntegrationStatus;
  voiceSettings: VoiceSettings;
  pendingApprovalCount: number;
  onNavigate: (section: WorkspaceSection) => void;
  onDataChanged: () => void;
}

const STATE_LABELS: Record<AgentTaskState, { label: string; colorClass: string }> = {
  idle: { label: 'Idle', colorClass: 'text-slate-400' },
  thinking: { label: 'Thinking', colorClass: 'text-cyan-400' },
  researching: { label: 'Researching', colorClass: 'text-sky-400' },
  waiting_for_approval: { label: 'Waiting for approval', colorClass: 'text-amber-400' },
  executing: { label: 'Executing', colorClass: 'text-cyan-300' },
  testing: { label: 'Testing', colorClass: 'text-indigo-400' },
  completed: { label: 'Completed', colorClass: 'text-emerald-400' },
  failed: { label: 'Failed', colorClass: 'text-red-400' },
  paused: { label: 'Paused', colorClass: 'text-slate-400' },
};

export function AssistantView({
  integrations,
  voiceSettings,
  pendingApprovalCount,
  onNavigate,
  onDataChanged,
}: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [taskState, setTaskState] = useState<AgentTaskState>('idle');
  const [taskDetail, setTaskDetail] = useState('Ready for command');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);

  // Voice states
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    const { conversations: list } = await api.listConversations();
    setConversations(list);
    if (!activeConvId && list[0]) {
      setActiveConvId(list[0].id);
    }
  };

  useEffect(() => {
    loadConversations().catch((e) => setErrorBanner(e instanceof Error ? e.message : 'Failed to load sessions'));
  }, []);

  useEffect(() => {
    if (!activeConvId) return;
    api
      .listMessages(activeConvId)
      .then(({ messages: msgs }) => setMessages(msgs))
      .catch((e) => setErrorBanner(e instanceof Error ? e.message : 'Failed to load messages'));
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, taskState]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const handleNewConversation = async () => {
    const { conversation } = await api.createConversation('New Operator Session');
    setConversations((prev) => [conversation, ...prev]);
    setActiveConvId(conversation.id);
    setMessages([]);
    setTaskState('idle');
    setTaskDetail('New session initialized');
  };

  const handleDeleteConversation = async (id: string) => {
    await api.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      await handleNewConversation();
    } else {
      setConversations(remaining);
      if (activeConvId === id) setActiveConvId(remaining[0].id);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setErrorBanner('Attachment exceeds 512 KB text limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({ name: file.name, text: String(reader.result || '') });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toggleVoiceInput = () => {
    setVoiceError(null);
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      setVoiceError('Speech recognition is unavailable in this browser. Use Chromium/Edge/Electron or type directly.');
      return;
    }
    try {
      const rec = createSpeechRecognition(voiceSettings.lang);
      if (!rec) return;
      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = (ev) => {
        setListening(false);
        setVoiceError(`Microphone error: ${ev.error || 'permission denied or unavailable'}`);
      };
      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i++) {
          transcript += ev.results[i][0].transcript;
        }
        setInput(transcript);
      };
      recognitionRef.current = rec;
      rec.start();
    } catch {
      setVoiceError('Could not access microphone. Check browser or Windows microphone permissions.');
      setListening(false);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !activeConvId || taskState === 'thinking' || taskState === 'researching' || taskState === 'executing') {
      return;
    }

    setErrorBanner(null);
    setInput('');
    const currentAttachment = attachment;
    setAttachment(null);

    const isMaintenanceCmd = /strange[\s,:-]*update all my applications/i.test(text);
    setTaskState(isMaintenanceCmd ? 'executing' : useWebSearch ? 'researching' : 'thinking');
    setTaskDetail(
      isMaintenanceCmd
        ? 'Inspecting registered applications, running health checks, and preparing maintenance plans...'
        : useWebSearch
          ? 'Querying Gemini with live Google Search grounding...'
          : 'Processing request with local CRM & memory context...'
    );

    const optimisticUser: ChatMessage = {
      id: `temp_${Date.now()}`,
      conversationId: activeConvId,
      role: 'user',
      content: text,
      attachmentName: currentAttachment?.name,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await api.sendChat({
        conversationId: activeConvId,
        content: text,
        attachmentName: currentAttachment?.name,
        attachmentText: currentAttachment?.text,
        useWebSearch,
      });
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        res.userMessage,
        res.assistantMessage,
      ]);
      const nextState = res.assistantMessage.taskState || 'completed';
      setTaskState(nextState);
      setTaskDetail(
        nextState === 'waiting_for_approval'
          ? 'Action plan queued — awaiting your explicit approval'
          : 'Response saved to local JSON memory'
      );
      loadConversations().catch(() => {});
      onDataChanged();

      if (voiceSettings.enabled) {
        speakText(res.assistantMessage.content, voiceSettings, setSpeaking);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setErrorBanner(msg);
      setTaskState('failed');
      setTaskDetail(msg);
    }
  };

  const activeStateInfo = STATE_LABELS[taskState];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[600px] overflow-hidden">
      {/* Persistent Conversation History Rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-[#0A0E14] lg:flex">
        <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
          <span className="text-xs font-semibold text-slate-300">Sessions</span>
          <button
            type="button"
            onClick={handleNewConversation}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => {
            const isActive = conv.id === activeConvId;
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'bg-[#141C27] text-cyan-200'
                    : 'text-slate-400 hover:bg-[#111720] hover:text-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveConvId(conv.id)}
                  className="min-w-0 flex-1 truncate text-left font-medium"
                >
                  {conv.title}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteConversation(conv.id)}
                  aria-label={`Delete session ${conv.title}`}
                  className="ml-2 hidden text-slate-500 hover:text-red-400 group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Real Quick Operator Commands */}
        <div className="border-t border-slate-800/80 p-3 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Operator Commands</div>
          <button
            type="button"
            onClick={() => handleSend('STRANGE, update all my applications.')}
            className="w-full rounded-md border border-slate-800 bg-[#0D1117] px-2.5 py-2 text-left text-xs text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200 transition-colors"
          >
            STRANGE, update all my applications.
          </button>
          <button
            type="button"
            onClick={() => onNavigate('research')}
            className="w-full rounded-md border border-slate-800 bg-[#0D1117] px-2.5 py-2 text-left text-xs text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200 transition-colors"
          >
            Open Business Discovery Engine
          </button>
        </div>
      </aside>

      {/* Main Conversation Canvas */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#07090D]">
        {/* Real Status & Approval Strip (Unboxed clean metadata) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0A0E14] px-5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-400">
            <span className={`font-semibold ${activeStateInfo.colorClass}`}>{activeStateInfo.label}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate max-w-md text-slate-300">{taskDetail}</span>
          </div>
          <div className="flex items-center gap-3 text-slate-400 tabular-nums">
            <span>
              Model: <span className="font-mono text-slate-200">{integrations.gemini.model}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className={integrations.gemini.configured ? 'text-emerald-400' : 'text-amber-400'}>
              {integrations.gemini.configured ? 'Gemini ready' : 'Gemini key unset'}
            </span>
            {pendingApprovalCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onNavigate('automation')}
                  className="font-medium text-amber-400 hover:text-amber-300 underline underline-offset-4 whitespace-nowrap shrink-0"
                >
                  {pendingApprovalCount} approval{pendingApprovalCount > 1 ? 's' : ''} waiting
                </button>
              </>
            )}
          </div>
        </div>

        {/* Notifications */}
        {(errorBanner || voiceError) && (
          <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-5 py-2.5 text-xs text-red-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{errorBanner || voiceError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setErrorBanner(null);
                setVoiceError(null);
              }}
              className="text-red-300 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-slate-800/80 bg-[#0D1117] p-8">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                  STRANGE Operator Console
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                  Direct natural-language command interface backed by automatic local JSON conversation memory, live Google Search grounding, voice input/output, and mandatory approval gates for external or production actions.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() =>
                      handleSend(
                        'Summarize the current status of my projects, errors, and pending approvals from local CRM.'
                      )
                    }
                    className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 text-left hover:border-cyan-500/40 transition-colors"
                  >
                    <div className="text-sm font-medium text-slate-100">Audit CRM State</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Read live project health, errors, and queued approvals from local JSON storage.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('research')}
                    className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 text-left hover:border-cyan-500/40 transition-colors"
                  >
                    <div className="text-sm font-medium text-slate-100">Discover 3 Products</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Research real Reddit, forum, and review problems with web citations.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSend('STRANGE, update all my applications.')}
                    className="rounded-lg border border-slate-800 bg-[#0A0E14] p-4 text-left hover:border-cyan-500/40 transition-colors"
                  >
                    <div className="text-sm font-medium text-slate-100">Weekly Maintenance</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Inspect all registered apps and queue per-project upgrade approvals.
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                    <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span className="font-medium text-slate-300">{isUser ? 'You' : 'STRANGE'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.attachmentName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-cyan-400">{msg.attachmentName}</span>
                        </>
                      )}
                    </div>
                    <div
                      className={`max-w-3xl rounded-xl border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        isUser
                          ? 'border-cyan-500/30 bg-[#0F1E28] text-slate-100'
                          : 'border-slate-800/90 bg-[#0D1117] text-slate-200'
                      }`}
                    >
                      {msg.content}

                      {!isUser && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4 border-t border-slate-800/80 pt-3">
                          <div className="text-xs font-medium text-slate-400">Verified Web Sources</div>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                            {msg.sources.map((src) => (
                              <a
                                key={src.uri}
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                              >
                                <span className="max-w-[260px] truncate">{src.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {!isUser && (
                        <div className="mt-2.5 flex items-center gap-3 pt-1">
                          <button
                            type="button"
                            onClick={() => speakText(msg.content, voiceSettings, setSpeaking)}
                            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-300 transition-colors"
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                            <span>Read aloud</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-slate-800/80 bg-[#0A0E14] px-5 py-4">
          <div className="mx-auto max-w-4xl">
            {attachment && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-800 bg-[#0D1117] px-3 py-1.5 text-xs text-slate-300">
                <span className="truncate font-mono">Attached: {attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2 rounded-xl border border-slate-800 bg-[#0D1117] p-2 focus-within:border-cyan-500/50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv,.js,.ts,.html,.css,.sql,.log"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach text, log, or code file"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 transition-colors"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={toggleVoiceInput}
                title={listening ? 'Stop voice input' : 'Start voice input'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  listening
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  listening
                    ? 'Listening to microphone...'
                    : 'Instruct STRANGE (e.g., "STRANGE, update all my applications.")'
                }
                className="max-h-36 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
              />

              {speaking && (
                <button
                  type="button"
                  onClick={() => {
                    stopSpeaking();
                    setSpeaking(false);
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium text-amber-300 hover:bg-amber-500/20 whitespace-nowrap shrink-0 transition-colors"
                >
                  <VolumeX className="h-4 w-4" />
                  <span>Stop Speaking</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || taskState === 'thinking' || taskState === 'researching' || taskState === 'executing'}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-40 whitespace-nowrap shrink-0 transition-colors"
              >
                <Send className="h-4 w-4" />
                <span>Send</span>
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-400 hover:text-slate-200">
                  <input
                    type="checkbox"
                    checked={useWebSearch}
                    onChange={(e) => setUseWebSearch(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500"
                  />
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Google Search Grounding</span>
                </label>
                <span>
                  Mic: <span className="text-slate-300">{listening ? 'Recording' : 'Standby'}</span>
                </span>
              </div>
              <span>Enter to send · Shift+Enter for new line</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
