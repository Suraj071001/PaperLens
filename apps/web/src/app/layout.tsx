import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'PaperLens — See the bigger picture',
  description: 'An evidence-grounded workspace to read, compare, and connect research papers.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
