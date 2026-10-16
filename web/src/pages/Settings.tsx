import { guessCountry } from '../lib/region';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, deviceName, getFeatures, timeAgo } from '../api';
import { useSession } from '../session';
import { useFeatures } from '../api';
import { Avatar, Icon } from '../components/ui';
import { IdentifierInput } from '../components/Identifier';
import { CodeInput } from './Auth';
import { CloseFriendsSection, ExtraLinks, LanguageSection, MessagingSection, PushSection, SecuritySection, SoundsSection, VerifySection } from './SettingsExtra';

import { TextSize } from './TextSize';
import { RegionSection } from './Region';
import { LiteSection } from './SettingsExtra';
import { SafetyCenter } from './Safety';
import { GetVerified, GetVerifiedLink } from './GetVerified';
import { FollowRequests, PeopleList, PrivacyCenter } from './PrivacyCenter';
const SECTIONS: [string, string, Parameters<typeof Icon>[0]['name']][] = [
  ['account', 'Edit account', 'user'], ['email', 'Change email', 'chat'], ['phone', 'Change phone number', 'chat'], ['password', 'Change password', 'lock'],
  ['blocked', 'Blocked accounts', 'shield'], ['activity', 'Your activity log', 'flag'], ['sessions', 'Where you’re logged in', 'globe'], ['logins', 'Login history', 'globe'],
  ['safety', 'Safety Center', 'shield'], ['privacy', 'Post and profile privacy', 'lock'], ['notifications', 'Notifications', 'bell'], ['text-size', 'Text size', 'sliders'], ['region', 'Country and currency', 'globe'], ['lite', 'Lite mode', 'sliders'], ['deactivate', 'Deactivate or delete account', 'x'],
];
const Back = ({ title }: { title: string }) => <div className="row"><Link to="/settings" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">{title}</h1></div>;

function SubsLink() {
  const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(!!f.subscriptions)); }, []);
  if (!on) return <GetVerifiedLink />;
  return <><GetVerifiedLink /><div className="card list"><Link to="/settings/subscription"><Icon name="shield" /> <span className="grow">Subscription</span><Icon name="chev" /></Link><Link to="/settings/plans"><span className="aiorb xs">✦</span> <span className="grow"><b>Upgrade to Connectly Pro</b></span><Icon name="chev" /></Link></div></>;
}
export function Settings() {
  const { themePref, setThemePref } = useSession();
  return <div className="stack">
    <div className="row"><Link to="/me" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">Privacy and settings</h1></div>
    <SubsLink />
    <ExtraLinks />
    <section className="card"><h3>Appearance</h3>
      <div className="segmented" role="radiogroup" aria-label="Theme">{([['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'gear']] as const).map(([k, l, ic]) =>
        <button key={k} role="radio" aria-checked={themePref === k} className={themePref === k ? 'on' : ''} onClick={() => setThemePref(k)}><Icon name={ic} /> {l}</button>)}</div>
      <p className="meta">System follows your phone’s light or dark setting. Saved to your account.</p></section>
    <div className="card list">{SECTIONS.map(([k, label, icon]) => <Link key={k} to={`/settings/${k}`}><Icon name={icon} /> <span className="grow">{label}</span><Icon name="chev" /></Link>)}</div>
    <div className="card list">
      <Link to="/terms"><Icon name="shield" /> Terms &amp; Conditions</Link><Link to="/privacy"><Icon name="lock" /> Privacy Policy</Link>
    </div>
  </div>;
}

export function SettingsSection() {
  const { section = '' } = useParams();
  const C = ({ 'privacy-center': PrivacyCenter, 'follow-requests': FollowRequests, restricted: () => <PeopleList kind="restricted" />, muted: () => <PeopleList kind="muted" />, 'text-size': TextSize, region: RegionSection, lite: LiteSection, safety: SafetyCenter, 'get-verified': GetVerified, account: Account, email: () => <ChangeId kind="email" />, phone: () => <ChangeId kind="phone" />, password: Password, blocked: Blocked, activity: Activity, sessions: Sessions, logins: Logins, privacy: Privacy, notifications: Notifications, deactivate: Deactivate, language: LanguageSection, sounds: SoundsSection, security: SecuritySection, verification: VerifySection, 'close-friends': CloseFriendsSection, messaging: MessagingSection } as Record<string, () => JSX.Element>)[section];
  if (!C) return <div className="card empty">Not found. <Link to="/settings">Back to settings</Link></div>;
  return <C />;
}

function useStatus() { const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const view = <>{err && <p className="error" role="alert">{err}</p>}{msg && <p className="success">{msg}</p>}</>;
  return { run, setMsg, busy, view };
}

function Account() {
  const { me } = useSession(); if (!me) return null;
  return <div className="stack"><Back title="Edit account" />
    <div className="card list">
      <Link to="/settings/profile"><span className="grow"><b>Name and username</b><small className="meta block">{me.full_name} · @{me.username}</small></span><Icon name="chev" /></Link>
      <Link to="/settings/email"><span className="grow"><b>Email</b><small className="meta block">{me.email || 'Not added'}</small></span><Icon name="chev" /></Link>
      <Link to="/settings/phone"><span className="grow"><b>Phone number</b><small className="meta block">{me.phone || 'Not added'}</small></span><Icon name="chev" /></Link>
      <Link to="/settings/password"><span className="grow"><b>Password</b></span><Icon name="chev" /></Link>
    </div></div>;
}

function ChangeId({ kind }: { kind: 'email' | 'phone' }) {
  const { me, refresh } = useSession(); const s = useStatus();
  const [val, setVal] = useState(''); const [country, setCountry] = useState(guessCountry); const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState('');
  if (!me) return null;
  const start = (e: FormEvent) => { e.preventDefault(); s.run(async () => { const r = await api<{ sent_to: string; type: string }>('/me/identifier/start', { json: { identifier: val, country, password: pw } }); if (r.type !== kind) throw new Error(kind === 'email' ? 'Enter an email address' : 'Enter a phone number'); setSent(r.sent_to); }); };
  const confirm = (e: FormEvent) => { e.preventDefault(); s.run(async () => { await api('/me/identifier/confirm', { json: { identifier: sent, country, code } }); await refresh(); setSent(''); setVal(''); setPw(''); setCode(''); s.setMsg(kind === 'email' ? 'Email updated' : 'Phone number updated'); }); };
  return <div className="stack"><Back title={kind === 'email' ? 'Change email' : 'Change phone number'} />
    <p className="meta">Current: {(kind === 'email' ? me.email : me.phone) || 'not added'}</p>
    {!sent ? <form className="card stack" onSubmit={start}>
      {kind === 'email' ? <label>New email<input type="email" value={val} onChange={(e) => setVal(e.target.value)} required autoComplete="email" autoCapitalize="none" /></label>
        : <IdentifierInput value={val} onChange={setVal} country={country} onCountry={setCountry} />}
      <label>Current password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" /></label>
      {s.view}<button className="btn primary" disabled={s.busy}>Send code</button>
    </form> : <form className="card stack" onSubmit={confirm}>
      <p>We sent a 6-digit code to <b>{sent}</b>.</p><CodeInput value={code} onChange={setCode} />
      {s.view}<button className="btn primary" disabled={s.busy || code.length !== 6}>Confirm</button>
    </form>}
  </div>;
}

function Password() {
  const s = useStatus(); const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  return <div className="stack"><Back title="Change password" />
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); s.run(async () => { await api('/me/password', { json: { current_password: cur, new_password: nw } }); setCur(''); setNw(''); s.setMsg('Password changed. Other devices were signed out.'); }); }}>
      <label>Current password<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></label>
      <label>New password<input type="password" value={nw} onChange={(e) => setNw(e.target.value)} minLength={8} required autoComplete="new-password" /><span className="hint">At least 8 characters</span></label>
      {s.view}<button className="btn primary" disabled={s.busy}>Change password</button>
    </form></div>;
}

type Mini = { id: number; username: string; full_name: string; avatar_path: string | null };
function Blocked() {
  const [items, setItems] = useState<Mini[] | null>(null); const s = useStatus();
  const load = () => api<{ items: Mini[] }>('/me/blocked').then((r) => setItems(r.items));
  useEffect(() => { load(); }, []);
  return <div className="stack"><Back title="Blocked accounts" />{s.view}
    {!items ? <div className="spinner" /> : items.length === 0 ? <p className="card empty">You haven’t blocked anyone.</p>
      : <div className="card list">{items.map((u) => <div key={u.id} className="hubrow"><span className="person grow"><Avatar user={u} size={40} /><span><b>{u.full_name}</b><small className="meta">@{u.username}</small></span></span>
        <button className="chip" onClick={() => s.run(async () => { await api(`/me/blocked/${u.id}`, { method: 'DELETE' }); await load(); })}>Unblock</button></div>)}</div>}
  </div>;
}

type Act = { id: number; post_id: number; text: string; created_at: string };
function Activity() {
  const [type, setType] = useState<'posts' | 'comments' | 'likes'>('posts'); const [items, setItems] = useState<Act[] | null>(null); const [cursor, setCursor] = useState<string | null>(null);
  const load = async (reset: boolean) => { const r = await api<{ items: Act[]; next_cursor: string | null }>(`/me/activity?type=${type}${!reset && cursor ? `&cursor=${cursor}` : ''}`); setItems((x) => reset ? r.items : [...(x || []), ...r.items]); setCursor(r.next_cursor); };
  useEffect(() => { setItems(null); load(true); }, [type]); // eslint-disable-line
  const verb = { posts: 'You posted', comments: 'You commented', likes: 'You liked a post' }[type];
  return <div className="stack"><Back title="Your activity log" />
    <div className="tabs card">{(['posts', 'comments', 'likes'] as const).map((t) => <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {!items ? <div className="spinner" /> : items.length === 0 ? <p className="card empty">Nothing here yet.</p> : <div className="card list">
      {items.map((a) => <Link key={`${type}${a.id}`} to={`/post/${a.post_id}`}><span className="grow"><b>{verb}</b><small className="meta block">{a.text || 'Photo'} · {timeAgo(a.created_at)}</small></span><Icon name="chev" /></Link>)}</div>}
    {cursor && <button className="btn ghost block" onClick={() => load(false)}>Show more</button>}
  </div>;
}

type Sess = { id: number; user_agent: string; approx_location: string; created_at: string; last_seen_at: string; current: boolean };
function Sessions() {
  const [d, setD] = useState<{ items: Sess[]; saved_devices: { id: string; user_agent: string; created_at: string; last_used_at: string | null }[] } | null>(null); const s = useStatus();
  const load = () => api<typeof d>('/me/sessions').then(setD);
  useEffect(() => { load(); }, []);
  return <div className="stack"><Back title="Where you’re logged in" />{s.view}
    {!d ? <div className="spinner" /> : <>
      <div className="card list">{d.items.map((x) => <div key={x.id} className="hubrow"><span className="grow"><b>{deviceName(x.user_agent)}</b>{x.current && <span className="chip small">This device</span>}
        <small className="meta block">{x.approx_location || 'Location unavailable'} · active {timeAgo(x.last_seen_at)}</small></span>
        {!x.current && <button className="chip" onClick={() => s.run(async () => { await api(`/me/sessions/${x.id}`, { method: 'DELETE' }); await load(); })}>Log out</button>}</div>)}</div>
      {d.items.length > 1 && <button className="btn ghost block" onClick={() => s.run(async () => { const r = await api<{ ended: number }>('/me/sessions/logout-others', { method: 'POST' }); s.setMsg(`Logged out of ${r.ended} other session${r.ended === 1 ? '' : 's'}`); await load(); })}>Log out of all other sessions</button>}
      {d.saved_devices.length > 0 && <section className="card"><h3>Saved logins</h3><p className="hint">Devices where you chose “Save this account”.</p>
        {d.saved_devices.map((x) => <div key={x.id} className="hubrow"><span className="grow"><b>{deviceName(x.user_agent)}</b><small className="meta block">saved {timeAgo(x.created_at)}</small></span>
          <button className="chip" onClick={() => s.run(async () => { await api(`/me/saved-devices/${x.id}`, { method: 'DELETE' }); await load(); })}>Remove</button></div>)}</section>}
    </>}
  </div>;
}

type Login = { id: number; created_at: string; method: string; user_agent: string; approx_location: string };
function Logins() {
  const [items, setItems] = useState<Login[] | null>(null);
  useEffect(() => { api<{ items: Login[] }>('/me/logins').then((r) => setItems(r.items)); }, []);
  const how = { password: 'Password', signup: 'Account created', saved_login: 'Saved login' } as Record<string, string>;
  return <div className="stack"><Back title="Login history" />
    {!items ? <div className="spinner" /> : <div className="card list">{items.map((l) => <div key={l.id} className="hubrow"><span className="grow"><b>{deviceName(l.user_agent)}</b>
      <small className="meta block">{how[l.method] || l.method} · {l.approx_location || 'Location unavailable'} · {new Date(l.created_at).toLocaleString()}</small></span></div>)}</div>}
  </div>;
}

function Privacy() {
  const { me, refresh } = useSession(); const s = useStatus(); if (!me) return null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => s.run(async () => { await api('/me/settings', { method: 'PATCH', json: { [k]: e.target.value } }); await refresh(); s.setMsg('Saved'); });
  const opts = <><option value="public">Public</option><option value="friends">Friends</option><option value="private">Only me</option></>;
  return <div className="stack"><Back title="Post and profile privacy" />
    <div className="card stack">
      <label>Default audience for new posts<select value={me.default_post_visibility} onChange={set('default_post_visibility')}>{opts}</select><span className="hint">You can still change it on each post.</span></label>
      <label>Who can see your profile details<select value={me.profile_details_visibility} onChange={set('profile_details_visibility')}>{opts}</select><span className="hint">Bio, work, education, places, relationship and interests. Your name and photo are always visible.</span></label>
      {s.view}
    </div></div>;
}

function Notifications() {
  const { me, refresh } = useSession(); const s = useStatus(); if (!me) return null;
  const toggle = (k: 'email_notifications' | 'inapp_notifications') => s.run(async () => { await api('/me/settings', { method: 'PATCH', json: { [k]: !me[k] } }); await refresh(); });
  return <div className="stack"><Back title="Notifications" />
    <PushSection />
    <div className="card list">
      <label className="switchrow"><span className="grow"><b>Email notifications</b><small className="meta block">Friend requests and accepted requests{me.email ? ` to ${me.email}` : ''}</small></span><input type="checkbox" role="switch" checked={!!me.email_notifications} onChange={() => toggle('email_notifications')} /></label>
      <label className="switchrow"><span className="grow"><b>In-app notifications</b><small className="meta block">Likes, comments, replies, follows and friend requests</small></span><input type="checkbox" role="switch" checked={!!me.inapp_notifications} onChange={() => toggle('inapp_notifications')} /></label>
    </div>{s.view}
    <p className="hint">Security emails (confirmation and reset codes) are always sent.</p>
  </div>;
}

function Deactivate() {
  const nav = useNavigate(); const { refresh } = useSession(); const s = useStatus();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [ack, setAck] = useState(false);
  const grace = !!useFeatures()?.safety_center;
  return <div className="stack"><Back title="Deactivate or delete account" />
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); s.run(async () => { await api('/me/deactivate', { json: { password: pw } }); await refresh(); nav('/login'); }); }}>
      <h3>Deactivate (temporary)</h3><p className="meta">Your profile and posts are hidden until you log in again. Nothing is deleted.</p>
      <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" /></label>
      <button className="btn ghost" disabled={s.busy}>Deactivate my account</button>
    </form>
    <form className="card stack dangerzone" onSubmit={(e) => { e.preventDefault(); if (!confirm(grace ? 'Delete your account? It will be deleted for good in 30 days. Log in before then to cancel.' : 'Permanently delete your account now? This cannot be undone.')) return; s.run(async () => { await api('/me/delete', { json: { password: pw2 } }); await refresh(); nav('/login'); }); }}>
      <h3>{grace ? 'Delete account' : 'Delete permanently'}</h3>
      <p className="meta">{grace ? <>Your account is hidden right away and <b>deleted for good after 30 days</b>: profile, posts, photos, comments, likes, friends, pages and groups you own, and marketplace listings. Changed your mind? Just log in again within 30 days. <Link to="/settings/safety">Download your data first</Link>.</> : <>Deletes your account <b>immediately and forever</b>: profile, posts, photos, comments, likes, friends, pages and groups you own, and marketplace listings. This can’t be undone.</>}</p>
      <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{grace ? 'I understand my account will be deleted after 30 days.' : 'I understand this is permanent.'}</span></label>
      <label>Password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="current-password" /></label>
      <button className="btn primary dangerbtn" disabled={s.busy || !ack}>Delete my account</button>
    </form>{s.view}
  </div>;
}
