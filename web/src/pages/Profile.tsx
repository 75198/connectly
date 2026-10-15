import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, User } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from '../components/ui';
import { Composer } from '../components/Composer';
import { PostList, usePosts } from '../components/PostList';

export function Profile() {
  const { username = '' } = useParams();
  const [u, setU] = useState<User | null>(null); const [err, setErr] = useState('');
  const feed = usePosts(`/users/${encodeURIComponent(username)}/posts`);
  useEffect(() => { setU(null); setErr(''); api<User>(`/users/${encodeURIComponent(username)}`).then(setU).catch((e) => setErr(e.message)); }, [username]);
  if (err) return <div className="card empty">{err}</div>;
  if (!u) return <div className="card empty">Loading…</div>;
  return <div className="stack">
    <section className="card profilehead">
      <div className="cover" style={u.cover_path ? { backgroundImage: `url(${u.cover_path})` } : undefined} />
      <div className="pinfo">
        <div className="pav"><Avatar user={u} size={112} /></div>
        <div className="grow"><h1>{u.display_name}</h1><div className="meta">@{u.username} · {u.post_count} post{u.post_count === 1 ? '' : 's'}</div></div>
        {u.is_me && <Link className="btn ghost" to="/settings/profile"><Icon name="gear" /> Edit profile</Link>}
      </div>
      {(u.bio || u.location) && <div className="pbio">{u.bio && <p>{u.bio}</p>}{u.location && <p className="meta">📍 {u.location}</p>}</div>}
      <p className="meta pbio">Joined {new Date(u.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
    </section>
    {u.is_me && <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />}
    <PostList feed={feed} empty={u.is_me ? "You haven't posted yet." : 'No posts you can see yet.'} />
  </div>;
}

export function EditProfile() {
  const { me, refresh } = useSession(); const nav = useNavigate();
  const [d, setD] = useState({ display_name: me?.display_name || '', bio: me?.bio || '', location: me?.location || '' });
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  if (!me) return null;
  async function save(e: FormEvent) { e.preventDefault(); setErr(''); setMsg(''); try { await api('/me', { method: 'PATCH', json: d }); await refresh(); setMsg('Profile saved'); } catch (x: any) { setErr(x.message); } }
  async function upload(kind: 'avatar' | 'cover', f?: File) {
    if (!f) return; setErr(''); setMsg('');
    if (f.size > 5 * 1024 * 1024) return setErr('Image must be 5 MB or smaller');
    const fd = new FormData(); fd.append('image', f); setBusy(kind);
    try { await api(`/me/${kind}`, { form: fd }); await refresh(); setMsg(kind === 'avatar' ? 'Profile photo updated' : 'Cover photo updated'); } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  }
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
      <label>Display name<input value={d.display_name} onChange={(e) => setD({ ...d, display_name: e.target.value })} maxLength={50} required /></label>
      <label>Bio<textarea value={d.bio} onChange={(e) => setD({ ...d, bio: e.target.value })} maxLength={300} rows={3} /><small className="meta">{d.bio.length}/300</small></label>
      <label>Location<input value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} maxLength={80} /></label>
      {err && <p className="error">{err}</p>}{msg && <p className="success">{msg}</p>}
      <div className="row"><button className="btn primary">Save changes</button><button type="button" className="btn ghost" onClick={() => nav(`/u/${me.username}`)}>View profile</button></div>
    </form>
  </div>;
}
