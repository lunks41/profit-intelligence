'use client';

import type { ReactNode } from 'react';

/**
 * The logos of the advertising platforms, drawn here as small vector images (no file is loaded from anywhere). Each
 * sits in a round tile: the colour of the brand for a one-colour logo, white with a thin edge for the multi-colour
 * ones (Google, Microsoft). They stand for the platforms in the lists; the marks belong to their owners.
 */
const TILE: Record<string, { background: string; edge?: boolean }> = {
  meta: { background: '#1877f2' },
  google: { background: '#ffffff', edge: true },
  tiktok: { background: '#000000' },
  bing: { background: '#ffffff', edge: true },
  snapchat: { background: '#fffc00' },
  pinterest: { background: '#e60023' },
  reddit: { background: '#ff4500' },
};

const GLYPH: Record<string, ReactNode> = {
  // the "f" of Facebook
  meta: (
    <path
      fill="#fff"
      d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21h2.9z"
    />
  ),
  google: (
    <>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.2 21.3 7.26 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.26 0 3.2 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </>
  ),
  // the note of TikTok, with its two offset colours
  tiktok: (
    <>
      <path
        fill="#25f4ee"
        d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z"
        transform="translate(-.6 -.5)"
      />
      <path
        fill="#fe2c55"
        d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z"
        transform="translate(.6 .5)"
      />
      <path
        fill="#fff"
        d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z"
      />
    </>
  ),
  // the four squares of Microsoft
  bing: (
    <>
      <rect x="3" y="3" width="8.4" height="8.4" fill="#f25022" />
      <rect x="12.6" y="3" width="8.4" height="8.4" fill="#7fba00" />
      <rect x="3" y="12.6" width="8.4" height="8.4" fill="#00a4ef" />
      <rect x="12.6" y="12.6" width="8.4" height="8.4" fill="#ffb900" />
    </>
  ),
  // the ghost of Snapchat, in outline
  snapchat: (
    <path
      fill="#fff"
      stroke="#000"
      strokeWidth="1.3"
      strokeLinejoin="round"
      d="M12 3.2c-2.5 0-4.2 1.8-4.2 4.3v2.2c-.5.2-1.1.3-1.7.3.2.5.8.9 1.6 1.1-.3.9-1 1.6-1.9 2.2.5.3 1.2.5 2 .6.2.5.5.9.9 1.1-.4.5-1 .8-1.8 1l.2.8c.8.2 1.6.4 2.2.8.5.3 1.2.6 2.7.6s2.2-.3 2.7-.6c.6-.4 1.4-.6 2.2-.8l.2-.8c-.8-.2-1.4-.5-1.8-1 .4-.2.7-.6.9-1.1.8-.1 1.5-.3 2-.6-.9-.6-1.6-1.3-1.9-2.2.8-.2 1.4-.6 1.6-1.1-.6 0-1.2-.1-1.7-.3V7.5c0-2.5-1.7-4.3-4.2-4.3z"
    />
  ),
  pinterest: (
    <text
      x="12"
      y="17.6"
      textAnchor="middle"
      fontSize="16"
      fontWeight="700"
      fontFamily="Arial, Helvetica, sans-serif"
      fill="#fff"
    >
      P
    </text>
  ),
  reddit: (
    <>
      <ellipse cx="12" cy="14" rx="7.2" ry="5" fill="#fff" />
      <circle cx="5.2" cy="11.2" r="1.7" fill="#fff" />
      <circle cx="18.8" cy="11.2" r="1.7" fill="#fff" />
      <circle cx="9.3" cy="13.2" r="1.3" fill="#ff4500" />
      <circle cx="14.7" cy="13.2" r="1.3" fill="#ff4500" />
      <path
        d="M9.2 16.1c.9.8 4.7.8 5.6 0"
        fill="none"
        stroke="#ff4500"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M12 9.1l.9-4.1 3.200.8"
        fill="none"
        stroke="#fff"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.100" cy="5.700" r="1.2" fill="#fff" />
    </>
  ),
};

export function hasLogo(platform: string | null | undefined): platform is string {
  return !!platform && platform in GLYPH;
}

/** The logo of an advertising platform in its round tile; `size` is the width in rem. */
export function PlatformLogo({ platform, size = 2.5 }: { platform: string; size?: number }) {
  const tile = TILE[platform];
  const glyph = GLYPH[platform];
  if (!tile || !glyph) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        width: `${size}rem`,
        height: `${size}rem`,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tile.background,
        boxShadow: tile.edge ? 'inset 0 0 0 1px #e3e3e3' : 'none',
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: '62%', height: '62%' }}>
        {glyph}
      </svg>
    </span>
  );
}
