import type { Metadata } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastProvider } from '@/components/common/Toast';
import './globals.css';

const description =
  'Generate realistic, privacy-safe synthetic tabular, relational, and document data for development and testing with AI-powered schema analysis and validation.';

export const metadata: Metadata = {
  title: { default: 'Synthra · Synthetic Data Platform', template: '%s' },
  description,
  robots: { index: false, follow: false },
  openGraph: { title: 'Synthra · Synthetic Data Platform', description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AppLayout>{children}</AppLayout>
        </ToastProvider>
      </body>
    </html>
  );
}
