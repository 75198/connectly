import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authorHref, Page, Post } from '../api';
import { Avatar, Icon, Sheet, Spinner, VIS_LABEL } from '../components/ui';
import { Comments } from '../components/PostCard';
import { MediaStudio } from '../components/MediaStudio';
import { EngagementSheet, trackShare, type EngTab } from '../components/Engagement';

const fmt = (n = 0) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const saveData = () => !!(navigator as any).connection?.saveData;
// Slow network or Data Saver -> 480p rendition; otherwise the high-quality original.
const slowNet = () => { const c = (navigator as any).connection; return !!c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || '')); };

// Full-screen vertical feed. Only the visible reel plays; its neighbours load metadata only, the rest load nothing.
export function Reels() {
  const { id } = useParams(); const nav = useNavigate();
  const [items, setItems] = useState<Post[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [active, setActive] = useState(0); const [muted, setMuted] = useState(true);
  const [comments, setComments] = useState<Post | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async (c: string | null) => {
    setLoading(true);
    try { const r = await api<Page<Post>>(`/reels?limit=5${c ? `&cursor=${c}` : ''}`); setItems((x) => [...x, ...r.items.filter((i) => !x.some((y) => y.id === i.id))]); setCursor(r.next_cursor); setDone(!r.next_cursor); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    (async () => {
      if (id) { try { const first = await api<Post>(`/reels/${id}`); setItems([first]); } catch (e: any) { setErr(e.message); } }
      await load(null);
    })();
  }, [id, load]);
  useEffect(() => { if (active >= items.length - 2 && !done && !loading && cursor) load(cursor); }, [active, items.length, done, loading, cursor, load]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)); }), { root: el, threshold: 0.6 });
    el.querySelectorAll('.reel').forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [items.length]);
  const update = (p: Post) => setItems((x) => x.map((y) => (y.id === p.id ? p : y)));
  return <div className="reels" ref={box}>
    <header className="reelsbar"><button className="btn icon reelbtn" aria-label="Back" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
      <b>Reels</b><Link className="btn icon reelbtn" to="/reels/new" aria-label="Create a reel"><Icon name="plus" /></Link></header>
    {items.map((p, i) => <ReelItem key={p.id} i={i} post={p} active={i === active} near={Math.abs(i - active) <= 1} muted={muted}
      onMute={() => setMuted((m) => !m)} onChange={update} onComments={() => setComments(p)} />)}
    {loading && <div className="reel reelempty"><Spinner /></div>}
    {!loading && !items.length && <div className="reel reelempty"><p>{err || 'No reels yet.'}</p><Link className="btn primary" to="/reels/new">Post the first reel</Link></div>}
    {comments && <Sheet title="Comments" onClose={() => setComments(null)}><Comments post={comments} onCount={(n) => update({ ...comments, comment_count: n })} /></Sheet>}
  </div>;
}

function ReelItem({ i, post, active, near, muted, onMute, onChange, onComments }: { i: number; post: Post; active: boolean; near: boolean; muted: boolean; onMute: () => void; onChange: (p: Post) => void; onComments: () => void }) {
  const v = useRef<HTMLVideoElement>(null); const viewed = useRef(false);
  const [paused, setPaused] = useState(false); const [note, setNote] = useState('');
  useEffect(() => {
    const el = v.current; if (!el) return;
    if (active && !paused) el.play().catch(() => setPaused(true)); else el.pause();
  }, [active, paused]);
  useEffect(() => { if (!active) setPaused(false); }, [active]);
  const onTime = () => {
    const el = v.current!;
    if (!viewed.current && el.currentTime >= Math.min(2, (el.duration || 2) * 0.5)) {
      viewed.current = true;
      api<{ view_count: number }>(`/reels/${post.id}/view`, { method: 'POST' }).then((r) => onChange({ ...post, view_count: r.view_count })).catch(() => {});
    }
  };
  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(''), 1800); };
  async function like() {
    const was = post.liked_by_me;
    onChange({ ...post, liked_by_me: !was, like_count: post.like_count + (was ? -1 : 1) });
    try { const r = await api<{ liked_by_me: boolean; like_count: number }>(`/posts/${post.id}/like`, { method: was ? 'DELETE' : 'PUT' }); onChange({ ...post, ...r }); } catch (e: any) { onChange(post); flash(e.message); }
  }
  const [eng, setEng] = useState<EngTab | null>(null);
  async function share() {
    const url = `${location.origin}/reels/${post.id}`;
    try { if (navigator.share) { await navigator.share({ title: 'Connectly reel', text: post.body.slice(0, 100), url }); trackShare(post.id, 'native'); } else { await navigator.clipboard.writeText(url); flash('Link copied'); trackShare(post.id, 'copy_link'); } onChange({ ...post, share_count: (post.share_count || 0) + 1 }); } catch { /* cancelled */ }
  }
  async function report() {
    const reason = prompt('Why are you reporting this reel? (spam, harassment, hate speech, scam…)');
    if (!reason?.trim()) return;
    try { await api('/reports', { json: { target_type: 'post', post_id: post.id, reason: reason.trim() } }); flash('Thanks. Our moderators will review it.'); } catch (e: any) { flash(e.message); }
  }
  return <section className="reel" data-i={i} aria-label={`Reel by ${post.author.full_name}`}>
    <video ref={v} className="reelvideo" src={near ? ((slowNet() && post.video_low_path) || post.video_path!) : undefined} poster={post.poster_path || undefined} playsInline loop muted={muted}
      preload={active ? 'auto' : near && !saveData() ? 'metadata' : 'none'} onTimeUpdate={onTime} onClick={() => (muted ? onMute() : setPaused((p) => !p))} />
    {paused && active && <button className="reelplay" aria-label="Play" onClick={() => setPaused(false)}><Icon name="play" /></button>}
    <button className="reelmute btn icon reelbtn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute}><Icon name={muted ? 'mute' : 'volume'} /></button>
    {muted && active && <span className="reelhint">Tap to unmute</span>}
    {eng && <EngagementSheet post={post} tab={eng} onClose={() => setEng(null)} />}
    <div className="reelrail">
      <button onClick={like} aria-pressed={post.liked_by_me} aria-label="Like" className={post.liked_by_me ? 'on' : ''}><Icon name={post.liked_by_me ? 'heartFill' : 'heart'} /></button><small className="countbtn" role="button" aria-label="See who liked" onClick={() => setEng('reactions')}>{fmt(post.like_count)}</small>
      <button onClick={onComments} aria-label="Comments"><Icon name="chat" /></button><small className="countbtn" role="button" aria-label="See who commented" onClick={() => setEng('comments')}>{fmt(post.comment_count)}</small>
      <button onClick={share} aria-label="Share"><Icon name="share" /></button><small className="countbtn" role="button" aria-label="See who shared" onClick={() => setEng('shares')}>{post.share_count ? fmt(post.share_count) : 'Share'}</small>
      {!post.is_mine && <button onClick={report} aria-label="Report"><Icon name="flag" /><small>Report</small></button>}
      <span className="reelviews" aria-label={`${post.view_count || 0} views`}><Icon name="eye" /><small>{fmt(post.view_count)}</small></span>
    </div>
    <div className="reelinfo">
      <Link to={authorHref(post.author)} className="row reelauthor"><Avatar user={post.author} size={34} /><b>{post.author.full_name}</b></Link>
      {post.body && <p>{post.body}</p>}
    </div>
    {note && <div className="reelnote" role="status">{note}</div>}
  </section>;
}

const MAX_MB = 50, MAX_S = 60;
export function NewReel() {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState(''); const [secs, setSecs] = useState(0);
  const [body, setBody] = useState(''); const [vis, setVis] = useState<'public' | 'friends' | 'private'>('public');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pct, setPct] = useState(0);
  const [studio, setStudio] = useState<null | 'camera' | 'cover'>(null); const [cover, setCover] = useState<File | null>(null); const [frame, setFrame] = useState<Blob | null>(null); const pv = useRef<HTMLVideoElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const grabFrame = () => { const v = pv.current; if (!v || !v.videoWidth) return; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0); c.toBlob((b) => { if (b) { setFrame(b); setStudio('cover'); } }, 'image/jpeg', 0.95); };
  function pick(f?: File) {
    setErr(''); if (!f) return;
    if (!/^video\/(mp4|quicktime|webm|3gpp|x-m4v)$/.test(f.type)) return setErr('Choose an MP4, MOV, WebM or 3GP video');
    if (f.size > MAX_MB * 1024 * 1024) return setErr(`Video must be ${MAX_MB} MB or smaller`);
    setFile(f); setPreview(URL.createObjectURL(f));
  }
  function submit(e: FormEvent) {
    e.preventDefault(); if (!file) return;
    if (secs > MAX_S + 0.5) return setErr(`Reels can be up to ${MAX_S} seconds long`);
    setBusy(true); setErr(''); setPct(0);
    const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis); fd.append('video', file); if (cover) fd.append('cover', cover);
    // XHR (not fetch) so we can show upload progress on slow connections
    const x = new XMLHttpRequest(); x.open('POST', '/api/reels'); x.setRequestHeader('X-Connectly-CSRF', '1');
    x.upload.onprogress = (ev) => ev.lengthComputable && setPct(Math.round((ev.loaded / ev.total) * 100));
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch { /* */ }
      if (x.status === 201) nav(`/reels/${d.id}`, { replace: true }); else { setErr(d.error || `Upload failed (${x.status})`); setBusy(false); } };
    x.onerror = () => { setErr('Network error. Check your connection and try again.'); setBusy(false); };
    x.send(fd);
  }
  return <div className="stack"><h1 className="pagetitle">New reel</h1>
    <form className="card stack" onSubmit={submit}>
      {preview ? <video ref={pv} className="reelpreview" src={preview} controls playsInline muted onLoadedMetadata={(e) => setSecs(e.currentTarget.duration)} />
        : <label className="reelpick"><Icon name="reel" /><b>Choose a video</b><span className="meta">Vertical works best · up to {MAX_S} seconds · {MAX_MB} MB</span>
          <input type="file" accept="video/mp4,video/quicktime,video/webm,video/3gpp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>}
      {!preview && <button type="button" className="btn ghost block" onClick={() => setStudio('camera')}>🎥 Record with camera</button>}
      {preview && <div className="row wrap"><button type="button" className="btn ghost" onClick={grabFrame}>🖼️ {cover ? 'Change cover' : 'Set cover from this frame'}</button>{cover && <img className="coverthumb" src={URL.createObjectURL(cover)} alt="Cover" />}</div>}
      {preview && <button type="button" className="linkish" onClick={() => { setFile(null); setPreview(''); setSecs(0); setCover(null); }}>Choose a different video</button>}
      {studio && <MediaStudio allowVideo={studio === 'camera'} startWith={studio === 'camera' ? 'camera' : 'menu'} initial={studio === 'cover' ? frame : null} onClose={() => setStudio(null)}
        onDone={(r) => { setStudio(null); if (r.file.type.startsWith('video/')) pick(r.file); else setCover(r.file); }} />}
      {secs > MAX_S + 0.5 && <p className="error">This video is {Math.round(secs)} seconds. Reels can be up to {MAX_S} seconds.</p>}
      <label>Caption<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2200} rows={3} /></label>
      <label>Who can see this<select value={vis} onChange={(e) => setVis(e.target.value as any)}>{(['public', 'friends', 'private'] as const).map((k) => <option key={k} value={k}>{VIS_LABEL[k]}</option>)}</select></label>
      {busy && <><div className="progress"><div style={{ width: `${pct}%` }} /></div><p className="meta center">{pct < 100 ? `Uploading… ${pct}%` : 'Processing your video…'}</p></>}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary block" disabled={!file || busy || secs > MAX_S + 0.5}>{busy ? 'Please wait…' : 'Share reel'}</button>
    </form></div>;
}
