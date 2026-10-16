// Settings › Get verified: paid verification (monthly). Payment shows "Coming soon" until store in-app purchase is set up.
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toast, uploadForm, useFeatures } from '../api';
import { Icon } from '../components/ui';
import { showPrice, type Price } from '../lib/region';

type Check = { key: string; label: string; ok: boolean };
type S = { checks: Check[]; request: { status: string } | null; price: Price; active: boolean; notable: boolean; approved: boolean; payments_ready: boolean };
const FIX: Record<string, string> = { profile: '/settings/account', twofa: '/settings/security' };

export function GetVerifiedLink() {
  const f = useFeatures(); if (!f?.paid_verification) return null;
  return <div className="card list"><Link to="/settings/get-verified"><Icon name="shield" /> <span className="grow"><b>Get verified</b></span><Icon name="chev" /></Link></div>;
}

export function GetVerified() {
  const [s, setS] = useState<S | null>(null); const [doc, setDoc] = useState<File | null>(null); const [selfie, setSelfie] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<S>('/me/paid-verification').then(setS).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!doc || !selfie) return; setBusy(true);
    try { const fd = new FormData(); fd.append('id_doc', doc); fd.append('selfie', selfie); await uploadForm('/me/paid-verification', fd); toast('Sent for review'); load(); } catch (x: any) { toast(x.message, 'err'); } finally { setBusy(false); } };
  const head = <div className="row"><Link to="/settings" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">Get verified</h1></div>;
  if (!s) return <div className="stack">{head}</div>;
  const ready = s.checks.every((c) => c.ok); const pending = s.request?.status === 'pending';
  return <div className="stack">{head}
    <section className="card stack"><h3>✔️ Verified subscription</h3>
      <p><b>{showPrice(s.price)}</b> <span className="meta">per month</span></p>
      <ul className="gv-benefits"><li>Blue verified badge</li><li>More visibility in feed, search and suggestions</li><li>Priority support</li><li>Protection against accounts pretending to be you</li></ul>
      <p className="meta">The badge stays while your subscription is active and is removed if it lapses.</p></section>
    {s.active ? <section className="card"><b>You’re verified.</b> Thanks for subscribing.</section>
      : s.notable ? <section className="card"><b>Your account already has a verified badge.</b></section>
      : s.approved ? <section className="card stack"><b>Approved</b><p className="meta">Your ID check passed. Subscribe to turn on your badge.</p><button className="btn primary" disabled>Subscribe · Coming soon</button><p className="meta">Payments open soon through the App Store and Google Play.</p></section>
      : <>
        <section className="card stack"><h3>Requirements</h3>
          <div className="list">{s.checks.map((c) => <div key={c.key} className="row gv-check"><span aria-hidden>{c.ok ? '✅' : '⬜'}</span><span className="grow">{c.label}</span>{!c.ok && FIX[c.key] && <Link className="btn ghost sm" to={FIX[c.key]}>Fix</Link>}</div>)}</div></section>
        {pending ? <section className="card"><b>Under review</b><p className="meta">We’re checking your ID. You’ll get a notification when it’s done.</p></section>
          : <form className="card stack" onSubmit={submit}><h3>ID check</h3><p className="meta">Your ID and selfie are only seen by our review team and deleted after review.</p>
            <label className="stack">Photo of a government ID<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setDoc(e.target.files?.[0] || null)} disabled={!ready} /></label>
            <label className="stack">Selfie<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => setSelfie(e.target.files?.[0] || null)} disabled={!ready} /></label>
            {s.request?.status === 'rejected' && <p className="meta">Your last request wasn’t approved. You can try again with clearer photos.</p>}
            <button className="btn primary" disabled={!ready || !doc || !selfie || busy}>{busy ? 'Sending…' : 'Send for review'}</button>
            {!ready && <p className="meta">Meet all the requirements above to continue.</p>}</form>}
      </>}
  </div>;
}

export function AdminPaidVerification() {
  const f = useFeatures(); const [items, setItems] = useState<any[] | null>(null);
  const load = () => api<{ items: any[] }>('/admin/paid-verification').then((r) => setItems(r.items)).catch(() => setItems(null));
  useEffect(() => { if (f?.paid_verification) load(); }, [f?.paid_verification]);
  if (!f?.paid_verification || !items) return null;
  const decide = async (id: number, decision: string) => { try { await api(`/admin/paid-verification/${id}`, { method: 'POST', json: { decision } }); toast(decision === 'approve' ? 'Approved' : 'Rejected'); load(); } catch (x: any) { toast(x.message, 'err'); } };
  return <section className="card stack"><h3>Paid verification queue</h3>{!items.length ? <p className="meta">Nothing waiting.</p> : items.map((r) =>
    <div key={r.id} className="stack gv-review"><b>@{r.user.username}</b> <span className="meta">{r.user.full_name}</span>
      <div className="row gv-imgs"><a href={`/api/admin/paid-verification/${r.id}/id`} target="_blank" rel="noreferrer"><img src={`/api/admin/paid-verification/${r.id}/id`} alt="ID" /></a><a href={`/api/admin/paid-verification/${r.id}/selfie`} target="_blank" rel="noreferrer"><img src={`/api/admin/paid-verification/${r.id}/selfie`} alt="Selfie" /></a></div>
      <div className="row"><button className="btn primary" onClick={() => decide(r.id, 'approve')}>Approve</button><button className="btn ghost" onClick={() => decide(r.id, 'reject')}>Reject</button></div></div>)}</section>;
}
