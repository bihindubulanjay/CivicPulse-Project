import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CivicPulse — Sri Lanka Community Crisis & Nature Safety Network',
  description: 'Open-source, real-time community crisis, nature, and eco-tourism safety network. Zero-Fake telemetry for Sri Lanka monsoons, landslides, and coastal hazards.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><polygon points='50,8 90,26 90,72 50,94 10,72 10,26' fill='%2310B981'/><path d='M30,50 L42,50 L47,38 L53,62 L58,50 L70,50' stroke='white' stroke-width='6' fill='none'/></svg>",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="preloader-active antialiased">
        {children}
      </body>
    </html>
  );
}
