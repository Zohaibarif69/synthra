'use client';

import React, { useEffect, useId, useState } from 'react';
import { Globe, Database, Shield, Cpu, Save } from 'lucide-react';
import { Button } from '../components/common/Button';
import { useToast } from '../components/common/Toast';
import { LOCALES, CURRENCIES } from '../lib/constants';
import { DEFAULT_SETTINGS, settingsStore, type AppSettings } from '../lib/settingsStore';
import { historyStore } from '../lib/historyStore';
import { schemaLibrary } from '../lib/schemaLibrary';
import { useAiStatus } from '../lib/ai/client';

interface SettingsSection {
  id: string;
  icon: React.ReactNode;
  label: string;
}

const sections: SettingsSection[] = [
  { id: 'general', icon: <Globe size={15} />, label: 'General' },
  { id: 'generation', icon: <Database size={15} />, label: 'Generation Defaults' },
  { id: 'privacy', icon: <Shield size={15} />, label: 'Privacy' },
  { id: 'engine', icon: <Cpu size={15} />, label: 'Engine & AI' },
];

const selectCls = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] focus:border-[var(--color-primary)] outline-none';

export function Settings() {
  const toast = useToast();
  const stored = settingsStore.use();
  const history = historyStore.use();
  const schemas = schemaLibrary.use();
  const ai = useAiStatus();
  const [active, setActive] = useState('general');
  const [draft, setDraft] = useState<AppSettings>({ ...DEFAULT_SETTINGS, ...stored });
  useEffect(() => { setDraft({ ...DEFAULT_SETTINGS, ...stored }); }, [stored]);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft(d => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...DEFAULT_SETTINGS, ...stored });

  const handleSave = () => {
    if (settingsStore.set(draft)) toast.success('Settings saved — new generations use these defaults');
    else toast.error('Could not save settings: browser storage is unavailable.');
  };

  const storageBytes = (() => {
    try {
      let n = 0;
      for (const k of ['synthra:history:v1', 'synthra:schemas:v1', 'synthra:settings:v1', 'synthra:er-positions']) n += (localStorage.getItem(k) ?? '').length * 2;
      return n;
    } catch { return 0; }
  })();

  return (
    <div className="p-6 lg:p-8 max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Defaults for new generations. Saved in this browser.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-44 shrink-0">
          <nav aria-label="Settings sections" className="grid grid-cols-2 md:grid-cols-1 gap-0.5">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                aria-current={active === s.id ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors ${
                  active === s.id
                    ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0">
          {active === 'general' && (
            <SettingsCard title="General">
              <Field label="Language">
                <select value={draft.language} onChange={e => set('language', e.target.value)} className={selectCls}>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="Timezone" description="Used when showing generation times.">
                <select value={draft.timezone} onChange={e => set('timezone', e.target.value)} className={selectCls}>
                  <option value="Asia/Karachi">Asia/Karachi (PKT, UTC+5)</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                </select>
              </Field>
              <Field label="Default Locale" description="Names, cities, phone formats and document templates.">
                <select value={draft.defaultLocale} onChange={e => set('defaultLocale', e.target.value)} className={selectCls}>
                  {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </Field>
              <Field label="Default Currency">
                <select value={draft.defaultCurrency} onChange={e => set('defaultCurrency', e.target.value)} className={selectCls}>
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </SettingsCard>
          )}

          {active === 'generation' && (
            <SettingsCard title="Generation Defaults">
              <Field label="Default Row Count" description="Used when starting a new generation job.">
                <input type="number" min={1} max={1_000_000} value={draft.defaultRowCount}
                  onChange={e => set('defaultRowCount', Math.max(1, Math.min(1_000_000, parseInt(e.target.value) || 1)))}
                  className="w-40 px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm font-mono bg-transparent focus:border-[var(--color-primary)] outline-none" />
              </Field>
              <Field label={`Default Null Rate — ${draft.defaultNullRate}%`} description="Percentage of missing values in nullable columns.">
                <input type="range" min={0} max={50} value={draft.defaultNullRate}
                  onChange={e => set('defaultNullRate', parseInt(e.target.value))} className="w-full accent-[var(--color-primary)]" />
              </Field>
              <Field label={`Default Outlier Rate — ${draft.defaultOutlierRate}%`} description="Percentage of outlier values in numeric fields.">
                <input type="range" min={0} max={20} value={draft.defaultOutlierRate}
                  onChange={e => set('defaultOutlierRate', parseInt(e.target.value))} className="w-full accent-[var(--color-primary)]" />
              </Field>
            </SettingsCard>
          )}

          {active === 'privacy' && (
            <SettingsCard title="Privacy Defaults">
              <Field label="Default PII Behavior" description="Applied to high-privacy columns detected in uploaded files.">
                <div className="space-y-2">
                  {([
                    { value: 'synthetic', label: 'Replace with synthetic value', desc: 'Generate realistic but fake values (faker)' },
                    { value: 'mask', label: 'Mask', desc: 'Keep a hint (first letter, domain or last 4 digits), star the rest' },
                    { value: 'hash', label: 'Hash', desc: 'SHA-256, shortened; same input gives the same hash' },
                  ] as const).map(opt => (
                    <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer group">
                      <input type="radio" name="pii" value={opt.value} checked={draft.defaultPIIBehavior === opt.value}
                        onChange={() => set('defaultPIIBehavior', opt.value)} className="mt-0.5 accent-[var(--color-primary)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">{opt.label}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>
            </SettingsCard>
          )}

          {active === 'engine' && (
            <SettingsCard title="Engine & AI">
              <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                <div className="flex justify-between"><span>Generation engine</span><span className="font-mono text-[var(--color-success)]">Client-side (browser + Web Worker)</span></div>
                <div className="flex justify-between"><span>Server / backend</span><span className="font-mono">None — data never leaves this browser</span></div>
                <div className="flex justify-between">
                  <span>AI assistance</span>
                  <span className={`font-mono ${ai?.configured ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
                    {ai === null ? 'Checking…' : ai.configured ? `Key configured · ${ai.model}` : 'Not connected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Schema detection & query parsing</span>
                  <span className="font-mono">{ai?.configured ? 'Rule-based + AI review' : 'Rule-based'}</span>
                </div>
                {ai?.configured && (
                  <div className="flex justify-between">
                    <span>AI cache & rate limit</span>
                    <span className="font-mono">{ai.cache === 'redis' ? 'Upstash Redis' : 'Server memory'}</span>
                  </div>
                )}
                <div className="flex justify-between"><span>History entries</span><span className="font-mono">{history.length}</span></div>
                <div className="flex justify-between"><span>Saved schemas</span><span className="font-mono">{schemas.length}</span></div>
                <div className="flex justify-between"><span>Browser storage used</span><span className="font-mono">{(storageBytes / 1024).toFixed(1)} KB</span></div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                AI is optional. To enable it, put <code className="font-mono">GEMINI_API_KEY=…</code> in <code className="font-mono">.env.local</code> (see <code className="font-mono">.env.example</code>) and restart the server; the key stays on the server.
                When AI is used, only column names, up to 10 sample rows (detected PII masked) or quality scores are sent — never whole datasets.
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Uploaded files and generated rows stay in memory for this tab only. History keeps configurations, seeds and learned statistics so datasets can be regenerated exactly.
              </p>
            </SettingsCard>
          )}

          {active !== 'engine' && (
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSave} disabled={!dirty} icon={<Save size={14} />}>
                {dirty ? 'Save Settings' : 'Saved'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  const id = useId();
  const labelCls = 'text-sm font-medium text-[var(--color-text-secondary)] block mb-1';
  const descId = description ? `${id}-desc` : undefined;
  const desc = description && <p id={descId} className="text-xs text-[var(--color-text-muted)] mb-2">{description}</p>;
  // A single input/select is linked to the label; a group of controls gets a labelled group.
  if (React.isValidElement(children) && (children.type === 'input' || children.type === 'select')) {
    return (
      <div>
        <label htmlFor={id} className={labelCls}>{label}</label>
        {desc}
        {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, { id, 'aria-describedby': descId })}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={descId}>
      <span id={`${id}-label`} className={labelCls}>{label}</span>
      {desc}
      {children}
    </div>
  );
}
