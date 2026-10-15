import { useCallback, useEffect, useState } from 'react';
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
  return <>
    {items.map((p) => <PostCard key={p.id} post={p} onChange={(np) => setItems((xs) => xs.map((x) => x.id === np.id ? np : x))} onDelete={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />)}
    {err && <p className="error card">{err}</p>}
    {!loading && done && items.length === 0 && <p className="card empty">{empty}</p>}
    {!done && <button className="btn ghost block" disabled={loading} onClick={() => load()}>{loading ? 'Loading…' : 'Load more'}</button>}
    {done && items.length > 0 && <p className="meta center">You're all caught up ✨</p>}
  </>;
}
