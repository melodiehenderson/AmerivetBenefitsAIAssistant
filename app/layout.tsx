// Import server-side polyfills first
import '@/lib/polyfills/global-polyfills';

import { Toaster } from 'sonner';
import { getConfig } from '@/config/environments';
import { ClientProviders } from '@/components/client-providers';
import { NoSSR } from '@/components/no-ssr';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const { appUrl } = getConfig();

function safeMetadataBase(): URL {
  try {
    const val = (appUrl || '').trim();
    if (!val) return new URL('https://benefitsbot.com');
    return new URL(val);
  } catch {
    return new URL('https://benefitsbot.com');
  }
}

export const metadata = {
  metadataBase: safeMetadataBase(),
  title: 'AmeriVet Benefits AI Assistant',
  description: 'Your personal AmeriVet benefits advisor powered by AI',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export const viewport = {
  maximumScale: 1, // Disable auto-zoom on mobile Safari
};

const LIGHT_THEME_COLOR = 'hsl(0 0% 100%)';
const DARK_THEME_COLOR = 'hsl(240deg 10% 3.92%)';
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

const HYDRATION_FIX_SCRIPT = `\
(function() {
  // Remove browser extension attributes that cause hydration mismatches
  function cleanExtensionAttributes() {
    const elements = document.querySelectorAll('[bis_skin_checked], [bis_use], [data-bis-config]');
    elements.forEach(el => {
      el.removeAttribute('bis_skin_checked');
      el.removeAttribute('bis_use');
      el.removeAttribute('data-bis-config');
    });
  }
  
  // Run immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanExtensionAttributes);
  } else {
    cleanExtensionAttributes();
  }
  
  // Also run on DOM changes
  const observer = new MutationObserver(cleanExtensionAttributes);
  observer.observe(document.documentElement, { 
    attributes: true, 
    attributeFilter: ['bis_skin_checked', 'bis_use', 'data-bis-config'],
    subtree: true 
  });
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="shortcut icon" href="/favicon.png" type="image/png" />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: HYDRATION_FIX_SCRIPT,
          }}
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <NoSSR fallback={
          <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
            <div className="text-center">
              <div className="animate-spin rounded-full size-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900">Loading...</h2>
              <p className="text-gray-600">Preparing your Benefits AI Assistant</p>
            </div>
          </div>
        }>
          <ClientProviders>
            <Toaster position="top-center" />
            {children}
            <Analytics />
          </ClientProviders>
        </NoSSR>
      </body>
    </html>
  );
}
