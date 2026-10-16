import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, toast, useFeatures, User } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet } from '../components/ui';
import { Composer } from '../components/Composer';
import { MediaStudio } from '../components/MediaStudio';
import { PostList, usePosts } from '../components/PostList';
import { PlacePicker } from '../components/PlacePicker';
import { TierBadge } from './Plans';
import { PostCard } from '../components/PostCard';
import { VerifiedBadge } from '../components/Extras';
import { sfx } from '../lib/sounds';
import { TipSheet } from '../components/Tips';
import { ReportSheet } from '../components/Report';
import type { Post } from '../api';

const RELATIONSHIP = ['', 'Single', 'In a relationship', 'Engaged', 'Married', 'In a civil union', 'Separated', 'Divorced', 'Widowed', "It's complicated", 'Prefer not to say'];

function FriendButtons({ u, onChange }: { u: User; onChange: (p: Partial<User>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [menu, setMenu] = useState(false); const nav = useNavigate(); const ff = useFeatures(); const [tip, setTip] = useState(false); const [reporting, setReporting] = useState(false);
  const call = async (path: string, method: string, patch?: (r: any) => Partial<User>) => { setBusy(true); setErr(''); try { const r = await api(path, { method }); if (patch) onChange(patch(r)); if (path.endsWith('/follow') && method === 'PUT') sfx('follow'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const n = encodeURIComponent(u.username);
  return <div className="stack">
    <div className="pf-actions">
      <button className={`btn ${u.following ? 'pf-secondary' : 'pf-primary'}`} disabled={busy} aria-pressed={!!u.following} onClick={() => call(`/users/${n}/follow`, u.following || (u as any).requested ? 'DELETE' : 'PUT', (r) => ({ following: r.following, requested: !!r.requested, follower_count: r.follower_count ?? (u.follower_count || 0) + (r.following ? 1 : -1) } as any))}>{u.following ? '✓ Following' : (u as any).requested ? 'Requested' : u.follows_me ? 'Follow back' : 'Follow'}</button>
      {(u as any).can_message && <button className="btn pf-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<{ id: number }>('/conversations', { json: { usernames: [u.username] } }); nav(`/messages/${r.id}`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}><Icon name="chat" /> Message</button>}
      {ff?.tips && <button className="btn icon pf-more" aria-label={`Tip ${u.full_name}`} onClick={() => setTip(true)}>🪙</button>}
      <button className="btn icon pf-more" aria-label="More options" onClick={() => setMenu(true)}><Icon name="more" /></button>
    </div>
    {err && <p className="error">{err}</p>}
    {reporting && <ReportSheet target={{ target_type: 'user', username: u.username }} onClose={() => setReporting(false)} />}
    {tip && <TipSheet to={u.username} name={u.full_name} onClose={() => setTip(false)} />}
    {menu && <Sheet title={u.full_name} onClose={() => setMenu(false)}>
      <div className="list"><button onClick={() => { setMenu(false); setReporting(true); }}>🚩 Report account</button><RestrictMute username={n} name={u.full_name.split(' ')[0]} /><button className="danger" onClick={async () => { if (!confirm(`Block ${u.full_name}? You won’t see each other’s profiles or posts, and you’ll be unfriended.`)) return; await api(`/users/${n}/block`, { method: 'PUT' }); nav('/'); }}><Icon name="lock" /> Block {u.full_name.split(' ')[0]}</button><button className="danger" onClick={async () => { const reason = prompt(`Why are you reporting ${u.full_name}? (fake account, spam, harassment…)`); if (!reason || !reason.trim()) return; try { await api('/reports', { json: { target_type: 'user', username: u.username, reason: reason.trim() } }); alert('Thanks. Our moderators will review this account.'); } catch (e: any) { alert(e.message); } }}><Icon name="flag" /> Report {u.full_name.split(' ')[0]}</button></div>
    </Sheet>}
  </div>;
}

export function Profile() {
  const { username = '' } = useParams();
  const [u, setU] = useState<User | null>(null); const [err, setErr] = useState(''); const [tab, setTab] = useState<'posts' | 'photos' | 'reels' | 'mentions'>('posts'); const [more, setMore] = useState(false); const nav = useNavigate();
  const coverRef = useParallax();
  const feed = usePosts(`/users/${encodeURIComponent(username)}/posts`);
  const pinned = usePinned(username);
  useEffect(() => { setU(null); setErr(''); api<User>(`/users/${encodeURIComponent(username)}`).then(setU).catch((e) => setErr(e.message)); }, [username]);
  if (err) return <div className="card empty">{err}</div>;
  if (!u) return <div className="card profilehead skel" style={{ height: 360 }}><span className="sk block" /></div>;
  const work = [u.work_role, u.work_company].filter(Boolean).join(' at ');
  const photos = feed.items.filter((p) => p.image_path && p.kind !== 'reel'); const reels = feed.items.filter((p) => p.kind === 'reel');
  const shareProfile = async () => { const url = `${location.origin}/u/${u.username}`; try { if (navigator.share) await navigator.share({ title: u.full_name, url }); else { await navigator.clipboard.writeText(url); toast('Profile link copied'); } } catch { /* cancelled */ } };
  return <div className="stack pf">
    <section className="pf-hero">
      <div className="pf-cover" ref={coverRef} style={u.cover_path ? { backgroundImage: `url(${u.cover_path})` } : undefined} />
      <div className="pf-topbar">
        <button className="pf-glass" aria-label="Back" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
        <span className="row" style={{ gap: 8 }}><Link className="pf-glass" to={`/search?q=${encodeURIComponent('@' + u.username)}`} aria-label="Search"><Icon name="search" /></Link>
          <button className="pf-glass" aria-label="More options" onClick={() => setMore(true)}><Icon name="more" /></button></span>
      </div>
    </section>
    <section className="pf-sheet">
      <div className="pf-avatar"><span className="pf-ring"><Avatar user={u} size={120} /></span></div>
      <h1 className="pf-name">{u.full_name} <VerifiedBadge on={u.verified} size={22} /> <TierBadge tier={u.tier} /></h1>
      <div className="pf-handle">@{u.username}{u.category ? <> · <span className="pf-cat">{u.category}</span></> : null}</div>
      <div className="pf-stats">
        <Link to={(u as any).lists_hidden ? '#' : `/u/${u.username}/followers`}><b>{compact(u.follower_count)}</b><small>followers</small></Link><i />
        <Link to={(u as any).lists_hidden ? '#' : `/u/${u.username}/following`}><b>{compact(u.following_count)}</b><small>following</small></Link><i />
        <span><b>{compact(u.post_count)}</b><small>posts</small></span>
      </div>
      {u.bio && <Bio text={u.bio} />}
      {u.is_me ? <div className="pf-actions"><Link className="btn pf-primary" to="/settings/profile"><Icon name="gear" /> Edit profile</Link><button className="btn pf-secondary" onClick={shareProfile}><Icon name="share" /> Share</button></div>
        : <FriendButtons u={u} onChange={(p) => setU({ ...u, ...p })} />}
    </section>
    <nav className="pf-tabs" role="tablist">{(['posts', 'photos', 'reels', 'mentions'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'posts' ? 'All' : t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
    {tab === 'posts' && <Glance u={u} work={work} />}
    {more && <Sheet title={u.full_name} onClose={() => setMore(false)}><div className="list">
      <button onClick={() => { setMore(false); shareProfile(); }}><Icon name="share" /> Share profile</button>
      <button onClick={async () => { setMore(false); await navigator.clipboard?.writeText(`${location.origin}/u/${u.username}`); toast('Profile link copied'); }}><Icon name="globe" /> Copy profile link</button>
      {u.is_me && <Link to="/me/saved" onClick={() => setMore(false)}><Icon name="bookmark" /> Saved</Link>}
      {u.is_me && <Link to="/settings" onClick={() => setMore(false)}><Icon name="gear" /> Settings and privacy</Link>}
      {!u.is_me && <RestrictMute username={encodeURIComponent(u.username)} name={u.full_name.split(' ')[0]} />}
    </div></Sheet>}
    {tab === 'reels' && (reels.length ? <div className="photogrid reelgrid">{reels.map((p) => <Link key={p.id} to={`/reels/${p.id}`}><img src={p.poster_path || ''} alt="" loading="lazy" /><i>▶</i></Link>)}</div> : <p className="card empty">{u.is_me ? 'Your reels will show here.' : 'No reels yet.'}</p>)}
    {tab === 'mentions' && <Mentions username={u.username} />}
    {tab === 'photos' && (photos.length ? <div className="photogrid">{photos.map((p) => <Link key={p.id} to={p.kind === 'reel' ? `/reels/${p.id}` : `/post/${p.id}`}><img src={(p.kind === 'reel' ? p.poster_path : p.image_path)!} alt="" loading="lazy" />{p.kind === 'reel' && <i>▶</i>}</Link>)}</div> : <p className="card empty">No photos yet.</p>)}
    {(u as any).locked && <section className="card lockcard"><div className="lockicon">🔒</div><b>This account is private</b><p className="meta">Follow this account to see their photos and videos.</p></section>}
    {tab === 'posts' && !(u as any).locked && <>
      {u.is_me && <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />}
      <PinnedPosts items={pinned} />
      <PostList feed={feed} empty={u.is_me ? "You haven't posted yet." : 'No posts you can see yet.'} /></>}
  </div>;
}

export const compact = (n?: number | string | null) => { const v = Number(n) || 0; try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch { return String(v); } };
function useParallax() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { let raf = 0; const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const y = Math.min(window.scrollY, 400); if (ref.current) ref.current.style.transform = `translate3d(0, ${y * 0.4}px, 0) scale(${1 + y / 1600})`; }); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; window.addEventListener('scroll', on, { passive: true }); return () => { window.removeEventListener('scroll', on); cancelAnimationFrame(raf); }; }, []);
  return ref;
}
function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false); const long = text.length > 140 || text.split('\n').length > 3;
  return <p className={`pf-bio ${open || !long ? 'open' : ''}`}>{text}{long && !open && <button className="linkbtn" onClick={() => setOpen(true)}> See more</button>}</p>;
}
const SOCIAL: Record<string, [string, (h: string) => string]> = { instagram: ['Instagram', (h) => `https://instagram.com/${h}`], x: ['X', (h) => `https://x.com/${h}`], tiktok: ['TikTok', (h) => `https://www.tiktok.com/@${h}`], youtube: ['YouTube', (h) => `https://youtube.com/${h.startsWith('@') ? h : '@' + h}`], linkedin: ['LinkedIn', (h) => `https://www.linkedin.com/in/${h}`] };
function Glance({ u, work }: { u: User; work: string }) {
  const socials = Object.entries(u.socials || {}).filter(([k, v]) => v && SOCIAL[k]);
  const rows: [string, React.ReactNode][] = [];
  if (work) rows.push(['💼', work]);
  if (u.education) rows.push(['🎓', u.education]);
  if (u.location) rows.push(['📍', <>Lives in <b>{u.location}</b></>]);
  if (u.hometown) rows.push(['🏠', <>From <b>{u.hometown}</b></>]);
  if (u.relationship_status) rows.push(['❤️', u.relationship_status]);
  if (u.website) rows.push(['🔗', <a href={u.website} target="_blank" rel="noopener noreferrer nofollow">{u.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>]);
  if (socials.length) rows.push(['🌐', <span className="pf-socials">{socials.map(([k, h]) => <a key={k} href={SOCIAL[k][1](h!)} target="_blank" rel="noopener noreferrer nofollow">{SOCIAL[k][0]}</a>)}</span>]);
  if (u.contact) rows.push(['✉️', /@/.test(u.contact) ? <a href={`mailto:${u.contact}`}>{u.contact}</a> : /^[+\d][\d\s-]{5,}$/.test(u.contact) ? <a href={`tel:${u.contact.replace(/\s/g, '')}`}>{u.contact}</a> : u.contact]);
  if (u.is_me) rows.push(['🔴', <Link to="/live/new">Go live for your community</Link>]);
  if (!rows.length) return null;
  return <section className="card pf-glance"><h3>At a glance</h3>{rows.map(([i, c], n) => <div key={n} className="pf-grow"><span className="pf-gi">{i}</span><span className="grow">{c}</span></div>)}
    {u.is_me && <Link className="linkbtn" to="/settings/profile">Edit details</Link>}</section>;
}
function Mentions({ username }: { username: string }) {
  const feed = usePosts(`/users/${encodeURIComponent(username)}/mentions`);
  return <PostList feed={feed} empty={`Posts that mention @${username} will show here.`} />;
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.trim().replace(/,$/, ''); if (v && !value.includes(v) && value.length < 15) onChange([...value, v.slice(0, 30)]); setT(''); };
  return <label>Interests
    <div className="tags editable">{value.map((x) => <span key={x} className="tag">{x}<button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(value.filter((y) => y !== x))}>×</button></span>)}
      <input value={t} onChange={(e) => (e.target.value.endsWith(',') ? (setT(e.target.value.slice(0, -1)), setTimeout(add)) : setT(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} maxLength={30} aria-label="Add an interest" />
    </div><span className="hint">Press Enter after each one.</span>
  </label>;
}

export function EditProfile() {
  const { me, refresh } = useSession(); const nav = useNavigate();
  const [d, setD] = useState({ full_name: me?.full_name || '', username: me?.username || '', bio: me?.bio || '', interests: me?.interests || [], relationship_status: me?.relationship_status || '',
    work_company: me?.work_company || '', work_role: me?.work_role || '', education: me?.education || '',
    category: me?.category || '', website: me?.website || '', socials: { instagram: '', x: '', tiktok: '', youtube: '', linkedin: '', ...(me?.socials || {}) }, public_contact: me?.public_contact || '', show_contact: !!me?.show_contact });
  const [place, setPlace] = useState<{ current?: number | null; hometown?: number | null }>({});
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  if (!me) return null;
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy('save');
    const body: any = { ...d };
    if (place.current !== undefined) body.current_place_id = place.current;
    if (place.hometown !== undefined) body.hometown_place_id = place.hometown;
    try { await api('/me', { method: 'PATCH', json: body }); await refresh(); setMsg('Profile saved'); } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  }
  const [studio, setStudio] = useState(false); const { themePref, setThemePref } = useSession();
  async function upload(kind: 'avatar' | 'cover', f?: File) {
    if (!f) return; setErr(''); setMsg('');
    if (f.size > 15 * 1024 * 1024) return setErr('Image must be 15 MB or smaller');
    const fd = new FormData(); fd.append('image', f); setBusy(kind);
    try { await api(`/me/${kind}`, { form: fd }); await refresh(); setMsg(kind === 'avatar' ? 'Profile photo updated' : 'Cover photo updated'); } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  }
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  return <div className="stack">
    <h1 className="pagetitle">Edit profile</h1>
    <section className="card stack">
      <div className="cover small" style={me.cover_path ? { backgroundImage: `url(${me.cover_path})` } : undefined} />
      <div className="row wrap">
        <Avatar user={me} size={72} />
        <button type="button" className="btn ghost" onClick={() => setStudio(true)}>📷 Camera, editor or avatar</button>
        <label className="btn ghost">{busy === 'avatar' ? 'Uploading…' : 'Change profile photo'}<input type="file" accept="image/*" hidden onChange={(e) => upload('avatar', e.target.files?.[0])} /></label>
        <label className="btn ghost">{busy === 'cover' ? 'Uploading…' : 'Change cover photo'}<input type="file" accept="image/*" hidden onChange={(e) => upload('cover', e.target.files?.[0])} /></label>
      </div>
      <small className="meta">JPEG, PNG, WebP or GIF up to 15 MB.</small>
      {studio && <MediaStudio onClose={() => setStudio(false)} onDone={(r) => { setStudio(false); upload('avatar', r.file); }} />}
    </section>
    <section className="card"><h3>Appearance</h3><div className="segmented">{(['light', 'dark', 'system'] as const).map((k) => <button type="button" key={k} className={themePref === k ? 'on' : ''} onClick={() => setThemePref(k)}>{k === 'light' ? '☀️ Light' : k === 'dark' ? '🌙 Dark' : '⚙️ System'}</button>)}</div></section>
    <form className="card stack" onSubmit={save}>
      <label>Full name<input value={d.full_name} onChange={set('full_name')} maxLength={80} required autoComplete="name" /></label>
      <label>Username<input value={d.username} onChange={(e) => setD({ ...d, username: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} minLength={3} maxLength={20} required autoCapitalize="none" /><span className="hint">Your profile link: /u/{d.username || 'username'}</span></label>
      <label>Bio<textarea value={d.bio} onChange={set('bio')} maxLength={300} rows={3} /></label>
      <label>Category<input value={d.category} onChange={set('category')} maxLength={40} list="pf-cats" /><span className="hint">Shown under your name, like Digital creator or Photographer.</span></label>
      <datalist id="pf-cats">{['Digital creator', 'Photographer', 'Artist', 'Musician', 'Writer', 'Entrepreneur', 'Student', 'Public figure', 'Local business', 'Community'].map((c) => <option key={c} value={c} />)}</datalist>
      <label>Website<input value={d.website} onChange={set('website')} maxLength={200} inputMode="url" autoCapitalize="none" placeholder="https://" /></label>
      <fieldset className="stack pf-socialedit"><legend>Linked accounts</legend>{(['instagram', 'x', 'tiktok', 'youtube', 'linkedin'] as const).map((k) => <label key={k}>{({ instagram: 'Instagram', x: 'X', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn' })[k]} username<input value={d.socials[k] || ''} onChange={(e) => setD({ ...d, socials: { ...d.socials, [k]: e.target.value.replace(/^@/, k === 'youtube' ? '@' : '').replace(/[^\w.@-]/g, '') } })} maxLength={60} autoCapitalize="none" /></label>)}</fieldset>
      <label>Public contact<input value={d.public_contact} onChange={set('public_contact')} maxLength={120} autoCapitalize="none" /><span className="hint">An email or phone number for business enquiries.</span></label>
      <label className="row between"><span>Show contact on my profile</span><input type="checkbox" checked={d.show_contact} onChange={(e) => setD({ ...d, show_contact: e.target.checked })} /></label>
      <TagInput value={d.interests} onChange={(interests) => setD({ ...d, interests })} />
      <label>Relationship status<select value={d.relationship_status} onChange={set('relationship_status')}>{RELATIONSHIP.map((r) => <option key={r} value={r}>{r || 'Not shown'}</option>)}</select></label>
      <div className="grid2"><label>Company<input value={d.work_company} onChange={set('work_company')} maxLength={80} autoComplete="organization" /></label>
        <label>Job title<input value={d.work_role} onChange={set('work_role')} maxLength={80} autoComplete="organization-title" /></label></div>
      <label>Education (optional)<input value={d.education} onChange={set('education')} maxLength={120} /></label>
      <PlacePicker label="Current city" value={me.location} onPick={(p) => setPlace((x) => ({ ...x, current: p ? p.id : null }))} />
      <PlacePicker label="Hometown" value={me.hometown || ''} onPick={(p) => setPlace((x) => ({ ...x, hometown: p ? p.id : null }))} />
      {err && <p className="error" role="alert">{err}</p>}{msg && <p className="success">{msg}</p>}
      <div className="row"><button className="btn primary" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button><button type="button" className="btn ghost" onClick={() => nav(`/u/${me.username}`)}>View profile</button></div>
    </form>
  </div>;
}

function usePinned(username: string) { const [p, setP] = useState<Post[]>([]); useEffect(() => { api<{ items: Post[] }>(`/users/${encodeURIComponent(username)}/pinned`).then((r) => setP(r.items)).catch(() => setP([])); }, [username]); return p; }
export function PinnedPosts({ items }: { items: Post[] }) { const [list, setList] = useState(items); useEffect(() => setList(items), [items]); return <>{list.map((p) => <PostCard key={`pin${p.id}`} post={p} onChange={(n) => setList(list.map((x) => (x.id === n.id ? n : x)))} onDelete={(id) => setList(list.filter((x) => x.id !== id))} />)}</>; }

function RestrictMute({ username, name }: { username: string; name: string }) {
  const f = useFeatures(); const [r, setR] = useState<{ restricted?: boolean; muted?: boolean }>({});
  useEffect(() => { if (f?.restrict_mute) api<any>(`/users/${username}/relationship`).then(setR).catch(() => {}); }, [f?.restrict_mute, username]);
  if (!f?.restrict_mute) return null;
  const tog = async (k: 'restrict' | 'mute', on: boolean) => { await api(`/users/${username}/${k}`, on ? { method: 'PUT', json: {} } : { method: 'DELETE' }); setR({ ...r, [k === 'restrict' ? 'restricted' : 'muted']: on }); toast(on ? (k === 'restrict' ? `${name} is restricted. They won’t know.` : `Muted ${name}. They won’t know.`) : 'Undone'); };
  return <><button onClick={() => tog('restrict', !r.restricted)}>🚧 {r.restricted ? 'Unrestrict' : 'Restrict'}</button><button onClick={() => tog('mute', !r.muted)}>🔕 {r.muted ? 'Unmute' : 'Mute posts and stories'}</button></>;
}
