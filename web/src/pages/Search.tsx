import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Avatar, Icon } from '../components/ui';
import { PostList, usePosts } from '../components/PostList';

type Person = { id: number; username: string; full_name: string; avatar_path: string | null; bio: string };

export function Search() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || ''; const type = sp.get('type') === 'posts' ? 'posts' : 'people';
  const [text, setText] = useState(q);
  useEffect(() => { const t = setTimeout(() => { if (text.trim() !== q) setSp({ q: text.trim(), type }, { replace: true }); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line
  const setType = (t: string) => setSp({ q, type: t }, { replace: true });
  return <div className="stack">
    <h1 className="pagetitle">Search</h1>
    <div className="card stack">
      <label className="searchbox"><Icon name="search" /><input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people or posts" autoFocus aria-label="Search" maxLength={100} enterKeyHint="search" /></label>
      <div className="tabs" role="tablist">{['people', 'posts'].map((t) => <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t === 'people' ? 'People' : 'Posts'}</button>)}</div>
    </div>
    {!q ? <p className="card empty">Type a name, username or words from a post.</p> : type === 'people' ? <People q={q} /> : <Posts q={q} />}
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
