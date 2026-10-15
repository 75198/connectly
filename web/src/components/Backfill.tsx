// Backfill so Home never looks empty: suggested accounts, openly licensed films (archive.org embeds) and news.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Avatar } from './ui';
import { FollowButton } from './Engagement';
import { VerifiedBadge } from './Extras';
import { NewsCard, type NewsItem } from './News';

// Rotation: remember (on this device) which starter films/clips you've seen and show unseen ones first.
const SEEN = 'cx-seen-starter';
const seenSet = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN) || '[]')); } catch { return new Set<string>(); } };
export function markSeen(id: string) { const s = seenSet(); if (s.has(id)) return; s.add(id); localStorage.setItem(SEEN, JSON.stringify([...s].slice(-200))); }
export function unseenFirst<T extends { id: string }>(xs: T[]): T[] { const s = seenSet(); return [...xs.filter((x) => !s.has(x.id)), ...xs.filter((x) => s.has(x.id))]; }
export type Film = { id: string; title: string; year: number; credit: string; license: string; license_url: string; embed: string; thumb: string; source: string; source_url: string };
export type Suggested = { id: number; username: string; full_name: string; avatar_path: string | null; bio: string; verified: boolean; followers: number };
let cache: Promise<{ films: Film[]; suggested: Suggested[] }> | null = null;
export function useBackfill(on: boolean) {
  const [d, setD] = useState<{ films: Film[]; suggested: Suggested[] }>({ films: [], suggested: [] });
  useEffect(() => { if (!on) return; cache ||= api<any>('/backfill'); cache.then((r) => setD({ ...r, films: unseenFirst(r.films) })).catch(() => { cache = null; }); }, [on]);
  return d;
}
export function FilmCard({ f }: { f: Film }) {
  const [play, setPlay] = useState(false); useEffect(() => markSeen(f.id), [f.id]);
  return <article className="card filmcard">
    <div className="filmhead"><span className="srclabel dark">🎬 Free film · {f.source}</span></div>
    {play ? <iframe src={f.embed} title={f.title} allow="fullscreen" allowFullScreen loading="lazy" referrerPolicy="no-referrer" />
      : <button className="filmposter" onClick={() => setPlay(true)} aria-label={`Play ${f.title}`}><img src={f.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /><span className="filmplay">▶</span></button>}
    <div className="filmbody"><b>{f.title} <span className="meta">({f.year})</span></b><small className="meta block">{f.credit} · <a href={f.license_url} target="_blank" rel="noopener noreferrer">{f.license}</a> · <a href={f.source_url} target="_blank" rel="noopener noreferrer">View on {f.source}</a></small></div>
  </article>;
}
export function SuggestedCard({ people }: { people: Suggested[] }) {
  const [hidden, setHidden] = useState<number[]>([]); const list = people.filter((p) => !hidden.includes(p.id));
  if (!list.length) return null;
  return <section className="card suggest"><div className="row between"><b>Suggested for you</b><Link to="/search" className="meta">See all</Link></div>
    <div className="hscroll suggestrow">{list.map((p) => <div key={p.id} className="suggestcard"><button className="suggestx" aria-label="Dismiss" onClick={() => setHidden((h) => [...h, p.id])}>✕</button>
      <Link to={`/u/${p.username}`}><Avatar user={p} size={72} /><b className="row nowrap center">{p.full_name.split(' ')[0]} <VerifiedBadge on={p.verified} size={13} /></b><small className="meta">@{p.username}</small></Link>
      <FollowButton username={p.username} following={false} small /></div>)}</div></section>;
}
// Interleave plan for the Home feed.
export function feedExtra(i: number, news: NewsItem[], films: Film[], suggested: Suggested[]) {
  if (i === 1 && suggested.length) return <SuggestedCard people={suggested} />;
  if (i % 6 === 3 && news.length) return <NewsCard n={news[Math.floor(i / 6) % news.length]} />;
  if (i % 8 === 6 && films.length) return <FilmCard f={films[Math.floor(i / 8) % films.length]} />;
  return null;
}
// When there are few or no posts yet, fill the page.
export function FeedFiller({ news, films, suggested }: { news: NewsItem[]; films: Film[]; suggested: Suggested[] }) {
  if (!news.length && !films.length && !suggested.length) return null;
  return <div className="stack">{suggested.length > 0 && <SuggestedCard people={suggested} />}
    {news.slice(0, 2).map((n) => <NewsCard key={n.id} n={n} />)}{films[0] && <FilmCard f={films[0]} />}
    {news.slice(2, 5).map((n) => <NewsCard key={n.id} n={n} />)}{films[1] && <FilmCard f={films[1]} />}
    {news.slice(5, 8).map((n) => <NewsCard key={n.id} n={n} />)}{films.slice(2, 4).map((f) => <FilmCard key={f.id} f={f} />)}</div>;
}
