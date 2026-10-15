// In-app camera + photo editor + avatar maker. 100% client-side, no third-party services.
// Output is a File handed to the caller (posts, stories, reel covers, profile photo).
import { PointerEvent as RPE, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { askPermission, showPermissionDenied } from '../lib/permission';
import { useFeatures } from '../api';
import { EFFECTS, loadFaceLandmarker, startAR, type EffectKey } from '../lib/ar';

export type StudioResult = { file: File; enhance: boolean };
type Props = { onDone: (r: StudioResult) => void; onClose: () => void; allowVideo?: boolean; initial?: File | Blob | null; startWith?: 'menu' | 'camera' | 'avatar' };

type Adj = { b: number; c: number; s: number; w: number; sharp: number; fade: number };
const ZERO: Adj = { b: 0, c: 0, s: 0, w: 0, sharp: 0, fade: 0 };
const FILTERS: [string, Partial<Adj>][] = [['Original', {}], ['Vivid', { c: 15, s: 30 }], ['Warm', { w: 35, s: 10 }], ['Cool', { w: -35 }], ['Lagos', { b: 8, c: 10, s: 20, w: 20 }],
  ['Fade', { fade: 30, c: -10 }], ['Mono', { s: -100, c: 15 }], ['Noir', { s: -100, c: 40, b: -8 }], ['Golden', { w: 50, b: 6, s: 15 }], ['Crisp', { c: 20, sharp: 60 }]];
const ADJ: [keyof Adj, string, number, number][] = [['b', 'Brightness', -50, 50], ['c', 'Contrast', -50, 50], ['s', 'Saturation', -100, 100], ['w', 'Warmth', -60, 60], ['sharp', 'Sharpen', 0, 100], ['fade', 'Fade', 0, 60]];
const STICKERS = ['😍', '😂', '🔥', '🎉', '❤️', '✨', '👍', '🙏', '😎', '🥳', '🌍', '🇳🇬', '💯', '🌸', '⚽', '🎶'];
const COLORS = ['#ffffff', '#000000', '#F43F5E', '#F59E0B', '#10B981', '#0EA5E9', '#8B5CF6', '#14B8A6'];
const RATIOS: [string, number | null][] = [['Original', null], ['1:1', 1], ['4:5', 0.8], ['9:16', 9 / 16], ['16:9', 16 / 9]];
type Item = { id: number; kind: 'text' | 'sticker'; text: string; x: number; y: number; size: number; color: string };
type Stroke = { color: string; width: number; pts: [number, number][] };

const cssFilter = (a: Adj) => `brightness(${1 + a.b / 100}) contrast(${(1 + a.c / 100) * (1 - a.fade / 200)}) saturate(${1 + a.s / 100})`;

export function MediaStudio({ onDone, onClose, allowVideo, initial, startWith = 'menu' }: Props) {
  const [stage, setStage] = useState<'menu' | 'camera' | 'edit' | 'avatar'>(initial ? 'edit' : startWith);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const openImage = (b: Blob) => { const u = URL.createObjectURL(b); const i = new Image(); i.onload = () => { setImg(i); setStage('edit'); }; i.src = u; };
  useEffect(() => { if (initial) openImage(initial); }, []); // eslint-disable-line
  const pick = (f?: File) => { if (!f) return; if (f.type.startsWith('video/')) { if (allowVideo) onDone({ file: f, enhance: false }); return; } openImage(f); };
  // Portal + stopPropagation: the studio is often opened from inside the composer <form>/sheet.
  return createPortal(<div className="studio" role="dialog" aria-label="Camera and editor" onSubmit={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    {stage === 'menu' && <div className="studiomenu">
      <div className="row between studiohead"><b>Create</b><button className="btn icon reelbtn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <button className="studiobig" onClick={() => setStage('camera')}><span>📷</span><b>Camera</b><small>Take a photo{allowVideo ? ' or record a video' : ''}</small></button>
      <button className="studiobig" onClick={() => pickRef.current?.click()}><span>🖼️</span><b>Gallery</b><small>Choose from your phone</small></button>
      <button className="studiobig" onClick={() => setStage('avatar')}><span>🧑🏾‍🎨</span><b>Avatar</b><small>Make a cartoon avatar of you</small></button>
      <input ref={pickRef} type="file" hidden accept={allowVideo ? 'image/*,video/mp4,video/quicktime,video/webm' : 'image/*'} onChange={(e) => pick(e.target.files?.[0])} />
    </div>}
    {stage === 'camera' && <Camera allowVideo={!!allowVideo} onPhoto={openImage} onVideo={(f) => onDone({ file: f, enhance: false })} onBack={() => setStage('menu')} />}
    {stage === 'avatar' && <AvatarMaker onBack={() => setStage('menu')} onDone={(b) => openImage(b)} />}
    {stage === 'edit' && img && <Editor img={img} onBack={() => (initial ? onClose() : setStage('menu'))} onDone={onDone} />}
  </div>, document.body);
}

// ---------- camera ----------
function Camera({ allowVideo, onPhoto, onVideo, onBack }: { allowVideo: boolean; onPhoto: (b: Blob) => void; onVideo: (f: File) => void; onBack: () => void }) {
  const v = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const rec = useRef<MediaRecorder | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment'); const [err, setErr] = useState('');
  const ff = useFeatures(); const [fx, setFx] = useState<EffectKey>('none'); const fxRef = useRef<EffectKey>('none'); fxRef.current = fx; const cv = useRef<HTMLCanvasElement>(null); const [arState, setArState] = useState<'' | 'loading' | 'on' | 'failed'>(''); const facingRef = useRef(facing); facingRef.current = facing;
  useEffect(() => { if (fx === 'none' || arState === 'on' || arState === 'loading') return; setArState('loading'); let stop: (() => void) | undefined; loadFaceLandmarker().then((fl) => { if (!v.current || !cv.current) return; stop = startAR(v.current, cv.current, () => fxRef.current, () => facingRef.current === 'user', fl); setArState('on'); }).catch(() => { setArState('failed'); setFx('none'); setErr('Effects aren’t available on this device.'); }); return () => { if (stop) { stop(); setArState(''); } }; }, [fx === 'none']); // eslint-disable-line react-hooks/exhaustive-deps
  const [torch, setTorch] = useState<boolean | null>(null); const [mode, setMode] = useState<'photo' | 'video'>('photo'); const [recSecs, setRecSecs] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t open the camera. Use Gallery instead.');
        const kind = allowVideo && mode === 'video' ? 'camera+microphone' : 'camera';
        if (!await askPermission(kind)) { if (live) setErr('Camera is off. Use Gallery instead, or tap Camera again to allow it.'); return; }
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: allowVideo && mode === 'video' });
        if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s; if (v.current) { v.current.srcObject = s; await v.current.play().catch(() => {}); }
        const caps: any = s.getVideoTracks()[0]?.getCapabilities?.() || {}; setTorch(caps.torch ? false : null);
      } catch (e: any) { if (e.name === 'NotAllowedError') showPermissionDenied(allowVideo && mode === 'video' ? 'camera+microphone' : 'camera'); setErr(e.name === 'NotAllowedError' ? 'Camera permission was not given. Allow it in your browser settings, or use Gallery.' : e.message || 'Couldn’t open the camera.'); }
    })();
    return () => { live = false; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, [facing, mode, allowVideo]);
  const toggleTorch = async () => { const t: any = stream.current?.getVideoTracks()[0]; if (!t) return; try { await t.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setTorch(null); } };
  const arOn = arState === 'on' && fx !== 'none';
  const snap = () => {
    if (arOn && cv.current) { cv.current.toBlob((b) => b && onPhoto(b), 'image/jpeg', 0.95); return; }
    const el = v.current!; const c = document.createElement('canvas'); c.width = el.videoWidth; c.height = el.videoHeight;
    const g = c.getContext('2d')!; if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(el, 0, 0);
    c.toBlob((b) => b && onPhoto(b), 'image/jpeg', 0.95);
  };
  const record = () => {
    if (rec.current) { rec.current.stop(); return; }
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
    if (!type || !stream.current) return setErr('Recording isn’t supported in this browser.');
    const src = arOn && cv.current ? new MediaStream([...cv.current.captureStream(30).getVideoTracks(), ...stream.current.getAudioTracks()]) : stream.current;
    const chunks: Blob[] = []; const r = new MediaRecorder(src, { mimeType: type, videoBitsPerSecond: 8_000_000 }); rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => { rec.current = null; setRecSecs(null); const base = type.split(';')[0]; onVideo(new File(chunks, `reel.${base.endsWith('mp4') ? 'mp4' : 'webm'}`, { type: base })); };
    r.start(500); setRecSecs(0);
    const t0 = Date.now(); const iv = window.setInterval(() => { if (!rec.current) return clearInterval(iv); const s = Math.floor((Date.now() - t0) / 1000); setRecSecs(s); if (s >= 60) rec.current.stop(); }, 250);
  };
  return <div className="camera">
    <video ref={v} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
    <canvas ref={cv} className="arcanvas" hidden={!arOn} aria-hidden="true" />
    <div className="row between studiohead"><button className="btn icon reelbtn" aria-label="Back" onClick={onBack}><Icon name="back" /></button>
      {recSecs !== null && <b className="recdot">● {recSecs}s</b>}
      <span className="row">{torch !== null && <button className="btn icon reelbtn" aria-label="Flash" aria-pressed={torch} onClick={toggleTorch}>{torch ? '⚡' : '🔦'}</button>}</span></div>
    {err && <p className="camerr">{err}</p>}
    <div className="camctl">
      {ff?.ar_effects && <div className="fxrow" role="listbox" aria-label="Effects">{EFFECTS.map((e) => <button key={e.k} role="option" aria-selected={fx === e.k} className={fx === e.k ? 'on' : ''} disabled={recSecs !== null} onClick={() => setFx(e.k)}><span>{e.icon}</span><small>{e.label}</small></button>)}{arState === 'loading' && <small className="fxload">Loading effects…</small>}</div>}
      {allowVideo && <div className="segmented dark">{(['photo', 'video'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} disabled={recSecs !== null} onClick={() => setMode(m)}>{m === 'photo' ? 'Photo' : 'Video'}</button>)}</div>}
      <div className="row camrow"><span style={{ width: 48 }} />
        <button className={`shutter ${mode === 'video' ? 'vid' : ''} ${recSecs !== null ? 'rec' : ''}`} aria-label={mode === 'photo' ? 'Take photo' : recSecs !== null ? 'Stop recording' : 'Start recording'} onClick={mode === 'photo' ? snap : record} />
        <button className="btn icon reelbtn" aria-label="Switch camera" disabled={recSecs !== null} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>🔄</button></div>
    </div>
  </div>;
}

// ---------- editor ----------
function Editor({ img, onBack, onDone }: { img: HTMLImageElement; onBack: () => void; onDone: (r: StudioResult) => void }) {
  const [tab, setTab] = useState<'crop' | 'filters' | 'adjust' | 'text' | 'stickers' | 'draw'>('filters');
  const [rot, setRot] = useState(0); const [ratio, setRatio] = useState<number | null>(null); const [zoom, setZoom] = useState(1);
  const [adj, setAdj] = useState<Adj>(ZERO); const [filterName, setFilterName] = useState('Original'); const [enhance, setEnhance] = useState(false);
  const [items, setItems] = useState<Item[]>([]); const [strokes, setStrokes] = useState<Stroke[]>([]); const [brush, setBrush] = useState({ color: '#F43F5E', width: 8 });
  const [busy, setBusy] = useState(false); const [boxW, setBoxW] = useState(300);
  const stageRef = useRef<HTMLDivElement>(null); const prev = useRef<HTMLCanvasElement>(null); const draw = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null); const drawing = useRef<Stroke | null>(null);
  // geometry of the cropped, rotated output (in source pixels)
  const rotated = rot % 180 !== 0; const sw = rotated ? img.naturalHeight : img.naturalWidth; const sh = rotated ? img.naturalWidth : img.naturalHeight;
  const r = ratio ?? sw / sh; let cw = sw, ch = sw / r; if (ch > sh) { ch = sh; cw = sh * r; } cw /= zoom; ch /= zoom;
  const renderBase = (c: HTMLCanvasElement, scale: number) => {
    c.width = Math.round(cw * scale); c.height = Math.round(ch * scale); const g = c.getContext('2d')!;
    g.save(); g.scale(scale, scale); g.translate(cw / 2, ch / 2); g.rotate((rot * Math.PI) / 180); g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2); g.restore();
  };
  const pvScale = Math.min(1, 900 / Math.max(cw, ch));
  useEffect(() => { const el = stageRef.current; if (!el || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(() => setBoxW(el.clientWidth || 300)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { if (prev.current) renderBase(prev.current, pvScale); }); // eslint-disable-line
  useEffect(() => { const c = draw.current; if (!c || !prev.current) return; c.width = prev.current.width; c.height = prev.current.height; paintStrokes(c.getContext('2d')!, strokes, c.width, c.height); });
  const pt = (e: RPE) => { const b = stageRef.current!.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height] as [number, number]; };
  const down = (e: RPE) => { if (tab !== 'draw') return; (e.target as Element).setPointerCapture?.(e.pointerId); drawing.current = { ...brush, pts: [pt(e)] }; setStrokes((s) => [...s, drawing.current!]); };
  const move = (e: RPE) => {
    if (drag.current) { const [x, y] = pt(e); const d = drag.current; setItems((xs) => xs.map((i) => (i.id === d.id ? { ...i, x: x - d.dx, y: y - d.dy } : i))); return; }
    if (drawing.current) { drawing.current.pts.push(pt(e)); setStrokes((s) => [...s]); }
  };
  const up = () => { drag.current = null; drawing.current = null; };
  const add = (kind: Item['kind'], text: string, color = '#ffffff') => setItems((xs) => [...xs, { id: Date.now(), kind, text, x: 0.5, y: 0.45, size: kind === 'sticker' ? 0.14 : 0.07, color }]);
  async function exportFile() {
    setBusy(true); await new Promise((r) => setTimeout(r, 30));
    const scale = Math.min(1, 4096 / Math.max(cw, ch)); const c = document.createElement('canvas'); renderBase(c, scale);
    const g = c.getContext('2d')!; applyAdjust(g, c.width, c.height, adj);
    paintStrokes(g, strokes, c.width, c.height);
    for (const i of items) { g.save(); g.font = `${i.kind === 'text' ? '800 ' : ''}${Math.round(i.size * c.width)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (i.kind === 'text') { g.lineWidth = Math.max(2, i.size * c.width * 0.08); g.strokeStyle = i.color === '#000000' ? '#fff' : 'rgba(0,0,0,.55)'; g.strokeText(i.text, i.x * c.width, i.y * c.height); g.fillStyle = i.color; }
      g.fillText(i.text, i.x * c.width, i.y * c.height); g.restore(); }
    c.toBlob((b) => { setBusy(false); if (b) onDone({ file: new File([b], 'connectly-photo.jpg', { type: 'image/jpeg' }), enhance }); }, 'image/jpeg', 0.95);
  }
  const TABS = [['crop', 'Crop'], ['filters', 'Filters'], ['adjust', 'Adjust'], ['text', 'Text'], ['stickers', 'Stickers'], ['draw', 'Draw']] as const;
  return <div className="editor">
    <div className="row between studiohead"><button className="btn icon reelbtn" aria-label="Back" onClick={onBack}><Icon name="back" /></button><b>Edit</b>
      <button className="btn primary" disabled={busy} onClick={exportFile}>{busy ? 'Saving…' : 'Done'}</button></div>
    <div className="edstage">
      <div ref={stageRef} className="edcanvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: tab === 'draw' || drag.current ? 'none' : 'manipulation' }}>
        <canvas ref={prev} style={{ filter: cssFilter(adj) }} />
        {adj.w !== 0 && <div className="warm" style={{ background: adj.w > 0 ? '#ff9a3c' : '#3c8dff', opacity: Math.abs(adj.w) / 250 }} />}
        <canvas ref={draw} className="drawlayer" />
        {items.map((i) => <span key={i.id} className={`edtext ${i.kind}`} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, fontSize: `${i.size * boxW}px`, color: i.color }}
          onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); const [x, y] = pt(e); drag.current = { id: i.id, dx: x - i.x, dy: y - i.y }; }}
          onDoubleClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))}>{i.text}</span>)}
      </div>
    </div>
    <div className="edpanel">
      <nav className="edtabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === 'crop' && <div className="stack">
        <div className="chiprow">{RATIOS.map(([l, v]) => <button key={l} className={`chip ${ratio === v ? 'on' : ''}`} onClick={() => setRatio(v)}>{l}</button>)}</div>
        <div className="row"><button className="btn ghost" onClick={() => setRot((rot + 270) % 360)}>⟲ Rotate left</button><button className="btn ghost" onClick={() => setRot((rot + 90) % 360)}>⟳ Rotate right</button></div>
        <label className="slider">Zoom<input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label></div>}
      {tab === 'filters' && <div className="filterrow">{FILTERS.map(([n, f]) => <button key={n} className={`filterthumb ${filterName === n ? 'on' : ''}`} onClick={() => { setFilterName(n); setAdj({ ...ZERO, ...f }); }}>
        <span style={{ backgroundImage: `url(${img.src})`, filter: cssFilter({ ...ZERO, ...f }) }} /><small>{n}</small></button>)}</div>}
      {tab === 'adjust' && <div className="stack">
        <label className="check"><input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> <span>✨ Auto-enhance (sharper, richer colours)</span></label>
        {ADJ.map(([k, l, mn, mx]) => <label key={k} className="slider">{l} <small>{adj[k]}</small><input type="range" min={mn} max={mx} value={adj[k]} onChange={(e) => setAdj({ ...adj, [k]: +e.target.value })} /></label>)}</div>}
      {tab === 'text' && <TextAdd onAdd={(t, c) => add('text', t, c)} />}
      {tab === 'stickers' && <div className="stickergrid">{STICKERS.map((s) => <button key={s} onClick={() => add('sticker', s)}>{s}</button>)}<p className="meta">Drag to move · double-tap to remove</p></div>}
      {tab === 'draw' && <div className="stack"><div className="chiprow">{COLORS.map((c) => <button key={c} className={`swatch ${brush.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setBrush({ ...brush, color: c })} />)}</div>
        <label className="slider">Brush size<input type="range" min={2} max={40} value={brush.width} onChange={(e) => setBrush({ ...brush, width: +e.target.value })} /></label>
        <div className="row"><button className="btn ghost" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>Undo</button><button className="btn ghost" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button></div></div>}
    </div>
  </div>;
}
function TextAdd({ onAdd }: { onAdd: (t: string, c: string) => void }) {
  const [t, setT] = useState(''); const [c, setC] = useState('#ffffff');
  return <form className="stack" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (t.trim()) { onAdd(t.trim(), c); setT(''); } }}>
    <div className="row"><input value={t} onChange={(e) => setT(e.target.value)} maxLength={60} aria-label="Text to add" placeholder="Type something" /><button className="btn primary" disabled={!t.trim()}>Add</button></div>
    <div className="chiprow">{COLORS.map((x) => <button type="button" key={x} className={`swatch ${c === x ? 'on' : ''}`} style={{ background: x }} aria-label={`Colour ${x}`} onClick={() => setC(x)} />)}</div>
    <p className="meta">Drag text to move · double-tap to remove</p></form>;
}
function paintStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of strokes) { g.strokeStyle = s.color; g.lineWidth = (s.width / 400) * w; g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); if (s.pts.length === 1) g.lineTo(s.pts[0][0] * w + 0.1, s.pts[0][1] * h); g.stroke(); }
}
// Pixel adjustments (same maths as the CSS preview, so it works in every browser incl. older Safari).
export function applyAdjust(g: CanvasRenderingContext2D, w: number, h: number, a: Adj) {
  if (a.b === 0 && a.c === 0 && a.s === 0 && a.w === 0 && a.fade === 0 && a.sharp === 0) return;
  const d = g.getImageData(0, 0, w, h); const p = d.data;
  const br = 1 + a.b / 100, ct = (1 + a.c / 100) * (1 - a.fade / 200), sat = 1 + a.s / 100, wr = a.w * 0.35;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i] * br, gg = p[i + 1] * br, b = p[i + 2] * br;
    r = (r - 128) * ct + 128; gg = (gg - 128) * ct + 128; b = (b - 128) * ct + 128;
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b; r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
    r += wr; b -= wr; p[i] = r; p[i + 1] = gg; p[i + 2] = b;
  }
  if (a.sharp > 0) { // unsharp-style 3x3 kernel
    const k = a.sharp / 100 * 0.6, src = new Uint8ClampedArray(p), W = w * 4;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * W + x * 4; for (let c = 0; c < 3; c++) p[i + c] = src[i + c] * (1 + 4 * k) - k * (src[i - 4 + c] + src[i + 4 + c] + src[i - W + c] + src[i + W + c]); }
  }
  g.putImageData(d, 0, 0);
}

// ---------- avatar maker (original, self-built SVG) ----------
const SKIN = ['#FDE7D6', '#F3C9A5', '#D9A37B', '#B97A4F', '#8D5A3B', '#5E3A26', '#3E261A'];
const HAIRC = ['#1F1A17', '#4A2F1F', '#8B5A2B', '#D9A441', '#B23A2E', '#9CA3AF', '#7C3AED'];
const BG = ['#CCFBF1', '#FEF3C7', '#FCE7F3', '#DBEAFE', '#E9D5FF', '#DCFCE7', '#0F766E'];
const HAIR = ['Short', 'Afro', 'Long', 'Braids', 'Bun', 'Bald', 'Curly'] as const;
type Av = { skin: number; hair: number; hairc: number; bg: number; eyes: number; mouth: number; glasses: boolean; beard: boolean; earrings: boolean };
export function avatarSvg(a: Av, size = 512) {
  const s = SKIN[a.skin], h = HAIRC[a.hairc], hs = HAIR[a.hair];
  const back = hs === 'Afro' ? `<circle cx="256" cy="200" r="130" fill="${h}"/>` : hs === 'Long' ? `<path d="M150 230 Q140 420 190 470 L322 470 Q372 420 362 230 Z" fill="${h}"/>` : hs === 'Braids' ? `<g fill="${h}">${[0, 1, 2, 3].map((i) => `<rect x="${150 + i * 6}" y="${240 + i * 4}" width="18" height="${190 - i * 10}" rx="9"/><rect x="${344 - i * 6}" y="${240 + i * 4}" width="18" height="${190 - i * 10}" rx="9"/>`).join('')}</g>` : '';
  const top = { Short: `<path d="M160 230 Q160 130 256 128 Q352 130 352 230 Q330 175 256 172 Q182 175 160 230Z" fill="${h}"/>`,
    Afro: `<path d="M158 240 Q160 140 256 136 Q352 140 354 240 Q330 185 256 182 Q182 185 158 240Z" fill="${h}"/>`, Long: `<path d="M158 250 Q150 125 256 122 Q362 125 354 250 Q330 170 256 168 Q182 170 158 250Z" fill="${h}"/>`,
    Braids: `<path d="M160 235 Q160 128 256 126 Q352 128 352 235 Q320 168 256 166 Q192 168 160 235Z" fill="${h}"/>`,
    Bun: `<circle cx="256" cy="110" r="42" fill="${h}"/><path d="M162 228 Q162 140 256 138 Q350 140 350 228 Q326 178 256 175 Q186 178 162 228Z" fill="${h}"/>`,
    Bald: '', Curly: `<g fill="${h}">${Array.from({ length: 11 }, (_, i) => `<circle cx="${170 + i * 17}" cy="${165 - Math.sin((i / 10) * Math.PI) * 38}" r="30"/>`).join('')}</g>` }[hs];
  const eyes = [`<circle cx="218" cy="255" r="11"/><circle cx="294" cy="255" r="11"/>`, `<path d="M204 257 Q218 244 232 257" stroke="#111" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M280 257 Q294 244 308 257" stroke="#111" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    `<ellipse cx="218" cy="255" rx="10" ry="14"/><ellipse cx="294" cy="255" rx="10" ry="14"/><circle cx="222" cy="250" r="4" fill="#fff"/><circle cx="298" cy="250" r="4" fill="#fff"/>`][a.eyes];
  const mouth = [`<path d="M220 312 Q256 345 292 312" stroke="#7A2E2E" stroke-width="8" fill="none" stroke-linecap="round"/>`, `<path d="M214 308 Q256 362 298 308 Z" fill="#7A2E2E"/><path d="M226 312 Q256 324 286 312" fill="#fff"/>`, `<path d="M232 320 L280 320" stroke="#7A2E2E" stroke-width="8" stroke-linecap="round"/>`][a.mouth];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><rect width="512" height="512" fill="${BG[a.bg]}"/>${back}
<path d="M120 512 Q120 400 256 390 Q392 400 392 512Z" fill="${a.bg === 6 ? '#F59E0B' : '#0F766E'}"/><rect x="226" y="340" width="60" height="64" rx="20" fill="${s}"/>
<ellipse cx="256" cy="255" rx="98" ry="112" fill="${s}"/><ellipse cx="160" cy="262" rx="16" ry="24" fill="${s}"/><ellipse cx="352" cy="262" rx="16" ry="24" fill="${s}"/>
${a.earrings ? '<circle cx="160" cy="292" r="8" fill="#F59E0B"/><circle cx="352" cy="292" r="8" fill="#F59E0B"/>' : ''}
${a.beard ? `<path d="M164 270 Q170 372 256 380 Q342 372 348 270 Q330 330 256 334 Q182 330 164 270Z" fill="${h}"/>` : ''}
${top}<g fill="#111">${eyes}</g><path d="M200 228 Q218 220 236 228M276 228 Q294 220 312 228" stroke="${a.hair === 5 ? '#333' : h}" stroke-width="7" fill="none" stroke-linecap="round"/>
<path d="M256 268 Q248 292 258 296" stroke="rgba(0,0,0,.25)" stroke-width="5" fill="none" stroke-linecap="round"/>${mouth}
${a.glasses ? '<g fill="none" stroke="#111" stroke-width="7"><circle cx="218" cy="256" r="28"/><circle cx="294" cy="256" r="28"/><path d="M246 256h20"/></g>' : ''}</svg>`;
}
function AvatarMaker({ onBack, onDone }: { onBack: () => void; onDone: (b: Blob) => void }) {
  const [a, setA] = useState<Av>({ skin: 4, hair: 1, hairc: 0, bg: 0, eyes: 0, mouth: 1, glasses: false, beard: false, earrings: false });
  const opt = (k: keyof Av, n: number, label: (i: number) => React.ReactNode) => <div className="chiprow">{Array.from({ length: n }, (_, i) => <button key={i} className={`chip ${a[k] === i ? 'on' : ''}`} onClick={() => setA({ ...a, [k]: i })}>{label(i)}</button>)}</div>;
  const sw = (k: keyof Av, list: string[]) => <div className="chiprow">{list.map((c, i) => <button key={c} className={`swatch ${a[k] === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Option ${i + 1}`} onClick={() => setA({ ...a, [k]: i })} />)}</div>;
  const save = () => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d')!.drawImage(i, 0, 0, 1024, 1024); c.toBlob((b) => b && onDone(b), 'image/png'); }; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(a, 1024)); };
  return <div className="editor avatarmaker">
    <div className="row between studiohead"><button className="btn icon reelbtn" aria-label="Back" onClick={onBack}><Icon name="back" /></button><b>Your avatar</b><button className="btn primary" onClick={save}>Next</button></div>
    <div className="avprev" dangerouslySetInnerHTML={{ __html: avatarSvg(a, 240) }} />
    <div className="edpanel stack">
      <b>Skin tone</b>{sw('skin', SKIN)}<b>Hair</b>{opt('hair', HAIR.length, (i) => HAIR[i])}{sw('hairc', HAIRC)}
      <b>Eyes</b>{opt('eyes', 3, (i) => ['Round', 'Smiling', 'Bright'][i])}<b>Mouth</b>{opt('mouth', 3, (i) => ['Smile', 'Laugh', 'Calm'][i])}
      <div className="chiprow">{(['glasses', 'beard', 'earrings'] as const).map((k) => <button key={k} className={`chip ${a[k] ? 'on' : ''}`} onClick={() => setA({ ...a, [k]: !a[k] })}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      <b>Background</b>{sw('bg', BG)}
    </div>
  </div>;
}
