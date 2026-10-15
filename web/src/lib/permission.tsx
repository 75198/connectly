// Branded pre-permission screen. Shown before every browser camera/mic/location/contacts/notification
// prompt; the real browser prompt only fires after the user taps Allow. If the browser already reports
// "denied", we show friendly steps for turning it back on instead (a prompt would silently fail).
import { createRoot } from 'react-dom/client';
import { brand } from '../brand';

export type PermKind = 'camera' | 'microphone' | 'camera+microphone' | 'location' | 'contacts' | 'notifications';
const INFO: Record<PermKind, { what: string; icon: string; reason: string; setting: string }> = {
  camera: { what: 'your camera', icon: '📷', reason: 'So you can take photos and videos for posts, stories and reels.', setting: 'Camera' },
  microphone: { what: 'your microphone', icon: '🎙️', reason: 'So people can hear you in videos and live streams.', setting: 'Microphone' },
  'camera+microphone': { what: 'your camera and microphone', icon: '🎥', reason: 'So you can go live and record videos with sound.', setting: 'Camera and Microphone' },
  location: { what: 'your location', icon: '📍', reason: 'To fill in your city. We only save the nearest town, never your exact spot.', setting: 'Location' },
  contacts: { what: 'your contacts', icon: '👥', reason: 'To find friends who are already on Connectly. Only the contacts you pick are checked.', setting: 'Contacts' },
  notifications: { what: 'notifications', icon: '🔔', reason: 'So you know when friends message, comment or go live.', setting: 'Notifications' },
};
const granted = new Set<PermKind>(); // allowed this session (for browsers without the Permissions API)

async function state(kind: PermKind): Promise<PermissionState | 'unknown'> {
  try {
    if (kind === 'notifications') return !('Notification' in window) ? 'unknown' : Notification.permission === 'default' ? 'prompt' : (Notification.permission as PermissionState);
    if (kind === 'contacts') return 'unknown';
    const names = kind === 'camera+microphone' ? ['camera', 'microphone'] : [kind === 'location' ? 'geolocation' : kind];
    const res = await Promise.all(names.map((n) => navigator.permissions.query({ name: n as PermissionName }).then((r) => r.state)));
    return res.includes('denied') ? 'denied' : res.every((s) => s === 'granted') ? 'granted' : 'prompt';
  } catch { return 'unknown'; }
}

function Sheet({ kind, denied, done }: { kind: PermKind; denied: boolean; done: (ok: boolean) => void }) {
  const i = INFO[kind];
  return <div className="permback" role="dialog" aria-modal="true" aria-labelledby="permtitle">
    <div className="permcard">
      <img src={brand.logoUrl} alt="" className="permlogo" width={56} height={56} />
      <span className="permicon" aria-hidden>{i.icon}</span>
      {!denied ? <>
        <h2 id="permtitle">Allow {brand.name} to use {i.what}</h2>
        <p>{i.reason}</p>
        <button className="btn primary block" autoFocus onClick={() => done(true)}>Allow</button>
        <button className="btn ghost block" onClick={() => done(false)}>Not now</button>
      </> : <>
        <h2 id="permtitle">{i.setting} is turned off for {brand.name}</h2>
        <p>{i.reason} To turn it back on:</p>
        <ol className="permsteps">
          <li><b>iPhone (Safari):</b> tap <b>aA</b> in the address bar › <b>Website Settings</b> › set <b>{i.setting}</b> to <b>Allow</b>. Or Settings › Safari › {i.setting}. Using the home-screen app? Settings › {brand.name}.</li>
          <li><b>Android (Chrome):</b> tap the <b>lock icon</b> next to the address › <b>Permissions</b> › turn on <b>{i.setting}</b>. Or Settings › Apps › Chrome › Permissions.</li>
          <li>Then come back and try again.</li>
        </ol>
        <button className="btn primary block" autoFocus onClick={() => done(false)}>OK</button>
      </>}
    </div>
  </div>;
}

function show(kind: PermKind, denied: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => { root.unmount(); host.remove(); resolve(ok); };
    root.render(<Sheet kind={kind} denied={denied} done={done} />);
  });
}

/** Resolve true if the caller may now trigger the browser prompt / API. */
export async function askPermission(kind: PermKind): Promise<boolean> {
  const s = await state(kind);
  if (s === 'granted' || (s === 'unknown' && granted.has(kind))) return true;
  if (s === 'denied') { await show(kind, true); return false; }
  const ok = await show(kind, false);
  if (ok) granted.add(kind);
  return ok;
}
/** Call when the browser API throws NotAllowedError after the prompt: shows the re-enable steps. */
export function showPermissionDenied(kind: PermKind) { granted.delete(kind); return show(kind, true); }
