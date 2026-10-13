import type { FoundAdAccount } from '@pi/db';
import type { AdOAuthConfig, Tokens } from './ad-oauth.js';
import { OAuthError } from './ad-oauth.js';

/**
 * Sign-in for Microsoft Ads, Snapchat, Pinterest and Reddit. Written from each platform's public documentation and
 * tested only against fakes: the first real sign-in needs the owner's developer app for the platform, and anything a
 * platform answers differently from what is assumed here shows up then. Microsoft and Reddit are the least certain.
 */
export type MoreProvider = 'microsoft' | 'snapchat' | 'pinterest' | 'reddit';
export const MORE_PROVIDERS: MoreProvider[] = ['microsoft', 'snapchat', 'pinterest', 'reddit'];
export const isMoreProvider = (p: string): p is MoreProvider =>
  (MORE_PROVIDERS as string[]).includes(p);

type Fetch = typeof fetch;
const MAX_ACCOUNTS = 50;
const UA = 'profit-intelligence/1.0 (ads read-only)';
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

const MICROSOFT_SCOPE = 'https://ads.microsoft.com/msads.manage offline_access';

export function moreAuthorizeUrl(
  cfg: AdOAuthConfig,
  provider: MoreProvider,
  redirect: string,
  state: string,
): string {
  switch (provider) {
    case 'microsoft':
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q({
        client_id: cfg.microsoft!.clientId,
        response_type: 'code',
        redirect_uri: redirect,
        response_mode: 'query',
        scope: MICROSOFT_SCOPE,
        state,
        prompt: 'select_account',
      })}`;
    case 'snapchat':
      return `https://accounts.snapchat.com/login/oauth2/authorize?${q({
        client_id: cfg.snapchat!.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'snapchat-marketing-api',
        state,
      })}`;
    case 'pinterest':
      return `https://www.pinterest.com/oauth/?${q({
        client_id: cfg.pinterest!.appId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'ads:read',
        state,
      })}`;
    case 'reddit':
      return `https://www.reddit.com/api/v1/authorize?${q({
        client_id: cfg.reddit!.clientId,
        response_type: 'code',
        state,
        redirect_uri: redirect,
        duration: 'permanent',
        scope: 'adsread',
      })}`;
  }
}

async function jsonOf(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new OAuthError(`${what} was refused`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError(`${what} sent an unreadable answer`);
  }
}

const inSeconds = (now: Date, s: unknown) =>
  typeof s === 'number' && s > 0 ? new Date(now.getTime() + s * 1000) : null;

const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/** Swaps the code for tokens. All four platforms answer with access_token, refresh_token and expires_in. */
export async function moreExchange(
  cfg: AdOAuthConfig,
  provider: MoreProvider,
  redirect: string,
  code: string,
  fetchImpl: Fetch,
  now: Date,
): Promise<Tokens> {
  let url: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
  };
  switch (provider) {
    case 'microsoft':
      url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      params.client_id = cfg.microsoft!.clientId;
      params.client_secret = cfg.microsoft!.secret;
      params.scope = MICROSOFT_SCOPE;
      break;
    case 'snapchat':
      url = 'https://accounts.snapchat.com/login/oauth2/access_token';
      params.client_id = cfg.snapchat!.clientId;
      params.client_secret = cfg.snapchat!.secret;
      break;
    case 'pinterest':
      url = 'https://api.pinterest.com/v5/oauth/token';
      headers = {
        ...headers,
        Authorization: basic(cfg.pinterest!.appId, cfg.pinterest!.secret),
      };
      break;
    case 'reddit':
      url = 'https://www.reddit.com/api/v1/access_token';
      headers = {
        ...headers,
        Authorization: basic(cfg.reddit!.clientId, cfg.reddit!.secret),
        'User-Agent': UA,
      };
      break;
  }
  const body = await jsonOf(
    await fetchImpl(url, { method: 'POST', headers, body: new URLSearchParams(params) }),
    `${provider} sign-in`,
  );
  if (typeof body.access_token !== 'string')
    throw new OAuthError(`${provider} sent no access token`);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: inSeconds(now, body.expires_in),
  };
}

const name = (v: unknown, fallback: string) => String(v || fallback).slice(0, 80);

// ---- Microsoft: SOAP (Customer Management service) ----------------------------------------------------

const MS_CUSTOMER = 'https://bingads.microsoft.com/Customer/v13';
const MS_CUSTOMER_URL =
  'https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc';

/** A Customer Management SOAP call. The tokens are put into the XML and never into an error. */
export function msEnvelope(
  action: string,
  accessToken: string,
  developerToken: string,
  body: string,
): string {
  const esc = (v: string) => v.replace(/[<>&"']/g, '');
  return (
    `<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Header xmlns="${MS_CUSTOMER}"><Action mustUnderstand="1">${action}</Action>` +
    `<AuthenticationToken>${esc(accessToken)}</AuthenticationToken>` +
    `<DeveloperToken>${esc(developerToken)}</DeveloperToken></s:Header>` +
    `<s:Body>${body}</s:Body></s:Envelope>`
  );
}

const tag = (xml: string, name: string) =>
  new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;

async function msCall(
  fetchImpl: Fetch,
  action: string,
  accessToken: string,
  developerToken: string,
  body: string,
): Promise<string> {
  const res = await fetchImpl(MS_CUSTOMER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
    body: msEnvelope(action, accessToken, developerToken, body),
  });
  if (!res.ok) throw new OAuthError('Microsoft Advertising account list was refused');
  return res.text();
}

/** Accounts of the signed-in user. An account's id is "customerId:accountId": the report needs both. */
export async function msListAccounts(
  tokens: Tokens,
  developerToken: string,
  fetchImpl: Fetch,
): Promise<FoundAdAccount[]> {
  const user = await msCall(
    fetchImpl,
    'GetUser',
    tokens.accessToken,
    developerToken,
    `<GetUserRequest xmlns="${MS_CUSTOMER}"><UserId i:nil="true"/></GetUserRequest>`,
  );
  const userId = /<(?:\w+:)?User\b[\s\S]*?<(?:\w+:)?Id>(\d{1,20})</.exec(user)?.[1];
  if (!userId) throw new OAuthError('Microsoft Advertising sent no user');
  const found = await msCall(
    fetchImpl,
    'SearchAccounts',
    tokens.accessToken,
    developerToken,
    `<SearchAccountsRequest xmlns="${MS_CUSTOMER}"><Predicates xmlns:a="${MS_CUSTOMER}/Entities">` +
      `<a:Predicate><a:Field>UserId</a:Field><a:Operator>Equals</a:Operator><a:Value>${userId}</a:Value></a:Predicate>` +
      `</Predicates><Ordering i:nil="true"/><PageInfo xmlns:a="${MS_CUSTOMER}/Entities">` +
      `<a:Index>0</a:Index><a:Size>${MAX_ACCOUNTS}</a:Size></PageInfo></SearchAccountsRequest>`,
  );
  const blocks = found.split(/<(?:\w+:)?AdvertiserAccount\b[^>]*>/).slice(1);
  const out: FoundAdAccount[] = [];
  for (const b of blocks.slice(0, MAX_ACCOUNTS)) {
    const id = tag(b, 'Id');
    const customer = tag(b, 'ParentCustomerId');
    if (!id || !customer || !/^\d{1,20}$/.test(id) || !/^\d{1,20}$/.test(customer)) continue;
    out.push({
      id: `${customer}:${id}`,
      name: name(tag(b, 'Name'), `Account ${id}`),
      currency: tag(b, 'CurrencyCode') ?? '',
    });
  }
  return out;
}

// ---- the three that answer in JSON ---------------------------------------------------------------------

export async function moreListAccounts(
  cfg: AdOAuthConfig,
  provider: MoreProvider,
  tokens: Tokens,
  fetchImpl: Fetch,
): Promise<FoundAdAccount[]> {
  const bearer = { Authorization: `Bearer ${tokens.accessToken}`, 'User-Agent': UA };
  if (provider === 'microsoft') {
    return msListAccounts(tokens, cfg.microsoft!.developerToken, fetchImpl);
  }
  if (provider === 'snapchat') {
    const body = await jsonOf(
      await fetchImpl('https://adsapi.snapchat.com/v1/me/organizations?with_ad_accounts=true', {
        headers: bearer,
      }),
      'Snapchat ad account list',
    );
    const orgs = Array.isArray(body.organizations)
      ? (body.organizations as Record<string, unknown>[])
      : [];
    const out: FoundAdAccount[] = [];
    for (const o of orgs) {
      const accounts = (
        o.organization as { ad_accounts?: Array<Record<string, unknown>> } | undefined
      )?.ad_accounts;
      for (const a of accounts ?? []) {
        if (!/^[0-9a-f-]{36}$/i.test(String(a.id ?? ''))) continue;
        out.push({
          id: String(a.id),
          name: name(a.name, `Ad account ${String(a.id).slice(0, 8)}`),
          currency: String(a.currency ?? ''),
        });
      }
    }
    return out.slice(0, MAX_ACCOUNTS);
  }
  if (provider === 'pinterest') {
    const body = await jsonOf(
      await fetchImpl('https://api.pinterest.com/v5/ad_accounts?page_size=100', {
        headers: bearer,
      }),
      'Pinterest ad account list',
    );
    const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    return items
      .filter((a) => /^\d{1,24}$/.test(String(a.id ?? '')))
      .slice(0, MAX_ACCOUNTS)
      .map((a) => ({
        id: String(a.id),
        name: name(a.name, `Ad account ${a.id}`),
        currency: String(a.currency ?? ''),
      }));
  }
  // Reddit: businesses, then the ad accounts of each
  const businesses = await jsonOf(
    await fetchImpl('https://ads-api.reddit.com/api/v3/me/businesses', { headers: bearer }),
    'Reddit business list',
  );
  const list = Array.isArray(businesses.data) ? (businesses.data as Record<string, unknown>[]) : [];
  const out: FoundAdAccount[] = [];
  for (const b of list.slice(0, 10)) {
    const bid = String(b.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(bid)) continue;
    const res = await fetchImpl(`https://ads-api.reddit.com/api/v3/businesses/${bid}/ad_accounts`, {
      headers: bearer,
    });
    if (!res.ok) continue;
    const accounts = ((await res.json()) as { data?: Array<Record<string, unknown>> }).data ?? [];
    for (const a of accounts) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(a.id ?? ''))) continue;
      out.push({
        id: String(a.id),
        name: name(a.name, `Ad account ${a.id}`),
        currency: String(a.currency ?? ''),
      });
    }
  }
  return out.slice(0, MAX_ACCOUNTS);
}
