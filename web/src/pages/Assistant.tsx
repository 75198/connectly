// Connectly AI: live AI support chat (round 6). Talks only to our server (/api/ai/*);
// replies stream in as NDJSON lines: {conversation_id} → {t: "..."}* → {done} | {error}.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from '../components/ui';
import { UpgradeNotice } from './Plans';

type Msg = { id?: number; role: 'user' | 'assistant'; content: string; error?: boolean; upgrade?: boolean };
type Conv = { id: number; title: string; updated_at: string; last: string | null };
const SUGGESTED = ['✍️ Write a caption for my beach photo', '💡 Weekend ideas in Lagos', '🌍 Translate “good morning” to Yoruba', '📚 Explain photosynthesis simply', '🎬 How do I go live?', '🔒 How do I make my posts private?'];

// Tiny safe formatter: **bold** and line breaks, no HTML injection.
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

export function Assistant() {
  const nav = useNavigate(); const { me } = useSession();
  const [convId, setConvId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [typing, setTyping] = useState(false);
  const [history, setHistory] = useState<Conv[] | null>(null); const [showHist, setShowHist] = useState(false);
  const [status, setStatus] = useState<{ available: boolean } | null>(null); const [notice, setNotice] = useState('');
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

  async function send(raw: string) {
    const message = raw.trim(); if (!message || busy) return;
    setText(''); setNotice(''); setBusy(true); setTyping(true);
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    const fail = (err: string, upgrade = false) => setMsgs((m) => [...m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content)), { role: 'assistant', content: err, error: true, upgrade }]);
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Connectly-CSRF': '1' }, body: JSON.stringify(convId ? { conversation_id: convId, message } : { message }) });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); if (d.upgrade) { fail(d.error, true); return; } throw new ApiError(res.status, d.error || 'Connectly AI is unavailable right now. Please try again later.'); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let started = false;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.conversation_id) setConvId(ev.conversation_id);
          if (ev.t) {
            if (!started) { started = true; setTyping(false); setMsgs((m) => [...m, { role: 'assistant', content: ev.t }]); }
            else setMsgs((m) => { const c = m.slice(); c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + ev.t }; return c; });
          }
          if (ev.error) { setTyping(false); fail(ev.error); }
        }
      }
    } catch (e: any) { fail(e instanceof ApiError ? e.message : 'Connection lost. Please check your internet and try again.'); }
    finally { setBusy(false); setTyping(false); history && loadHistory(); }
  }

  const first = (me?.full_name || '').split(' ')[0];
  return <div className="aichat">
    <header className="aihead">
      <button className="btn icon ghost" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/me'))}><Icon name="back" /></button>
      <span className="aiorb">✦</span>
      <div className="grow"><b>Connectly AI</b><small className="meta">{status && !status.available ? 'Offline · try again later' : typing ? 'Typing…' : 'Ask me anything'}</small></div>
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
        <div className="aisuggest">{SUGGESTED.map((s) => <button key={s} className="chip" disabled={busy || status?.available === false} onClick={() => send(s.replace(/^\S+\s/, ''))}>{s}</button>)}</div>
      </div>}
      {msgs.map((m, i) => <div key={m.id ?? `l${i}`} className={`airow ${m.role}`}>
        {m.role === 'assistant' ? <span className="aiorb sm">✦</span> : null}
        {m.upgrade ? <UpgradeNotice text={m.content} /> : <div className={`aibubble${m.error ? ' err' : ''}`}><Rich text={m.content} /></div>}
        {m.role === 'user' && me ? <Avatar user={me} size={28} /> : null}
      </div>)}
      {typing && <div className="airow assistant"><span className="aiorb sm">✦</span><div className="aibubble typingdots" aria-label="Connectly AI is typing"><i /><i /><i /></div></div>}
      {notice && <p className="error card">{notice}</p>}
      <div ref={endRef} />
    </main>
    <form className="aiinput" onSubmit={(e) => { e.preventDefault(); send(text); }}>
      <textarea ref={inputRef} rows={1} value={text} maxLength={2000} placeholder={status?.available === false ? 'Connectly AI is offline right now' : 'Message Connectly AI'} aria-label="Message"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} disabled={status?.available === false} />
      <button className="btn primary aisend" aria-label="Send" disabled={busy || !text.trim()}>➤</button>
    </form>
    <p className="aidisclaimer meta">AI answers can be wrong. For serious issues use ⋯ › Report.</p>
  </div>;
}
