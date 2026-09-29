import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalStore, migrateLegacyKey } from '../../localStore';

function fakeStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('rename HackDataV2 → Synthra keeps saved data', () => {
  it('history saved under the old name is read under the new one, and the old key is removed', () => {
    const storage = fakeStorage({ 'hackdatav2:history:v1': JSON.stringify([{ id: 'a' }]) });
    vi.stubGlobal('window', { localStorage: storage, addEventListener() {}, removeEventListener() {} });
    const store = createLocalStore<{ id: string }[]>('synthra:history:v1', []);
    expect(store.get()).toEqual([{ id: 'a' }]);
    expect(storage.map.has('hackdatav2:history:v1')).toBe(false);
    expect(storage.map.get('synthra:history:v1')).toBe(JSON.stringify([{ id: 'a' }]));
  });

  it('never overwrites data already saved under the new name', () => {
    const storage = fakeStorage({ 'hackdatav2:settings:v1': '"old"', 'synthra:settings:v1': '"new"' });
    vi.stubGlobal('window', { localStorage: storage });
    migrateLegacyKey('synthra:settings:v1');
    expect(storage.map.get('synthra:settings:v1')).toBe('"new"');
  });

  it('does nothing for keys that never had an old name', () => {
    const storage = fakeStorage({});
    vi.stubGlobal('window', { localStorage: storage });
    migrateLegacyKey('other:key');
    expect(storage.map.size).toBe(0);
  });
});
