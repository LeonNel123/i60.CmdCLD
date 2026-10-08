export type FetchJson = <T>(path: string, init?: RequestInit) => Promise<T>

/** JSON fetch against the remote server. Non-2xx rejects with the server's
 *  `error` field so callers surface the same message the IPC twin would. */
export const fetchJson: FetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
  return body as T
}
