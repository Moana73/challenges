import type { Challenge, User } from "./types";

export class AuthRequiredError extends Error {}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.method && init.method !== "GET" ? { "x-ch": "1" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) throw new AuthRequiredError("unauthorized");
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ user: User }>("/api/me"),
  list: () => req<{ challenges: Challenge[] }>("/api/challenges"),
  put: (c: Challenge) =>
    req<{ ok: true; applied: boolean }>(`/api/challenges/${encodeURIComponent(c.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        title: c.title,
        note: c.note,
        status: c.status,
        position: c.position,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }),
    }),
  remove: (id: string, ts: number) =>
    req<{ ok: true }>(`/api/challenges/${encodeURIComponent(id)}?ts=${ts}`, { method: "DELETE" }),
  aiSplit: (text: string) =>
    req<{ items: string[] }>("/api/ai/challenges", {
      method: "POST",
      body: JSON.stringify({ text, mode: "split" }),
    }),
  aiBreakdown: (text: string) =>
    req<{ items: string[] }>("/api/ai/challenges", {
      method: "POST",
      body: JSON.stringify({ text, mode: "breakdown" }),
    }),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
};
