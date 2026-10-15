// Web push subscription (round 7, FEATURE_PUSH). Goes through the branded pre-permission sheet.
import { api } from '../api';
import { askPermission } from './permission';
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function currentPush() { if (!pushSupported()) return null; const reg = await navigator.serviceWorker.getRegistration(); return reg ? reg.pushManager.getSubscription() : null; }
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) throw new Error('This browser can’t show notifications. On iPhone, add Connectly to your Home Screen first.');
  const { key } = await api<{ key: string | null }>('/push/key'); if (!key) throw new Error('Notifications aren’t available right now');
  const ok = await askPermission('notifications'); if (!ok) return false;
  const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await api('/push/subscribe', { json: sub.toJSON() }); return true;
}
export async function disablePush() { const s = await currentPush(); if (s) { await api('/push/unsubscribe', { json: { endpoint: s.endpoint } }).catch(() => {}); await s.unsubscribe(); } }
