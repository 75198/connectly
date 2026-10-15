// Voice/video calls in chats via LiveKit (round 7, FEATURE_CALLS) + Watch together (round 8, FEATURE_WATCH_TOGETHER).
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Room, RoomEvent, Track, createLocalTracks, type LocalTrack, type RemoteTrack, type RemoteParticipant } from 'livekit-client';
import { api, Post, toast, useFeatures } from '../api';
import { askPermission } from '../lib/permission';
import { Spinner } from '../components/ui';

type Tile = { id: string; name: string; video?: RemoteTrack };
export function Call() {
  const { id } = useParams(); const cid = Number(id); const [sp] = useSearchParams(); const nav = useNavigate(); const f = useFeatures();
  const [state, setState] = useState<'connecting' | 'live' | 'error'>('connecting'); const [err, setErr] = useState('');
  const [video, setVideo] = useState(sp.get('video') === '1'); const [mic, setMic] = useState(true); const [tiles, setTiles] = useState<Tile[]>([]); const [secs, setSecs] = useState(0);
  const room = useRef<Room | null>(null); const local = useRef<LocalTrack[]>([]); const me = useRef<HTMLVideoElement>(null); const audio = useRef<HTMLDivElement>(null);
  const [watch, setWatch] = useState<any>(null); const [picker, setPicker] = useState(false);
  useEffect(() => {
    let rm: Room | null = null; let cancelled = false;
    (async () => {
      try {
        if (!(await askPermission(video ? 'camera+microphone' : 'microphone'))) { nav(-1); return; }
        const r = await api<{ url: string; token: string }>(`/conversations/${cid}/call`, { json: { video, join: sp.get('join') === '1' } });
        rm = new Room({ adaptiveStream: true, dynacast: true }); room.current = rm;
        const refresh = () => setTiles([...rm!.remoteParticipants.values()].map((p: RemoteParticipant) => ({ id: p.identity, name: p.name || 'Guest', video: [...p.videoTrackPublications.values()].find((x) => x.track)?.track as RemoteTrack | undefined })));
        rm.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => { if (t.kind === Track.Kind.Audio && audio.current) audio.current.appendChild(t.attach()); refresh(); });
        rm.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => { t.detach().forEach((el) => el.remove()); refresh(); });
        rm.on(RoomEvent.ParticipantConnected, refresh); rm.on(RoomEvent.ParticipantDisconnected, refresh);
        rm.on(RoomEvent.DataReceived, (payload: Uint8Array) => { try { const d = JSON.parse(new TextDecoder().decode(payload)); if (d.type === 'watch') loadWatch(); } catch { /* ignore */ } });
        await rm.connect(r.url, r.token); if (cancelled) { rm.disconnect(); return; }
        local.current = await createLocalTracks({ audio: true, video: video ? { facingMode: 'user' } : false });
        for (const t of local.current) { await rm.localParticipant.publishTrack(t); if (t.kind === Track.Kind.Video && me.current) t.attach(me.current); }
        refresh(); setState('live');
      } catch (e: any) { setErr(e.message || 'Couldn’t connect the call'); setState('error'); }
    })();
    return () => { cancelled = true; local.current.forEach((t) => t.stop()); rm?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);
  useEffect(() => { if (state !== 'live') return; const i = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(i); }, [state]);
  const loadWatch = () => api<{ session: any }>(`/conversations/${cid}/watch`).then((r) => setWatch(r.session)).catch(() => {});
  useEffect(() => { if (!f?.watch_together || state !== 'live') return; loadWatch(); const i = setInterval(loadWatch, 3000); return () => clearInterval(i); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.watch_together, state]);
  const broadcast = () => { try { room.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'watch' })), { reliable: true }); } catch { /* polling covers it */ } };
  const setSession = async (body: { post_id: number | null; position: number; playing: boolean }) => { try { await api(`/conversations/${cid}/watch`, { method: 'PUT', json: body }); broadcast(); loadWatch(); } catch (e: any) { toast(e.message, 'err'); } };
  const toggleMic = async () => { await room.current?.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); };
  const toggleCam = async () => { const on = !video; await room.current?.localParticipant.setCameraEnabled(on); setVideo(on); const pub = room.current?.localParticipant.getTrackPublication(Track.Source.Camera); if (on && pub?.track && me.current) pub.track.attach(me.current); };
  const hang = () => { room.current?.disconnect(); nav(`/messages/${cid}`); };
  return <div className="callpage">
    <div ref={audio} hidden />
    {watch && <WatchPanel s={watch} onSync={setSession} />}
    <div className={`calltiles n${Math.min(tiles.length, 4)}`}>{tiles.map((t) => <RemoteTile key={t.id} t={t} />)}
      {!tiles.length && <div className="callwait">{state === 'error' ? <p className="error">{err}</p> : state === 'connecting' ? <><Spinner /><p>Connecting…</p></> : <p>Calling… waiting for others to join</p>}</div>}</div>
    <video ref={me} className={`selfview ${video ? '' : 'off'}`} muted playsInline autoPlay />
    <div className="calltimer">{state === 'live' ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : ''}</div>
    <div className="callbar">
      <button className={`callbtn ${mic ? '' : 'off'}`} aria-label={mic ? 'Mute' : 'Unmute'} onClick={toggleMic}>{mic ? '🎙️' : '🔇'}</button>
      <button className={`callbtn ${video ? '' : 'off'}`} aria-label={video ? 'Turn camera off' : 'Turn camera on'} onClick={toggleCam}>{video ? '📹' : '📷'}</button>
      {f?.watch_together && <button className="callbtn" aria-label="Watch together" onClick={() => setPicker(true)}>🍿</button>}
      <button className="callbtn hang" aria-label="End call" onClick={hang}>✕</button></div>
    {picker && <ReelPicker onClose={() => setPicker(false)} onPick={(p) => { setPicker(false); setSession({ post_id: p.id, position: 0, playing: true }); }} />}
  </div>;
}
function RemoteTile({ t }: { t: Tile }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (t.video && v.current) { t.video.attach(v.current); return () => { t.video?.detach(v.current!); }; } }, [t.video]);
  return <div className="calltile">{t.video ? <video ref={v} autoPlay playsInline /> : <span className="callav">{t.name.slice(0, 1).toUpperCase()}</span>}<small>{t.name}</small></div>;
}
// Synced reel: everyone's player follows the shared position; any viewer can play, pause or change the reel.
function WatchPanel({ s, onSync }: { s: any; onSync: (b: { post_id: number | null; position: number; playing: boolean }) => void }) {
  const v = useRef<HTMLVideoElement>(null); const post: Post = s.post;
  useEffect(() => { const el = v.current; if (!el) return; const dur = el.duration || post.video_seconds || 0; const pos = dur ? s.position % dur : s.position;
    if (Math.abs(el.currentTime - pos) > 1.2) el.currentTime = pos; if (s.playing && el.paused) el.play().catch(() => {}); if (!s.playing && !el.paused) el.pause(); }, [s, post.video_seconds]);
  return <div className="watchpanel"><video ref={v} src={post.video_path || ''} poster={post.poster_path || ''} playsInline loop muted={false}
    onPlay={(e) => !s.playing && onSync({ post_id: post.id, position: e.currentTarget.currentTime, playing: true })} onPause={(e) => s.playing && onSync({ post_id: post.id, position: e.currentTarget.currentTime, playing: false })} controls />
    <div className="row between"><small>🍿 Watching together · @{post.author.username}</small><button className="linkish" onClick={() => onSync({ post_id: null, position: 0, playing: false })}>Stop</button></div></div>;
}
function ReelPicker({ onClose, onPick }: { onClose: () => void; onPick: (p: Post) => void }) {
  const [items, setItems] = useState<Post[] | null>(null);
  useEffect(() => { api<{ items: Post[] }>('/reels').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  return <div className="sheetwrap" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}><div className="sheethead"><h3>Watch a reel together</h3></div>
    {!items ? <Spinner /> : !items.length ? <p className="meta">No reels yet.</p> : <div className="reelgrid">{items.map((p) => <button key={p.id} onClick={() => onPick(p)}><img src={p.poster_path || ''} alt="" /><small>@{p.author.username}</small></button>)}</div>}</div></div>;
}
