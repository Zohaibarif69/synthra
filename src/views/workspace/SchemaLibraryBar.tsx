'use client';

import React, { useState } from 'react';
import { BookMarked, Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../components/common/Toast';
import { deleteSchema, saveSchema, schemaLibrary, type SavedSchema } from '../../lib/schemaLibrary';

/** Save the current schema under a name, or load/delete a saved one. */
export function SchemaLibraryBar({ kind, canSave, current, onLoad }: {
  kind: SavedSchema['kind'];
  canSave: boolean;
  current: () => Omit<SavedSchema, 'id' | 'createdAt' | 'name' | 'kind'>;
  onLoad: (s: SavedSchema) => void;
}) {
  const saved = schemaLibrary.use().filter(s => s.kind === kind);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (saveSchema({ ...current(), name: n, kind })) {
      toast.success(`Saved schema "${n}"`);
      setName('');
    } else {
      toast.error('Could not save: browser storage is full.');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        aria-label="Schema name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); }}
        placeholder="Schema name"
        className="px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none w-36"
      />
      <Button variant="outline" size="sm" icon={<Save size={13} />} disabled={!canSave || !name.trim()} onClick={save}>Save schema</Button>
      <div className="relative">
        <Button variant="ghost" size="sm" icon={<BookMarked size={13} />} onClick={() => setOpen(o => !o)} disabled={!saved.length}>
          Load saved ({saved.length})
        </Button>
        {open && saved.length > 0 && (
          <div className="absolute z-20 mt-1 w-72 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-lg py-1">
            {saved.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-[var(--color-surface-2)]">
                <button className="text-left flex-1 min-w-0" onClick={() => { onLoad(s); setOpen(false); toast.success(`Loaded schema "${s.name}"`); }}>
                  <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{s.name}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {s.kind === 'relational' ? `${s.design?.tables.length ?? 0} tables` : `${s.columns?.length ?? 0} columns`}
                    {s.columnRules?.length ? ` · ${s.columnRules.length} rules` : ''} · {new Date(s.createdAt).toLocaleDateString()}
                  </p>
                </button>
                <button onClick={() => deleteSchema(s.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label={`Delete ${s.name}`}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
