import { StickerPicker, type Pick } from '../components/StickerPacks';
// Direct messages (round 7): inbox, 1:1 and group chats, photos/videos (Standard or HD), voice notes, stickers,
// read receipts, typing, themes/wallpapers, reactions, translate, games and calls.
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, haptic, timeAgo, toast, uploadForm, useFeatures } from '../api';
import { useSession } from '../session';
import { useT } from '../lib/i18n';
import { askPermission } from '../lib/permission';
import { Avatar, Icon, Sheet, Spinner } from '../components/ui';
import { RichText, TranslateButton, VerifiedBadge } from '../components/Extras';
import { scamAsk } from '../lib/scam';
import { GameCard, GamePicker } from '../components/Games';
import { sfx } from '../lib/sounds';

type Member = { active_at?: string | null; id: number; username: string; full_name: string; avatar_path: string | null; verified?: boolean; new_account?: boolean; last_read_id?: number; typing?: boolean };
type Conv = { id: number; is_group: boolean; title: string; members: Member[]; last_message: { id: number; sender_id: number; kind: string; body: string; created_at: string } | null; unread: number; last_message_at: string; is_request?: boolean };
type Msg = { edited_at?: string | null; expires_at?: string | null; filtered?: boolean; id: number; conversation_id: number; sender_id: number; kind: string; body: string; media_path: string | null; poster_path: string | null; media_hd: boolean; meta: any; created_at: string; deleted: boolean; reactions: Record<string, string> };
export const THEMES: { k: string; name: string; bg: string; mine: string }[] = [
  { k: 'default', name: 'Classic', bg: 'var(--bg)', mine: 'var(--primary)' }, { k: 'ocean', name: 'Ocean', bg: 'linear-gradient(160deg,#0ea5e9 0%,#1e3a8a 100%)', mine: '#0284c7' },
  { k: 'sunset', name: 'Sunset', bg: 'linear-gradient(160deg,#fb923c 0%,#db2777 100%)', mine: '#e11d48' }, { k: 'forest', name: 'Forest', bg: 'linear-gradient(160deg,#4ade80 0%,#065f46 100%)', mine: '#047857' },
  { k: 'lavender', name: 'Lavender', bg: 'linear-gradient(160deg,#c4b5fd 0%,#6d28d9 100%)', mine: '#7c3aed' }, { k: 'midnight', name: 'Midnight', bg: 'linear-gradient(160deg,#1e293b 0%,#020617 100%)', mine: '#6366f1' },
  { k: 'rose', name: 'Rose', bg: 'linear-gradient(160deg,#fecdd3 0%,#f472b6 100%)', mine: '#db2777' }, { k: 'mono', name: 'Mono', bg: 'linear-gradient(160deg,#e5e5e5 0%,#737373 100%)', mine: '#262626' },
];
const QUICK = ['❤️', '😂', '😮', '😢', '🔥', '👍'];
const convName = (c: { is_group: boolean; title: string; members: Member[] }, me: number) => c.title || c.members.filter((m) => m.id !== me).map((m) => m.full_name.split(' ')[0]).join(', ') || 'Just you';
const preview = (m: Conv['last_message'], me: number) => !m ? '' : (m.sender_id === me ? 'You: ' : '') + ({ image: 'Photo', video: 'Video', voice: 'Voice note', call: 'Call', game: 'Game', sticker: 'Sticker' } as any)[m.kind] || m.body;

export function Inbox() {
  const { me } = useSession(); const t = useT(); const [items, setItems] = useState<Conv[] | null>(null); const [compose, setCompose] = useState(false); const [q, setQ] = useState('');
  useEffect(() => { const load = () => api<{ items: Conv[] }>('/conversations').then((r) => setItems(r.items)).catch(() => setItems([])); load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);
  const [showReq, setShowReq] = useState(false);
  const all = (items || []).filter((c) => !q || convName(c, me!.id).toLowerCase().includes(q.toLowerCase()));
  const requests = all.filter((c) => c.is_request); const list = showReq ? requests : all.filter((c) => !c.is_request);
  return <div className="stack inbox">
    <div className="row between"><h1 className="pagetitle">{t('chats')}</h1><button className="btn icon ghost" aria-label={t('newMessage')} onClick={() => setCompose(true)}><Icon name="plus" /></button></div>
    <input className="searchpill" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
    {requests.length > 0 && !showReq && <button className="card row reqbanner" onClick={() => setShowReq(true)}><span className="reqicon">✉️</span><span className="grow"><b>Message requests</b><small className="meta">{requests.length === 1 ? '1 person wants to chat' : `${requests.length} people want to chat`}</small></span><Icon name="chev" /></button>}
    {showReq && <div className="row"><button className="btn icon ghost" aria-label="Back" onClick={() => setShowReq(false)}><Icon name="back" /></button><b>Message requests</b></div>}
    {showReq && <p className="meta">People you don’t follow. They won’t see that you’ve read their messages until you accept.</p>}
    {!items ? <Spinner /> : !list.length ? <div className="card empty"><div className="bigemoji">💬</div><p>{t('noMessages')}</p><button className="btn primary" onClick={() => setCompose(true)}>{t('newMessage')}</button></div>
      : <div className="card list convlist">{list.map((c) => { const others = c.members.filter((m) => m.id !== me!.id); const typing = others.some((m) => m.typing);
        return <Link key={c.id} to={`/messages/${c.id}`} className={`row convrow ${c.unread ? 'unread' : ''}`}>
          <span className="convav">{c.is_group && others.length > 1 ? <><Avatar user={others[0]} size={38} /><Avatar user={others[1]} size={38} /></> : <Avatar user={others[0] || me!} size={54} />}{!c.is_group && activeLabel(others[0]?.active_at) === 'Active now' && <span className="onlinedot" aria-label="Online" />}</span>
          <span className="grow"><b className="row nowrap">{convName(c, me!.id)} {!c.is_group && <VerifiedBadge on={others[0]?.verified} size={14} />}</b>
            <small className={typing ? 'typingtxt' : 'meta'}>{typing ? t('typing') : preview(c.last_message, me!.id)}{c.last_message && !typing && ` · ${timeAgo(c.last_message.created_at)}`}</small>{!c.is_group && !typing && activeLabel(others[0]?.active_at) && <small className="activetxt">{activeLabel(others[0]?.active_at)}</small>}</span>
          {c.unread > 0 && <span className="unreaddot" aria-label="Unread" />}</Link>; })}</div>}
    {compose && <NewChat onClose={() => setCompose(false)} />}
  </div>;
}

function NewChat({ onClose }: { onClose: () => void }) {
  const t = useT(); const nav = useNavigate(); const [q, setQ] = useState(''); const [res, setRes] = useState<Member[]>([]); const [picked, setPicked] = useState<Member[]>([]); const [title, setTitle] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (!q.trim()) { setRes([]); return; } const h = setTimeout(() => api<{ items: Member[] }>(`/search?type=people&q=${encodeURIComponent(q)}`).then((r) => setRes(r.items)).catch(() => {}), 250); return () => clearTimeout(h); }, [q]);
  const start = async () => { try { const r = await api<{ id: number }>('/conversations', { json: { usernames: picked.map((p) => p.username), ...(picked.length > 1 ? { title: title.trim() || picked.map((p) => p.full_name.split(' ')[0]).join(', ') } : {}) } }); onClose(); nav(`/messages/${r.id}`); } catch (e: any) { setErr(e.message); } };
  return <Sheet title={t('newMessage')} onClose={onClose}><div className="stack">
    {picked.length > 0 && <div className="row wrap">{picked.map((p) => <button key={p.id} className="chip on" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.full_name} ✕</button>)}</div>}
    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPeople')} aria-label={t('searchPeople')} />
    {picked.length > 1 && <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Group name (optional)" aria-label="Group name" />}
    <div className="list">{res.filter((r) => !picked.some((p) => p.id === r.id)).map((u) => <button key={u.id} className="row optrow" onClick={() => { setPicked([...picked, u]); setQ(''); }}><Avatar user={u} size={40} /><span className="grow"><b>{u.full_name}</b><small className="meta">@{u.username}</small></span></button>)}</div>
    {err && <p className="error">{err}</p>}
    <button className="btn primary block" disabled={!picked.length} onClick={start}>{picked.length > 1 ? 'Create group' : 'Chat'}</button></div></Sheet>;
}

export function Chat() {
  const ffScam = useFeatures(); const { id } = useParams(); const cid = Number(id); const { me } = useSession(); const t = useT(); const nav = useNavigate(); const f = useFeatures();
  const [isReq, setIsReq] = useState(false);
  const [dis, setDis] = useState<number | null>(null); const [presence, setPresence] = useState<{ online?: boolean; last_seen?: string | null; hidden?: boolean } | null>(null); const [, tickNow] = useState(0);
  useEffect(() => { const i = setInterval(() => tickNow((x) => x + 1), 15000); return () => clearInterval(i); }, []);
  // Screenshot notice: the web can only notice the Print Screen key on computers; phones don't tell websites about screenshots.
  useEffect(() => { if (!f?.disappearing) return; const k = (e: KeyboardEvent) => { if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key))) api(`/conversations/${cid}/screenshot`, { method: 'POST' }).catch(() => {}); }; window.addEventListener('keyup', k); return () => window.removeEventListener('keyup', k); }, [cid, f?.disappearing]);
  const [conv, setConv] = useState<any>(null); const [msgs, setMsgs] = useState<Msg[]>([]); const [reads, setReads] = useState<Record<string, number>>({}); const [typing, setTyping] = useState<number[]>([]);
  const [text, setText] = useState(''); const [hd, setHd] = useState(false); const [busy, setBusy] = useState(0); const [sheet, setSheet] = useState<'' | 'theme' | 'stickers' | 'games' | 'info'>(''); const [react, setReact] = useState<Msg | null>(null);
  const [rec, setRec] = useState<{ r: MediaRecorder; start: number; chunks: Blob[] } | null>(null); const [recT, setRecT] = useState(0);
  const end = useRef<HTMLDivElement>(null); const lastId = useRef(0); const typingSent = useRef(0); const fileIn = useRef<HTMLInputElement>(null);
  const loadConv = useCallback(() => api(`/conversations/${cid}`).then(setConv).catch(() => nav('/messages')), [cid, nav]);
  useEffect(() => { loadConv(); }, [loadConv]);
  useEffect(() => {
    let stop = false; lastId.current = 0; setMsgs([]);
    const poll = async () => {
      try { const r = await api<{ items: Msg[]; reads: Record<string, number>; typing: number[]; is_request?: boolean; disappear_seconds?: number | null }>(`/conversations/${cid}/messages${lastId.current ? `?after=${lastId.current}` : ''}`);
        if (stop) return; setDis(r.disappear_seconds ?? null); setReads(r.reads); setTyping(r.typing); setIsReq(!!r.is_request);
        if (lastId.current && r.items.some((x) => x.sender_id !== me?.id)) sfx('received');
        if (r.items.length) { lastId.current = r.items[r.items.length - 1].id; setMsgs((m) => { const ids = new Set(r.items.map((x) => x.id)); return [...m.filter((x) => !ids.has(x.id)), ...r.items]; }); api(`/conversations/${cid}/read`, { json: { last_id: lastId.current } }).catch(() => {}); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 30); }
      } catch { /* retry next tick */ }
    };
    poll(); const i = setInterval(poll, 2000); const j = setInterval(() => { if (lastId.current) api<{ items: Msg[] }>(`/conversations/${cid}/messages`).then((r) => setMsgs((m) => m.map((x) => r.items.find((y) => y.id === x.id) || x))).catch(() => {}); }, 8000);
    return () => { stop = true; clearInterval(i); clearInterval(j); };
  }, [cid]);
  const add = (m: Msg) => { setMsgs((x) => [...x.filter((y) => y.id !== m.id), m]); lastId.current = Math.max(lastId.current, m.id); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 30); };
  const send = async (e?: FormEvent) => { e?.preventDefault(); const b = text.trim(); if (!b) return; setText(''); haptic();
    if (editing) { const m = editing; setEditing(null); try { const r = await api<{ body: string; edited_at: string }>(`/messages/${m.id}`, { method: 'PATCH', json: { body: b } }); setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, ...r } : y))); } catch (x: any) { toast(x.message, 'err'); } return; }
    try { const fd = new FormData(); fd.append('body', b); sfx('sent'); add(await uploadForm<Msg>(`/conversations/${cid}/messages`, fd)); } catch (x: any) { setText(b); toast(x.message, 'err'); } };
  const sendFile = async (file: File) => { const fd = new FormData(); fd.append('file', file); fd.append('hd', hd ? '1' : '0'); setBusy(1);
    try { add(await uploadForm<Msg>(`/conversations/${cid}/messages`, fd, (p) => setBusy(Math.max(1, p)))); } catch (x: any) { toast(x.message, 'err'); } finally { setBusy(0); if (fileIn.current) fileIn.current.value = ''; } };
  const sticker = async (s: Pick) => { setSheet(''); const fd = new FormData(); if (s.id) fd.append('sticker_id', String(s.id)); else fd.append('sticker', s.key || ''); try { add(await uploadForm<Msg>(`/conversations/${cid}/messages`, fd)); } catch (x: any) { toast(x.message, 'err'); } };
  const onType = (v: string) => { setText(v); if (Date.now() - typingSent.current > 3000 && v) { typingSent.current = Date.now(); api(`/conversations/${cid}/typing`, { json: { typing: true } }).catch(() => {}); } };
  const startRec = async () => {
    if (!(await askPermission('microphone'))) return;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((x) => (window as any).MediaRecorder?.isTypeSupported?.(x)) || '';
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined); const st = { r, start: Date.now(), chunks: [] as Blob[] }; r.ondataavailable = (ev) => st.chunks.push(ev.data); r.start(250); setRec(st); haptic(12);
    } catch { toast('Couldn’t use the microphone', 'err'); }
  };
  useEffect(() => { if (!rec) return; const i = setInterval(() => setRecT(Math.floor((Date.now() - rec.start) / 1000)), 250); return () => clearInterval(i); }, [rec]);
  const stopRec = (keep: boolean) => { if (!rec) return; const r = rec.r; const dur = (Date.now() - rec.start) / 1000; r.onstop = async () => { r.stream.getTracks().forEach((x) => x.stop()); if (!keep || dur < 0.7) return; const blob = new Blob(rec.chunks, { type: r.mimeType || 'audio/webm' });
      const fd = new FormData(); fd.append('voice', '1'); fd.append('duration', String(Math.round(dur))); fd.append('file', blob, `voice.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
      try { add(await uploadForm<Msg>(`/conversations/${cid}/messages`, fd)); } catch (x: any) { toast(x.message, 'err'); } }; r.stop(); setRec(null); setRecT(0); };
  const doReact = async (m: Msg, e: string) => { setReact(null); haptic(); setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, reactions: { ...y.reactions, [me!.id]: e } } : y))); api(`/messages/${m.id}/reaction`, { method: 'PUT', json: { emoji: e } }).catch((x) => toast(x.message, 'err')); };
  const [editing, setEditing] = useState<Msg | null>(null);
  const canEdit = (m: Msg) => !!f?.msg_controls && m.sender_id === me?.id && m.kind === 'text' && Date.now() - new Date(m.created_at).getTime() < 15 * 60000;
  const hideForMe = async (m: Msg) => { setReact(null); try { await api(`/messages/${m.id}/hide`, { method: 'POST' }); setMsgs((x) => x.filter((y) => y.id !== m.id)); } catch (x: any) { toast(x.message, 'err'); } };
  const unsend = async (m: Msg) => { setReact(null); try { await api(`/messages/${m.id}`, { method: 'DELETE' }); setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, deleted: true, body: '', media_path: null } : y))); } catch (x: any) { toast(x.message, 'err'); } };
  const answerReq = async (action: 'accept' | 'delete' | 'block') => { if (action === 'block' && !confirm('Block this person? They won’t be able to message you.')) return; try { await api(`/conversations/${cid}/request`, { json: { action } }); if (action === 'accept') { setIsReq(false); toast('Request accepted'); } else { toast(action === 'block' ? 'Blocked' : 'Request deleted'); nav('/messages'); } } catch (x: any) { toast(x.message, 'err'); } };
  const call = (video: boolean) => nav(`/call/${cid}?video=${video ? 1 : 0}`);
  if (!conv || !me) return <div className="splash"><Spinner /></div>;
  if (!presence && !conv.is_group) { const o = conv.members.find((m: Member) => m.id !== me.id); if (o) { setPresence({ hidden: true }); api<any>(`/users/${o.username}/presence`).then(setPresence).catch(() => {}); } }
  const theme = THEMES.find((x) => x.k === conv.theme) || THEMES[0]; const ffs = ffScam; const others: Member[] = conv.members.filter((m: Member) => m.id !== me.id);
  const lastMine = [...msgs].reverse().find((m) => m.sender_id === me.id);
  const seenBy = lastMine ? others.filter((o) => (reads[o.id] || 0) >= lastMine.id) : [];
  const bg = conv.wallpaper_path ? `center/cover url(${conv.wallpaper_path})` : theme.bg;
  return <div className={`chatpage ${conv.wallpaper_path || theme.k !== 'default' ? 'themed' : ''}`} style={{ ['--chatbg' as any]: bg, ['--mine' as any]: theme.mine }}>
    <header className="chathead"><button className="btn icon ghost" aria-label="Back" onClick={() => nav('/messages')}><Icon name="back" /></button>
      <button className="row grow chatwho" onClick={() => setSheet('info')}>{others[0] ? <Avatar user={others[0]} size={36} /> : <Avatar user={me} size={36} />}
        <span className="grow"><b className="row nowrap">{convName(conv, me.id)} {!conv.is_group && <VerifiedBadge on={others[0]?.verified} size={14} />}</b><small className="meta">{typing.length ? t('typing') : conv.is_group ? `${conv.members.length} members` : presence?.online ? <><span className="presencedot" />Active now</> : presence?.last_seen ? `Active ${timeAgo(presence.last_seen)}` : `@${others[0]?.username || ''}`}{dis ? ' · ⏱' : ''}</small></span></button>
      {f?.calls && <><button className="btn icon ghost" aria-label="Voice call" onClick={() => call(false)}>📞</button><button className="btn icon ghost" aria-label="Video call" onClick={() => call(true)}>🎥</button></>}
      <button className="btn icon ghost" aria-label="Chat theme" onClick={() => setSheet('theme')}>🎨</button></header>
    <div className="chatscroll">
      {ffs?.msg_encryption && <p className="encnote">🔒 Messages and media in this chat are encrypted when stored on our servers.</p>}
      {ffs?.anti_scam && others.some((o) => o.new_account && !o.verified) && msgs.some((m) => m.sender_id !== me.id && m.body && scamAsk(m.body)) && <div className="scambanner" role="alert"><b>⚠️ Possible scam</b><span>This is a new account asking about money, codes, passwords, crypto or investments. Never send money or share codes or bank details with people you haven’t met. Connectly will never ask for your login code.</span></div>}
      {!msgs.length && <p className="meta center chatempty">{t('noMessages')}</p>}
      {msgs.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > Date.now()).map((m, i) => { const mine = m.sender_id === me.id; const sender = conv.members.find((x: Member) => x.id === m.sender_id); const prev = msgs[i - 1]; const gap = !prev || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 15 * 60e3;
        const rs = Object.values(m.reactions || {});
        return <div key={m.id}>{gap && <div className="chattime">{new Date(m.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
          <div className={`msgrow ${mine ? 'mine' : ''}`}>{!mine && conv.is_group && (!prev || prev.sender_id !== m.sender_id) && sender && <Avatar user={sender} size={26} />}
            <div className="msgwrap" onContextMenu={(e) => { e.preventDefault(); if (!m.deleted) setReact(m); }} onDoubleClick={() => !m.deleted && doReact(m, '❤️')}>
              {!mine && conv.is_group && (!prev || prev.sender_id !== m.sender_id) && <small className="msgname">{sender?.full_name.split(' ')[0]}</small>}
              <MessageBody m={m} mine={mine} cid={cid} onMenu={() => setReact(m)} />
              {m.edited_at && !m.deleted && <small className="editedtag">Edited</small>}
              {rs.length > 0 && <span className="msgreacts">{[...new Set(rs)].slice(0, 3).map((e) => e.startsWith(':') ? '✨' : e)}{rs.length > 1 && <small>{rs.length}</small>}</span>}
            </div></div></div>; })}
      {lastMine && seenBy.length > 0 && <div className="seen">{conv.is_group ? seenBy.map((s) => <Avatar key={s.id} user={s} size={14} />) : t('seen')}</div>}
      {typing.length > 0 && <div className="msgrow"><div className="bubble typingdots"><i /><i /><i /></div></div>}
      <div ref={end} />
    </div>
    {isReq && <div className="reqbar"><p><b>{convName(conv, me.id)}</b> wants to send you messages. They won’t know you’ve seen them until you accept.</p><div className="row"><button className="btn ghost grow" onClick={() => answerReq('block')}>Block</button><button className="btn ghost grow" onClick={() => answerReq('delete')}>Delete</button><button className="btn primary grow" onClick={() => answerReq('accept')}>Accept</button></div></div>}
    {busy > 0 && <div className="chatupload"><div className="progress"><div style={{ width: `${busy}%` }} /></div><small className="meta">{hd ? 'Sending in HD…' : 'Sending…'}</small></div>}
    {rec ? <div className="composerbar recbar"><button className="btn icon ghost" aria-label="Cancel" onClick={() => stopRec(false)}><Icon name="trash" /></button><span className="recdot" /><span className="grow">{Math.floor(recT / 60)}:{String(recT % 60).padStart(2, '0')}</span><button className="btn primary" onClick={() => stopRec(true)}>{t('send')}</button></div>
      : <form className="composerbar" onSubmit={send}>
        {editing && <div className="editbar"><span>Editing message</span><button type="button" className="btn ghost sm" onClick={() => { setEditing(null); setText(''); }}>Cancel</button></div>}
        <button type="button" className="btn icon ghost" aria-label="Photo or video" onClick={() => fileIn.current?.click()}><Icon name="image" /></button>
        <button type="button" className={`hdtoggle ${hd ? 'on' : ''}`} aria-pressed={hd} title={hd ? 'HD: original quality' : 'Standard quality'} onClick={() => { setHd(!hd); toast(hd ? 'Standard quality' : 'HD on: photos and videos send at original quality'); }}>HD</button>
        <input ref={fileIn} type="file" hidden accept="image/*,video/mp4,video/quicktime,video/webm,video/3gpp" onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />
        <input className="grow chatinput" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('messagePh')} aria-label={t('messagePh')} maxLength={5000} />
        {f?.stickers && <button type="button" className="btn icon ghost" aria-label="Stickers" onClick={() => setSheet('stickers')}>😊</button>}
        {f?.games && <button type="button" className="btn icon ghost" aria-label="Games" onClick={() => setSheet('games')}>🎮</button>}
        {text.trim() ? <button className="btn primary sendbtn" aria-label={t('send')}>➤</button> : <button type="button" className="btn icon ghost" aria-label="Record voice note" onClick={startRec}>🎙️</button>}
      </form>}
    {react && <div className="sheetwrap" onClick={() => setReact(null)}><div className="reactpop" onClick={(e) => e.stopPropagation()}>
      <div className="row reactrow">{QUICK.map((e) => <button key={e} onClick={() => doReact(react, e)}>{e}</button>)}<EmojiMore onPick={(e) => doReact(react, e)} /></div>
      <div className="list">{react.body && <button className="optrow" onClick={() => { navigator.clipboard?.writeText(react.body); setReact(null); toast('Copied'); }}>Copy</button>}
        {canEdit(react) && <button className="optrow" onClick={() => { setEditing(react); setText(react.body); setReact(null); }}>Edit</button>}
        {f?.msg_controls && <button className="optrow danger" onClick={() => hideForMe(react)}>Delete for me</button>}
        {react.sender_id === me.id && <button className="optrow danger" onClick={() => unsend(react)}>{f?.msg_controls ? 'Unsend for everyone' : 'Unsend'}</button>}</div></div></div>}
    {sheet === 'theme' && <ThemeSheet conv={conv} onClose={() => setSheet('')} onSaved={loadConv} />}
    {sheet === 'stickers' && <StickerPicker onPick={sticker} onClose={() => setSheet('')} />}
    {sheet === 'games' && <GamePicker cid={cid} onClose={() => setSheet('')} onStarted={(m) => { setSheet(''); add(m); }} />}
    {sheet === 'info' && <Sheet title={convName(conv, me.id)} onClose={() => setSheet('')}><div className="list">{conv.members.map((m: Member) => <Link key={m.id} to={`/u/${m.username}`} className="row optrow"><Avatar user={m} size={36} /><span className="grow"><b>{m.full_name}</b> <VerifiedBadge on={m.verified} size={13} /><small className="meta">@{m.username}</small></span></Link>)}
      {f?.disappearing && <div className="stack pad"><b>Disappearing messages</b><div className="segmented">{([[null, 'Off'], [3600, '1 hour'], [86400, '24 hours'], [604800, '7 days']] as const).map(([v, l]) => <button key={l} className={dis === v ? 'on' : ''} onClick={async () => { await api(`/conversations/${cid}/disappear`, { method: 'PUT', json: { seconds: v } }); setDis(v); toast(v ? `New messages disappear after ${l}` : 'Disappearing messages off'); }}>{l}</button>)}</div><small className="meta">New messages vanish after the time you pick. We post a notice if a screenshot is detected, but most phones and browsers don’t let websites detect screenshots, so don’t rely on it.</small></div>}
      {conv.is_group && <button className="optrow danger" onClick={async () => { if (!confirm('Leave this group?')) return; await api(`/conversations/${cid}/leave`, { method: 'POST' }); nav('/messages'); }}>Leave group</button>}</div></Sheet>}
  </div>;
}

function EmojiMore({ onPick }: { onPick: (e: string) => void }) {
  const [open, setOpen] = useState(false); const [custom, setCustom] = useState<{ code: string; image_path: string }[]>([]);
  useEffect(() => { if (open) api<{ custom_emoji: any[] }>('/stickers').then((r) => setCustom(r.custom_emoji)).catch(() => {}); }, [open]);
  const more = ['😍', '🥹', '🙏', '👏', '🎉', '💯', '😡', '🤔', '😎', '🥳', '💔', '✨', '🤣', '😭', '🫶', '👀'];
  return <>{!open ? <button aria-label="More reactions" onClick={() => setOpen(true)}>＋</button> : <div className="emojigrid">{more.map((e) => <button key={e} onClick={() => onPick(e)}>{e}</button>)}{custom.map((c) => <button key={c.code} onClick={() => onPick(`:${c.code}:`)} title={c.code}><img src={c.image_path} alt={c.code} width={24} height={24} /></button>)}</div>}</>;
}

function MessageBody({ m, mine, cid, onMenu }: { m: Msg; mine: boolean; cid: number; onMenu: () => void }) {
  const [tr, setTr] = useState<string | null>(null); const [full, setFull] = useState(false); void onMenu;
  if (m.kind === 'notice') return <div className="noticemsg">{mine ? 'You' : 'They'} {m.body}</div>;
  if (m.deleted) return <div className="bubble deleted">Message unsent</div>;
  if (m.filtered && !full) return <div className="bubble filteredmsg" role="button" onClick={() => setFull(true)}>Hidden by your word filter · Tap to see</div>;
  if (m.kind === 'sticker') return <img className="stickermsg" src={m.meta?.url || `/stickers/${m.meta?.sticker}.svg`} alt="Sticker" />;
  if (m.kind === 'game') return <GameCard gameId={m.meta?.game_id} />;
  if (m.kind === 'call') return <div className="bubble callmsg">{m.meta?.video ? '🎥' : '📞'} {mine ? 'You started a call' : 'Started a call'} · <Link to={`/call/${cid}?video=${m.meta?.video ? 1 : 0}&join=1`}>Join</Link></div>;
  if (m.kind === 'voice') return <div className="bubble voicemsg"><audio controls preload="none" src={m.media_path || ''} />{m.meta?.duration ? <small>{Math.floor(m.meta.duration / 60)}:{String(m.meta.duration % 60).padStart(2, '0')}</small> : null}</div>;
  if (m.kind === 'image' || m.kind === 'video') return <div className="mediamsg">
    {m.kind === 'image' ? <img src={m.media_path!} alt="Photo" loading="lazy" onClick={() => setFull(true)} /> : <video src={m.media_path!} poster={m.poster_path || undefined} controls playsInline preload="metadata" />}
    {m.media_hd && <span className="hdbadge">HD</span>}{m.body && <div className="bubble">{m.body}</div>}
    {full && <div className="lightbox" onClick={() => setFull(false)}><img src={m.media_path!} alt="Photo" />{m.media_hd && <span className="hdbadge">HD</span>}</div>}</div>;
  return <div className="bubble"><span><RichText text={tr ?? m.body} tags={false} /></span>{!mine && <div><TranslateButton text={m.body} onText={setTr} /></div>}</div>;
}

function ThemeSheet({ conv, onClose, onSaved }: { conv: any; onClose: () => void; onSaved: () => void }) {
  const [scope, setScope] = useState<'chat' | 'all'>('chat'); const fileIn = useRef<HTMLInputElement>(null);
  const pick = async (k: string | null) => { try { await api(`/conversations/${conv.id}/theme`, { method: 'PUT', json: { theme: k, scope, clear_wallpaper: true } }); toast(scope === 'all' ? 'Theme set for all chats' : 'Theme updated'); onSaved(); onClose(); } catch (e: any) { toast(e.message, 'err'); } };
  const photo = async (f: File) => { const fd = new FormData(); fd.append('image', f); fd.append('scope', scope); try { await uploadForm(`/conversations/${conv.id}/wallpaper`, fd); toast('Wallpaper updated'); onSaved(); onClose(); } catch (e: any) { toast(e.message, 'err'); } };
  return <Sheet title="Chat theme" onClose={onClose}><div className="stack">
    <div className="seg"><button className={scope === 'chat' ? 'on' : ''} onClick={() => setScope('chat')}>This chat</button><button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All chats</button></div>
    <div className="themegrid">{THEMES.map((th) => <button key={th.k} className={`themetile ${conv.theme === th.k && !conv.wallpaper_path ? 'on' : ''}`} onClick={() => pick(th.k)}><span style={{ background: th.bg }}><i style={{ background: th.mine }} /><i /></span>{th.name}</button>)}
      <button className="themetile" onClick={() => fileIn.current?.click()}><span className="photoTile">🖼️</span>Your photo</button></div>
    <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && photo(e.target.files[0])} />
    {scope === 'chat' && (conv.chat_theme?.theme || conv.chat_theme?.wallpaper_path) && <button className="btn ghost block" onClick={() => pick(null)}>Use my all-chats theme here</button>}
  </div></Sheet>;
}

export function StickerSheet({ onPick, onClose }: { onPick: (k: string) => void; onClose: () => void }) {
  const [s, setS] = useState<{ key: string; url: string }[]>([]);
  useEffect(() => { api<{ stickers: any[] }>('/stickers').then((r) => setS(r.stickers)).catch(() => {}); }, []);
  return <Sheet title="Stickers" onClose={onClose}><div className="stickergrid">{s.map((x) => <button key={x.key} onClick={() => onPick(x.key)} aria-label={x.key}><img src={x.url} alt="" /></button>)}</div></Sheet>;
}

function activeLabel(at?: string | null) { if (!at) return ''; const m = Math.floor((Date.now() - new Date(at).getTime()) / 60000); if (m < 3) return 'Active now'; if (m < 60) return `Active ${m}m ago`; if (m < 1440) return `Active ${Math.floor(m / 60)}h ago`; return ''; }
