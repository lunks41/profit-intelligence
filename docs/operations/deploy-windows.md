# Publishing to your own Windows server (IIS)

Target: `https://profit.archipelago.ae`, on the server at `\\172.16.31.6\d$\Proj\profit-intelligence`, with PostgreSQL
on the same machine. This follows how your other sites there run (IIS in front, Node behind it).

**Why not Docker:** the Docker on that server is the Windows-container engine (it keeps `windowsfilter` images), so the
Linux images this app would need (Node, Postgres) cannot run on it. Node and PostgreSQL 18 are already installed there,
so the app runs on them directly.

## What runs where

| Part                                       | How it runs                                                                                                                                | Port                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Web app (the screens)                      | An IIS site `profit-intelligence` with HttpPlatformHandler, https on `profit.archipelago.ae` using your `*.archipelago.ae` certificate     | 443 (public), a private port behind it |
| API                                        | A startup task `ProfitIntelligence-Api` (runs as SYSTEM, restarts if it stops)                                                             | 3001, this machine only                |
| Worker (imports, ad sync, reports, emails) | A startup task `ProfitIntelligence-Worker`                                                                                                 | 3002, this machine only                |
| Database                                   | The PostgreSQL 18 on the server: database `profit_intelligence`, owner `postgres`, app login `app_user` (row level security applies to it) | 5432                                   |

The web app forwards `/api/v1/*` to the API, so only the web site is public. Do not open 3001 or 3002 in the firewall.

## 1. On your PC: build the release

```powershell
pnpm pack:deploy
```

It builds everything and writes `.deploy\profit-intelligence-deploy.zip` (the web, API and worker, each self-contained,
plus the install scripts). It contains no secrets.

## 2. Copy it to the server

Copy the zip to `D:\Proj\profit-intelligence\` on the server and unzip it there, so you get
`D:\Proj\profit-intelligence\app\` (with `install.ps1` inside):

```powershell
cd D:\Proj\profit-intelligence
tar -xf profit-intelligence-deploy.zip
```

## 3. On the server (RDP), once: install

In an elevated PowerShell:

```powershell
cd D:\Proj\profit-intelligence\app
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

It asks for three things and never prints them: the PostgreSQL `postgres` password, the Shopify app Client ID and the
Shopify Client secret. It generates everything else (the token encryption key and the `app_user` password) into
`app\.env`, readable only by administrators. **Keep a copy of `TOKEN_ENCRYPTION_KEY` somewhere safe**: without it the
stored Shopify tokens cannot be read.

If another IIS site already holds the host name profit.archipelago.ae (an old placeholder site, for example), IIS refuses to start ours ("Cannot create a file when that file already exists"). The script says which site it is; run it again with `-TakeOverBinding` to move the host name to the new site, or remove the binding from the old site in IIS Manager.

Then it creates the database and tables, starts the API and worker, and creates the IIS site with the https binding
for `profit.archipelago.ae` (it finds your wildcard certificate; if it cannot, add the binding in IIS Manager).

Use a **new Shopify app client secret** for production (the old one was exposed and should be rotated; see
`docs/security/security-review.md`).

## 4. What only you can do

1. **DNS:** create the record `profit.archipelago.ae` pointing at the server's public address, and forward port 443 to
   the server (the same way `web.archipelago.ae` is reached).
2. **Check:** open `https://profit.archipelago.ae/api/health` from outside.
3. **Shopify:** in `shopify.app.toml` on your PC set `application_url` and the redirect URLs to
   `https://profit.archipelago.ae`, then run `shopify app deploy` when you are ready (it is not run for you).
4. **Ad platforms:** `APP_URL` is already `https://profit.archipelago.ae`. Register the redirect addresses with each
   platform (`docs/operations/ad-platforms.md`) and add each platform's keys to `app\.env`, then restart the API
   (`Stop-ScheduledTask`/`Start-ScheduledTask -TaskName ProfitIntelligence-Api`). `node --env-file=.env ads-check.mjs`
   in the `app` folder shows which are ready.
5. **Billing, email, backups:** see `deployment-checklist.md` (SMTP, billing mode, plan prices, backups to another
   machine).

## Updating later

On your PC run `pnpm pack:deploy`, copy and unzip the new zip **over** `D:\Proj\profit-intelligence\app` (the zip has no
`.env` and no logs, so they stay), take a database backup, then on the server:

```powershell
cd D:\Proj\profit-intelligence\app
powershell -ExecutionPolicy Bypass -File .\update.ps1
```

It stops the API and worker, applies new migrations, starts them again and restarts the web site.

## Logs and trouble

- `app\logs\api.log`, `worker.log` and `web*.log`.
- The web site shows a 502 when the web app cannot start: read `logs\web*.log` (a missing `.env` or a wrong Node path
  are the usual causes).
- Starting refuses an unsafe production setting and lists it (`NODE_ENV`, `APP_URL`, the encryption key, database TLS).
  The database connection here is not TLS because the database is on the same machine, so the install sets
  `ALLOW_INSECURE_DB=true`; if you ever move the database to another machine, remove that and use TLS.

Status: the install and update scripts, the IIS config and the packaging were written and checked for syntax only. They
have **not been run on the server**. Expect to fix small things on the first run; read the message the script prints.
