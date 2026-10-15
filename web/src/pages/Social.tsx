import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Post, postTime } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, ListSkeleton } from '../components/ui';
import { PostCard } from '../components/PostCard';
import { FollowButton } from '../components/Engagement';

type N = { id: number; type: string; post_id: number | null; created_at: string; read_at: string | null; actor: { username: string; full_name: string; avatar_path: string | null }; post_snippet: string | null; space: { slug: string; name: string; kind: string } | null; live_stream_id?: number | null };
const TEXT: Record<string, (n: N) => string> = {
  friend_request: () => 'sent you a friend request', friend_accept: () => 'accepted your friend request', follow: () => 'started following you',
  live: () => 'is live now. Tap to watch.', like: (n) => `liked your post${n.post_snippet ? `: “${n.post_snippet}”` : ''}`, comment: (n) => `commented on your post${n.post_snippet ? `: “${n.post_snippet}”` : ''}`,
  reply: () => 'replied to a comment', page_follow: (n) => `followed your page ${n.space?.name || ''}`, group_join: (n) => `joined ${n.space?.name || 'your group'}`,
};
const hrefFor = (n: N) => n.live_stream_id ? `/live/${n.live_stream_id}` : n.post_id ? `/post/${n.post_id}` : n.space ? `/s/${n.space.slug}` : n.type.startsWith('friend') ? '/friends' : `/u/${n.actor.username}`;

const BADGE: Record<string, [string, string]> = { live: ['🔴', '#E11D48'], like: ['❤️', '#F43F5E'], comment: ['💬', '#0EA5E9'], reply: ['💬', '#0EA5E9'], friend_request: ['👤', '#0F766E'], friend_accept: ['🤝', '#0F766E'], follow: ['➕', '#8B5CF6'], page_follow: ['⭐', '#F59E0B'], group_join: ['👥', '#10B981'] };
const FILTERS: [string, string, (n: N) => boolean][] = [['all', 'All', () => true], ['unread', 'Unread', (n) => !n.read_at], ['comments', 'Comments', (n) => n.type === 'comment' || n.type === 'reply'], ['likes', 'Likes', (n) => n.type === 'like'], ['people', 'Friends & follows', (n) => /friend|follow/.test(n.type)]];
function bucket(iso: string) {
  const d = new Date(iso), n = new Date(); const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : 'Earlier';
}
export function Notifications() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [items, setItems] = useState<N[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all'); const [q, setQ] = useState('');
  const load = async (reset: boolean) => { try { const r = await api<{ items: N[]; next_cursor: string | null }>(`/notifications${!reset && cursor ? `?cursor=${cursor}` : ''}`); setItems((x) => reset ? r.items : [...(x || []), ...r.items]); setCursor(r.next_cursor); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { load(true); }, []); // eslint-disable-line
  const open = async (n: N) => { if (!n.read_at) { await api('/notifications/read', { json: { ids: [n.id] } }).catch(() => {}); refresh(); } nav(hrefFor(n)); };
  const unread = items?.filter((n) => !n.read_at).length || 0;
  const f = FILTERS.find((x) => x[0] === filter)![2]; const needle = q.trim().toLowerCase();
  const shown = (items || []).filter((n) => f(n) && (!needle || `${n.actor.full_name} ${(TEXT[n.type] || (() => ''))(n)}`.toLowerCase().includes(needle)));
  const groups: [string, N[]][] = []; for (const n of shown) { const b = bucket(n.created_at); const g = groups.find((x) => x[0] === b); g ? g[1].push(n) : groups.push([b, [n]]); }
  return <div className="stack">
    <div className="row between"><h1 className="pagetitle">Notifications{unread > 0 && <span className="pill">{unread} new</span>}</h1>{unread > 0 && <button className="btn ghost" onClick={async () => { await api('/notifications/read', { json: { all: true } }); setItems((x) => x!.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))); refresh(); }}>Mark all read</button>}</div>
    <label className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notifications" placeholder="Search notifications" /></label>
    <div className="chiprow" role="tablist">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
    {err && <p className="error card">{err}</p>}
    {!items ? <ListSkeleton n={6} /> : shown.length === 0 ? <div className="card empty emptyart"><span>🔔</span><b>{items.length ? 'Nothing matches' : 'You’re all caught up'}</b><small>{items.length ? 'Try a different filter.' : 'Likes, comments and friend requests will show up here.'}</small></div>
      : groups.map(([label, list]) => <section key={label}><h3 className="grouphead">{label}</h3><div className="card list notiflist">
        {list.map((n) => { const [emo, col] = BADGE[n.type] || ['🔔', '#64748B']; return <button key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
          <span className="avwrap"><Avatar user={n.actor} size={52} /><i className="nbadge" style={{ background: col }}>{emo}</i></span>
          <span className="grow"><span><b>{n.actor.full_name}</b> {(TEXT[n.type] || (() => 'interacted with you'))(n)}</span><small className={`meta block ${n.read_at ? '' : 'unreadtime'}`}>{postTime(n.created_at)}</small></span>{!n.read_at && <span className="dot" aria-label="Unread" />}</button>; })}</div></section>)}
    {cursor && <button className="btn ghost block" onClick={() => load(false)}>Show more</button>}
  </div>;
}

type FPerson = { id: number; username: string; full_name: string; avatar_path: string | null; bio?: string; following: boolean; is_me: boolean };
// Followers / Following lists (replaces friend requests). /friends shows your own.
export function Friends() {
  const { me } = useSession(); const p = useParams(); const nav = useNavigate();
  const username = p.username || me?.username || ''; const tab: 'followers' | 'following' = p.list === 'following' ? 'following' : 'followers';
  const [items, setItems] = useState<FPerson[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { if (!username) return; setItems(null); setErr(''); api<{ items: FPerson[] }>(`/users/${encodeURIComponent(username)}/${tab}`).then((r) => setItems(r.items)).catch((e) => setErr(e.message)); }, [username, tab]);
  return <div className="stack"><h1 className="pagetitle">{username === me?.username ? 'Your people' : `@${username}`}</h1>
    <div className="tabs card">{(['followers', 'following'] as const).map((k) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => nav(`/u/${username}/${k}`, { replace: true })}>{k === 'followers' ? 'Followers' : 'Following'}</button>)}</div>
    {err && <p className="error card">{err}</p>}
    {!items ? <ListSkeleton n={5} /> : items.length === 0 ? <p className="card empty">{tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet. Use Search to find people.'}</p>
      : <div className="card list">{items.map((u) => <div key={u.id} className="hubrow"><Link to={`/u/${u.username}`} className="person grow"><Avatar user={u} size={44} /><span><b>{u.full_name}</b><small className="meta">@{u.username}</small></span></Link>
        {!u.is_me && <FollowButton username={u.username} following={u.following} small />}</div>)}</div>}
  </div>;
}

export function PostPage() {
  const { id = '' } = useParams(); const nav = useNavigate();
  const [p, setP] = useState<Post | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<Post>(`/posts/${id}`).then(setP).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="card empty">{err}</div>;
  if (!p) return <div className="card empty"><div className="spinner" /></div>;
  return <PostCard post={p} onChange={setP} onDelete={() => nav('/')} />;
}
