'use client';

import React from 'react';
import { Mic, Square } from 'lucide-react';
import { VOICE_LANGS, type VoiceState } from '../../lib/voice';

/** Language switch (EN | اردو) + microphone button. Renders nothing where the browser has no speech recognition. */
export function VoiceControls({ voice, className = '' }: { voice: VoiceState; className?: string }) {
  if (!voice.supported) return null;
  const langs = voice.urduAvailable ? VOICE_LANGS : [];
  const current = VOICE_LANGS.find(l => l.code === voice.lang)!;
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      {langs.length > 1 && (
        <div role="group" aria-label="Voice language" className="flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-[11px] leading-none">
          {langs.map(l => (
            <button
              key={l.code}
              type="button"
              lang={l.code === 'ur-PK' ? 'ur' : 'en'}
              aria-pressed={voice.lang === l.code}
              title={`Speak in ${l.name}`}
              onClick={() => voice.setLang(l.code)}
              className={`px-2 py-1 rounded-full transition-colors ${
                voice.lang === l.code
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={voice.toggle}
        aria-pressed={voice.listening}
        aria-label={voice.listening ? 'Stop voice input' : `Speak (${current.name})`}
        title={voice.listening ? 'Stop' : `Speak (${current.name})`}
        className={`relative flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
          voice.listening
            ? 'bg-[var(--color-error)] text-white'
            : 'bg-[var(--color-primary-light)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white'
        }`}
      >
        {voice.listening && <span className="absolute inset-0 rounded-full bg-[var(--color-error)] opacity-40 animate-ping" aria-hidden="true" />}
        {voice.listening ? <Square size={11} fill="currentColor" className="relative" /> : <Mic size={14} className="relative" />}
      </button>
    </div>
  );
}

/** "Listening…" while recording, or a short reason when voice input failed. */
export function VoiceStatus({ voice }: { voice: VoiceState }) {
  if (!voice.supported) return null;
  if (voice.listening) {
    return (
      <p className="text-xs text-[var(--color-error)] flex items-center gap-1.5" role="status">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-error)] animate-pulse" aria-hidden="true" />
        {voice.lang === 'ur-PK' ? <span lang="ur">سن رہا ہوں… بولیے</span> : 'Listening… speak now'}
      </p>
    );
  }
  return voice.message ? <p className="text-xs text-[var(--color-text-muted)]" role="status">{voice.message}</p> : null;
}
