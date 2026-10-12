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

/** Which platform an account is: its own provider, or a guess from the name for a hand-entered one. */
export function platformKey(provider: string, name: string): string | null {
  if (PLATFORM_MARKS[provider]) return provider;
  const n = name.toLowerCase();
  if (/(meta|facebook|instagram)/.test(n)) return 'meta';
  if (/google/.test(n)) return 'google';
  if (/tiktok|tik tok/.test(n)) return 'tiktok';
  if (/(bing|microsoft)/.test(n)) return 'bing';
  if (/snap/.test(n)) return 'snapchat';
  if (/pinterest/.test(n)) return 'pinterest';
  if (/reddit/.test(n)) return 'reddit';
  return null;
}

const CHART_COLORS: Record<string, string> = {
  meta: '#1877f2',
  google: '#ea4335',
  tiktok: '#161823',
  bing: '#00809d',
  snapchat: '#e6c800',
  pinterest: '#e60023',
  reddit: '#ff4500',
};
const SPARE = ['#047b5d', '#8a3ffc', '#b98900', '#c4295c', '#007f9f'];

/** The colour of a channel in a chart: the colour of its platform, or one from a spare set. */
export function chartColor(provider: string, name: string, index: number): string {
  const key = platformKey(provider, name);
  return (key && CHART_COLORS[key]) || SPARE[index % SPARE.length]!;
}

/**
 * The mark for an ad account. A connected account knows its platform; an account whose spend is typed in by hand is
 * a "manual" one, so the platform is guessed from its name (Meta Ads, Google Ads...), otherwise it gets its initials.
 */
export function markFor(provider: string, name: string): PlatformMark {
  const key = platformKey(provider, name);
  if (key) return PLATFORM_MARKS[key]!;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return { text: initials || '?', background: '#e3e3e3', color: '#303030' };
}
