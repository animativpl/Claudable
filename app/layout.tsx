import './globals.css'
import 'highlight.js/styles/github-dark.css'
import GlobalSettingsProvider from '@/contexts/GlobalSettingsContext'
import Header from '@/components/layout/Header'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Claudable',
  description: 'Claudable Application',
  icons: {
    icon: '/Claudable_Icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <GlobalSettingsProvider>
          <Header />
          <main>{children}</main>
        </GlobalSettingsProvider>
      </body>
    </html>
  );
}
