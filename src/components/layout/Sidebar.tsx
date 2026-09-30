'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Logo } from '../common/Logo';
import {
  LayoutDashboard,
  Table,
  Database,
  FileText,
  History,
  Settings,
  HelpCircle,
  ChevronDown,
  Layers,
  FolderOpen,
  X,
  Gauge,
  Network,
} from 'lucide-react';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  /** Overrides the path-based check (used by Generate, which is only "the" page when no type is chosen). */
  active?: boolean;
}

function NavItem({ to, icon, label, end, active }: NavItemProps) {
  const pathname = usePathname();
  const isActive = active ?? (end ? pathname === to : pathname === to || pathname.startsWith(to + '/'));

  return (
    <Link
      href={to}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors ${
        isActive
          ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <p className="px-3 mb-1 mt-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
  );
}

const WORKSPACE_TYPES = [
  { type: 'tabular', label: 'Tabular', icon: <Table size={13} /> },
  { type: 'relational', label: 'Relational', icon: <Database size={13} /> },
  { type: 'documents', label: 'Documents', icon: <FileText size={13} /> },
];

/** Generate + its three sections. The section in ?type= is highlighted, so you can see where you are. */
function WorkspaceNav({ activeType }: { activeType: string | null }) {
  const pathname = usePathname();
  const inWorkspace = pathname.startsWith('/workspace');
  const current = inWorkspace ? activeType : null;
  return (
    <>
      <NavItem to="/workspace" icon={<Layers size={16} />} label="Generate" active={inWorkspace && !current} />
      <div className="ml-4 space-y-0.5 border-l border-[var(--color-border)] pl-2">
        {WORKSPACE_TYPES.map(t => {
          const isActive = current === t.type;
          return (
            <Link
              key={t.type}
              href={`/workspace?type=${t.type}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] text-xs transition-colors ${
                isActive
                  ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              {t.icon} {t.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function WorkspaceNavFromUrl() {
  const type = useSearchParams().get('type');
  const known = type === 'invoice' || type === 'bank_statement' ? 'documents' : type;
  return <WorkspaceNav activeType={known} />;
}


interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={`
          fixed left-0 top-0 bottom-0 z-50
          w-[var(--sidebar-width)] bg-[var(--color-surface)] border-r border-[var(--color-border)]
          flex flex-col
          md:relative md:translate-x-0 md:z-auto
          transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full invisible md:visible md:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-4 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <Link href="/" aria-label="Synthra home">
            <Logo />
          </Link>
          <button onClick={onClose} aria-label="Close menu" className="md:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        {/* Any link click closes the mobile menu (including ?type= links that keep the same path). */}
        <nav
          aria-label="Pages"
          className="flex-1 overflow-y-auto p-3 space-y-0.5"
          onClick={e => { if ((e.target as HTMLElement).closest('a')) onClose?.(); }}
        >
          <NavItem to="/" icon={<LayoutDashboard size={16} />} label="Overview" end />

          <NavSection label="Workspace" />
          <div className="space-y-0.5">
            <Suspense fallback={<WorkspaceNav activeType={null} />}>
              <WorkspaceNavFromUrl />
            </Suspense>
          </div>

          <NavSection label="Data" />
          <NavItem to="/datasets" icon={<FolderOpen size={16} />} label="Datasets" />
          <NavItem to="/relationships" icon={<Network size={16} />} label="Relationships" />
          <NavItem to="/quality" icon={<Gauge size={16} />} label="Quality" />
          <NavItem to="/history" icon={<History size={16} />} label="Generation History" />

          <div className="border-t border-[var(--color-border)] my-3" />

          <NavSection label="System" />
          <NavItem to="/settings" icon={<Settings size={16} />} label="Settings" />
          <NavItem to="/help" icon={<HelpCircle size={16} />} label="Help" />
        </nav>

        {/* User */}
        <div className="p-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-2)] cursor-pointer transition-colors">
            <div className="w-7 h-7 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-xs font-semibold shrink-0">
              TF
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">Techno Force</p>
              <p className="text-xs text-[var(--color-text-muted)] truncate">demo@synthra.io</p>
            </div>
            <ChevronDown size={13} className="text-[var(--color-text-muted)] shrink-0" />
          </div>
        </div>
      </aside>
    </>
  );
}
