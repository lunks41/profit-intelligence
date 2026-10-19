/** The name of each advertising platform as the merchant reads it. */
export const AD_PLATFORM_NAME: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
  microsoft: 'Microsoft Ads',
  snapchat: 'Snapchat Ads',
  pinterest: 'Pinterest Ads',
  reddit: 'Reddit Ads',
};

/**
 * The platforms offered to merchants. Only the ones tested with a real account are on at launch; the others stay
 * built but hidden until they are verified. Set NEXT_PUBLIC_AD_PLATFORMS (comma separated, at build time) to
 * change it, for example "meta,google,tiktok".
 */
export const ENABLED_AD_PLATFORMS: string[] = (
  process.env.NEXT_PUBLIC_AD_PLATFORMS ?? 'meta,google'
)
  .split(',')
  .map((p) => p.trim())
  .filter((p) => p in AD_PLATFORM_NAME);

/** "Meta, Google and TikTok" for text on screens. */
export function enabledPlatformNames(): string {
  const names = ENABLED_AD_PLATFORMS.map((p) => AD_PLATFORM_NAME[p]!.replace(/ Ads$/, ''));
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names[0] ?? 'your ad platforms');
}
