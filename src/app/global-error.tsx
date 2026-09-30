'use client';

/** Last-resort error UI when the root layout itself fails; it replaces <html>, so it carries its own styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#F8FAFC', color: '#0F172A', margin: 0 }}>
        <div role="alert" style={{ maxWidth: 520, margin: '15vh auto', padding: 24, background: '#fff', border: '1px solid #FCA5A5', borderRadius: 8 }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Synthra hit an unexpected error</h1>
          <p style={{ fontSize: 14, color: '#475569' }}>{error.message || 'Unknown error.'} Your History, saved schemas and settings are stored in this browser and are safe.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: '8px 14px', background: '#6366F1', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
