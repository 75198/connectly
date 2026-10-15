import { solve } from '../server/pow.js';
// Fetches a signup proof-of-work challenge with the given supertest agent and solves it.
export async function powFor(a) {
  const r = await a.get('/api/auth/challenge');
  return { challenge: r.body.challenge, solution: solve(r.body.challenge, r.body.bits) };
}
