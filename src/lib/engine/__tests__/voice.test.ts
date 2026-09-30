import { describe, expect, it } from 'vitest';
import { hasUrduScript, joinTranscript, normalizeDigits, voiceErrorMessage } from '../../voice';

describe('voice input helpers', () => {
  it('turns Urdu and Arabic digits into 0-9', () => {
    expect(normalizeDigits('۱۰۰۰ پاکستانی گاہک، عمر ۱۸ سے ۶۰')).toBe('1000 پاکستانی گاہک، عمر 18 سے 60');
    expect(normalizeDigits('٤٥')).toBe('45');
    expect(normalizeDigits('last 90 days')).toBe('last 90 days');
  });

  it('adds spoken words after what was typed, with single spaces', () => {
    expect(joinTranscript('', 'generate 1000 customers')).toBe('generate 1000 customers');
    expect(joinTranscript('generate 1000 customers', ' with name and city')).toBe('generate 1000 customers with name and city');
    expect(joinTranscript('typed  ', '  spoken   words ')).toBe('typed spoken words ');
    expect(joinTranscript('typed', '')).toBe('typed');
  });

  it('detects Urdu script', () => {
    expect(hasUrduScript('پچھلے 90 دن')).toBe(true);
    expect(hasUrduScript('pichle 90 din')).toBe(false);
    expect(hasUrduScript('last 90 days')).toBe(false);
  });

  it('explains failures in plain words, and stays quiet when the user stopped it', () => {
    expect(voiceErrorMessage('aborted', 'en-US')).toBeNull();
    expect(voiceErrorMessage('not-allowed', 'en-US')).toMatch(/Microphone blocked/);
    expect(voiceErrorMessage('no-speech', 'en-US')).toMatch(/Didn't hear/);
    expect(voiceErrorMessage('network', 'en-US')).toMatch(/internet/);
    expect(voiceErrorMessage('language-not-supported', 'ur-PK')).toMatch(/Urdu/);
  });
});
