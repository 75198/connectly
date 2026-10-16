import { approx, useRegion } from '../lib/region';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, timeAgo } from '../api';
import { Avatar, Icon } from '../components/ui';
import { PlacePicker } from '../components/PlacePicker';

type Listing = { id: number; title: string; price: number; currency: string; category: string; description: string; location: string; status: 'active' | 'sold'; created_at: string; is_mine: boolean;
  seller: { username: string; full_name: string; avatar_path: string | null }; photos: string[] };
type Meta = { categories: string[]; currencies: string[] };
let metaCache: Meta | null = null;
const useMeta = () => { const [m, setM] = useState<Meta | null>(metaCache); useEffect(() => { if (!m) api<Meta>('/listings/meta').then((x) => { metaCache = x; setM(x); }); }, [m]); return m; };

export function Market() {
  const region = useRegion();
  const [sp, setSp] = useSearchParams(); const meta = useMeta();
  const mine = sp.get('mine') === '1';
  const [q, setQ] = useState(sp.get('q') || ''); const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<Listing[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const qs = sp.toString();
  const load = async (reset: boolean) => {
    setLoading(true); setErr('');
    try { const r = await api<{ items: Listing[]; next_cursor: string | null }>(`/listings?${qs}${!reset && cursor ? `&cursor=${cursor}` : ''}`); setItems((x) => reset ? r.items : [...(x || []), ...r.items]); setCursor(r.next_cursor); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { setItems(null); load(true); }, [qs]); // eslint-disable-line
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => { const t = setTimeout(() => { if ((sp.get('q') || '') !== q.trim()) setParam('q', q.trim()); }, 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line
  return <div className="stack">
    <div className="row between"><h1 className="pagetitle">{mine ? 'Your listings' : 'Marketplace'}</h1><Link className="btn primary" to="/market/new"><Icon name="plus" /> Sell</Link></div>
    {!mine && <div className="stack">
      <label className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search marketplace" placeholder="Search Marketplace" maxLength={100} enterKeyHint="search" /></label>
      <div className="chiprow catchips">{['', ...(meta?.categories || [])].map((c) => <button key={c || 'all'} className={`chip ${(sp.get('category') || '') === c ? 'on' : ''}`} onClick={() => setParam('category', c)}>{c ? `${catEmoji(c)} ${c}` : '✨ All'}</button>)}</div>
      <div className="row wrap">
        <select aria-label="Sort" value={sp.get('sort') || 'newest'} onChange={(e) => setParam('sort', e.target.value === 'newest' ? '' : e.target.value)}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select>
        <button className="btn ghost" onClick={() => setShowFilters(!showFilters)}><Icon name="sliders" /> {showFilters ? 'Hide filters' : 'Filters'}</button>
      </div>
      {showFilters && <div className="grid2">
        <label>Min price<input inputMode="decimal" value={sp.get('min') || ''} onChange={(e) => setParam('min', e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label>Max price<input inputMode="decimal" value={sp.get('max') || ''} onChange={(e) => setParam('max', e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label>Currency<select value={sp.get('currency') || ''} onChange={(e) => setParam('currency', e.target.value)}><option value="">Any</option>{meta?.currencies.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Location<input value={sp.get('location') || ''} onChange={(e) => setParam('location', e.target.value)} /></label>
      </div>}
    </div>}
    {mine && <Link to="/market" className="linkish">← Browse marketplace</Link>}
    {err && <p className="error card">{err}</p>}
    {!items ? <div className="mgrid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="mcard skel"><span className="sk block sq" /><span className="sk line w60" /><span className="sk line w40" /></div>)}</div> : items.length === 0 ? <p className="card empty">{mine ? 'You haven’t listed anything yet.' : 'No listings match.'}</p> : <div className="mgrid">
      {items.map((l) => <Link key={l.id} to={`/market/${l.id}`} className="mcard"><div className="mimg">{l.photos[0] && <img src={l.photos[0]} alt="" loading="lazy" />}{l.status === 'sold' && <span className="soldtag">Sold</span>}</div>
        <b>{money(l.price, l.currency)}</b>{approx(l.price, l.currency, region) && <small className="meta approx">{approx(l.price, l.currency, region)}</small>}<span className="mtitle">{l.title}</span><small className="meta">{l.location || l.category}</small></Link>)}</div>}
    {cursor && <button className="btn ghost block" disabled={loading} onClick={() => load(false)}>{loading ? 'Loading…' : 'Show more'}</button>}
  </div>;
}

function MarketSafety() {
  return <div className="card marketsafety"><b>🛡️ Stay safe when buying</b><ul className="meta"><li><b>Never pay outside the app</b> or send a deposit before you see the item.</li><li>Meet in a busy public place and check the item first.</li><li>Never share codes, passwords or bank logins. Connectly will never ask for them.</li><li>Prices far below normal are a common scam. Report anything suspicious.</li></ul></div>;
}
export function NewListing() {
  const meta = useMeta(); const nav = useNavigate();
  const [d, setD] = useState({ title: '', price: '', currency: 'USD', category: '', description: '' });
  const reg = useRegion(); useEffect(() => { if (reg?.currency) setD((x) => (x.price ? x : { ...x, currency: reg.currency })); }, [reg?.currency]); const [placeId, setPlaceId] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const addFiles = (fl: FileList | null) => { if (!fl) return; const ok = [...fl].filter((f) => f.type.startsWith('image/') && f.size <= 15 * 1024 * 1024); if (ok.length < fl.length) setErr('Some files were skipped (images up to 15 MB only).'); setFiles((x) => [...x, ...ok].slice(0, 6)); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!files.length) return setErr('Add at least one photo');
    const fd = new FormData(); Object.entries(d).forEach(([k, v]) => fd.append(k, v)); if (placeId) fd.append('place_id', String(placeId)); files.forEach((f) => fd.append('photos', f));
    setBusy(true); try { const l = await api<Listing>('/listings', { form: fd }); nav(`/market/${l.id}`); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return <div className="stack"><h1 className="pagetitle">New listing</h1>
    <form className="card stack" onSubmit={submit}>
      <div className="thumbs">{files.map((f, i) => <div key={i} className="thumb"><img src={URL.createObjectURL(f)} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></div>)}
        {files.length < 6 && <label className="thumb add"><Icon name="image" /><span>Add photos</span><input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} /></label>}</div>
      <label>Title<input value={d.title} onChange={set('title')} required minLength={3} maxLength={100} /></label>
      <div className="grid2"><label>Price<input value={d.price} onChange={(e) => setD({ ...d, price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" required /></label>
        <label>Currency<select value={d.currency} onChange={set('currency')}>{meta?.currencies.map((c) => <option key={c}>{c}</option>)}</select></label></div>
      <label>Category<select value={d.category} onChange={set('category')} required><option value="" disabled>Choose a category</option>{meta?.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Description<textarea value={d.description} onChange={set('description')} rows={4} maxLength={3000} /></label>
      <PlacePicker label="Location" value="" onPick={(p) => setPlaceId(p ? p.id : null)} />
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish listing'}</button>
    </form></div>;
}

export function ListingView() {
  const region = useRegion();
  const { id = '' } = useParams(); const nav = useNavigate();
  const [l, setL] = useState<Listing | null>(null); const [err, setErr] = useState(''); const [i, setI] = useState(0);
  useEffect(() => { api<Listing>(`/listings/${id}`).then(setL).catch((e) => setErr(e.message)); }, [id]);
  if (err && !l) return <div className="card empty">{err}</div>;
  if (!l) return <div className="card empty"><div className="spinner" /></div>;
  const setStatus = async (status: 'active' | 'sold') => { try { setL(await api<Listing>(`/listings/${l.id}`, { method: 'PATCH', json: { status } })); } catch (e: any) { setErr(e.message); } };
  return <div className="stack">
    <div className="card listing">
      <div className="lphoto">{l.photos[i] && <img src={l.photos[i]} alt="" />}{l.status === 'sold' && <span className="soldtag">Sold</span>}</div>
      {l.photos.length > 1 && <div className="thumbs">{l.photos.map((p, j) => <button key={p} className={`thumb ${j === i ? 'sel' : ''}`} onClick={() => setI(j)} aria-label={`Photo ${j + 1}`}><img src={p} alt="" /></button>)}</div>}
      <div className="stack pad">
        <h1>{l.title}</h1>{!l.is_mine && <MarketSafety />}<b className="price">{money(l.price, l.currency)}</b>{approx(l.price, l.currency, region) && <small className="meta approx">{approx(l.price, l.currency, region)} in your currency</small>}
        <p className="meta">{l.category}{l.location ? ` · ${l.location}` : ''} · listed {timeAgo(l.created_at)}</p>
        {l.description && <p className="body">{l.description}</p>}
        <Link to={`/u/${l.seller.username}`} className="person card"><Avatar user={l.seller} size={44} /><span className="grow"><b>{l.seller.full_name}</b><small className="meta">Seller · view profile to contact</small></span><Icon name="chev" /></Link>
        {err && <p className="error">{err}</p>}
        {l.is_mine ? <div className="row wrap">
          {l.status === 'active' ? <button className="btn primary" onClick={() => setStatus('sold')}>Mark as sold</button> : <button className="btn ghost" onClick={() => setStatus('active')}>Mark as available</button>}
          <button className="btn ghost danger" onClick={async () => { if (!confirm('Delete this listing?')) return; await api(`/listings/${l.id}`, { method: 'DELETE' }); nav('/market?mine=1'); }}>Delete listing</button>
        </div> : <Link className="btn primary block" to={`/u/${l.seller.username}`}>Contact seller</Link>}
      </div>
    </div></div>;
}

function catEmoji(c: string) {
  const m: [RegExp, string][] = [[/phone|electron|computer|tech/i, '📱'], [/vehicle|car|auto/i, '🚗'], [/home|furn|garden/i, '🛋️'], [/fashion|cloth|wear/i, '👗'], [/property|rent|house/i, '🏠'], [/baby|kid|toy/i, '🧸'], [/sport|fitness/i, '⚽'], [/beauty|health/i, '💄'], [/job|service/i, '🛠️'], [/food|grocer/i, '🍲'], [/book|music|hobb/i, '🎸'], [/pet/i, '🐶']];
  return m.find(([r]) => r.test(c))?.[1] || '🏷️';
}
