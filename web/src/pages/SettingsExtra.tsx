// Settings added in round 7/8: language, sounds, two-step login, push, verified badge, close friends, messaging, likes.
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, deviceName, timeAgo, toast, useFeatures } from '../api';
import { useSession } from '../session';
import { LANGS, useI18n } from '../lib/i18n';
import { setSoundsOn, sfx, soundsOn } from '../lib/sounds';
import { currentPush, disablePush, enablePush, pushSupported } from '../lib/push';
import { Avatar, Icon, Spinner } from '../components/ui';
import { VerifiedBadge } from '../components/Extras';

const Back = ({ title }: { title: string }) => <div className="row"><Link to="/settings" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">{title}</h1></div>;
export const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;

export function LanguageSection() {
  const { lang, auto, setLang } = useI18n();
  const save = (code: string | null) => { setLang(code); api('/me/prefs', { method: 'PATCH', json: { locale: code } }).catch(() => {}); };
  return <div className="stack"><Back title="Language" /><div className="card list langlist">
    <button className={`optrow ${auto ? 'on' : ''}`} onClick={() => save(null)}><span className="grow"><b>Automatic</b><small className="meta">Use my device language</small></span>{auto && '✓'}</button>
    {LANGS.map((l) => <button key={l.code} className={`optrow ${!auto && lang === l.code ? 'on' : ''}`} onClick={() => save(l.code)} lang={l.code} dir={l.code === 'ar' ? 'rtl' : 'ltr'}><span className="grow"><b>{l.native}</b><small className="meta">{l.name}</small></span>{!auto && lang === l.code && '✓'}</button>)}</div></div>;
}

export function SoundsSection() {
  const [on, setOn] = useState(soundsOn());
  return <div className="stack"><Back title="Sounds and haptics" /><div className="card row between"><span className="grow"><b>Interaction sounds</b><small className="meta block">Soft sounds for likes, messages, posting and gifts. Your phone’s silent mode mutes them where the browser allows.</small></span>
    <Toggle label="Interaction sounds" on={on} onChange={(v) => { setSoundsOn(v); setOn(v); if (v) sfx('notify'); }} /></div>
    <p className="meta">Light vibrations play on phones that support them.</p></div>;
}

export function SecuritySection() {
  const f = useFeatures(); const [s, setS] = useState<any>(null); const [setup, setSetup] = useState<any>(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const load = () => api('/me/two-step').then(setS).catch((e) => setErr(e.message)); useEffect(() => { if (f?.two_step) load(); }, [f?.two_step]);
  if (f && !f.two_step) return <div className="stack"><Back title="Two-step login" /><p className="card empty">Coming soon.</p></div>;
  if (!s) return <Spinner />;
  const begin = async () => { setErr(''); try { setSetup(await api('/me/two-step/totp/setup', { method: 'POST' })); } catch (e: any) { setErr(e.message); } };
  const confirmCode = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api('/me/two-step/totp/enable', { json: { code } }); setSetup(null); setCode(''); toast('Authenticator app is on'); load(); } catch (x: any) { setErr(x.message); } };
  const off = async (kind: 'totp' | 'email') => { const password = prompt('Enter your password to turn this off'); if (!password) return; try { if (kind === 'totp') await api('/me/two-step/totp/disable', { json: { password } }); else await api('/me/two-step/email', { method: 'PUT', json: { enabled: false, password } }); toast('Turned off'); load(); } catch (e: any) { toast(e.message, 'err'); } };
  return <div className="stack"><Back title="Two-step login" />
    <p className="meta">After your password, we’ll ask for a code too, so nobody else can log in with just your password.</p>
    <div className="card stack"><div className="row between"><span className="grow"><b>Authenticator app</b><small className="meta block">Google Authenticator, Microsoft Authenticator, 1Password and similar apps.</small></span>{s.totp ? <button className="btn ghost" onClick={() => off('totp')}>Turn off</button> : !setup && <button className="btn primary" onClick={begin}>Set up</button>}</div>
      {setup && <form className="stack center" onSubmit={confirmCode}><img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="qr" /><small className="meta">Scan this with your app, or enter the key: <code className="totpkey">{setup.secret.match(/.{1,4}/g).join(' ')}</code></small>
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" aria-label="6-digit code" /><button className="btn primary" disabled={code.length !== 6}>Turn on</button></form>}</div>
    <div className="card row between"><span className="grow"><b>Email code</b><small className="meta block">{s.has_email ? 'We’ll email you a code when you log in.' : 'Add an email address first.'}</small></span>{s.email ? <button className="btn ghost" onClick={() => off('email')}>Turn off</button> : <button className="btn primary" disabled={!s.has_email} onClick={async () => { try { await api('/me/two-step/email', { method: 'PUT', json: { enabled: true } }); toast('Email codes are on'); load(); } catch (e: any) { toast(e.message, 'err'); } }}>Turn on</button>}</div>
    {s.login_alerts && <div className="card"><b>New-device alerts are on</b><p className="meta">We email you when your account logs in from a device we haven’t seen before.</p>
      <div className="list">{s.devices.map((d: any, i: number) => <div key={i} className="row between"><span>{d.label}</span><small className="meta">{timeAgo(d.last_seen)}</small></div>)}</div></div>}
    {err && <p className="error">{err}</p>}<Link to="/settings/sessions" className="card row"><Icon name="globe" /><span className="grow">Where you’re logged in</span><Icon name="chev" /></Link>{void deviceName}</div>;
}

export function PushSection() {
  const f = useFeatures(); const [on, setOn] = useState<boolean | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { currentPush().then((s) => setOn(!!s)).catch(() => setOn(false)); }, []);
  const toggle = async (v: boolean) => { setBusy(true); try { if (v) { const ok = await enablePush(); setOn(ok); if (ok) { toast('Notifications are on'); api('/push/test', { method: 'POST' }).catch(() => {}); } } else { await disablePush(); setOn(false); toast('Notifications are off on this device'); } } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); } };
  if (f && !f.push) return null;
  return <div className="card row between"><span className="grow"><b>Push notifications on this device</b><small className="meta block">{pushSupported() ? 'Messages, replies, reminders and new logins, even when Connectly is closed.' : 'On iPhone, add Connectly to your Home Screen to get notifications.'}</small></span>{on === null ? <Spinner /> : <Toggle label="Push notifications" on={on} onChange={(v) => !busy && toggle(v)} />}</div>;
}

export function VerifySection() {
  const { me } = useSession(); const [s, setS] = useState<any>(null); const [cat, setCat] = useState('Creator'); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const load = () => api('/me/verification').then(setS).catch((e) => setErr(e.message)); useEffect(() => { load(); }, []);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api('/me/verification', { json: { category: cat, reason } }); toast('Request sent'); load(); } catch (x: any) { setErr(x.message); } };
  if (!s) return <Spinner />;
  return <div className="stack"><Back title="Request verification" /><div className="card verifyhero"><Avatar user={me!} size={64} /><b>{me!.full_name} <VerifiedBadge on size={18} /></b><small className="meta">A verified badge shows people this is the authentic account of a notable person, creator or brand.</small></div>
    {s.verified ? <p className="card success center">You’re verified ✓</p> : s.request?.status === 'pending' ? <p className="card center">Your request is being reviewed. We’ll notify you.</p> :
      <form className="card stack" onSubmit={submit}>{s.request?.status === 'rejected' && <p className="notice">Your last request wasn’t approved. You can apply again.</p>}
        <label>Category<select value={cat} onChange={(e) => setCat(e.target.value)}>{['Public figure', 'Creator', 'Business or brand', 'Journalist', 'Organisation', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Why should this account be verified?<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} required minLength={10} /></label>{err && <p className="error">{err}</p>}<button className="btn primary">Send request</button></form>}</div>;
}

export function CloseFriendsSection() {
  const [items, setItems] = useState<any[] | null>(null); const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]);
  const load = () => api<{ items: any[] }>('/me/close-friends').then((r) => setItems(r.items)); useEffect(() => { load(); }, []);
  useEffect(() => { if (!q.trim()) { setRes([]); return; } const h = setTimeout(() => api<{ items: any[] }>(`/search?type=people&q=${encodeURIComponent(q)}`).then((r) => setRes(r.items)), 250); return () => clearTimeout(h); }, [q]);
  const add = async (u: any) => { await api(`/me/close-friends/${u.username}`, { method: 'PUT' }); setQ(''); load(); }; const rm = async (u: any) => { await api(`/me/close-friends/${u.username}`, { method: 'DELETE' }); load(); };
  return <div className="stack"><Back title="Close friends" /><p className="meta">Share stories with just these people. They won’t be told they’re on your list.</p>
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
    {res.length > 0 && <div className="card list">{res.filter((u) => !items?.some((x) => x.id === u.id)).map((u) => <button key={u.id} className="row optrow" onClick={() => add(u)}><Avatar user={u} size={36} /><span className="grow"><b>{u.full_name}</b></span><span className="cfbadge">＋</span></button>)}</div>}
    {!items ? <Spinner /> : <div className="card list">{items.length ? items.map((u) => <div key={u.id} className="row"><Avatar user={u} size={36} /><span className="grow"><b>{u.full_name}</b><small className="meta block">@{u.username}</small></span><button className="btn ghost" onClick={() => rm(u)}>Remove</button></div>) : <p className="meta">Your list is empty.</p>}</div>}</div>;
}

export function MessagingSection() {
  const f = useFeatures(); const { me, refresh } = useSession(); const [dm, setDm] = useState<string | null>(null); const [hide, setHide] = useState(!!me?.hide_like_counts);
  useEffect(() => { api<{ dm_privacy: string }>('/me/dm-privacy').then((r) => setDm(r.dm_privacy)).catch(() => {}); }, []);
  const setD = async (v: string) => { setDm(v); await api('/me/dm-privacy', { method: 'PUT', json: { dm_privacy: v } }); toast('Saved'); };
  return <div className="stack"><Back title="Messages and likes" />
    {f?.messages && <div className="card stack"><b>Who can message you</b>{[['everyone', 'Everyone', 'People you don’t follow land in Message requests'], ['following', 'People you follow', ''], ['off', 'No one', 'Turn off new messages']].map(([k, l, h]) => <button key={k} className={`optrow ${dm === k ? 'on' : ''}`} onClick={() => setD(k)}><span className="grow"><b>{l}</b>{h && <small className="meta block">{h}</small>}</span>{dm === k && '✓'}</button>)}</div>}
    {f?.hide_likes && <div className="card row between"><span className="grow"><b>Hide like counts</b><small className="meta block">You won’t see the number of likes on other people’s posts.</small></span><Toggle label="Hide like counts" on={hide} onChange={async (v) => { setHide(v); await api('/me/prefs', { method: 'PATCH', json: { hide_like_counts: v } }); refresh(); }} /></div>}</div>;
}

// Shortcuts shown on the main Settings page for round 7/8 features.
export function ExtraLinks() {
  const f = useFeatures(); if (!f) return null;
  const L: [boolean | undefined, string, string, string][] = [[f.private_accounts || f.who_can || f.hide_presence || f.hidden_words || f.data_export || f.restrict_mute || f.discoverability, 'privacy-center', '🛡️', 'Privacy center'], [f.i18n, 'language', '🌐', 'Language'], [true, 'sounds', '🔔', 'Sounds and haptics'], [f.two_step, 'security', '🔐', 'Two-step login'],
    [f.messages || f.hide_likes, 'messaging', '💬', 'Messages and likes'], [f.close_friends, 'close-friends', '💚', 'Close friends'], [f.verified, 'verification', '✔️', 'Request verification']];
  return <div className="card list">{L.filter((x) => x[0]).map(([, k, e, l]) => <Link key={k} to={`/settings/${k}`}><span className="emicon">{e}</span> <span className="grow">{l}</span><Icon name="chev" /></Link>)}
    {f.creator_tools && <Link to="/me/insights"><span className="emicon">📊</span> <span className="grow">Professional dashboard</span><Icon name="chev" /></Link>}
    {f.gifts && <Link to="/me/coins"><span className="emicon">🪙</span> <span className="grow">Coins</span><Icon name="chev" /></Link>}
    {f.streaks && <Link to="/me/streak"><span className="emicon">🔥</span> <span className="grow">Streaks and badges</span><Icon name="chev" /></Link>}</div>;
}
