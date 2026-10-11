# Connecting Meta, Google and TikTok ads

The app connects an ad platform the way merchants expect: **Connect** opens the platform's own sign-in, the
merchant approves read-only access, comes back, chooses which ad accounts to use, and the card shows
**Connected**. Spend then imports every day at 06:00 UTC and counts in profit. Nothing is ever changed in the
merchant's ad accounts.

A platform only shows a working **Connect** button once the server has that platform's app credentials. Until
then its card says "Not available yet". Each platform needs a developer app in **your** name, created once for
the whole product. Merchants never see these credentials.

## What you register with each platform

The **redirect address** is the same pattern everywhere. With the production address `https://app.yourdomain.com`:

| Platform | Redirect address to register                                     |
| -------- | ---------------------------------------------------------------- |
| Meta     | `https://app.yourdomain.com/api/v1/marketing/oauth/meta/callback`   |
| Google   | `https://app.yourdomain.com/api/v1/marketing/oauth/google/callback` |
| TikTok   | `https://app.yourdomain.com/api/v1/marketing/oauth/tiktok/callback` |

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
`ad-oauth.ts`, `meta.ts`, `google.ts` and `tiktok.ts`. Do it with a test ad account and watch the Marketing screen
and the worker log.

## Embedded app note

The sign-in cannot run inside the Shopify admin frame, so the Connect button opens it on the whole page
(`window.open(url, '_top')`). The platform returns to the API, which sends the merchant back into the app inside
the Shopify admin (`SHOPIFY_APP_HANDLE` must be set for that; otherwise it returns to `APP_URL/marketing`).
