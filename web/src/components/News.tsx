// Real headlines from public RSS feeds (via our server). Cards link out to the publisher; we never show full articles.
import { useEffect, useState } from 'react';
import { api, timeAgo } from '../api';
export type NewsItem = { id: string; title: string; summary: string; link: string; image: string | null; source: string; topic: string; published_at: string };
let cached: { at: number; items: NewsItem[] } | null = null;
export function useNews(on: boolean, limit = 12) {
  const [items, setItems] = useState<NewsItem[]>(cached?.items || []);
  useEffect(() => { if (!on) return; if (cached && Date.now() - cached.at < 5 * 60e3) { setItems(cached.items); return; } api<{ items: NewsItem[] }>(`/news?limit=${limit}`).then((r) => { cached = { at: Date.now(), items: r.items }; setItems(r.items); }).catch(() => {}); }, [on, limit]);
  return items;
}
const ext = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const;
export function NewsCard({ n }: { n: NewsItem }) {
  return <a className="card newscard" href={n.link} {...ext}>{n.image && <img src={n.image} alt="" loading="lazy" />}
    <div className="newsbody"><span className="newssrc">📰 {n.source} · {timeAgo(n.published_at)}</span><h3>{n.title}</h3>{n.summary && <p className="meta">{n.summary}</p>}<small className="meta">Read on {n.source} ↗</small></div></a>;
}
export function NewsRow({ n }: { n: NewsItem }) {
  return <a className="newsrow" href={n.link} {...ext}><span className="grow"><span className="newssrc">{n.source} · {timeAgo(n.published_at)}</span><b>{n.title}</b></span>{n.image && <img src={n.image} alt="" loading="lazy" />}</a>;
}
export function NewsSection({ on }: { on: boolean }) {
  const items = useNews(on, 12); if (!on || !items.length) return null;
  return <section className="stack"><h3>News for you</h3><div className="newsrail">{items.slice(0, 4).map((n) => <NewsCard key={n.id} n={n} />)}</div>
    <div className="card">{items.slice(4, 10).map((n) => <NewsRow key={n.id} n={n} />)}</div><small className="meta">Headlines from BBC, Al Jazeera, The Guardian, DW, NPR and local publishers. Picked using your activity on Connectly only.</small></section>;
}
