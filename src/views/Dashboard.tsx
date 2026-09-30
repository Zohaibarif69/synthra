'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Table, Database, FileText, Sparkles, ArrowRight, Play } from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/Badge';
import { historyStore } from '../lib/historyStore';
import { schemaLibrary } from '../lib/schemaLibrary';
import { formatNumber, formatRelativeTime } from '../lib/formatters';
import { HeroIllustration } from '../components/common/HeroIllustration';

function HeroSection({ onDemo }: { onDemo: () => void }) {
  const router = useRouter();
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-6">
      <div className="hero-card flex items-center justify-between gap-6 px-6 py-8 md:px-10 md:py-10">
      <div className="relative z-10 max-w-2xl">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-[var(--color-surface)]/70 text-[var(--color-primary)] font-medium mb-4 border border-[var(--color-primary)]/25">
          <Sparkles size={12} />
          AI-Powered Synthetic Data Generation
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--color-text-primary)] leading-tight mb-3 tracking-tight">
          Generate realistic synthetic data.<br />
          <span className="text-[var(--color-primary)]">Safely. Instantly.</span>
        </h1>
        <p className="text-base text-[var(--color-text-secondary)] mb-6 leading-relaxed">
          Create privacy-safe tabular, relational and document data for development, testing and demos.
          No real production records required.
        </p>
        <div className="flex gap-3 flex-wrap">
          <Button
            size="lg"
            icon={<Sparkles size={15} />}
            onClick={() => router.push('/workspace')}
          >
            Create Dataset
          </Button>
          <Button variant="outline" size="lg" onClick={() => router.push('/workspace')}>
            Explore Workspace
          </Button>
          <Button
            variant="ghost"
            size="lg"
            icon={<Play size={14} />}
            onClick={onDemo}
          >
            Try Demo
          </Button>
        </div>
      </div>
      <div className="relative z-10 hidden xl:block shrink-0 -my-6 mr-2">
        <HeroIllustration />
      </div>
      </div>
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function StatsRow() {
  const entries = historyStore.use();
  const schemas = schemaLibrary.use();
  // Snapshot "now" once per render cycle for the weekly count.
  const [now] = React.useState(() => Date.now());
  const datasets = new Set(entries.map(e => e.fingerprint)).size;
  const rows = entries.reduce((a, e) => a + e.rowCount, 0);
  const thisWeek = entries.filter(e => now - Date.parse(e.createdAt) < WEEK_MS).length;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Datasets Generated"
        value={datasets.toLocaleString()}
        icon={<Database size={16} />}
        trend={thisWeek ? `${thisWeek} run${thisWeek === 1 ? '' : 's'} this week` : 'None this week'}
      />
      <StatCard
        label="Rows Generated"
        value={formatNumber(rows)}
        icon={<Table size={16} />}
        trend="Across all runs"
      />
      <StatCard
        label="Generation Jobs"
        value={entries.length.toLocaleString()}
        icon={<Sparkles size={16} />}
        trend="Completed runs, incl. regenerations"
      />
      <StatCard
        label="Saved Schemas"
        value={schemas.length.toLocaleString()}
        icon={<FileText size={16} />}
        trend="Reusable templates"
      />
    </div>
  );
}

interface GenerationCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  to: string;
  badge?: string;
}

function GenerationCard({ icon, title, description, cta, to, badge }: GenerationCardProps) {
  const router = useRouter();
  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6 hover:border-[var(--color-primary)]/50 hover:shadow-sm transition-all cursor-pointer group"
      onClick={() => router.push(to)}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 bg-[var(--color-primary-light)] rounded-[var(--radius-md)] text-[var(--color-primary)]">
          {icon}
        </div>
        {badge && (
          <span className="text-xs px-2 py-0.5 bg-[var(--color-success-bg)] text-[var(--color-success)] rounded font-medium">{badge}</span>
        )}
      </div>
      <h3 className="font-semibold text-[var(--color-text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4 leading-relaxed">{description}</p>
      <Link href={to} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-sm text-[var(--color-primary)] font-medium group-hover:gap-2.5 transition-all">
        {cta} <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

function RecentHistory() {
  const router = useRouter();
  const recent = historyStore.use().slice(0, 5);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent Generations</h2>
        <button
          className="text-xs text-[var(--color-primary)] hover:underline"
          onClick={() => router.push('/history')}
        >
          View all
        </button>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <th className="text-left px-5 py-3 font-medium">Name</th>
            <th className="text-left px-3 py-3 font-medium hidden sm:table-cell">Type</th>
            <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Rows</th>
            <th className="text-left px-3 py-3 font-medium">Created</th>
            <th className="text-left px-3 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {!recent.length && (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
                No generations yet — create a dataset and it will appear here.
              </td>
            </tr>
          )}
          {recent.map(gen => (
            <tr
              key={gen.id}
              className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] cursor-pointer transition-colors"
              onClick={() => router.push(`/history`)}
            >
              <td className="px-5 py-3">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{gen.name}</span>
              </td>
              <td className="px-3 py-3 hidden sm:table-cell">
                <span className="text-xs text-[var(--color-text-secondary)] capitalize">{gen.type.replace('_', ' ')}</span>
              </td>
              <td className="px-3 py-3 hidden md:table-cell">
                <span className="text-sm font-mono text-[var(--color-text-secondary)]">{gen.rowCount.toLocaleString()}</span>
              </td>
              <td className="px-3 py-3">
                <span className="text-xs text-[var(--color-text-muted)]">{formatRelativeTime(gen.createdAt)}</span>
              </td>
              <td className="px-3 py-3">
                <StatusBadge status="completed" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();

  const handleDemo = () => {
    router.push('/workspace?demo=true&type=relational');
  };

  return (
    <div className="flex flex-col min-h-full">
      <HeroSection onDemo={handleDemo} />
      <div className="flex-1 p-6 lg:p-8 space-y-8 max-w-[1400px] mx-auto w-full">
        <StatsRow />

        {/* Generation type cards */}
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">Generate Data</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GenerationCard
              icon={<Table size={20} />}
              title="Tabular Data"
              description="Generate realistic CSV/JSON-style datasets from schemas or sample data. Supports custom distributions, PII masking, and edge cases."
              cta="Generate Tabular"
              to="/workspace?type=tabular"
            />
            <GenerationCard
              icon={<Database size={20} />}
              title="Relational Data"
              description="Generate connected multi-table datasets with referential integrity. Visualize relationships and configure cardinality."
              cta="Generate Relational"
              to="/workspace?type=relational"
              badge="Multi-table"
            />
            <GenerationCard
              icon={<FileText size={20} />}
              title="Documents"
              description="Generate realistic invoices and bank statements with consistent values, regional formatting, and correct totals."
              cta="Generate Documents"
              to="/workspace?type=documents"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RecentHistory />
          </div>
          <div className="space-y-4">
            {/* Quick actions */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Quick Start</h3>
              <div className="space-y-2">
                {[
                  { label: 'Upload CSV and generate similar data', to: '/workspace?type=tabular', icon: <Table size={14} /> },
                  { label: 'Try the demo e-commerce dataset', to: '/workspace?demo=true&type=relational', icon: <Play size={14} /> },
                  { label: 'Generate 100 sample invoices', to: '/workspace?type=documents&doc=invoice', icon: <FileText size={14} /> },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => router.push(item.to)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-[var(--radius-md)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] text-left transition-colors"
                  >
                    <span className="text-[var(--color-primary)] shrink-0">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Privacy notice */}
            <div className="bg-[var(--color-success-bg)] border border-[var(--color-success)]/20 rounded-[var(--radius-lg)] p-4">
              <p className="text-xs font-semibold text-[var(--color-success)] mb-1">Privacy First</p>
              <p className="text-xs text-[var(--color-success)]/80 leading-relaxed">
                All generated data is fully synthetic. No real production records required. PII fields are automatically detected and protected.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
