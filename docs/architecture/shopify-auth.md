# Shopify installation and authentication (Phase 3)

## Four separate mechanisms

| What                      | Mechanism                                                                         | Where          |
| ------------------------- | --------------------------------------------------------------------------------- | -------------- |
| Install                   | Managed installation: scopes come from `shopify.app.toml`, no OAuth redirect code | Shopify        |
| Embedded session          | App Bridge ID token (JWT, HS256, signed with the app secret, about 60 s)          | browser to api |
| Backend access to Shopify | Offline access token from **token exchange** (non-expiring, `expiring=false`)     | api to Shopify |
| Webhooks                  | HMAC of the raw body (Phase 5)                                                    | Shopify to api |

## Request flow

1. The embedded page loads App Bridge from Shopify's CDN (meta `shopify-api-key` plus `app-bridge.js`).
2. `window.shopify.idToken()` gives a fresh token; the page calls `/api/v1/*` on its own origin with `Authorization: Bearer <token>`. Next.js rewrites `/api/v1/*` to the api, so the api is never public on its own.
3. `SessionGuard` verifies signature, expiry, `aud == SHOPIFY_API_KEY`, and that `dest` and `iss` name the same `*.myshopify.com` host.
4. The tenant is resolved from the verified shop domain (`resolveTenantByShopDomain`, the only RLS bootstrap lookup). **No tenant or shop id is ever read from the request.**
5. Unknown shop (or an uninstalled one coming back): token exchange, `shop { name currencyCode ianaTimezone }` query, then an idempotent `installShop` that creates tenant, shop and credential in one transaction. Concurrent first requests are safe (unique constraint, loser re-reads).
6. Known active shop: no call to Shopify.

## Secrets

- Access tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, key id stored per row for rotation) before storage, and are never returned by any endpoint.
- `@shopify/shopify-api` puts the raw token into its error messages, so the wrapper discards library errors and throws a generic `AuthError`. Do not log library error text.
- API key is public (meta tag). API secret and encryption key live only in `.env` / deployment secrets.

## Local development

1. Fill `.env` (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `TOKEN_ENCRYPTION_KEY`).
2. `pnpm db:up` (optional) and `pnpm db:setup`.
3. Terminal 1: `pnpm dev:api`. Terminal 2: `pnpm shopify:dev` (logs in to Shopify, opens a tunnel, updates the app URL, starts the web app).
4. Open the app from the dev store admin (Apps, Profit Intelligence).

## Decisions and open items

- Non-expiring offline token chosen to avoid refresh concurrency. Revisit if Shopify requires expiring tokens for App Store review.
- `frame-ancestors` allows `https://*.myshopify.com` and `https://admin.shopify.com`. Per-shop restriction can be added later.
- Verified live on 2026-10-09: install, token exchange and the embedded UI work in the dev store. `shopify.web.toml` (frontend role only) works, but the web dev script must read `PORT` (the CLI assigns a random port), so do not hardcode `-p`.
- Next.js verdict: Option 1 (Next.js client plus separate API) is confirmed viable. No fallback to the React Router template is needed.
- The api must be started separately (`pnpm dev:api`); the web app proxies `/api/v1` to it.
- Webhook subscriptions and compliance topics: Phase 5.
