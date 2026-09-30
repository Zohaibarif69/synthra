import { Suspense } from 'react';
import { Workspace } from '@/views/Workspace';

export const metadata = { title: 'Workspace · Synthra' };

// Workspace reads search params, which requires a Suspense boundary in Next.js.
export default function Page() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
