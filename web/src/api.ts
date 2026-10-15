export type User = { hometown?: string; interests?: string[]; relationship_status?: string; work_company?: string; work_role?: string; education?: string; current_place_id?: number | null; hometown_place_id?: number | null;
  friend_status?: 'none' | 'outgoing' | 'incoming' | 'friends'; following?: boolean; follower_count?: number; following_count?: number; follows_me?: boolean; tier?: string | null; friend_count?: number;
  email_notifications?: boolean; inapp_notifications?: boolean; default_post_visibility?: 'public' | 'friends' | 'private'; theme_pref?: 'light' | 'dark' | 'system'; profile_details_visibility?: 'public' | 'friends' | 'private';
  acting_as?: { id: number; slug: string; name: string; photo_path: string | null } | null; unread_notifications?: number; id: number; username: string; full_name: string; bio: string; location: string; avatar_path: string | null; cover_path: string | null; created_at?: string; email?: string | null; phone?: string | null; email_verified?: boolean; onboarded?: boolean; roles?: string[]; post_count?: number; is_me?: boolean; verified?: boolean; locale?: string | null; hide_like_counts?: boolean; two_step?: boolean; text_scale?: number | null };
export type Author = { id: number; username: string; full_name: string; avatar_path: string | null; space?: boolean; kind?: string; verified?: boolean };
export const authorHref = (a: Author) => (a.space ? `/s/${a.username}` : `/u/${a.username}`);
export type Post = { id: number; body: string; image_path: string | null; visibility: 'public' | 'friends' | 'private'; created_at: string; updated_at: string; author: Author; is_mine: boolean; space: { slug: string; name: string; kind: string } | null; like_count: number; comment_count: number; liked_by_me: boolean;
  kind?: 'post' | 'reel'; video_path?: string | null; video_low_path?: string | null; poster_path?: string | null; video_seconds?: number | null; view_count?: number;
  feeling?: string; location_tag?: string; is_draft?: boolean; deleted_at?: string | null; my_reaction?: Reaction | null; reactions?: Partial<Record<Reaction, number>>; saved_by_me?: boolean; share_count?: number;
  pinned_at?: string | null; scheduled_for?: string | null; hide_like_count?: boolean; effect?: string | null; remix_layout?: string | null; music_start?: number;
  music?: Track | null; remix_of?: { id: number; video_path: string; poster_path: string; username: string; full_name: string } | null;
  poll?: { id: number; question: string; options: string[]; closes_at: string | null; counts: Record<string, number>; my_vote: number | null } | null };
export type Track = { id: number; title: string; artist: string; url: string; license: string; duration_seconds?: number; source_url?: string; mood?: string; uses?: number };
export type Comment = { id: number; post_id: number; parent_id: number | null; body: string; created_at: string; author: Author; is_mine?: boolean };
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
export type Space = { id: number; kind: 'page' | 'group' | 'community'; slug: string; name: string; category: string; description: string; photo_path: string | null; member_count: number; my_role: string | null; owner: { username: string; full_name: string }; owner_id: number };
export const KIND_LABEL = { page: 'Page', group: 'Group', community: 'Community' } as const;
export function money(amount: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); } catch { return `${currency} ${amount.toLocaleString()}`; } }
export function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

// Public feature flags (server: config.features). Cached for the page lifetime.
export type Features = { reels: boolean; welcome_hero: boolean; ai_support?: boolean; live?: boolean; subscriptions?: boolean;
  messages?: boolean; calls?: boolean; verified?: boolean; hashtags?: boolean; for_you?: boolean; push?: boolean; i18n?: boolean; translate?: boolean; creator_tools?: boolean; events?: boolean; polls?: boolean; close_friends?: boolean; hide_likes?: boolean; two_step?: boolean;
  music?: boolean; ar_effects?: boolean; remix?: boolean; challenges?: boolean; gifts?: boolean; games?: boolean; watch_together?: boolean; memories?: boolean; stickers?: boolean; streaks?: boolean;
  news?: boolean; backfill?: boolean; local_currency?: boolean; add_yours?: boolean; collections?: boolean; private_accounts?: boolean; who_can?: boolean; hide_presence?: boolean; hide_lists?: boolean; restrict_mute?: boolean; hidden_words?: boolean; disappearing?: boolean; data_export?: boolean; discoverability?: boolean; teen_safety?: boolean };
let featuresP: Promise<Features> | null = null;
export function getFeatures(): Promise<Features> {
  if (!featuresP) featuresP = api<{ features?: Features }>('/auth/capabilities').then((c) => c.features || { reels: false, welcome_hero: false }).catch(() => { featuresP = null; return { reels: false, welcome_hero: false }; });
  return featuresP;
}

export type Reaction = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
export const REACTIONS: { k: Reaction; e: string; label: string }[] = [
  { k: 'like', e: '👍', label: 'Like' }, { k: 'love', e: '❤️', label: 'Love' }, { k: 'haha', e: '😂', label: 'Haha' },
  { k: 'wow', e: '😮', label: 'Wow' }, { k: 'sad', e: '😢', label: 'Sad' }, { k: 'angry', e: '😡', label: 'Angry' },
];
export const FEELINGS: { k: string; e: string }[] = [
  { k: 'happy', e: '😊' }, { k: 'loved', e: '🥰' }, { k: 'excited', e: '🤩' }, { k: 'grateful', e: '🙏' }, { k: 'blessed', e: '😇' },
  { k: 'relaxed', e: '😌' }, { k: 'proud', e: '😎' }, { k: 'tired', e: '😴' }, { k: 'sad', e: '😢' }, { k: 'hungry', e: '😋' },
];
export const feelingEmoji = (k?: string) => FEELINGS.find((f) => f.k === k)?.e || '🙂';

// Post timestamps in the viewer's local time: Just now, 5m, 3h (today), Today 10:24 PM, Yesterday 9:10 AM, then a full date.
export function postTime(iso: string, now = new Date()) {
  const d = new Date(iso); const s = (now.getTime() - d.getTime()) / 1000;
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return s < 4 * 3600 ? `${Math.floor(s / 3600)}h` : `Today ${t}`;
  if (diff === 1) return `Yesterday ${t}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ` at ${t}`;
}

// Tiny toast bus: toast('Posted') from anywhere; <Toaster/> in App renders it.
export function toast(text: string, kind: 'ok' | 'err' = 'ok') { window.dispatchEvent(new CustomEvent('cx-toast', { detail: { text, kind } })); }
export function haptic(ms = 8) { try { (navigator as any).vibrate?.(ms); } catch { /* not supported */ } }

// Upload with progress (fetch has no upload progress).
export function uploadForm<T>(path: string, fd: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', `/api${path}`); x.setRequestHeader('X-Connectly-CSRF', '1');
    if (onProgress) x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(d) : reject(new ApiError(x.status, d.error || `Request failed (${x.status})`)); };
    x.onerror = () => reject(new ApiError(0, 'Network error. Check your connection and try again.'));
    x.send(fd);
  });
}

// Shared hook for feature flags.
import { useEffect as _uE, useState as _uS } from 'react';
export function useFeatures(): Features | null { const [f, setF] = _uS<Features | null>(null); _uE(() => { getFeatures().then(setF); }, []); return f; }
export function credit(t: Pick<Track, 'title' | 'artist' | 'license'>) { return `${t.title} · ${t.artist} · ${t.license.replace(/ us$/i, '')}`; }
