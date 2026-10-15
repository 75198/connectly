import { FormEvent, useEffect, useRef, useState } from 'react';
import { FEELINGS, Post, api, feelingEmoji, getFeatures, haptic, toast, uploadForm } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet } from './ui';
import { MediaStudio } from './MediaStudio';

type Vis = 'public' | 'friends' | 'private';
const AUD: { k: Vis; label: string; icon: 'globe' | 'users' | 'lock'; hint: string }[] = [
  { k: 'public', label: 'Public', icon: 'globe', hint: 'Anyone on or off Connectly' },
  { k: 'friends', label: 'Friends', icon: 'users', hint: 'Your friends on Connectly' },
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

export function ComposerForm({ onPosted, spaceId }: { onPosted: (p: Post, published: boolean) => void; spaceId?: number }) {
  const { me } = useSession();
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<Vis>(me?.default_post_visibility || 'public');
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(null);
  const [feeling, setFeeling] = useState(''); const [place, setPlace] = useState('');
  const [panel, setPanel] = useState<'' | 'feeling' | 'place' | 'audience' | 'ai'>('');
  const [aiOn, setAiOn] = useState(false); const [aiPrompt, setAiPrompt] = useState(''); const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { getFeatures().then((f) => setAiOn(!!f.ai_support)); }, []);
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
    if (!body.trim() && !file) return setErr('Write something or add a photo.');
    if (draft && isVideo) return setErr('Videos can’t be saved as drafts yet.');
    setBusy(draft ? 'draft' : 'post'); setPct(0);
    try {
      let p: Post;
      if (isVideo) {
        const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis); fd.append('video', file!);
        p = await uploadForm<Post>('/reels', fd, setPct);
      } else {
        const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis);
        if (feeling) fd.append('feeling', feeling); if (place.trim()) fd.append('location_tag', place.trim());
        if (draft) fd.append('as_draft', '1'); if (enhance) fd.append('enhance', '1'); if (spaceId) fd.append('space_id', String(spaceId)); if (file) fd.append('image', file);
        p = await uploadForm<Post>('/posts', fd, setPct);
      }
      haptic(15);
      toast(draft ? 'Saved to Drafts' : isVideo ? 'Your reel is live' : 'Your post is live');
      setBody(''); setFile(null); setFeeling(''); setPlace(''); if (input.current) input.current.value = '';
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
      <input autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} maxLength={500} placeholder={body.trim() ? 'How should I improve it? (e.g. make it funnier)' : 'What should I write? (e.g. caption for my graduation)'} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aiWrite(); } }} aria-label="Write with Connectly AI" />
      <button type="button" className="btn primary" disabled={aiBusy} onClick={aiWrite}>{aiBusy ? 'Writing…' : 'Write'}</button></div>}
    {panel === 'feeling' && <div className="optpanel feelgrid">{FEELINGS.map((f) => <button type="button" key={f.k} className={`chip ${feeling === f.k ? 'on' : ''}`} onClick={() => { setFeeling(feeling === f.k ? '' : f.k); setPanel(''); }}>{f.e} {f.k}</button>)}</div>}
    {panel === 'place' && <div className="optpanel"><label>Where are you?<input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} autoFocus autoComplete="off" /></label></div>}
    <div className="composeropts">
      <label className="optbtn"><span className="dotc green"><Icon name="image" /></span>Photo/video<input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/3gpp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
      {aiOn && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'ai' ? '' : 'ai')}><span className="dotc aidot">✦</span>Write with Connectly AI</button>}
      <button type="button" className="optbtn" onClick={() => setStudio('new')}><span className="dotc blue">📷</span>Camera</button>
      {!isVideo && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'feeling' ? '' : 'feeling')}><span className="dotc amber">🙂</span>Feeling</button>}
      {!isVideo && <button type="button" className="optbtn" onClick={() => setPanel(panel === 'place' ? '' : 'place')}><span className="dotc red"><Icon name="pin" /></span>Location</button>}
    </div>
    {studio && <MediaStudio allowVideo={!spaceId} initial={studio === 'edit' ? file : null} onClose={() => setStudio(null)} onDone={(r) => { setStudio(null); setEnhance(r.enhance); setFile(r.file); }} />}
    {busy && <div className="postprogress" role="status"><div className="progress"><div style={{ width: `${Math.max(pct, 8)}%` }} /></div><span className="meta">{busy === 'draft' ? 'Saving draft…' : pct < 100 ? `Posting… ${pct}%` : isVideo ? 'Processing video…' : 'Posting…'}</span></div>}
    {err && <p className="error" role="alert">{err}</p>}
    <div className="row">
      {!spaceId && !isVideo && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => submit(null, true)}>Save draft</button>}
      <button className="btn primary grow" disabled={!!busy || (!body.trim() && !file)}>{busy === 'post' ? <><span className="spinner sm" /> Posting…</> : 'Post'}</button>
    </div>
  </form>;
}
