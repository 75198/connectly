import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Post, timeAgo } from '../api';
import { useSession } from '../session';
import { Avatar } from '../components/ui';
import { PostCard } from '../components/PostCard';

type N = { id: number; type: string; post_id: number | null; created_at: string; read_at: string | null; actor: { username: string; full_name: string; avatar_path: string | null }; post_snippet: string | null; space: { slug: string; name: string; kind: string } | null };
const TEXT: Record<string, (n: N) => string> = {
  friend_request: () => 'sent you a friend request', friend_accept: () => 'accepted your friend request', follow: () => 'started following you',
  like: (n) => `liked your post${n.post_snippet ? `: “${n.post_snippet}”` : ''}`, comment: (n) => `commented on your post${n.post_snippet ? `: “${n.post_snippet}”` : ''}`,
  reply: () => 'replied to a comment', page_follow: (n) => `followed your page ${n.space?.name || ''}`, group_join: (n) => `joined ${n.space?.name || 'your group'}`,
};
const hrefFor = (n: N) => n.post_id ? `/post/${n.post_id}` : n.space ? `/s/${n.space.slug}` : n.type.startsWith('friend') ? '/friends' : `/u/${n.actor.username}`;

export function Notifications() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [items, setItems] = useState<N[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [err, setErr] = useState('');
  const load = async (reset: boolean) => { try { const r = await api<{ items: N[]; next_cursor: string | null }>(`/notifications${!reset && cursor ? `?cursor=${cursor}` : ''}`); setItems((x) => reset ? r.items : [...(x || []), ...r.items]); setCursor(r.next_cursor); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { load(true); }, []); // eslint-disable-line
  const open = async (n: N) => { if (!n.read_at) { await api('/notifications/read', { json: { ids: [n.id] } }).catch(() => {}); refresh(); } nav(hrefFor(n)); };
  const unread = items?.some((n) => !n.read_at);
  return <div className="stack">
    <div className="row between"><h1 className="pagetitle">Notifications</h1>{unread && <button className="btn ghost" onClick={async () => { await api('/notifications/read', { json: { all: true } }); setItems((x) => x!.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))); refresh(); }}>Mark all as read</button>}</div>
    {err && <p className="error card">{err}</p>}
    {!items ? <div className="spinner" /> : items.length === 0 ? <p className="card empty">No notifications yet.</p> : <div className="card list">
      {items.map((n) => <button key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}><Avatar user={n.actor} size={44} />
        <span className="grow"><span><b>{n.actor.full_name}</b> {(TEXT[n.type] || (() => 'interacted with you'))(n)}</span><small className="meta block">{timeAgo(n.created_at)}</small></span>{!n.read_at && <span className="dot" aria-label="Unread" />}</button>)}</div>}
    {cursor && <button className="btn ghost block" onClick={() => load(false)}>Show more</button>}
  </div>;
}

type Mini = { id: number; username: string; full_name: string; avatar_path: string | null };
export function Friends() {
  const [tab, setTab] = useState<'friends' | 'incoming' | 'outgoing'>('incoming'); const [items, setItems] = useState<Mini[] | null>(null); const [err, setErr] = useState('');
  const load = () => api<{ items: Mini[] }>(`/friends?type=${tab}`).then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { setItems(null); load(); }, [tab]); // eslint-disable-line
  const act = async (path: string, method: string) => { setErr(''); try { await api(path, { method }); await load(); } catch (e: any) { setErr(e.message); } };
  return <div className="stack"><h1 className="pagetitle">Friends</h1>
    <div className="tabs card">{([['incoming', 'Requests'], ['friends', 'Your friends'], ['outgoing', 'Sent']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {err && <p className="error card">{err}</p>}
    {!items ? <div className="spinner" /> : items.length === 0 ? <p className="card empty">{tab === 'incoming' ? 'No friend requests right now.' : tab === 'friends' ? 'No friends yet. Use Search to find people.' : 'No pending requests.'}</p>
      : <div className="card list">{items.map((u) => { const n = encodeURIComponent(u.username); return <div key={u.id} className="hubrow"><Link to={`/u/${u.username}`} className="person grow"><Avatar user={u} size={44} /><span><b>{u.full_name}</b><small className="meta">@{u.username}</small></span></Link>
        {tab === 'incoming' && <><button className="chip primary" onClick={() => act(`/friends/${n}/accept`, 'POST')}>Accept</button><button className="chip" onClick={() => act(`/friends/${n}/reject`, 'POST')}>Decline</button></>}
        {tab === 'outgoing' && <button className="chip" onClick={() => act(`/friends/${n}`, 'DELETE')}>Cancel</button>}
        {tab === 'friends' && <button className="chip" onClick={() => confirm(`Remove ${u.full_name}?`) && act(`/friends/${n}`, 'DELETE')}>Remove</button>}
      </div>; })}</div>}
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
