# Connecting ad platforms: Meta, Google, TikTok, Microsoft, Snapchat, Pinterest and Reddit

The app connects an ad platform the way merchants expect: **Connect** opens the platform's own sign-in, the
merchant approves read-only access, comes back, chooses which ad accounts to use, and the card shows
**Connected**. Spend then imports every day at 06:00 UTC and counts in profit. Nothing is ever changed in the
merchant's ad accounts.

A platform only shows a working **Connect** button once the server has that platform's app credentials. Until
then its card says "Not available yet". Each platform needs a developer app in **your** name, created once for
the whole product. Merchants never see these credentials.

Run `pnpm ads:check` at any time: it lists which platforms are ready, which variables are missing (names only, never values) and the redirect address to register for each.

## What you register with each platform

The **redirect address** is the same pattern everywhere. With the production address `https://app.yourdomain.com`:

| Platform  | Redirect address to register                                           |
| --------- | ---------------------------------------------------------------------- |
| Meta      | `https://app.yourdomain.com/api/v1/marketing/oauth/meta/callback`      |
| Google    | `https://app.yourdomain.com/api/v1/marketing/oauth/google/callback`    |
| TikTok    | `https://app.yourdomain.com/api/v1/marketing/oauth/tiktok/callback`    |
| Microsoft | `https://app.yourdomain.com/api/v1/marketing/oauth/microsoft/callback` |
| Snapchat  | `https://app.yourdomain.com/api/v1/marketing/oauth/snapchat/callback`  |
| Pinterest | `https://app.yourdomain.com/api/v1/marketing/oauth/pinterest/callback` |
| Reddit    | `https://app.yourdomain.com/api/v1/marketing/oauth/reddit/callback`    |

`APP_URL` in `.env` must be that same public `https://` address. Without it no platform can be connected.

### Meta (Facebook and Instagram ads)

1. Create an app at developers.facebook.com (type **Business**) and add the **Marketing API** product.
2. Under Facebook Login for Business (or Facebook Login), add the redirect address above as a valid OAuth redirect.
3. Request the **`ads_read`** permission. Meta requires App Review and Business Verification before merchants
   other than your own team can sign in. Until it is approved, only people with a role on the app can connect.
4. Put the App ID and App Secret in `.env`: `META_APP_ID`, `META_APP_SECRET`.

The app asks only for `ads_read`. It exchanges the sign-in for a long-lived token (about 60 days) and renews it in
its last week. If renewal fails after the token has ended, the card shows "Needs attention" and the merchant signs
in again.

### Google Ads

1. In Google Cloud, create a project, enable the **Google Ads API**, and create an **OAuth client ID** (Web
   application) with the redirect address above. Configure the consent screen; the scope is
   `https://www.googleapis.com/auth/adwords`, which Google treats as sensitive and verifies.
2. Apply for a **Google Ads developer token** in a Google Ads manager account (API Center). A test token only works
   with test accounts; production needs Basic or Standard access approved by Google.
3. Put them in `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`.

Google access tokens last about an hour, so the sign-in keeps a refresh token (stored encrypted) and the daily job
renews the access token before importing. Manager (agency) accounts are not offered because they hold no spend.

### TikTok Ads

1. Create a developer app at business-api.tiktok.com (TikTok for Business, Marketing API) and add the redirect
   address above. TikTok reviews the app before other advertisers can authorize it.
2. Put the App ID and Secret in `.env`: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`.

A TikTok advertiser token does not expire until the advertiser revokes it. TikTok purchase value is not imported:
it depends on a pixel the merchant may not have, so reported sales stay empty (unknown, not zero).

### Microsoft Advertising (Bing)

1. Register an app in the Microsoft Entra admin center (App registrations), account type "any organizational
   directory and personal Microsoft accounts", with the redirect address above and a client secret.
2. Apply for a **developer token** in the Microsoft Advertising web app (Tools, API Center); production needs
   Standard access.
3. Put them in `.env`: `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET`, `MICROSOFT_ADS_DEVELOPER_TOKEN`.

The scope is `https://ads.microsoft.com/msads.manage offline_access`. Microsoft hands out a new refresh token every
time one is used; the daily job stores the new one. An account is saved as `customerId:accountId`. The importer asks
for a daily campaign report (SOAP), waits for it, downloads the zip and reads the CSV. **This is the most likely
integration to need a fix on its first real account.**

### Snapchat Ads

1. Create an app in Snapchat Business Manager (Business Details, OAuth Apps) with the redirect address above.
2. Put the Client ID and Secret in `.env`: `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`. Scope: `snapchat-marketing-api`.

Access tokens last about 30 minutes and are renewed with the refresh token before each import. Spend is reported in
millionths and converted. Day boundaries follow UTC; Snapchat expects the ad account's own time zone, so a day's
figures can differ slightly until verified.

### Pinterest Ads

1. Create an app at developers.pinterest.com and request access to the Ads API (scope `ads:read`). Add the redirect
   address above.
2. Put the App ID and Secret in `.env`: `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`.

Pinterest spend is imported per ad account per day, without campaign names.

### Reddit Ads

1. Create an app at reddit.com/prefs/apps (type web app) with the redirect address above, and ask for Ads API
   access. Scope: `adsread`, permanent duration.
2. Put the client id and secret in `.env`: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`.

Reddit access tokens last an hour and are renewed with the permanent refresh token. Spend is reported in millionths.
**Reddit is the least certain integration**: the Ads API v3 addresses and field names are from its public documentation
and have not met a real account.

Pinterest, Snapchat, Reddit and Microsoft import reported sales as empty (unknown, not zero), like TikTok.

## How the connection is kept

- After sign-in the tokens and the visible ad accounts wait in `f_ad_connection_pending` for 30 minutes (row level
  security, deleted once used or cancelled). The merchant chooses accounts; each becomes an ad account with the
  tokens stored **encrypted** (the same key as the Shopify token).
- **Disconnect** archives the account, erases its tokens, and keeps the spend already imported.
- The `state` sent to the platform is encrypted and expires in 10 minutes; a tampered, expired or wrong-platform
  state is refused and nothing is stored.
- Platform answers are never copied into messages or logs (they can echo tokens).
- The plan's ad-account limit applies when accounts are chosen.

## Testing without a platform

All tests use a fake HTTP client (`apps/api/src/marketing/ad-oauth.test.ts`, `ad-connect.integration.test.ts`,
`apps/worker/src/ads/*.test.ts`). **They have not been run against the real platforms.** The first real
connection, with real credentials, is the first true test of the platform-specific addresses and field names in
`ad-oauth.ts`, `ad-oauth-more.ts`, and the importers in `apps/worker/src/ads` (`meta`, `google`, `tiktok`, `microsoft`, `snapchat`, `pinterest`, `reddit`). Do it with a test ad account and watch the Marketing screen
and the worker log.

## Embedded app note

The sign-in cannot run inside the Shopify admin frame, so the Connect button opens it on the whole page
(`window.open(url, '_top')`). The platform returns to the API, which sends the merchant back into the app inside
the Shopify admin (`SHOPIFY_APP_HANDLE` must be set for that; otherwise it returns to `APP_URL/marketing`).
