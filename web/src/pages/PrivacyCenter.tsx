// Round 9 privacy center: private account, who-can controls, activity status, lists, restrict/mute, hidden words,
// discoverability, follow requests and "Download your data".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toast, useFeatures } from '../api';
import { Avatar, Icon, Spinner } from '../components/ui';
import { Toggle } from './SettingsExtra';

type Priv = { is_private: boolean; dm_privacy: string; who_can_comment: string; who_can_tag: string; who_can_mention: string; hide_presence: boolean; hide_follow_lists: boolean; hidden_words: string[]; hidden_words_on: boolean; discover_by_email: boolean; discover_by_phone: boolean; allow_downloads?: boolean; read_receipts?: boolean; is_teen: boolean; pending_requests?: number };
type U = { id: number; username: string; full_name: string; avatar_path: string | null };
const Back = ({ title, to = '/settings' }: { title: string; to?: string }) => <div className="row"><Link to={to} className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">{title}</h1></div>;
const WHO: [string, string][] = [['everyone', 'Everyone'], ['following', 'People you follow'], ['none', 'No one']];

export function PrivacyCenter() {
  const f = useFeatures(); const [p, setP] = useState<Priv | null>(null);
  useEffect(() => { api<Priv>('/me/privacy').then(setP).catch(() => {}); }, []);
  if (!p || !f) return <Spinner />;
  const save = async (patch: Partial<Priv>) => { setP({ ...p, ...patch }); try { setP(await api<Priv>('/me/privacy', { method: 'PATCH', json: patch })); toast('Saved'); } catch (e: any) { toast(e.message, 'err'); } };
  const Row = ({ title, hint, on, k, invert }: { title: string; hint: string; on: boolean; k: keyof Priv; invert?: boolean }) => <div className="row between privrow"><span className="grow"><b>{title}</b><small className="meta block">{hint}</small></span><Toggle label={title} on={on} onChange={(v) => save({ [k]: invert ? !v : v } as any)} /></div>;
  const Who = ({ title, k, opts = WHO }: { title: string; k: keyof Priv; opts?: [string, string][] }) => <div className="stack whoblock"><b>{title}</b><div className="segmented">{opts.map(([v, l]) => <button key={v} type="button" className={p[k] === v ? 'on' : ''} onClick={() => save({ [k]: v } as any)}>{l}</button>)}</div></div>;
  return <div className="stack"><Back title="Privacy" />
    {f.private_accounts && <section className="card stack"><Row title="Private account" k="is_private" on={p.is_private} hint={p.is_private ? 'Only followers you approve can see your posts, followers and following.' : 'Anyone can see your posts. Turn on to approve each new follower.'} />
      {p.is_teen && <p className="notice">Because you’re under 18, your account starts private and adults you don’t follow can’t message you.</p>}
      {p.is_private && <Link to="/settings/follow-requests" className="row between"><span>Follow requests</span><span className="row">{p.pending_requests ? <b className="badge static">{p.pending_requests}</b> : null}<Icon name="chev" /></span></Link>}</section>}
    {f.who_can && <section className="card stack"><h3>Interactions</h3>
      <Who title="Who can message you" k="dm_privacy" opts={[['everyone', 'Everyone'], ['following', 'People you follow'], ['off', 'No one']]} />
      <Who title="Who can comment on your posts" k="who_can_comment" />
      <Who title="Who can tag you in posts" k="who_can_tag" />
      <Who title="Who can @mention you" k="who_can_mention" /></section>}
    {f.msg_controls && <section className="card stack"><h3>Messages</h3><Row title="Read receipts" k="read_receipts" on={p.read_receipts !== false} hint="Show “Seen” when you read messages. If you turn this off, you won't see when others read yours either." /></section>}
    {f.downloads && <section className="card stack"><h3>Downloads</h3><Row title="Allow downloads" k="allow_downloads" on={p.allow_downloads !== false} hint="People can save your public photos and reels with a Connectly watermark and your name. Never for private, friends-only or close-friends posts, or posts with licensed music. You can change this on each post from its ⋯ menu." /></section>}
    {(f.hide_presence || f.hide_lists) && <section className="card stack"><h3>Visibility</h3>
      {f.hide_presence && <Row title="Show activity status" k="hide_presence" invert on={!p.hide_presence} hint="When off, people can’t see when you’re online or last active, and you can’t see theirs." />}
      {f.hide_lists && <Row title="Hide followers and following" k="hide_follow_lists" on={p.hide_follow_lists} hint="Only you will see who follows you and who you follow." />}</section>}
    {f.hidden_words && <HiddenWords p={p} save={save} />}
    {f.discoverability && <section className="card stack"><h3>Find me by contact info</h3>
      <Row title="By email address" k="discover_by_email" on={p.discover_by_email} hint="People who type your exact email in Search can find you." />
      <Row title="By phone number" k="discover_by_phone" on={p.discover_by_phone} hint="People who type your exact number in Search can find you." /></section>}
    {f.restrict_mute && <section className="card list"><Link to="/settings/restricted"><span className="emicon">🚧</span><span className="grow">Restricted accounts</span><Icon name="chev" /></Link><Link to="/settings/muted"><span className="emicon">🔕</span><span className="grow">Muted accounts</span><Icon name="chev" /></Link><Link to="/settings/blocked"><span className="emicon">⛔</span><span className="grow">Blocked accounts</span><Icon name="chev" /></Link></section>}
    {f.data_export && <section className="card stack"><h3>Download your data</h3><p className="meta">Get a ZIP with your profile, posts, comments, messages you sent, Connectly AI chats, and your photos and videos.</p><a className="btn primary" href="/api/me/export.zip" download>Download ZIP</a></section>}
  </div>;
}

function HiddenWords({ p, save }: { p: Priv; save: (x: Partial<Priv>) => void }) {
  const [w, setW] = useState('');
  const add = () => { const v = w.trim().toLowerCase(); if (!v) return; save({ hidden_words: [...new Set([...p.hidden_words, v])] }); setW(''); };
  return <section className="card stack"><div className="row between"><span className="grow"><b>Hidden words</b><small className="meta block">Hide comments and message requests with offensive words, plus any words you add.</small></span><Toggle label="Hidden words" on={p.hidden_words_on} onChange={(v) => save({ hidden_words_on: v })} /></div>
    {p.hidden_words_on && <><div className="row"><input value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Add a word, phrase or emoji" aria-label="Add a hidden word" maxLength={40} /><button className="btn ghost" onClick={add}>Add</button></div>
      <div className="row wrap">{p.hidden_words.map((x) => <button key={x} className="chip" onClick={() => save({ hidden_words: p.hidden_words.filter((y) => y !== x) })} aria-label={`Remove ${x}`}>{x} ✕</button>)}</div></>}
  </section>;
}

export function FollowRequests() {
  const [items, setItems] = useState<U[] | null>(null);
  const load = () => api<{ items: U[] }>('/me/follow-requests').then((r) => setItems(r.items)).catch(() => setItems([])); useEffect(() => { load(); }, []);
  const act = async (u: U, action: 'approve' | 'decline') => { await api(`/me/follow-requests/${u.id}`, { json: { action } }); setItems((x) => x?.filter((y) => y.id !== u.id) || null); toast(action === 'approve' ? `@${u.username} can now see your posts` : 'Request removed'); };
  return <div className="stack"><Back title="Follow requests" to="/settings/privacy-center" />
    {!items ? <Spinner /> : !items.length ? <div className="card empty">No pending requests.</div> : <div className="card list">{items.map((u) => <div key={u.id} className="row reqrow"><Link to={`/u/${u.username}`} className="row grow"><Avatar user={u} size={44} /><span><b>{u.full_name}</b><small className="meta block">@{u.username}</small></span></Link><button className="btn primary" onClick={() => act(u, 'approve')}>Confirm</button><button className="btn ghost" onClick={() => act(u, 'decline')}>Delete</button></div>)}</div>}
  </div>;
}

export function PeopleList({ kind }: { kind: 'restricted' | 'muted' }) {
  const [items, setItems] = useState<U[] | null>(null);
  useEffect(() => { api<{ items: U[] }>(`/me/${kind}`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [kind]);
  const undo = async (u: U) => { await api(`/users/${u.username}/${kind === 'restricted' ? 'restrict' : 'mute'}`, { method: 'DELETE' }); setItems((x) => x?.filter((y) => y.id !== u.id) || null); toast(kind === 'restricted' ? 'Unrestricted' : 'Unmuted'); };
  return <div className="stack"><Back title={kind === 'restricted' ? 'Restricted accounts' : 'Muted accounts'} to="/settings/privacy-center" />
    <p className="meta">{kind === 'restricted' ? 'Restricted people’s comments are only visible to them, their messages go to requests, and they can’t see when you’re online. They aren’t notified.' : 'You won’t see posts or stories from muted accounts. They aren’t notified.'}</p>
    {!items ? <Spinner /> : !items.length ? <div className="card empty">No one here.</div> : <div className="card list">{items.map((u) => <div key={u.id} className="row"><Avatar user={u} size={40} /><span className="grow"><b>{u.full_name}</b><small className="meta block">@{u.username}</small></span><button className="btn ghost" onClick={() => undo(u)}>{kind === 'restricted' ? 'Unrestrict' : 'Unmute'}</button></div>)}</div>}
  </div>;
}
