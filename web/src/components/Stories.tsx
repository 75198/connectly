import { useEffect, useRef, useState } from 'react';
import { api, postTime, toast, uploadForm } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from './ui';
import { MediaStudio } from './MediaStudio';
import { Link } from 'react-router-dom';
import { useLiveNow } from './LiveRow';

type Story = { id: number; image_path: string; caption: string; created_at: string };
type Group = { author: { id: number; username: string; full_name: string; avatar_path: string | null }; items: Story[] };

// 24-hour photo stories from you, your friends and people you follow.
export function StoriesBar() {
  const { me } = useSession();
  const liveNow = useLiveNow();
  const [groups, setGroups] = useState<Group[] | null>(null); const [open, setOpen] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [studio, setStudio] = useState(false);
  const load = () => api<{ items: Group[] }>('/stories').then((r) => setGroups(r.items)).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);
  const add = async (f?: File, enhance = false) => {
    if (!f) return; if (!f.type.startsWith('image/')) return toast('Choose a photo for your story', 'err');
    const caption = prompt('Add a caption (optional)') || '';
    const fd = new FormData(); fd.append('image', f); if (caption.trim()) fd.append('caption', caption.trim().slice(0, 200)); if (enhance) fd.append('enhance', '1');
    setBusy(true); try { await uploadForm('/stories', fd); toast('Story shared for 24 hours'); await load(); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  if (!me) return null;
  return <div className="stories" aria-label="Stories">
    <button className="story add" onClick={() => setStudio(true)}><span className="storyimg"><Avatar user={me} size={60} /><b className="storyplus">{busy ? '…' : '+'}</b></span><small>Your story</small></button>
    {studio && <MediaStudio onClose={() => setStudio(false)} onDone={(r) => { setStudio(false); add(r.file, r.enhance); }} />}
    {liveNow.map((s) => <Link key={`l${s.id}`} to={`/live/${s.id}`} className="story"><span className="storyring livering"><Avatar user={s.host} size={58} /><span className="livebadge sm">LIVE</span></span><small>{s.is_mine ? 'You' : s.host.full_name.split(' ')[0]}</small></Link>)}
    {groups === null ? [0, 1, 2].map((i) => <span key={i} className="story"><span className="sk circle big" /><span className="sk line w60" /></span>)
      : groups.map((g, i) => <button key={g.author.id} className="story" onClick={() => setOpen(i)}><span className="storyring"><Avatar user={g.author} size={58} /></span><small>{g.author.id === me.id ? 'You' : g.author.full_name.split(' ')[0]}</small></button>)}
    {open !== null && groups && <StoryViewer groups={groups} start={open} onClose={() => setOpen(null)} onDeleted={load} />}
  </div>;
}

function StoryViewer({ groups, start, onClose, onDeleted }: { groups: Group[]; start: number; onClose: () => void; onDeleted: () => void }) {
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
    {s.caption && <p className="storycap">{s.caption}</p>}
    <button className="storynav left" aria-label="Previous" onClick={prev} /><button className="storynav right" aria-label="Next" onClick={next} />
  </div>;
}
