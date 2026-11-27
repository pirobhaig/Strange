export interface VoiceSettings {
  enabled: boolean;
  rate: number;
  volume: number;
  lang: string;
  voiceName: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> }) => void) | null;
  start: () => void;
  stop: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createSpeechRecognition(lang: string): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = lang || 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  return recognition;
}

export function listAvailableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

export function speakText(text: string, settings: VoiceSettings, onStateChange?: (speaking: boolean) => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/[#*`_]/g, '').slice(0, 2800);
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = Math.min(2, Math.max(0.5, settings.rate || 1));
  utterance.volume = Math.min(1, Math.max(0, settings.volume ?? 1));
  utterance.lang = settings.lang || 'en-US';

  if (settings.voiceName) {
    const match = window.speechSynthesis.getVoices().find((v) => v.name === settings.voiceName);
    if (match) utterance.voice = match;
  }

  utterance.onstart = () => onStateChange?.(true);
  utterance.onend = () => onStateChange?.(false);
  utterance.onerror = () => onStateChange?.(false);
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
