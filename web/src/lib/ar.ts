// AR face effects with MediaPipe Face Landmarker (Apache-2.0), self-hosted in /mediapipe (no CDN, no key).
// The camera video is drawn to a canvas with the effect on top; photos and recordings use that canvas.
import type { FaceLandmarker as FL } from '@mediapipe/tasks-vision';
export const EFFECTS = [
  { k: 'none', label: 'None', icon: '⭕' }, { k: 'glasses', label: 'Shades', icon: '🕶️' }, { k: 'puppy', label: 'Puppy', icon: '🐶' },
  { k: 'crown', label: 'Crown', icon: '👑' }, { k: 'blush', label: 'Blush', icon: '😊' }, { k: 'hearts', label: 'Hearts', icon: '💕' }, { k: 'glow', label: 'Glow', icon: '✨' },
] as const;
export type EffectKey = typeof EFFECTS[number]['k'];
let loader: Promise<FL> | null = null;
export function loadFaceLandmarker() {
  loader ||= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe');
    return FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 2 });
  })();
  loader.catch(() => { loader = null; });
  return loader;
}
type P = { x: number; y: number };
function emoji(g: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, 0); g.restore();
}
export function drawEffect(g: CanvasRenderingContext2D, fx: EffectKey, faces: P[][], w: number, h: number, t: number) {
  for (const lm of faces) {
    const p = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h });
    const le = p(33), re = p(263), nose = p(1), top = p(10), chin = p(152), lc = p(205), rc = p(425);
    const eyeD = Math.hypot(re.x - le.x, re.y - le.y); const rot = Math.atan2(re.y - le.y, re.x - le.x); const faceH = Math.hypot(chin.x - top.x, chin.y - top.y);
    const mid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
    if (fx === 'glasses') emoji(g, '🕶️', mid.x, mid.y, eyeD * 1.9, rot);
    if (fx === 'crown') emoji(g, '👑', top.x - Math.sin(rot) * faceH * 0.25, top.y - faceH * 0.28, eyeD * 1.8, rot);
    if (fx === 'puppy') {
      const up = { x: Math.sin(rot) * faceH * 0.15, y: -Math.cos(rot) * faceH * 0.15 };
      g.fillStyle = '#7c4a2d';
      for (const [ex, s] of [[le, -1], [re, 1]] as const) { g.save(); g.translate(ex.x + up.x * 2.2 + s * eyeD * 0.35, ex.y + up.y * 2.2); g.rotate(rot + s * 0.35); g.beginPath(); g.ellipse(0, 0, eyeD * 0.28, eyeD * 0.55, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e8a3a3'; g.beginPath(); g.ellipse(0, eyeD * 0.06, eyeD * 0.14, eyeD * 0.34, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#7c4a2d'; g.restore(); }
      g.fillStyle = '#2b1a12'; g.beginPath(); g.ellipse(nose.x, nose.y, eyeD * 0.2, eyeD * 0.14, rot, 0, Math.PI * 2); g.fill();
    }
    if (fx === 'blush') { g.fillStyle = 'rgba(255,105,140,.32)'; for (const c of [lc, rc]) { g.beginPath(); g.ellipse(c.x, c.y, eyeD * 0.3, eyeD * 0.2, rot, 0, Math.PI * 2); g.fill(); } emoji(g, '✨', re.x + eyeD * 0.6, re.y - eyeD * 0.5, eyeD * 0.4); }
    if (fx === 'hearts') for (let i = 0; i < 6; i++) { const a = t / 900 + (i * Math.PI) / 3; emoji(g, '💗', top.x + Math.cos(a) * faceH * 0.75, top.y + faceH * 0.2 + Math.sin(a) * faceH * 0.25 - faceH * 0.2, eyeD * 0.45); }
  }
  if (fx === 'glow') { g.save(); g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(255,200,220,.35)'; g.fillRect(0, 0, w, h); g.restore(); }
}
// Runs the render loop; returns a stop function.
export function startAR(video: HTMLVideoElement, canvas: HTMLCanvasElement, getFx: () => EffectKey, mirror: () => boolean, fl: FL) {
  const g = canvas.getContext('2d')!; let raf = 0; let last = -1; let faces: P[][] = [];
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!video.videoWidth) return;
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    const now = performance.now();
    if (video.currentTime !== last) { last = video.currentTime; try { faces = fl.detectForVideo(video, now).faceLandmarks as P[][]; } catch { /* frame skipped */ } }
    g.save(); if (mirror()) { g.translate(canvas.width, 0); g.scale(-1, 1); }
    const fx = getFx(); if (fx === 'glow') g.filter = 'brightness(1.06) contrast(1.04) saturate(1.1) blur(0.4px)';
    g.drawImage(video, 0, 0); g.filter = 'none'; drawEffect(g, fx, faces, canvas.width, canvas.height, now); g.restore();
  };
  loop();
  return () => cancelAnimationFrame(raf);
}
