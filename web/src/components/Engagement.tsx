// Who reacted / commented / shared (round 6). Opened by tapping the counts on a post or reel.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Post, REACTIONS, toast, type Reaction } from '../api';
import { Avatar, Sheet } from './ui';

type Person = { user: { id: number; username: string; full_name: string; avatar_path: string | null }; following: boolean; is_me: boolean; reaction?: Reaction; comments?: number; shares?: number; channels?: string[] };
export type EngTab = 'reactions' | 'comments' | 'shares';
const CH: Record<string, string> = { reshare: 'Reshared', native: 'Shared', copy_link: 'Copied link', whatsapp: 'WhatsApp', x: 'X', facebook: 'Facebook', email: 'Email' };

export function FollowButton({ username, following, onChange, small }: { username: string; following: boolean; onChange?: (f: boolean) => void; small?: boolean }) {
  const [on, setOn] = useState(following); const [busy, setBusy] = useState(false);
  useEffect(() => setOn(following), [following]);
  const go = async (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setBusy(true); const next = !on; setOn(next);
    try { await api(`/users/${encodeURIComponent(username)}/follow`, { method: next ? 'PUT' : 'DELETE' }); onChange?.(next); } catch (x: any) { setOn(!next); toast(x.message, 'err'); } finally { setBusy(false); } };
  return <button className={`btn ${on ? 'ghost' : 'primary'}${small ? ' sm' : ''} followbtn`} disabled={busy} onClick={go} aria-pressed={on}>{on ? 'Following' : 'Follow'}</button>;
}

export function PersonRow({ p, extra }: { p: Person; extra?: React.ReactNode }) {
  return <div className="hubrow engrow"><Link to={`/u/${p.user.username}`} className="person grow"><span className="engav"><Avatar user={p.user} size={44} />{p.reaction && <i className="engreact">{REACTIONS.find((r) => r.k === p.reaction)?.e}</i>}</span>
    <span><b>{p.user.full_name}</b><small className="meta">{extra}</small></span></Link>{!p.is_me && <FollowButton username={p.user.username} following={p.following} small />}</div>;
}

export function EngagementSheet({ post, tab: start, onClose }: { post: Post; tab: EngTab; onClose: () => void }) {
  const [tab, setTab] = useState<EngTab>(start); const [filter, setFilter] = useState<Reaction | 'all'>('all');
  const [items, setItems] = useState<Person[] | null>(null);
  useEffect(() => { setItems(null); api<{ items: Person[] }>(`/posts/${post.id}/${tab === 'comments' ? 'commenters' : tab}`).then((r) => setItems(r.items)).catch((e) => { toast(e.message, 'err'); setItems([]); }); }, [tab, post.id]);
  const counts = post.reactions || {};
  const shown = (items || []).filter((p) => tab !== 'reactions' || filter === 'all' || p.reaction === filter);
  return <Sheet title="People" onClose={onClose}>
    <div className="tabs scrolltabs engtabs" role="tablist">
      {([['reactions', `Reactions ${post.like_count || ''}`], ['comments', `Comments ${post.comment_count || ''}`], ['shares', `Shares ${post.share_count || ''}`]] as const).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l.trim()}</button>)}
    </div>
    {tab === 'reactions' && <div className="chiprow engfilter"><button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
      {REACTIONS.filter((r) => (counts[r.k] || 0) > 0).map((r) => <button key={r.k} className={`chip ${filter === r.k ? 'on' : ''}`} onClick={() => setFilter(r.k)}>{r.e} {counts[r.k]}</button>)}</div>}
    <div className="englist">{items === null ? <p className="meta pad">Loading…</p> : !shown.length ? <p className="meta pad">{tab === 'reactions' ? 'No reactions yet.' : tab === 'comments' ? 'No comments yet.' : 'No shares yet.'}</p>
      : shown.map((p) => <PersonRow key={p.user.id} p={p} extra={tab === 'reactions' ? REACTIONS.find((r) => r.k === p.reaction)?.label : tab === 'comments' ? `${p.comments} comment${p.comments === 1 ? '' : 's'}` : `${(p.channels || []).map((c) => CH[c] || c).join(', ')}${(p.shares || 0) > 1 ? ` · ${p.shares}×` : ''}`} />)}</div>
  </Sheet>;
}

export const trackShare = (postId: number, channel: string) => api(`/posts/${postId}/share`, { json: { channel } }).catch(() => {});
