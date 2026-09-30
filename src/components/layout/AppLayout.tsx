'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '../common/ErrorBoundary';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  // Navigating from the mobile menu closes it.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileMenuOpen(false);
  }
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:bg-[var(--color-surface)] focus:rounded focus:shadow">
        Skip to content
      </a>
      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar menuOpen={mobileMenuOpen} onMenuClick={() => setMobileMenuOpen(true)} />
        <main id="main" className="flex-1 overflow-auto" tabIndex={-1}>
          {/* A new boundary per route, so an error on one page doesn't stick when navigating away. */}
          <ErrorBoundary key={pathname} area="this page">
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
