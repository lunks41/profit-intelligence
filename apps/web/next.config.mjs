import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

// Load the repo-root .env (single source of configuration for all apps).
loadEnvConfig(fileURLToPath(new URL('../..', import.meta.url)));

const apiOrigin = `http://localhost:${process.env.API_PORT ?? 3001}`;

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // The API key is public by design (it is also in the App Bridge meta tag).
  env: { NEXT_PUBLIC_SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ?? '' },
  // Dev tunnels and Shopify Admin load the dev server from other origins.
  allowedDevOrigins: ['*.trycloudflare.com', '*.shopifyapps.com', '*.myshopify.com'],
  async rewrites() {
    // Same-origin proxy: the browser only talks to the web app; the API stays internal.
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Allow embedding only inside Shopify Admin.
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors https://admin.shopify.com https://*.myshopify.com',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};
