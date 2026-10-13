# A stable public address with a Cloudflare Tunnel

The ad platforms (Meta, Google, TikTok and the rest) send the merchant back to **one fixed https address** after
sign-in. That address is `APP_URL`, and each platform must have `APP_URL/api/v1/marketing/oauth/<platform>/callback`
registered. The temporary `trycloudflare.com` address that `shopify app dev` makes changes every run, so it cannot be
registered with a platform. A **named Cloudflare Tunnel** gives a hostname on your own domain that never changes.

One address is enough: the web app (port 3000) already proxies `/api/v1/*` to the API (port 3001), so the tunnel only
needs to point at the web app.

## Set it up (about ten minutes)

1. In the Cloudflare dashboard open **Zero Trust**, then **Networks**, then **Tunnels**, and **Create a tunnel**
   (type **Cloudflared**). Name it, for example, `profit-intelligence`.
2. Cloudflare shows an install command for your system. On Windows install `cloudflared`, then run the command it
   shows (it contains the tunnel token; do not paste it anywhere else). It can run as a Windows service, so the tunnel
   stays up.
3. Under **Public hostname** add one:
   - Subdomain and domain: for example `profit` on `archipelago.ae` (the domain must be on this Cloudflare account).
   - Service type **HTTP**, URL `localhost:3000`.
4. Put the address in `.env`: `APP_URL=https://profit.archipelago.ae` (no trailing slash).
5. Restart the API and run `pnpm ads:check`. It prints the redirect address of every platform with this host filled
   in. Paste those into each platform's app settings (see `ad-platforms.md`).

## Notes

- Keep the web app and the API running on the machine where the tunnel runs. In production the same hostname points at
  the server that hosts them.
- The Shopify app URL and redirect URLs in `shopify.app.toml` are a separate setting (the Shopify CLI manages them
  while you develop). Move them to this hostname when you deploy.
- Cloudflare terminates https for you, so the app sees the right scheme; HSTS is already sent in production.
- A tunnel makes the app reachable by anyone who knows the address. Sign-in to the app still needs a Shopify session,
  but do not leave a development database behind it for long.
