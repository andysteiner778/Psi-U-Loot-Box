import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Psi U Loot Box',
  description: 'Moving-out mystery boxes',
  // Private link, not a public site. Keep it out of search results.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Psi U Loot Box', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#0f1117',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh`}>
        {children}
      </body>
    </html>
  );
}
