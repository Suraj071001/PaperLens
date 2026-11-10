let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('x-csrf-token', csrf);
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error?.message || 'Unable to reach PaperLens. Please retry.');
  if (data.csrf) setCsrf(data.csrf);
  return data;
}
