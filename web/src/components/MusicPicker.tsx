// Pick a royalty-free track (round 8). Shows trending sounds first, with a preview and the licence credit.
import { useEffect, useRef, useState } from 'react';
import { api, Track } from '../api';
import { Sheet, Spinner } from './ui';
export function MusicPicker({ onPick, onClose }: { onPick: (t: Track) => void; onClose: () => void }) {
  const [q, setQ] = useState(''); const [items, setItems] = useState<Track[] | null>(null); const [trend, setTrend] = useState<Track[]>([]); const [playing, setPlaying] = useState<number | null>(null); const a = useRef<HTMLAudioElement>(null);
  useEffect(() => { api<{ items: Track[] }>('/music/trending').then((r) => setTrend(r.items.filter((t) => (t.uses || 0) > 0))).catch(() => {}); }, []);
  useEffect(() => { const h = setTimeout(() => api<{ items: Track[] }>(`/music?q=${encodeURIComponent(q)}`).then((r) => setItems(r.items)).catch(() => setItems([])), 200); return () => clearTimeout(h); }, [q]);
  useEffect(() => () => a.current?.pause(), []);
  const preview = (t: Track) => { const el = a.current!; if (playing === t.id) { el.pause(); setPlaying(null); return; } el.src = t.url; el.play().then(() => setPlaying(t.id)).catch(() => {}); };
  const row = (t: Track) => <div key={t.id} className="row trackrow"><button type="button" className={`trackplay ${playing === t.id ? 'on' : ''}`} aria-label={playing === t.id ? 'Pause preview' : 'Play preview'} onClick={() => preview(t)}>{playing === t.id ? '❚❚' : '▶'}</button>
    <span className="grow"><b>{t.title}</b><small className="meta">{t.artist} · {t.mood}{t.uses ? ` · ${t.uses === 1 ? '1 post' : `${t.uses} posts`}` : ''}</small></span><button type="button" className="btn primary" onClick={() => { a.current?.pause(); onPick(t); }}>Use</button></div>;
  return <Sheet title="Add music" onClose={onClose}><div className="stack"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search music" aria-label="Search music" />
    {!q && trend.length > 0 && <><h4 className="meta">🔥 Trending sounds</h4>{trend.slice(0, 3).map(row)}</>}
    {!items ? <Spinner /> : <div className="list">{items.map(row)}</div>}
    <small className="meta">Royalty-free music. The artist and licence are credited on your post.</small><audio ref={a} onEnded={() => setPlaying(null)} /></div></Sheet>;
}
