// Tells you which ad platforms can be connected on this server, without printing any value from .env.
// Run: pnpm ads:check   (it loads .env itself; only the names of missing variables and the redirect addresses are printed)

const PLATFORMS = [
  { id: 'meta', name: 'Meta Ads', vars: ['META_APP_ID', 'META_APP_SECRET'] },
  {
    id: 'google',
    name: 'Google Ads',
    vars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN'],
  },
  { id: 'tiktok', name: 'TikTok Ads', vars: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'] },
  {
    id: 'microsoft',
    name: 'Microsoft Ads',
    vars: [
      'MICROSOFT_ADS_CLIENT_ID',
      'MICROSOFT_ADS_CLIENT_SECRET',
      'MICROSOFT_ADS_DEVELOPER_TOKEN',
    ],
  },
  { id: 'snapchat', name: 'Snapchat Ads', vars: ['SNAPCHAT_CLIENT_ID', 'SNAPCHAT_CLIENT_SECRET'] },
  { id: 'pinterest', name: 'Pinterest Ads', vars: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'] },
  { id: 'reddit', name: 'Reddit Ads', vars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
];

// where the owner creates the app (and gets a developer token); these pages can move, search the platform if one does
const PORTALS = {
  meta: ['https://developers.facebook.com/apps/'],
  google: [
    'https://console.cloud.google.com/apis/credentials',
    'https://ads.google.com/aw/apicenter',
  ],
  tiktok: ['https://business-api.tiktok.com/portal/apps'],
  microsoft: [
    'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    'https://developers.ads.microsoft.com/Account',
  ],
  snapchat: ['https://business.snapchat.com'],
  pinterest: ['https://developers.pinterest.com/apps/'],
  reddit: ['https://www.reddit.com/prefs/apps', 'https://ads-api.reddit.com/docs/v3/'],
};

const out = (line = '') => process.stdout.write(`${line}\n`);
const env = process.env;
const appUrl = (env.APP_URL ?? '').trim().replace(/\/+$/, '');

out('Ad platforms');
out('============');
let problems = 0;
if (!appUrl) {
  problems++;
  out(
    'APP_URL      MISSING. Set it to the public https address of the app; no platform can be connected without it.',
  );
} else if (!/^https:\/\//.test(appUrl)) {
  problems++;
  out(
    `APP_URL      is set but is not https. Platforms only send merchants back to an https address.`,
  );
} else {
  out('APP_URL      set');
}
out();

for (const p of PLATFORMS) {
  const missing = p.vars.filter((v) => !(env[v] ?? '').trim());
  const ready = missing.length === 0 && /^https:\/\//.test(appUrl);
  out(`${p.name.padEnd(14)} ${ready ? 'READY: the Connect button is on' : 'not ready'}`);
  if (missing.length > 0) out(`               missing: ${missing.join(', ')}`);
  for (const link of PORTALS[p.id] ?? [])
    out(`               create the app / get the keys: ${link}`);
  if (appUrl)
    out(
      `               redirect address to register: ${appUrl}/api/v1/marketing/oauth/${p.id}/callback`,
    );
}
out();
out(
  'After changing .env, restart the API. Steps for each platform: docs/operations/ad-platforms.md',
);
process.exitCode = problems > 0 ? 1 : 0;
