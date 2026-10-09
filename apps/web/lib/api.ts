import type { ApiError } from '@pi/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** True when running inside Shopify Admin, where App Bridge provides the global `shopify`. */
export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && typeof window.shopify !== 'undefined';
}

/**
 * Calls the backend with a fresh App Bridge ID token. The token is short-lived (about a minute),
 * so one is requested per call. Tokens are never stored or logged.
 */
export async function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, body);
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!isEmbedded()) {
    throw new ApiRequestError(0, 'not_embedded', 'Open this app from your Shopify Admin.');
  }
  const token = await window.shopify.idToken();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    const code = err?.error.code ?? 'request_failed';
    const message = err?.error.message ?? `Request failed (${res.status})`;
    throw new ApiRequestError(
      res.status,
      code,
      code === 'plan_limit'
        ? `${message} You can change your plan in Settings, Plan and billing.`
        : message,
    );
  }
  return (await res.json()) as T;
}

/**
 * Downloads a file the API protects with the session token: the browser cannot send that header
 * from a plain link, so the file is fetched and handed to the browser as a download.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  if (!isEmbedded()) {
    throw new ApiRequestError(0, 'not_embedded', 'Open this app from your Shopify Admin.');
  }
  const token = await window.shopify.idToken();
  const res = await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      res.status,
      err?.error.code ?? 'request_failed',
      err?.error.message ?? `Download failed (${res.status})`,
    );
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
