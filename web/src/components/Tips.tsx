// Coin tips on posts and profiles + creator earnings dashboard. Real-money buy and cash-out are "Coming soon".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toast } from '../api';
import { Avatar, Sheet, Spinner } from './ui';
const AMOUNTS = [10, 50, 100, 500];

export function TipSheet({ to, postId, name, onClose }: { to?: string; postId?: number; name: string; onClose: () => void }) {
  const [bal, setBal] = useState<number | null>(null); const [busy, setBusy] = useState(0);
  useEffect(() => { api<{ balance: number }>('/coins').then((w) => setBal(w.balance)).catch(() => setBal(0)); }, []);
  const send = async (coins: number) => { setBusy(coins);
    try { const r = await api<{ balance: number }>('/tips', { json: { coins, ...(postId ? { post_id: postId } : { username: to }) } }); setBal(r.balance); toast(`Tip sent to ${name} 🪙`); onClose(); }
    catch (e: any) { toast(e.message, 'err'); } finally { setBusy(0); } };
  return <Sheet title={`Tip ${name}`} onClose={onClose}>
    <p className="meta">Tips go straight to the creator as coins.</p>
    {bal === null ? <Spinner /> : <>
      <div className="tipgrid">{AMOUNTS.map((a) => <button key={a} className="tipbtn" disabled={!!busy || bal < a} onClick={() => send(a)}><span>🪙</span><b>{a}</b></button>)}</div>
      <small className="meta">Your balance: 🪙 {bal}. {bal < AMOUNTS[0] ? 'Buying coins is coming soon.' : ''}</small>
      <Link to="/me/coins" className="btn ghost block" onClick={onClose}>Open wallet</Link></>}
  </Sheet>;
}

export function Earnings() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/me/earnings').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="card empty">{err}</p>;
  if (!d) return <Spinner />;
  const max = Math.max(1, ...d.days.map((x: any) => x.coins));
  return <div className="stack"><div className="card wallethero"><span className="coin">🪙</span><b>{d.total}</b><small>Total earned from tips and gifts</small></div>
    <div className="grid2"><div className="card center"><b>{d.month}</b><small className="meta block">Last 30 days</small></div><div className="card center"><b>{d.balance}</b><small className="meta block">Wallet balance</small></div>
      <div className="card center"><b>{d.tips}</b><small className="meta block">From tips</small></div><div className="card center"><b>{d.gifts}</b><small className="meta block">From live gifts</small></div></div>
    <section className="card"><h3>Last two weeks</h3><div className="earnbars" aria-label="Coins earned per day">{d.days.map((x: any) => <span key={x.day} title={`${x.day}: ${x.coins}`} style={{ height: `${Math.max(4, (x.coins / max) * 100)}%` }} />)}</div></section>
    {d.top_supporters.length > 0 && <section className="card list"><h3>Top supporters</h3>{d.top_supporters.map((u: any) => <Link key={u.username} to={`/u/${u.username}`} className="row between"><span className="row"><Avatar user={u} size={36} /> {u.full_name}</span><b>🪙 {u.coins}</b></Link>)}</section>}
    {d.recent.length === 0 && <p className="card empty">Share posts and go live. Tips and gifts you receive show here.</p>}
    <section className="card stack"><h3>Cash out</h3><p className="meta">Turning coins into money is coming soon.</p><button className="btn ghost" onClick={() => toast('Cash out is coming soon.')}>Cash out · Coming soon</button></section></div>;
}
