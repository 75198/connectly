import { api } from '../api';
export type Pow = { challenge: string; solution: string };
// Gets a challenge from the server and solves it in a background worker (about a second).
export async function solvePow(): Promise<Pow> {
  const c = await api<{ challenge: string; bits: number }>('/auth/challenge');
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(new Error('Security check failed to run. Please refresh and try again.')); w.terminate(); e.preventDefault(); };
    w.postMessage(c);
  });
}
