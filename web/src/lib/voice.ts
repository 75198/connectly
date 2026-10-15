// Free, built-in voice helpers for Connectly AI: MediaRecorder for voice notes (transcribed server-side by Groq Whisper)
// and the browser's speechSynthesis for "Speak". No paid TTS.
const BCP47: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', ar: 'ar-SA', hi: 'hi-IN', zh: 'zh-CN', ru: 'ru-RU', id: 'id-ID', tr: 'tr-TR', de: 'de-DE', ja: 'ja-JP', ko: 'ko-KR', sw: 'sw-KE', yo: 'yo-NG', ha: 'ha-NG', ig: 'ig-NG' };
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
// Guess the reply's language from its script so an English answer isn't read with an Arabic voice, etc.
function guessLang(text: string, fallback: string) {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'; if (/[\u0900-\u097F]/.test(text)) return 'hi'; if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'; if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'; if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  return fallback;
}
function pickVoice(code: string) {
  const vs = speechSynthesis.getVoices(); const tag = BCP47[code] || code;
  return vs.find((v) => v.lang === tag) || vs.find((v) => v.lang.toLowerCase().startsWith(code)) || null;
}
const clean = (t: string) => t.replace(/\*\*/g, '').replace(/[#>`_~]/g, '').replace(/https?:\/\/\S+/g, 'link').replace(/\p{Extended_Pictographic}/gu, '');
export function speak(text: string, lang: string, onEnd?: () => void) {
  if (!canSpeak()) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const code = guessLang(text, lang); let voice = pickVoice(code);
  // Languages without an installed voice (often Yoruba, Hausa, Igbo, Swahili) fall back to the closest available voice.
  const useCode = voice ? code : (pickVoice('en') ? 'en' : code); if (!voice) voice = pickVoice(useCode);
  // Chrome stops long utterances, so read sentence by sentence.
  const parts = clean(text).match(/[^.!?。！？\n]+[.!?。！？]*\s*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  if (!parts.length) { onEnd?.(); return; }
  let left = parts.length;
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p); u.lang = BCP47[useCode] || useCode; if (voice) u.voice = voice; u.rate = 1.03;
    u.onend = u.onerror = () => { if (--left === 0) onEnd?.(); };
    speechSynthesis.speak(u);
  }
}
export function stopSpeaking() { if (canSpeak()) speechSynthesis.cancel(); }
if (canSpeak()) speechSynthesis.getVoices(); // warm the voice list

const live = new Set<Recorder>();
export class Recorder {
  done: Promise<Blob | null>; private mr: MediaRecorder; private stream: MediaStream; private ctx?: AudioContext; private resolve!: (b: Blob | null) => void; private cancelled = false;
  private constructor(stream: MediaStream, autoStop: boolean) {
    this.stream = stream;
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    this.mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const chunks: Blob[] = [];
    this.done = new Promise((r) => { this.resolve = r; });
    this.mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.mr.onstop = () => { this.cleanup(); this.resolve(this.cancelled || !chunks.length ? null : new Blob(chunks, { type: (this.mr.mimeType || 'audio/webm').split(';')[0] })); };
    this.mr.start(250); live.add(this);
    if (autoStop) this.vad();
  }
  static async start(o: { autoStop?: boolean } = {}) { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); return new Recorder(s, !!o.autoStop); }
  // Simple voice-activity detection: wait for speech, then stop after a short pause.
  private vad() {
    const ctx = new AudioContext(); this.ctx = ctx; const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(this.stream).connect(an);
    const buf = new Uint8Array(an.fftSize); let spoke = false; let quietSince = 0; const t0 = performance.now(); let noise = 0.01;
    const tick = () => {
      if (this.mr.state !== 'recording') return;
      an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; } const rms = Math.sqrt(sum / buf.length);
      const now = performance.now(); if (!spoke && now - t0 < 600) noise = Math.max(noise, rms);
      const loud = rms > Math.max(0.03, noise * 2.2);
      if (loud) { spoke = true; quietSince = 0; } else if (spoke) { quietSince ||= now; if (now - quietSince > 1300) return this.mr.stop(); }
      if (!spoke && now - t0 > 15000) { this.cancelled = true; return this.mr.stop(); }
      if (now - t0 > 120000) return this.mr.stop();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() { if (this.mr.state !== 'inactive') this.mr.stop(); return this.done; }
  cancel() { this.cancelled = true; return this.stop(); }
  static cancelAll() { for (const r of live) r.cancel(); }
  private cleanup() { live.delete(this); this.stream.getTracks().forEach((t) => t.stop()); this.ctx?.close().catch(() => {}); }
}

// Make big phone photos quick to upload; the server resizes again either way.
export async function shrinkImage(f: File): Promise<Blob> {
  if (f.size < 1.5e6 || !/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
  try {
    const bmp = await createImageBitmap(f); const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((r) => c.toBlob((b) => r(b || f), 'image/jpeg', 0.88));
  } catch { return f; }
}
