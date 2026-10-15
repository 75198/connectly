import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Avatar, Icon } from '../components/ui';
import { PostList, usePosts } from '../components/PostList';

type Person = { id: number; username: string; full_name: string; avatar_path: string | null; bio: string };

export function Search() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || ''; const TYPES = ['people', 'posts', 'pages', 'groups', 'communities']; const type = TYPES.includes(sp.get('type') || '') ? sp.get('type')! : 'people';
  const [text, setText] = useState(q);
  useEffect(() => { const t = setTimeout(() => { if (text.trim() !== q) setSp({ q: text.trim(), type }, { replace: true }); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line
  const setType = (t: string) => setSp({ q, type: t }, { replace: true });
  return <div className="stack">
    <h1 className="pagetitle">Search</h1>
    <div className="card stack">
      <label className="searchbox"><Icon name="search" /><input type="search" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Search" maxLength={100} enterKeyHint="search" /></label>
      <div className="tabs scrolltabs" role="tablist">{TYPES.map((t) => <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    </div>
    {!q ? <p className="card empty">Search for people, posts, pages, groups and communities.</p> : type === 'people' ? <People q={q} /> : type === 'posts' ? <Posts q={q} /> : <Spaces q={q} type={type} />}
  </div>;
}
function People({ q }: { q: string }) {
  const [items, setItems] = useState<Person[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { let live = true; setItems(null); setErr('');
    api<{ items: Person[] }>(`/search?type=people&q=${encodeURIComponent(q)}`).then((r) => live && setItems(r.items)).catch((e) => live && setErr(e.message));
    return () => { live = false; }; }, [q]);
  if (err) return <p className="error card">{err}</p>;
  if (!items) return <p className="card empty">Searching…</p>;
  if (!items.length) return <p className="card empty">No people match “{q}”.</p>;
  return <div className="card list">{items.map((p) => <Link key={p.id} to={`/u/${p.username}`} className="person"><Avatar user={p} size={44} /><span className="grow"><b>{p.full_name}</b><small className="meta">@{p.username}{p.bio ? ` · ${p.bio}` : ''}</small></span></Link>)}</div>;
}
function Posts({ q }: { q: string }) {
  const feed = usePosts(`/search?type=posts&q=${encodeURIComponent(q)}`);
  return <PostList feed={feed} empty={`No posts match “${q}”.`} />;
}

type SpaceHit = { id: number; kind: string; slug: string; name: string; category: string; photo_path: string | null; member_count: number };
function Spaces({ q, type }: { q: string; type: string }) {
  const [items, setItems] = useState<SpaceHit[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { let live = true; setItems(null); setErr('');
    api<{ items: SpaceHit[] }>(`/search?type=${type}&q=${encodeURIComponent(q)}`).then((r) => live && setItems(r.items)).catch((e) => live && setErr(e.message));
    return () => { live = false; }; }, [q, type]);
  if (err) return <p className="error card">{err}</p>;
  if (!items) return <p className="card empty">Searching…</p>;
  if (!items.length) return <p className="card empty">No {type} match “{q}”. <Link to={`/create/${type === 'communities' ? 'community' : type.slice(0, -1)}`}>Create one</Link></p>;
  return <div className="card list">{items.map((s) => <Link key={s.id} to={`/s/${s.slug}`} className="person"><Avatar user={{ full_name: s.name, avatar_path: s.photo_path }} size={44} /><span className="grow"><b>{s.name}</b><small className="meta">{s.category} · {s.member_count} {s.kind === 'page' ? 'follower' : 'member'}{s.member_count === 1 ? '' : 's'}</small></span></Link>)}</div>;
}
