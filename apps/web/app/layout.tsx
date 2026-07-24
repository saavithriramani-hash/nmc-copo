import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CO-PO Attainment — NMC',
  description: 'CO-PO attainment application, Nehru Memorial College (Autonomous)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
