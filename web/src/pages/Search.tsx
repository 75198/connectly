import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getFeatures } from '../api';
import { Avatar, Icon } from '../components/ui';
import { PostList, usePosts } from '../components/PostList';

type Person = { id: number; username: string; full_name: string; avatar_path: string | null; bio: string };

export function Search() {
  const [ai, setAi] = useState(false); useEffect(() => { getFeatures().then((f) => setAi(!!f.ai_support)); }, []);
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || ''; const TYPES = ['people', 'posts', 'pages', 'groups', 'communities']; const type = TYPES.includes(sp.get('type') || '') ? sp.get('type')! : 'people';
  const [text, setText] = useState(q);
  useEffect(() => { const t = setTimeout(() => { if (text.trim() !== q) setSp({ q: text.trim(), type }, { replace: true }); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line
  useEffect(() => { if (q.length >= 2) { const t = setTimeout(() => saveRecent(q), 1500); return () => clearTimeout(t); } }, [q]);
  const setType = (t: string) => setSp({ q, type: t }, { replace: true });
  return <div className="stack">
    <h1 className="pagetitle">Search</h1>
    <div className="stack searchtop">
      <label className="searchbox"><Icon name="search" /><input type="search" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Search" placeholder="Search Connectly" maxLength={100} enterKeyHint="search" />{text && <button className="btn icon ghost" aria-label="Clear" onClick={() => setText('')}><Icon name="x" /></button>}</label>
      <div className="tabs scrolltabs" role="tablist">{TYPES.map((t) => <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    </div>
    {ai && text.trim().length >= 2 && <Link to={`/assistant?q=${encodeURIComponent(text.trim())}`} className="card person aientry askai"><span className="aiorb sm">✦</span><span className="grow"><b>Ask Connectly AI</b><small className="meta">“{text.trim()}”</small></span><Icon name="chev" /></Link>}
    {!q ? <Discover onPick={(t, ty) => { setText(t); setSp({ q: t, type: ty || type }, { replace: true }); }} /> : type === 'people' ? <People q={q} /> : type === 'posts' ? <Posts q={q} /> : <Spaces q={q} type={type} />}
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

const RKEY = 'cx-recent-search';
const getRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; } };
function saveRecent(q: string) { const r = [q, ...getRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); localStorage.setItem(RKEY, JSON.stringify(r)); }
const CATS: [string, string, string, string][] = [['people', 'People', '👥', '#0F766E'], ['posts', 'Posts', '📝', '#0EA5E9'], ['pages', 'Pages', '⭐', '#F59E0B'], ['groups', 'Groups', '🫂', '#10B981'], ['communities', 'Communities', '🌍', '#8B5CF6']];
const IDEAS = ['Lagos', 'Football', 'Afrobeats', 'Recipes', 'Tech jobs', 'Fashion'];
function Discover({ onPick }: { onPick: (q: string, type?: string) => void }) {
  const [recent, setRecent] = useState(getRecent); const [ai, setAi] = useState(false);
  useEffect(() => { getFeatures().then((f) => setAi(!!f.ai_support)); }, []); const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => { api<{ items: Person[] }>('/search?type=people&q=a').then((r) => setPeople(r.items.slice(0, 8))).catch(() => setPeople([])); }, []);
  return <div className="stack">
    {recent.length > 0 && <section className="card"><div className="row between"><h3>Recent</h3><button className="linkish" onClick={() => { localStorage.removeItem(RKEY); setRecent([]); }}>Clear all</button></div>
      <div className="list">{recent.map((r) => <div key={r} className="row recentrow"><button className="plain row grow" onClick={() => onPick(r)}><Icon name="clock" /> <span className="grow">{r}</span></button>
        <button className="btn icon ghost" aria-label={`Remove ${r}`} onClick={() => { const n = recent.filter((x) => x !== r); localStorage.setItem(RKEY, JSON.stringify(n)); setRecent(n); }}><Icon name="x" /></button></div>)}</div></section>}
    {people && people.length > 0 && <section className="card"><h3>People you may know</h3><div className="hscroll">{people.map((p) => <Link key={p.id} to={`/u/${p.username}`} className="pcard"><Avatar user={p} size={64} /><b>{p.full_name}</b><small className="meta">@{p.username}</small></Link>)}</div></section>}
    <section><h3 className="grouphead">Browse</h3><div className="catgrid">{CATS.map(([k, l, e, c]) => <button key={k} className="catcard" style={{ ['--c' as any]: c }} onClick={() => onPick(IDEAS[CATS.findIndex((x) => x[0] === k)] || 'a', k)}><span>{e}</span><b>{l}</b></button>)}</div></section>
    {ai && <Link to="/assistant" className="card person aientry"><span className="aiorb sm">✦</span><span className="grow"><b>Ask Connectly AI</b><small className="meta">Ideas, captions, translations, answers and app help</small></span><Icon name="chev" /></Link>}
    <section className="card"><h3>Trending searches</h3><div className="chiprow wrap">{IDEAS.map((t) => <button key={t} className="chip" onClick={() => onPick(t)}>🔥 {t}</button>)}</div></section>
  </div>;
}
