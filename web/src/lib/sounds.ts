// Interaction sounds (round 7). All sounds are original, synthesised live with the Web Audio API (no audio files).
// Off switch: Settings › Sounds (default on, stored on this device). We ask the browser for an "ambient" audio session
// where supported (Safari 17+), so the iPhone silent switch mutes them, and nothing plays while the page is hidden.
export type Sfx = 'like' | 'reaction' | 'posted' | 'comment' | 'sent' | 'received' | 'follow' | 'notify' | 'gift';
const KEY = 'cx-sounds';
export const soundsOn = () => localStorage.getItem(KEY) !== '0';
export const setSoundsOn = (on: boolean) => localStorage.setItem(KEY, on ? '1' : '0');
let ctx: AudioContext | null = null;
function ac() {
  try { const n = navigator as any; if (n.audioSession && n.audioSession.type !== 'ambient') n.audioSession.type = 'ambient'; } catch { /* unsupported */ }
  if (!ctx) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx!.state === 'suspended') ctx!.resume().catch(() => {});
  return ctx;
}
// note: [freqHz, startSec, durSec, type, gain]
type N = [number, number, number, OscillatorType?, number?];
const P: Record<Sfx, { n: N[]; buzz: number | number[] }> = {
  like: { n: [[880, 0, 0.09, 'sine', 0.12], [1320, 0.05, 0.12, 'sine', 0.08]], buzz: 8 },
  reaction: { n: [[660, 0, 0.07, 'triangle', 0.1], [990, 0.05, 0.08, 'triangle', 0.08], [1320, 0.1, 0.1, 'sine', 0.06]], buzz: 10 },
  posted: { n: [[523, 0, 0.12, 'sine', 0.1], [659, 0.08, 0.12, 'sine', 0.1], [784, 0.16, 0.2, 'sine', 0.1]], buzz: [12, 40, 12] },
  comment: { n: [[740, 0, 0.08, 'sine', 0.09], [988, 0.06, 0.1, 'sine', 0.07]], buzz: 8 },
  sent: { n: [[600, 0, 0.06, 'sine', 0.08], [1200, 0.03, 0.09, 'sine', 0.05]], buzz: 6 },
  received: { n: [[1046, 0, 0.1, 'sine', 0.09], [784, 0.09, 0.14, 'sine', 0.08]], buzz: [10, 30, 10] },
  follow: { n: [[587, 0, 0.1, 'triangle', 0.09], [880, 0.08, 0.16, 'triangle', 0.09]], buzz: 12 },
  notify: { n: [[988, 0, 0.12, 'sine', 0.08], [1318, 0.1, 0.18, 'sine', 0.07]], buzz: [10, 40, 10] },
  gift: { n: [[784, 0, 0.08, 'triangle', 0.09], [988, 0.07, 0.08, 'triangle', 0.09], [1175, 0.14, 0.08, 'triangle', 0.09], [1568, 0.21, 0.25, 'sine', 0.08]], buzz: [15, 30, 15, 30, 25] },
};
export function sfx(kind: Sfx) {
  try { (navigator as any).vibrate?.(P[kind].buzz); } catch { /* not supported */ }
  if (!soundsOn() || document.hidden) return;
  const c = ac(); if (!c) return; const t0 = c.currentTime + 0.01;
  for (const [f, s, d, type = 'sine', g = 0.08] of P[kind].n) {
    const o = c.createOscillator(); const v = c.createGain(); o.type = type; o.frequency.value = f;
    v.gain.setValueAtTime(0, t0 + s); v.gain.linearRampToValueAtTime(g, t0 + s + 0.012); v.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
    o.connect(v).connect(c.destination); o.start(t0 + s); o.stop(t0 + s + d + 0.02);
  }
}
