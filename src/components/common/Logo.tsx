import React from 'react';

/**
 * Synthra mark: a four-point sparkle (✦) on an indigo→violet tile, matching the hero's hub tile.
 * The same drawing is used for the browser tab icon (src/app/icon.svg).
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-bg)`} />
      <path d="M15 6c.7 5.4 3.6 8.3 9 9-5.4.7-8.3 3.6-9 9-.7-5.4-3.6-8.3-9-9 5.4-.7 8.3-3.6 9-9Z" fill="#fff" />
      <path d="M23.5 5.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z" fill="#fff" opacity=".75" />
    </svg>
  );
}

/** Mark + wordmark, as shown in the sidebar. */
export function Logo({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={30} />
      <div className="leading-tight">
        <span className="block font-bold text-[15px] tracking-tight text-[var(--color-text-primary)]">Synthra</span>
        {subtitle && <span className="block text-[11px] text-[var(--color-text-muted)]">Synthetic Data Platform</span>}
      </div>
    </div>
  );
}
