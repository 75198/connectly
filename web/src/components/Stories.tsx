import { useEffect, useRef, useState } from 'react';
import { api, postTime, toast, uploadForm, useFeatures, type Track } from '../api';
import { MusicChip } from './Extras';
import { MusicPicker } from './MusicPicker';
import { sfx } from '../lib/sounds';
import { useSession } from '../session';
import { Avatar, Icon } from './ui';
import { MediaStudio } from './MediaStudio';
import { Link } from 'react-router-dom';
import { useLiveNow } from './LiveRow';

type Story = { id: number; image_path: string; caption: string; created_at: string } & StoryX;
type StoryX = { audience?: string; music?: Track | null; add_yours?: string | null; add_yours_count?: number };
type Group = { author: { id: number; username: string; full_name: string; avatar_path: string | null }; items: Story[] };

// 24-hour photo stories from you, your friends and people you follow.
export function StoriesBar() {
  const { me } = useSession();
  const liveNow = useLiveNow();
  const [groups, setGroups] = useState<Group[] | null>(null); const [open, setOpen] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [studio, setStudio] = useState(false);
  const load = () => api<{ items: Group[] }>('/stories').then((r) => setGroups(r.items)).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);
  const [pending, setPending] = useState<{ f: File; enhance: boolean; replyTo?: Story } | null>(null); const [replyTo, setReplyTo] = useState<Story | null>(null);
  const add = async (f?: File, enhance = false) => {
    if (!f) return; if (!f.type.startsWith('image/')) return toast('Choose a photo for your story', 'err');
    setPending({ f, enhance, replyTo: replyTo || undefined }); setReplyTo(null);
  };
  const publish = async (o: { caption: string; audience: string; track: Track | null; addYours: string }) => {
    const p = pending!; setPending(null);
    const fd = new FormData(); fd.append('image', p.f); if (o.caption.trim()) fd.append('caption', o.caption.trim().slice(0, 200)); if (p.enhance) fd.append('enhance', '1');
    if (o.audience !== 'all') fd.append('audience', o.audience); if (o.track) fd.append('music_track_id', String(o.track.id)); if (o.addYours.trim()) fd.append('add_yours', o.addYours.trim()); if (p.replyTo) fd.append('add_yours_of', String(p.replyTo.id));
    setBusy(true); try { await uploadForm('/stories', fd); sfx('posted'); toast(o.audience === 'close_friends' ? 'Shared with Close friends' : 'Story shared for 24 hours'); await load(); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  if (!me) return null;
  return <div className="stories" aria-label="Stories">
    <button className="story add" onClick={() => setStudio(true)}><span className="storyimg"><Avatar user={me} size={60} /><b className="storyplus">{busy ? '…' : '+'}</b></span><small>Your story</small></button>
    {studio && <MediaStudio onClose={() => setStudio(false)} onDone={(r) => { setStudio(false); add(r.file, r.enhance); }} />}
    {liveNow.map((s) => <Link key={`l${s.id}`} to={`/live/${s.id}`} className="story"><span className="storyring livering"><Avatar user={s.host} size={58} /><span className="livebadge sm">LIVE</span></span><small>{s.is_mine ? 'You' : s.host.full_name.split(' ')[0]}</small></Link>)}
    {groups === null ? [0, 1, 2].map((i) => <span key={i} className="story"><span className="sk circle big" /><span className="sk line w60" /></span>)
      : groups.map((g, i) => <button key={g.author.id} className="story" onClick={() => setOpen(i)}><span className={`storyring ${g.items.some((x) => x.audience === 'close_friends') ? 'cfring' : ''}`}><Avatar user={g.author} size={58} /></span><small>{g.author.id === me.id ? 'You' : g.author.full_name.split(' ')[0]}</small></button>)}
    {open !== null && groups && <StoryViewer groups={groups} start={open} onClose={() => setOpen(null)} onDeleted={load} onAddYours={(st) => { setOpen(null); setReplyTo(st); setStudio(true); }} />}
    {pending && <StoryPublish file={pending.f} replyTo={pending.replyTo} onCancel={() => setPending(null)} onShare={publish} />}
  </div>;
}

function StoryViewer({ groups, start, onClose, onDeleted, onAddYours }: { groups: Group[]; start: number; onClose: () => void; onDeleted: () => void; onAddYours: (s: Story) => void }) {
  const { me } = useSession();
  const [g, setG] = useState(start); const [i, setI] = useState(0); const [paused, setPaused] = useState(false);
  const grp = groups[g]; const s = grp?.items[i]; const t = useRef<number>();
  const next = () => { if (i < grp.items.length - 1) setI(i + 1); else if (g < groups.length - 1) { setG(g + 1); setI(0); } else onClose(); };
  const prev = () => { if (i > 0) setI(i - 1); else if (g > 0) { setG(g - 1); setI(0); } };
  useEffect(() => { if (paused) return; t.current = window.setTimeout(next, 5000); return () => clearTimeout(t.current); }); // eslint-disable-line
  if (!s) return null;
  return <div className="storyview" role="dialog" aria-label={`Story by ${grp.author.full_name}`} onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
    <div className="storybars">{grp.items.map((x, k) => <span key={x.id}><i className={k < i ? 'full' : k === i && !paused ? 'run' : k === i ? 'run paused' : ''} /></span>)}</div>
    <div className="storyhead row"><Avatar user={grp.author} size={34} /><b>{grp.author.full_name}</b><small>{postTime(s.created_at)}</small><span className="grow" />
      {grp.author.id === me?.id && <button className="btn icon reelbtn" aria-label="Delete story" onClick={async (e) => { e.stopPropagation(); if (!confirm('Delete this story?')) return; await api(`/stories/${s.id}`, { method: 'DELETE' }); toast('Story deleted'); onDeleted(); onClose(); }}><Icon name="trash" /></button>}
      <button className="btn icon reelbtn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
    <img key={s.id} src={s.image_path} alt={s.caption || 'Story'} />
    {s.audience === 'close_friends' && <span className="cftag">★ Close friends</span>}
    {s.caption && <p className="storycap">{s.caption}</p>}
    {s.music && <div className="storymusic" onPointerDown={(e) => e.stopPropagation()}><MusicChip key={s.id} track={s.music} autoplay /></div>}
    {s.add_yours && <button className="addyours" onPointerDown={(e) => e.stopPropagation()} onClick={() => onAddYours(s)}><small>ADD YOURS</small><b>{s.add_yours}</b><span>📸 Add yours{s.add_yours_count ? ` · ${s.add_yours_count}` : ''}</span></button>}
    <button className="storynav left" aria-label="Previous" onClick={prev} /><button className="storynav right" aria-label="Next" onClick={next} />
  </div>;
}

function StoryPublish({ file, replyTo, onCancel, onShare }: { file: File; replyTo?: Story; onCancel: () => void; onShare: (o: { caption: string; audience: string; track: Track | null; addYours: string }) => void }) {
  const ff = useFeatures(); const [caption, setCaption] = useState(''); const [audience, setAudience] = useState('all'); const [track, setTrack] = useState<Track | null>(null); const [pick, setPick] = useState(false); const [addYours, setAddYours] = useState('');
  const [url] = useState(() => URL.createObjectURL(file)); useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="sheetwrap" onClick={onCancel}><div className="sheet storypub" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share story">
    <div className="row"><img className="storypubthumb" src={url} alt="" /><div className="grow stack"><b>{replyTo?.add_yours ? `Add yours: ${replyTo.add_yours}` : 'Your story'}</b>
      <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Write a caption" aria-label="Caption" /></div></div>
    {ff?.close_friends && <div className="segmented" role="radiogroup" aria-label="Audience"><button type="button" className={audience === 'all' ? 'on' : ''} onClick={() => setAudience('all')}>Your story</button><button type="button" className={audience === 'close_friends' ? 'on cf' : 'cf'} onClick={() => setAudience('close_friends')}>★ Close friends</button></div>}
    {ff?.music && (track ? <div className="row"><MusicChip track={track} /><button type="button" className="linkish" onClick={() => setTrack(null)}>Remove</button></div> : <button type="button" className="btn ghost" onClick={() => setPick(true)}>♫ Add music</button>)}
    {ff?.add_yours && !replyTo && <input value={addYours} onChange={(e) => setAddYours(e.target.value)} maxLength={80} placeholder="Start an “Add yours” prompt" aria-label="Add yours prompt" />}
    <div className="row"><button type="button" className="btn ghost grow" onClick={onCancel}>Cancel</button><button type="button" className="btn primary grow" onClick={() => onShare({ caption, audience, track, addYours })}>Share</button></div>
    {pick && <MusicPicker onClose={() => setPick(false)} onPick={(t) => { setTrack(t); setPick(false); }} />}
  </div></div>;
}
