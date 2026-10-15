export type User = { id: number; username: string; full_name: string; bio: string; location: string; avatar_path: string | null; cover_path: string | null; created_at: string; email?: string | null; phone?: string | null; email_verified?: boolean; onboarded?: boolean; roles?: string[]; post_count?: number; is_me?: boolean };
export type Author = { id: number; username: string; full_name: string; avatar_path: string | null };
export type Post = { id: number; body: string; image_path: string | null; visibility: 'public' | 'friends' | 'private'; created_at: string; updated_at: string; author: Author; like_count: number; comment_count: number; liked_by_me: boolean };
export type Comment = { id: number; post_id: number; parent_id: number | null; body: string; created_at: string; author: Author };
export type Page<T> = { items: T[]; next_cursor: string | null };

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Connectly-CSRF': '1' };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  if (opts.form) body = opts.form;
  const res = await fetch(`/api${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const looksLikePhone = (s: string) => !s.includes('@') && /^[+\d(][\d\s().-]*$/.test(s.trim()) && /\d/.test(s);
export const NAME_RE = (() => { try { return new RegExp("^[\\p{L}\\p{M}][\\p{L}\\p{M}' ’-]*[\\p{L}\\p{M}]$", 'u'); } catch { return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ’-]*[A-Za-zÀ-ÿ]$/; } })();
export function ageFrom(dob: string) { const d = new Date(dob + 'T00:00:00Z'), n = new Date(); let a = n.getUTCFullYear() - d.getUTCFullYear(); const m = n.getUTCMonth() - d.getUTCMonth(); if (m < 0 || (m === 0 && n.getUTCDate() < d.getUTCDate())) a--; return a; }
