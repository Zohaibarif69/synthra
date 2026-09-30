'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import { Network, Play } from 'lucide-react';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { setDesign, useRelationalDesign } from '../lib/designStore';
import { EXAMPLE_RELATIONAL } from '../lib/mockData';
import { ErDiagram } from './relationships/ErDiagram';

export function Relationships() {
  const router = useRouter();
  const [design] = useRelationalDesign();

  if (!design.tables.length) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Network size={32} />}
          title="No tables defined yet"
          description="Create tables in the relational workspace to see them here as a diagram."
          action={{ label: 'Define tables', onClick: () => router.push('/workspace?type=relational') }}
        />
        <div className="flex justify-center -mt-8">
          <Button
            variant="ghost"
            size="sm"
            icon={<Play size={13} />}
            onClick={() => setDesign({
              tables: EXAMPLE_RELATIONAL.tables.map(t => ({ ...t, columns: t.columns.map(c => ({ ...c })) })),
              relationships: EXAMPLE_RELATIONAL.relationships.map(r => ({ ...r })),
              rules: EXAMPLE_RELATIONAL.rules.map(r => ({ ...r, terms: [...r.terms] })),
              sources: {},
            })}
          >
            Load example (customers → orders → order_items)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <ErDiagram />
    </ReactFlowProvider>
  );
}
