// Go Live (round 6). Video: LiveKit (simulcast + adaptive stream so slow phones get a lower layer).
// Comments/reactions/viewer count come from our API (polled), so moderation and blocks apply server-side.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track, createLocalTracks, VideoPresets, type LocalVideoTrack, type LocalAudioTrack, type RemoteTrack } from 'livekit-client';
import { api, getFeatures, toast } from '../api';
import { useSession } from '../session';
import { askPermission, showPermissionDenied } from '../lib/permission';
import { Avatar, Icon } from '../components/ui';

import type { LiveStream } from '../components/LiveRow';
export type { LiveStream };
type Cmt = { id: number; body: string; author: { username: string; full_name: string; avatar_path: string | null } };
const REACTS = ['❤️', '👍', '😂', '😮', '👏', '🔥'];

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Shared live overlay: comments, reactions, viewer count, polling + heartbeat.
function useLiveEvents(id: number | null, onEnded: () => void) {
  const [comments, setComments] = useState<Cmt[]>([]); const [viewers, setViewers] = useState(0); const [floaters, setFloaters] = useState<{ k: number; e: string }[]>([]);
  const last = useRef({ c: 0, r: 0 }); const ended = useRef(onEnded); ended.current = onEnded;
  useEffect(() => {
    if (!id) return; let live = true; last.current = { c: 0, r: 0 }; let first = true;
    const poll = async () => {
      try {
        const ev = await api<{ status: string; viewer_count: number; comments: Cmt[]; reactions: { id: number; reaction: string }[] }>(`/live/${id}/events?after_comment=${last.current.c}&after_reaction=${last.current.r}`);
        if (!live) return; setViewers(ev.viewer_count);
        if (ev.comments.length) { last.current.c = ev.comments[ev.comments.length - 1].id; setComments((c) => [...c, ...ev.comments].slice(-40)); }
        if (ev.reactions.length) { last.current.r = ev.reactions[ev.reactions.length - 1].id; if (!first) setFloaters((f) => [...f, ...ev.reactions.slice(-8).map((r) => ({ k: r.id, e: r.reaction }))].slice(-16)); }
        first = false;
        if (ev.status === 'ended') ended.current();
      } catch { /* keep trying */ }
    };
    poll(); const p = setInterval(poll, 2000);
    const hb = setInterval(() => api(`/live/${id}/heartbeat`, { method: 'POST' }).then((r: any) => r.status === 'ended' && ended.current()).catch(() => {}), 15000);
    return () => { live = false; clearInterval(p); clearInterval(hb); };
  }, [id]);
  return { comments, viewers, floaters, setComments, addFloater: (e: string) => setFloaters((f) => [...f, { k: Date.now(), e }].slice(-16)) };
}

function Overlay({ id, comments, viewers, floaters, onReact, onComment, mine }: { id: number; comments: Cmt[]; viewers: number; floaters: { k: number; e: string }[]; onReact: (e: string) => void; onComment: (c: Cmt) => void; mine: boolean }) {
  const [text, setText] = useState(''); const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo(0, 1e9); }, [comments]);
  const send = async () => { const body = text.trim(); if (!body) return; setText(''); try { onComment(await api<Cmt>(`/live/${id}/comments`, { json: { body } })); } catch (e: any) { toast(e.message, 'err'); } };
  return <>
    <div className="livefloat" aria-hidden>{floaters.map((f) => <span key={f.k} style={{ left: `${(f.k * 37) % 50}%` }}>{f.e}</span>)}</div>
    <div className="livebottom">
      <div className="livecomments" ref={listRef}>{comments.map((c) => <div key={c.id} className="livecmt"><Avatar user={c.author} size={26} /><span><b>{c.author.full_name}</b> {c.body}</span></div>)}</div>
      <form className="livecompose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={mine ? 'Reply to your viewers…' : 'Add a comment…'} aria-label="Comment" />
        {!mine && REACTS.slice(0, 3).map((r) => <button type="button" key={r} className="livereact" aria-label={`React ${r}`} onClick={() => onReact(r)}>{r}</button>)}
      </form>
      {!mine && <div className="livereacts">{REACTS.slice(3).map((r) => <button type="button" key={r} className="livereact" onClick={() => onReact(r)}>{r}</button>)}</div>}
    </div>
    <span className="liveviewers">👁 {viewers}</span>
  </>;
}

export function GoLive() {
  const nav = useNavigate(); const { me } = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tracks, setTracks] = useState<{ v?: LocalVideoTrack; a?: LocalAudioTrack }>({});
  const [facing, setFacing] = useState<'user' | 'environment'>('user'); const [muted, setMuted] = useState(false); const [camOff, setCamOff] = useState(false);
  const [title, setTitle] = useState(''); const [stream, setStream] = useState<LiveStream | null>(null); const [room, setRoom] = useState<Room | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<{ configured: boolean; max_minutes: number; max_viewers: number; month_remaining: number } | null>(null);
  const ended = () => { toast('Your live video has ended'); stop(); nav('/'); };
  const ev = useLiveEvents(stream?.id ?? null, ended);
  useEffect(() => { api('/live/status').then(setStatus).catch(() => {}); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { let cancelled = false; let made: any[] = [];
    askPermission('camera+microphone').then((ok) => { if (!ok) throw Object.assign(new Error('declined'), { name: 'Declined' }); return createLocalTracks({ audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: 'user', resolution: VideoPresets.h720.resolution } }); })
      .then((ts) => { made = ts; if (cancelled) return ts.forEach((t) => t.stop()); const v = ts.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack; const a = ts.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack; setTracks({ v, a }); })
      .catch((e) => { if (e?.name === 'NotAllowedError') showPermissionDenied('camera+microphone'); setErr('Allow camera and microphone access to go live.'); });
    return () => { cancelled = true; made.forEach((t) => t.stop()); };
  }, []);
  useEffect(() => { if (tracks.v && videoRef.current) tracks.v.attach(videoRef.current); }, [tracks.v]);
  function stop() { room?.disconnect(); tracks.v?.stop(); tracks.a?.stop(); }
  const flip = async () => { const f = facing === 'user' ? 'environment' : 'user'; try { await tracks.v?.restartTrack({ facingMode: f }); setFacing(f); } catch { toast('Could not switch camera', 'err'); } };
  const toggleMute = async () => { if (!tracks.a) return; muted ? await tracks.a.unmute() : await tracks.a.mute(); setMuted(!muted); };
  const toggleCam = async () => { if (!tracks.v) return; camOff ? await tracks.v.unmute() : await tracks.v.mute(); setCamOff(!camOff); };
  async function start() {
    if (!tracks.v) return; setBusy(true); setErr('');
    try {
      const r = await api<{ stream: LiveStream; url: string; token: string }>('/live', { json: { title } });
      const rm = new Room({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360], videoEncoding: VideoPresets.h720.encoding } });
      await rm.connect(r.url, r.token);
      await rm.localParticipant.publishTrack(tracks.v, { simulcast: true, source: Track.Source.Camera });
      if (tracks.a) await rm.localParticipant.publishTrack(tracks.a, { source: Track.Source.Microphone });
      rm.on(RoomEvent.Disconnected, () => {});
      setRoom(rm); setStream(r.stream); toast('You’re live!');
    } catch (e: any) { setErr(e.message || 'Could not start the live video'); } finally { setBusy(false); }
  }
  async function end() { if (!confirm('End your live video?')) return; if (stream) await api(`/live/${stream.id}/end`, { method: 'POST' }).catch(() => {}); stop(); toast('Live video ended'); nav('/'); }
  const left = stream ? new Date(stream.ends_by).getTime() - now : 0;
  return <div className="livescreen">
    <video ref={videoRef} className={`livevideo${facing === 'user' ? ' mirror' : ''}`} autoPlay playsInline muted />
    <header className="livetop">
      <button className="btn icon liveglass" aria-label="Close" onClick={() => (stream ? end() : (stop(), nav(-1)))}><Icon name="x" /></button>
      {stream ? <><span className="livebadge">LIVE</span><span className="liveglass pill">{clock(now - new Date(stream.started_at).getTime())}</span>{left < 5 * 60000 && <span className="liveglass pill warn">{clock(left)} left</span>}</> : <b className="liveglass pill">Go Live</b>}
      <span className="grow" />
      <button className="btn icon liveglass" aria-label="Switch camera" onClick={flip}>🔄</button>
      <button className="btn icon liveglass" aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMute}><Icon name={muted ? 'mute' : 'volume'} /></button>
      <button className="btn icon liveglass" aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} onClick={toggleCam}>{camOff ? '📷' : '🎥'}</button>
    </header>
    {!stream ? <div className="livesetup">
      {me && <div className="row"><Avatar user={me} size={40} /><b>{me.full_name}</b></div>}
      <input className="livetitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Add a title (optional)" aria-label="Live title" />
      <p className="liveinfo">Your friends and followers will be notified. Up to {status?.max_minutes ?? 60} min and {status?.max_viewers ?? 20} viewers per live.</p>
      {status && !status.configured && <p className="liveerr">Live video isn’t set up yet. Please try again later.</p>}
      {err && <p className="liveerr">{err}</p>}
      <button className="btn livego" disabled={busy || !tracks.v || status?.configured === false} onClick={start}>{busy ? 'Starting…' : 'Go Live'}</button>
    </div> : <>
      <Overlay id={stream.id} mine comments={ev.comments} viewers={ev.viewers} floaters={ev.floaters} onReact={() => {}} onComment={(c) => ev.setComments((x) => (x.some((y) => y.id === c.id) ? x : [...x, c]))} />
      <button className="btn liveend" onClick={end}>End</button>
    </>}
  </div>;
}

export function WatchLive() {
  const { id: sid } = useParams(); const id = Number(sid); const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null); const audioRef = useRef<HTMLAudioElement>(null);
  const [stream, setStream] = useState<LiveStream | null>(null); const [err, setErr] = useState(''); const [over, setOver] = useState(false);
  const [needTap, setNeedTap] = useState(false); const [hasVideo, setHasVideo] = useState(false); const [reportOpen, setReportOpen] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const ev = useLiveEvents(stream && !over ? id : null, () => { setOver(true); roomRef.current?.disconnect(); });
  useEffect(() => {
    let rm: Room | null = null; let gone = false;
    (async () => {
      try {
        const r = await api<{ stream: LiveStream; url: string; token: string }>(`/live/${id}/join`, { method: 'POST' });
        if (gone) return; setStream(r.stream);
        rm = new Room({ adaptiveStream: true, dynacast: true }); roomRef.current = rm;
        rm.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
          if (t.kind === Track.Kind.Video && videoRef.current) { t.attach(videoRef.current); setHasVideo(true); }
          if (t.kind === Track.Kind.Audio && audioRef.current) { t.attach(audioRef.current); audioRef.current.play().catch(() => setNeedTap(true)); }
        });
        rm.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedTap(!rm!.canPlaybackAudio));
        await rm.connect(r.url, r.token);
      } catch (e: any) {
        if (gone) return; setErr(e.message || 'Could not open this live video');
        api<LiveStream>(`/live/${id}`).then((s) => { setStream(s); if (s.status === 'ended') setOver(true); }).catch(() => {});
      }
    })();
    return () => { gone = true; rm?.disconnect(); api(`/live/${id}/leave`, { method: 'POST' }).catch(() => {}); };
  }, [id]);
  const react = (e: string) => { ev.addFloater(e); api(`/live/${id}/reactions`, { json: { reaction: e } }).catch((x) => toast(x.message, 'err')); };
  const report = async () => { const reason = prompt('What’s wrong with this live video?'); if (!reason) return; try { const r = await api<{ message: string }>(`/live/${id}/report`, { json: { reason } }); toast(r.message); } catch (e: any) { toast(e.message, 'err'); } setReportOpen(false); };
  return <div className="livescreen">
    <video ref={videoRef} className="livevideo" autoPlay playsInline muted={false} />
    <audio ref={audioRef} autoPlay />
    {!hasVideo && !over && !err && <div className="livewait">{stream ? <><Avatar user={stream.host} size={84} /><p>Connecting to {stream.host.full_name}…</p></> : <p>Loading…</p>}</div>}
    <header className="livetop">
      <button className="btn icon liveglass" aria-label="Close" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
      {stream && <Link to={`/u/${stream.host.username}`} className="livehost liveglass"><Avatar user={stream.host} size={30} /><span><b>{stream.host.full_name}</b>{stream.title && <small>{stream.title}</small>}</span></Link>}
      {!over && stream && <span className="livebadge">LIVE</span>}
      <span className="grow" />
      <button className="btn icon liveglass" aria-label="More" onClick={() => setReportOpen((v) => !v)}><Icon name="more" /></button>
    </header>
    {reportOpen && <div className="livemenu"><button onClick={report}><Icon name="flag" /> Report live video</button></div>}
    {needTap && <button className="btn liveunmute" onClick={() => { roomRef.current?.startAudio(); audioRef.current?.play(); setNeedTap(false); }}><Icon name="mute" /> Tap for sound</button>}
    {(over || err) && <div className="livewait"><p className="big">{over ? 'This live video has ended' : err}</p><button className="btn livego" onClick={() => nav('/')}>Back to Home</button></div>}
    {stream && !over && !err && <Overlay id={id} mine={false} comments={ev.comments} viewers={ev.viewers} floaters={ev.floaters} onReact={react} onComment={(c) => ev.setComments((x) => (x.some((y) => y.id === c.id) ? x : [...x, c]))} />}
  </div>;
}

