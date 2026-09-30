'use client';

import React from 'react';
import { Table, Database, FileText, Sparkles } from 'lucide-react';

// Isometric "glass tile" illustration for the Overview hero. Pure CSS 3D + SVG (see .iso-* in
// globals.css), so it is sharp at any size and follows light/dark mode. Decorative only.

interface Tile {
  key: string;
  /** Centre of the tile on the (rotated) plane, in px. */
  x: number;
  y: number;
  size: number;
  icon: React.ReactNode;
  hub?: boolean;
  delay: string;
}

const TILES: Tile[] = [
  { key: 'tabular', x: 41, y: 267, size: 104, icon: <Table size={44} strokeWidth={1.75} />, delay: '0s' },
  { key: 'relational', x: 100, y: 58, size: 104, icon: <Database size={44} strokeWidth={1.75} />, delay: '-1.2s' },
  { key: 'hub', x: 263, y: 263, size: 132, icon: <Sparkles size={56} strokeWidth={1.75} />, hub: true, delay: '-0.6s' },
  { key: 'documents', x: 343, y: 103, size: 104, icon: <FileText size={44} strokeWidth={1.75} />, delay: '-1.8s' },
];

const hub = TILES.find(t => t.hub)!;

export function HeroIllustration() {
  return (
    <div className="iso-scene" aria-hidden="true">
      <svg className="iso-dots" width="96" height="72" viewBox="0 0 96 72">
        {Array.from({ length: 5 }, (_, r) => Array.from({ length: 7 }, (_, c) => (
          <circle key={`${r}-${c}`} cx={6 + c * 14} cy={6 + r * 14} r="1.6" />
        )))}
      </svg>
      <div className="iso-plane">
        <svg className="iso-links" width="400" height="400" viewBox="0 0 400 400">
          {TILES.filter(t => !t.hub).map(t => (
            <g key={t.key}>
              <line x1={t.x} y1={t.y} x2={hub.x} y2={hub.y} />
              <circle cx={(t.x + hub.x) / 2} cy={(t.y + hub.y) / 2} r="3.5" />
            </g>
          ))}
        </svg>
        {TILES.map(t => (
          <div
            key={t.key}
            className={`iso-tile${t.hub ? ' iso-tile-hub' : ''}`}
            style={{ left: t.x - t.size / 2, top: t.y - t.size / 2, width: t.size, height: t.size, animationDelay: t.delay }}
          >
            {t.icon}
          </div>
        ))}
      </div>
    </div>
  );
}
