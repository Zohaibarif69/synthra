// Tiny localStorage-backed store with a React hook. Reads are cached; writes notify every subscriber
// (and other tabs through the 'storage' event). Storage failures never break the app.

import { useSyncExternalStore } from 'react';

export interface LocalStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): boolean;
  use(): T;
}

/**
 * Moves a value saved under the app's previous name (HackDataV2) to its new key, once, so renaming
 * the app doesn't lose anyone's history, schemas or settings.
 */
export function migrateLegacyKey(key: string): void {
  if (typeof window === 'undefined') return;
  const legacy = key.replace(/^synthra:/, 'hackdatav2:');
  if (legacy === key) return;
  try {
    const old = window.localStorage.getItem(legacy);
    if (old !== null && window.localStorage.getItem(key) === null) window.localStorage.setItem(key, old);
    if (old !== null) window.localStorage.removeItem(legacy);
  } catch {
    // Storage unavailable: nothing to migrate.
  }
}

export function createLocalStore<T>(key: string, fallback: T): LocalStore<T> {
  let cache: T | undefined;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (cache !== undefined) return cache;
    try {
      migrateLegacyKey(key);
      const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
      cache = raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      cache = fallback;
    }
    return cache;
  };

  const notify = () => listeners.forEach(l => l());

  const subscribe = (l: () => void) => {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => { if (e.key === key) { cache = undefined; notify(); } };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
  };

  return {
    get: read,
    /** Returns false when the browser refused to store the value (e.g. quota exceeded). */
    set(next) {
      const value = typeof next === 'function' ? (next as (p: T) => T)(read()) : next;
      let ok = true;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        ok = false;
      }
      if (ok) {
        cache = value;
        notify();
      }
      return ok;
    },
    use() {
      return useSyncExternalStore(subscribe, read, () => fallback);
    },
  };
}
