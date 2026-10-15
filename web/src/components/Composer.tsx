import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, Post } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from './ui';

export function Composer({ onPosted, autoFocus }: { onPosted: (p: Post) => void; autoFocus?: boolean }) {
  const { me } = useSession();
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<'public' | 'friends' | 'private'>('public');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!file) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  const pick = (f?: File) => {
    setErr('');
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErr('Please choose an image.');
    if (f.size > 5 * 1024 * 1024) return setErr('Image must be 5 MB or smaller.');
    setFile(f);
  };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!body.trim() && !file) return setErr('Write something or add a photo.');
    const fd = new FormData(); fd.append('body', body); fd.append('visibility', vis); if (file) fd.append('image', file);
    setBusy(true);
    try { const p = await api<Post>('/posts', { form: fd }); setBody(''); setFile(null); if (input.current) input.current.value = ''; onPosted(p); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  if (!me) return null;
  return (
    <form className="card composer" onSubmit={submit} aria-label="Create post">
      <div className="row"><Avatar user={me} /><textarea autoFocus={autoFocus} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder={`What's on your mind, ${me.full_name.split(' ')[0]}?`} rows={3} /></div>
      {preview && <div className="preview"><img src={preview} alt="Selected" /><button type="button" className="chip" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }}>Remove photo</button></div>}
      {err && <p className="error">{err}</p>}
      <div className="row between wrap">
        <div className="row">
          <label className="btn ghost"><Icon name="image" /> Photo<input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
          <select value={vis} onChange={(e) => setVis(e.target.value as any)} aria-label="Who can see this">
            <option value="public">🌍 Public</option><option value="friends">👥 Friends</option><option value="private">🔒 Only me</option>
          </select>
        </div>
        <button className="btn primary" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </form>
  );
}
