import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Page, Post } from '../api';
import { PostCard } from './PostCard';

export function usePosts(path: string) {
  const [items, setItems] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async (reset = false) => {
    setLoading(true); setErr('');
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await api<Page<Post>>(`${path}${sep}limit=10${!reset && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => reset ? r.items : [...prev, ...r.items]); setCursor(r.next_cursor); setDone(!r.next_cursor);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [path, cursor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItems([]); setCursor(null); setDone(false); load(true); }, [path]);
  return { items, setItems, load, done, loading, err };
}

export function PostList({ feed, empty }: { feed: ReturnType<typeof usePosts>; empty: string }) {
  const { items, setItems, load, done, loading, err } = feed;
  // Infinite scroll: load the next page when a sentinel ~800px below the viewport becomes visible.
  const sentinel = useRef<HTMLDivElement>(null);
  const hasIO = typeof IntersectionObserver !== 'undefined';
  const state = useRef({ loading, done, err, load }); state.current = { loading, done, err, load };
  useEffect(() => {
    if (!hasIO || !sentinel.current) return;
    const io = new IntersectionObserver((es) => { const s = state.current; if (es[0].isIntersecting && !s.loading && !s.done && !s.err) s.load(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel.current); return () => io.disconnect();
  }, [hasIO, items.length]);
  return <>
    {items.map((p) => <PostCard key={p.id} post={p} onChange={(np) => setItems((xs) => xs.map((x) => x.id === np.id ? np : x))} onDelete={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />)}
    {err && <p className="error card">{err}</p>}
    {!loading && done && items.length === 0 && <p className="card empty">{empty}</p>}
    {loading && <div className="spinner" aria-label="Loading" />}
    {!done && !loading && (err || !hasIO) && <button className="btn ghost block" onClick={() => load()}>{err ? 'Try again' : 'Load more'}</button>}
    <div ref={sentinel} className="sentinel" />
    {done && items.length > 0 && <p className="meta center">You're all caught up ✨</p>}
  </>;
}
