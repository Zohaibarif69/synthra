'use client';

import React, { Suspense } from 'react';
import { Menu, Bell, HelpCircle, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface TopBarProps {
  onMenuClick: () => void;
  menuOpen?: boolean;
}

const breadcrumbMap: Record<string, string> = {
  '': 'Overview',
  'workspace': 'Workspace',
  'history': 'Generation History',
  'datasets': 'Datasets',
  'quality': 'Quality Observatory',
  'relationships': 'Relationships',
  'settings': 'Settings',
  'help': 'Help',
};

function Breadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parts = pathname.split('/').filter(Boolean);
  const typeParam = searchParams.get('type');

  const crumbs: { label: string; to?: string }[] = [
    { label: 'Synthra', to: '/' },
  ];

  if (parts.length === 0) {
    crumbs.push({ label: 'Overview' });
  } else {
    parts.forEach((p, i) => {
      const label = breadcrumbMap[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
      const to = '/' + parts.slice(0, i + 1).join('/');
      crumbs.push({ label, to: i < parts.length - 1 ? to : undefined });
    });
    if (typeParam) {
      const typeLabels: Record<string, string> = { tabular: 'Tabular', relational: 'Relational', documents: 'Documents' };
      if (typeLabels[typeParam]) {
        crumbs.push({ label: typeLabels[typeParam] });
      }
    }
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm min-w-0 truncate [&>a:first-child]:hidden sm:[&>a:first-child]:inline [&>svg:nth-child(2)]:hidden sm:[&>svg:nth-child(2)]:inline">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={13} className="text-[var(--color-text-muted)]" />}
          {c.to ? (
            <Link href={c.to} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
              {c.label}
            </Link>
          ) : (
            <span className="text-[var(--color-text-secondary)] font-medium">{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function TopBar({ onMenuClick, menuOpen = false }: TopBarProps) {

  return (
    <header className="h-[var(--topbar-height)] bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between px-4 gap-2 sm:gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <button
          onClick={onMenuClick}
          className="md:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <Menu size={20} />
        </button>
        <Suspense>
          <Breadcrumbs />
        </Suspense>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/history" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors" aria-label="Generation history" title="Generation history">
          <Bell size={17} />
        </Link>
        <Link href="/help" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors" aria-label="Help" title="Help">
          <HelpCircle size={17} />
        </Link>
        <div aria-hidden className="hidden sm:flex w-7 h-7 rounded-full bg-[var(--color-primary)] items-center justify-center text-white text-xs font-semibold">
          TF
        </div>
      </div>
    </header>
  );
}
