import { Fragment } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Page, Post } from '../api';
import { PostCard } from './PostCard';
import { PostSkeleton } from './ui';

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

export function PostList({ feed, empty, mode, interleave }: { feed: ReturnType<typeof usePosts>; empty: string; mode?: 'feed' | 'draft' | 'deleted'; interleave?: (i: number) => React.ReactNode }) {
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
    {items.map((p, i) => <Fragment key={p.id}><PostCard mode={mode} post={p} onChange={(np) => setItems((xs) => xs.map((x) => x.id === np.id ? np : x))} onDelete={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />{interleave?.(i)}</Fragment>)}
    {err && <p className="error card">{err}</p>}
    {!loading && done && items.length === 0 && <p className="card empty">{empty}</p>}
    {loading && (items.length ? <div className="spinner" aria-label="Loading" /> : <PostSkeleton n={3} />)}
    {!done && !loading && (err || !hasIO) && <button className="btn ghost block" onClick={() => load()}>{err ? 'Try again' : 'Load more'}</button>}
    <div ref={sentinel} className="sentinel" />
    {done && items.length > 0 && <p className="meta center">You're all caught up ✨</p>}
  </>;
}

// Pull-to-refresh for touch screens: drag down at the top of the page to reload.
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: React.ReactNode }) {
  const [pull, setPull] = useState(0); const [busy, setBusy] = useState(false); const start = useRef<number | null>(null);
  return <div onTouchStart={(e) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; }}
    onTouchMove={(e) => { if (start.current === null || busy) return; const d = e.touches[0].clientY - start.current; setPull(d > 0 ? Math.min(90, d * 0.5) : 0); }}
    onTouchEnd={async () => { if (pull > 60 && !busy) { setBusy(true); setPull(56); try { await onRefresh(); } finally { setBusy(false); setPull(0); } } else setPull(0); start.current = null; }}>
    <div className="ptr" style={{ height: pull, opacity: pull / 60 }} aria-hidden={!busy}>{busy ? <div className="spinner sm" /> : <span style={{ transform: `rotate(${pull * 3}deg)` }}>↻</span>}</div>
    {children}
  </div>;
}
