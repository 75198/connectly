import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, authorHref, credit, Page, Post, Track, useFeatures } from '../api';
import { RichText } from '../components/Extras';
import { markSeen, unseenFirst } from '../components/Backfill';
import { canOfferSave, saveToGallery } from '../lib/save';
import { MusicPicker } from '../components/MusicPicker';
import { askPermission } from '../lib/permission';
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
  const box = useRef<HTMLDivElement>(null); const ffr = useFeatures(); const [clips, setClips] = useState<Clip[]>([]);
  useEffect(() => { if (ffr?.backfill) api<{ clips: Clip[] }>('/backfill').then((r) => setClips(unseenFirst(r.clips))).catch(() => {}); }, [ffr?.backfill]);
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
  // Reopened after 10+ minutes away: start over with fresh reels (never reorders while you're watching).
  useEffect(() => { let hiddenAt = 0; const v = () => { if (document.hidden) { hiddenAt = Date.now(); return; } if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3 && !id) { setItems([]); setCursor(null); setDone(false); setActive(0); box.current?.scrollTo({ top: 0 }); load(null); if (ffr?.backfill) api<{ clips: Clip[] }>('/backfill').then((r) => setClips(unseenFirst(r.clips))).catch(() => {}); } hiddenAt = 0; };
    document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, [id, load, ffr?.backfill]);
  useEffect(() => { if (active >= items.length - 2 && !done && !loading && cursor) load(cursor); }, [active, items.length, done, loading, cursor, load]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)); }), { root: el, threshold: 0.6 });
    el.querySelectorAll('.reel').forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [items.length, clips.length, done]);
  const update = (p: Post) => setItems((x) => x.map((y) => (y.id === p.id ? p : y)));
  return <div className="reels" ref={box}>
    <header className="reelsbar"><button className="btn icon reelbtn" aria-label="Back" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
      <b>Reels</b><Link className="btn icon reelbtn" to="/reels/new" aria-label="Create a reel"><Icon name="plus" /></Link></header>
    {items.map((p, i) => <ReelItem key={p.id} i={i} post={p} active={i === active} near={Math.abs(i - active) <= 1} muted={muted}
      onMute={() => setMuted((m) => !m)} onChange={update} onComments={() => setComments(p)} />)}
    {done && clips.map((c, j) => <ClipReel key={c.id} c={c} i={items.length + j} active={items.length + j === active} muted={muted} onMute={() => setMuted((m) => !m)} />)}
    {loading && <div className="reel reelempty"><Spinner /></div>}
    {!loading && !items.length && !clips.length && <div className="reel reelempty"><p>{err || 'No reels yet.'}</p><Link className="btn primary" to="/reels/new">Post the first reel</Link></div>}
    {comments && <Sheet title="Comments" onClose={() => setComments(null)}><Comments post={comments} onCount={(n) => update({ ...comments, comment_count: n })} /></Sheet>}
  </div>;
}

function ReelItem({ i, post, active, near, muted, onMute, onChange, onComments }: { i: number; post: Post; active: boolean; near: boolean; muted: boolean; onMute: () => void; onChange: (p: Post) => void; onComments: () => void }) {
  const ff = useFeatures(); const nav = useNavigate();
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
      {ff?.remix && <button onClick={() => nav(`/reels/new?remix=${post.id}`)} aria-label="Duet"><span className="railemoji">🎭</span><small>Duet</small></button>}
      {ff?.downloads && canOfferSave(post) && <button onClick={() => saveToGallery(post.id)} aria-label="Save to gallery"><span className="railemoji">⬇️</span><small>Save</small></button>}
      {!post.is_mine && <button onClick={report} aria-label="Report"><Icon name="flag" /><small>Report</small></button>}
      <span className="reelviews" aria-label={`${post.view_count || 0} views`}><Icon name="eye" /><small>{fmt(post.view_count)}</small></span>
    </div>
    <div className="reelinfo">
      <Link to={authorHref(post.author)} className="row reelauthor"><Avatar user={post.author} size={34} /><b>{post.author.full_name}</b></Link>
      {post.body && <p><RichText text={post.body} /></p>}
      {post.remix_of && <Link to={`/reels/${post.remix_of.id}`} className="reelmusic">🎭 Duet with @{post.remix_of.username}</Link>}
      {post.music && <Link to={`/sound/${post.music.id}`} className="reelmusic">♫ {credit(post.music)}</Link>}
    </div>
    {note && <div className="reelnote" role="status">{note}</div>}
  </section>;
}

const MAX_MB = 50, MAX_S = 60;
export function NewReel() {
  const nav = useNavigate(); const ff = useFeatures(); const [sp] = useSearchParams(); const remixId = Number(sp.get('remix')) || 0; const [orig, setOrig] = useState<Post | null>(null); const [track, setTrack] = useState<Track | null>(null); const [musicOpen, setMusicOpen] = useState(false); const [duet, setDuet] = useState(false);
  useEffect(() => { if (remixId) api<Post>(`/posts/${remixId}`).then(setOrig).catch(() => {}); const m = Number(sp.get('music')); if (m) api<Track>(`/music/${m}`).then(setTrack).catch(() => {}); }, [remixId, sp]);
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
    const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis); fd.append('video', file); if (cover) fd.append('cover', cover); if (orig) { fd.append('remix_of_id', String(orig.id)); fd.append('remix_layout', 'duet'); } if (track) fd.append('music_track_id', String(track.id));
    // XHR (not fetch) so we can show upload progress on slow connections
    const x = new XMLHttpRequest(); x.open('POST', '/api/reels'); x.setRequestHeader('X-Connectly-CSRF', '1');
    x.upload.onprogress = (ev) => ev.lengthComputable && setPct(Math.round((ev.loaded / ev.total) * 100));
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch { /* */ }
      if (x.status === 201) nav(`/reels/${d.id}`, { replace: true }); else { setErr(d.error || `Upload failed (${x.status})`); setBusy(false); } };
    x.onerror = () => { setErr('Network error. Check your connection and try again.'); setBusy(false); };
    x.send(fd);
  }
  return <div className="stack"><h1 className="pagetitle">{orig ? `Duet with @${orig.author.username}` : 'New reel'}</h1>
    <form className="card stack" onSubmit={submit}>
      {orig && !preview && <button type="button" className="btn primary block" onClick={() => setDuet(true)}>🎭 Record your side</button>}
      {orig && preview && <div className="duet"><video src={orig.video_path || ''} muted playsInline autoPlay loop /><video src={preview} muted playsInline autoPlay loop /><span className="duettag">Duet preview</span></div>}
      {duet && orig && <DuetRecorder original={orig} onClose={() => setDuet(false)} onDone={(f) => { setDuet(false); pick(f); }} />}
      {musicOpen && <MusicPicker onClose={() => setMusicOpen(false)} onPick={(t) => { setTrack(t); setMusicOpen(false); }} />}
      {preview ? <video ref={pv} className="reelpreview" src={preview} controls playsInline muted onLoadedMetadata={(e) => setSecs(e.currentTarget.duration)} />
        : <label className="reelpick"><Icon name="reel" /><b>Choose a video</b><span className="meta">Vertical videos look best</span>
          <input type="file" accept="video/mp4,video/quicktime,video/webm,video/3gpp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>}
      {!preview && <button type="button" className="btn ghost block" onClick={() => setStudio('camera')}>🎥 Record with camera</button>}
      {preview && <div className="row wrap"><button type="button" className="btn ghost" onClick={grabFrame}>🖼️ {cover ? 'Change cover' : 'Set cover from this frame'}</button>{cover && <img className="coverthumb" src={URL.createObjectURL(cover)} alt="Cover" />}</div>}
      {preview && <button type="button" className="linkish" onClick={() => { setFile(null); setPreview(''); setSecs(0); setCover(null); }}>Choose a different video</button>}
      {studio && <MediaStudio allowVideo={studio === 'camera'} startWith={studio === 'camera' ? 'camera' : 'menu'} initial={studio === 'cover' ? frame : null} onClose={() => setStudio(null)}
        onDone={(r) => { setStudio(null); if (r.file.type.startsWith('video/')) pick(r.file); else setCover(r.file); }} />}
      {secs > MAX_S + 0.5 && <p className="error">This video is {Math.round(secs)} seconds. Reels can be up to {MAX_S} seconds.</p>}
      {ff?.music && <button type="button" className="btn ghost block" onClick={() => setMusicOpen(true)}>♫ {track ? credit(track) : 'Add music'}</button>}
      <label>Caption<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2200} rows={3} /></label>
      <label>Who can see this<select value={vis} onChange={(e) => setVis(e.target.value as any)}>{(['public', 'friends', 'private'] as const).map((k) => <option key={k} value={k}>{VIS_LABEL[k]}</option>)}</select></label>
      {busy && <><div className="progress"><div style={{ width: `${pct}%` }} /></div><p className="meta center">{pct < 100 ? `Uploading… ${pct}%` : 'Processing your video…'}</p></>}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary block" disabled={!file || busy || secs > MAX_S + 0.5}>{busy ? 'Please wait…' : 'Share reel'}</button>
    </form></div>;
}

// Duet recorder: the original reel plays on the left while your camera records on the right (only your side is uploaded).
function DuetRecorder({ original, onDone, onClose }: { original: Post; onDone: (f: File) => void; onClose: () => void }) {
  const cam = useRef<HTMLVideoElement>(null); const org = useRef<HTMLVideoElement>(null); const [stream, setStream] = useState<MediaStream | null>(null); const [rec, setRec] = useState<MediaRecorder | null>(null); const [err, setErr] = useState('');
  useEffect(() => { let s: MediaStream | null = null; (async () => { if (!(await askPermission('camera+microphone'))) { onClose(); return; } try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 1280 }, audio: true }); setStream(s); if (cam.current) cam.current.srcObject = s; } catch { setErr('Couldn’t open the camera'); } })(); return () => s?.getTracks().forEach((t) => t.stop()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = () => { if (!stream) return; const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || ''; const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const chunks: Blob[] = [];
    r.ondataavailable = (e) => chunks.push(e.data); r.onstop = () => { const t = r.mimeType.split(';')[0] || 'video/webm'; onDone(new File([new Blob(chunks, { type: t })], `duet.${t.includes('mp4') ? 'mp4' : 'webm'}`, { type: t })); };
    org.current!.currentTime = 0; org.current!.muted = false; org.current!.play().catch(() => {}); r.start(250); setRec(r); org.current!.onended = () => r.state === 'recording' && r.stop(); };
  return <div className="studio duetrec"><div className="duet big"><video ref={org} src={original.video_path || ''} playsInline /><video ref={cam} muted playsInline autoPlay className="mirror" /></div>
    {err && <p className="error">{err}</p>}
    <div className="row center duetbar"><button className="btn ghost" onClick={onClose}>Cancel</button>{rec ? <button className="recbtn on" aria-label="Stop" onClick={() => rec.stop()} /> : <button className="recbtn" aria-label="Record" disabled={!stream} onClick={start} />}</div></div>;
}

type Clip = { id: string; title: string; credit: string; license: string; license_url: string; source_url: string; video: string; poster: string; adapted: string };
// Backfill clip from an openly licensed film, labelled with its source and licence.
function ClipReel({ c, i, active, muted, onMute }: { c: Clip; i: number; active: boolean; muted: boolean; onMute: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { const el = v.current; if (!el) return; if (active) { markSeen(c.id); el.play().catch(() => {}); } else el.pause(); }, [active, c.id]);
  return <section className="reel" data-i={i}>
    <video ref={v} className="reelvideo" src={c.video} poster={c.poster} muted={muted} loop playsInline preload={active ? 'auto' : 'none'} onClick={onMute} />
    <button className="reelmute btn icon reelbtn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute}><Icon name={muted ? 'mute' : 'volume'} /></button>
    <div className="reelinfo"><span className="srclabel">🎬 Open film · {c.license}</span><b>{c.title}</b>
      <p className="clipcredit">{c.credit}. {c.adapted}. <a href={c.license_url} target="_blank" rel="noopener noreferrer">{c.license}</a> · <a href={c.source_url} target="_blank" rel="noopener noreferrer">Source</a></p></div>
  </section>;
}
