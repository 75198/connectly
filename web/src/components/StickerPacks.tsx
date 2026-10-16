// Sticker picker (built-in + my packs), sticker maker (crop / cutout shape + text), pack manager, shared-pack page, admin review.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, toast, uploadForm, useFeatures } from '../api';
import { Sheet } from './ui';

export type Pick = { key?: string; id?: number; url: string };
type Pack = { id: number; name: string; is_public: boolean; share_token?: string; mine?: boolean; stickers: { id: number; url: string }[]; owner_username?: string; saved?: boolean; hidden_at?: string | null; reasons?: string[] };

export function StickerPicker({ onPick, onClose }: { onPick: (p: Pick) => void; onClose: () => void }) {
  const f = useFeatures(); const [builtin, setBuiltin] = useState<{ key: string; url: string }[]>([]); const [packs, setPacks] = useState<Pack[]>([]); const [tab, setTab] = useState<number>(0);
  useEffect(() => { api<{ stickers: any[] }>('/stickers').then((r) => setBuiltin(r.stickers)).catch(() => {}); if (f?.sticker_packs) api<{ items: Pack[] }>('/sticker-packs/mine').then((r) => setPacks(r.items.filter((p) => p.stickers.length))).catch(() => {}); }, [f?.sticker_packs]);
  const cur = tab ? packs.find((p) => p.id === tab) : null;
  return <Sheet title="Stickers" onClose={onClose}>
    {f?.sticker_packs && <div className="row stk-tabs"><button className={!tab ? 'on' : ''} onClick={() => setTab(0)}>⭐</button>{packs.map((p) => <button key={p.id} className={tab === p.id ? 'on' : ''} onClick={() => setTab(p.id)}><img src={p.stickers[0].url} alt={p.name} /></button>)}<Link to="/stickers" className="btn ghost sm" onClick={onClose}>＋ My stickers</Link></div>}
    <div className="stickergrid">{cur ? cur.stickers.map((s) => <button key={s.id} onClick={() => onPick({ id: s.id, url: s.url })} aria-label="Sticker"><img src={s.url} alt="" /></button>)
      : builtin.map((x) => <button key={x.key} onClick={() => onPick({ key: x.key, url: x.url })} aria-label={x.key}><img src={x.url} alt="" /></button>)}</div>
  </Sheet>;
}

// Make a sticker from a photo: square crop with zoom and position, cutout shape, outline and text. Exported as transparent PNG.
function StickerMaker({ file, onDone, onClose }: { file: File; onDone: (b: Blob) => void; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null); const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1); const [dx, setDx] = useState(0); const [dy, setDy] = useState(0); const [shape, setShape] = useState<'circle' | 'rounded' | 'square'>('circle');
  const [text, setText] = useState(''); const [outline, setOutline] = useState(true);
  useEffect(() => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => setImg(i); i.src = u; return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => {
    const c = cv.current; if (!c || !img) return; const S = 512, x = c.getContext('2d')!; x.clearRect(0, 0, S, S);
    const pad = outline ? 14 : 0; const path = () => { x.beginPath(); if (shape === 'circle') x.arc(S / 2, S / 2, S / 2 - pad, 0, Math.PI * 2); else if (shape === 'rounded') x.roundRect(pad, pad, S - pad * 2, S - pad * 2, 90); else x.rect(pad, pad, S - pad * 2, S - pad * 2); };
    if (outline) { x.save(); x.beginPath(); if (shape === 'circle') x.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); else if (shape === 'rounded') x.roundRect(2, 2, S - 4, S - 4, 100); else x.rect(2, 2, S - 4, S - 4); x.fillStyle = '#fff'; x.fill(); x.restore(); }
    x.save(); path(); x.clip(); const base = Math.max(S / img.width, S / img.height) * zoom; const w = img.width * base, h = img.height * base;
    x.drawImage(img, (S - w) / 2 + dx * S, (S - h) / 2 + dy * S, w, h); x.restore();
    if (text.trim()) { x.font = '900 64px system-ui, sans-serif'; x.textAlign = 'center'; x.lineWidth = 12; x.strokeStyle = '#000'; x.fillStyle = '#fff'; x.lineJoin = 'round'; x.strokeText(text, S / 2, S - 50, S - 40); x.fillText(text, S / 2, S - 50, S - 40); }
  }, [img, zoom, dx, dy, shape, text, outline]);
  const done = () => cv.current?.toBlob((b) => b && onDone(b), 'image/png');
  return <Sheet title="Make a sticker" onClose={onClose}><div className="stack stk-maker">
    <canvas ref={cv} width={512} height={512} className="stk-canvas" aria-label="Sticker preview" />
    <div className="row stk-shapes">{(['circle', 'rounded', 'square'] as const).map((s) => <button key={s} className={`chip ${shape === s ? 'on' : ''}`} onClick={() => setShape(s)}>{s === 'circle' ? 'Circle' : s === 'rounded' ? 'Rounded' : 'Square'}</button>)}<label className="row"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> White border</label></div>
    <label>Zoom<input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>
    <label>Move left / right<input type="range" min={-0.5} max={0.5} step={0.01} value={dx} onChange={(e) => setDx(+e.target.value)} /></label>
    <label>Move up / down<input type="range" min={-0.5} max={0.5} step={0.01} value={dy} onChange={(e) => setDy(+e.target.value)} /></label>
    <label>Text<input value={text} onChange={(e) => setText(e.target.value)} maxLength={24} /></label>
    <button className="btn primary" onClick={done} disabled={!img}>Add to pack</button></div></Sheet>;
}

export function MyStickers() {
  const [packs, setPacks] = useState<Pack[] | null>(null); const [name, setName] = useState(''); const [make, setMake] = useState<{ pack: number; file: File } | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<{ items: Pack[] }>('/sticker-packs/mine').then((r) => setPacks(r.items)).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  const create = async () => { if (!name.trim()) return; try { await api('/sticker-packs', { json: { name } }); setName(''); load(); } catch (x: any) { toast(x.message, 'err'); } };
  const upload = async (pack: number, files: (File | Blob)[]) => { setBusy(true); try { const fd = new FormData(); files.forEach((f, i) => fd.append('files', f, (f as File).name || `sticker${i}.png`)); const r = await uploadForm<{ skipped: number }>(`/sticker-packs/${pack}/stickers`, fd); toast(r.skipped ? 'Added. Some images couldn’t be read.' : 'Added'); load(); } catch (x: any) { toast(x.message, 'err'); } finally { setBusy(false); } };
  const share = async (p: Pack) => { const url = `${location.origin}/stickers/add/${p.share_token}`; try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { /* cancelled */ } };
  const del = async (p: Pack) => { if (!confirm(p.mine ? 'Delete this pack?' : 'Remove this pack from your stickers?')) return; await api(`/sticker-packs/${p.id}`, { method: 'DELETE' }); load(); };
  const delSticker = async (id: number) => { if (!confirm('Delete this sticker?')) return; await api(`/stickers/${id}`, { method: 'DELETE' }); load(); };
  const togglePublic = async (p: Pack) => { await api(`/sticker-packs/${p.id}`, { method: 'PATCH', json: { is_public: !p.is_public } }); load(); };
  return <div className="stack"><h1 className="pagetitle">My stickers</h1>
    <section className="card stack"><h3>New pack</h3><div className="row"><input className="grow" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Pack name" placeholder="Pack name" /><button className="btn primary" onClick={create} disabled={!name.trim()}>Create</button></div></section>
    {!packs ? null : !packs.length ? <p className="meta center">No packs yet. Create one, then add stickers from your photos.</p> : packs.map((p) => <section key={p.id} className="card stack">
      <div className="row"><b className="grow">{p.name}</b>{p.mine && <button className="btn ghost sm" onClick={() => share(p)}>Share link</button>}<button className="btn ghost sm danger" onClick={() => del(p)}>{p.mine ? 'Delete' : 'Remove'}</button></div>
      <div className="stickergrid">{p.stickers.map((s) => <div key={s.id} className="stk-item"><img src={s.url} alt="" />{p.mine && <button className="stk-x" aria-label="Delete sticker" onClick={() => delSticker(s.id)}>×</button>}</div>)}</div>
      {p.mine && <div className="row stk-actions">
        <label className="btn sm">📷 Make from photo<input hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setMake({ pack: p.id, file: f }); e.target.value = ''; }} /></label>
        <label className="btn sm">⬆️ Import PNG / WebP<input hidden type="file" multiple accept="image/png,image/webp" onChange={(e) => { const fl = [...(e.target.files || [])]; if (fl.length) upload(p.id, fl); e.target.value = ''; }} /></label>
        <label className="row meta"><input type="checkbox" checked={p.is_public} onChange={() => togglePublic(p)} /> Anyone with the link can see it</label>
        {busy && <span className="meta">Uploading…</span>}</div>}
    </section>)}
    {make && <StickerMaker file={make.file} onClose={() => setMake(null)} onDone={(b) => { const pk = make.pack; setMake(null); upload(pk, [b]); }} />}
  </div>;
}

export function SharedPack() {
  const { token } = useParams(); const [p, setP] = useState<Pack | null>(null); const [err, setErr] = useState(''); const [reporting, setReporting] = useState(false); const [reason, setReason] = useState('');
  const load = () => api<Pack>(`/sticker-packs/share/${token}`).then(setP).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [token]);
  const save = async () => { try { await api(`/sticker-packs/share/${token}/save`, { method: 'POST' }); toast('Added to your stickers'); load(); } catch (x: any) { toast(x.message, 'err'); } };
  const report = async () => { try { await api(`/sticker-packs/${p!.id}/report`, { json: { reason } }); setReporting(false); toast('Thanks. Our team will review it.'); } catch (x: any) { toast(x.message, 'err'); } };
  if (err) return <div className="card empty"><p>{err}</p></div>; if (!p) return null;
  return <div className="stack"><section className="card stack"><h1 className="pagetitle">{p.name}</h1><p className="meta">Sticker pack by @{p.owner_username}</p>
    <div className="stickergrid">{p.stickers.map((s) => <div key={s.id} className="stk-item"><img src={s.url} alt="" /></div>)}</div>
    {p.mine ? <Link className="btn" to="/stickers">Manage your pack</Link> : p.saved ? <p className="meta">✅ In your stickers</p> : <button className="btn primary" onClick={save}>Add to my stickers</button>}
    {!p.mine && <button className="btn ghost sm" onClick={() => setReporting(true)}>Report pack</button>}</section>
    {reporting && <Sheet title="Report sticker pack" onClose={() => setReporting(false)}><div className="stack">
      {['Nudity or sexual content', 'Hate or harassment', 'Violence', 'Scam or impersonation', 'Copyright'].map((r) => <label key={r} className="row"><input type="radio" name="r" checked={reason === r} onChange={() => setReason(r)} /> {r}</label>)}
      <button className="btn primary" disabled={!reason} onClick={report}>Send report</button></div></Sheet>}
  </div>;
}

export function AdminStickerPacks() {
  const f = useFeatures(); const [items, setItems] = useState<Pack[] | null>(null);
  const load = () => api<{ items: Pack[] }>('/admin/sticker-packs').then((r) => setItems(r.items)).catch(() => setItems(null));
  useEffect(() => { if (f?.sticker_packs) load(); }, [f?.sticker_packs]);
  if (!f?.sticker_packs || !items) return null;
  const act = async (id: number, action: string) => { await api(`/admin/sticker-packs/${id}`, { json: { action } }); load(); };
  return <section className="card stack"><h3>Reported sticker packs</h3>{!items.length ? <p className="meta">Nothing reported.</p> : items.map((p) => <div key={p.id} className="stack gv-review">
    <b>{p.name} <span className="meta">by @{p.owner_username}{p.hidden_at ? ' · hidden' : ''}</span></b><small className="meta">{(p.reasons || []).join(' · ')}</small>
    <div className="stickergrid sm">{(p.stickers || []).slice(0, 12).map((s) => <img key={s.id} src={s.url} alt="" />)}</div>
    <div className="row"><button className="btn danger" onClick={() => act(p.id, 'hide')}>Hide pack</button><button className="btn ghost" onClick={() => act(p.id, 'restore')}>Keep / restore</button></div></div>)}</section>;
}
