// Lightweight live UI used on Home/Stories/Admin (no livekit-client import, keeps the main bundle small).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getFeatures, toast } from '../api';
import { Avatar } from './ui';
export type LiveStream = { id: number; title: string; status: 'live' | 'ended'; started_at: string; ends_by: string; end_reason?: string | null; viewer_count: number; is_mine: boolean; host: { id: number; username: string; full_name: string; avatar_path: string | null } };
export function useLiveNow() {
  const [items, setItems] = useState<LiveStream[]>([]);
  useEffect(() => { let t: any; getFeatures().then((f) => { if (!f.live) return; const load = () => api<{ items: LiveStream[] }>('/live').then((r) => setItems(r.items)).catch(() => {}); load(); t = setInterval(load, 30000); }); return () => clearInterval(t); }, []);
  return items;
}
export function LiveRow() {
  const items = useLiveNow(); if (!items.length) return null;
  return <section className="card liverow"><h3><span className="livebadge">LIVE</span> Live now</h3><div className="hscroll">{items.map((s) =>
    <Link key={s.id} to={`/live/${s.id}`} className="livecard"><span className="livering"><Avatar user={s.host} size={56} /></span><span className="livebadge sm">LIVE</span><b>{s.host.full_name}</b><small className="meta">{s.title || 'Live video'} · 👁 {s.viewer_count}</small></Link>)}</div></section>;
}

export function AdminLive() {
  const [d, setD] = useState<{ items: LiveStream[]; month_minutes_used: number; month_budget: number } | null>(null);
  const load = () => api('/admin/live').then(setD).catch(() => setD(null));
  useEffect(() => { getFeatures().then((f) => { if (f.live) load(); }); }, []);
  if (!d) return null;
  return <section className="card"><h3>Live now ({d.items.length}) · {d.month_minutes_used}/{d.month_budget} participant-min this month</h3>
    {d.items.length === 0 ? <p className="meta">No one is live.</p> : d.items.map((s) => <div key={s.id} className="row between pad"><Link to={`/live/${s.id}`}>{s.host.full_name} · {s.title || 'Live'} · 👁 {s.viewer_count}</Link>
      <button className="btn danger" onClick={async () => { if (confirm('End this live stream for everyone?')) { await api(`/admin/live/${s.id}/end`, { method: 'POST' }).catch((e) => toast(e.message, 'err')); load(); } }}>End stream</button></div>)}</section>;
}
