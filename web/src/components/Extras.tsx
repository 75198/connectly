// Round 7/8 post extras: verified badge, clickable hashtags, polls, translate, music chip, remix (duet) view, insights.
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, credit, getFeatures, Post, toast, Track } from '../api';
import { useI18n } from '../lib/i18n';
import { Sheet } from './ui';

export function VerifiedBadge({ on, size = 16 }: { on?: boolean; size?: number }) {
  const [f, setF] = useState(false); useEffect(() => { getFeatures().then((x) => setF(!!x.verified)); }, []);
  if (!on || !f) return null;
  return <svg className="vbadge" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Verified"><title>Verified</title>
    <path fill="var(--verified)" d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.6-.6 2.9 1.3 2.7-2 2.2-.2 3-2.9.8-1.7 2.5-2.9-.9-2.8 1-1.8-2.4-3-.5-.5-3-2.4-1.8 1-2.8L1.6 9l2.3-2 .2-3 2.9-.6L8.6 1z" />
    <path d="M7.5 12.3l3 3 6-6.2" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Turns #hashtags into links (when the flag is on) and keeps everything else as text.
export function RichText({ text, tags = true }: { text: string; tags?: boolean }) {
  const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((x) => setOn(!!x.hashtags)); }, []);
  if (!on || !tags) return <>{text}</>;
  const parts = text.split(/((?:^|[^\p{L}\p{N}_&/])#[\p{L}\p{N}_]{1,50})/u);
  return <>{parts.map((p, i) => { const m = p.match(/^(.?)#([\p{L}\p{N}_]{1,50})$/u); if (!m || /^\d+$/.test(m[2])) return <Fragment key={i}>{p}</Fragment>;
    return <Fragment key={i}>{m[1]}<Link className="hashtag" to={`/tag/${encodeURIComponent(m[2].toLowerCase())}`} onClick={(e) => e.stopPropagation()}>#{m[2]}</Link></Fragment>; })}</>;
}

export function TranslateButton({ text, onText }: { text: string; onText: (t: string | null) => void }) {
  const { lang, t } = useI18n(); const [on, setOn] = useState(false); const [state, setState] = useState<'idle' | 'busy' | 'shown'>('idle');
  useEffect(() => { getFeatures().then((x) => setOn(!!x.translate)); }, []);
  if (!on || !text.trim() || text.trim().length < 2) return null;
  const go = async () => {
    if (state === 'shown') { onText(null); setState('idle'); return; }
    setState('busy');
    try { const r = await api<{ text: string }>('/translate', { json: { text: text.slice(0, 4000), target: lang } }); onText(r.text); setState('shown'); }
    catch (e: any) { toast(e.message, 'err'); setState('idle'); }
  };
  return <button type="button" className="linkish translatebtn" onClick={go} disabled={state === 'busy'}>{state === 'busy' ? '…' : state === 'shown' ? t('seeOriginal') : t('translate')}</button>;
}

export function PollView({ post, onChange }: { post: Post; onChange: (p: Post) => void }) {
  const p = post.poll!; const total = Object.values(p.counts || {}).reduce((a, b) => a + b, 0);
  const closed = !!p.closes_at && new Date(p.closes_at) < new Date(); const voted = p.my_vote !== null && p.my_vote !== undefined;
  const vote = async (i: number) => { try { onChange(await api<Post>(`/polls/${p.id}/vote`, { method: 'PUT', json: { option: i } })); } catch (e: any) { toast(e.message, 'err'); } };
  return <div className="poll"><b className="pollq">{p.question}</b>
    {p.options.map((o, i) => { const n = p.counts?.[i] || 0; const pct = total ? Math.round((n / total) * 100) : 0; const show = voted || closed || post.is_mine;
      return <button key={i} type="button" className={`pollopt ${p.my_vote === i ? 'mine' : ''} ${show ? 'shown' : ''}`} disabled={closed} onClick={() => vote(i)}>
        {show && <span className="pollbar" style={{ width: `${pct}%` }} />}<span className="polltext">{o}{p.my_vote === i && ' ✓'}</span>{show && <span className="pollpct">{pct}%</span>}</button>; })}
    <span className="meta">{total === 1 ? '1 vote' : `${total} votes`}{closed ? ' · Final results' : p.closes_at ? ` · Ends ${new Date(p.closes_at).toLocaleDateString()}` : ''}</span></div>;
}

// Plays a bundled royalty-free track; shows the attribution the licence requires.
export function MusicChip({ track, start = 0, autoplay = false }: { track: Track; start?: number; autoplay?: boolean }) {
  const a = useRef<HTMLAudioElement>(null); const [on, setOn] = useState(false);
  useEffect(() => { if (autoplay && a.current) { a.current.currentTime = start; a.current.play().then(() => setOn(true)).catch(() => {}); } }, [autoplay, start]);
  const toggle = () => { const el = a.current!; if (on) { el.pause(); setOn(false); } else { el.currentTime = el.currentTime || start; el.play().then(() => setOn(true)).catch(() => toast('Tap again to play', 'err')); } };
  return <span className="musicchip"><button type="button" onClick={toggle} aria-label={on ? 'Pause music' : 'Play music'}><span className={`eq ${on ? 'on' : ''}`}><i /><i /><i /></span></button>
    <Link to={`/sound/${track.id}`} className="musictitle" title={credit(track)}>♫ {credit(track)}</Link><audio ref={a} src={track.url} loop preload="none" onEnded={() => setOn(false)} /></span>;
}

// Side-by-side duet: the original reel on the left, the reply on the right, played in sync.
export function DuetView({ post, hd }: { post: Post; hd?: boolean }) {
  const l = useRef<HTMLVideoElement>(null); const r = useRef<HTMLVideoElement>(null); const [playing, setPlaying] = useState(false);
  const toggle = () => { const vids = [l.current!, r.current!]; if (playing) { vids.forEach((v) => v.pause()); setPlaying(false); } else { vids.forEach((v) => { v.currentTime = 0; }); Promise.all(vids.map((v) => v.play())).then(() => setPlaying(true)).catch(() => {}); } };
  if (!post.remix_of) return null; void hd;
  return <div className="duet" onClick={toggle} role="button" aria-label={playing ? 'Pause duet' : 'Play duet'}>
    <video ref={l} src={post.remix_of.video_path} poster={post.remix_of.poster_path} playsInline muted preload="metadata" />
    <video ref={r} src={post.video_path || ''} poster={post.poster_path || ''} playsInline preload="metadata" />
    {!playing && <span className="duetplay">▶</span>}<span className="duettag">Duet with @{post.remix_of.username}</span></div>;
}

export function InsightsSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api(`/posts/${post.id}/insights`).then(setD).catch((e) => setErr(e.message)); }, [post.id]);
  const tiles: [string, string][] = d ? [['Accounts reached', d.reach], ['Reactions', d.reactions], ['Comments', d.comments], ['Shares', d.shares], ['Saves', d.saves], ...(post.kind === 'reel' ? [['Views', d.views] as [string, string]] : []), ['Engagement rate', `${d.engagement_rate}%`], ['Reached non-followers', d.non_followers]] : [];
  return <Sheet title="Post insights" onClose={onClose}>{err ? <p className="error">{err}</p> : !d ? <div className="spinner" /> : <div className="insightgrid">{tiles.map(([k, v]) => <div key={k} className="insight"><b>{v}</b><span>{k}</span></div>)}</div>}</Sheet>;
}

// Records which posts were on screen (for creator insights). Batches and sends every few seconds.
const seen = new Set<number>(); let queue: number[] = []; let timer = 0;
export function useImpression(ref: React.RefObject<HTMLElement>, id: number, mine: boolean) {
  useEffect(() => {
    if (mine || seen.has(id) || !ref.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { seen.add(id); queue.push(id); io.disconnect();
      clearTimeout(timer); timer = window.setTimeout(() => { const ids = queue.splice(0, 50); getFeatures().then((f) => f.creator_tools && ids.length && api('/impressions', { json: { ids } }).catch(() => {})); }, 2500); } }, { threshold: 0.5 });
    io.observe(ref.current); return () => io.disconnect();
  }, [id, mine, ref]);
}
