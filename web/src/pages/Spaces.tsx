import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, KIND_LABEL, Space } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from '../components/ui';
import { Composer } from '../components/Composer';
import { PostList, usePosts } from '../components/PostList';

const INTRO = { page: 'A page lets a business, brand or public figure share updates with followers.', group: 'A group is a place for people to talk about a shared interest.', community: 'A community brings together people around a place, cause or identity.' };

export function CreateSpace() {
  const { kind = 'page' } = useParams() as { kind: 'page' | 'group' | 'community' };
  const nav = useNavigate();
  const [cats, setCats] = useState<string[]>([]); const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ items: string[] }>('/spaces/categories').then((r) => setCats(r.items)); }, []);
  if (!['page', 'group', 'community'].includes(kind)) return <div className="card empty">Not found</div>;
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const fd = new FormData(); fd.append('kind', kind); fd.append('name', name); fd.append('category', category); fd.append('description', description); if (photo) fd.append('photo', photo);
    try { const s = await api<Space>('/spaces', { form: fd }); nav(`/s/${s.slug}`); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return <div className="stack"><h1 className="pagetitle">Create {KIND_LABEL[kind].toLowerCase()}</h1>
    <form className="card stack" onSubmit={submit}>
      <p className="meta">{INTRO[kind]}</p>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoFocus /></label>
      <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)} required><option value="" disabled>Choose a category</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} /></label>
      <label className="btn ghost">{photo ? `Photo: ${photo.name}` : 'Add a photo'}<input type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy || !name || !category}>{busy ? 'Creating…' : `Create ${KIND_LABEL[kind].toLowerCase()}`}</button>
    </form></div>;
}

export function SpaceView() {
  const { slug = '' } = useParams(); const { me, refresh } = useSession(); const nav = useNavigate();
  const [s, setS] = useState<Space | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const feed = usePosts(`/spaces/${encodeURIComponent(slug)}/posts`);
  useEffect(() => { setS(null); api<Space>(`/spaces/${encodeURIComponent(slug)}`).then(setS).catch((e) => setErr(e.message)); }, [slug]);
  if (err && !s) return <div className="card empty">{err}</div>;
  if (!s || !me) return <div className="card empty"><div className="spinner" /></div>;
  const admin = ['owner', 'admin'].includes(s.my_role || '');
  const canPost = s.kind === 'page' ? admin : !!s.my_role;
  const member = async (join: boolean) => { setBusy(true); setErr(''); try { setS(await api<Space>(`/spaces/${s.slug}/membership`, { method: join ? 'PUT' : 'DELETE' })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const joinLabel = s.kind === 'page' ? ['Follow', 'Following'] : ['Join', 'Joined'];
  return <div className="stack">
    <section className="card spacehead">
      <div className="row"><Avatar user={{ full_name: s.name, avatar_path: s.photo_path }} size={80} />
        <div className="grow"><h1>{s.name}</h1><div className="meta">{KIND_LABEL[s.kind]} · {s.category} · {s.member_count} {s.kind === 'page' ? 'follower' : 'member'}{s.member_count === 1 ? '' : 's'}</div></div></div>
      {s.description && <p>{s.description}</p>}
      <div className="row wrap">
        {s.my_role === 'owner' ? <span className="chip">You own this {KIND_LABEL[s.kind].toLowerCase()}</span>
          : s.my_role ? <button className="btn ghost" disabled={busy} onClick={() => member(false)}>✓ {joinLabel[1]}</button>
          : <button className="btn primary" disabled={busy} onClick={() => member(true)}>{joinLabel[0]}</button>}
        {s.kind === 'page' && admin && (me.acting_as?.id === s.id
          ? <button className="btn ghost" onClick={async () => { await api('/me/acting', { json: { space_id: null } }); await refresh(); }}>Switch back to {me.full_name.split(' ')[0]}</button>
          : <button className="btn ghost" onClick={async () => { await api('/me/acting', { json: { space_id: s.id } }); await refresh(); }}>Act as this page</button>)}
        {s.my_role === 'owner' && <button className="btn ghost danger" onClick={async () => { if (!confirm(`Delete ${s.name} and all its posts? This cannot be undone.`)) return; await api(`/spaces/${s.slug}`, { method: 'DELETE' }); await refresh(); nav('/me'); }}>Delete</button>}
      </div>
      {err && <p className="error">{err}</p>}
      <p className="meta">Created by <Link to={`/u/${s.owner.username}`}>{s.owner.full_name}</Link></p>
    </section>
    {canPost && <Composer spaceId={s.id} onPosted={(p) => feed.setItems((x) => [p, ...x])} />}
    {!canPost && s.kind !== 'page' && <p className="card meta center">Join to post in this {KIND_LABEL[s.kind].toLowerCase()}.</p>}
    <PostList feed={feed} empty="No posts yet." />
  </div>;
}
