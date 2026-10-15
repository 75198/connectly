import { FormEvent, useEffect, useState } from 'react';
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
import type { Post } from '../api';

const RELATIONSHIP = ['', 'Single', 'In a relationship', 'Engaged', 'Married', 'In a civil union', 'Separated', 'Divorced', 'Widowed', "It's complicated", 'Prefer not to say'];

function FriendButtons({ u, onChange }: { u: User; onChange: (p: Partial<User>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [menu, setMenu] = useState(false); const nav = useNavigate();
  const call = async (path: string, method: string, patch?: (r: any) => Partial<User>) => { setBusy(true); setErr(''); try { const r = await api(path, { method }); if (patch) onChange(patch(r)); if (path.endsWith('/follow') && method === 'PUT') sfx('follow'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const n = encodeURIComponent(u.username);
  return <div className="stack pad">
    <div className="row wrap">
      <button className={`btn ${u.following ? 'ghost' : 'primary'} grow`} disabled={busy} aria-pressed={!!u.following} onClick={() => call(`/users/${n}/follow`, u.following || (u as any).requested ? 'DELETE' : 'PUT', (r) => ({ following: r.following, requested: !!r.requested, follower_count: r.follower_count ?? (u.follower_count || 0) + (r.following ? 1 : -1) } as any))}>{u.following ? '✓ Following' : (u as any).requested ? 'Requested' : u.follows_me ? 'Follow back' : 'Follow'}</button>
      {(u as any).can_message && <button className="btn ghost grow" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<{ id: number }>('/conversations', { json: { usernames: [u.username] } }); nav(`/messages/${r.id}`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}><Icon name="chat" /> Message</button>}
      <button className="btn icon ghost" aria-label="More options" onClick={() => setMenu(true)}><Icon name="more" /></button>
    </div>
    {err && <p className="error">{err}</p>}
    {menu && <Sheet title={u.full_name} onClose={() => setMenu(false)}>
      <div className="list"><RestrictMute username={n} name={u.full_name.split(' ')[0]} /><button className="danger" onClick={async () => { if (!confirm(`Block ${u.full_name}? You won’t see each other’s profiles or posts, and you’ll be unfriended.`)) return; await api(`/users/${n}/block`, { method: 'PUT' }); nav('/'); }}><Icon name="lock" /> Block {u.full_name.split(' ')[0]}</button><button className="danger" onClick={async () => { const reason = prompt(`Why are you reporting ${u.full_name}? (fake account, spam, harassment…)`); if (!reason || !reason.trim()) return; try { await api('/reports', { json: { target_type: 'user', username: u.username, reason: reason.trim() } }); alert('Thanks. Our moderators will review this account.'); } catch (e: any) { alert(e.message); } }}><Icon name="flag" /> Report {u.full_name.split(' ')[0]}</button></div>
    </Sheet>}
  </div>;
}

export function Profile() {
  const { username = '' } = useParams();
  const [u, setU] = useState<User | null>(null); const [err, setErr] = useState(''); const [tab, setTab] = useState<'posts' | 'photos' | 'about'>('posts');
  const feed = usePosts(`/users/${encodeURIComponent(username)}/posts`);
  const pinned = usePinned(username);
  useEffect(() => { setU(null); setErr(''); api<User>(`/users/${encodeURIComponent(username)}`).then(setU).catch((e) => setErr(e.message)); }, [username]);
  if (err) return <div className="card empty">{err}</div>;
  if (!u) return <div className="card profilehead skel" style={{ height: 360 }}><span className="sk block" /></div>;
  const work = [u.work_role, u.work_company].filter(Boolean).join(' at ');
  const photos = feed.items.filter((p) => p.image_path || p.poster_path);
  return <div className="stack">
    <section className="card profilehead">
      <div className="cover" style={u.cover_path ? { backgroundImage: `url(${u.cover_path})` } : undefined} />
      <div className="pinfo">
        <div className="pav"><Avatar user={u} size={112} /></div>
        <h1>{u.full_name} <VerifiedBadge on={u.verified} size={22} /> <TierBadge tier={u.tier} /></h1><div className="meta">@{u.username}{u.location ? ` · 📍 ${u.location}` : ''}</div>
        {u.bio && <p className="pbiotext">{u.bio}</p>}
        <div className="pstats"><span><b>{u.post_count ?? 0}</b><small>Posts</small></span><Link to={(u as any).lists_hidden ? '#' : `/u/${u.username}/followers`}><b>{u.follower_count ?? 0}</b><small>Followers</small></Link><Link to={(u as any).lists_hidden ? '#' : `/u/${u.username}/following`}><b>{u.following_count ?? 0}</b><small>Following</small></Link></div>
        {u.is_me ? <div className="row pactions"><Link className="btn primary grow" to="/settings/profile"><Icon name="gear" /> Edit profile</Link><Link className="btn ghost" to="/me/saved" aria-label="Saved"><Icon name="bookmark" /></Link></div>
          : <div className="pactions"><FriendButtons u={u} onChange={(p) => setU({ ...u, ...p })} /></div>}
      </div>
      <nav className="ptabs">{(['posts', 'photos', 'about'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
    </section>
    {tab === 'about' && <section className="card pbio details">
        {work && <p>💼 {work}</p>}
        {u.education && <p>🎓 {u.education}</p>}
        {u.location && <p>📍 Lives in {u.location}</p>}
        {u.hometown && <p>🏠 From {u.hometown}</p>}
        {u.relationship_status && <p>❤️ {u.relationship_status}</p>}
        {!!u.interests?.length && <div className="tags">{u.interests.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
        {!work && !u.education && !u.location && !u.hometown && !u.relationship_status && !u.interests?.length && <p className="meta">No details shared yet.</p>}
    </section>}
    {tab === 'photos' && (photos.length ? <div className="photogrid">{photos.map((p) => <Link key={p.id} to={p.kind === 'reel' ? `/reels/${p.id}` : `/post/${p.id}`}><img src={(p.kind === 'reel' ? p.poster_path : p.image_path)!} alt="" loading="lazy" />{p.kind === 'reel' && <i>▶</i>}</Link>)}</div> : <p className="card empty">No photos yet.</p>)}
    {(u as any).locked && <section className="card lockcard"><div className="lockicon">🔒</div><b>This account is private</b><p className="meta">Follow this account to see their photos and videos.</p></section>}
    {tab === 'posts' && !(u as any).locked && <>
      {u.is_me && <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />}
      <PinnedPosts items={pinned} />
      <PostList feed={feed} empty={u.is_me ? "You haven't posted yet." : 'No posts you can see yet.'} /></>}
  </div>;
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.trim().replace(/,$/, ''); if (v && !value.includes(v) && value.length < 15) onChange([...value, v.slice(0, 30)]); setT(''); };
  return <label>Interests
    <div className="tags editable">{value.map((x) => <span key={x} className="tag">{x}<button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(value.filter((y) => y !== x))}>×</button></span>)}
      <input value={t} onChange={(e) => (e.target.value.endsWith(',') ? (setT(e.target.value.slice(0, -1)), setTimeout(add)) : setT(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} maxLength={30} aria-label="Add an interest" />
    </div><span className="hint">Press Enter after each one (up to 15).</span>
  </label>;
}

export function EditProfile() {
  const { me, refresh } = useSession(); const nav = useNavigate();
  const [d, setD] = useState({ full_name: me?.full_name || '', username: me?.username || '', bio: me?.bio || '', interests: me?.interests || [], relationship_status: me?.relationship_status || '',
    work_company: me?.work_company || '', work_role: me?.work_role || '', education: me?.education || '' });
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
      <label>Bio<textarea value={d.bio} onChange={set('bio')} maxLength={300} rows={3} /><small className="meta">{d.bio.length}/300</small></label>
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
