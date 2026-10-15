import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, User } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet } from '../components/ui';
import { Composer } from '../components/Composer';
import { PostList, usePosts } from '../components/PostList';
import { PlacePicker } from '../components/PlacePicker';

const RELATIONSHIP = ['', 'Single', 'In a relationship', 'Engaged', 'Married', 'In a civil union', 'Separated', 'Divorced', 'Widowed', "It's complicated", 'Prefer not to say'];

function FriendButtons({ u, onChange }: { u: User; onChange: (p: Partial<User>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [menu, setMenu] = useState(false); const nav = useNavigate();
  const call = async (path: string, method: string, patch?: (r: any) => Partial<User>) => { setBusy(true); setErr(''); try { const r = await api(path, { method }); if (patch) onChange(patch(r)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const n = encodeURIComponent(u.username);
  const fs = u.friend_status;
  return <div className="stack pad">
    <div className="row wrap">
      {fs === 'none' && <button className="btn primary" disabled={busy} onClick={() => call(`/friends/${n}`, 'POST', (r) => ({ friend_status: r.friend_status }))}>Add friend</button>}
      {fs === 'outgoing' && <button className="btn ghost" disabled={busy} onClick={() => call(`/friends/${n}`, 'DELETE', () => ({ friend_status: 'none' }))}>Cancel request</button>}
      {fs === 'incoming' && <><button className="btn primary" disabled={busy} onClick={() => call(`/friends/${n}/accept`, 'POST', () => ({ friend_status: 'friends', friend_count: (u.friend_count || 0) + 1 }))}>Accept request</button>
        <button className="btn ghost" disabled={busy} onClick={() => call(`/friends/${n}/reject`, 'POST', () => ({ friend_status: 'none' }))}>Decline</button></>}
      {fs === 'friends' && <button className="btn ghost" disabled={busy} onClick={() => confirm(`Remove ${u.full_name} from your friends?`) && call(`/friends/${n}`, 'DELETE', () => ({ friend_status: 'none', friend_count: Math.max(0, (u.friend_count || 1) - 1) }))}>✓ Friends</button>}
      <button className="btn ghost" disabled={busy} onClick={() => call(`/users/${n}/follow`, u.following ? 'DELETE' : 'PUT', (r) => ({ following: r.following, follower_count: (u.follower_count || 0) + (r.following ? 1 : -1) }))}>{u.following ? 'Following' : 'Follow'}</button>
      <button className="btn icon ghost" aria-label="More options" onClick={() => setMenu(true)}><Icon name="more" /></button>
    </div>
    {err && <p className="error">{err}</p>}
    {menu && <Sheet title={u.full_name} onClose={() => setMenu(false)}>
      <div className="list"><button className="danger" onClick={async () => { if (!confirm(`Block ${u.full_name}? You won’t see each other’s profiles or posts, and you’ll be unfriended.`)) return; await api(`/users/${n}/block`, { method: 'PUT' }); nav('/'); }}><Icon name="lock" /> Block {u.full_name.split(' ')[0]}</button></div>
    </Sheet>}
  </div>;
}

export function Profile() {
  const { username = '' } = useParams();
  const [u, setU] = useState<User | null>(null); const [err, setErr] = useState('');
  const feed = usePosts(`/users/${encodeURIComponent(username)}/posts`);
  useEffect(() => { setU(null); setErr(''); api<User>(`/users/${encodeURIComponent(username)}`).then(setU).catch((e) => setErr(e.message)); }, [username]);
  if (err) return <div className="card empty">{err}</div>;
  if (!u) return <div className="card empty"><div className="spinner" /></div>;
  const work = [u.work_role, u.work_company].filter(Boolean).join(' at ');
  return <div className="stack">
    <section className="card profilehead">
      <div className="cover" style={u.cover_path ? { backgroundImage: `url(${u.cover_path})` } : undefined} />
      <div className="pinfo">
        <div className="pav"><Avatar user={u} size={112} /></div>
        <div className="grow"><h1>{u.full_name}</h1><div className="meta">@{u.username} · {u.friend_count} friend{u.friend_count === 1 ? '' : 's'} · {u.follower_count} follower{u.follower_count === 1 ? '' : 's'}</div></div>
        {u.is_me && <Link className="btn ghost" to="/settings/profile"><Icon name="gear" /> Edit profile</Link>}
      </div>
      {!u.is_me && <div className="pbio"><FriendButtons u={u} onChange={(p) => setU({ ...u, ...p })} /></div>}
      <div className="pbio details">
        {u.bio && <p>{u.bio}</p>}
        {work && <p>💼 {work}</p>}
        {u.education && <p>🎓 {u.education}</p>}
        {u.location && <p>📍 Lives in {u.location}</p>}
        {u.hometown && <p>🏠 From {u.hometown}</p>}
        {u.relationship_status && <p>❤️ {u.relationship_status}</p>}
        {!!u.interests?.length && <div className="tags">{u.interests.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      </div>
    </section>
    {u.is_me && <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />}
    <PostList feed={feed} empty={u.is_me ? "You haven't posted yet." : 'No posts you can see yet.'} />
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
  async function upload(kind: 'avatar' | 'cover', f?: File) {
    if (!f) return; setErr(''); setMsg('');
    if (f.size > 5 * 1024 * 1024) return setErr('Image must be 5 MB or smaller');
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
        <label className="btn ghost">{busy === 'avatar' ? 'Uploading…' : 'Change profile photo'}<input type="file" accept="image/*" hidden onChange={(e) => upload('avatar', e.target.files?.[0])} /></label>
        <label className="btn ghost">{busy === 'cover' ? 'Uploading…' : 'Change cover photo'}<input type="file" accept="image/*" hidden onChange={(e) => upload('cover', e.target.files?.[0])} /></label>
      </div>
      <small className="meta">JPEG, PNG, WebP or GIF up to 5 MB.</small>
    </section>
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
