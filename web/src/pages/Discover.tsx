// Round 7/8 pages: hashtag, sound, challenges, events, memories, streaks, wallet, creator insights, scheduled posts.
import { showPrice, type Price } from '../lib/region';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, credit, Post, toast, Track, useFeatures } from '../api';
import { PostList, usePosts } from '../components/PostList';
import { PostCard } from '../components/PostCard';
import { MusicChip, VerifiedBadge } from '../components/Extras';
import { Avatar, Icon, Spinner } from '../components/ui';

const Back = ({ title, sub }: { title: string; sub?: string }) => { const nav = useNavigate(); return <div className="row pagehead"><button className="btn icon ghost" aria-label="Back" onClick={() => nav(-1)}><Icon name="back" /></button><span className="grow"><h1 className="pagetitle">{title}</h1>{sub && <small className="meta">{sub}</small>}</span></div>; };

export function TagPage() {
  const { tag = '' } = useParams(); const feed = usePosts(`/hashtags/${encodeURIComponent(tag)}/posts`); const [ch, setCh] = useState<any>(null);
  useEffect(() => { api(`/challenges/${encodeURIComponent(tag)}`).then(setCh).catch(() => setCh(null)); }, [tag]);
  return <div className="stack"><Back title={`#${tag}`} sub={ch ? `🏆 ${ch.title}` : undefined} />
    {ch && <div className="card challengehero"><b>{ch.title}</b>{ch.description && <p>{ch.description}</p>}{ch.sound && <MusicChip track={ch.sound} />}<Link className="btn primary" to={`/compose?text=${encodeURIComponent(`#${tag} `)}`}>Join the challenge</Link></div>}
    <PostList feed={feed} empty="No posts with this hashtag yet." /></div>;
}

export function SoundPage() {
  const { id } = useParams(); const [t, setT] = useState<(Track & { posts: { items: Post[] } }) | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api(`/music/${id}`).then(setT).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="card empty">{err}</div>; if (!t) return <Spinner />;
  return <div className="stack"><Back title={t.title} sub={t.artist} />
    <div className="card soundhero"><div className="soundart">♫</div><div className="grow"><MusicChip track={t} /><small className="meta">Licence: {t.license} · <a href={t.source_url} target="_blank" rel="noopener noreferrer">Source</a></small></div></div>
    <Link className="btn primary block" to={`/reels/new?music=${t.id}`}>Use this sound</Link>
    {t.posts.items.length ? t.posts.items.map((p) => <PostCard key={p.id} post={p} onChange={() => {}} onDelete={() => {}} />) : <p className="meta center">Be the first to use this sound.</p>}</div>;
}

export function Challenges() {
  const [items, setItems] = useState<any[] | null>(null); const [open, setOpen] = useState(false); const [d, setD] = useState({ tag: '', title: '', description: '' }); const [err, setErr] = useState('');
  const load = () => api<{ items: any[] }>('/challenges').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const create = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api('/challenges', { json: d }); setOpen(false); setD({ tag: '', title: '', description: '' }); toast('Challenge created'); load(); } catch (x: any) { setErr(x.message); } };
  return <div className="stack"><div className="row between"><Back title="Challenges" /><button className="btn primary" onClick={() => setOpen(!open)}>Start one</button></div>
    {open && <form className="card stack" onSubmit={create}><label>Hashtag<input value={d.tag} onChange={(e) => setD({ ...d, tag: e.target.value })} required maxLength={41} /></label><label>Title<input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required maxLength={80} /></label><label>What should people do?<textarea value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={500} rows={2} /></label>{err && <p className="error">{err}</p>}<button className="btn primary">Create</button></form>}
    {!items ? <Spinner /> : !items.length ? <p className="meta center">No challenges yet. Start the first one.</p> : <div className="challengegrid">{items.map((c) => <Link key={c.id} to={`/tag/${c.tag}`} className="challengecard"><span className="chbadge">🏆</span><b>#{c.tag}</b><span>{c.title}</span><small>{c.entries === 1 ? '1 entry' : `${c.entries} entries`}</small></Link>)}</div>}</div>;
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function Events() {
  const [items, setItems] = useState<any[] | null>(null); const [tab, setTab] = useState<'all' | 'mine'>('all');
  useEffect(() => { setItems(null); api<{ items: any[] }>(`/events${tab === 'mine' ? '?filter=mine' : ''}`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [tab]);
  return <div className="stack"><div className="row between"><Back title="Events" /><Link className="btn primary" to="/events/new">Create</Link></div>
    <div className="seg"><button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Upcoming</button><button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Going or hosting</button></div>
    {!items ? <Spinner /> : !items.length ? <div className="card empty"><div className="bigemoji">📅</div><p>No upcoming events.</p></div> : items.map((e) => <EventCard key={e.id} e={e} />)}</div>;
}
function EventCard({ e }: { e: any }) {
  const d = new Date(e.starts_at);
  return <Link to={`/events/${e.id}`} className="card row eventcard"><span className="evdate"><small>{d.toLocaleString(undefined, { month: 'short' })}</small><b>{d.getDate()}</b></span>
    <span className="grow"><b>{e.title}</b><small className="meta">{fmtWhen(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</small><small className="meta">{e.going} going{e.interested ? ` · ${e.interested} interested` : ''}</small></span>{e.my_rsvp === 'going' && <span className="chip on">Going</span>}</Link>;
}
export function NewEvent() {
  const nav = useNavigate(); const [d, setD] = useState({ title: '', description: '', starts: '', ends: '', location: '', visibility: 'public' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api<any>('/events', { json: { title: d.title, description: d.description, location: d.location, visibility: d.visibility, starts_at: new Date(d.starts).toISOString(), ends_at: d.ends ? new Date(d.ends).toISOString() : null } }); toast('Event created'); nav(`/events/${r.id}`); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return <form className="stack" onSubmit={submit}><Back title="Create event" /><div className="card stack">
    <label>Event name<input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required maxLength={120} /></label>
    <div className="row wrap"><label className="grow">Starts<input type="datetime-local" value={d.starts} onChange={(e) => setD({ ...d, starts: e.target.value })} required /></label><label className="grow">Ends (optional)<input type="datetime-local" value={d.ends} onChange={(e) => setD({ ...d, ends: e.target.value })} /></label></div>
    <label>Location<input value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} maxLength={200} /></label>
    <label>Details<textarea value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} rows={3} maxLength={3000} /></label>
    <label>Who can see it<select value={d.visibility} onChange={(e) => setD({ ...d, visibility: e.target.value })}><option value="public">Public</option><option value="followers">Followers</option><option value="private">Only me</option></select></label>
    {err && <p className="error">{err}</p>}<button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button></div></form>;
}
export function EventPage() {
  const { id } = useParams(); const [e, setE] = useState<any>(null); const [err, setErr] = useState('');
  const load = () => api(`/events/${id}`).then(setE).catch((x) => setErr(x.message)); useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const rsvp = async (status: string) => { try { await api(`/events/${id}/rsvp`, { method: 'PUT', json: { status } }); toast(status === 'going' ? 'You’re going. We’ll remind you an hour before.' : 'Saved'); load(); } catch (x: any) { toast(x.message, 'err'); } };
  const ics = () => { const f = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); const body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Connectly//EN\r\nBEGIN:VEVENT\r\nUID:event-${e.id}@connectly\r\nDTSTAMP:${f(new Date().toISOString())}\r\nDTSTART:${f(e.starts_at)}\r\n${e.ends_at ? `DTEND:${f(e.ends_at)}\r\n` : ''}SUMMARY:${e.title}\r\nLOCATION:${e.location}\r\nBEGIN:VALARM\r\nTRIGGER:-PT1H\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'event.ics'; a.click(); };
  if (err) return <div className="card empty">{err}</div>; if (!e) return <Spinner />;
  return <div className="stack"><Back title={e.title} /><div className="card stack eventhero">
    <div className="evbanner"><span className="evdate big"><small>{new Date(e.starts_at).toLocaleString(undefined, { month: 'short' })}</small><b>{new Date(e.starts_at).getDate()}</b></span></div>
    {e.cancelled_at && <p className="notice">This event was cancelled.</p>}
    <p className="row"><Icon name="clock" /> {fmtWhen(e.starts_at)}{e.ends_at ? ` – ${fmtWhen(e.ends_at)}` : ''}</p>{e.location && <p className="row"><Icon name="pin" /> {e.location}</p>}
    <Link to={`/u/${e.host.username}`} className="row"><Avatar user={e.host} size={32} /><span>Hosted by <b>{e.host.full_name}</b> <VerifiedBadge on={e.host.verified} size={13} /></span></Link>
    {e.description && <p>{e.description}</p>}
    <div className="row avstack">{e.guests.map((g: any) => <Avatar key={g.id} user={g} size={28} />)}<small className="meta">{e.going} going · {e.interested} interested</small></div>
    {!e.cancelled_at && <div className="row">{(['going', 'interested', 'not_going'] as const).map((s) => <button key={s} className={`btn grow ${e.my_rsvp === s ? 'primary' : 'ghost'}`} onClick={() => rsvp(s)}>{s === 'going' ? 'Going' : s === 'interested' ? 'Interested' : 'Can’t go'}</button>)}</div>}
    <div className="row"><button className="btn ghost grow" onClick={ics}>Add to calendar</button>{e.is_mine && !e.cancelled_at && <button className="btn ghost danger" onClick={async () => { if (confirm('Cancel this event?')) { await api(`/events/${id}/cancel`, { method: 'POST' }); load(); } }}>Cancel event</button>}</div></div></div>;
}

export function MemoriesCard() {
  const f = useFeatures(); const [items, setItems] = useState<any[]>([]);
  useEffect(() => { if (f?.memories) api<{ items: any[] }>(`/memories?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`).then((r) => setItems(r.items)).catch(() => {}); }, [f?.memories]);
  if (!items.length) return null; const p = items[0];
  return <Link to="/memories" className="card memorycard"><span className="memoryicon">🕰️</span><span className="grow"><b>On this day</b><small className="meta">{p.years_ago === 1 ? '1 year ago' : `${p.years_ago} years ago`}: {(p.body || 'A photo').slice(0, 70)}</small></span>{p.image_path && <img src={p.image_path} alt="" />}</Link>;
}
export function Memories() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api<{ items: any[] }>(`/memories?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`).then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  return <div className="stack"><Back title="Memories" sub="On this day" />{!items ? <Spinner /> : !items.length ? <div className="card empty"><div className="bigemoji">🕰️</div><p>No memories from this day yet. Come back tomorrow.</p></div>
    : items.map((p) => <div key={p.id}><h3 className="memoryyear">{p.years_ago === 1 ? '1 year ago' : `${p.years_ago} years ago`}</h3><PostCard post={p} onChange={() => {}} onDelete={() => {}} /></div>)}</div>;
}

const BADGE_ICON: Record<string, string> = { first_post: '✍️', streak_3: '🔥', streak_7: '⚡', streak_30: '🏅', creator: '🎬', socialite: '🌟', early_bird: '🐦' };
export function StreakChip() {
  const f = useFeatures(); const [s, setS] = useState<any>(null);
  useEffect(() => { if (f?.streaks) api('/me/streak').then(setS).catch(() => {}); }, [f?.streaks]);
  if (!s || !s.current) return null;
  return <Link to="/me/streak" className="streakchip" aria-label="Your streak">🔥 {s.current}</Link>;
}
export function StreakPage() {
  const [s, setS] = useState<any>(null); useEffect(() => { api('/me/streak').then(setS).catch(() => {}); }, []);
  if (!s) return <Spinner />;
  return <div className="stack"><Back title="Streaks & badges" /><div className="card streakhero"><div className="flame">🔥</div><b>{s.current === 1 ? '1 day' : `${s.current} days`}</b><small className="meta">{s.active_today ? 'You’re active today. Keep it going tomorrow!' : 'Post, comment or chat today to keep your streak.'}</small><small className="meta">Best: {s.longest === 1 ? '1 day' : `${s.longest} days`}</small></div>
    <h3>Badges</h3><div className="badgegrid">{s.badges.length ? s.badges.map((b: any) => <div key={b.badge} className="badgetile"><span>{BADGE_ICON[b.badge] || '🏅'}</span><b>{b.name}</b><small className="meta">{new Date(b.awarded_at).toLocaleDateString()}</small></div>) : <p className="meta">Your first badge is one post away.</p>}</div></div>;
}

export function Wallet() {
  const [w, setW] = useState<any>(null); const [packs, setPacks] = useState<{ item: string; coins: number; price: Price }[]>([]);
  useEffect(() => { api('/coins').then(setW).catch(() => {}); api<{ packs: any[] }>('/coins/packs').then((r) => setPacks(r.packs)).catch(() => {}); }, []);
  if (!w) return <Spinner />;
  return <div className="stack"><Back title="Coins" /><div className="card wallethero"><span className="coin">🪙</span><b>{w.balance}</b><small className="meta">Send gifts to creators when they go live.</small>
    <button className="btn primary" onClick={() => api('/coins/purchase', { method: 'POST' }).catch((e) => toast(e.message))}>Buy coins · Coming soon</button><Link className="btn ghost" to="/me/earnings">📈 Creator earnings</Link></div>
    {packs.length > 0 && <><h3>Coin packs</h3><div className="giftgrid">{packs.map((p) => <div key={p.item} className="gifttile"><span>🪙</span><b>{p.coins.toLocaleString()}</b><small>{showPrice(p.price)}</small></div>)}</div></>}
    <h3>Gifts</h3><div className="giftgrid">{w.gifts.map((g: any) => <div key={g.key} className="gifttile"><span>{g.emoji}</span><b>{g.name}</b><small>🪙 {g.coins}</small></div>)}</div>
    {w.history.length > 0 && <><h3>History</h3><div className="card list">{w.history.map((h: any, i: number) => <div key={i} className="row between"><span>{({ admin_grant: 'Coins added', gift_sent: 'Gift sent', gift_received: 'Gift received' } as any)[h.reason] || h.reason}</span><b className={h.delta > 0 ? 'pos' : ''}>{h.delta > 0 ? '+' : ''}{h.delta}</b></div>)}</div></>}</div>;
}

export function Insights() {
  const [d, setD] = useState<any>(null); const [sch, setSch] = useState<any[]>([]);
  useEffect(() => { api('/me/insights').then(setD).catch(() => {}); api<{ items: any[] }>('/me/scheduled').then((r) => setSch(r.items)).catch(() => {}); }, []);
  if (!d) return <Spinner />;
  const unschedule = async (id: number) => { await api(`/posts/${id}/schedule`, { json: { at: null } }); setSch(sch.filter((x) => x.id !== id)); toast('Published now'); };
  return <div className="stack"><Back title="Professional dashboard" sub="Last 28 days" />
    <div className="insightgrid">{[['Accounts reached', d.reach_28d], ['Reactions', d.reactions_28d], ['Comments', d.comments_28d], ['New followers', d.new_followers_28d]].map(([k, v]) => <div key={k} className="insight"><b>{v}</b><span>{k}</span></div>)}</div>
    <h3>Top posts</h3><div className="card list">{d.top.length ? d.top.map((p: any) => <Link key={p.id} to={`/post/${p.id}`} className="row between"><span className="grow">{p.body || 'Photo'}</span><small className="meta">{p.reach} reached · {p.reactions} reactions</small></Link>) : <p className="meta">Post something to see insights.</p>}</div>
    <h3>Scheduled</h3><div className="card list">{sch.length ? sch.map((p) => <div key={p.id} className="row between"><span className="grow">{p.body || 'Photo'}<small className="meta"> · {fmtWhen(p.scheduled_for)}</small></span><button className="btn ghost" onClick={() => unschedule(p.id)}>Post now</button></div>) : <p className="meta">Nothing scheduled. Pick “Schedule” in the composer.</p>}</div></div>;
}
export { credit };
