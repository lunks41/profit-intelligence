export interface PlatformMark {
  text: string;
  background: string;
  color?: string;
}

/** The round mark and colour of each advertising platform (letters in the colour of the brand, not its logo). */
export const PLATFORM_MARKS: Record<string, PlatformMark> = {
  meta: { text: 'f', background: '#1877f2' },
  google: { text: 'G', background: '#e8f0fe', color: '#1a73e8' },
  tiktok: { text: 'Tt', background: '#000000' },
  bing: { text: 'Ms', background: '#00809d' },
  snapchat: { text: 'Sn', background: '#fffc00', color: '#000000' },
  pinterest: { text: 'P', background: '#e60023' },
  reddit: { text: 'R', background: '#ff4500' },
};

/**
 * The mark for an ad account. A connected account knows its platform; an account whose spend is typed in by hand is
 * a "manual" one, so the platform is guessed from its name (Meta Ads, Google Ads...), otherwise it gets its initials.
 */
export function markFor(provider: string, name: string): PlatformMark {
  const known = PLATFORM_MARKS[provider];
  if (known) return known;
  const n = name.toLowerCase();
  if (/(meta|facebook|instagram)/.test(n)) return PLATFORM_MARKS.meta!;
  if (/google/.test(n)) return PLATFORM_MARKS.google!;
  if (/tiktok|tik tok/.test(n)) return PLATFORM_MARKS.tiktok!;
  if (/(bing|microsoft)/.test(n)) return PLATFORM_MARKS.bing!;
  if (/snap/.test(n)) return PLATFORM_MARKS.snapchat!;
  if (/pinterest/.test(n)) return PLATFORM_MARKS.pinterest!;
  if (/reddit/.test(n)) return PLATFORM_MARKS.reddit!;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return { text: initials || '?', background: '#e3e3e3', color: '#303030' };
}
