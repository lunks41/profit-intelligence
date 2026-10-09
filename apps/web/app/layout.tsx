import type { ReactNode } from 'react';

export const metadata = { title: 'Profit Intelligence' };

const NAV = [
  ['/', 'Overview'],
  ['/profit', 'Profit'],
  ['/products', 'Products'],
  ['/marketing', 'Marketing'],
  ['/orders', 'Orders'],
  ['/expenses', 'Expenses'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="shopify-api-key" content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY} />
        {/* App Bridge must load synchronously and unmodified from Shopify's CDN. */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      </head>
      <body>
        <s-app-nav>
          {NAV.map(([href, label]) => (
            <s-link key={href} href={href}>
              {label}
            </s-link>
          ))}
        </s-app-nav>
        {children}
      </body>
    </html>
  );
}
