// Connectly AI: live AI support chat (round 6). Talks only to our server (/api/ai/*);
// replies stream in as NDJSON lines: {conversation_id} → {t: "..."}* → {done} | {error}.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from '../components/ui';
import { UpgradeNotice } from './Plans';
import { useI18n } from '../lib/i18n';
import { speak, stopSpeaking, canSpeak, Recorder, shrinkImage } from '../lib/voice';

type Msg = { id?: number; role: 'user' | 'assistant'; content: string; error?: boolean; upgrade?: boolean; attachment_path?: string | null; attachment_kind?: string | null; local?: string; pending?: boolean };
type Conv = { id: number; title: string; updated_at: string; last: string | null };
const SUGGESTED = ['✍️ Write a caption for my beach photo', '💡 Weekend ideas in Lagos', '🌍 Translate “good morning” to Yoruba', '📚 Explain photosynthesis simply', '🎬 How do I go live?', '🔒 How do I make my posts private?'];

// Tiny safe formatter: **bold** and line breaks, no HTML injection.
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

export function Assistant() {
  const nav = useNavigate(); const { me } = useSession();
  const [convId, setConvIdState] = useState<number | null>(null); const convRef = useRef<number | null>(null); const busyRef = useRef(false);
  const setConvId = (v: number | null) => { convRef.current = v; setConvIdState(v); };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [typing, setTyping] = useState(false);
  const [history, setHistory] = useState<Conv[] | null>(null); const [showHist, setShowHist] = useState(false);
  const [status, setStatus] = useState<{ available: boolean; vision?: boolean; voice?: boolean } | null>(null);
  const { lang } = useI18n(); const [photo, setPhoto] = useState<File | null>(null); const [photoUrl, setPhotoUrl] = useState('');
  const [rec, setRec] = useState<Recorder | null>(null); const [recSecs, setRecSecs] = useState(0); const [speaking, setSpeaking] = useState<number | null>(null);
  const [hands, setHands] = useState<null | 'listening' | 'thinking' | 'speaking'>(null); const handsRef = useRef(false); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { stopSpeaking(); handsRef.current = false; }, []);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setRecSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [rec]); const [notice, setNotice] = useState('');
  const endRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null);

  const [sp, setSp] = useSearchParams(); const asked = useRef(false);
  useEffect(() => { api('/ai/status').then(setStatus).catch(() => setStatus({ available: false })); }, []);
  // /assistant?q=... (from Search) sends that question straight away.
  useEffect(() => { const q0 = sp.get('q'); if (q0 && !asked.current) { asked.current = true; setSp({}, { replace: true }); send(q0); } }, []); // eslint-disable-line
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, typing]);
  const loadHistory = () => api<{ items: Conv[] }>('/ai/conversations').then((r) => setHistory(r.items)).catch(() => setHistory([]));

  const newChat = () => { if (busy) return; setConvId(null); setMsgs([]); setNotice(''); setShowHist(false); inputRef.current?.focus(); };
  const open = async (id: number) => {
    setShowHist(false); setNotice('');
    try { const c = await api<{ id: number; messages: Msg[] }>(`/ai/conversations/${id}`); setConvId(c.id); setMsgs(c.messages); } catch (e: any) { setNotice(e.message); }
  };

  async function send(raw: string, extra?: { image?: File; audio?: Blob }): Promise<string> {
    const message = raw.trim(); const image = extra?.image || photo || undefined; const audio = extra?.audio;
    if ((!message && !image && !audio) || busyRef.current) return '';
    busyRef.current = true; setText(''); setNotice(''); setBusy(true); setTyping(true); setPhoto(null); setPhotoUrl('');
    const local = image ? URL.createObjectURL(image) : audio ? URL.createObjectURL(audio) : undefined;
    setMsgs((m) => [...m, { role: 'user', content: audio ? '' : message, local, attachment_kind: image ? 'image' : audio ? 'voice' : null, pending: !!audio }]);
    let reply = '';
    const fail = (err: string, upgrade = false) => setMsgs((m) => [...m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content)), { role: 'assistant', content: err, error: true, upgrade }]);
    try {
      let init: RequestInit;
      if (image || audio) {
        const fd = new FormData(); if (convRef.current) fd.append('conversation_id', String(convRef.current)); if (message) fd.append('message', message); fd.append('lang', lang);
        if (image) fd.append('image', await shrinkImage(image), 'photo.jpg'); if (audio) fd.append('audio', audio, `voice.${audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'}`);
        init = { method: 'POST', credentials: 'same-origin', headers: { 'X-Connectly-CSRF': '1' }, body: fd };
      } else init = { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Connectly-CSRF': '1' }, body: JSON.stringify({ ...(convRef.current ? { conversation_id: convRef.current } : {}), message, lang }) };
      const res = await fetch('/api/ai/chat', init);
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); if (d.upgrade) { fail(d.error, true); return ''; } throw new ApiError(res.status, d.error || 'Connectly AI is unavailable right now. Please try again later.'); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let started = false;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.conversation_id) setConvId(ev.conversation_id);
          if (ev.transcript !== undefined) setMsgs((m) => m.map((x, k) => (k === m.map((y) => y.role).lastIndexOf('user') ? { ...x, content: ev.transcript, pending: false } : x)));
          if (ev.t) { reply += ev.t;
            if (!started) { started = true; setTyping(false); setMsgs((m) => [...m, { role: 'assistant', content: ev.t }]); }
            else setMsgs((m) => { const c = m.slice(); c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + ev.t }; return c; });
          }
          if (ev.error) { setTyping(false); fail(ev.error); }
        }
      }
    } catch (e: any) { fail(e instanceof ApiError ? e.message : 'Connection lost. Please check your internet and try again.'); }
    finally { busyRef.current = false; setBusy(false); setTyping(false); setMsgs((m) => m.map((x) => (x.pending ? { ...x, pending: false } : x))); history && loadHistory(); }
    return reply;
  }

  const pickPhoto = (f?: File) => { if (!f) return; if (!f.type.startsWith('image/')) return setNotice('Choose a photo'); setPhoto(f); setPhotoUrl(URL.createObjectURL(f)); inputRef.current?.focus(); };
  const toggleMic = async () => {
    if (rec) { const blob = await rec.stop(); setRec(null); setRecSecs(0); if (blob && blob.size > 800) send(text, { audio: blob }); return; }
    try { stopSpeaking(); const r = await Recorder.start(); setRecSecs(0); setRec(r); } catch { setNotice('Allow microphone access to send a voice question.'); }
  };
  const say = (i: number, content: string) => { if (speaking === i) { stopSpeaking(); setSpeaking(null); return; } setSpeaking(i); speak(content, lang, () => setSpeaking((s) => (s === i ? null : s))); };
  // Hands-free: listen → send when you pause → read the reply aloud → listen again, until you tap Stop.
  const handsLoop = async () => {
    while (handsRef.current) {
      setHands('listening'); let blob: Blob | null = null;
      try { const r = await Recorder.start({ autoStop: true }); blob = await r.done; } catch { setNotice('Allow microphone access to talk with Connectly AI.'); break; }
      if (!handsRef.current) break; if (!blob || blob.size < 1500) continue;
      setHands('thinking'); const reply = await send('', { audio: blob });
      if (!handsRef.current) break; if (!reply) { await new Promise((r) => setTimeout(r, 600)); continue; }
      setHands('speaking'); await new Promise<void>((r) => speak(reply, lang, r));
    }
    handsRef.current = false; setHands(null);
  };
  const startHands = () => { stopSpeaking(); handsRef.current = true; handsLoop(); };
  const stopHands = () => { handsRef.current = false; stopSpeaking(); Recorder.cancelAll(); setHands(null); };

  const first = (me?.full_name || '').split(' ')[0];
  return <div className="aichat">
    <header className="aihead">
      <button className="btn icon ghost" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/me'))}><Icon name="back" /></button>
      <span className="aiorb">✦</span>
      <div className="grow"><b>Connectly AI</b><small className="meta">{status && !status.available ? 'Offline · try again later' : typing ? 'Typing…' : 'Ask me anything'}</small></div>
      {status?.voice && <button className="btn icon ghost" aria-label="Voice conversation" title="Voice conversation" onClick={startHands} disabled={!!hands || status?.available === false}><span className="aihands">🎧</span></button>}
      <button className="btn icon ghost" aria-label="Chat history" onClick={() => { setShowHist((v) => !v); if (!history) loadHistory(); }}><Icon name="clock" /></button>
      <button className="btn icon ghost" aria-label="New chat" onClick={newChat}><Icon name="plus" /></button>
    </header>
    {showHist && <div className="aihist card">
      <div className="row between"><h3>Your chats</h3><button className="linkish" onClick={newChat}>+ New chat</button></div>
      {!history ? <p className="meta">Loading…</p> : !history.length ? <p className="meta">No chats yet.</p> :
        history.map((c) => <button key={c.id} className={`plain aihrow${c.id === convId ? ' on' : ''}`} onClick={() => open(c.id)}><b>{c.title}</b><small className="meta">{c.last}</small></button>)}
    </div>}
    <main className="aibody">
      {!msgs.length && <div className="aiwelcome">
        <span className="aiorb xl">✦</span>
        <h2>Hi{first ? ` ${first}` : ''}, how can I help?</h2>
        <p className="meta">Ask me anything: ideas, captions, translations, homework help, advice, or how to use Connectly. I never share other people’s private info.</p>
        <div className="aisuggest">{SUGGESTED.map((s) => <button key={s} className="chip" disabled={busy || status?.available === false} onClick={() => { send(s.replace(/^\S+\s/, '')); }}>{s}</button>)}</div>
      </div>}
      {msgs.map((m, i) => <div key={m.id ?? `l${i}`} className={`airow ${m.role}`}>
        {m.role === 'assistant' ? <span className="aiorb sm">✦</span> : null}
        {m.upgrade ? <UpgradeNotice text={m.content} /> : <div className={`aibubble${m.error ? ' err' : ''}`}>
          {m.attachment_kind === 'image' && (m.local || m.attachment_path) && <img className="aiimg" src={m.local || m.attachment_path || ''} alt="Your photo" />}
          {m.attachment_kind === 'voice' && (m.local || m.attachment_path) && <audio className="aivoice" controls preload="none" src={m.local || m.attachment_path || ''} />}
          {m.pending ? <span className="meta">Listening to your voice note…</span> : <Rich text={m.content} />}
          {m.role === 'assistant' && !m.error && canSpeak() && m.content && <button type="button" className={`aispeak${speaking === i ? ' on' : ''}`} onClick={() => say(i, m.content)} aria-label={speaking === i ? 'Stop reading' : 'Read aloud'}>{speaking === i ? '■ Stop' : '🔊 Speak'}</button>}
        </div>}
        {m.role === 'user' && me ? <Avatar user={me} size={28} /> : null}
      </div>)}
      {typing && <div className="airow assistant"><span className="aiorb sm">✦</span><div className="aibubble typingdots" aria-label="Connectly AI is typing"><i /><i /><i /></div></div>}
      {notice && <p className="error card">{notice}</p>}
      <div ref={endRef} />
    </main>
    {hands && <div className="aihandsfree" role="dialog" aria-label="Voice conversation"><span className={`aiorb xl pulse ${hands}`}>✦</span>
      <b>{hands === 'listening' ? 'Listening…' : hands === 'thinking' ? 'Thinking…' : 'Speaking…'}</b><p className="meta">{hands === 'listening' ? 'Talk naturally. I’ll answer when you pause.' : 'Tap Stop to end the conversation.'}</p>
      <button className="btn primary" onClick={stopHands}>Stop</button></div>}
    {photoUrl && <div className="aiattach"><img src={photoUrl} alt="Photo to ask about" /><span className="meta grow">Ask anything about this photo</span><button className="btn icon ghost" aria-label="Remove photo" onClick={() => { setPhoto(null); setPhotoUrl(''); }}><Icon name="x" /></button></div>}
    <form className="aiinput" onSubmit={(e) => { e.preventDefault(); send(text); }}>
      {status?.vision && <><button type="button" className="btn icon ghost aitool" aria-label="Add a photo" onClick={() => fileRef.current?.click()} disabled={busy || !!rec}><Icon name="image" /></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} /></>}
      <textarea ref={inputRef} rows={1} value={text} maxLength={2000} placeholder={status?.available === false ? 'Connectly AI is offline right now' : 'Message Connectly AI'} aria-label="Message"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} disabled={status?.available === false} />
      {rec ? <span className="airec" aria-live="polite"><i />{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</span> : null}
      {status?.voice && (rec || (!text.trim() && !photo)) ? <button type="button" className={`btn primary aisend${rec ? ' rec' : ''}`} aria-label={rec ? 'Send voice note' : 'Record a voice question'} onClick={toggleMic} disabled={busy}>{rec ? '➤' : <Icon name="mic" />}</button>
        : <button className="btn primary aisend" aria-label="Send" disabled={busy || (!text.trim() && !photo)}>➤</button>}
    </form>
    <p className="aidisclaimer meta">AI answers can be wrong. For serious issues use ⋯ › Report.</p>
  </div>;
}
