'use client';

// Voice input for the free-text boxes (describe your dataset, bank statement query, seller's business).
// Uses the browser's built-in speech recognition (Chrome, Edge, Safari): free, no API key, and the text
// appears while you speak. Browsers without it (e.g. Firefox) simply don't show the microphone.

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceLang = 'en-US' | 'ur-PK';

export const VOICE_LANGS: { code: VoiceLang; label: string; name: string }[] = [
  { code: 'en-US', label: 'EN', name: 'English' },
  { code: 'ur-PK', label: 'اردو', name: 'Urdu' },
];

const LANG_KEY = 'synthra:voice-lang';
/** Stop listening after this much silence once the user has started speaking… */
const SILENCE_MS = 2500;
/** …or if they never start. */
const NO_SPEECH_MS = 7000;
/** Hard limit per recording. */
const MAX_MS = 30_000;

// Minimal typing of the Web Speech API (not in every TypeScript DOM lib).
interface RecognitionResultList {
  length: number;
  [i: number]: { 0: { transcript: string }; isFinal: boolean };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export function getRecognition(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Urdu (۰–۹) and Arabic (٠–٩) digits → 0–9, so "۱۰۰۰ customers" reads as 1000. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/** Spoken words are added after whatever was already typed, with one space between. */
export function joinTranscript(before: string, spoken: string): string {
  const a = before.replace(/\s+$/, '');
  const b = spoken.replace(/^\s+/, '').replace(/\s+/g, ' ');
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/** True when the text contains Urdu/Arabic script. */
export function hasUrduScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function voiceErrorMessage(code: string, lang: VoiceLang): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'no-speech':
      return "Didn't hear anything. Tap the mic and try again.";
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone blocked. Allow it from the icon in the address bar, then try again.';
    case 'audio-capture':
      return 'No microphone found.';
    case 'network':
      return 'Voice input needs an internet connection.';
    case 'language-not-supported':
      return lang === 'ur-PK' ? "This browser can't recognise Urdu. Try English or Chrome." : "This language isn't supported here.";
    default:
      return "Voice input didn't work. Try again or type instead.";
  }
}

function readLang(): VoiceLang {
  try {
    return window.localStorage.getItem(LANG_KEY) === 'ur-PK' ? 'ur-PK' : 'en-US';
  } catch {
    return 'en-US';
  }
}

export interface VoiceState {
  supported: boolean;
  listening: boolean;
  lang: VoiceLang;
  urduAvailable: boolean;
  message: string | null;
  setLang: (lang: VoiceLang) => void;
  toggle: () => void;
}

/**
 * Speech → text for one input. Words appear in the input while you speak (after anything already typed),
 * and it stops by itself after a short silence. Urdu is offered only when `allowUrdu` is true, because
 * Urdu text needs the AI to be understood; the built-in parsers read English.
 */
export function useVoiceInput(value: string, onChange: (text: string) => void, { allowUrdu }: { allowUrdu: boolean }): VoiceState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLangState] = useState<VoiceLang>('en-US');
  const [message, setMessage] = useState<string | null>(null);

  const rec = useRef<Recognition | null>(null);
  const base = useRef('');
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Browser-only checks after mount, so server and client render the same HTML.
  useEffect(() => {
    setSupported(getRecognition() !== null);
    setLangState(readLang());
  }, []);

  const effectiveLang: VoiceLang = lang === 'ur-PK' && !allowUrdu ? 'en-US' : lang;

  const clearTimers = () => {
    if (silence.current) clearTimeout(silence.current);
    if (limit.current) clearTimeout(limit.current);
    silence.current = limit.current = null;
  };

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = effectiveLang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    base.current = valueRef.current;

    const armSilence = (ms: number) => {
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(() => r.stop(), ms);
    };

    r.onresult = e => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
      onChangeRef.current(joinTranscript(base.current, normalizeDigits(spoken)));
      armSilence(SILENCE_MS);
    };
    r.onerror = e => setMessage(voiceErrorMessage(e.error, effectiveLang));
    r.onend = () => {
      clearTimers();
      rec.current = null;
      setListening(false);
    };

    try {
      r.start();
    } catch {
      setMessage(voiceErrorMessage('unknown', effectiveLang));
      return;
    }
    rec.current = r;
    setMessage(null);
    setListening(true);
    armSilence(NO_SPEECH_MS);
    limit.current = setTimeout(() => r.stop(), MAX_MS);
  }, [effectiveLang]);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  const setLang = useCallback((next: VoiceLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // Not saved: the choice still applies until the page is reloaded.
    }
    rec.current?.abort();
  }, []);

  // Stop the microphone if the input disappears while listening.
  useEffect(() => () => {
    clearTimers();
    rec.current?.abort();
  }, []);

  return { supported, listening, lang: effectiveLang, urduAvailable: allowUrdu, message, setLang, toggle };
}
