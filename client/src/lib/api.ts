export const API_BASE = (import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message || `Lỗi máy chủ (${response.status})`);
  }
  return data as T;
}
