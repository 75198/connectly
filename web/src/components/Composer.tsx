import { FormEvent, useEffect, useRef, useState } from 'react';
import { FEELINGS, Post, api, feelingEmoji, getFeatures, haptic, toast, uploadForm } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet } from './ui';
import { MediaStudio } from './MediaStudio';
import { MusicPicker } from './MusicPicker';
import { sfx } from '../lib/sounds';
import type { Track } from '../api';

type Vis = 'public' | 'friends' | 'private';
const AUD: { k: Vis; label: string; icon: 'globe' | 'users' | 'lock'; hint: string }[] = [
  { k: 'public', label: 'Public', icon: 'globe', hint: 'Anyone on or off Connectly' },
  { k: 'friends', label: 'Friends', icon: 'users', hint: 'People you follow who follow you back' },
  { k: 'private', label: 'Only me', icon: 'lock', hint: 'Only you can see it' },
];

// Home: a compact "What's on your mind?" card. Tapping it opens the full composer sheet.
export function Composer({ onPosted, autoFocus, spaceId }: { onPosted: (p: Post) => void; autoFocus?: boolean; spaceId?: number }) {
  const { me } = useSession(); const [open, setOpen] = useState(false);
  if (!me) return null;
  if (autoFocus) return <div className="card"><ComposerForm onPosted={(p) => onPosted(p)} spaceId={spaceId} /></div>;
  const who = me.acting_as ? { full_name: me.acting_as.name, avatar_path: me.acting_as.photo_path } : me;
  return <>
    <div className="card composer-trigger">
      <Avatar user={who} size={40} />
      <button className="fakeinput grow" onClick={() => { haptic(); setOpen(true); }}>{spaceId ? 'Write something…' : `What’s on your mind, ${(me.acting_as?.name || me.full_name).split(' ')[0]}?`}</button>
      <button className="btn icon ghost" aria-label="Add photo or video" onClick={() => setOpen(true)}><Icon name="image" /></button>
    </div>
    {open && <Sheet title="Create post" onClose={() => setOpen(false)}><ComposerForm spaceId={spaceId} onPosted={(p, pub) => { setOpen(false); if (pub) onPosted(p); }} /></Sheet>}
  </>;
}

export function ComposerForm({ onPosted, spaceId, initialText = '' }: { onPosted: (p: Post, published: boolean) => void; spaceId?: number; initialText?: string }) {
  const { me } = useSession();
  const [body, setBody] = useState(initialText);
  const [ff, setFf] = useState<any>({}); useEffect(() => { getFeatures().then(setFf); }, []);
  const [cfOnly, setCfOnly] = useState(false);
  const [poll, setPoll] = useState<string[] | null>(null); const [pollQ, setPollQ] = useState(''); const [when, setWhen] = useState(''); const [track, setTrack] = useState<Track | null>(null); const [musicOpen, setMusicOpen] = useState(false); const [hideLikes, setHideLikes] = useState(false);
  const [vis, setVis] = useState<Vis>(me?.default_post_visibility || 'public');
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(null);
  const [feeling, setFeeling] = useState(''); const [place, setPlace] = useState('');
  const [panel, setPanel] = useState<'' | 'feeling' | 'place' | 'audience' | 'ai' | 'schedule'>('');
  const [aiOn, setAiOn] = useState(false); const [aiPrompt, setAiPrompt] = useState(''); const [aiBusy, setAiBusy] = useState(false);
  const [creatorOn, setCreatorOn] = useState(false); const [tags, setTags] = useState<string[]>([]); const [ideas, setIdeas] = useState<string[]>([]); const [cBusy, setCBusy] = useState('');
  useEffect(() => { getFeatures().then((f) => { setAiOn(!!f.ai_support || !!f.ai_creator); setCreatorOn(!!f.ai_creator); }); }, []);
  const creator = async (action: 'caption' | 'improve' | 'hashtags' | 'ideas') => {
    if ((action === 'improve' || action === 'hashtags') && !body.trim()) { toast('Write something first, then try again.'); return; }
    setCBusy(action);
    try { const r = await api<{ text?: string; hashtags?: string[]; ideas?: string[] }>('/ai/creator', { json: { action, text: body, topic: aiPrompt, lang: document.documentElement.lang || 'en' } });
      if (r.text) { setBody(r.text); toast(action === 'improve' ? 'Caption improved' : 'Caption written. Edit it as you like.'); }
      if (r.hashtags) setTags(r.hashtags); if (r.ideas) setIdeas(r.ideas);
    } catch (e: any) { toast(e.message, 'err'); } finally { setCBusy(''); } };
  const aiWrite = async () => { const prompt = aiPrompt.trim() || 'Improve my draft'; setAiBusy(true);
    try { const r = await api<{ text: string }>('/ai/write', { json: { prompt, ...(body.trim() ? { draft: body } : {}) } }); setBody(r.text); setPanel(''); setAiPrompt(''); toast('Connectly AI wrote a draft. Edit it as you like.'); }
    catch (e: any) { toast(e.message, 'err'); } finally { setAiBusy(false); } };
  const [err, setErr] = useState(''); const [busy, setBusy] = useState<'' | 'post' | 'draft'>(''); const [pct, setPct] = useState(0);
  const [studio, setStudio] = useState<null | 'new' | 'edit'>(null); const [enhance, setEnhance] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const isVideo = !!file?.type.startsWith('video/');
  useEffect(() => { if (!file) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  const pick = (f?: File) => {
    setErr(''); if (!f) return;
    if (f.type.startsWith('video/')) { if (spaceId) return setErr('Videos can be shared as reels from your profile.'); if (f.size > 50 * 1024 * 1024) return setErr('Video must be 50 MB or smaller.'); return setFile(f); }
    if (!f.type.startsWith('image/')) return setErr('Choose a photo or a video.');
    if (f.size > 15 * 1024 * 1024) return setErr('Image must be 15 MB or smaller.');
    setFile(f);
  };
  async function submit(e: FormEvent | null, draft = false) {
    e?.preventDefault(); setErr('');
    if (poll && (!pollQ.trim() || poll.filter((o) => o.trim()).length < 2)) return setErr('Add a question and at least two options.');
    if (!body.trim() && !file && !poll) return setErr('Write something or add a photo.');
    if (draft && isVideo) return setErr('Videos can’t be saved as drafts yet.');
    setBusy(draft ? 'draft' : 'post'); setPct(0);
    try {
      let p: Post;
      if (isVideo) {
        const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis); if (track) fd.append('music_track_id', String(track.id)); fd.append('video', file!);
        p = await uploadForm<Post>('/reels', fd, setPct);
      } else {
        const fd = new FormData(); fd.append('body', body || (poll ? pollQ : '')); fd.append('visibility', vis); if (cfOnly) fd.append('close_friends', '1');
        if (poll) fd.append('poll', JSON.stringify({ question: pollQ.trim(), options: poll.map((o) => o.trim()).filter(Boolean) })); if (when && !draft) fd.append('scheduled_for', new Date(when).toISOString()); if (track) fd.append('music_track_id', String(track.id)); if (hideLikes) fd.append('hide_like_count', '1');
        if (feeling) fd.append('feeling', feeling); if (place.trim()) fd.append('location_tag', place.trim());
        if (draft) fd.append('as_draft', '1'); if (enhance) fd.append('enhance', '1'); if (spaceId) fd.append('space_id', String(spaceId)); if (file) fd.append('image', file);
        p = await uploadForm<Post>('/posts', fd, setPct);
      }
      haptic(15); sfx('posted');
      toast(draft ? 'Saved to Drafts' : when ? 'Scheduled' : isVideo ? 'Your reel is live' : 'Your post is live');
      setPoll(null); setPollQ(''); setWhen(''); setTrack(null); setBody(''); setFile(null); setFeeling(''); setPlace(''); if (input.current) input.current.value = '';
      onPosted(p, !draft && !isVideo);
    } catch (x: any) { setErr(x.message); toast(x.message, 'err'); } finally { setBusy(''); }
  }
  if (!me) return null;
  const aud = AUD.find((a) => a.k === vis)!;
  return <form className="composerform" onSubmit={(e) => submit(e)} aria-label="Create post">
    <div className="row"><Avatar user={me.acting_as ? { full_name: me.acting_as.name, avatar_path: me.acting_as.photo_path } : me} size={44} />
      <div className="grow"><b>{me.acting_as?.name || me.full_name}</b>
        {feeling && <span className="meta"> is feeling {feelingEmoji(feeling)} {feeling}</span>}{place.trim() && <span className="meta"> at {place.trim()}</span>}
        {!spaceId && <div><button type="button" className="audchip" onClick={() => setPanel(panel === 'audience' ? '' : 'audience')}><Icon name={aud.icon} /> {aud.label} ▾</button></div>}</div></div>
    <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} aria-label="Post text"
      placeholder={spaceId ? 'Write something…' : `What’s on your mind, ${(me.acting_as?.name || me.full_name).split(' ')[0]}?`} />
    {preview && <div className="preview">{isVideo ? <video src={preview} controls playsInline muted /> : <img src={preview} alt="Selected" />}
      {!isVideo && <button type="button" className="chip previewedit" onClick={() => setStudio('edit')}>✏️ Edit{enhance ? ' · ✨' : ''}</button>}
      <button type="button" className="btn icon previewx" aria-label="Remove" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }}><Icon name="x" /></button></div>}
    {panel === 'audience' && <div className="optpanel" role="radiogroup" aria-label="Audience">{AUD.map((a) => <button type="button" key={a.k} role="radio" aria-checked={vis === a.k} className={`optrow ${vis === a.k ? 'on' : ''}`} onClick={() => { setVis(a.k); setPanel(''); }}>
      <span className="opticon"><Icon name={a.icon} /></span><span className="grow"><b>{a.label}</b><small className="meta">{a.hint}</small></span>{vis === a.k && '✓'}</button>)}</div>}
    {panel === 'ai' && <div className="optpanel aiwrite"><span className="aiorb sm">✦</span>
      <input autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} maxLength={500} placeholder={body.trim() ? 'How should I improve it?' : 'What should I write?'} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aiWrite(); } }} aria-label="Write with Connectly AI" />
      <button type="button" className="btn primary" disabled={aiBusy} onClick={aiWrite}>{aiBusy ? 'Writing…' : 'Write'}</button></div>}
    {panel === 'ai' && creatorOn && <div className="creatorrow">
      <button type="button" className="chip" disabled={!!cBusy} onClick={() => creator('caption')}>{cBusy === 'caption' ? '…' : '✍️'} Caption</button>
      <button type="button" className="chip" disabled={!!cBusy} onClick={() => creator('improve')}>{cBusy === 'improve' ? '…' : '✨'} Improve</button>
      <button type="button" className="chip" disabled={!!cBusy} onClick={() => creator('hashtags')}>{cBusy === 'hashtags' ? '…' : '#'} Hashtags</button>
      <button type="button" className="chip" disabled={!!cBusy} onClick={() => creator('ideas')}>{cBusy === 'ideas' ? '…' : '💡'} Ideas</button>
      {file && !isVideo && <button type="button" className={`chip ${enhance ? 'on' : ''}`} onClick={() => { setEnhance(!enhance); toast(enhance ? 'Photo enhance off' : 'Photo enhanced: sharper, richer colour'); }}>🪄 {enhance ? 'Enhanced' : 'Enhance photo'}</button>}
      {tags.length > 0 && <div className="creatorout">{tags.map((t) => <button type="button" key={t} className="chip" onClick={() => { setBody((b) => (b.includes(t) ? b : `${b.trimEnd()} ${t}`.trim())); setTags((x) => x.filter((y) => y !== t)); }}>{t}</button>)}</div>}
      {ideas.length > 0 && <div className="creatorout col">{ideas.map((i) => <button type="button" key={i} className="optrow" onClick={() => { setBody(i); setIdeas([]); }}>💡 {i}</button>)}</div>}
    </div>}
    {panel === 'feeling' && <div className="optpanel feelgrid">{FEELINGS.map((f) => <button type="button" key={f.k} className={`chip ${feeling === f.k ? 'on' : ''}`} onClick={() => { setFeeling(feeling === f.k ? '' : f.k); setPanel(''); }}>{f.e} {f.k}</button>)}</div>}
    {panel === 'place' && <div className="optpanel"><label>Where are you?<input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} autoFocus autoComplete="off" /></label></div>}
    {poll && <div className="optpanel polledit"><input value={pollQ} onChange={(e) => setPollQ(e.target.value)} maxLength={300} placeholder="Ask a question" aria-label="Poll question" />
      {poll.map((o, i) => <div key={i} className="row"><input value={o} onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value : x)))} maxLength={80} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} />{poll.length > 2 && <button type="button" className="btn icon ghost" aria-label="Remove option" onClick={() => setPoll(poll.filter((_, j) => j !== i))}><Icon name="x" /></button>}</div>)}
      <div className="row between">{poll.length < 6 && <button type="button" className="linkish" onClick={() => setPoll([...poll, ''])}>+ Add option</button>}<button type="button" className="linkish" onClick={() => setPoll(null)}>Remove poll</button></div></div>}
    {panel === 'schedule' && <div className="optpanel"><label>Publish at<input type="datetime-local" value={when} min={new Date(Date.now() + 5 * 60e3 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16)} onChange={(e) => setWhen(e.target.value)} /></label>{when && <button type="button" className="linkish" onClick={() => { setWhen(''); setPanel(''); }}>Post now instead</button>}</div>}
    {track && <div className="row musicsel"><span className="grow">♫ {track.title} · {track.artist}</span><button type="button" className="btn icon ghost" aria-label="Remove music" onClick={() => setTrack(null)}><Icon name="x" /></button></div>}
    {musicOpen && <MusicPicker onClose={() => setMusicOpen(false)} onPick={(t) => { setTrack(t); setMusicOpen(false); }} />}
    <div className="composeropts">
      <label className="optbtn"><span className="dotc green"><Icon name="image" /></span>Photo/video<input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/3gpp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
      {aiOn && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'ai' ? '' : 'ai')}><span className="dotc aidot">✦</span>Write with Connectly AI</button>}
      <button type="button" className="optbtn" onClick={() => setStudio('new')}><span className="dotc blue">📷</span>Camera</button>
      {!isVideo && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'feeling' ? '' : 'feeling')}><span className="dotc amber">🙂</span>Feeling</button>}
      {!isVideo && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'place' ? '' : 'place')}><span className="dotc red"><Icon name="pin" /></span>Location</button>}
      {ff.polls && !isVideo && !poll && <button type="button" className="optbtn" onClick={() => setPoll(['', ''])}><span className="dotc blue">📊</span>Poll</button>}
      {ff.music && <button type="button" className="optbtn" onClick={() => setMusicOpen(true)}><span className="dotc aidot">♫</span>Music</button>}
      {ff.creator_tools && !spaceId && !isVideo && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'schedule' ? '' : 'schedule')}><span className="dotc amber"><Icon name="clock" /></span>{when ? 'Scheduled' : 'Schedule'}</button>}
      {ff.close_friends && <button type="button" className={`optbtn ${cfOnly ? 'on' : ''}`} aria-pressed={cfOnly} onClick={() => setCfOnly(!cfOnly)}><span className="dotc" style={{ background: 'var(--cf)' }}>★</span>{cfOnly ? 'Close friends only' : 'Share with close friends only'}</button>}
      {ff.hide_likes && <button type="button" className={`optbtn ${hideLikes ? 'on' : ''}`} aria-pressed={hideLikes} onClick={() => setHideLikes(!hideLikes)}><span className="dotc green">🙈</span>{hideLikes ? 'Like count hidden' : 'Hide like count'}</button>}
    </div>
    {studio && <MediaStudio allowVideo={!spaceId} initial={studio === 'edit' ? file : null} onClose={() => setStudio(null)} onDone={(r) => { setStudio(null); setEnhance(r.enhance); setFile(r.file); }} />}
    {busy && <div className="postprogress" role="status"><div className="progress"><div style={{ width: `${Math.max(pct, 8)}%` }} /></div><span className="meta">{busy === 'draft' ? 'Saving draft…' : pct < 100 ? `Posting… ${pct}%` : isVideo ? 'Processing video…' : 'Posting…'}</span></div>}
    {err && <p className="error" role="alert">{err}</p>}
    <div className="row">
      {!spaceId && !isVideo && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => submit(null, true)}>Save draft</button>}
      <button className="btn primary grow" disabled={!!busy || (!body.trim() && !file && !poll)}>{busy === 'post' ? <><span className="spinner sm" /> Posting…</> : when ? 'Schedule' : 'Post'}</button>
    </div>
  </form>;
}
