// Subscription screens (round 6, FEATURE_SUBSCRIPTIONS). No numeric limits are shown to users.
// Checkout stays "Coming soon" until a provider (App Store / Google Play IAP, optional web processor) is live.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, money, toast } from '../api';
import { Icon } from '../components/ui';
import { showPrice, type Price } from '../lib/region';

type Plan = { code: 'free' | 'pro' | 'premium'; name: string; price_minor: number; currency: string; billing_interval: string; perks: { badge?: string | false; reel_seconds?: number; story_extras?: boolean }; local?: Price | null };
const BENEFITS: Record<Plan['code'], string[]> = {
  free: ['Connectly AI for everyday questions', 'Posts, reels, stories and Go Live', 'All privacy and safety tools'],
  pro: ['More Connectly AI, for longer chats and more writing help', 'Pro badge on your profile', 'Longer reels', 'Extra story features'],
  premium: ['The most Connectly AI', 'Premium badge on your profile', 'The longest reels', 'All story features and early access to new ones'],
};
export const TierBadge = ({ tier }: { tier?: string | null }) => (tier === 'pro' || tier === 'premium' ? <span className={`tierbadge ${tier}`} title={tier === 'pro' ? 'Connectly Pro' : 'Connectly Premium'}>{tier === 'pro' ? 'PRO' : 'PREMIUM'}</span> : null);

function Back({ title, to = '/settings' }: { title: string; to?: string }) {
  return <div className="row"><Link to={to} className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">{title}</h1></div>;
}

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null); const [checkout, setCheckout] = useState(false); const [mine, setMine] = useState<string>('free'); const [err, setErr] = useState('');
  useEffect(() => { api<{ items: Plan[]; checkout_enabled: boolean }>('/subscriptions/plans').then((r) => { setPlans(r.items); setCheckout(r.checkout_enabled); }).catch((e) => setErr(e.message));
    api<{ tier: string }>('/me/subscription').then((s) => setMine(s.tier)).catch(() => {}); }, []);
  const upgrade = async (code: string) => { try { const r = await api<{ url?: string }>('/subscriptions/checkout', { json: { plan: code } }); if (r.url) location.href = r.url; } catch (e: any) { toast(e.message, 'err'); } };
  return <div className="stack">
    <Back title="Upgrade" />
    <div className="planshero"><span className="aiorb">✦</span><h2>Connectly Pro & Premium</h2><p>More Connectly AI, a profile badge, longer reels and extra story features.</p></div>
    {err && <p className="error card">{err}</p>}
    {plans?.map((p) => <section key={p.code} className={`card plancard ${p.code}${mine === p.code ? ' current' : ''}`}>{p.code === 'pro' && <span className="planribbon">MOST POPULAR</span>}
      <div className="row between"><h3>{p.name} <TierBadge tier={p.code} /></h3>{mine === p.code && <span className="chip on">Your plan</span>}</div>
      <p className="planprice">{p.price_minor === 0 && !p.local ? 'Free' : <>{p.local ? showPrice(p.local) : money(p.price_minor / 100, p.currency)} <small>/ {p.billing_interval}</small></>}</p>
      <ul className="planperks">{BENEFITS[p.code].map((b) => <li key={b}>✓ {b}</li>)}</ul>
      {p.code !== 'free' && mine !== p.code && (checkout ? <button className="btn primary block" onClick={() => upgrade(p.code)}>Upgrade to {p.name}</button>
        : <button className="btn block" disabled>Coming soon</button>)}
    </section>)}
    {!checkout && <p className="meta pad">Payments aren’t open yet. Upgrades are coming soon.</p>}
  </div>;
}

export function ManageSubscription() {
  const nav = useNavigate();
  const [s, setS] = useState<{ tier: string; status: string; current_period_end: string | null; plan: Plan; checkout_enabled: boolean } | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/me/subscription').then(setS).catch((e) => setErr(e.message)); }, []);
  return <div className="stack">
    <Back title="Subscription" />
    {err && <p className="error card">{err}</p>}
    {s && <section className={`card plancard ${s.tier} current`}>
      <h3>{s.plan.name} <TierBadge tier={s.tier} /></h3>
      <p className="meta">{s.tier === 'free' ? 'You’re on the free plan.' : `Status: ${s.status === 'active' ? 'Active' : s.status}`}{s.current_period_end ? ` · Renews ${new Date(s.current_period_end).toLocaleDateString()}` : ''}</p>
      <ul className="planperks">{BENEFITS[s.plan.code].map((b) => <li key={b}>✓ {b}</li>)}</ul>
      {s.tier !== 'premium' && <button className="btn primary block" onClick={() => nav('/settings/plans')}>See plans and upgrade</button>}
      {s.tier !== 'free' && <p className="meta">To change or cancel, contact support via Report. Self-serve billing arrives with payments.</p>}
    </section>}
  </div>;
}

/** Friendly limit notice with Upgrade button (used by Connectly AI). */
export function UpgradeNotice({ text }: { text: string }) {
  return <div className="upgradenotice"><p>{text}</p><Link className="btn primary" to="/settings/plans">Upgrade</Link></div>;
}

export function AdminPlans() {
  const [d, setD] = useState<{ items: (Plan & { ai_hourly: number })[]; providers: { id: string; name: string; configured: boolean }[]; checkout_enabled: boolean } | null>(null);
  const load = () => api('/admin/plans').then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const save = async (code: string, el: HTMLFormElement) => { const f = new FormData(el);
    try { await api(`/admin/plans/${code}`, { method: 'PUT', json: { name: String(f.get('name')), price_minor: Math.round(Number(f.get('price')) * 100), currency: String(f.get('currency')).toUpperCase(), ai_hourly: Number(f.get('ai')) } }); toast('Plan saved'); load(); } catch (e: any) { toast(e.message, 'err'); } };
  return <section className="card"><h3>Subscription plans</h3><p className="meta">Payments: {d.providers.map((p) => `${p.name} ${p.configured ? '✓' : '(not set up)'}`).join(' · ')}. Checkout {d.checkout_enabled ? 'enabled' : 'shows “Coming soon”'}. Prices are placeholders. AI allowance is per hour and is never shown to users.</p>
    {d.items.map((p) => <form key={p.code} className="row wrap adminplan" onSubmit={(e) => { e.preventDefault(); save(p.code, e.currentTarget); }}>
      <b className="planc">{p.code}</b>
      <label>Name <input name="name" defaultValue={p.name} maxLength={40} /></label>
      <label>Price <input name="price" type="number" step="0.01" min="0" defaultValue={p.price_minor / 100} /></label>
      <label>Currency <input name="currency" defaultValue={p.currency} maxLength={3} size={4} /></label>
      <label>AI / hour <input name="ai" type="number" min="0" defaultValue={p.ai_hourly} /></label>
      <button className="btn ghost">Save</button></form>)}
  </section>;
}

// Local currency: USD base price per item + per-country overrides (minor units of that currency).
export function AdminPrices() {
  const [d, setD] = useState<{ book: { item: string; usd_cents: number | null }[]; plans: { code: string; price_minor: number; currency: string }[]; overrides: { item: string; country: string; currency: string; amount_minor: number }[] } | null>(null);
  const load = () => api('/admin/prices').then(setD).catch(() => setD(null)); useEffect(() => { load(); }, []);
  if (!d) return null;
  const items = [...new Set(['plan:pro', 'plan:premium', ...d.book.map((b) => b.item)])];
  const base = async (item: string, v: string) => { try { await api(`/admin/prices/${item}`, { method: 'PUT', json: { usd_cents: v === '' ? null : Math.round(Number(v) * 100) } }); toast('Saved'); load(); } catch (e: any) { toast(e.message, 'err'); } };
  const add = async (el: HTMLFormElement) => { const f = new FormData(el); try { await api(`/admin/prices/${f.get('item')}/${String(f.get('country')).toUpperCase()}`, { method: 'PUT', json: { currency: String(f.get('currency')).toUpperCase(), amount_minor: Math.round(Number(f.get('amount')) * 100) } }); toast('Override saved'); el.reset(); load(); } catch (e: any) { toast(e.message, 'err'); } };
  const del = (o: { item: string; country: string }) => api(`/admin/prices/${o.item}/${o.country}`, { method: 'DELETE' }).then(load);
  return <section className="card stack"><h3>Local prices</h3><p className="meta">Set a USD base price; everyone else sees it converted at the daily rate and rounded to a friendly price. A plan with no USD base keeps its own price above and is converted from that. Overrides fix the exact price in one country. In the App Store and Google Play apps, Apple and Google set local prices.</p>
    {items.map((it) => { const b = d.book.find((x) => x.item === it); return <form key={it} className="row wrap adminplan" onSubmit={(e) => { e.preventDefault(); base(it, String(new FormData(e.currentTarget).get('usd'))); }}>
      <b className="planc">{it}</b><label>USD base <input name="usd" type="number" step="0.01" min="0" defaultValue={b?.usd_cents != null ? b.usd_cents / 100 : ''} /></label><button className="btn ghost">Save</button></form>; })}
    <h4>Country overrides</h4>
    {d.overrides.map((o) => <div key={o.item + o.country} className="row between"><span>{o.item} · {o.country}</span><span>{money(o.amount_minor / 100, o.currency)} <button className="btn ghost" onClick={() => del(o)}>Remove</button></span></div>)}
    <form className="row wrap adminplan" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}>
      <label>Item <select name="item">{items.map((i) => <option key={i}>{i}</option>)}</select></label>
      <label>Country <input name="country" required maxLength={2} size={3} placeholder="NG" /></label>
      <label>Currency <input name="currency" required maxLength={3} size={4} placeholder="Currency code" /></label>
      <label>Amount <input name="amount" required type="number" step="0.01" min="0" /></label><button className="btn ghost">Add</button></form>
  </section>;
}
