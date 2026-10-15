import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { Avatar, Icon } from '../components/ui';
import { FlowShell } from './Auth';

const STEPS = ['Add a profile photo', 'Stay in the loop', 'Where are you?', 'Find people you know'];
type Match = { id: number; username: string; full_name: string; avatar_path: string | null };

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function Onboarding() {
  const { me, refresh } = useSession();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const contactsSupported = typeof navigator !== 'undefined' && 'contacts' in navigator && 'select' in ((navigator as any).contacts || {});
  const [back, setBack] = useState(false);
  const go = (n: number) => { setBack(n < step); setErr(''); setNote(''); setStep(n); };
  const finish = async () => { setBusy(true); try { await api('/me/onboarding-complete', { method: 'POST' }); await refresh(); } catch (e: any) { setErr(e.message); setBusy(false); } };
  const next = () => (step === STEPS.length - 1 ? finish() : go(step + 1));
  const run = async (fn: () => Promise<void>) => { setErr(''); setBusy(true); try { await fn(); } catch (e: any) { setErr(e.message || 'Something went wrong'); } finally { setBusy(false); } };

  const photo = (f?: File) => f && run(async () => {
    if (f.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller');
    const fd = new FormData(); fd.append('image', f); await api('/me/avatar', { form: fd }); await refresh(); setNote('Looking good!');
  });
  const notifications = () => run(async () => {
    if (!('Notification' in window)) { setNote('This browser doesn’t support notifications.'); return; }
    const p = await Notification.requestPermission();
    if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (p === 'granted') { setNote('Notifications are on.'); setTimeout(next, 700); } else setNote('Notifications are off. You can enable them later in your browser settings.');
  });
  const location = () => run(async () => {
    if (!('geolocation' in navigator)) { setNote('Location isn’t available in this browser.'); return; }
    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }))
      .catch(() => { throw new Error('Location permission was not given. You can add your city later in your profile.'); });
    const r = await api<{ location: string }>('/me/location', { json: { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) } });
    setNote(`Saved: ${r.location}`); await refresh(); setTimeout(next, 900);
  });
  const contacts = () => run(async () => {
    const picked: { email?: string[]; tel?: string[] }[] = await (navigator as any).contacts.select(['email', 'tel'], { multiple: true });
    const vals = new Set<string>();
    for (const c of picked) {
      c.email?.forEach((e) => vals.add(e.trim().toLowerCase()));
      c.tel?.forEach((t) => { let d = t.replace(/[^\d+]/g, ''); if (d.startsWith('0')) d = '+234' + d.slice(1); else if (!d.startsWith('+')) d = '+' + d; vals.add(d); });
    }
    const hashes = await Promise.all([...vals].slice(0, 2000).map(sha256));
    const r = await api<{ items: Match[] }>('/contacts/match', { json: { hashes } });
    setMatches(r.items);
  });

  if (!me) return null;
  return <FlowShell stepKey={step} back={back}>
    <h1 className="flowtitle">{STEPS[step]}</h1>
    <div className="stack">
      {step === 0 && <>
        <div className="bignote"><Avatar user={me} size={96} /></div>
        <p className="center">Add a profile photo so friends recognise you.</p>
        <label className="btn primary block">{busy ? 'Uploading…' : me.avatar_path ? 'Choose a different photo' : 'Upload a photo'}<input type="file" accept="image/*" hidden onChange={(e) => photo(e.target.files?.[0])} /></label>
      </>}
      {step === 1 && <>
        <div className="bignote"><Icon name="bell" /></div>
        <p className="center">Turn on notifications to hear about likes and comments on your posts.</p>
        <button className="btn primary block" disabled={busy} onClick={notifications}>Allow notifications</button>
      </>}
      {step === 2 && <>
        <div className="bignote"><Icon name="pin" /></div>
        <p className="center">Share your location to show your city on your profile. We only save your city and country — never your exact position.</p>
        <button className="btn primary block" disabled={busy} onClick={location}>{busy ? 'Finding your city…' : 'Allow location'}</button>
      </>}
      {step === 3 && <>
        <div className="bignote"><Icon name="users" /></div>
        {contactsSupported ? <>
          <p className="center">Find people you know who are already on Connectly. Contacts are scrambled (hashed) on your phone before matching and are never stored.</p>
          {matches === null ? <button className="btn primary block" disabled={busy} onClick={contacts}>{busy ? 'Matching…' : 'Choose contacts'}</button>
            : matches.length === 0 ? <p className="card empty">None of those contacts are on Connectly yet.</p>
            : <div className="card list">{matches.map((m) => <Link key={m.id} to={`/u/${m.username}`} target="_blank" className="person"><Avatar user={m} size={40} /><span><b>{m.full_name}</b><small className="meta">@{m.username}</small></span></Link>)}</div>}
        </> : <p className="center notice">Your browser can’t share contacts (this works on Android Chrome). You can search for friends by name anytime.</p>}
      </>}
      {err && <p className="error" role="alert">{err}</p>}{note && <p className="success center">{note}</p>}
      <button className={`btn block ${step === 3 && (matches !== null || !contactsSupported) ? 'primary' : 'ghost'}`} disabled={busy && step === 3} onClick={next}>
        {step === 3 ? (matches !== null || !contactsSupported ? 'Go to my feed' : 'Skip & go to my feed') : (step === 0 && me.avatar_path) || note ? 'Continue' : 'Skip'}</button>
      {step > 0 && <button className="linkish" onClick={() => go(step - 1)}>Back</button>}
    </div>
  </FlowShell>;
}
